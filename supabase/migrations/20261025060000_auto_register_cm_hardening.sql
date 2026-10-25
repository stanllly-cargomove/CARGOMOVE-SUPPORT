-- Repair and harden Auto Register in CM without discarding existing audit data.

alter table public.auto_register_cm_scheduled_items
  add column if not exists registration_fingerprint text;

-- Include eligibility dependencies so a corrected company or port configuration
-- can be scheduled again after an earlier failure.
create or replace function public.auto_register_cm_registration_fingerprint(p_submission_id text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select md5(concat_ws('|',
    coalesce(s.data::text, '{}'),
    coalesce(s.company_id, ''),
    coalesce(s.reference_no, ''),
    coalesce(s.registration_type, ''),
    coalesce(s.port_id, ''),
    coalesce(s.port_location, ''),
    coalesce(s.depot_id, ''),
    coalesce(s.company_reg_no, ''),
    coalesce(s.company_name, ''),
    coalesce(c.registration_status, ''),
    coalesce(c.haulier_id, ''),
    coalesce(c.forwarding_agent_id, ''),
    coalesce(c.updated_at::text, ''),
    coalesce(p.backend_port_id, ''),
    coalesce(p.active::text, ''),
    coalesce(p.updated_at::text, ''),
    coalesce(d.backend_depot_id, ''),
    coalesce(d.active::text, ''),
    coalesce(d.updated_at::text, '')
  ))
  from public.registration_submissions s
  left join public.companies c on c.id = s.company_id
  left join public.port_configs p on p.id = s.port_id
  left join public.depot_configs d on d.id = s.depot_id
  where s.id = p_submission_id;
$$;

update public.auto_register_cm_scheduled_items q
set registration_fingerprint = coalesce(
  public.auto_register_cm_registration_fingerprint(q.submission_id),
  md5(concat_ws('|', q.submission_id, q.reference_no, q.registration_type, q.company_name))
)
where q.registration_fingerprint is null;

alter table public.auto_register_cm_scheduled_items
  alter column registration_fingerprint set not null;

-- Use the same failure vocabulary as scheduler runs and upload jobs.
alter table public.auto_register_cm_scheduled_items
  drop constraint if exists auto_register_cm_scheduled_items_status_check;

update public.auto_register_cm_scheduled_items
set status = 'FAILED'
where status = 'FAIL';

alter table public.auto_register_cm_scheduled_items
  add constraint auto_register_cm_scheduled_items_status_check
  check (status in ('SCHEDULED', 'SUCCESS', 'FAILED'));

-- Repair any historical counters before enforcing invariants.
update public.automation_scheduler_runs
set processed_count = greatest(0, processed_count, greatest(0, success_count) + greatest(0, failed_count)),
    success_count = greatest(0, success_count),
    failed_count = greatest(0, failed_count),
    duration_ms = case when duration_ms is null then null else greatest(0, duration_ms) end;

alter table public.automation_scheduler_runs
  add constraint automation_scheduler_runs_counts_check
    check (processed_count >= 0 and success_count >= 0 and failed_count >= 0
      and success_count + failed_count <= processed_count),
  add constraint automation_scheduler_runs_duration_check
    check (duration_ms is null or duration_ms >= 0);

update public.auto_register_cm_scheduled_items
set completed_at = coalesce(completed_at, scheduled_at)
where status in ('SUCCESS', 'FAILED') and completed_at is null;

update public.auto_register_cm_scheduled_items
set completed_at = null
where status = 'SCHEDULED' and completed_at is not null;

alter table public.auto_register_cm_scheduled_items
  add constraint auto_register_cm_scheduled_items_completion_check
  check (
    (status = 'SCHEDULED' and completed_at is null)
    or (status in ('SUCCESS', 'FAILED') and completed_at is not null)
  );

-- Preserve every execution-to-registration association. The existing run_id
-- remains the latest run for backwards compatibility.
create table public.automation_scheduler_run_items (
  run_id uuid not null references public.automation_scheduler_runs(id),
  scheduled_item_id uuid not null references public.auto_register_cm_scheduled_items(id),
  queue_status text not null check (queue_status in ('SCHEDULED', 'SUCCESS', 'FAILED')),
  linked_at timestamptz not null default now(),
  completed_at timestamptz,
  message text not null default '',
  primary key (run_id, scheduled_item_id)
);

create index automation_scheduler_run_items_item_idx
  on public.automation_scheduler_run_items(scheduled_item_id, linked_at desc);

insert into public.automation_scheduler_run_items(
  run_id, scheduled_item_id, queue_status, linked_at, completed_at, message
)
select q.run_id, q.id, q.status, q.scheduled_at, q.completed_at, q.message
from public.auto_register_cm_scheduled_items q
where q.run_id is not null
on conflict (run_id, scheduled_item_id) do nothing;

create function public.sync_auto_register_cm_run_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.run_id is null then
    return new;
  end if;

  insert into public.automation_scheduler_run_items(
    run_id, scheduled_item_id, queue_status, completed_at, message
  ) values (
    new.run_id, new.id, new.status, new.completed_at, new.message
  )
  on conflict (run_id, scheduled_item_id) do update
  set queue_status = excluded.queue_status,
      completed_at = excluded.completed_at,
      message = excluded.message;

  return new;
end;
$$;

create trigger sync_auto_register_cm_run_item
after insert or update of run_id, status, completed_at, message
on public.auto_register_cm_scheduled_items
for each row execute function public.sync_auto_register_cm_run_item();

alter table public.automation_scheduler_run_items enable row level security;
revoke all on public.automation_scheduler_run_items from public, anon, authenticated;
grant select, insert, update on public.automation_scheduler_run_items to service_role;

create or replace function public.schedule_auto_register_cm_submissions(
  p_actor uuid,
  p_submission_ids text[]
)
returns setof public.auto_register_cm_scheduled_items
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_id text;
  v_submission public.registration_submissions%rowtype;
begin
  if not exists(
    select 1
    from auth.users a
    join public.user_registrations u on lower(u.email) = lower(a.email)
    where a.id = p_actor and u.type = 'ADMIN'
  ) then
    raise exception 'Administrator required';
  end if;

  if p_submission_ids is null
    or cardinality(p_submission_ids) < 1
    or cardinality(p_submission_ids) > 100 then
    raise exception 'Select between 1 and 100 registrations';
  end if;

  if cardinality(p_submission_ids) <> (
    select count(distinct id) from unnest(p_submission_ids) id
  ) then
    raise exception 'Duplicate registrations are not allowed';
  end if;

  foreach v_id in array p_submission_ids loop
    select * into v_submission
    from public.registration_submissions
    where id = v_id
    for update;

    if not found
      or v_submission.registration_type not in ('DRIVER', 'TRAILER', 'VEHICLE')
      or v_submission.status <> 'PENDING'
      or coalesce(v_submission.cargomove_upload->>'state', '') = 'SUCCESS' then
      raise exception 'A selected registration is no longer eligible';
    end if;
  end loop;

  insert into public.auto_register_cm_scheduled_items(
    submission_id,
    registration_type,
    reference_no,
    company_name,
    registration_fingerprint,
    actor
  )
  select
    s.id,
    s.registration_type,
    s.reference_no,
    s.company_name,
    public.auto_register_cm_registration_fingerprint(s.id),
    p_actor
  from public.registration_submissions s
  where s.id = any(p_submission_ids)
    and not exists(
      select 1 from public.auto_register_cm_scheduled_items q
      where q.submission_id = s.id and q.status = 'SCHEDULED'
    )
    and not exists(
      select 1 from public.auto_register_cm_scheduled_items q
      where q.submission_id = s.id
        and q.status = 'FAILED'
        and q.registration_fingerprint = public.auto_register_cm_registration_fingerprint(s.id)
    )
  order by s.submitted_at, s.id
  on conflict (submission_id) where status = 'SCHEDULED' do nothing;

  return query
  select q.*
  from public.auto_register_cm_scheduled_items q
  where q.submission_id = any(p_submission_ids)
    and q.status = 'SCHEDULED'
  order by q.scheduled_at, q.id;
end;
$$;

revoke all on function public.auto_register_cm_registration_fingerprint(text),
  public.sync_auto_register_cm_run_item(),
  public.schedule_auto_register_cm_submissions(uuid, text[])
  from public, anon, authenticated;

grant execute on function public.auto_register_cm_registration_fingerprint(text),
  public.schedule_auto_register_cm_submissions(uuid, text[])
  to service_role;

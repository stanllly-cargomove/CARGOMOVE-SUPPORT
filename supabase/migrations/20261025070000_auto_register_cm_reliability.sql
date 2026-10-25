-- Apply after 20261025060000, before deploying the updated scheduler application.
-- Keep original registration_fingerprint values as audit evidence. Older failures
-- have no dependency snapshot, so baseline their retry guard at upgrade time.

alter table public.automation_schedulers add column discovery_cursor text;
alter table public.auto_register_cm_scheduled_items add column retry_fingerprint text;

create or replace function public.auto_register_cm_registration_fingerprint(p_submission_id text)
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select 'v2:' || md5(jsonb_build_object(
    'submission', jsonb_build_object(
      'data', s.data, 'companyId', s.company_id, 'reference', s.reference_no,
      'type', s.registration_type, 'portId', s.port_id, 'location', s.port_location,
      'depotId', s.depot_id, 'companyRegNo', s.company_reg_no, 'companyName', s.company_name
    ),
    'company', to_jsonb(c) - 'created_at' - 'updated_at',
    -- Port Klang uses BOTH Westport and Northport; Johor may fall back to all
    -- Johor ports. Include the full relevant configuration, excluding timestamps.
    'ports', coalesce((
      select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.id)
      from public.port_configs p
      where p.location = s.port_location
        or (s.port_location = 'PORT_KLANG' and
          (p.code in ('WESTPORT', 'NORTHPORT') or p.id in ('pk-westport', 'pk-northport')))
        or p.id = any(string_to_array(coalesce(nullif(s.port_id, ''), s.data->'company'->>'port_id', ''), ','))
        or p.code = any(string_to_array(coalesce(nullif(s.port_id, ''), s.data->'company'->>'port_id', ''), ','))
        or p.display_name = any(string_to_array(coalesce(nullif(s.port_id, ''), s.data->'company'->>'port_id', ''), ','))
    ), '[]'::jsonb),
    'depot', to_jsonb(d) - 'created_at' - 'updated_at'
  )::text)
  from public.registration_submissions s
  left join public.companies c on c.id = s.company_id
  left join public.depot_configs d on d.id = s.depot_id
  where s.id = p_submission_id;
$$;

update public.auto_register_cm_scheduled_items q
set retry_fingerprint = coalesce(public.auto_register_cm_registration_fingerprint(q.submission_id),
  'missing:' || q.registration_fingerprint);

alter table public.auto_register_cm_scheduled_items alter column retry_fingerprint set not null;

-- Accept legacy FAIL writes during rolling deployment and normalize before any
-- constraints or history triggers run. Existing applications can keep working.
alter table public.auto_register_cm_scheduled_items
  drop constraint auto_register_cm_scheduled_items_status_check;
alter table public.auto_register_cm_scheduled_items
  add constraint auto_register_cm_scheduled_items_status_check
  check (status in ('SCHEDULED', 'SUCCESS', 'FAILED', 'FAIL'));

create function public.prepare_auto_register_cm_queue_item()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.status = 'FAIL' then new.status := 'FAILED'; end if;
  if tg_op = 'INSERT' then
    new.retry_fingerprint := coalesce(new.retry_fingerprint,
      public.auto_register_cm_registration_fingerprint(new.submission_id),
      'missing:' || new.registration_fingerprint);
  elsif new.run_id is not null and new.run_id is distinct from old.run_id then
    -- A record can be corrected between scheduling and execution. Retries must
    -- compare with the inputs of its latest execution, not the original queue time.
    new.retry_fingerprint := coalesce(public.auto_register_cm_registration_fingerprint(new.submission_id),
      new.retry_fingerprint);
  end if;
  return new;
end;
$$;

create trigger prepare_auto_register_cm_queue_item
before insert or update on public.auto_register_cm_scheduled_items
for each row execute function public.prepare_auto_register_cm_queue_item();

create index auto_register_cm_scheduled_items_retry_idx
  on public.auto_register_cm_scheduled_items(submission_id, retry_fingerprint)
  where status = 'FAILED';
create index auto_register_cm_scheduled_items_ready_idx
  on public.auto_register_cm_scheduled_items(scheduled_at, id)
  where status = 'SCHEDULED';
create index registration_submissions_auto_register_scan_idx
  on public.registration_submissions(id)
  where status = 'PENDING' and registration_type in ('DRIVER', 'TRAILER', 'VEHICLE')
    and coalesce(cargomove_upload->>'state', '') <> 'SUCCESS';

-- Stable keyset pagination avoids starving newer records behind an old backlog.
create function public.auto_register_cm_pending_page(
  p_after text default null, p_limit integer default 100, p_candidates_only boolean default false
)
returns setof public.registration_submissions
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.* from public.registration_submissions s
  where s.status = 'PENDING' and s.registration_type in ('DRIVER', 'TRAILER', 'VEHICLE')
    and coalesce(s.cargomove_upload->>'state', '') <> 'SUCCESS'
    and (p_after is null or s.id > p_after)
    and (not p_candidates_only or (
      not exists(select 1 from public.auto_register_cm_scheduled_items q
        where q.submission_id = s.id and q.status = 'SCHEDULED')
      and not exists(select 1 from public.auto_register_cm_scheduled_items q
        where q.submission_id = s.id and q.status = 'FAILED'
          and q.retry_fingerprint = public.auto_register_cm_registration_fingerprint(s.id))
    ))
  order by s.id limit least(100, greatest(1, coalesce(p_limit, 100)));
$$;

create or replace function public.schedule_auto_register_cm_submissions(p_actor uuid, p_submission_ids text[])
returns setof public.auto_register_cm_scheduled_items
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare v_id text; v_submission public.registration_submissions%rowtype;
begin
  if not exists(select 1 from auth.users a join public.user_registrations u on lower(u.email) = lower(a.email)
    where a.id = p_actor and u.type = 'ADMIN') then raise exception 'Administrator required'; end if;
  if p_submission_ids is null or cardinality(p_submission_ids) not between 1 and 100 then
    raise exception 'Select between 1 and 100 registrations';
  end if;
  if cardinality(p_submission_ids) <> (select count(distinct id) from unnest(p_submission_ids) id) then
    raise exception 'Duplicate registrations are not allowed';
  end if;

  -- Use the same lock order as the registration upload workflow.
  perform 1 from public.registration_submissions where id = any(p_submission_ids) order by id for update;
  foreach v_id in array p_submission_ids loop
    select * into v_submission from public.registration_submissions where id = v_id;
    if not found or v_submission.registration_type not in ('DRIVER', 'TRAILER', 'VEHICLE')
      or v_submission.status <> 'PENDING'
      or coalesce(v_submission.cargomove_upload->>'state', '') = 'SUCCESS' then
      raise exception 'A selected registration is no longer eligible';
    end if;
  end loop;

  insert into public.auto_register_cm_scheduled_items(
    submission_id, registration_type, reference_no, company_name, registration_fingerprint, retry_fingerprint, actor
  )
  select s.id, s.registration_type, s.reference_no, s.company_name,
    public.auto_register_cm_registration_fingerprint(s.id), public.auto_register_cm_registration_fingerprint(s.id), p_actor
  from public.registration_submissions s
  where s.id = any(p_submission_ids)
    and not exists(select 1 from public.auto_register_cm_scheduled_items q
      where q.submission_id = s.id and q.status = 'SCHEDULED')
    and not exists(select 1 from public.auto_register_cm_scheduled_items q
      where q.submission_id = s.id and q.status = 'FAILED'
        and q.retry_fingerprint = public.auto_register_cm_registration_fingerprint(s.id))
  order by s.submitted_at, s.id
  on conflict (submission_id) where status = 'SCHEDULED' do nothing;

  return query select q.* from public.auto_register_cm_scheduled_items q
    where q.submission_id = any(p_submission_ids) and q.status = 'SCHEDULED'
    order by q.scheduled_at, q.id;
end;
$$;

revoke all on function public.auto_register_cm_pending_page(text, integer, boolean),
  public.prepare_auto_register_cm_queue_item() from public, anon, authenticated;
grant execute on function public.auto_register_cm_pending_page(text, integer, boolean) to service_role;
-- CREATE OR REPLACE retains the existing service-role-only grants on the other functions.

-- Give a confirmed first failure one automatic attempt in the next two-hour window.
-- Keep each attempt as a separate audit row; never replay uncertain or partial uploads.
alter table public.auto_register_cm_scheduled_items
  add column retry_allowed boolean not null default true;

create or replace function public.auto_register_cm_retry_is_safe(p_submission_id text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_job public.registration_uploads%rowtype;
begin
  select * into v_job from public.registration_uploads
  where submission_id = p_submission_id order by attempt desc limit 1;
  if not found then return true; end if;
  return v_job.state = 'FAILED' and (
    v_job.resolution_note is not null or
    not (coalesce(v_job.success_count, 0) > 0 or
      (v_job.expected_rows > 0 and v_job.success_count is null))
  );
end;
$$;

update public.auto_register_cm_scheduled_items q
set retry_allowed = public.auto_register_cm_retry_is_safe(q.submission_id)
where q.status = 'FAILED';

create function public.auto_register_cm_set_retry_allowed()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.status = 'FAIL' then new.status := 'FAILED'; end if;
  if new.status = 'FAILED' and old.status is distinct from 'FAILED' then
    new.retry_allowed := public.auto_register_cm_retry_is_safe(new.submission_id);
  end if;
  return new;
end;
$$;

create trigger auto_register_cm_set_retry_allowed
before update of status on public.auto_register_cm_scheduled_items
for each row execute function public.auto_register_cm_set_retry_allowed();

create or replace function public.auto_register_cm_pending_page(
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
      and (select count(*) from public.auto_register_cm_scheduled_items q
        where q.submission_id = s.id and q.status = 'FAILED') < 2
      and not exists(select 1 from public.auto_register_cm_scheduled_items q
        where q.submission_id = s.id and q.status = 'FAILED' and not q.retry_allowed)
      and not exists(select 1 from public.auto_register_cm_scheduled_items q
        where q.submission_id = s.id and q.status = 'FAILED'
          and now() < to_timestamp((floor(extract(epoch from q.completed_at) / 7200) + 1) * 7200))
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
    and (select count(*) from public.auto_register_cm_scheduled_items q
      where q.submission_id = s.id and q.status = 'FAILED') < 2
    and not exists(select 1 from public.auto_register_cm_scheduled_items q
      where q.submission_id = s.id and q.status = 'FAILED' and not q.retry_allowed)
    and not exists(select 1 from public.auto_register_cm_scheduled_items q
      where q.submission_id = s.id and q.status = 'FAILED'
        and now() < to_timestamp((floor(extract(epoch from q.completed_at) / 7200) + 1) * 7200))
  order by s.submitted_at, s.id
  on conflict (submission_id) where status = 'SCHEDULED' do nothing;

  return query select q.* from public.auto_register_cm_scheduled_items q
    where q.submission_id = any(p_submission_ids) and q.status = 'SCHEDULED'
    order by q.scheduled_at, q.id;
end;
$$;

revoke all on function public.auto_register_cm_retry_is_safe(text),
  public.auto_register_cm_set_retry_allowed() from public, anon, authenticated;
-- Existing service-role grants on replaced functions are retained.

create table public.auto_register_cm_scheduled_items (
  id uuid primary key default gen_random_uuid(),
  submission_id text not null,
  registration_type text not null check (registration_type in ('DRIVER','TRAILER','VEHICLE')),
  reference_no text not null,
  company_name text not null,
  registration_fingerprint text not null,
  actor uuid not null references auth.users(id),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','SUCCESS','FAIL')),
  scheduled_at timestamptz not null default now(),
  completed_at timestamptz,
  run_id uuid references public.automation_scheduler_runs(id),
  message text not null default 'Queued for the next automatic registration run.',
  created_at timestamptz not null default now()
);

create index auto_register_cm_scheduled_items_history_idx
  on public.auto_register_cm_scheduled_items(scheduled_at desc);
create index auto_register_cm_scheduled_items_queue_idx
  on public.auto_register_cm_scheduled_items(registration_type,scheduled_at)
  where status='SCHEDULED';
create unique index auto_register_cm_scheduled_items_active_idx
  on public.auto_register_cm_scheduled_items(submission_id)
  where status='SCHEDULED';

alter table public.auto_register_cm_scheduled_items enable row level security;
revoke all on public.auto_register_cm_scheduled_items from public,anon,authenticated;
grant select,insert,update on public.auto_register_cm_scheduled_items to service_role;

create function public.schedule_auto_register_cm_submissions(p_actor uuid,p_submission_ids text[])
returns setof public.auto_register_cm_scheduled_items
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_id text; v_submission public.registration_submissions%rowtype;
begin
  if not exists(select 1 from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email)
    where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  if p_submission_ids is null or cardinality(p_submission_ids)<1 or cardinality(p_submission_ids)>100 then
    raise exception 'Select between 1 and 100 registrations';
  end if;
  if cardinality(p_submission_ids)<>(select count(distinct id) from unnest(p_submission_ids) id) then
    raise exception 'Duplicate registrations are not allowed';
  end if;

  foreach v_id in array p_submission_ids loop
    select * into v_submission from public.registration_submissions where id=v_id for update;
    if not found or v_submission.registration_type not in ('DRIVER','TRAILER','VEHICLE')
      or v_submission.status<>'PENDING'
      or coalesce(v_submission.cargomove_upload->>'state','')='SUCCESS' then
      raise exception 'A selected registration is no longer eligible';
    end if;
  end loop;

  insert into public.auto_register_cm_scheduled_items(submission_id,registration_type,reference_no,company_name,registration_fingerprint,actor)
    select s.id,s.registration_type,s.reference_no,s.company_name,
      md5(concat_ws('|',s.data::text,s.company_id,s.reference_no,s.registration_type,s.port_id,
        s.port_location,s.depot_id,s.company_reg_no,s.company_name)),p_actor
    from public.registration_submissions s
    where s.id=any(p_submission_ids)
      and not exists(select 1 from public.auto_register_cm_scheduled_items q
        where q.submission_id=s.id and q.status='SCHEDULED')
      and not exists(select 1 from public.auto_register_cm_scheduled_items q
        where q.submission_id=s.id and q.status='FAIL' and q.registration_fingerprint=
          md5(concat_ws('|',s.data::text,s.company_id,s.reference_no,s.registration_type,s.port_id,
            s.port_location,s.depot_id,s.company_reg_no,s.company_name)))
    order by s.submitted_at,s.id
    on conflict (submission_id) where status='SCHEDULED' do nothing;

  return query select q.* from public.auto_register_cm_scheduled_items q
    where q.submission_id=any(p_submission_ids) and q.status='SCHEDULED'
    order by q.scheduled_at,q.id;
end $$;

revoke all on function public.schedule_auto_register_cm_submissions(uuid,text[])
  from public,anon,authenticated;
grant execute on function public.schedule_auto_register_cm_submissions(uuid,text[])
  to service_role;

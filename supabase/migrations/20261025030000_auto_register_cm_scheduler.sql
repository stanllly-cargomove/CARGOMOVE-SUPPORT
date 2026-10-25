-- Application-owned scheduler configuration and compact execution history.
-- GitHub Actions only calls the Vercel endpoint; all admission and work remain here.
create table public.automation_schedulers (
  scheduler_key text primary key,
  scheduler_name text not null,
  description text not null,
  schedule text not null,
  is_enabled boolean not null default false,
  last_run_at timestamptz,
  last_status text check (last_status in ('SUCCESS','FAILED','SKIPPED')),
  updated_at timestamptz not null default now(),
  check (scheduler_key = 'auto_register_cm')
);

insert into public.automation_schedulers(scheduler_key,scheduler_name,description,schedule)
values ('auto_register_cm','Auto Register in CM','Automatically execute CM registration','Every 2 hours')
on conflict (scheduler_key) do nothing;

create table public.automation_scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  scheduler_key text not null references public.automation_schedulers(scheduler_key),
  execution_type text not null check (execution_type in ('AUTOMATIC','MANUAL')),
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCESS','FAILED','SKIPPED')),
  request_key text unique,
  triggered_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  lease_until timestamptz not null default now() + interval '2 minutes',
  duration_ms integer,
  processed_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  message text not null default '',
  error_message text
);
create index automation_scheduler_runs_history_idx
  on public.automation_scheduler_runs(scheduler_key,started_at desc);

alter table public.automation_schedulers enable row level security;
alter table public.automation_scheduler_runs enable row level security;
revoke all on public.automation_schedulers,public.automation_scheduler_runs from public,anon,authenticated;
grant select,insert,update on public.automation_schedulers,public.automation_scheduler_runs to service_role;

-- Resolve a real administrator for existing registration/scheduler audit foreign keys.
-- This function is service-role-only and is never exposed to the browser.
create function public.auto_register_cm_actor() returns jsonb
language sql stable security definer set search_path=public,auth,pg_temp as $$
  select jsonb_build_object('id',a.id,'email',a.email)
  from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email)
  where u.type='ADMIN' order by a.created_at,a.id limit 1;
$$;

create function public.acquire_automation_scheduler(
  p_scheduler_key text,p_execution_type text,p_actor uuid,p_request_key text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_config public.automation_schedulers%rowtype; v_run public.automation_scheduler_runs%rowtype;
begin
  perform pg_advisory_xact_lock(735169241);
  if p_execution_type not in ('AUTOMATIC','MANUAL') then raise exception 'Invalid execution type'; end if;
  if not exists(select 1 from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email)
    where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select * into v_config from public.automation_schedulers where scheduler_key=p_scheduler_key for update;
  if not found then raise exception 'Scheduler not found'; end if;

  if p_request_key is not null then
    select * into v_run from public.automation_scheduler_runs where request_key=p_request_key;
    if found then return jsonb_build_object('reason','duplicate','id',v_run.id,'status',v_run.status); end if;
  end if;

  update public.automation_scheduler_runs set status='FAILED',finished_at=now(),
    duration_ms=greatest(0,(extract(epoch from now()-started_at)*1000)::integer),
    error_message='Execution lease expired; existing registration upload audits must be reconciled before retry.'
    where scheduler_key=p_scheduler_key and status='RUNNING' and lease_until<now();
  if exists(select 1 from public.automation_scheduler_runs where scheduler_key=p_scheduler_key and status='RUNNING') then
    return jsonb_build_object('reason','running');
  end if;

  if p_execution_type='AUTOMATIC' and not v_config.is_enabled then
    insert into public.automation_scheduler_runs(scheduler_key,execution_type,status,request_key,triggered_by,finished_at,duration_ms,message)
      values(p_scheduler_key,p_execution_type,'SKIPPED',p_request_key,p_actor,now(),0,'Automatic scheduling is disabled.') returning * into v_run;
    update public.automation_schedulers set last_run_at=v_run.started_at,last_status='SKIPPED',updated_at=now()
      where scheduler_key=p_scheduler_key;
    return jsonb_build_object('reason','disabled','id',v_run.id,'status','SKIPPED');
  end if;

  insert into public.automation_scheduler_runs(scheduler_key,execution_type,request_key,triggered_by)
    values(p_scheduler_key,p_execution_type,p_request_key,p_actor) returning * into v_run;
  return jsonb_build_object('id',v_run.id,'status','RUNNING');
end $$;

create function public.finish_automation_scheduler(
  p_id uuid,p_status text,p_processed integer,p_success integer,p_failed integer,p_message text,p_error text default null
) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key text; v_started timestamptz;
begin
  if p_status not in ('SUCCESS','FAILED','SKIPPED') then raise exception 'Invalid status'; end if;
  update public.automation_scheduler_runs set status=p_status,finished_at=now(),
    duration_ms=greatest(0,(extract(epoch from now()-started_at)*1000)::integer),
    processed_count=greatest(0,p_processed),success_count=greatest(0,p_success),failed_count=greatest(0,p_failed),
    message=left(coalesce(p_message,''),500),error_message=case when p_error is null then null else left(p_error,1000) end
    where id=p_id and status='RUNNING' returning scheduler_key,started_at into v_key,v_started;
  if not found then return false; end if;
  update public.automation_schedulers set last_run_at=v_started,last_status=p_status,updated_at=now() where scheduler_key=v_key;
  return true;
end $$;

revoke all on function public.auto_register_cm_actor(),
  public.acquire_automation_scheduler(text,text,uuid,text),
  public.finish_automation_scheduler(uuid,text,integer,integer,integer,text,text)
  from public,anon,authenticated;
grant execute on function public.auto_register_cm_actor(),
  public.acquire_automation_scheduler(text,text,uuid,text),
  public.finish_automation_scheduler(uuid,text,integer,integer,integer,text,text)
  to service_role;

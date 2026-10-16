-- Add a saved, admin-managed allowlist. Existing audit records are preserved.
create table public.cargomove_schedulers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  description text not null default '' check (length(description) <= 500),
  task_id text not null unique check (task_id ~ '^[a-f0-9]{24}$'),
  worker_name text not null unique check (worker_name ~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,119}$'),
  enabled boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.cargomove_schedulers enable row level security;
revoke all on public.cargomove_schedulers from anon, authenticated;
grant select, insert, update on public.cargomove_schedulers to service_role;

insert into public.cargomove_schedulers(id,display_name,description,task_id,worker_name)
values ('00000000-0000-4000-8000-000000000005','Northport Containers',
  'Manually trigger the Northport Containers scheduler on the CargoMove system.',
  '5ff7ea8633904c1dd1bd892b','northport_containers');

alter table public.cargomove_scheduler_runs
  drop constraint cargomove_scheduler_runs_scheduler_check,
  alter column scheduler drop default,
  add column scheduler_id uuid references public.cargomove_schedulers(id),
  add column task_id text;
update public.cargomove_scheduler_runs
  set scheduler_id='00000000-0000-4000-8000-000000000005',task_id='5ff7ea8633904c1dd1bd892b'
  where scheduler='northport_containers';
alter table public.cargomove_scheduler_runs
  alter column scheduler_id set not null,
  alter column task_id set not null,
  add constraint cargomove_scheduler_runs_worker_check check (scheduler ~ '^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,119}$'),
  add constraint cargomove_scheduler_runs_task_check check (task_id ~ '^[a-f0-9]{24}$');
create index cargomove_scheduler_runs_scheduler_idx on public.cargomove_scheduler_runs(scheduler_id,requested_at desc);

create function public.acquire_saved_cargomove_scheduler(p_actor uuid,p_scheduler_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_target public.cargomove_schedulers%rowtype;
begin
  -- Same global lock and cooldown across every saved task, including old callers.
  perform pg_advisory_xact_lock(735169240);
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email)
    where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select * into v_target from public.cargomove_schedulers where id=p_scheduler_id and enabled for share;
  if not found then return jsonb_build_object('reason','unavailable'); end if;
  update public.cargomove_scheduler_runs set status='UNKNOWN',finished_at=now(),
    error_message='Execution lease expired. Check CargoMove before resolving this record.'
    where status='RUNNING' and lease_until<now();
  if exists (select 1 from public.cargomove_scheduler_runs where status='UNKNOWN' and resolution_note is null) then
    return jsonb_build_object('reason','unknown');
  end if;
  if exists (select 1 from public.cargomove_scheduler_runs where status='RUNNING') then
    return jsonb_build_object('reason','running');
  end if;
  if exists (select 1 from public.cargomove_scheduler_runs where requested_at>now()-interval '5 minutes') then
    return jsonb_build_object('reason','cooldown');
  end if;
  insert into public.cargomove_scheduler_runs(triggered_by,scheduler_id,scheduler,task_id)
    values(p_actor,v_target.id,v_target.worker_name,v_target.task_id) returning id into v_id;
  return jsonb_build_object('id',v_id,'scheduler_id',v_target.id,'worker_name',v_target.worker_name,'task_id',v_target.task_id);
end $$;

-- Old deployed clients continue to run Northport using the same admission checks.
create or replace function public.acquire_cargomove_scheduler(p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public.acquire_saved_cargomove_scheduler(p_actor,'00000000-0000-4000-8000-000000000005');
end $$;

revoke all on function public.acquire_saved_cargomove_scheduler(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquire_saved_cargomove_scheduler(uuid,uuid) to service_role;

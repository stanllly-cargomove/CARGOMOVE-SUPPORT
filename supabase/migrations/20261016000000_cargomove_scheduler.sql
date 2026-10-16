-- Service-role-only audit and atomic cross-instance admission control.
create table public.cargomove_scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  scheduler text not null default 'northport_containers' check (scheduler = 'northport_containers'),
  triggered_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  dispatch_at timestamptz,
  finished_at timestamptz,
  lease_until timestamptz not null default now() + interval '3 minutes',
  status text not null default 'RUNNING' check (status in ('RUNNING','TRIGGER_REQUESTED','FAILED','UNKNOWN','COMPLETED')),
  error_message text,
  resolution_note text
);
create index cargomove_scheduler_runs_requested_idx on public.cargomove_scheduler_runs (requested_at desc);
alter table public.cargomove_scheduler_runs enable row level security;
revoke all on public.cargomove_scheduler_runs from anon, authenticated;
grant select, insert, update on public.cargomove_scheduler_runs to service_role;

create function public.acquire_cargomove_scheduler(p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(735169240);
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email)
    where a.id=p_actor and u.type='ADMIN') then
    raise exception 'Administrator required';
  end if;
  update public.cargomove_scheduler_runs set status='UNKNOWN', finished_at=now(),
    error_message='Execution lease expired. Check CargoMove before resolving this record.'
    where status='RUNNING' and lease_until < now();
  if exists (select 1 from public.cargomove_scheduler_runs where status='UNKNOWN' and resolution_note is null) then
    return jsonb_build_object('reason','unknown');
  end if;
  if exists (select 1 from public.cargomove_scheduler_runs where status='RUNNING') then
    return jsonb_build_object('reason','running');
  end if;
  if exists (select 1 from public.cargomove_scheduler_runs where requested_at > now()-interval '5 minutes') then
    return jsonb_build_object('reason','cooldown');
  end if;
  insert into public.cargomove_scheduler_runs(triggered_by) values(p_actor) returning id into v_id;
  return jsonb_build_object('id',v_id);
end $$;

create function public.mark_cargomove_scheduler_dispatch(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.cargomove_scheduler_runs set dispatch_at=now()
    where id=p_id and status='RUNNING' and dispatch_at is null and lease_until>now();
  return found;
end $$;

create function public.finish_cargomove_scheduler(p_id uuid, p_status text, p_message text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('TRIGGER_REQUESTED','FAILED','UNKNOWN') then raise exception 'Invalid status'; end if;
  update public.cargomove_scheduler_runs set status=p_status, finished_at=now(),
    error_message=case when p_status='TRIGGER_REQUESTED' then null else left(p_message,500) end
    where id=p_id and status='RUNNING';
  return found;
end $$;

revoke all on function public.acquire_cargomove_scheduler(uuid) from public, anon, authenticated;
revoke all on function public.mark_cargomove_scheduler_dispatch(uuid) from public, anon, authenticated;
revoke all on function public.finish_cargomove_scheduler(uuid,text,text) from public, anon, authenticated;
grant execute on function public.acquire_cargomove_scheduler(uuid) to service_role;
grant execute on function public.mark_cargomove_scheduler_dispatch(uuid) to service_role;
grant execute on function public.finish_cargomove_scheduler(uuid,text,text) to service_role;

-- One lease for every automated browser using the shared CargoMove credentials.
create table if not exists public.cargomove_account_session (
  singleton boolean primary key default true check (singleton),
  holder uuid not null,
  lease_until timestamptz not null
);
alter table public.cargomove_account_session enable row level security;
revoke all on public.cargomove_account_session from public,anon,authenticated,service_role;

create or replace function public.acquire_cargomove_account_session() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(735169242);
  if exists (select 1 from public.cargomove_account_session where lease_until>now()) then
    return jsonb_build_object('reason','busy');
  end if;
  insert into public.cargomove_account_session(singleton,holder,lease_until)
    values(true,v_id,now()+interval '3 minutes')
    on conflict (singleton) do update set holder=excluded.holder,lease_until=excluded.lease_until;
  return jsonb_build_object('id',v_id);
end $$;

create or replace function public.release_cargomove_account_session(p_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from public.cargomove_account_session where holder=p_id;
  return found;
end $$;

-- Retry only the scheduler for uploaded recoveries whose previous request
-- provably stopped before dispatch. Never reclaim a sent or uncertain request.
create or replace function public.northport_claim_scheduler(p_id uuid,p_actor uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_recovery public.northport_recoveries;
begin
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select * into v_recovery from public.northport_recoveries where id=p_id for update;
  if not found or v_recovery.status not in ('Uploaded','Verification Unavailable') then return false; end if;
  if v_recovery.scheduler_status is not null and v_recovery.scheduler_status <> 'not_sent'
    and not (v_recovery.scheduler_status='failed' and exists (
      select 1 from public.cargomove_scheduler_runs where id=v_recovery.scheduler_run_id and status='FAILED' and dispatch_at is null
    )) then return false; end if;
  update public.northport_recoveries set scheduler_status='Dispatching' where id=p_id;
  return true;
end $$;

revoke all on function public.acquire_cargomove_account_session(),public.release_cargomove_account_session(uuid),public.northport_claim_scheduler(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquire_cargomove_account_session(),public.release_cargomove_account_session(uuid),public.northport_claim_scheduler(uuid,uuid) to service_role;
notify pgrst, 'reload schema';

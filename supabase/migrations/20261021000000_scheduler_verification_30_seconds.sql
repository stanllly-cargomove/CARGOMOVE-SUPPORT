-- Retain read-only CargoMove Last run observations and shorten shared admission.
alter table public.cargomove_scheduler_runs
  add column if not exists last_run_verification jsonb;

create or replace function public.acquire_saved_cargomove_scheduler(p_actor uuid,p_scheduler_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_target public.cargomove_schedulers%rowtype;
begin
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
  if exists (select 1 from public.cargomove_scheduler_runs where requested_at>now()-interval '30 seconds') then
    return jsonb_build_object('reason','cooldown','cooldown_seconds',30);
  end if;
  insert into public.cargomove_scheduler_runs(triggered_by,scheduler_id,scheduler,task_id)
    values(p_actor,v_target.id,v_target.worker_name,v_target.task_id) returning id into v_id;
  return jsonb_build_object('id',v_id,'scheduler_id',v_target.id,'worker_name',v_target.worker_name,'task_id',v_target.task_id);
end $$;

revoke all on function public.acquire_saved_cargomove_scheduler(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquire_saved_cargomove_scheduler(uuid,uuid) to service_role;

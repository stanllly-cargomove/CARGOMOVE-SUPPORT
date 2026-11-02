-- Remove failed entries from the history list while retaining audit evidence
-- and all existing upload, source and scheduler admission protections.
alter table public.northport_recoveries add column if not exists removed_at timestamptz;
alter table public.northport_recoveries add column if not exists removed_by uuid references auth.users(id);

create or replace function public.northport_remove_failed_history(p_actor uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_recovery public.northport_recoveries; v_run public.cargomove_scheduler_runs; v_failed boolean;
begin
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select * into v_recovery from public.northport_recoveries where id=p_id for update;
  if not found then return jsonb_build_object('reason','unavailable'); end if;
  if v_recovery.removed_at is not null then return jsonb_build_object('removed',true); end if;
  if v_recovery.status='Uploading' or v_recovery.scheduler_status='Dispatching' then return jsonb_build_object('reason','active'); end if;
  select * into v_run from public.cargomove_scheduler_runs where id=v_recovery.scheduler_run_id for share;
  if v_run.status='RUNNING' then return jsonb_build_object('reason','active'); end if;
  v_failed := case
    when v_recovery.status in ('Approved','Cancelled') then false
    when v_recovery.manual_review is not null then v_recovery.manual_review->>'outcome'='FAIL'
    when v_recovery.container_type='GP' and v_recovery.gp_verification->>'status'='VERIFIED' then false
    when v_recovery.container_type='GP' and v_recovery.gp_verification->>'status'='NOT_FOUND' then true
    when v_recovery.container_type='EX' and (v_run.last_run_verification->>'status'='ADVANCED'
      or (v_run.last_run_verification is null and v_recovery.processing_result='Scheduler run observed — container import not verified')) then false
    when v_recovery.status='Failed' or v_recovery.scheduler_status='failed' then true
    when v_recovery.status in ('Uploaded','Verification Unavailable') and v_recovery.scheduler_status='not_sent' then true
    when v_recovery.container_type='EX' and ((v_run.last_run_verification->>'status')<>'ADVANCED'
      or (v_run.last_run_verification is null and v_recovery.scheduler_status='trigger_requested')) then true
    else false end;
  if not coalesce(v_failed,false) then return jsonb_build_object('reason','not_failed'); end if;
  update public.northport_recoveries set removed_at=now(),removed_by=p_actor where id=p_id;
  return jsonb_build_object('removed',true);
end $$;
revoke all on function public.northport_remove_failed_history(uuid,uuid) from public,anon,authenticated;
grant execute on function public.northport_remove_failed_history(uuid,uuid) to service_role;
notify pgrst, 'reload schema';

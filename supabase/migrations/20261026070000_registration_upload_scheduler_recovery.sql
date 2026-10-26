-- A failed scheduler login is not an uncertain Excel upload. Recovery requires
-- both the current upload lease and a persisted FAILED scheduler with no dispatch.
-- The application additionally verifies the exact file is still not_processed.
create function public.recover_registration_upload_scheduler_failure(p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.registration_uploads%rowtype; v_submission text;
begin
  select submission_id into v_submission from public.registration_uploads where id=p_id;
  perform 1 from public.registration_submissions where id=v_submission for update;
  select * into v_job from public.registration_uploads where id=p_id for update;
  if not found or p_token is null or v_job.lease_token is distinct from p_token
    or v_job.lease_until is null or v_job.lease_until<=now() then raise exception 'Upload lease expired'; end if;
  if v_job.state<>'UNKNOWN' or v_job.upload_id is null or v_job.scheduler_run_id is null then return null; end if;
  if not exists(select 1 from public.cargomove_scheduler_runs r where r.id=v_job.scheduler_run_id
    and r.scheduler_id=v_job.scheduler_id and r.status='FAILED' and r.dispatch_at is null) then return null; end if;
  if exists(select 1 from public.registration_uploads u
    where coalesce(u.batch_id,u.id)=coalesce(v_job.batch_id,v_job.id)
      and (u.state<>'UNKNOWN' or u.lease_token is distinct from p_token)) then return null; end if;
  update public.registration_uploads u set state='UPLOADED',updated_at=now(),
    message='File uploaded. The previous processing scheduler failed before dispatch; the existing file can resume.'
  where coalesce(u.batch_id,u.id)=coalesce(v_job.batch_id,v_job.id);
  select * into v_job from public.registration_uploads where id=p_id;
  return to_jsonb(v_job);
end $$;
revoke all on function public.recover_registration_upload_scheduler_failure(uuid,uuid) from public,anon,authenticated;
grant execute on function public.recover_registration_upload_scheduler_failure(uuid,uuid) to service_role;

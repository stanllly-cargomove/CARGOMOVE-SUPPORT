-- Cancelled attempts retain their audit while allowing a later recovery.
alter table public.northport_recoveries drop constraint if exists northport_recoveries_status_check;
alter table public.northport_recoveries add constraint northport_recoveries_status_check
  check (status in ('Approved','Uploading','Uploaded','Scheduler Triggered','Processing','Import Verified','Failed','Verification Unavailable','Cancelled'));
alter table public.northport_recoveries drop constraint if exists northport_recoveries_source_key_key;
drop index if exists public.northport_recovery_container_once;
create unique index if not exists northport_recovery_source_once on public.northport_recoveries(source_key) where status <> 'Cancelled';
create unique index northport_recovery_container_once on public.northport_recoveries(container) where status <> 'Cancelled';

create or replace function public.northport_cancel_approved(p_actor uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(735169241);
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  update public.northport_recoveries set status='Cancelled',processing_result='Cancelled before FTP upload.'
    where id=p_id and actor=p_actor and status='Approved' and recovery_filename is null;
  return found;
end $$;

create or replace function public.northport_record_cancelled(p_actor uuid,p_email text,p_container text,p_type text,p_source text,p_record integer,p_source_key text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(735169241);
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  insert into public.northport_recoveries(actor,submitted_by,container,container_type,source_filename,source_record,source_key,approved_hash,status,processing_result)
    values(p_actor,p_email,p_container,p_type,p_source,p_record,p_source_key,'','Cancelled','Cancelled before FTP upload.') returning id into v_id;
  return jsonb_build_object('id',v_id,'status','Cancelled');
end $$;
revoke all on function public.northport_cancel_approved(uuid,uuid),public.northport_record_cancelled(uuid,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.northport_cancel_approved(uuid,uuid),public.northport_record_cancelled(uuid,text,text,text,text,integer,text) to service_role;
notify pgrst, 'reload schema';

-- Whole-source recovery uses an explicit new claim function so an older
-- deployment cannot silently allocate a legacy timestamp filename.
create function public.northport_claim_file_upload(p_actor uuid,p_id uuid,p_hash text,p_source_key text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.northport_recoveries;
begin
  perform pg_advisory_xact_lock(735169241);
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select * into result from public.northport_recoveries where id=p_id and actor=p_actor and status='Approved' and approved_hash=p_hash and source_key=p_source_key for update;
  if not found then return null; end if;
  if result.container !~ '^[A-Z0-9]{1,32}$' then raise exception 'Invalid recovery container'; end if;
  update public.northport_recoveries set status='Uploading',recovery_filename='REPROCESS_' || container || '.csv' where id=p_id returning * into result;
  return jsonb_build_object('recovery_filename',result.recovery_filename);
end $$;
revoke all on function public.northport_claim_file_upload(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.northport_claim_file_upload(uuid,uuid,text,text) to service_role;

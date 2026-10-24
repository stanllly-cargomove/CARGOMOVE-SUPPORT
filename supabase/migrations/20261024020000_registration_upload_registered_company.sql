-- Require explicit Company registration approval before uploading assets or dispatching processing.
-- This is a separate migration so already-installed upload workflows receive the same guard.
-- A manual rerun may encounter this function from a previous attempt or the
-- newer Company Master migration. Preserve existing approval logic in either case.
do $migration$
begin
  if to_regprocedure('public.registration_upload_company_block_reason(text)') is null then
    execute $definition$
create function public.registration_upload_company_block_reason(p_company_id text) returns text
language plpgsql stable security definer set search_path=public,pg_temp as $function$
declare v_registration_status text;
begin
  perform 1 from public.companies where id=p_company_id;
  if not found then
    return 'Register the parent company before processing its drivers, trailers or vehicles. Company registration must be Done/Registered.';
  end if;
  select status into v_registration_status from public.registration_submissions
    where company_id=p_company_id and registration_type='COMPANY'
    order by submitted_at desc nulls last,id desc limit 1;
  if v_registration_status is distinct from 'DONE' then
    return 'Register the parent company before processing its drivers, trailers or vehicles. Company registration must be Done/Registered.';
  end if;
  return null;
end $function$;
    $definition$;
  end if;
end $migration$;

create or replace function public.guard_registration_upload_company() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company_id text; v_reason text;
begin
  if new.state not in ('PREPARING','UPLOADING','DISPATCHING') then return new; end if;
  select company_id into v_company_id from public.registration_submissions where id=new.submission_id;
  v_reason=public.registration_upload_company_block_reason(v_company_id);
  if v_reason is not null then raise exception using message=v_reason,errcode='23514'; end if;
  return new;
end $$;
drop trigger if exists guard_registration_upload_company on public.registration_uploads;
create trigger guard_registration_upload_company before insert or update of state on public.registration_uploads
for each row execute function public.guard_registration_upload_company();

revoke all on function public.registration_upload_company_block_reason(text),public.guard_registration_upload_company() from public,anon,authenticated;
grant execute on function public.registration_upload_company_block_reason(text) to service_role;

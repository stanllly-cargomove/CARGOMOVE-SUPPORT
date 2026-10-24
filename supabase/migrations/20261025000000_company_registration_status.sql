-- Initialize the registration field once; later runs repair functions/triggers only.
-- An existing column may be from an earlier or partial manual run. Never repeat
-- the approval conversion in that case: new Pending requests must stay Pending.
do $migration$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='companies' and column_name='registration_status'
  ) then
    alter table public.companies add column registration_status text not null default 'PENDING'
      check (registration_status in ('PENDING','DONE','REJECTED'));

    -- One-time operator-requested conversion of existing companies only.
    -- Leave asset/user requests Pending and preserve every Rejected Company request.
    update public.registration_submissions set status='DONE'
      where registration_type='COMPANY' and status='PENDING';
    update public.companies set registration_status='DONE',updated_at=now();
    update public.companies c set registration_status=q.status,updated_at=now()
    from (select distinct on (company_id) company_id,status from public.registration_submissions
      where registration_type='COMPANY' and company_id is not null
      order by company_id,submitted_at desc nulls last,id desc) q where c.id=q.company_id;

  end if;
end $migration$;

-- Schema repair can restore the future-row default without changing existing approvals.
alter table public.companies alter column registration_status set default 'PENDING';

-- A cached master edit cannot approve a company whose queue registration is still Pending/Rejected.
create or replace function public.guard_company_registration_status() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;
begin
  select status into v_status from public.registration_submissions
    where registration_type='COMPANY' and company_id=new.id
    order by submitted_at desc nulls last,id desc limit 1;
  if found then new.registration_status=v_status; end if;
  return new;
end $$;
drop trigger if exists guard_company_registration_status on public.companies;
create trigger guard_company_registration_status before insert or update on public.companies
for each row execute function public.guard_company_registration_status();

create or replace function public.refresh_company_registration_status(p_company_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;
begin
  if p_company_id is null then return; end if;
  select status into v_status from public.registration_submissions
    where registration_type='COMPANY' and company_id=p_company_id
    order by submitted_at desc nulls last,id desc limit 1;
  update public.companies set registration_status=coalesce(v_status,'PENDING'),updated_at=now() where id=p_company_id;
end $$;

create or replace function public.sync_company_registration_status() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op<>'INSERT' and old.registration_type='COMPANY' then
    perform public.refresh_company_registration_status(old.company_id);
  end if;
  if tg_op<>'DELETE' and new.registration_type='COMPANY' then
    perform public.refresh_company_registration_status(new.company_id);
  end if;
  return null;
end $$;
drop trigger if exists sync_company_registration_status on public.registration_submissions;
create trigger sync_company_registration_status after insert or update or delete on public.registration_submissions
for each row execute function public.sync_company_registration_status();

create or replace function public.registration_upload_company_block_reason(p_company_id text) returns text
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_registration_status text; v_queue_status text;
begin
  select registration_status into v_registration_status from public.companies where id=p_company_id;
  if not found then
    return 'Register the parent company before processing its drivers, trailers or vehicles. Company registration status must be Registered.';
  end if;
  select status into v_queue_status from public.registration_submissions
    where company_id=p_company_id and registration_type='COMPANY'
    order by submitted_at desc nulls last,id desc limit 1;
  if coalesce(v_queue_status,v_registration_status) is distinct from 'DONE' then
    return 'Register the parent company before processing its drivers, trailers or vehicles. Company registration status must be Registered.';
  end if;
  return null;
end $$;

-- Protect manual Register actions and generic admin upserts as well as automated uploads.
create or replace function public.guard_asset_company_registration() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_reason text;
begin
  if new.registration_type in ('DRIVER','TRAILER','VEHICLE') and new.status='DONE' and
    (tg_op='INSERT' or old.status is distinct from 'DONE' or old.company_id is distinct from new.company_id
      or old.registration_type is distinct from new.registration_type) then
    v_reason=public.registration_upload_company_block_reason(new.company_id);
    if v_reason is not null then raise exception using message=v_reason,errcode='23514'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_asset_company_registration on public.registration_submissions;
create trigger guard_asset_company_registration before insert or update on public.registration_submissions
for each row execute function public.guard_asset_company_registration();

-- No CASCADE: unexpected database dependencies must be reviewed rather than removed.
alter table public.companies drop column if exists status;

revoke all on function public.guard_company_registration_status(),public.refresh_company_registration_status(text),public.sync_company_registration_status(),public.guard_asset_company_registration() from public,anon,authenticated;
-- CREATE OR REPLACE preserves the existing service-only permission on the blocker.

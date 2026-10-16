-- Metadata only: CSV contents and field values never enter Supabase.
create table public.northport_recoveries (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null references auth.users(id),
  submitted_by text not null,
  container text not null,
  container_type text not null check (container_type in ('GP','EX')),
  source_filename text not null check (source_filename ~* '^CM_CONTAINER_[0-9]{14}_(GP|EX)\.csv$'),
  source_record integer not null check (source_record > 0),
  source_key text not null unique,
  approved_hash text not null,
  recovery_filename text unique,
  changed_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  approved_at timestamptz not null default now(),
  status text not null default 'Approved' check (status in ('Approved','Uploading','Uploaded','Scheduler Triggered','Processing','Import Verified','Failed','Verification Unavailable')),
  scheduler_status text,
  scheduler_run_id uuid references public.cargomove_scheduler_runs(id),
  processing_result text
);
-- Deliberately conservative: only an operator-reviewed database resolution may release a container.
create unique index northport_recovery_container_once on public.northport_recoveries(container);
create index northport_recovery_history on public.northport_recoveries(created_at desc);
create table public.northport_request_limits (actor uuid primary key references auth.users(id), requested_at timestamptz not null);
create sequence public.northport_filename_seconds;
alter table public.northport_recoveries enable row level security;
alter table public.northport_request_limits enable row level security;
revoke all on public.northport_recoveries,public.northport_request_limits from public,anon,authenticated;
grant select,insert,update on public.northport_recoveries,public.northport_request_limits to service_role;

create function public.northport_admit_request(p_actor uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  insert into public.northport_request_limits values(p_actor,now())
    on conflict(actor) do update set requested_at=now() where northport_request_limits.requested_at < now()-interval '5 seconds';
  return found;
end $$;

create function public.northport_approve(p_actor uuid,p_email text,p_container text,p_type text,p_source text,p_record integer,p_source_key text,p_hash text,p_changed text[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.northport_recoveries;
begin
  perform pg_advisory_xact_lock(735169241);
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select * into result from public.northport_recoveries where source_key=p_source_key and actor=p_actor and approved_hash=p_hash and container=p_container and status='Approved';
  if found then return jsonb_build_object('id',result.id,'status',result.status); end if;
  insert into public.northport_recoveries(actor,submitted_by,container,container_type,source_filename,source_record,source_key,approved_hash,changed_fields)
    values(p_actor,p_email,p_container,p_type,p_source,p_record,p_source_key,p_hash,p_changed) returning * into result;
  return jsonb_build_object('id',result.id,'status',result.status);
end $$;

create function public.northport_claim_upload(p_actor uuid,p_id uuid,p_hash text,p_source_key text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.northport_recoveries; allocated bigint; current_second bigint;
begin
  perform pg_advisory_xact_lock(735169241);
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select * into result from public.northport_recoveries where id=p_id and actor=p_actor and status='Approved' and approved_hash=p_hash and source_key=p_source_key for update;
  if not found then return null; end if;
  current_second := floor(extract(epoch from clock_timestamp()));
  allocated := nextval('public.northport_filename_seconds');
  if allocated < current_second then allocated:=current_second; perform setval('public.northport_filename_seconds',allocated); end if;
  update public.northport_recoveries set status='Uploading',recovery_filename='CM_CONTAINER_' || to_char(to_timestamp(allocated) at time zone 'Asia/Kuala_Lumpur','YYYYMMDDHH24MISS') || '_' || container_type || '.csv' where id=p_id returning * into result;
  return jsonb_build_object('recovery_filename',result.recovery_filename);
end $$;

create function public.northport_claim_scheduler(p_id uuid,p_actor uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists (select 1 from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  update public.northport_recoveries set scheduler_status='Dispatching' where id=p_id and status='Uploaded' and scheduler_status is null;
  return found;
end $$;
revoke all on function public.northport_admit_request(uuid),public.northport_approve(uuid,text,text,text,text,integer,text,text,text[]),public.northport_claim_upload(uuid,uuid,text,text),public.northport_claim_scheduler(uuid,uuid) from public,anon,authenticated;
grant execute on function public.northport_admit_request(uuid),public.northport_approve(uuid,text,text,text,text,integer,text,text,text[]),public.northport_claim_upload(uuid,uuid,text,text),public.northport_claim_scheduler(uuid,uuid) to service_role;

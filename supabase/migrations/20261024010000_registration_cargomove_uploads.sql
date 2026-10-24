-- Registration uploads use the main application database, never Auto Mail.
create table public.registration_upload_settings (
  purpose text primary key check (purpose = 'registration_excel'),
  scheduler_id uuid not null references public.cargomove_schedulers(id)
);
alter table public.registration_upload_settings enable row level security;
revoke all on public.registration_upload_settings from public, anon, authenticated;
grant select, insert, update on public.registration_upload_settings to service_role;
-- Resolve the existing gallery entry once by its external worker, not its editable title.
insert into public.registration_upload_settings(purpose,scheduler_id)
select 'registration_excel',id from public.cargomove_schedulers where worker_name='process_file_uploads';

alter table public.registration_submissions add column cargomove_upload jsonb;
create table public.registration_uploads (
  id uuid primary key default gen_random_uuid(),
  attempt bigint generated always as identity,
  submission_id text not null references public.registration_submissions(id) on delete cascade,
  reference_no text not null,
  entity text not null check (entity in ('vehicle','trailer','driver')),
  scheduler_id uuid not null references public.cargomove_schedulers(id),
  actor uuid not null references auth.users(id),
  state text not null default 'PREPARING' check (state in ('PREPARING','UPLOADING','UPLOADED','DISPATCHING','PROCESSING','SUCCESS','FAILED','UNKNOWN')),
  filename text not null,
  expected_rows integer not null default 0 check (expected_rows >= 0),
  upload_id text,
  scheduler_run_id uuid references public.cargomove_scheduler_runs(id),
  message text not null default 'Preparing Excel for CargoMove.',
  success_count integer,
  error_count integer,
  resolution_note text,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (filename)
);
create index registration_uploads_submission_idx on public.registration_uploads(submission_id,attempt desc);
create unique index registration_uploads_one_active_idx on public.registration_uploads(submission_id)
  where state not in ('SUCCESS','FAILED');
alter table public.registration_uploads enable row level security;
revoke all on public.registration_uploads from public,anon,authenticated;
grant select on public.registration_uploads to service_role;

create function public.registration_upload_summary(p_job public.registration_uploads) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_job.id,'state',p_job.state,'filename',p_job.filename,
    'message',p_job.message,'successCount',p_job.success_count,'errorCount',p_job.error_count,
    'expectedRows',p_job.expected_rows,'updatedAt',p_job.updated_at);
$$;

-- Keep the public queue summary authoritative even when an old browser upserts a cached row.
create function public.guard_registration_upload() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.registration_uploads%rowtype;
begin
  select * into v_job from public.registration_uploads where submission_id=old.id order by attempt desc limit 1;
  if tg_op='DELETE' then
    if found and v_job.state not in ('SUCCESS','FAILED') then raise exception 'Verify the active CargoMove upload before deleting this registration'; end if;
    return old;
  end if;
  if v_job.id is null then new.cargomove_upload=null; return new; end if;
  if v_job.state not in ('SUCCESS','FAILED') and
    (new.data is distinct from old.data or new.company_id is distinct from old.company_id or
     new.reference_no is distinct from old.reference_no or new.registration_type is distinct from old.registration_type or
     new.port_id is distinct from old.port_id or new.port_location is distinct from old.port_location) then
    raise exception 'Verify the active CargoMove upload before editing this registration';
  end if;
  new.cargomove_upload=public.registration_upload_summary(v_job);
  if v_job.state<>'SUCCESS' then
    if new.status='DONE' or v_job.state not in ('FAILED') then new.status='PENDING'; end if;
    new.exported_at=null; new.export_filename=null;
  end if;
  return new;
end $$;
create trigger guard_registration_upload before update or delete on public.registration_submissions
for each row execute function public.guard_registration_upload();

create function public.sync_registration_upload() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.registration_submissions set cargomove_upload=public.registration_upload_summary(new),
    status=case when new.state='SUCCESS' then 'DONE' else 'PENDING' end,
    exported_at=case when new.state='SUCCESS' then new.updated_at else null end,
    export_filename=case when new.state='SUCCESS' then new.filename else null end,
    rejection_reason=null,rejection_detail=null
  where id=new.submission_id;
  return new;
end $$;
create trigger sync_registration_upload after insert or update on public.registration_uploads
for each row execute function public.sync_registration_upload();

create function public.begin_registration_upload(p_actor uuid,p_submission_id text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sub public.registration_submissions%rowtype; v_job public.registration_uploads%rowtype;
  v_scheduler uuid; v_id uuid=gen_random_uuid(); v_token uuid=gen_random_uuid();
begin
  if not exists(select 1 from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email)
    where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select * into v_sub from public.registration_submissions where id=p_submission_id for update;
  if not found then raise exception 'Registration not found'; end if;
  if v_sub.registration_type not in ('VEHICLE','TRAILER','DRIVER') or v_sub.status='REJECTED' then raise exception 'Select a pending asset registration'; end if;
  select * into v_job from public.registration_uploads where submission_id=p_submission_id order by attempt desc limit 1;
  if found and v_job.state='SUCCESS' and v_sub.status='PENDING' then
    raise exception 'This registration was already processed. Review its existing CargoMove result before another upload';
  end if;
  if found and (v_job.state<>'FAILED' or v_job.resolution_note is null and
    (coalesce(v_job.success_count,0)>0 or v_job.expected_rows>0 and v_job.success_count is null)) then
    return jsonb_build_object('job',to_jsonb(v_job),'existing',true);
  end if;
  if v_sub.status<>'PENDING' then raise exception 'Only pending registrations can be uploaded'; end if;
  select s.id into v_scheduler from public.registration_upload_settings c join public.cargomove_schedulers s on s.id=c.scheduler_id
    where c.purpose='registration_excel' and s.enabled and s.worker_name='process_file_uploads';
  if v_scheduler is null then raise exception 'Configure the saved file-upload processing scheduler'; end if;
  if v_sub.reference_no !~ '^[A-Za-z0-9_-]{1,80}$' then raise exception 'Invalid registration reference'; end if;
  insert into public.registration_uploads(id,submission_id,reference_no,entity,scheduler_id,actor,filename,lease_token,lease_until)
    values(v_id,v_sub.id,v_sub.reference_no,lower(v_sub.registration_type),v_scheduler,p_actor,
      v_sub.reference_no||'_'||v_sub.registration_type||'_'||v_id::text||'.xlsx',v_token,now()+interval '110 seconds') returning * into v_job;
  return jsonb_build_object('job',to_jsonb(v_job),'submission',to_jsonb(v_sub),'token',v_token,'existing',false);
end $$;

create function public.claim_registration_upload(p_actor uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.registration_uploads%rowtype; v_token uuid=gen_random_uuid(); v_submission text;
begin
  if not exists(select 1 from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email)
    where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select submission_id into v_submission from public.registration_uploads where id=p_id;
  -- Consistent lock order with begin: submission, then job.
  perform 1 from public.registration_submissions where id=v_submission for update;
  select * into v_job from public.registration_uploads where id=p_id for update;
  if not found then raise exception 'Upload not found'; end if;
  if v_job.state in ('SUCCESS','FAILED') then return jsonb_build_object('job',to_jsonb(v_job)); end if;
  if v_job.lease_until>now() then return jsonb_build_object('job',to_jsonb(v_job),'busy',true); end if;
  if v_job.state in ('PREPARING','UPLOADING','DISPATCHING') then
    update public.registration_uploads set state=case when state='PREPARING' then 'FAILED' else 'UNKNOWN' end,
      message=case when state='PREPARING' then 'Excel preparation was interrupted. No file was uploaded.'
        else 'CargoMove upload or processing could not be confirmed. Check the existing file before retrying.' end,
      updated_at=now() where id=p_id returning * into v_job;
  end if;
  if v_job.state='FAILED' then return jsonb_build_object('job',to_jsonb(v_job)); end if;
  update public.registration_uploads set lease_token=v_token,lease_until=now()+interval '110 seconds' where id=p_id returning * into v_job;
  return jsonb_build_object('job',to_jsonb(v_job),'token',v_token);
end $$;

create function public.transition_registration_upload(p_id uuid,p_token uuid,p_state text,p_message text,
  p_expected_rows integer default null,p_upload_id text default null,p_scheduler_run_id uuid default null,
  p_success_count integer default null,p_error_count integer default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.registration_uploads%rowtype; v_submission text;
begin
  select submission_id into v_submission from public.registration_uploads where id=p_id;
  perform 1 from public.registration_submissions where id=v_submission for update;
  select * into v_job from public.registration_uploads where id=p_id for update;
  if not found or v_job.lease_token is distinct from p_token or v_job.lease_until<=now() then raise exception 'Upload lease expired'; end if;
  if v_job.state in ('SUCCESS','FAILED') then raise exception 'Upload already finished'; end if;
  if not (
    (v_job.state='PREPARING' and p_state in ('UPLOADING','FAILED')) or
    (v_job.state='UPLOADING' and p_state in ('UPLOADED','FAILED','UNKNOWN')) or
    (v_job.state='UPLOADED' and p_state in ('UPLOADED','DISPATCHING','SUCCESS','FAILED','UNKNOWN')) or
    (v_job.state='DISPATCHING' and p_state in ('UPLOADED','PROCESSING','UNKNOWN','FAILED')) or
    (v_job.state in ('PROCESSING','UNKNOWN') and p_state in ('PROCESSING','UNKNOWN','SUCCESS','FAILED'))
  ) then raise exception 'Invalid upload transition'; end if;
  if p_state='SUCCESS' and (p_success_count is distinct from v_job.expected_rows or p_error_count is distinct from 0 or v_job.expected_rows<1) then
    raise exception 'Full processing counts required'; end if;
  update public.registration_uploads set state=p_state,message=left(p_message,500),
    expected_rows=coalesce(p_expected_rows,expected_rows),upload_id=coalesce(p_upload_id,upload_id),
    scheduler_run_id=coalesce(p_scheduler_run_id,scheduler_run_id),success_count=coalesce(p_success_count,success_count),
    error_count=coalesce(p_error_count,error_count),updated_at=now(),
    lease_token=case when p_state in ('UPLOADING','DISPATCHING') then lease_token else null end,
    lease_until=case when p_state in ('UPLOADING','DISPATCHING') then lease_until else null end
  where id=p_id returning * into v_job;
  return to_jsonb(v_job);
end $$;

revoke all on function public.registration_upload_summary(public.registration_uploads),public.guard_registration_upload(),public.sync_registration_upload(),
  public.begin_registration_upload(uuid,text),public.claim_registration_upload(uuid,uuid),
  public.transition_registration_upload(uuid,uuid,text,text,integer,text,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.begin_registration_upload(uuid,text),public.claim_registration_upload(uuid,uuid),
  public.transition_registration_upload(uuid,uuid,text,text,integer,text,uuid,integer,integer) to service_role;

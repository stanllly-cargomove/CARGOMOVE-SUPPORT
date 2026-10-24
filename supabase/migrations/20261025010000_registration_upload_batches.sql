-- Group physical uploads while retaining one durable audit per registration reference.
alter table public.registration_uploads add column if not exists batch_id uuid;
alter table public.registration_uploads add column if not exists existing_upload_ids text[] not null default '{}';
alter table public.registration_uploads add column if not exists upload_started_at timestamptz;
alter table public.registration_uploads drop constraint if exists registration_uploads_filename_key;
create index if not exists registration_uploads_batch_idx on public.registration_uploads(batch_id);

create or replace function public.registration_upload_summary(p_job public.registration_uploads) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',coalesce(p_job.batch_id,p_job.id),'state',p_job.state,'filename',p_job.filename,
    'message',p_job.message,'successCount',p_job.success_count,'errorCount',p_job.error_count,
    'expectedRows',p_job.expected_rows,'updatedAt',p_job.updated_at);
$$;

-- Verified processing stays Pending until the acceptance email has been sent.
create or replace function public.sync_registration_upload() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.registration_submissions set cargomove_upload=public.registration_upload_summary(new),
    status=case when status='REJECTED' or new.state='SUCCESS' then status else 'PENDING' end,
    exported_at=case when new.state='SUCCESS' then new.updated_at else null end,
    export_filename=case when new.state='SUCCESS' then new.filename else null end
  where id=new.submission_id;
  return new;
end $$;
update public.registration_uploads set batch_id=id where batch_id is null;

-- A rejection cannot cancel a physical file that is already being processed.
create or replace function public.guard_registration_upload_rejection() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='REJECTED' and old.status is distinct from 'REJECTED' and exists
    (select 1 from public.registration_uploads where submission_id=new.id and state not in ('SUCCESS','FAILED')) then
    raise exception 'Check the existing CargoMove upload before rejecting this registration';
  end if;
  return new;
end $$;
drop trigger if exists aa_guard_registration_upload_rejection on public.registration_submissions;
create trigger aa_guard_registration_upload_rejection before update on public.registration_submissions
for each row execute function public.guard_registration_upload_rejection();

-- Called by the email server only after Gmail acknowledges delivery submission.
create or replace function public.complete_registration_email(p_submission_id text,p_upload_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sub public.registration_submissions%rowtype;
begin
  select * into v_sub from public.registration_submissions where id=p_submission_id for update;
  if not found or v_sub.status<>'PENDING' or v_sub.cargomove_upload->>'state' is distinct from 'SUCCESS'
    or v_sub.cargomove_upload->>'id' is distinct from p_upload_id::text then
    raise exception 'Registration changed after the email preview';
  end if;
  update public.registration_submissions set status='DONE' where id=p_submission_id returning * into v_sub;
  return to_jsonb(v_sub);
end $$;
revoke all on function public.guard_registration_upload_rejection(),public.complete_registration_email(text,uuid) from public,anon,authenticated;
grant execute on function public.complete_registration_email(text,uuid) to service_role;

create or replace function public.begin_registration_upload_batch(p_actor uuid,p_submission_ids text[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sub public.registration_submissions%rowtype; v_job public.registration_uploads%rowtype;
  v_owner uuid=gen_random_uuid(); v_id uuid; v_token uuid=gen_random_uuid(); v_scheduler uuid;
  v_type text; v_first text; v_last text; v_filename text; v_ids text[]; v_snapshots jsonb='[]';
  v_existing uuid[]='{}'; v_existing_count integer=0;
begin
  if not exists(select 1 from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email)
    where a.id=p_actor and u.type='ADMIN') then raise exception 'Administrator required'; end if;
  select array_agg(distinct value order by value) into v_ids from unnest(p_submission_ids) value;
  if coalesce(cardinality(v_ids),0) not between 1 and 100 then raise exception 'Select between 1 and 100 registrations'; end if;
  perform 1 from public.registration_submissions where id=any(v_ids) order by id for update;
  if (select count(*) from public.registration_submissions where id=any(v_ids))<>cardinality(v_ids) then raise exception 'Registration not found'; end if;
  for v_sub in select * from public.registration_submissions where id=any(v_ids) order by reference_no,id loop
    if v_sub.registration_type not in ('DRIVER','TRAILER','VEHICLE') or v_sub.status<>'PENDING' then raise exception 'Select Pending asset registrations'; end if;
    if v_type is not null and v_type<>v_sub.registration_type then raise exception 'Use one workbook per registration type'; end if;
    v_type=v_sub.registration_type;
    if v_sub.reference_no !~ '^[A-Za-z0-9_-]{1,80}$' then raise exception 'Invalid registration reference'; end if;
    if v_first is null then v_first=v_sub.reference_no; end if; v_last=v_sub.reference_no;
    v_snapshots=v_snapshots||jsonb_build_array(to_jsonb(v_sub));
    select * into v_job from public.registration_uploads where submission_id=v_sub.id order by attempt desc limit 1;
    if found and (v_job.state<>'FAILED' or v_job.resolution_note is null and (coalesce(v_job.success_count,0)>0 or v_job.expected_rows>0 and v_job.success_count is null)) then
      v_existing=array_append(v_existing,coalesce(v_job.batch_id,v_job.id)); v_existing_count=v_existing_count+1;
    end if;
  end loop;
  if v_existing_count>0 then
    if v_existing_count=cardinality(v_ids) and (select count(distinct x) from unnest(v_existing) x)=1 then
      select * into v_job from public.registration_uploads where id=v_existing[1];
      return jsonb_build_object('job',to_jsonb(v_job),'existing',true,'submissions',v_snapshots);
    end if;
    raise exception 'Some registrations already have upload attempts. Refresh and check the existing results before retrying';
  end if;
  select s.id into v_scheduler from public.registration_upload_settings c join public.cargomove_schedulers s on s.id=c.scheduler_id
    where c.purpose='registration_excel' and s.enabled and s.worker_name='process_file_uploads';
  if v_scheduler is null then raise exception 'Configure the saved file-upload processing scheduler'; end if;
  v_filename=v_first||case when cardinality(v_ids)>1 then ' - '||v_last else '' end||'_'||v_type||'_ BY:cargomove-register.vercel.app.xlsx';
  for v_sub in select * from public.registration_submissions where id=any(v_ids) order by reference_no,id loop
    v_id=case when not exists(select 1 from public.registration_uploads where id=v_owner) then v_owner else gen_random_uuid() end;
    insert into public.registration_uploads(id,batch_id,submission_id,reference_no,entity,scheduler_id,actor,filename,lease_token,lease_until)
      values(v_id,v_owner,v_sub.id,v_sub.reference_no,lower(v_type),v_scheduler,p_actor,v_filename,v_token,now()+interval '110 seconds');
  end loop;
  select * into v_job from public.registration_uploads where id=v_owner;
  return jsonb_build_object('job',to_jsonb(v_job),'token',v_token,'existing',false,'submissions',v_snapshots);
end $$;

create or replace function public.claim_registration_upload_batch(p_actor uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_result jsonb; v_job public.registration_uploads%rowtype;
begin
  select coalesce(batch_id,id) into v_owner from public.registration_uploads where id=p_id;
  perform 1 from public.registration_submissions where id in
    (select submission_id from public.registration_uploads where coalesce(batch_id,id)=v_owner) order by id for update;
  v_result=public.claim_registration_upload(p_actor,v_owner);
  if v_result?'token' then
    select * into v_job from public.registration_uploads where id=v_owner;
    update public.registration_uploads set lease_token=v_job.lease_token,lease_until=v_job.lease_until,state=v_job.state,message=v_job.message
      where batch_id=v_owner and id<>v_owner;
  elsif (v_result->'job'->>'state')='FAILED' then
    update public.registration_uploads set state='FAILED',message=v_result->'job'->>'message',lease_token=null,lease_until=null
      where batch_id=v_owner and id<>v_owner and state='PREPARING';
  end if;
  return v_result;
end $$;

create or replace function public.transition_registration_upload_batch(p_id uuid,p_token uuid,p_state text,p_message text,
  p_expected_rows integer default null,p_upload_id text default null,p_scheduler_run_id uuid default null,
  p_success_count integer default null,p_error_count integer default null,p_existing_upload_ids text[] default null,
  p_upload_started_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_job public.registration_uploads%rowtype; v_result jsonb;
begin
  select coalesce(batch_id,id) into v_owner from public.registration_uploads where id=p_id;
  perform 1 from public.registration_submissions where id in
    (select submission_id from public.registration_uploads where coalesce(batch_id,id)=v_owner) order by id for update;
  for v_job in select * from public.registration_uploads where coalesce(batch_id,id)=v_owner order by id for update loop
    perform public.transition_registration_upload(v_job.id,p_token,p_state,p_message,p_expected_rows,p_upload_id,p_scheduler_run_id,p_success_count,p_error_count);
    if p_existing_upload_ids is not null then
      update public.registration_uploads set existing_upload_ids=p_existing_upload_ids,upload_started_at=p_upload_started_at where id=v_job.id;
    end if;
  end loop;
  select to_jsonb(j) into v_result from public.registration_uploads j where id=v_owner;
  return v_result;
end $$;

revoke all on function public.begin_registration_upload_batch(uuid,text[]),public.claim_registration_upload_batch(uuid,uuid),
  public.transition_registration_upload_batch(uuid,uuid,text,text,integer,text,uuid,integer,integer,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.begin_registration_upload_batch(uuid,text[]),public.claim_registration_upload_batch(uuid,uuid),
  public.transition_registration_upload_batch(uuid,uuid,text,text,integer,text,uuid,integer,integer,text[],timestamptz) to service_role;

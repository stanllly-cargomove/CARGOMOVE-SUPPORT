-- Durable, bounded continuations for consecutive GitHub API requests.
alter table public.automation_scheduler_runs
  add column chain_key text,
  add column chain_step integer,
  add column chain_started_at timestamptz,
  add column continuation_token uuid unique;

create function public.acquire_auto_register_cm_step(p_actor uuid,p_request_key text,p_continuation uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_parent public.automation_scheduler_runs%rowtype; v_run public.automation_scheduler_runs%rowtype;
  v_result jsonb; v_key text; v_step integer := 0; v_started timestamptz := now();
begin
  perform pg_advisory_xact_lock(735169241);
  if p_continuation is not null then
    select * into v_parent from public.automation_scheduler_runs where continuation_token=p_continuation;
    if not found or v_parent.scheduler_key<>'auto_register_cm' or v_parent.execution_type<>'AUTOMATIC'
      or v_parent.status not in ('SUCCESS','SKIPPED') or v_parent.chain_step>=7
      or v_parent.chain_started_at<now()-interval '18 minutes' then
      return jsonb_build_object('reason','invalid_continuation');
    end if;
    v_key := v_parent.chain_key;
    v_step := v_parent.chain_step+1;
    v_started := v_parent.chain_started_at;
  else
    if p_request_key is null or p_request_key !~ '^auto_register_cm:delivery:[0-9]+$' then raise exception 'Invalid request key'; end if;
    v_key := p_request_key;
  end if;
  v_result := public.acquire_automation_scheduler('auto_register_cm','AUTOMATIC',p_actor,
    case when v_step=0 then v_key else v_key||':step:'||v_step end);
  if v_result->>'id' is null then return v_result; end if;
  if v_result->>'status'='RUNNING' and v_result->>'reason' is null then
    update public.automation_scheduler_runs set chain_key=v_key,chain_step=v_step,chain_started_at=v_started
      where id=(v_result->>'id')::uuid;
  end if;
  select * into v_run from public.automation_scheduler_runs where id=(v_result->>'id')::uuid;
  return v_result||jsonb_build_object('continuationToken',v_run.continuation_token,
    'continuationDelayMs',5000,'message',v_run.message,'processedCount',v_run.processed_count,
    'successCount',v_run.success_count,'failedCount',v_run.failed_count);
end $$;

create function public.finish_auto_register_cm_step(p_id uuid,p_status text,p_processed integer,p_success integer,
  p_failed integer,p_message text,p_error text default null,p_has_more boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.automation_scheduler_runs%rowtype; v_continue boolean;
begin
  perform pg_advisory_xact_lock(735169241);
  perform 1 from public.automation_scheduler_runs where id=p_id and scheduler_key='auto_register_cm'
    and execution_type='AUTOMATIC' and chain_key is not null for update;
  if not found then raise exception 'Automatic step required'; end if;
  if not public.finish_automation_scheduler(p_id,p_status,p_processed,p_success,p_failed,p_message,p_error) then
    raise exception 'Execution result could not be saved';
  end if;
  select * into v_run from public.automation_scheduler_runs where id=p_id;
  v_continue := p_has_more and p_status in ('SUCCESS','SKIPPED') and v_run.chain_step<7
    and v_run.chain_started_at>now()-interval '18 minutes';
  update public.automation_scheduler_runs set continuation_token=case when v_continue then gen_random_uuid() else null end
    where id=p_id returning * into v_run;
  return jsonb_build_object('continuationToken',v_run.continuation_token,'continuationDelayMs',5000,
    'continuationLimitReached',p_has_more and p_status<>'FAILED' and not v_continue);
end $$;

create function public.auto_register_cm_has_work() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.auto_register_cm_scheduled_items q
    join public.registration_submissions s on s.id=q.submission_id
    where q.status='SCHEDULED' and s.status='PENDING'
      and coalesce(s.cargomove_upload->>'state','')<>'UNKNOWN')
    or exists(select 1 from public.auto_register_cm_email_candidates())
    or exists(select 1 from public.automation_schedulers where scheduler_key='auto_register_cm' and discovery_cursor is not null);
$$;
revoke all on function public.acquire_auto_register_cm_step(uuid,text,uuid),
  public.finish_auto_register_cm_step(uuid,text,integer,integer,integer,text,text,boolean),
  public.auto_register_cm_has_work() from public,anon,authenticated;
grant execute on function public.acquire_auto_register_cm_step(uuid,text,uuid),
  public.finish_auto_register_cm_step(uuid,text,integer,integer,integer,text,text,boolean),
  public.auto_register_cm_has_work() to service_role;

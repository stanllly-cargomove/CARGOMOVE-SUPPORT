-- Independent delivery driver. Inactive until explicitly provisioned after the
-- new application is deployed. Secrets live in Vault, never in this table.
create table public.auto_register_cm_cron_state (
  scheduler_key text primary key default 'auto_register_cm' check (scheduler_key='auto_register_cm'),
  is_enabled boolean not null default false,
  delivery_window bigint,
  request_id bigint,
  request_body jsonb,
  sent_at timestamptz,
  chain_started_at timestamptz,
  step_count integer not null default 0,
  retry_count integer not null default 0,
  last_tick_at timestamptz,
  last_status text not null default 'NOT_CONFIGURED',
  last_error_code text
);
insert into public.auto_register_cm_cron_state(scheduler_key) values('auto_register_cm');
alter table public.auto_register_cm_cron_state enable row level security;
revoke all on public.auto_register_cm_cron_state from public,anon,authenticated,service_role;
grant select on public.auto_register_cm_cron_state to service_role;

create function public.auto_register_cm_cron_tick() returns text
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_state public.auto_register_cm_cron_state%rowtype;
  v_response record; v_result jsonb; v_body jsonb; v_window bigint;
  v_url text; v_secret text; v_url_count integer; v_secret_count integer;
  v_timestamp text; v_payload text; v_signature text; v_id bigint;
  v_step integer; v_retry integer; v_retry_request boolean := false;
begin
  if not pg_try_advisory_xact_lock(735169242) then return 'BUSY'; end if;
  select * into v_state from public.auto_register_cm_cron_state where scheduler_key='auto_register_cm' for update;
  if not found then return 'NOT_CONFIGURED'; end if;
  update public.auto_register_cm_cron_state set last_tick_at=now() where scheduler_key='auto_register_cm';
  if not v_state.is_enabled then return 'DISABLED'; end if;
  if not exists(select 1 from public.automation_schedulers where scheduler_key='auto_register_cm' and is_enabled) then
    update public.auto_register_cm_cron_state set last_status='APP_DISABLED',last_error_code=null where scheduler_key='auto_register_cm';
    return 'APP_DISABLED';
  end if;
  if v_state.chain_started_at<now()-interval '18 minutes' then
    update public.auto_register_cm_cron_state set request_id=null,request_body=null,chain_started_at=null,
      last_status='DEFERRED',last_error_code='CHAIN_EXPIRED' where scheduler_key='auto_register_cm';
    return 'CHAIN_EXPIRED';
  end if;

  if v_state.request_id is not null then
    select status_code,timed_out,error_msg,content into v_response from net._http_response where id=v_state.request_id;
    if not found then
      if v_state.sent_at>now()-interval '150 seconds' then return 'WAITING'; end if;
      v_retry_request := true;
    elsif coalesce(v_response.timed_out,false) or v_response.error_msg is not null or v_response.status_code=409 then
      v_retry_request := true;
    else
      begin v_result := v_response.content::jsonb;
      exception when others then v_result := null; end;
      if v_response.status_code is null or v_response.status_code not between 200 and 299
        or v_result is null or v_result->>'status' is null or v_result->>'status' not in ('success','skipped') then
        update public.auto_register_cm_cron_state set request_id=null,request_body=null,chain_started_at=null,
          last_status='FAILED',last_error_code=case when v_response.status_code between 400 and 599
            then 'HTTP_'||v_response.status_code else 'INVALID_RESPONSE' end where scheduler_key='auto_register_cm';
        return 'FAILED';
      end if;
      if nullif(v_result->>'continuationToken','') is null then
        update public.auto_register_cm_cron_state set request_id=null,request_body=null,chain_started_at=null,
          last_status=case when coalesce((v_result->>'continuationLimitReached')::boolean,false) then 'DEFERRED' else 'COMPLETED' end,
          last_error_code=null where scheduler_key='auto_register_cm';
        return 'COMPLETED';
      end if;
      if v_state.step_count>=8 or (v_result->>'continuationToken') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        update public.auto_register_cm_cron_state set request_id=null,request_body=null,chain_started_at=null,
          last_status='DEFERRED',last_error_code='CONTINUATION_LIMIT' where scheduler_key='auto_register_cm';
        return 'DEFERRED';
      end if;
      v_body := jsonb_build_object('continuationToken',lower(v_result->>'continuationToken'));
      v_step := v_state.step_count+1; v_retry := 0;
    end if;
    if v_retry_request then
      if v_state.retry_count>=3 then
        update public.auto_register_cm_cron_state set request_id=null,request_body=null,chain_started_at=null,
          last_status='DEFERRED',last_error_code='DELIVERY_RETRY_LIMIT' where scheduler_key='auto_register_cm';
        return 'DEFERRED';
      end if;
      -- Retry the exact durable step. A late response must never admit a new upload.
      v_body := v_state.request_body; v_step := v_state.step_count; v_retry := v_state.retry_count+1;
    end if;
  else
    v_window := floor(extract(epoch from now())/1200)::bigint;
    -- Planned starts remain at minutes 7, 27 and 47; a later minute catches a
    -- missed tick in the same window. No empty request is sent each minute.
    if mod(extract(minute from now() at time zone 'UTC')::integer,20)<7 or v_state.delivery_window=v_window then return 'IDLE'; end if;
    v_body := jsonb_build_object('window',v_window); v_step := 1; v_retry := 0;
  end if;

  select count(*),max(decrypted_secret) into v_url_count,v_url from vault.decrypted_secrets where name='auto_register_cm_url';
  select count(*),max(decrypted_secret) into v_secret_count,v_secret from vault.decrypted_secrets where name='auto_register_cm_cron_secret';
  if v_url_count<>1 or v_secret_count<>1 or coalesce(v_secret,'')=''
    or coalesce(v_url,'') !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*/api/scheduler/auto-register-cm$' then
    update public.auto_register_cm_cron_state set last_status='NOT_CONFIGURED',last_error_code='TRIGGER_NOT_CONFIGURED' where scheduler_key='auto_register_cm';
    return 'NOT_CONFIGURED';
  end if;
  v_timestamp := floor(extract(epoch from now()))::bigint::text;
  v_payload := 'auto-register-cm:v1'||chr(10)||v_timestamp||chr(10)||case when v_body ? 'window'
    then 'window:'||(v_body->>'window') else 'continuation:'||(v_body->>'continuationToken') end;
  v_signature := encode(extensions.hmac(v_payload,v_secret,'sha256'),'hex');
  v_id := net.http_post(url:=v_url,body:=v_body,headers:=jsonb_build_object('Content-Type','application/json',
    'x-cargomove-cron-timestamp',v_timestamp,'x-cargomove-cron-signature',v_signature),timeout_milliseconds:=125000);
  update public.auto_register_cm_cron_state set request_id=v_id,request_body=v_body,sent_at=now(),
    chain_started_at=coalesce(v_state.chain_started_at,now()),delivery_window=coalesce(v_window,v_state.delivery_window),
    step_count=v_step,retry_count=v_retry,last_status='REQUESTED',last_error_code=null where scheduler_key='auto_register_cm';
  return 'REQUESTED';
exception when undefined_table or undefined_function then
  update public.auto_register_cm_cron_state set last_tick_at=now(),last_status='NOT_CONFIGURED',last_error_code='TRIGGER_DEPENDENCIES_MISSING' where scheduler_key='auto_register_cm';
  return 'NOT_CONFIGURED';
when others then
  update public.auto_register_cm_cron_state set last_tick_at=now(),last_status='FAILED',last_error_code='CRON_TICK_FAILED' where scheduler_key='auto_register_cm';
  return 'FAILED';
end $$;
revoke all on function public.auto_register_cm_cron_tick() from public,anon,authenticated,service_role;
grant execute on function public.auto_register_cm_cron_tick() to postgres;

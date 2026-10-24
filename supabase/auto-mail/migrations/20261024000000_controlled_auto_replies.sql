-- Separate Auto Mail database ONLY. Requires incoming AI workflow and reviewed learning.
-- Existing databases start with auto-reply OFF. No mail, cron, or provisioning runs here.
begin;
alter table auto_mail.incoming_agent_settings
 add column auto_reply_enabled boolean not null default false,
 add column min_confidence numeric not null default 0.95 check(min_confidence between 0.8 and 1),
 add column max_auto_replies_per_hour integer not null default 5 check(max_auto_replies_per_hour between 1 and 20),
 add column auto_reply_enabled_at timestamptz,
 add constraint auto_reply_requires_drafting check(not auto_reply_enabled or enabled);
alter table auto_mail.incoming_ai_jobs
 add column source_received_at timestamptz,
 add column auto_reply_generation_ready boolean not null default false,
 add column auto_reply_evaluation jsonb not null default '{}',
 add column auto_reply_state text not null default 'REVIEW' check(auto_reply_state in ('REVIEW','SENDING','SENT','UNKNOWN')),
 add column auto_reply_delivery_id uuid references auto_mail.reply_deliveries(id),
 add column auto_reply_claimed_at timestamptz;
create index auto_reply_rate on auto_mail.incoming_ai_jobs(mailbox_id,auto_reply_claimed_at) where auto_reply_delivery_id is not null;

drop function auto_mail.save_incoming_settings(boolean,text,integer,uuid);
create function auto_mail.save_incoming_settings(p_enabled boolean,p_scope text,p_version integer,p_actor uuid,
 p_auto_reply_enabled boolean default false,p_min_confidence numeric default 0.95,p_max_auto_replies_per_hour integer default 5)
returns jsonb language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare saved auto_mail.incoming_agent_settings;
begin
 select * into saved from auto_mail.incoming_agent_settings where id='system' for update;
 if saved.version is distinct from p_version then raise exception 'AGENT_CONFLICT';end if;
 if p_actor is null or p_enabled is null or p_auto_reply_enabled is null or p_scope is null or length(btrim(p_scope)) not between 1 and 80
  or p_min_confidence is null or p_min_confidence not between 0.8 and 1 or p_max_auto_replies_per_hour is null or p_max_auto_replies_per_hour not between 1 and 20
  or (p_auto_reply_enabled and not p_enabled) then raise exception 'AGENT_INVALID';end if;
 update auto_mail.incoming_agent_settings set enabled=p_enabled,scope=upper(btrim(p_scope)),version=version+1,enabled_by=p_actor,
  enabled_at=case when p_enabled and not saved.enabled then clock_timestamp() else enabled_at end,
  auto_reply_enabled=p_auto_reply_enabled,min_confidence=p_min_confidence,max_auto_replies_per_hour=p_max_auto_replies_per_hour,
  auto_reply_enabled_at=case when p_auto_reply_enabled and not saved.auto_reply_enabled then clock_timestamp() else auto_reply_enabled_at end
 where id='system' returning * into saved;
 insert into auto_mail.incoming_agent_events(actor_id,settings) values(p_actor,to_jsonb(saved));
 return to_jsonb(saved);
end;$$;

alter function auto_mail.finish_incoming_message(uuid,uuid,jsonb) rename to finish_incoming_draft_internal;
revoke all on function auto_mail.finish_incoming_draft_internal(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function auto_mail.finish_incoming_message(p_token uuid,p_id uuid,p_result jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare draft_id uuid;
begin
 draft_id:=auto_mail.finish_incoming_draft_internal(p_token,p_id,p_result);
 update auto_mail.incoming_ai_jobs set auto_reply_generation_ready=coalesce((p_result->>'auto_send_eligible')::boolean,false),
  auto_reply_evaluation=coalesce(p_result->'auto_reply_evaluation','{}'::jsonb),source_received_at=(p_result->>'source_received_at')::timestamptz where id=p_id;
 return draft_id;
end;$$;

create function auto_mail.claim_auto_reply(p_token uuid,p_id uuid,p_delivery jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare policy auto_mail.incoming_agent_settings;job auto_mail.incoming_ai_jobs;draft auto_mail.ai_reply_drafts;connection auto_mail.gmail_connections;delivery_id uuid;
begin
 -- The connection lock also serializes manual/scheduled claims and rate-limit checks.
 select * into connection from auto_mail.gmail_connections where id='system' for update;
 select * into policy from auto_mail.incoming_agent_settings where id='system' for share;
 perform 1 from auto_mail.incoming_worker_state where id='system' and token=p_token and lease_until>now() and connection_version=connection.version for share;
 if not found then return null;end if;
 select * into job from auto_mail.incoming_ai_jobs where id=p_id and worker_token=p_token for update;
 if not found or job.status<>'DRAFT_READY' or job.auto_reply_state<>'REVIEW' or not job.auto_reply_generation_ready
  or not policy.enabled or not policy.auto_reply_enabled or job.settings_version<>policy.version
  or job.source_received_at is null or job.source_received_at<policy.auto_reply_enabled_at or job.created_at<policy.auto_reply_enabled_at or job.connection_version<>connection.version or job.mailbox_id<>connection.mailbox_id then return null;end if;
 if coalesce(job.classification->>'category','') not in ('SUPPORT_REQUEST','REGISTRATION_QUERY') or job.classification->>'kb_match' is distinct from 'STRONG'
  or coalesce((job.classification->>'confidence')::numeric,0) not between policy.min_confidence and 1
  or job.auto_reply_evaluation->>'grounded' is distinct from 'true' or job.auto_reply_evaluation->>'needs_human' is distinct from 'false'
  or coalesce((job.auto_reply_evaluation->>'confidence')::numeric,0) not between policy.min_confidence and 1 then return null;end if;
 if (select count(*) from auto_mail.incoming_ai_jobs where mailbox_id=job.mailbox_id and auto_reply_claimed_at>now()-interval '1 hour')>=policy.max_auto_replies_per_hour then return null;end if;
 -- Avoid automatic back-and-forth on one thread, including across reconnects.
 if exists(select 1 from auto_mail.incoming_ai_jobs where mailbox_id=job.mailbox_id and gmail_thread_id=job.gmail_thread_id and auto_reply_claimed_at>now()-interval '24 hours') then return null;end if;
 select * into draft from auto_mail.ai_reply_drafts where id=job.draft_id and automatic and draft_kind='KB' for share;
 if not found or draft.id<>job.id or draft.requested_by<>job.actor_id then return null;end if;
 perform 1 from auto_mail.agent_settings where id='system' and enabled and model=draft.model and model=any(enabled_models) for share;
 if not found then return null;end if;
 if p_delivery->>'ai_draft_id' is distinct from draft.id::text or p_delivery->>'body_text' is distinct from draft.body_text
  or p_delivery->>'requested_by' is distinct from job.actor_id::text then raise exception 'AI_DRAFT_CHANGED';end if;
 -- Rechecks current approved source versions, connection, source, hash, and unique delivery.
 delivery_id:=auto_mail.claim_manual_reply(p_delivery);
 update auto_mail.incoming_ai_jobs set auto_reply_state='SENDING',auto_reply_delivery_id=delivery_id,auto_reply_claimed_at=clock_timestamp() where id=p_id;
 return delivery_id;
end;$$;

create function auto_mail.finish_auto_reply(p_id uuid,p_delivery_id uuid,p_gmail_id text) returns void
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare job auto_mail.incoming_ai_jobs;
begin
 select * into job from auto_mail.incoming_ai_jobs where id=p_id and auto_reply_delivery_id=p_delivery_id for update;
 if not found then raise exception 'AI_DELIVERY_UNAVAILABLE';end if;
 if job.auto_reply_state='SENT' then return;end if;
 if exists(select 1 from auto_mail.reply_deliveries where id=p_delivery_id and status='SENT') then
  update auto_mail.incoming_ai_jobs set auto_reply_state='SENT' where id=p_id;return;
 end if;
 if p_gmail_id is not null and length(btrim(p_gmail_id))=0 then raise exception 'AI_INVALID_RECEIPT';end if;
 update auto_mail.reply_deliveries set status=case when p_gmail_id is null then 'UNKNOWN' else 'SENT' end,
  gmail_message_id=p_gmail_id,finished_at=clock_timestamp() where id=p_delivery_id;
 update auto_mail.incoming_ai_jobs set auto_reply_state=case when p_gmail_id is null then 'UNKNOWN' else 'SENT' end where id=p_id;
end;$$;

revoke all on function auto_mail.save_incoming_settings(boolean,text,integer,uuid,boolean,numeric,integer),auto_mail.finish_incoming_message(uuid,uuid,jsonb),
 auto_mail.claim_auto_reply(uuid,uuid,jsonb),auto_mail.finish_auto_reply(uuid,uuid,text) from public,anon,authenticated;
grant execute on function auto_mail.save_incoming_settings(boolean,text,integer,uuid,boolean,numeric,integer),auto_mail.finish_incoming_message(uuid,uuid,jsonb),
 auto_mail.claim_auto_reply(uuid,uuid,jsonb),auto_mail.finish_auto_reply(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;

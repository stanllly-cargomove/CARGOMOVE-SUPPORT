-- Separate Auto Mail database ONLY. Requires AI drafts, reviewed learning and agent settings.
-- Draft generation is opt-in; this migration never enables sending or runs the worker.
begin;
create table auto_mail.incoming_agent_settings (
 id text primary key check(id='system'), enabled boolean not null default false,
 scope text not null default 'ALL' check(length(btrim(scope)) between 1 and 80),
 version integer not null default 1, enabled_by uuid, enabled_at timestamptz not null default now(),
 check(not enabled or enabled_by is not null)
);
insert into auto_mail.incoming_agent_settings(id) values('system');
create table auto_mail.incoming_agent_events(id uuid primary key default gen_random_uuid(),actor_id uuid not null,settings jsonb not null,created_at timestamptz not null default now());
create table auto_mail.incoming_worker_state(id text primary key check(id='system'),token uuid,lease_until timestamptz,last_seen timestamptz,cursor text,connection_version uuid);
insert into auto_mail.incoming_worker_state(id) values('system');
create table auto_mail.incoming_ai_jobs(
 id uuid primary key default gen_random_uuid(),mailbox_id uuid not null references auto_mail.mailboxes(id),connection_version uuid not null,
 source_message_id text not null,gmail_thread_id text not null,conversation_hash text not null,subject text not null,
 actor_id uuid not null,settings_version integer not null,worker_token uuid not null,
 status text not null default 'PROCESSING' check(status in ('PROCESSING','DRAFT_READY','SKIPPED','FAILED')),
 classification jsonb not null default '{}',draft_id uuid references auto_mail.ai_reply_drafts(id),review_reason text not null default '',
 created_at timestamptz not null default now(),finished_at timestamptz,
 unique(mailbox_id,connection_version,source_message_id)
);
create index incoming_ai_jobs_time on auto_mail.incoming_ai_jobs(created_at desc);
alter table auto_mail.ai_reply_drafts add column draft_kind text not null default 'KB' check(draft_kind in ('KB','ACKNOWLEDGEMENT'));
alter table auto_mail.ai_reply_drafts add column automatic boolean not null default false;
alter table auto_mail.ai_reply_drafts add column origin_draft_id uuid references auto_mail.ai_reply_drafts(id);
create unique index incoming_adopt_once on auto_mail.ai_reply_drafts(origin_draft_id,requested_by) where origin_draft_id is not null;
alter table auto_mail.ai_reply_drafts drop constraint ai_reply_drafts_sources_check;
alter table auto_mail.ai_reply_drafts add constraint ai_reply_drafts_sources_check check(jsonb_typeof(sources)='array' and
 ((draft_kind='KB' and jsonb_array_length(sources) between 1 and 5) or (draft_kind='ACKNOWLEDGEMENT' and sources='[]'::jsonb)));

create function auto_mail.acknowledgement_body(p_language text) returns text language sql immutable set search_path=pg_catalog as $$
 select case p_language when 'ms' then E'Terima kasih kerana menghubungi CargoMove Support. Sila berikan mesej ralat, langkah yang telah dicuba dan rujukan berkaitan supaya pasukan sokongan boleh menyemak. Jangan hantar kata laluan atau kod keselamatan.'
 when 'zh' then E'感谢您联系 CargoMove Support。请提供错误信息、已尝试的操作步骤和相关参考编号，以便支持团队核查。请勿发送密码或安全验证码。'
 else E'Thank you for contacting CargoMove Support. Please share the error message, steps already tried and relevant reference details so the support team can review. Do not send passwords or security codes.' end;
$$;
create function auto_mail.assert_draft_evidence(p_draft auto_mail.ai_reply_drafts) returns void language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
begin
 if p_draft.draft_kind='KB' then perform auto_mail.assert_ai_sources(p_draft.sources,p_draft.scope);
 elsif p_draft.status<>'NEEDS_REVIEW' or p_draft.sources<>'[]'::jsonb or cardinality(p_draft.cited_source_ids)<>0 or p_draft.body_text not in
 (auto_mail.acknowledgement_body('en'),auto_mail.acknowledgement_body('ms'),auto_mail.acknowledgement_body('zh')) then raise exception 'AI_INVALID_ACKNOWLEDGEMENT'; end if;
end;$$;
create or replace function auto_mail.validate_ai_draft(p_id uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare saved auto_mail.ai_reply_drafts; connection auto_mail.gmail_connections;
begin
 select * into connection from auto_mail.gmail_connections where id='system' for share;
 select * into saved from auto_mail.ai_reply_drafts where id=p_id and requested_by=p_actor for share;
 if not found or saved.status not in ('READY','NEEDS_REVIEW') then raise exception 'AI_DRAFT_UNAVAILABLE';end if;
 if connection.version is distinct from saved.connection_version or connection.mailbox_id is distinct from saved.mailbox_id then raise exception 'CONNECTION_CHANGED';end if;
 perform auto_mail.assert_draft_evidence(saved);
 if exists(select 1 from auto_mail.reply_deliveries where mailbox_id=saved.mailbox_id and source_message_id=saved.source_message_id) then raise exception 'AI_ALREADY_REPLIED';end if;
 return to_jsonb(saved);
end;$$;
create function auto_mail.save_incoming_settings(p_enabled boolean,p_scope text,p_version integer,p_actor uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare saved auto_mail.incoming_agent_settings;
begin
 select * into saved from auto_mail.incoming_agent_settings where id='system' for update;
 if saved.version<>p_version then raise exception 'AGENT_CONFLICT';end if;
 if p_actor is null or p_enabled is null or length(btrim(p_scope)) not between 1 and 80 then raise exception 'AGENT_INVALID';end if;
 update auto_mail.incoming_agent_settings set enabled=p_enabled,scope=upper(btrim(p_scope)),version=version+1,enabled_by=p_actor,
 enabled_at=case when p_enabled and not saved.enabled then clock_timestamp() else enabled_at end where id='system' returning * into saved;
 insert into auto_mail.incoming_agent_events(actor_id,settings) values(p_actor,to_jsonb(saved));
 return to_jsonb(saved);
end;$$;
create function auto_mail.begin_incoming_tick(p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare settings auto_mail.incoming_agent_settings;worker auto_mail.incoming_worker_state;connection auto_mail.gmail_connections;
begin
 select * into connection from auto_mail.gmail_connections where id='system' for share;
 select * into settings from auto_mail.incoming_agent_settings where id='system' for share;
 select * into worker from auto_mail.incoming_worker_state where id='system' for update;
 if not settings.enabled or connection.id is null or not exists(select 1 from auto_mail.agent_settings where id='system' and enabled and model=any(enabled_models)) then return null;end if;
 if worker.lease_until>now() then return null;end if;
 update auto_mail.incoming_ai_jobs set status='FAILED',review_reason='Generation interrupted. Staff review required; no automatic retry.',finished_at=now() where status='PROCESSING' and created_at<now()-interval '3 minutes';
 if (select count(*) from auto_mail.incoming_ai_jobs where mailbox_id=connection.mailbox_id and created_at>now()-interval '1 hour')>=20 then return null;end if;
 update auto_mail.incoming_worker_state set token=p_token,lease_until=now()+interval '2 minutes',last_seen=now(),connection_version=connection.version,
 cursor=case when worker.connection_version=connection.version then worker.cursor else null end where id='system' returning * into worker;
 return to_jsonb(settings)||jsonb_build_object('cursor',worker.cursor,'connection_version',connection.version,'enabled_at',greatest(settings.enabled_at,connection.connected_at));
end;$$;
create function auto_mail.claim_incoming_message(p_token uuid,p_message jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare settings auto_mail.incoming_agent_settings;saved auto_mail.incoming_ai_jobs;connection auto_mail.gmail_connections;
begin
 select * into connection from auto_mail.gmail_connections where id='system' for share;
 select * into settings from auto_mail.incoming_agent_settings where id='system' for share;
 perform 1 from auto_mail.incoming_worker_state where id='system' and token=p_token and lease_until>now() and connection_version=connection.version for update;
 if not found or not settings.enabled then raise exception 'AI_WORKER_EXPIRED';end if;
 if (select count(*) from auto_mail.incoming_ai_jobs where mailbox_id=connection.mailbox_id and created_at>now()-interval '1 hour')>=20 then return null;end if;
 if exists(select 1 from auto_mail.reply_deliveries where mailbox_id=connection.mailbox_id and source_message_id=p_message->>'source_message_id') then return null;end if;
 insert into auto_mail.incoming_ai_jobs(mailbox_id,connection_version,source_message_id,gmail_thread_id,conversation_hash,subject,actor_id,settings_version,worker_token)
 values(connection.mailbox_id,connection.version,p_message->>'source_message_id',p_message->>'gmail_thread_id',p_message->>'conversation_hash',left(p_message->>'subject',998),settings.enabled_by,settings.version,p_token)
 on conflict(mailbox_id,connection_version,source_message_id) do nothing returning * into saved;
 return case when saved.id is null then null else to_jsonb(saved) end;
end;$$;
create function auto_mail.finish_incoming_message(p_token uuid,p_id uuid,p_result jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare job auto_mail.incoming_ai_jobs;settings auto_mail.incoming_agent_settings;connection auto_mail.gmail_connections;saved auto_mail.ai_reply_drafts;citations uuid[];
begin
 select * into connection from auto_mail.gmail_connections where id='system' for share;
 select * into settings from auto_mail.incoming_agent_settings where id='system' for share;
 perform 1 from auto_mail.incoming_worker_state where id='system' and token=p_token and lease_until>now() for share;
 if not found then raise exception 'AI_WORKER_EXPIRED';end if;
 select * into job from auto_mail.incoming_ai_jobs where id=p_id and worker_token=p_token and status='PROCESSING' for update;
 if not found or not settings.enabled or settings.version<>job.settings_version or connection.version<>job.connection_version then raise exception 'CONNECTION_CHANGED';end if;
 if p_result->>'status' not in ('DRAFT_READY','SKIPPED','FAILED') then raise exception 'AI_INVALID_OUTPUT';end if;
 if p_result->>'status'='DRAFT_READY' then
  if exists(select 1 from auto_mail.reply_deliveries where mailbox_id=job.mailbox_id and source_message_id=job.source_message_id) then raise exception 'AI_ALREADY_REPLIED';end if;
  if not exists(select 1 from auto_mail.agent_settings where id='system' and enabled and model=p_result->>'model' and model=any(enabled_models)) then raise exception 'AGENT_CONFLICT';end if;
  citations:=array(select value::uuid from jsonb_array_elements_text(p_result->'cited_source_ids'));
  if length(coalesce(p_result->>'body_text','')) not between 1 and 5000 or length(coalesce(p_result->>'review_notes',''))>2000 then raise exception 'AI_INVALID_OUTPUT';end if;
  if p_result->>'draft_kind'='KB' and (cardinality(citations)=0 or exists(select 1 from unnest(citations) id where not exists(select 1 from jsonb_array_elements(p_result->'sources') s where s->>'id'=id::text))) then raise exception 'AI_INVALID_OUTPUT';end if;
  insert into auto_mail.ai_reply_drafts(id,mailbox_id,connection_version,gmail_thread_id,source_message_id,conversation_hash,scope,provider,model,requested_by,status,sources,body_text,review_notes,cited_source_ids,draft_kind,automatic,finished_at)
  values(job.id,job.mailbox_id,job.connection_version,job.gmail_thread_id,job.source_message_id,job.conversation_hash,settings.scope,'openai',p_result->>'model',job.actor_id,'NEEDS_REVIEW',p_result->'sources',p_result->>'body_text',p_result->>'review_notes',citations,p_result->>'draft_kind',true,now()) returning * into saved;
  perform auto_mail.assert_draft_evidence(saved);
 end if;
 update auto_mail.incoming_ai_jobs set status=p_result->>'status',classification=coalesce(p_result->'classification','{}'),draft_id=saved.id,review_reason=left(coalesce(p_result->>'review_notes',''),2000),finished_at=now() where id=job.id;
 return saved.id;
end;$$;
create function auto_mail.end_incoming_tick(p_token uuid,p_cursor text) returns void language sql security definer set search_path=pg_catalog,auto_mail as $$
 update auto_mail.incoming_worker_state set lease_until=now(),cursor=p_cursor where id='system' and token=p_token;
$$;
create function auto_mail.adopt_incoming_draft(p_id uuid,p_actor uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare original auto_mail.ai_reply_drafts;copy_id uuid;
begin
 select * into original from auto_mail.ai_reply_drafts where id=p_id and automatic for share;
 if not found then return p_id;end if;
 perform auto_mail.validate_ai_draft(original.id,original.requested_by);
 if original.requested_by=p_actor then return p_id;end if;
 select id into copy_id from auto_mail.ai_reply_drafts where origin_draft_id=p_id and requested_by=p_actor;
 if copy_id is not null then return copy_id;end if;
 insert into auto_mail.ai_reply_drafts(id,mailbox_id,connection_version,gmail_thread_id,source_message_id,conversation_hash,scope,provider,model,requested_by,status,sources,body_text,review_notes,cited_source_ids,draft_kind,origin_draft_id,finished_at)
 values(gen_random_uuid(),original.mailbox_id,original.connection_version,original.gmail_thread_id,original.source_message_id,original.conversation_hash,original.scope,'openai',original.model,p_actor,original.status,original.sources,original.body_text,original.review_notes,original.cited_source_ids,original.draft_kind,p_id,now()) on conflict(origin_draft_id,requested_by) where origin_draft_id is not null do update set origin_draft_id=excluded.origin_draft_id returning id into copy_id;
 return copy_id;
end;$$;

alter table auto_mail.incoming_agent_settings enable row level security;alter table auto_mail.incoming_agent_events enable row level security;
alter table auto_mail.incoming_worker_state enable row level security;alter table auto_mail.incoming_ai_jobs enable row level security;
revoke all on auto_mail.incoming_agent_settings,auto_mail.incoming_agent_events,auto_mail.incoming_worker_state,auto_mail.incoming_ai_jobs from public,anon,authenticated,service_role;
grant select on auto_mail.incoming_agent_settings,auto_mail.incoming_agent_events,auto_mail.incoming_worker_state,auto_mail.incoming_ai_jobs to service_role;
revoke all on function auto_mail.acknowledgement_body(text),auto_mail.assert_draft_evidence(auto_mail.ai_reply_drafts),auto_mail.save_incoming_settings(boolean,text,integer,uuid),auto_mail.begin_incoming_tick(uuid),auto_mail.claim_incoming_message(uuid,jsonb),auto_mail.finish_incoming_message(uuid,uuid,jsonb),auto_mail.end_incoming_tick(uuid,text),auto_mail.adopt_incoming_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function auto_mail.acknowledgement_body(text),auto_mail.assert_draft_evidence(auto_mail.ai_reply_drafts),auto_mail.save_incoming_settings(boolean,text,integer,uuid),auto_mail.begin_incoming_tick(uuid),auto_mail.claim_incoming_message(uuid,jsonb),auto_mail.finish_incoming_message(uuid,uuid,jsonb),auto_mail.end_incoming_tick(uuid,text),auto_mail.adopt_incoming_draft(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;

-- Separate Auto Mail project ONLY. AI drafts never enable automatic delivery.
begin;
alter table auto_mail.settings drop constraint settings_schema_version_check;
alter table auto_mail.settings add constraint settings_schema_version_check check (schema_version in (1,2,3,4));

-- Keep existing manual KB searches compatible; AI explicitly supplies a scope.
drop function auto_mail.match_knowledge_articles(text);
create function auto_mail.match_knowledge_articles(p_query text, p_port text default '')
returns jsonb language sql stable security definer set search_path = pg_catalog, auto_mail as $$
  with words as (
    select word from unnest(tsvector_to_array(to_tsvector('simple', left(coalesce(p_query,''),4000)))) word
    where length(word)>2 and word <> all(array['the','and','for','that','this','with','from','your','you','are','was','have','has','can','please','help','thanks','thank','regards','hello','dear','would','could','will','about','email','com','gmail','yang','dan','untuk','dengan','saya','kami','boleh','tolong','terima','kasih'])
    order by word limit 80
  ), query as (select to_tsquery('simple',string_agg(quote_literal(word),' | ')) as q from words), ranked as (
    select k.*,coalesce(ts_rank_cd(k.search_document,q.q),0)+(select count(*)::real/10 from unnest(k.keywords) tag where strpos(lower(left(p_query,4000)),lower(tag))>0) as score
    from auto_mail.knowledge_articles k cross join query q
    where k.status='APPROVED' and (coalesce(p_port,'')='' or upper(k.port) in ('ALL',upper(p_port)))
    and (k.search_document @@ q.q or exists(select 1 from unnest(k.keywords) tag where length(tag)>2 and strpos(lower(left(p_query,4000)),lower(tag))>0))
    order by score desc,k.id limit 5
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'summary',summary,'content',content,'category',category,'port',port,'version',version,'keywords',keywords) order by score desc,id),'[]'::jsonb) from ranked;
$$;

create table auto_mail.ai_reply_drafts (
  id uuid primary key,
  mailbox_id uuid not null references auto_mail.mailboxes(id),
  connection_version uuid not null,
  gmail_thread_id text not null,
  source_message_id text not null,
  conversation_hash text not null,
  scope text not null,
  provider text not null check(provider='openai'),
  model text not null,
  requested_by uuid not null,
  status text not null default 'GENERATING' check(status in ('GENERATING','READY','NEEDS_REVIEW','NO_ANSWER','FAILED')),
  sources jsonb not null check(jsonb_typeof(sources)='array' and jsonb_array_length(sources) between 1 and 5),
  body_text text not null default '',
  review_notes text not null default '',
  cited_source_ids uuid[] not null default '{}',
  error_code text,
  created_at timestamptz not null default now(),
  lease_until timestamptz not null default (now()+interval '2 minutes'),
  finished_at timestamptz
);
create unique index ai_one_generation_per_mailbox on auto_mail.ai_reply_drafts(mailbox_id) where status='GENERATING';
create index ai_draft_mailbox_time on auto_mail.ai_reply_drafts(mailbox_id,created_at desc);
alter table auto_mail.ai_reply_drafts enable row level security;
revoke all on auto_mail.ai_reply_drafts from public,anon,authenticated,service_role;
grant select on auto_mail.ai_reply_drafts to service_role;
alter table auto_mail.reply_deliveries add column ai_draft_id uuid references auto_mail.ai_reply_drafts(id);

create function auto_mail.assert_ai_sources(p_sources jsonb,p_scope text) returns void
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare source jsonb; article auto_mail.knowledge_articles;
begin
  if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 5
    or coalesce(length(btrim(p_scope)),0) not between 1 and 80 then raise exception 'AI_INVALID_SOURCES'; end if;
  for source in select value from jsonb_array_elements(p_sources) order by value->>'id' loop
    select * into article from auto_mail.knowledge_articles where id=(source->>'id')::uuid for share;
    if not found or article.status<>'APPROVED' or article.version is distinct from (source->>'version')::integer
      or upper(article.port) not in ('ALL',upper(p_scope)) then raise exception 'AI_SOURCES_CHANGED'; end if;
  end loop;
end; $$;

create function auto_mail.claim_ai_draft(p_request jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare connection auto_mail.gmail_connections; saved auto_mail.ai_reply_drafts;
begin
  select * into connection from auto_mail.gmail_connections where id='system' for update;
  if not found or connection.version is distinct from (p_request->>'connection_version')::uuid
    or connection.mailbox_id is distinct from (p_request->>'mailbox_id')::uuid then raise exception 'CONNECTION_CHANGED'; end if;
  select * into saved from auto_mail.ai_reply_drafts where id=(p_request->>'id')::uuid;
  if found then
    if saved.requested_by is distinct from (p_request->>'requested_by')::uuid or saved.mailbox_id<>connection.mailbox_id
      or saved.conversation_hash is distinct from p_request->>'conversation_hash' or saved.scope is distinct from p_request->>'scope'
      then raise exception 'AI_REQUEST_CHANGED'; end if;
    return jsonb_build_object('claimed',false,'draft',to_jsonb(saved));
  end if;
  update auto_mail.ai_reply_drafts set status='FAILED',error_code='EXPIRED',finished_at=now() where mailbox_id=connection.mailbox_id and status='GENERATING' and lease_until<=now();
  if exists(select 1 from auto_mail.ai_reply_drafts where mailbox_id=connection.mailbox_id and status='GENERATING') then raise exception 'AI_BUSY'; end if;
  if (select count(*) from auto_mail.ai_reply_drafts where mailbox_id=connection.mailbox_id and created_at>now()-interval '1 hour')>=20 then raise exception 'AI_RATE_LIMIT'; end if;
  if exists(select 1 from auto_mail.reply_deliveries where mailbox_id=connection.mailbox_id and source_message_id=p_request->>'source_message_id') then raise exception 'AI_ALREADY_REPLIED'; end if;
  perform auto_mail.assert_ai_sources(p_request->'sources',p_request->>'scope');
  insert into auto_mail.ai_reply_drafts(id,mailbox_id,connection_version,gmail_thread_id,source_message_id,conversation_hash,scope,provider,model,requested_by,sources)
  values((p_request->>'id')::uuid,connection.mailbox_id,connection.version,p_request->>'gmail_thread_id',p_request->>'source_message_id',
    p_request->>'conversation_hash',p_request->>'scope','openai',p_request->>'model',(p_request->>'requested_by')::uuid,p_request->'sources') returning * into saved;
  return jsonb_build_object('claimed',true,'draft',to_jsonb(saved));
end; $$;

create function auto_mail.finish_ai_draft(p_id uuid,p_actor uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare saved auto_mail.ai_reply_drafts; connection auto_mail.gmail_connections; citations uuid[];
begin
  select * into connection from auto_mail.gmail_connections where id='system' for share;
  select * into saved from auto_mail.ai_reply_drafts where id=p_id and requested_by=p_actor for update;
  if not found or saved.status<>'GENERATING' or saved.lease_until<=now() then raise exception 'AI_EXPIRED'; end if;
  if connection.version is distinct from saved.connection_version then raise exception 'CONNECTION_CHANGED'; end if;
  perform auto_mail.assert_ai_sources(saved.sources,saved.scope);
  if p_result->>'status' not in ('READY','NEEDS_REVIEW','NO_ANSWER') or coalesce(length(p_result->>'body_text'),0)>5000
    or coalesce(length(p_result->>'review_notes'),0)>2000 or jsonb_typeof(p_result->'cited_source_ids') is distinct from 'array' then raise exception 'AI_INVALID_OUTPUT'; end if;
  citations:=array(select distinct value::uuid from jsonb_array_elements_text(p_result->'cited_source_ids'));
  if exists(select 1 from unnest(citations) id where not exists(select 1 from jsonb_array_elements(saved.sources) s where (s->>'id')::uuid=id))
    or (p_result->>'status'<>'NO_ANSWER' and (cardinality(citations)=0 or coalesce(length(btrim(p_result->>'body_text')),0)=0))
    or (p_result->>'status'='NO_ANSWER' and coalesce(p_result->>'body_text','')<>'') then raise exception 'AI_INVALID_OUTPUT'; end if;
  update auto_mail.ai_reply_drafts set status=p_result->>'status',body_text=p_result->>'body_text',review_notes=p_result->>'review_notes',
    cited_source_ids=citations,finished_at=now() where id=p_id returning * into saved;
  return to_jsonb(saved);
end; $$;

create function auto_mail.fail_ai_draft(p_id uuid,p_actor uuid) returns void
language sql security definer set search_path=pg_catalog,auto_mail as $$
  update auto_mail.ai_reply_drafts set status='FAILED',error_code='GENERATION_FAILED',finished_at=now() where id=p_id and requested_by=p_actor and status='GENERATING';
$$;

create function auto_mail.validate_ai_draft(p_id uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare saved auto_mail.ai_reply_drafts; connection auto_mail.gmail_connections;
begin
  select * into connection from auto_mail.gmail_connections where id='system' for share;
  select * into saved from auto_mail.ai_reply_drafts where id=p_id and requested_by=p_actor for share;
  if not found or saved.status not in ('READY','NEEDS_REVIEW') then raise exception 'AI_DRAFT_UNAVAILABLE'; end if;
  if connection.version is distinct from saved.connection_version or connection.mailbox_id is distinct from saved.mailbox_id then raise exception 'CONNECTION_CHANGED'; end if;
  perform auto_mail.assert_ai_sources(saved.sources,saved.scope);
  if exists(select 1 from auto_mail.reply_deliveries where mailbox_id=saved.mailbox_id and source_message_id=saved.source_message_id) then raise exception 'AI_ALREADY_REPLIED'; end if;
  return to_jsonb(saved);
end; $$;

-- Keep the original manual-send path, with optional validated AI provenance.
create or replace function auto_mail.claim_manual_reply(p_delivery jsonb) returns uuid
language plpgsql set search_path=pg_catalog,auto_mail as $$
declare connection auto_mail.gmail_connections; delivery_id uuid; draft jsonb;
begin
  select * into connection from auto_mail.gmail_connections where id='system' for update;
  if connection.version is distinct from (p_delivery->>'connection_version')::uuid or connection.mailbox_id is distinct from (p_delivery->>'mailbox_id')::uuid then raise exception 'CONNECTION_CHANGED'; end if;
  if nullif(p_delivery->>'ai_draft_id','') is not null then
    draft:=auto_mail.validate_ai_draft((p_delivery->>'ai_draft_id')::uuid,(p_delivery->>'requested_by')::uuid);
    if draft->>'source_message_id' is distinct from p_delivery->>'source_message_id' or draft->>'gmail_thread_id' is distinct from p_delivery->>'gmail_thread_id'
      or draft->>'conversation_hash' is distinct from p_delivery->>'conversation_hash' then raise exception 'AI_DRAFT_CHANGED'; end if;
  end if;
  delivery_id:=(p_delivery->>'id')::uuid;
  insert into auto_mail.reply_deliveries(id,mailbox_id,gmail_thread_id,source_message_id,connection_version,recipient,body_text,requested_by,ai_draft_id)
  values(delivery_id,connection.mailbox_id,p_delivery->>'gmail_thread_id',p_delivery->>'source_message_id',connection.version,p_delivery->>'recipient',p_delivery->>'body_text',
    (p_delivery->>'requested_by')::uuid,nullif(p_delivery->>'ai_draft_id','')::uuid);
  return delivery_id;
end; $$;

revoke all on function auto_mail.match_knowledge_articles(text,text),auto_mail.assert_ai_sources(jsonb,text),auto_mail.claim_ai_draft(jsonb),
  auto_mail.finish_ai_draft(uuid,uuid,jsonb),auto_mail.fail_ai_draft(uuid,uuid),auto_mail.validate_ai_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function auto_mail.match_knowledge_articles(text,text),auto_mail.assert_ai_sources(jsonb,text),auto_mail.claim_ai_draft(jsonb),
  auto_mail.finish_ai_draft(uuid,uuid,jsonb),auto_mail.fail_ai_draft(uuid,uuid),auto_mail.validate_ai_draft(uuid,uuid) to service_role;
update auto_mail.settings set schema_version=4 where id='system';
notify pgrst,'reload schema';
commit;

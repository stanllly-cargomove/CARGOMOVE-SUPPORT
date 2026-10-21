-- Separate Auto Mail project ONLY. Learning never enables automatic replies.
begin;
alter table auto_mail.settings drop constraint settings_schema_version_check;
alter table auto_mail.settings add constraint settings_schema_version_check check(schema_version in (1,2,3,4,5));
alter table auto_mail.reply_deliveries add column subject text not null default '', add column customer_question text not null default '';
alter table auto_mail.learning_suggestions
  add column source_delivery_id uuid unique references auto_mail.reply_deliveries(id),
  add column reason text not null default 'MANUAL_REPLY' check(reason in ('MANUAL_REPLY','AI_CORRECTION')),
  add column version integer not null default 1,
  add column proposed_summary text not null default '',
  add column proposed_category text not null default 'General',
  add column proposed_port text not null default 'ALL',
  add column proposed_keywords text[] not null default '{}',
  add column evidence jsonb not null default '{}',
  add column created_by uuid,
  add column review_note text not null default '',
  add column published_article_id uuid references auto_mail.knowledge_articles(id),
  add column published_article_version integer,
  add column reviewed_article jsonb;
create index learning_status_time on auto_mail.learning_suggestions(status,created_at desc);
revoke insert,update,delete on auto_mail.learning_suggestions from service_role;

create table auto_mail.learning_events (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references auto_mail.learning_suggestions(id),
  action text not null check(action in ('CREATED','APPROVED','REJECTED')),
  actor_id uuid not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table auto_mail.learning_events enable row level security;
revoke all on auto_mail.learning_events from public,anon,authenticated,service_role;
grant select on auto_mail.learning_events to service_role;

create function auto_mail.propose_learning_from_reply(p_delivery_id uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare delivery auto_mail.reply_deliveries; draft auto_mail.ai_reply_drafts; suggestion auto_mail.learning_suggestions; conversation_id uuid; mailbox_email text;
begin
  if p_actor is null then raise exception 'LEARNING_INVALID_ACTOR'; end if;
  select * into delivery from auto_mail.reply_deliveries where id=p_delivery_id for update;
  if not found or delivery.status<>'SENT' or delivery.gmail_message_id is null then raise exception 'LEARNING_NOT_SENT'; end if;
  select * into suggestion from auto_mail.learning_suggestions where source_delivery_id=p_delivery_id;
  if found then return to_jsonb(suggestion); end if;
  select * into draft from auto_mail.ai_reply_drafts where id=delivery.ai_draft_id;
  select email into mailbox_email from auto_mail.mailboxes where id=delivery.mailbox_id;
  insert into auto_mail.conversations(mailbox_id,gmail_thread_id,subject)
    values(delivery.mailbox_id,delivery.gmail_thread_id,delivery.subject) on conflict(mailbox_id,gmail_thread_id) do nothing;
  select id into conversation_id from auto_mail.conversations where mailbox_id=delivery.mailbox_id and gmail_thread_id=delivery.gmail_thread_id;
  insert into auto_mail.learning_suggestions(conversation_id,proposed_title,proposed_content,source_delivery_id,reason,proposed_port,created_by,evidence)
  values(conversation_id,left(coalesce(nullif(regexp_replace(delivery.subject,'^(Re: *)+','','i'),''),'Support reply'),160),left(delivery.body_text,30000),
    delivery.id,case when draft.id is not null and btrim(draft.body_text) is distinct from btrim(delivery.body_text) then 'AI_CORRECTION' else 'MANUAL_REPLY' end,
    coalesce(draft.scope,'ALL'),p_actor,jsonb_build_object('mailbox',mailbox_email,'thread_id',delivery.gmail_thread_id,
      'gmail_message_id',delivery.gmail_message_id,'source_message_id',delivery.source_message_id,'question',delivery.customer_question,
      'sent_reply',delivery.body_text,'ai_original',draft.body_text,'ai_sources',coalesce(draft.sources,'[]'::jsonb),
      'ai_draft_id',draft.id,'sent_at',delivery.finished_at,'sent_by',delivery.requested_by,'subject',delivery.subject)) returning * into suggestion;
  insert into auto_mail.learning_events(suggestion_id,action,actor_id) values(suggestion.id,'CREATED',p_actor);
  return to_jsonb(suggestion);
end; $$;

create function auto_mail.finish_manual_reply(p_id uuid,p_actor uuid,p_gmail_message_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare delivery auto_mail.reply_deliveries; draft auto_mail.ai_reply_drafts; suggestion jsonb;
begin
  if coalesce(length(btrim(p_gmail_message_id)),0)=0 then raise exception 'LEARNING_INVALID_RECEIPT'; end if;
  select * into delivery from auto_mail.reply_deliveries where id=p_id and requested_by=p_actor for update;
  if not found or delivery.status not in ('SENDING','SENT') then raise exception 'LEARNING_INVALID_DELIVERY'; end if;
  if delivery.status='SENT' and delivery.gmail_message_id is distinct from p_gmail_message_id then raise exception 'LEARNING_RECEIPT_CHANGED'; end if;
  update auto_mail.reply_deliveries set status='SENT',gmail_message_id=p_gmail_message_id,finished_at=coalesce(finished_at,clock_timestamp()) where id=p_id returning * into delivery;
  select * into draft from auto_mail.ai_reply_drafts where id=delivery.ai_draft_id;
  if draft.id is not null and btrim(draft.body_text) is distinct from btrim(delivery.body_text) then
    suggestion:=auto_mail.propose_learning_from_reply(p_id,p_actor);
  end if;
  return jsonb_build_object('delivery_id',p_id,'learning_queued',suggestion is not null,'suggestion_id',suggestion->>'id');
end; $$;

create function auto_mail.list_learning_suggestions(p_status text default 'PENDING',p_offset integer default 0) returns jsonb
language sql stable security definer set search_path=pg_catalog,auto_mail as $$
  with filtered as (select * from auto_mail.learning_suggestions where coalesce(p_status,'')='' or status=p_status),
  page as (select * from filtered order by created_at desc,id limit 25 offset greatest(0,least(100000,coalesce(p_offset,0))))
  select jsonb_build_object('suggestions',coalesce((select jsonb_agg(to_jsonb(p)-'evidence'-'proposed_content'-'reviewed_article' order by created_at desc,id) from page p),'[]'::jsonb),'total',(select count(*) from filtered));
$$;

create function auto_mail.review_learning_suggestion(p_id uuid,p_expected_version integer,p_action text,p_article jsonb,p_target_id uuid,p_target_version integer,p_note text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare suggestion auto_mail.learning_suggestions; article jsonb;
begin
  if p_actor is null then raise exception 'LEARNING_INVALID_ACTOR'; end if;
  if p_action not in ('APPROVE','REJECT') or p_action is null or length(coalesce(p_note,''))>2000 then raise exception 'LEARNING_INVALID_REVIEW'; end if;
  select * into suggestion from auto_mail.learning_suggestions where id=p_id for update;
  if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
  if suggestion.version is distinct from p_expected_version or suggestion.status<>'PENDING' then raise exception 'LEARNING_CONFLICT'; end if;
  if p_action='REJECT' then
    if coalesce(length(btrim(p_note)),0)=0 then raise exception 'LEARNING_REJECTION_NOTE_REQUIRED'; end if;
    update auto_mail.learning_suggestions set status='REJECTED',reviewed_by=p_actor,reviewed_at=clock_timestamp(),review_note=btrim(p_note),version=version+1 where id=p_id returning * into suggestion;
  else
    -- KB save enforces target-version concurrency, validation and revision history.
    article:=auto_mail.save_knowledge_article(p_target_id,p_target_version,p_article,p_actor);
    article:=auto_mail.review_knowledge_article((article->>'id')::uuid,(article->>'version')::integer,'APPROVE',p_actor);
    update auto_mail.learning_suggestions set status='APPROVED',reviewed_by=p_actor,reviewed_at=clock_timestamp(),review_note=coalesce(p_note,''),
      version=version+1,published_article_id=(article->>'id')::uuid,published_article_version=(article->>'version')::integer,reviewed_article=article
    where id=p_id returning * into suggestion;
  end if;
  insert into auto_mail.learning_events(suggestion_id,action,actor_id,detail)
  values(p_id,case p_action when 'APPROVE' then 'APPROVED' else 'REJECTED' end,p_actor,jsonb_build_object('note',p_note,'article_id',suggestion.published_article_id,'article_version',suggestion.published_article_version));
  return to_jsonb(suggestion);
end; $$;

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
  insert into auto_mail.reply_deliveries(id,mailbox_id,gmail_thread_id,source_message_id,connection_version,recipient,body_text,requested_by,ai_draft_id,subject,customer_question)
  values(delivery_id,connection.mailbox_id,p_delivery->>'gmail_thread_id',p_delivery->>'source_message_id',connection.version,p_delivery->>'recipient',p_delivery->>'body_text',
    (p_delivery->>'requested_by')::uuid,nullif(p_delivery->>'ai_draft_id','')::uuid,left(coalesce(p_delivery->>'subject',''),998),left(coalesce(p_delivery->>'customer_question',''),10000));
  return delivery_id;
end; $$;

revoke all on function auto_mail.propose_learning_from_reply(uuid,uuid),auto_mail.finish_manual_reply(uuid,uuid,text),auto_mail.list_learning_suggestions(text,integer),
  auto_mail.review_learning_suggestion(uuid,integer,text,jsonb,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function auto_mail.propose_learning_from_reply(uuid,uuid),auto_mail.finish_manual_reply(uuid,uuid,text),auto_mail.list_learning_suggestions(text,integer),
  auto_mail.review_learning_suggestion(uuid,integer,text,jsonb,uuid,integer,text,uuid) to service_role;
update auto_mail.settings set schema_version=5 where id='system';
notify pgrst,'reload schema';
commit;

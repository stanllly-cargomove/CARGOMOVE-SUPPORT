-- Milestone 7: explicit staff actions only. Durable write receipts prevent blind retries.
begin;
create table public.support_reply_deliveries (
 id uuid primary key, case_id uuid not null references public.support_cases(id) on delete restrict,
 draft_id uuid not null references public.support_reply_drafts(id) on delete restrict,
 kind text not null check(kind in ('SEND','GMAIL_DRAFT')),
 status text not null default 'IN_FLIGHT' check(status in ('IN_FLIGHT','UNKNOWN','FAILED','DONE')),
 operation_key text not null, context_fingerprint text not null,
 source_message_id uuid not null references public.support_messages(id) on delete restrict,
 draft_version timestamptz not null, mailbox_subject text not null, mailbox_email text not null,
 recipient_email text not null, subject text not null, reply_text text not null, generated_reply text not null,
 rfc_message_id text not null unique, gmail_message_id text, gmail_draft_id text,
 requested_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(), completed_at timestamptz
);
create unique index support_delivery_active_key on public.support_reply_deliveries(operation_key) where status <> 'FAILED';
create unique index support_delivery_pending_case on public.support_reply_deliveries(case_id) where status in ('IN_FLIGHT','UNKNOWN');
create unique index support_delivery_sent_context on public.support_reply_deliveries(case_id,source_message_id) where kind='SEND' and status='DONE';
create index support_delivery_case on public.support_reply_deliveries(case_id,created_at desc);
create table public.support_case_events (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.support_cases(id) on delete restrict,
 action text not null check(action in ('ESCALATE','RESOLVE','REOPEN')), from_status text not null, to_status text not null,
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 actor_id uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default clock_timestamp()
);
alter table public.support_reply_deliveries enable row level security;
alter table public.support_case_events enable row level security;
revoke all on public.support_reply_deliveries,public.support_case_events from public,anon,authenticated;
grant select,insert,update,delete on public.support_reply_deliveries,public.support_case_events to service_role;

create function public.support_delivery_state(p_case uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('recipient',c.customer_email,'deliveries',coalesce((select jsonb_agg(to_jsonb(d) order by created_at desc,id desc) from public.support_reply_deliveries d where d.case_id=c.id),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc,id desc) from public.support_case_events e where e.case_id=c.id),'[]'::jsonb)) from public.support_cases c where c.id=p_case;
$$;
create function public.claim_support_delivery(p_draft uuid,p_expected timestamptz,p_case_version timestamptz,p_kind text,p_id uuid,p_admin uuid,p_mailbox text,p_email text,p_subject text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare c public.support_cases; d public.support_reply_drafts; existing public.support_reply_deliveries; op public.support_reply_deliveries; key text;
begin
 select * into d from public.support_reply_drafts where id=p_draft;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 select * into c from public.support_cases where id=d.case_id for update;
 select * into d from public.support_reply_drafts where id=p_draft for update;
 if p_kind is null or p_kind not in ('SEND','GMAIL_DRAFT') then return jsonb_build_object('error','INVALID_ACTION'); end if;
 key:=md5(jsonb_build_array(d.id,d.updated_at,p_kind)::text);
 select * into existing from public.support_reply_deliveries where operation_key=key and status <> 'FAILED';
 if found then return jsonb_build_object('operation',to_jsonb(existing),'cached',true); end if;
 if exists(select 1 from public.support_reply_deliveries where case_id=c.id and status in ('IN_FLIGHT','UNKNOWN')) then return jsonb_build_object('error','PENDING'); end if;
 if exists(select 1 from public.support_reply_deliveries where case_id=c.id and kind='SEND' and status='DONE' and source_message_id=(select id from public.support_messages where case_id=c.id and direction='INBOUND' order by sent_at desc,id desc limit 1)) then return jsonb_build_object('error','ALREADY_SENT'); end if;
 if d.updated_at is distinct from p_expected or c.updated_at is distinct from p_case_version then return jsonb_build_object('error','CONFLICT'); end if;
 perform id from public.support_knowledge where id::text in (select jsonb_object_keys(d.knowledge_versions)) order by id for share;
 if (public.get_support_reply(c.id,d.id)->'draft'->>'stale')::boolean then return jsonb_build_object('error','STALE'); end if;
 if c.gmail_thread_id is null or not exists(select 1 from public.gmail_connections g join public.gmail_sync_state s on s.id=g.id where g.id='system' and g.status='ACTIVE' and g.google_subject=p_mailbox and s.google_subject=p_mailbox and lower(g.email)=lower(p_email)) then return jsonb_build_object('error','MAILBOX_CHANGED'); end if;
 insert into public.support_reply_deliveries(id,case_id,draft_id,kind,operation_key,context_fingerprint,source_message_id,draft_version,mailbox_subject,mailbox_email,recipient_email,subject,reply_text,generated_reply,rfc_message_id,requested_by)
 values(p_id,c.id,d.id,p_kind,key,d.context_fingerprint,(select id from public.support_messages where case_id=c.id and direction='INBOUND' order by sent_at desc,id desc limit 1),d.updated_at,p_mailbox,p_email,c.customer_email,p_subject,d.edited_reply,(select generated_reply from public.ai_interactions where id=d.interaction_id),'<'||p_id::text||'@cargomove.support>',p_admin) returning * into op;
 return jsonb_build_object('operation',to_jsonb(op),'cached',false);
end;$$;
create function public.finish_support_delivery(p_id uuid,p_message text,p_thread text,p_draft text,p_sent_at timestamptz) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare op public.support_reply_deliveries; c public.support_cases; d public.support_reply_drafts; other public.support_messages;
begin
 select * into op from public.support_reply_deliveries where id=p_id;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 select * into c from public.support_cases where id=op.case_id for update;
 select * into op from public.support_reply_deliveries where id=p_id for update;
 if op.status='DONE' then return to_jsonb(op); end if;
 if op.status not in ('IN_FLIGHT','UNKNOWN') or p_message is null or p_message !~ '^[a-zA-Z0-9_-]{1,128}$' or p_thread is distinct from c.gmail_thread_id or p_sent_at is null then return jsonb_build_object('error','INVALID_RECEIPT'); end if;
 if op.kind='SEND' then
  select * into d from public.support_reply_drafts where id=op.draft_id;
  select * into other from public.support_messages where gmail_message_id=p_message;
  if found and (other.case_id<>c.id or other.direction<>'OUTBOUND') then return jsonb_build_object('error','INVALID_RECEIPT'); end if;
  insert into public.support_messages(case_id,gmail_message_id,gmail_thread_id,direction,sender_email,recipient_email,subject,body_text,sent_at)
  values(c.id,p_message,p_thread,'OUTBOUND',op.mailbox_email,op.recipient_email,op.subject,op.reply_text,p_sent_at) on conflict(gmail_message_id) do update set body_text=excluded.body_text,subject=excluded.subject,sender_email=excluded.sender_email,recipient_email=excluded.recipient_email;
  update public.ai_interactions set final_reply=op.reply_text,was_edited=(generated_reply is distinct from op.reply_text),approved_by=op.requested_by,approved_at=op.created_at where id=d.interaction_id;
  update public.support_cases set status=case when status='ESCALATED' then 'ESCALATED' else 'WAITING_CUSTOMER' end,resolved_at=null where id=c.id;
 elsif p_draft is null or p_draft !~ '^[a-zA-Z0-9_-]{1,128}$' then return jsonb_build_object('error','INVALID_RECEIPT');
 end if;
 update public.support_reply_deliveries set status='DONE',gmail_message_id=p_message,gmail_draft_id=p_draft,completed_at=clock_timestamp() where id=p_id returning * into op;
 return to_jsonb(op);
end;$$;
create function public.fail_support_delivery(p_id uuid,p_uncertain boolean) returns void language sql set search_path=pg_catalog,public as $$
 update public.support_reply_deliveries set status=case when p_uncertain then 'UNKNOWN' else 'FAILED' end where id=p_id and status='IN_FLIGHT';
$$;
create function public.set_support_case_status(p_id uuid,p_expected timestamptz,p_action text,p_reason text,p_admin uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare c public.support_cases; target text;
begin
 select * into c from public.support_cases where id=p_id for update;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 if c.updated_at is distinct from p_expected then return jsonb_build_object('error','CONFLICT'); end if;
 if exists(select 1 from public.support_reply_deliveries where case_id=c.id and status in ('IN_FLIGHT','UNKNOWN')) then return jsonb_build_object('error','PENDING'); end if;
 target:=case p_action when 'ESCALATE' then 'ESCALATED' when 'RESOLVE' then 'RESOLVED' when 'REOPEN' then 'NEW' end;
 if target is null or c.status=target or (c.status='RESOLVED' and p_action<>'REOPEN') or (p_action='REOPEN' and c.status<>'RESOLVED') then return jsonb_build_object('error','INVALID_ACTION'); end if;
 insert into public.support_case_events(case_id,action,from_status,to_status,reason,actor_id) values(c.id,p_action,c.status,target,p_reason,p_admin);
 update public.support_cases set status=target,resolved_at=case when target='RESOLVED' then clock_timestamp() else null end where id=c.id;
 return public.support_delivery_state(c.id);
end;$$;
-- Fence edits after approval or while a Gmail outcome is uncertain.
create or replace function public.edit_support_reply(p_id uuid,p_expected timestamptz,p_text text,p_admin uuid)returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare d public.support_reply_drafts; c public.support_cases;
begin
 select * into d from public.support_reply_drafts where id=p_id;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 select * into c from public.support_cases where id=d.case_id for update;
 select * into d from public.support_reply_drafts where id=p_id for update;
 if exists(select 1 from public.support_reply_deliveries where case_id=c.id and status in ('IN_FLIGHT','UNKNOWN')) then return jsonb_build_object('error','PENDING'); end if;
 if exists(select 1 from public.support_reply_deliveries where draft_id=d.id and kind='SEND' and status='DONE') then return jsonb_build_object('error','ALREADY_SENT'); end if;
 if d.updated_at is distinct from p_expected then return jsonb_build_object('error','CONFLICT'); end if;
 if (public.get_support_reply(d.case_id,d.id)->'draft'->>'stale')::boolean then return jsonb_build_object('error','STALE'); end if;
 update public.support_reply_drafts set edited_reply=p_text,updated_by=p_admin where id=p_id;
 return public.get_support_reply(d.case_id,d.id);
end;$$;
revoke all on function public.support_delivery_state(uuid),public.claim_support_delivery(uuid,timestamptz,timestamptz,text,uuid,uuid,text,text,text),public.finish_support_delivery(uuid,text,text,text,timestamptz),public.fail_support_delivery(uuid,boolean),public.set_support_case_status(uuid,timestamptz,text,text,uuid) from public,anon,authenticated;
grant execute on function public.support_delivery_state(uuid),public.claim_support_delivery(uuid,timestamptz,timestamptz,text,uuid,uuid,text,text,text),public.finish_support_delivery(uuid,text,text,text,timestamptz),public.fail_support_delivery(uuid,boolean),public.set_support_case_status(uuid,timestamptz,text,text,uuid) to service_role;
create function public.support_delivery_context(p_case uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('supportCase',to_jsonb(c),'message_ids',coalesce((select jsonb_agg(gmail_message_id) from public.support_messages where case_id=c.id and gmail_message_id is not null),'[]'::jsonb),
 'inbound',(select to_jsonb(m) from public.support_messages m where case_id=c.id and direction='INBOUND' order by sent_at desc,id desc limit 1)) from public.support_cases c where c.id=p_case;
$$;
revoke all on function public.support_delivery_context(uuid) from public,anon,authenticated;
grant execute on function public.support_delivery_context(uuid) to service_role;
commit;

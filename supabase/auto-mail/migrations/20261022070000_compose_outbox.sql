-- Separate Auto Mail project ONLY. New tables, functions and private bucket.
begin;
insert into storage.buckets(id,name,public,file_size_limit)
values('auto-mail-outbox','auto-mail-outbox',false,26214400);
create policy auto_mail_outbox_private on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'auto-mail-outbox') with check(bucket_id<>'auto-mail-outbox');

create table auto_mail.outbox_messages (
  id uuid primary key,
  actor_id uuid not null,
  mailbox_id uuid not null references auto_mail.mailboxes(id),
  connection_version uuid not null,
  subject text not null check(length(subject) between 1 and 998),
  to_addresses text[] not null check(cardinality(to_addresses)>0),
  cc_addresses text[] not null default '{}',
  bcc_addresses text[] not null default '{}',
  body_text text not null check(length(body_text)<=50000),
  attachments jsonb not null default '[]',
  raw_path text not null unique,
  raw_sha256 text not null check(raw_sha256 ~ '^[a-f0-9]{64}$'),
  scheduled boolean not null,
  send_at timestamptz not null,
  status text not null default 'QUEUED' check(status in ('QUEUED','SENDING','SENT','CANCELLED','FAILED','UNCERTAIN')),
  gmail_message_id text,
  gmail_thread_id text,
  error text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check(cardinality(to_addresses)+cardinality(cc_addresses)+cardinality(bcc_addresses)<=30)
);
create index outbox_due on auto_mail.outbox_messages(status,send_at);
create table auto_mail.outbox_worker_state(id text primary key check(id='system'),last_seen timestamptz not null);
alter table auto_mail.outbox_messages enable row level security;
alter table auto_mail.outbox_worker_state enable row level security;
revoke all on auto_mail.outbox_messages,auto_mail.outbox_worker_state from public,anon,authenticated,service_role;
grant select,insert on auto_mail.outbox_messages to service_role;
grant select on auto_mail.outbox_worker_state to service_role;

create function auto_mail.claim_outbox_message(p_id uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare job auto_mail.outbox_messages;
begin
  -- A stopped worker never silently retries a send that Gmail might have accepted.
  update auto_mail.outbox_messages set status='UNCERTAIN',error='Delivery interrupted. Check Gmail Sent before composing another message.',finished_at=now()
    where status='SENDING' and started_at<now()-interval '10 minutes';
  select * into job from auto_mail.outbox_messages
    where status='QUEUED' and send_at<=now() and (p_id is null or id=p_id)
    order by send_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  update auto_mail.outbox_messages set status='SENDING',started_at=clock_timestamp() where id=job.id returning * into job;
  return to_jsonb(job);
end; $$;
create function auto_mail.finish_outbox_message(p_id uuid,p_status text,p_message_id text default null,p_thread_id text default null,p_error text default '') returns void
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
begin
  if p_status not in ('SENT','FAILED','UNCERTAIN') or (p_status='SENT' and coalesce(length(p_message_id),0)=0) then raise exception 'OUTBOX_INVALID_RESULT'; end if;
  update auto_mail.outbox_messages set status=p_status,gmail_message_id=p_message_id,gmail_thread_id=p_thread_id,error=left(coalesce(p_error,''),500),finished_at=clock_timestamp()
    where id=p_id and status='SENDING';
  if not found then raise exception 'OUTBOX_CONFLICT'; end if;
end; $$;
create function auto_mail.cancel_outbox_message(p_id uuid,p_mailbox uuid) returns void
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
begin
  update auto_mail.outbox_messages set status='CANCELLED',finished_at=clock_timestamp() where id=p_id and mailbox_id=p_mailbox and status='QUEUED';
  if not found then raise exception 'OUTBOX_ALREADY_STARTED'; end if;
end; $$;
create function auto_mail.outbox_worker_heartbeat() returns void
language sql security definer set search_path=pg_catalog,auto_mail as $$
  insert into auto_mail.outbox_worker_state(id,last_seen) values('system',clock_timestamp())
  on conflict(id) do update set last_seen=excluded.last_seen;
$$;
revoke all on function auto_mail.claim_outbox_message(uuid),auto_mail.finish_outbox_message(uuid,text,text,text,text),auto_mail.cancel_outbox_message(uuid,uuid),auto_mail.outbox_worker_heartbeat() from public,anon,authenticated;
grant execute on function auto_mail.claim_outbox_message(uuid),auto_mail.finish_outbox_message(uuid,text,text,text,text),auto_mail.cancel_outbox_message(uuid,uuid),auto_mail.outbox_worker_heartbeat() to service_role;
notify pgrst,'reload schema';
commit;

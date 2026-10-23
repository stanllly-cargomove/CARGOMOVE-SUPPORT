-- Run only in the separate Auto Mail database, after compose_outbox.
begin;
alter table auto_mail.outbox_messages add column reply_context jsonb;
create function auto_mail.queue_scheduled_reply(p_delivery jsonb,p_detail jsonb,p_job jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare existing auto_mail.outbox_messages; connection auto_mail.gmail_connections; delivery_id uuid;
begin
  select * into connection from auto_mail.gmail_connections where id='system' for update;
  if connection.version is distinct from (p_delivery->>'connection_version')::uuid or connection.mailbox_id is distinct from (p_delivery->>'mailbox_id')::uuid then raise exception 'CONNECTION_CHANGED'; end if;
  select * into existing from auto_mail.outbox_messages where id=(p_delivery->>'id')::uuid;
  if found then
    if existing.actor_id is distinct from (p_delivery->>'requested_by')::uuid or existing.mailbox_id is distinct from connection.mailbox_id or existing.reply_context is null then raise exception 'OUTBOX_CONFLICT'; end if;
    return existing.id;
  end if;
  if (p_job->>'send_at')::timestamptz<clock_timestamp()+interval '2 minutes' or (p_job->>'send_at')::timestamptz>clock_timestamp()+interval '90 days' then raise exception 'OUTBOX_INVALID_TIME'; end if;
  delivery_id:=auto_mail.claim_rich_reply(p_delivery,p_detail);
  insert into auto_mail.outbox_messages(id,actor_id,mailbox_id,connection_version,subject,to_addresses,cc_addresses,bcc_addresses,body_text,attachments,raw_path,raw_sha256,scheduled,send_at,reply_context)
  values(delivery_id,(p_delivery->>'requested_by')::uuid,connection.mailbox_id,connection.version,left(p_delivery->>'subject',998),array(select jsonb_array_elements_text(p_detail->'to')),array(select jsonb_array_elements_text(p_detail->'cc')),array(select jsonb_array_elements_text(p_detail->'bcc')),p_delivery->>'body_text',p_detail->'attachments',p_job->>'raw_path',p_job->>'raw_sha256',true,(p_job->>'send_at')::timestamptz,p_job->'reply_context');
  return delivery_id;
end; $$;
revoke all on function auto_mail.queue_scheduled_reply(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function auto_mail.queue_scheduled_reply(jsonb,jsonb,jsonb) to service_role;
create or replace function auto_mail.cancel_outbox_message(p_id uuid,p_mailbox uuid) returns void
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare context jsonb;
begin
  update auto_mail.outbox_messages set status='CANCELLED',finished_at=clock_timestamp() where id=p_id and mailbox_id=p_mailbox and status='QUEUED' returning reply_context into context;
  if not found then raise exception 'OUTBOX_ALREADY_STARTED'; end if;
  if context is not null then
    delete from auto_mail.reply_details where delivery_id=p_id;
    delete from auto_mail.reply_deliveries where id=p_id and status='SENDING';
  end if;
end; $$;
create or replace function auto_mail.finish_outbox_message(p_id uuid,p_status text,p_message_id text default null,p_thread_id text default null,p_error text default '') returns void
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare context jsonb;
begin
  if p_status not in ('SENT','FAILED','UNCERTAIN') or (p_status='SENT' and coalesce(length(p_message_id),0)=0) then raise exception 'OUTBOX_INVALID_RESULT'; end if;
  update auto_mail.outbox_messages set status=p_status,gmail_message_id=p_message_id,gmail_thread_id=p_thread_id,error=left(coalesce(p_error,''),500),finished_at=clock_timestamp()
    where id=p_id and status='SENDING' returning reply_context into context;
  if not found then raise exception 'OUTBOX_CONFLICT'; end if;
  if context is not null and p_status='FAILED' then
    delete from auto_mail.reply_details where delivery_id=p_id;
    delete from auto_mail.reply_deliveries where id=p_id and status='SENDING';
  elsif context is not null and p_status='UNCERTAIN' then
    update auto_mail.reply_deliveries set status='UNKNOWN',finished_at=clock_timestamp() where id=p_id and status='SENDING';
  end if;
end; $$;
notify pgrst,'reload schema';
commit;

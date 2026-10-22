-- Separate Auto Mail project ONLY. Adds a private bucket and new tables. Existing application tables are unchanged.
begin;
insert into storage.buckets(id,name,public,file_size_limit) values('auto-mail-attachments','auto-mail-attachments',false,15728640);
-- Existing broad Storage policies must not expose the new mailbox bucket.
create policy auto_mail_private_objects on storage.objects as restrictive for all to anon,authenticated
  using(bucket_id<>'auto-mail-attachments') with check(bucket_id<>'auto-mail-attachments');
create table auto_mail.reply_uploads (
  id uuid primary key,
  request_id uuid not null,
  actor_id uuid not null,
  mailbox_id uuid not null references auto_mail.mailboxes(id),
  connection_version uuid not null,
  gmail_thread_id text not null,
  source_message_id text not null,
  path text not null unique,
  name text not null,
  mime_type text not null,
  size integer not null check(size between 1 and 15728640),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '24 hours')
);
create index reply_upload_request on auto_mail.reply_uploads(request_id,actor_id);
create table auto_mail.reply_details (
  delivery_id uuid primary key references auto_mail.reply_deliveries(id),
  to_addresses text[] not null,
  cc_addresses text[] not null default '{}',
  bcc_addresses text[] not null default '{}',
  body_html text not null check(length(body_html)<=200000),
  attachments jsonb not null default '[]' check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=10),
  created_at timestamptz not null default now()
);
alter table auto_mail.reply_uploads enable row level security;
alter table auto_mail.reply_details enable row level security;
revoke all on auto_mail.reply_uploads,auto_mail.reply_details from public,anon,authenticated,service_role;
grant select,insert,delete on auto_mail.reply_uploads to service_role;
grant select on auto_mail.reply_details to service_role;

create function auto_mail.claim_rich_reply(p_delivery jsonb,p_detail jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare delivery_id uuid; item jsonb; upload auto_mail.reply_uploads; total integer:=0; seen uuid[]:='{}';
begin
  if jsonb_typeof(p_detail->'attachments') is distinct from 'array' or jsonb_array_length(p_detail->'attachments')>10
    or jsonb_typeof(p_detail->'to') is distinct from 'array' or jsonb_typeof(p_detail->'cc') is distinct from 'array'
    or jsonb_typeof(p_detail->'bcc') is distinct from 'array' or length(coalesce(p_detail->>'html',''))>200000
    or jsonb_array_length(p_detail->'to')<1 or jsonb_array_length(p_detail->'to')+jsonb_array_length(p_detail->'cc')+jsonb_array_length(p_detail->'bcc')>30
    then raise exception 'REPLY_INVALID_DETAIL'; end if;
  for item in select value from jsonb_array_elements(p_detail->'attachments') order by value->>'id' loop
    select * into upload from auto_mail.reply_uploads where id=(item->>'id')::uuid for update;
    if not found or upload.id=any(seen) or upload.request_id is distinct from (p_delivery->>'id')::uuid
      or upload.actor_id is distinct from (p_delivery->>'requested_by')::uuid or upload.mailbox_id is distinct from (p_delivery->>'mailbox_id')::uuid
      or upload.connection_version is distinct from (p_delivery->>'connection_version')::uuid
      or upload.gmail_thread_id is distinct from p_delivery->>'gmail_thread_id' or upload.source_message_id is distinct from p_delivery->>'source_message_id'
      or upload.expires_at<=now() or upload.size is distinct from (item->>'size')::integer
      or upload.path is distinct from item->>'path' or upload.name is distinct from item->>'name' or upload.mime_type is distinct from item->>'type'
      or coalesce(item->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'REPLY_UPLOAD_CHANGED'; end if;
    seen:=array_append(seen,upload.id); total:=total+upload.size;
  end loop;
  if total>15728640 then raise exception 'REPLY_TOO_LARGE'; end if;
  delivery_id:=auto_mail.claim_manual_reply(p_delivery);
  insert into auto_mail.reply_details(delivery_id,to_addresses,cc_addresses,bcc_addresses,body_html,attachments)
  values(delivery_id,array(select jsonb_array_elements_text(p_detail->'to')),array(select jsonb_array_elements_text(p_detail->'cc')),
    array(select jsonb_array_elements_text(p_detail->'bcc')),coalesce(p_detail->>'html',''),p_detail->'attachments');
  return delivery_id;
end; $$;
revoke all on function auto_mail.claim_rich_reply(jsonb,jsonb) from public,anon,authenticated;
grant execute on function auto_mail.claim_rich_reply(jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

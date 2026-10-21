-- Auto Mail project ONLY. No changes to the main CargoMove database.
begin;
alter table auto_mail.settings drop constraint settings_schema_version_check;
alter table auto_mail.settings add constraint settings_schema_version_check check (schema_version in (1, 2));

create table auto_mail.gmail_connections (
  id text primary key check (id = 'system'),
  mailbox_id uuid not null references auto_mail.mailboxes(id),
  google_subject text not null,
  email text not null,
  refresh_token_ciphertext text not null,
  token_iv text not null,
  token_auth_tag text not null,
  scopes text[] not null,
  connected_by uuid not null,
  connected_at timestamptz not null default now(),
  version uuid not null default gen_random_uuid()
);
create table auto_mail.oauth_states (
  state_hash text primary key,
  pkce_verifier text not null,
  admin_id uuid not null,
  expires_at timestamptz not null
);
create table auto_mail.reply_deliveries (
  id uuid primary key,
  mailbox_id uuid not null references auto_mail.mailboxes(id),
  gmail_thread_id text not null,
  source_message_id text not null,
  connection_version uuid not null,
  recipient text not null,
  body_text text not null,
  requested_by uuid not null,
  status text not null default 'SENDING' check (status in ('SENDING', 'SENT', 'UNKNOWN')),
  gmail_message_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- One manual reply per latest inbound message. Uncertain sends cannot be retried.
  unique (mailbox_id, source_message_id)
);
alter table auto_mail.gmail_connections enable row level security;
alter table auto_mail.oauth_states enable row level security;
alter table auto_mail.reply_deliveries enable row level security;
revoke all on auto_mail.gmail_connections, auto_mail.oauth_states, auto_mail.reply_deliveries from public, anon, authenticated;
grant select, insert, update, delete on auto_mail.gmail_connections, auto_mail.oauth_states, auto_mail.reply_deliveries to service_role;

-- Serialize connection replacement with delivery admission. Pending/uncertain
-- requests are preserved across reconnects and are never automatically resent.
create function auto_mail.claim_manual_reply(p_delivery jsonb) returns uuid
language plpgsql set search_path = pg_catalog, auto_mail as $$
declare connection auto_mail.gmail_connections; delivery_id uuid;
begin
  select * into connection from auto_mail.gmail_connections where id = 'system' for update;
  if connection.version is distinct from (p_delivery->>'connection_version')::uuid
    or connection.mailbox_id is distinct from (p_delivery->>'mailbox_id')::uuid then
    raise exception 'CONNECTION_CHANGED';
  end if;
  delivery_id := (p_delivery->>'id')::uuid;
  insert into auto_mail.reply_deliveries(id, mailbox_id, gmail_thread_id, source_message_id,
    connection_version, recipient, body_text, requested_by)
  values(delivery_id, connection.mailbox_id, p_delivery->>'gmail_thread_id', p_delivery->>'source_message_id',
    connection.version, p_delivery->>'recipient', p_delivery->>'body_text', (p_delivery->>'requested_by')::uuid);
  return delivery_id;
end; $$;
revoke all on function auto_mail.claim_manual_reply(jsonb) from public, anon, authenticated;
grant execute on function auto_mail.claim_manual_reply(jsonb) to service_role;
update auto_mail.settings set schema_version = 2 where id = 'system';
notify pgrst, 'reload schema';
commit;

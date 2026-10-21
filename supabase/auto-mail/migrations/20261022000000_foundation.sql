-- Apply ONLY to the separate Auto Mail development project.
-- Intentionally outside supabase/migrations: never part of the main DB rollout.
begin;
create schema auto_mail;
revoke all on schema auto_mail from public, anon, authenticated;
grant usage on schema auto_mail to service_role;
alter default privileges in schema auto_mail revoke all on tables from public, anon, authenticated;

create table auto_mail.settings (
  id text primary key check (id = 'system'),
  schema_version integer not null check (schema_version = 1),
  reply_mode text not null default 'DRAFT_ONLY' check (reply_mode = 'DRAFT_ONLY'),
  created_at timestamptz not null default now()
);
insert into auto_mail.settings(id, schema_version) values ('system', 1);

-- Tokens are deliberately excluded until the dedicated Gmail OAuth milestone.
create table auto_mail.mailboxes (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'DISCONNECTED' check (status in ('DISCONNECTED', 'CONNECTED', 'ERROR')),
  created_at timestamptz not null default now()
);
create table auto_mail.conversations (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references auto_mail.mailboxes(id),
  gmail_thread_id text not null,
  subject text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'NEEDS_REVIEW')),
  created_at timestamptz not null default now(),
  unique (mailbox_id, gmail_thread_id),
  unique (id, mailbox_id)
);
create table auto_mail.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  mailbox_id uuid not null,
  gmail_message_id text not null,
  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  sender_email text not null,
  body_text text not null default '',
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, mailbox_id) references auto_mail.conversations(id, mailbox_id),
  unique (mailbox_id, gmail_message_id),
  unique (id, conversation_id)
);
create index messages_conversation_time on auto_mail.messages(conversation_id, received_at);

create table auto_mail.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  content text not null check (length(btrim(content)) > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'ARCHIVED')),
  version integer not null default 1 check (version > 0),
  -- Actor IDs refer to the main application's session, with no cross-project FK.
  created_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'APPROVED' or (approved_by is not null and approved_at is not null))
);
create table auto_mail.reply_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references auto_mail.conversations(id),
  source_message_id uuid not null,
  body_text text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'DISCARDED')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (source_message_id, conversation_id) references auto_mail.messages(id, conversation_id)
);
create table auto_mail.learning_suggestions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references auto_mail.conversations(id),
  proposed_title text not null,
  proposed_content text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status = 'PENDING' or (reviewed_by is not null and reviewed_at is not null))
);

alter table auto_mail.settings enable row level security;
alter table auto_mail.mailboxes enable row level security;
alter table auto_mail.conversations enable row level security;
alter table auto_mail.messages enable row level security;
alter table auto_mail.knowledge_articles enable row level security;
alter table auto_mail.reply_drafts enable row level security;
alter table auto_mail.learning_suggestions enable row level security;
revoke all on all tables in schema auto_mail from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema auto_mail to service_role;
commit;

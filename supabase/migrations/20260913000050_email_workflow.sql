-- Manual CargoMove welcome-email workflow.
-- A user must be DONE before an administrator can preview and send the email.

alter table public.external_user_access
  add column if not exists status text not null default 'PENDING',
  add column if not exists email_sent smallint not null default 0,
  add column if not exists email_status text not null default 'NOT_READY';

update public.external_user_access
set
  status = case when status in ('PENDING', 'DONE', 'REJECTED') then status else 'PENDING' end,
  email_sent = case when email_sent in (0, 1) then email_sent else 0 end,
  email_status = case
    when email_sent = 1 then 'SENT'
    when status = 'DONE' then 'READY'
    else 'NOT_READY'
  end;

alter table public.external_user_access
  drop constraint if exists external_user_access_status_check,
  drop constraint if exists external_user_access_email_sent_check,
  drop constraint if exists external_user_access_email_status_check;

alter table public.external_user_access
  add constraint external_user_access_status_check check (status in ('PENDING', 'DONE', 'REJECTED')),
  add constraint external_user_access_email_sent_check check (email_sent in (0, 1)),
  add constraint external_user_access_email_status_check
    check (email_status in ('NOT_READY', 'READY', 'SENDING', 'SENT', 'FAILED'));

create or replace function public.sync_external_user_email_status()
returns trigger language plpgsql as $$
begin
  if new.status <> 'DONE' then
    new.email_status = 'NOT_READY';
    new.email_sent = 0;
  elsif tg_op = 'INSERT' or old.status <> 'DONE' then
    new.email_status = 'READY';
    new.email_sent = 0;
  end if;
  return new;
end;
$$;

drop trigger if exists external_user_access_sync_email_status on public.external_user_access;
create trigger external_user_access_sync_email_status
before insert or update of status on public.external_user_access
for each row execute function public.sync_external_user_email_status();

drop trigger if exists external_user_access_touch_updated_at on public.external_user_access;
create trigger external_user_access_touch_updated_at
before update on public.external_user_access
for each row execute function public.touch_updated_at();

create table if not exists public.email_templates (
  id text primary key,
  name text not null unique,
  trigger_status text not null check (trigger_status in ('DONE')),
  recipient_template text not null default '{{user.email}}',
  subject_template text not null,
  body_template text not null,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gmail_oauth_states (
  state_hash text primary key,
  pkce_verifier text not null,
  admin_id uuid not null references auth.users(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.gmail_connections (
  id text primary key default 'system',
  google_subject text not null,
  email text not null,
  refresh_token_ciphertext text not null,
  token_iv text not null,
  token_auth_tag text not null,
  scopes text[] not null default '{}',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED', 'ERROR')),
  connected_by uuid references auth.users(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error_code text
);

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  external_user_id text not null references public.external_user_access(id),
  template_id text references public.email_templates(id),
  template_name text not null,
  template_version integer not null,
  recipient text not null,
  subject text not null,
  sent_by uuid references auth.users(id),
  sent_by_email text not null,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  status text not null check (status in ('SENDING', 'SENT', 'FAILED')),
  gmail_message_id text,
  gmail_thread_id text,
  error_code text,
  error_message text
);

create index if not exists email_logs_external_user_idx
  on public.email_logs (external_user_id, requested_at desc);

alter table public.email_templates enable row level security;
alter table public.gmail_oauth_states enable row level security;
alter table public.gmail_connections enable row level security;
alter table public.email_logs enable row level security;

drop trigger if exists email_templates_touch_updated_at on public.email_templates;
create trigger email_templates_touch_updated_at
before update on public.email_templates
for each row execute function public.touch_updated_at();

drop trigger if exists gmail_connections_touch_updated_at on public.gmail_connections;
create trigger gmail_connections_touch_updated_at
before update on public.gmail_connections
for each row execute function public.touch_updated_at();

insert into public.email_templates (
  id,
  name,
  trigger_status,
  recipient_template,
  subject_template,
  body_template
) values (
  'cargomove-welcome',
  'CargoMove Welcome Email',
  'DONE',
  '{{user.email}}',
  'Welcome to CargoMove! Let''s Get You Started',
  E'Dear Client,\n\nWelcome to CargoMove!\n\nWe are pleased to have you onboard. Please find below the login details and initial steps to get started with the CargoMove system.\n\nCargoMove Login Details\nLogin Link: https://www.cargomove.my/\nUsername: {{user.username}}\nPassword: {{user.password}}\n\nGetting Started\nPlease follow the steps below:\n\nStep 1: Add Lorry Driver\nGo to Lorry Drivers and add/register the driver''s details in the system. Once added, the driver can be selected when creating a booking.\n\nStep 2: Register Conventional Vehicle\nGo to LPK Conventional Vehicles and register the lorry/conventional vehicle details. Click Save after entering the required information.\n\nStep 3: Create a Booking\nOnce the driver and vehicle have been registered, you may proceed to create a booking according to the type of job:\n\n- Conventional - For direct yard movements involving Import/Export cargo.\n- Non-Cargo - For activities such as spare part delivery, maintenance, service, or repair.\n- Warehouse - For collecting or delivering goods to/from a warehouse.\n\nFor Conventional bookings, the available transaction types are Export, Import, or Export & Import.\n\nUser Guide\nFor detailed instructions and screenshots, please refer to the CargoMove User Guide.\n\nShould you require any assistance, please contact the CargoMove Support Team at support@cargomove.com.my or the CargoMove General Line.\n\nwww.cargomove.com.my/'
)
on conflict (id) do nothing;

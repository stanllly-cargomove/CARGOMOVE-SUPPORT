-- Milestone 1 only: no Gmail access, AI calls, seed knowledge, or sending.
-- Apply after the existing migrations. Keep these tables behind admin APIs;
-- the custom CargoMove session is not a Supabase authenticated-role JWT.
begin;

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  gmail_thread_id text unique check (length(btrim(gmail_thread_id)) > 0),
  customer_name text,
  customer_email text not null check (length(btrim(customer_email)) > 0 and customer_email !~ '[\r\n]'),
  subject text not null default '',
  status text not null default 'NEW' check (status in ('NEW', 'ANALYZING', 'DRAFTED', 'NEEDS_REVIEW', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED')),
  category text not null default 'OTHER' check (category in ('DRIVER', 'VEHICLE', 'BOOKING', 'CONTAINER', 'PORT', 'ACCOUNT', 'REGISTRATION', 'SYSTEM', 'OTHER')),
  subcategory text check (subcategory in ('DRIVER_NOT_FOUND', 'PORT_PASS', 'DRIVER_REGISTRATION', 'VEHICLE_NOT_FOUND', 'LPK_REGISTRATION', 'VEHICLE_ACTIVATION', 'CONVENTIONAL_BOOKING', 'WAREHOUSE_BOOKING', 'NON_CARGO_BOOKING', 'BOOKING_CREATION', 'CONTAINER_NOT_FOUND', 'YARD_OPENING', 'EARLY_ENTRY', 'DG_DECLARATION', 'VESSEL_CHANGE', 'MT_PICKUP', 'ACCOUNT_EXISTS', 'LOGIN', 'PASSWORD', 'LOCATION_ACCESS', 'PORT_CANCELLED', 'SYSTEM_OUTAGE', 'UNKNOWN_ERROR')),
  port text not null default 'UNKNOWN' check (port in ('WESTPORT', 'NORTHPORT', 'KUANTANPORT', 'UNKNOWN')),
  urgency text not null default 'NORMAL' check (urgency in ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  ai_confidence numeric check (ai_confidence between 0 and 1),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (id, gmail_thread_id),
  check ((status = 'RESOLVED') = (resolved_at is not null)),
  check (resolved_at is null or resolved_at >= created_at)
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete restrict,
  gmail_message_id text unique check (length(btrim(gmail_message_id)) > 0),
  gmail_thread_id text check (length(btrim(gmail_thread_id)) > 0),
  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  sender_name text,
  sender_email text not null check (length(btrim(sender_email)) > 0 and sender_email !~ '[\r\n]'),
  recipient_email text not null check (length(btrim(recipient_email)) > 0 and recipient_email !~ '[\r\n]'),
  subject text not null default '',
  body_text text not null default '',
  body_html text,
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (case_id, id),
  foreign key (case_id, gmail_thread_id)
    references public.support_cases(id, gmail_thread_id) on delete restrict,
  check (gmail_message_id is null or gmail_thread_id is not null)
);

create table public.support_knowledge (
  id uuid primary key default gen_random_uuid(),
  knowledge_code text not null unique check (length(btrim(knowledge_code)) > 0),
  title text not null check (length(btrim(title)) > 0),
  category text not null default 'OTHER' check (category in ('DRIVER', 'VEHICLE', 'BOOKING', 'CONTAINER', 'PORT', 'ACCOUNT', 'REGISTRATION', 'SYSTEM', 'OTHER')),
  subcategory text check (subcategory in ('DRIVER_NOT_FOUND', 'PORT_PASS', 'DRIVER_REGISTRATION', 'VEHICLE_NOT_FOUND', 'LPK_REGISTRATION', 'VEHICLE_ACTIVATION', 'CONVENTIONAL_BOOKING', 'WAREHOUSE_BOOKING', 'NON_CARGO_BOOKING', 'BOOKING_CREATION', 'CONTAINER_NOT_FOUND', 'YARD_OPENING', 'EARLY_ENTRY', 'DG_DECLARATION', 'VESSEL_CHANGE', 'MT_PICKUP', 'ACCOUNT_EXISTS', 'LOGIN', 'PASSWORD', 'LOCATION_ACCESS', 'PORT_CANCELLED', 'SYSTEM_OUTAGE', 'UNKNOWN_ERROR')),
  port text not null default 'ALL' check (port in ('WESTPORT', 'NORTHPORT', 'KUANTANPORT', 'UNKNOWN', 'ALL')),
  problem text not null check (length(btrim(problem)) > 0),
  possible_cause text,
  resolution text not null check (length(btrim(resolution)) > 0),
  suggested_action text,
  keywords text[] not null default '{}',
  requires_port_verification boolean not null default false,
  human_review_required boolean not null default true,
  ai_reply_allowed boolean not null default false,
  active boolean not null default false,
  created_by uuid references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not requires_port_verification or human_review_required)
);

create table public.ai_interactions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete restrict,
  message_id uuid,
  model text not null check (length(btrim(model)) > 0),
  prompt_version text not null check (length(btrim(prompt_version)) > 0),
  category text not null default 'OTHER' check (category in ('DRIVER', 'VEHICLE', 'BOOKING', 'CONTAINER', 'PORT', 'ACCOUNT', 'REGISTRATION', 'SYSTEM', 'OTHER')),
  subcategory text check (subcategory in ('DRIVER_NOT_FOUND', 'PORT_PASS', 'DRIVER_REGISTRATION', 'VEHICLE_NOT_FOUND', 'LPK_REGISTRATION', 'VEHICLE_ACTIVATION', 'CONVENTIONAL_BOOKING', 'WAREHOUSE_BOOKING', 'NON_CARGO_BOOKING', 'BOOKING_CREATION', 'CONTAINER_NOT_FOUND', 'YARD_OPENING', 'EARLY_ENTRY', 'DG_DECLARATION', 'VESSEL_CHANGE', 'MT_PICKUP', 'ACCOUNT_EXISTS', 'LOGIN', 'PASSWORD', 'LOCATION_ACCESS', 'PORT_CANCELLED', 'SYSTEM_OUTAGE', 'UNKNOWN_ERROR')),
  port text not null default 'UNKNOWN' check (port in ('WESTPORT', 'NORTHPORT', 'KUANTANPORT', 'UNKNOWN')),
  language text not null default 'UNKNOWN' check (language in ('EN', 'MS', 'MIXED_MS_EN', 'UNKNOWN')),
  urgency text not null default 'NORMAL' check (urgency in ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  confidence numeric not null check (confidence between 0 and 1),
  entities jsonb not null default '{}'::jsonb check (jsonb_typeof(entities) = 'object'),
  short_explanation text check (length(short_explanation) <= 2000),
  recommended_action text,
  requires_human_review boolean not null default true,
  knowledge_ids uuid[] not null default '{}',
  generated_reply text,
  final_reply text,
  was_edited boolean,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (case_id, message_id) references public.support_messages(case_id, id) on delete restrict,
  check ((approved_by is null) = (approved_at is null)),
  check (approved_at is null or (final_reply is not null and approved_at >= created_at)),
  check (was_edited is null or (generated_reply is not null and final_reply is not null
    and was_edited = (generated_reply is distinct from final_reply)))
);

-- Only structured outputs and concise explanations belong here, never hidden reasoning.
-- knowledge_ids retains historical references; future APIs must validate every ID
-- against approved, active knowledge before storing an interaction.
comment on column public.ai_interactions.knowledge_ids is
  'Historical knowledge references; validate IDs server-side. Deactivate articles rather than deleting them.';

create table public.support_learning_suggestions (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'OTHER' check (category in ('DRIVER', 'VEHICLE', 'BOOKING', 'CONTAINER', 'PORT', 'ACCOUNT', 'REGISTRATION', 'SYSTEM', 'OTHER')),
  subcategory text check (subcategory in ('DRIVER_NOT_FOUND', 'PORT_PASS', 'DRIVER_REGISTRATION', 'VEHICLE_NOT_FOUND', 'LPK_REGISTRATION', 'VEHICLE_ACTIVATION', 'CONVENTIONAL_BOOKING', 'WAREHOUSE_BOOKING', 'NON_CARGO_BOOKING', 'BOOKING_CREATION', 'CONTAINER_NOT_FOUND', 'YARD_OPENING', 'EARLY_ENTRY', 'DG_DECLARATION', 'VESSEL_CHANGE', 'MT_PICKUP', 'ACCOUNT_EXISTS', 'LOGIN', 'PASSWORD', 'LOCATION_ACCESS', 'PORT_CANCELLED', 'SYSTEM_OUTAGE', 'UNKNOWN_ERROR')),
  port text not null default 'ALL' check (port in ('WESTPORT', 'NORTHPORT', 'KUANTANPORT', 'UNKNOWN', 'ALL')),
  existing_knowledge_id uuid references public.support_knowledge(id) on delete restrict,
  suggested_problem text not null check (length(btrim(suggested_problem)) > 0),
  suggested_resolution text not null check (length(btrim(suggested_resolution)) > 0),
  suggested_action text,
  evidence_count integer not null default 1 check (evidence_count > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check ((status = 'PENDING' and reviewed_by is null and reviewed_at is null)
    or (status in ('APPROVED', 'REJECTED') and reviewed_by is not null and reviewed_at is not null)),
  check (reviewed_at is null or reviewed_at >= created_at)
);

create table public.support_automation_rules (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'OTHER' check (category in ('DRIVER', 'VEHICLE', 'BOOKING', 'CONTAINER', 'PORT', 'ACCOUNT', 'REGISTRATION', 'SYSTEM', 'OTHER')),
  subcategory text check (subcategory in ('DRIVER_NOT_FOUND', 'PORT_PASS', 'DRIVER_REGISTRATION', 'VEHICLE_NOT_FOUND', 'LPK_REGISTRATION', 'VEHICLE_ACTIVATION', 'CONVENTIONAL_BOOKING', 'WAREHOUSE_BOOKING', 'NON_CARGO_BOOKING', 'BOOKING_CREATION', 'CONTAINER_NOT_FOUND', 'YARD_OPENING', 'EARLY_ENTRY', 'DG_DECLARATION', 'VESSEL_CHANGE', 'MT_PICKUP', 'ACCOUNT_EXISTS', 'LOGIN', 'PASSWORD', 'LOCATION_ACCESS', 'PORT_CANCELLED', 'SYSTEM_OUTAGE', 'UNKNOWN_ERROR')),
  port text not null default 'ALL' check (port in ('WESTPORT', 'NORTHPORT', 'KUANTANPORT', 'UNKNOWN', 'ALL')),
  ai_analysis_enabled boolean not null default true,
  ai_draft_enabled boolean not null default true,
  auto_send_enabled boolean not null default false,
  minimum_confidence numeric not null default 0.90 check (minimum_confidence between 0 and 1),
  always_require_human boolean not null default true,
  active boolean not null default false,
  created_by uuid references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Explicit future migration required before enabling auto-send in Milestone 10.
  constraint support_automation_initial_human_only check (not auto_send_enabled and always_require_human)
);

create unique index support_automation_rules_scope_idx
  on public.support_automation_rules (category, coalesce(subcategory, ''), port);
create index support_cases_status_updated_idx on public.support_cases (status, updated_at desc);
create index support_cases_category_port_idx on public.support_cases (category, port);
create index support_cases_assigned_idx on public.support_cases (assigned_to) where assigned_to is not null;
create index support_cases_created_idx on public.support_cases (created_at desc);
create index support_cases_resolved_idx on public.support_cases (resolved_at) where resolved_at is not null;
create index support_messages_case_sent_idx on public.support_messages (case_id, sent_at, id);
create index support_messages_thread_idx on public.support_messages (gmail_thread_id) where gmail_thread_id is not null;
create index support_knowledge_match_idx on public.support_knowledge (category, subcategory, port) where active;
create index support_knowledge_keywords_idx on public.support_knowledge using gin (keywords);
create index ai_interactions_case_created_idx on public.ai_interactions (case_id, created_at desc);
create index ai_interactions_message_idx on public.ai_interactions (message_id) where message_id is not null;
create index ai_interactions_knowledge_idx on public.ai_interactions using gin (knowledge_ids);
create index support_learning_status_created_idx on public.support_learning_suggestions (status, created_at desc);
create index support_learning_knowledge_idx on public.support_learning_suggestions (existing_knowledge_id) where existing_knowledge_id is not null;

alter table public.support_cases enable row level security;
revoke all on table public.support_cases from public, anon, authenticated;
grant select, insert, update, delete on table public.support_cases to service_role;

alter table public.support_messages enable row level security;
revoke all on table public.support_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.support_messages to service_role;

alter table public.support_knowledge enable row level security;
revoke all on table public.support_knowledge from public, anon, authenticated;
grant select, insert, update, delete on table public.support_knowledge to service_role;

alter table public.ai_interactions enable row level security;
revoke all on table public.ai_interactions from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_interactions to service_role;

alter table public.support_learning_suggestions enable row level security;
revoke all on table public.support_learning_suggestions from public, anon, authenticated;
grant select, insert, update, delete on table public.support_learning_suggestions to service_role;

alter table public.support_automation_rules enable row level security;
revoke all on table public.support_automation_rules from public, anon, authenticated;
grant select, insert, update, delete on table public.support_automation_rules to service_role;

create trigger support_cases_touch_updated_at
before update on public.support_cases
for each row execute function public.touch_updated_at();

create trigger support_knowledge_touch_updated_at
before update on public.support_knowledge
for each row execute function public.touch_updated_at();

create trigger support_automation_rules_touch_updated_at
before update on public.support_automation_rules
for each row execute function public.touch_updated_at();

commit;

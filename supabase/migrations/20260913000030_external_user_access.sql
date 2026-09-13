-- Credentials for accounts that must be registered in the external system.
-- This table is intentionally separate from application authentication users.
create table if not exists public.external_user_access (
  id text primary key,
  username text not null unique,
  email text not null unique,
  password text not null,
  company_id text,
  company_name text not null default '',
  full_name text not null,
  mobile_number text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.external_user_access enable row level security;

-- Preserve existing company registrations. Their original password cannot be
-- recovered because only a hash was previously stored.
insert into public.external_user_access (id, username, email, password, company_id, company_name, full_name, mobile_number, created_at)
select 'external-' || ur.id, ur.username, ur.email, '', ur.company_id, ur.company_name, ur.full_name, ur.mobile_number, ur.created_at
from public.user_registrations ur
where ur.type = 'COMPANY_ADMIN'
  and not exists (select 1 from public.external_user_access eu where eu.username = ur.username or eu.email = ur.email);

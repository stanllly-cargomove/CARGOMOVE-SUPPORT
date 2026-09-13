-- Cargomove fresh-project baseline.
-- Passwords are managed by Supabase Auth. The legacy password_hash column is
-- retained because customer registration data still sends this field.

create extension if not exists pgcrypto;

create table public.port_configs (
  id text primary key,
  location text not null check (location in ('PORT_KLANG', 'JOHOR', 'OTHER')),
  display_name text not null,
  code text not null unique,
  backend_port_id text not null default '',
  active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.depot_configs (
  id text primary key,
  port_id text not null references public.port_configs(id) on update cascade,
  display_name text not null,
  backend_depot_id text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id text primary key,
  registration_number text not null,
  registration_number_old text,
  registration_number_new text,
  name text not null,
  short_name text not null default '',
  company_type text not null,
  haulier_id text,
  forwarding_agent_id text,
  port_id text references public.port_configs(id) on update cascade,
  depot_id text references public.depot_configs(id) on update cascade,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.registration_submissions (
  id text primary key,
  reference_no text not null unique,
  registration_type text not null check (registration_type in ('COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE')),
  company_id text references public.companies(id) on update cascade,
  company_reg_no text not null default '',
  company_name text not null default '',
  company_type text not null default '',
  port_location text not null check (port_location in ('PORT_KLANG', 'JOHOR', 'OTHER')),
  port_id text not null,
  depot_id text,
  status text not null check (status in ('PENDING', 'REVIEWED', 'READY_TO_EXPORT', 'EXPORTED', 'REJECTED')),
  submitted_at timestamptz not null,
  submitted_by_name text not null default '',
  submitted_by_email text not null default '',
  submitted_by_mobile text not null default '',
  reviewed_at timestamptz,
  exported_at timestamptz,
  export_filename text,
  admin_notes text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_submissions_port_id_fkey foreign key (port_id) references public.port_configs(id),
  constraint registration_submissions_depot_id_fkey foreign key (depot_id) references public.depot_configs(id)
);

create table public.user_registrations (
  id text primary key,
  username text not null unique,
  email text not null unique,
  password_hash text not null default '',
  type text not null default 'COMPANY_ADMIN',
  company_id text references public.companies(id) on update cascade,
  company_name text not null default '',
  full_name text not null,
  mobile_number text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.haulier_guidelines (
  id text primary key default 'default',
  content jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index companies_registration_number_idx on public.companies (upper(registration_number));
create index companies_registration_old_idx on public.companies (upper(registration_number_old));
create index companies_registration_new_idx on public.companies (upper(registration_number_new));
create index user_registrations_company_id_idx on public.user_registrations (company_id);

alter table public.port_configs enable row level security;
alter table public.depot_configs enable row level security;
alter table public.companies enable row level security;
alter table public.registration_submissions enable row level security;
alter table public.user_registrations enable row level security;
alter table public.haulier_guidelines enable row level security;

create policy "public can read active ports" on public.port_configs for select to anon, authenticated using (active = true);
create policy "public can read active depots" on public.depot_configs for select to anon, authenticated using (active = true);
create policy "authenticated users manage ports" on public.port_configs for all to authenticated using (true) with check (true);
create policy "authenticated users manage depots" on public.depot_configs for all to authenticated using (true) with check (true);
create policy "authenticated users manage companies" on public.companies for all to authenticated using (true) with check (true);
create policy "authenticated users manage submissions" on public.registration_submissions for all to authenticated using (true) with check (true);
create policy "authenticated users manage registrations" on public.user_registrations for all to authenticated using (true) with check (true);
create policy "authenticated users manage guidelines" on public.haulier_guidelines for all to authenticated using (true) with check (true);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger port_configs_touch_updated_at before update on public.port_configs for each row execute function public.touch_updated_at();
create trigger depot_configs_touch_updated_at before update on public.depot_configs for each row execute function public.touch_updated_at();
create trigger companies_touch_updated_at before update on public.companies for each row execute function public.touch_updated_at();
create trigger registration_submissions_touch_updated_at before update on public.registration_submissions for each row execute function public.touch_updated_at();
create trigger user_registrations_touch_updated_at before update on public.user_registrations for each row execute function public.touch_updated_at();

-- This row authorizes the Auth user created separately with the same email.
-- It does not contain or define the Supabase Auth password.
insert into public.user_registrations (id, username, email, password_hash, type, full_name)
values ('user-admin', 'admin', 'support@cargomove.com.my', crypt('legacy-disabled', gen_salt('bf')), 'ADMIN', 'System Administrator');

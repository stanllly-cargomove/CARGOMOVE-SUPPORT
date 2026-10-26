-- Shared UI feature switches; access is mediated by the application API.
create table public.developer_settings (
  id text primary key check (id = 'system'),
  registration_test_tools_enabled boolean not null default false,
  simulation_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.developer_settings enable row level security;
revoke all on public.developer_settings from public, anon, authenticated;
grant select, update on public.developer_settings to service_role;
insert into public.developer_settings (id) values ('system');

-- Keep timestamp-based polling index-backed as operational tables grow.
create index if not exists port_configs_updated_at_idx on public.port_configs (updated_at);
create index if not exists depot_configs_updated_at_idx on public.depot_configs (updated_at);
create index if not exists companies_updated_at_idx on public.companies (updated_at);
create index if not exists registration_submissions_updated_at_idx on public.registration_submissions (updated_at);
create index if not exists user_registrations_updated_at_idx on public.user_registrations (updated_at);
create index if not exists external_user_access_updated_at_idx on public.external_user_access (updated_at);

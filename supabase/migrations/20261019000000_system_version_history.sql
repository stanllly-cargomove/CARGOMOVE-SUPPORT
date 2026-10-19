create table public.system_version_history (
  version text primary key,
  previous_version text,
  changed_at timestamptz not null,
  summary text not null,
  changes jsonb not null default '[]'::jsonb,
  files jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now()
);
create index system_version_history_date_idx on public.system_version_history(changed_at desc);
alter table public.system_version_history enable row level security;
revoke all on public.system_version_history from anon, authenticated;
grant select, insert on public.system_version_history to service_role;

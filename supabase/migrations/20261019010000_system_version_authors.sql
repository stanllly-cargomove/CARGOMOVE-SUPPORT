-- Attribute earlier releases to Stanlly; future releases capture Git authors.
alter table public.system_version_history
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.system_version_history
set metadata = metadata || '{"authors":["Stanlly"]}'::jsonb
where coalesce(metadata->'authors', '[]'::jsonb) = '[]'::jsonb;

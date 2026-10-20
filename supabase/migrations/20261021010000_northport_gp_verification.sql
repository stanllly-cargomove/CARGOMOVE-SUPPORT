-- Read-only GP lookup evidence. Existing scheduler/import statuses are retained.
alter table public.northport_recoveries add column if not exists gp_verification jsonb;

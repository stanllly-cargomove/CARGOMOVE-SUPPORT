-- Retain the approved row so an interrupted pre-upload workflow can resume.
-- The existing atomic upload claim and approved whole-file hash remain required.
alter table public.northport_recoveries
  add column if not exists approved_values jsonb;

alter table public.northport_recoveries
  add constraint northport_recovery_approved_values_check
  check (approved_values is null or
    (jsonb_typeof(approved_values) = 'array' and jsonb_array_length(approved_values) = 20));

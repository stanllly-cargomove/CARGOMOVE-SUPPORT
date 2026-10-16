-- Port-scoped acceptance/rejection codes, each backed by its own email template.
-- Existing status/rejection-reason templates remain valid as legacy defaults.
alter table public.email_templates
  add column if not exists port_id text references public.port_configs(id) on update cascade on delete restrict,
  add column if not exists template_code text;

-- Names may repeat across ports; only the port/outcome/code combination is unique.
alter table public.email_templates drop constraint if exists email_templates_name_key;

alter table public.email_templates
  drop constraint if exists email_templates_port_code_check,
  add constraint email_templates_port_code_check check (
    (port_id is null and template_code is null)
    or (port_id is not null and template_code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$')
  ),
  drop constraint if exists email_templates_rejection_reason_check,
  add constraint email_templates_rejection_reason_check check (
    (port_id is not null and rejection_reason is null)
    or (port_id is null and trigger_status = 'DONE' and rejection_reason is null)
    or (port_id is null and trigger_status = 'REJECTED' and rejection_reason in
      ('ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'NO_LEDGER_CODE', 'OTHER'))
  );

create unique index if not exists email_templates_port_code_unique_idx
  on public.email_templates (port_id, trigger_status, template_code)
  where port_id is not null;

-- Logs retain a snapshot of the template name/version, so removing a code
-- should not erase the historical send record.
alter table public.email_logs
  drop constraint if exists email_logs_template_id_fkey,
  add constraint email_logs_template_id_fkey foreign key (template_id)
    references public.email_templates(id) on delete set null;

alter table public.email_logs
  add column if not exists port_id text,
  add column if not exists template_code text;

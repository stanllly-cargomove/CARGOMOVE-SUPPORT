-- A single acceptance/rejection code and template can be assigned to several ports.
create table if not exists public.email_template_ports (
  template_id text not null references public.email_templates(id) on delete cascade,
  port_id text not null references public.port_configs(id) on update cascade on delete restrict,
  primary key (template_id, port_id)
);

alter table public.email_template_ports enable row level security;

-- Preserve any codes created with the earlier one-port model.
insert into public.email_template_ports (template_id, port_id)
select id, port_id from public.email_templates
where template_code is not null and port_id is not null
on conflict do nothing;

alter table public.email_templates
  drop constraint if exists email_templates_port_code_check,
  drop constraint if exists email_templates_rejection_reason_check;

-- The assignment table is now authoritative. Keep the old nullable column
-- for compatibility with older deployments, but clear its one-port value.
update public.email_templates set port_id = null where template_code is not null;

alter table public.email_templates
  add constraint email_templates_port_code_check check (
    port_id is null and (template_code is null or template_code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$')
  ),
  add constraint email_templates_rejection_reason_check check (
    (template_code is not null and rejection_reason is null)
    or (template_code is null and trigger_status = 'DONE' and rejection_reason is null)
    or (template_code is null and trigger_status = 'REJECTED' and rejection_reason in
      ('ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'NO_LEDGER_CODE', 'OTHER'))
  );

drop index if exists public.email_templates_port_code_unique_idx;
create unique index if not exists email_templates_outcome_code_unique_idx
  on public.email_templates (trigger_status, template_code)
  where template_code is not null;

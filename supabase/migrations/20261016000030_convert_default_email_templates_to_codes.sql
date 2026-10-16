-- Give the existing registration templates codes without interrupting the
-- status/rejection-reason fallback used by registrations without a port choice.
alter table public.email_templates
  add column if not exists legacy_fallback boolean not null default false;

alter table public.email_templates
  drop constraint if exists email_templates_rejection_reason_check,
  drop constraint if exists email_templates_fallback_check,
  add constraint email_templates_rejection_reason_check check (
    (trigger_status = 'DONE' and rejection_reason is null)
    or (trigger_status = 'REJECTED' and rejection_reason in
      ('ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'NO_LEDGER_CODE', 'OTHER'))
    or (trigger_status = 'REJECTED' and template_code is not null and rejection_reason is null)
  ),
  add constraint email_templates_fallback_check check (
    not legacy_fallback or template_code is not null
  );

update public.email_templates
set template_code = case id
    when 'cargomove-welcome' then 'ACC001'
    when 'rejection-already-registered-both' then 'REJ001'
    when 'rejection-northport-added' then 'REJ002'
    when 'rejection-no-ledger-code' then 'REJ003'
    when 'rejection-other' then 'REJ004'
  end,
  legacy_fallback = true
where id in (
  'cargomove-welcome',
  'rejection-already-registered-both',
  'rejection-northport-added',
  'rejection-no-ledger-code',
  'rejection-other'
)
and template_code is null;

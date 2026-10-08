-- Add a dedicated company-rejection reason and email workflow for missing ledger codes.
alter table public.external_user_access
  drop constraint if exists external_user_access_rejection_reason_check,
  add constraint external_user_access_rejection_reason_check check (
    (status <> 'REJECTED' and rejection_reason is null and rejection_detail is null)
    or
    (status = 'REJECTED'
      and rejection_reason in ('ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'NO_LEDGER_CODE', 'OTHER')
      and (rejection_reason <> 'OTHER' or nullif(btrim(rejection_detail), '') is not null))
  );

alter table public.registration_submissions
  drop constraint if exists registration_submissions_rejection_reason_check,
  add constraint registration_submissions_rejection_reason_check check (
    (status <> 'REJECTED' and rejection_reason is null and rejection_detail is null)
    or
    (status = 'REJECTED' and registration_type <> 'COMPANY' and rejection_reason is null and rejection_detail is null)
    or
    (status = 'REJECTED' and registration_type = 'COMPANY'
      and rejection_reason in ('ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'NO_LEDGER_CODE', 'OTHER')
      and (rejection_reason <> 'OTHER' or nullif(btrim(rejection_detail), '') is not null))
  );

alter table public.email_templates
  drop constraint if exists email_templates_rejection_reason_check,
  add constraint email_templates_rejection_reason_check check (
    (trigger_status = 'DONE' and rejection_reason is null)
    or
    (trigger_status = 'REJECTED' and rejection_reason in ('ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'NO_LEDGER_CODE', 'OTHER'))
  );

insert into public.email_templates (
  id, name, trigger_status, rejection_reason, recipient_template,
  subject_template, body_template, active
) values (
  'rejection-no-ledger-code',
  'Rejection - Ledger Code Required',
  'REJECTED',
  'NO_LEDGER_CODE',
  '{{user.email}}',
  'CargoMove Registration Request - Ledger Code Required',
  '<p>Dear Client,</p><p>Thank you for your registration request with CargoMove.</p><p>We are unable to proceed because a ledger code registered under your selected port is required.</p><p>Please provide the ledger code registered under the selected port and send it to our support team through our Official WhatsApp at <strong>018-266 0085</strong>.</p><p>Once we receive the ledger code, our team will assist you with the next steps.</p><p>Thank you.</p><p>Regards,<br><strong>Customer Support Team</strong><br>CargoFlow Sdn. Bhd.</p>' ,
  true
)
on conflict (id) do update set
  name = excluded.name,
  trigger_status = excluded.trigger_status,
  rejection_reason = excluded.rejection_reason,
  recipient_template = excluded.recipient_template,
  subject_template = excluded.subject_template,
  body_template = excluded.body_template,
  active = true;

-- Add reason-specific rejection emails to the external user workflow.

alter table public.external_user_access
  add column if not exists rejection_reason text,
  add column if not exists rejection_detail text;

alter table public.registration_submissions
  add column if not exists rejection_reason text,
  add column if not exists rejection_detail text;

update public.external_user_access
set rejection_reason = 'OTHER',
    rejection_detail = 'Rejected before rejection reasons were introduced.'
where status = 'REJECTED' and rejection_reason is null;

update public.registration_submissions
set rejection_reason = 'OTHER',
    rejection_detail = 'Rejected before rejection reasons were introduced.'
where status = 'REJECTED' and registration_type = 'COMPANY' and rejection_reason is null;

alter table public.external_user_access
  drop constraint if exists external_user_access_rejection_reason_check,
  add constraint external_user_access_rejection_reason_check check (
    (status <> 'REJECTED' and rejection_reason is null and rejection_detail is null)
    or
    (status = 'REJECTED'
      and rejection_reason in ('ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'OTHER')
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
      and rejection_reason in ('ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'OTHER')
      and (rejection_reason <> 'OTHER' or nullif(btrim(rejection_detail), '') is not null))
  );

alter table public.email_templates
  add column if not exists rejection_reason text;

alter table public.email_templates
  drop constraint if exists email_templates_trigger_status_check,
  drop constraint if exists email_templates_rejection_reason_check,
  add constraint email_templates_trigger_status_check check (trigger_status in ('DONE', 'REJECTED')),
  add constraint email_templates_rejection_reason_check check (
    (trigger_status = 'DONE' and rejection_reason is null)
    or
    (trigger_status = 'REJECTED' and rejection_reason in ('ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'OTHER'))
  );

create unique index if not exists email_templates_active_rejection_reason_idx
  on public.email_templates (rejection_reason)
  where active and trigger_status = 'REJECTED';

create or replace function public.sync_external_user_email_status()
returns trigger language plpgsql as $$
begin
  if new.status not in ('DONE', 'REJECTED') then
    new.email_status = 'NOT_READY';
    new.email_sent = 0;
  elsif tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.rejection_reason is distinct from new.rejection_reason
    or old.rejection_detail is distinct from new.rejection_detail then
    new.email_status = 'READY';
    new.email_sent = 0;
  end if;
  return new;
end;
$$;

drop trigger if exists external_user_access_sync_email_status on public.external_user_access;
create trigger external_user_access_sync_email_status
before insert or update of status, rejection_reason, rejection_detail on public.external_user_access
for each row execute function public.sync_external_user_email_status();

create or replace function public.sync_company_rejection_to_external_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  linked_user_id text;
begin
  if new.registration_type <> 'COMPANY' or new.company_id is null then
    return new;
  end if;

  select id into linked_user_id
  from public.external_user_access
  where company_id = new.company_id
  order by created_at desc
  limit 1;

  if linked_user_id is null then
    return new;
  end if;

  if new.status = 'REJECTED' then
    update public.external_user_access
    set status = 'REJECTED',
        rejection_reason = new.rejection_reason,
        rejection_detail = new.rejection_detail
    where id = linked_user_id;
  elsif old.status = 'REJECTED' then
    update public.external_user_access
    set status = 'PENDING',
        rejection_reason = null,
        rejection_detail = null
    where id = linked_user_id and status = 'REJECTED';
  end if;

  return new;
end;
$$;

drop trigger if exists registration_submission_sync_external_user_rejection on public.registration_submissions;
create trigger registration_submission_sync_external_user_rejection
after update of status, rejection_reason, rejection_detail on public.registration_submissions
for each row execute function public.sync_company_rejection_to_external_user();

insert into public.email_templates (
  id, name, trigger_status, rejection_reason, recipient_template,
  subject_template, body_template, active
) values
(
  'rejection-already-registered-both',
  'Rejection — Already Registered (Westport & Northport)',
  'REJECTED',
  'ALREADY_REGISTERED_BOTH',
  '{{user.email}}',
  'CargoMove Registration Request — Company Already Registered',
  '<p>Dear Client,</p><p>Thank you for your registration request with CargoMove.</p><p>We are unable to proceed with your registration as <strong>your company is already registered with CargoMove for both Westport and Northport</strong>.</p><p>There is no need to submit a new registration. You may continue using your company’s existing CargoMove account for booking creation at both locations.</p><p><strong>CargoMove Login:</strong><br><a href="https://www.cargomove.my/">https://www.cargomove.my/</a></p><p>When creating a booking, simply select <strong>Westport</strong> or <strong>Northport</strong> under the <strong>Location</strong> option accordingly.</p><p><strong>If you are unsure of your existing CargoMove account or login details, please contact our support team via our Official WhatsApp at 018-266 0085. Our team will assist you in checking your account.</strong></p><p>For further assistance:</p><p>Email: support@cargomove.com.my<br>General Line: 03-2771 2765<br>Official WhatsApp: 018-266 0085</p><p>Thank you for your understanding.</p><p>Thanks and Warm Regards,<br><strong>Customer Support Team</strong><br>CargoFlow Sdn. Bhd.<br>3-7-1 UOA Business Park,<br>1 Jalan Pengaturcara U1/51A<br>40150 Shah Alam.</p><p>Mobile: +603-2771 2765<br>Official WhatsApp: +6018-266 0085<br>Email: support@cargomove.com.my<br>Website: <a href="http://www.cargomove.com.my">www.cargomove.com.my</a></p>',
  true
),
(
  'rejection-northport-added',
  'Rejection — Existing Westport Account / Northport Added',
  'REJECTED',
  'NORTHPORT_ADDED',
  '{{user.email}}',
  'CargoMove Registration Request — Northport Added to Existing Account',
  '<p>Dear Client,</p><p>Thank you for your registration request with CargoMove.</p><p>We found that <strong>your company already has an existing CargoMove account registered for Westport</strong>.</p><p>As your company is already registered with CargoMove, <strong>there is no need to register a new account for Northport</strong>. Our team has added <strong>Northport (NP)</strong> to your existing account.</p><p>You may continue using your <strong>existing CargoMove account</strong> for both Westport and Northport. When creating a booking, simply select <strong>Northport</strong> under the <strong>Location</strong> option.</p><p><strong>CargoMove Login:</strong><br><a href="https://www.cargomove.my/">https://www.cargomove.my/</a></p><p>If you are unsure of your existing CargoMove account or login details, please contact our support team via our <strong>Official WhatsApp at 018-266 0085</strong>, and our team will assist you in checking your account.</p><p>For further assistance:</p><p>Email: support@cargomove.com.my<br>General Line: 03-2771 2765<br>Official WhatsApp: 018-266 0085</p><p>Thank you and welcome to CargoMove.</p><p>Thanks and Warm Regards,<br><strong>Customer Support Team</strong><br>CargoFlow Sdn. Bhd.</p>',
  true
),
(
  'rejection-other',
  'Rejection — Other Reason',
  'REJECTED',
  'OTHER',
  '{{user.email}}',
  'CargoMove Registration Request Update',
  '<p>Dear Client,</p><p>Thank you for your registration request with CargoMove.</p><p>We are unable to proceed with your registration for the following reason:</p><p><strong>{{rejection.reason}}</strong></p><p>If you require clarification or further assistance, please contact our support team.</p><p>Email: support@cargomove.com.my<br>General Line: 03-2771 2765<br>Official WhatsApp: 018-266 0085</p><p>Thank you for your understanding.</p><p>Thanks and Warm Regards,<br><strong>Customer Support Team</strong><br>CargoFlow Sdn. Bhd.</p>',
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

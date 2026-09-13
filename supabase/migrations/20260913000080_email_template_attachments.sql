-- Private files attached to an email template. Metadata is versioned with the
-- template; file bytes live in Supabase Storage and are only read by the
-- server-side service-role client when the email is sent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'email-attachments',
  'email-attachments',
  false,
  15728640,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.email_templates
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.email_logs
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.email_templates
  drop constraint if exists email_templates_attachments_array_check,
  add constraint email_templates_attachments_array_check
    check (jsonb_typeof(attachments) = 'array');

alter table public.email_logs
  drop constraint if exists email_logs_attachments_array_check,
  add constraint email_logs_attachments_array_check
    check (jsonb_typeof(attachments) = 'array');

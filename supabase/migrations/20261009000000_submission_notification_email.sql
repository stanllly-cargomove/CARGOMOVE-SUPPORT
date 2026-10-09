-- Keep the optional queue-specific address separate from the Company Master
-- contact so registration outcome emails can be addressed to both.
alter table public.registration_submissions
  add column if not exists notification_email text;

comment on column public.registration_submissions.notification_email is
  'Optional additional email entered with a Driver, Trailer, or Vehicle registration.';

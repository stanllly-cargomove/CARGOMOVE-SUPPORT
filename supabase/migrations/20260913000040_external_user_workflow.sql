-- Add workflow fields to installations that already ran the external access migration.
alter table public.external_user_access
  add column if not exists status text not null default 'PENDING',
  add column if not exists email_sent smallint not null default 0;

update public.external_user_access
set status = 'PENDING'
where status is null or status not in ('PENDING', 'DONE', 'REJECTED');

update public.external_user_access
set email_sent = 0
where email_sent is null or email_sent not in (0, 1);

alter table public.external_user_access
  drop constraint if exists external_user_access_status_check,
  drop constraint if exists external_user_access_email_sent_check;

alter table public.external_user_access
  add constraint external_user_access_status_check check (status in ('PENDING', 'DONE', 'REJECTED')),
  add constraint external_user_access_email_sent_check check (email_sent in (0, 1));

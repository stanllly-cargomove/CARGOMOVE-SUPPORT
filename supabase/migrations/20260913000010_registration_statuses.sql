-- Normalize registration workflow to pending, done, or rejected.
alter table public.registration_submissions
  drop constraint if exists registration_submissions_status_check;

update public.registration_submissions
set status = 'DONE'
where status in ('REVIEWED', 'READY_TO_EXPORT', 'EXPORTED');

alter table public.registration_submissions
  add constraint registration_submissions_status_check
  check (status in ('PENDING', 'DONE', 'REJECTED'));

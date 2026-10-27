-- Completed or manually settled recoveries remain in history, but must not
-- prevent an administrator from processing the same source/container again.
-- Unresolved attempts keep their source/container admission locks.
drop index if exists public.northport_recovery_source_once;
drop index if exists public.northport_recovery_container_once;

create unique index northport_recovery_source_once
  on public.northport_recoveries(source_key)
  where status not in ('Cancelled', 'Import Verified')
    and manual_review is null
    and not (
      container_type = 'EX'
      and status = 'Scheduler Triggered'
      and processing_result = 'Scheduler run observed — container import not verified'
    );

create unique index northport_recovery_container_once
  on public.northport_recoveries(container)
  where status not in ('Cancelled', 'Import Verified')
    and manual_review is null
    and not (
      container_type = 'EX'
      and status = 'Scheduler Triggered'
      and processing_result = 'Scheduler run observed — container import not verified'
    );

-- Whole-file recoveries use a stable FTP name. The row id remains the unique
-- upload claim; retaining filename uniqueness would reject every later claim.
alter table public.northport_recoveries
  drop constraint if exists northport_recoveries_recovery_filename_key;

notify pgrst, 'reload schema';

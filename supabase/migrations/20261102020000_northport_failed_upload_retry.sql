-- Explicit retries of failed uploads create new audit rows and retain saved edits.
-- Active approvals, uploads and unresolved scheduler requests stay protected.
-- The retry upload reconciles an existing identical incoming file without overwrite.

drop index if exists public.northport_recovery_source_once;
create unique index northport_recovery_source_once
  on public.northport_recoveries(source_key)
  where status not in ('Cancelled', 'Import Verified')
    and manual_review is null
    and not coalesce(container_type = 'EX' and status = 'Scheduler Triggered'
      and processing_result = 'Scheduler run observed — container import not verified', false)
    and not (status in ('Failed','Uploaded','Scheduler Triggered','Processing','Verification Unavailable')
      and coalesce(scheduler_status, '') <> 'Dispatching'
      and (status = 'Failed' or coalesce(scheduler_status, '') <> 'unknown')
      and (status = 'Failed' or coalesce(gp_verification->>'status', '') = 'NOT_FOUND'
        or coalesce(scheduler_status, '') = 'failed'
        or (container_type = 'EX' and coalesce(scheduler_status, '') = 'trigger_requested')));

drop index if exists public.northport_recovery_container_once;
create unique index northport_recovery_container_once
  on public.northport_recoveries(container)
  where status not in ('Cancelled', 'Import Verified')
    and manual_review is null
    and not coalesce(container_type = 'EX' and status = 'Scheduler Triggered'
      and processing_result = 'Scheduler run observed — container import not verified', false)
    and not (status in ('Failed','Uploaded','Scheduler Triggered','Processing','Verification Unavailable')
      and coalesce(scheduler_status, '') <> 'Dispatching'
      and (status = 'Failed' or coalesce(scheduler_status, '') <> 'unknown')
      and (status = 'Failed' or coalesce(gp_verification->>'status', '') = 'NOT_FOUND'
        or coalesce(scheduler_status, '') = 'failed'
        or (container_type = 'EX' and coalesce(scheduler_status, '') = 'trigger_requested')));

notify pgrst, 'reload schema';

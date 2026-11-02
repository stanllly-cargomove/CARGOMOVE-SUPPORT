-- Retain history while allowing a new approval after a confirmed result failure.
-- Uncertain uploads and scheduler outcomes keep their admission locks.

drop index if exists public.northport_recovery_source_once;
create unique index northport_recovery_source_once
  on public.northport_recoveries(source_key)
  where status not in ('Cancelled', 'Import Verified')
    and manual_review is null
    and not coalesce(container_type = 'EX' and status = 'Scheduler Triggered'
      and processing_result = 'Scheduler run observed — container import not verified', false)
    and not (status in ('Uploaded','Scheduler Triggered','Processing','Verification Unavailable')
      and coalesce(scheduler_status, '') not in ('unknown','Dispatching')
      and (coalesce(gp_verification->>'status', '') = 'NOT_FOUND'
        or coalesce(scheduler_status, '') = 'failed'
        or (container_type = 'EX' and coalesce(scheduler_status, '') = 'trigger_requested')));

drop index if exists public.northport_recovery_container_once;
create unique index northport_recovery_container_once
  on public.northport_recoveries(container)
  where status not in ('Cancelled', 'Import Verified')
    and manual_review is null
    and not coalesce(container_type = 'EX' and status = 'Scheduler Triggered'
      and processing_result = 'Scheduler run observed — container import not verified', false)
    and not (status in ('Uploaded','Scheduler Triggered','Processing','Verification Unavailable')
      and coalesce(scheduler_status, '') not in ('unknown','Dispatching')
      and (coalesce(gp_verification->>'status', '') = 'NOT_FOUND'
        or coalesce(scheduler_status, '') = 'failed'
        or (container_type = 'EX' and coalesce(scheduler_status, '') = 'trigger_requested')));

notify pgrst, 'reload schema';

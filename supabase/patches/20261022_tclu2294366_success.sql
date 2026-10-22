-- Run in the SUPPORT database SQL editor, not the separate auto-mail database.
-- Operator-requested history correction; this does not upload or verify a GP.
-- Keep the original cancellation and automatic evidence for audit purposes.
begin;

do $$
declare
  v_recovery public.northport_recoveries;
  v_count integer;
begin
  -- The UI displays created_at to the second in Malaysia time.
  select count(*) into v_count
  from public.northport_recoveries
  where container = 'TCLU2294366'
    and container_type = 'GP'
    and source_filename = 'CM_CONTAINER_20261022145044_GP.csv'
    and created_at >= timestamptz '2026-10-22 17:00:34+08'
    and created_at < timestamptz '2026-10-22 17:00:35+08';

  if v_count <> 1 then
    raise exception 'Expected exactly one matching recovery; found %. No correction applied.', v_count;
  end if;

  select * into strict v_recovery
  from public.northport_recoveries
  where container = 'TCLU2294366'
    and container_type = 'GP'
    and source_filename = 'CM_CONTAINER_20261022145044_GP.csv'
    and created_at >= timestamptz '2026-10-22 17:00:34+08'
    and created_at < timestamptz '2026-10-22 17:00:35+08'
  for update;

  -- Re-running this patch is harmless; never replace a later manual decision.
  if v_recovery.manual_review->>'source' = '20261022_tclu2294366_success'
     and v_recovery.manual_review->>'outcome' = 'SUCCESS' then
    return;
  end if;

  if v_recovery.status not in ('Cancelled', 'Approved')
     or v_recovery.manual_review is not null then
    raise exception 'Recovery status or manual decision has changed. No correction applied.';
  end if;

  -- SQL maintenance has no authenticated application reviewer. Record the SQL
  -- identity explicitly rather than attributing this to the original submitter.
  update public.northport_recoveries
  set manual_review = jsonb_build_object(
    'id', gen_random_uuid(),
    'outcome', 'SUCCESS',
    'note', 'Operator-requested correction from CANCELLED to SUCCESS. Applied by SQL patch; original status and automatic verification evidence retained.',
    'reviewedBy', 'Database patch (' || session_user || ')',
    'reviewedAt', clock_timestamp(),
    'source', '20261022_tclu2294366_success',
    'previousStatus', v_recovery.status
  )
  where id = v_recovery.id;
end;
$$;

select id, container, source_filename, created_at, status as original_status,
       manual_review->>'outcome' as display_status, manual_review
from public.northport_recoveries
where container = 'TCLU2294366'
  and manual_review->>'source' = '20261022_tclu2294366_success';

commit;

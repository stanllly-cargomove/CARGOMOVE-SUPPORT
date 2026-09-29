-- Replace legacy date/random reference numbers with one sequential public
-- reference series.  Only reference_no changes: submission IDs, company IDs,
-- and all company/driver/trailer/vehicle data remain exactly as they are.
--
-- Existing rows are numbered from oldest submission to newest; ties use the
-- immutable submission ID, making the migration deterministic.

begin;

lock table public.registration_submissions in share row exclusive mode;
lock table public.registration_tracking in share row exclusive mode;

create sequence if not exists public.registration_reference_no_seq
  as bigint
  start with 400000
  minvalue 400000
  no maxvalue
  cache 1;

create or replace function public.next_registration_reference_no()
returns text
language sql
security definer
set search_path = public
as $$
  select 'CMREG' || nextval('public.registration_reference_no_seq')::text;
$$;

revoke all on function public.next_registration_reference_no() from public;
revoke all on function public.next_registration_reference_no() from anon;
revoke all on function public.next_registration_reference_no() from authenticated;
grant execute on function public.next_registration_reference_no() to service_role;

-- Use temporary unique values first, so this remains safe even if a prior
-- manual record already uses a CMREG number.
with ordered as (
  select id, row_number() over (order by submitted_at asc, id asc) - 1 as sequence_offset
  from public.registration_submissions
)
update public.registration_submissions submission
set reference_no = '__MIGRATING__' || submission.id
from ordered
where ordered.id = submission.id;

with ordered as (
  select id, row_number() over (order by submitted_at asc, id asc) - 1 as sequence_offset
  from public.registration_submissions
)
update public.registration_submissions submission
set reference_no = 'CMREG' || (400000 + ordered.sequence_offset)::text
from ordered
where ordered.id = submission.id;

-- registration_tracking duplicates the public lookup value, but is linked by
-- submission_id, so update it from the authoritative submission table.
update public.registration_tracking tracking
set reference_no = submission.reference_no
from public.registration_submissions submission
where submission.id = tracking.submission_id
  and tracking.reference_no is distinct from submission.reference_no;

-- The next new registration receives the number after the highest migrated
-- value (CMREG400200 after 201 existing records, for example).
select setval(
  'public.registration_reference_no_seq',
  greatest(400000, 400000 + (select count(*) from public.registration_submissions)),
  false
);

-- Future edits to a submission reference (including controlled maintenance)
-- must also keep its public tracking lookup aligned.
drop trigger if exists registration_submission_sync_tracking on public.registration_submissions;
create trigger registration_submission_sync_tracking
after insert or update of reference_no, status, company_id, company_name, port_location on public.registration_submissions
for each row execute function public.sync_registration_tracking_from_submission();

commit;

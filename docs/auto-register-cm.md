# Auto Register in CM scheduler

`Auto Register in CM` is managed from Developer Settings and opens a dedicated
administrator page. The page automatically queues eligible registrations and
shows scheduled registrations, non-eligible registrations, per-registration
results, and execution history. It advances the existing registration Excel
upload workflow; it does not replace its validation, CargoMove upload
verification, processing scheduler, leases, or duplicate-submission safeguards.

## Runtime design

GitHub Actions calls `POST /api/scheduler/auto-register-cm` every two hours. The
workflow only sends HTTPS: it does not check out the repository, install packages,
build the application, or deploy Vercel. The Vercel handler authenticates the
Bearer token, atomically checks the persisted enabled flag, and exits successfully
with `SKIPPED` before reading registrations when the scheduler is off.

When enabled, the handler processes only saved `SCHEDULED` queue items, in batches
of up to 100 of one asset type. It may resume an unfinished registration-upload
batch only when that batch belongs to a scheduled queue item. It never discovers
or submits other Pending or non-eligible registrations. Manual **Run Now** consumes
the same scheduled queue as an automatic run and is disabled when that queue is
empty. Each queue entry records `SCHEDULED` until verified, then `SUCCESS` or `FAIL`.
Selected registrations are revalidated by the existing upload workflow when run,
so eligibility changes after scheduling cannot bypass its checks. The existing
database leases serialize upload/verification transitions and the application
scheduler execution table adds a two-minute cross-instance lease. A UTC two-hour
request key makes GitHub retries idempotent. Uploaded registrations that have
already reached verified `SUCCESS` are not selected again while they wait for the
separate acceptance-email workflow.

Manual **Run Now** uses the same path and safeguards but is permitted while the
automatic enabled flag is off. It never changes that flag.

The page separates eligible items under **Scheduled registrations** from
ineligible items under **Non-eligible Registration**. The **Results & Execution
logs** card retains all queue outcomes and scheduler execution history. Each
execution has a human-readable `AUTOREG` ID, with linked registration references
listed as `AUTOREG1000001 - CMREG400187` for batch traceability.

## Deployment configuration

1. Apply `supabase/migrations/20261025030000_auto_register_cm_scheduler.sql` to
   the main application Supabase project after the registration-upload migrations.
2. Apply `supabase/migrations/20261025040000_auto_register_cm_queue.sql` after
   the scheduler migration.
3. Apply `supabase/migrations/20261025050000_auto_register_cm_execution_reference.sql`
   after the queue migration.
4. Set `CRON_SECRET` in Vercel to a long random value. Keep the existing server-only
   Supabase and CargoMove credentials, `SCHEDULER_PORTAL_URL`, and registration
   processing scheduler configuration.
5. In the GitHub repository, add Actions secrets:
   - `VERCEL_TASK_URL`: the production HTTPS URL ending in
     `/api/scheduler/auto-register-cm`.
   - `CRON_SECRET`: exactly the same value configured in Vercel.
6. Deploy the application once for this code change. Later scheduled executions
   call the deployed function directly and do not create new deployments.
7. Open Developer Settings → **Auto Register in CM**, review the scheduled and
   non-eligible registration tabs, and enable the scheduler only after validation.

The migration defaults the scheduler to **OFF** so applying/deploying it cannot
start production registrations unexpectedly.

## Safe testing

Run `npm run test:scheduler`, `npm run test:scheduler:ui`,
`npm run test:registration-uploads`, `npm run lint`, and `npm run build`.
These tests use local/injected database and browser fixtures.
They do not connect to production Supabase or CargoMove.

To verify wiring without processing records, leave the toggle OFF and manually
dispatch `.github/workflows/auto-register-cm.yml`. The job should succeed and the
Auto Register in CM page should record a `SKIPPED` automatic execution. Test
**Run Now** or turn the scheduler ON only with explicit approval to submit real
registrations.

## Operational notes

- Timestamps are stored as UTC and displayed in `Asia/Kuala_Lumpur`.
- A run may report success with records still processing when the Vercel time
  budget is nearly exhausted. The next invocation resumes that durable batch.
- A registration remains Pending in this application after verified CM processing
  until its existing acceptance-email workflow completes.
- Queue rows are durable audit history. Failed or stale entries remain visible as
  `FAIL`; unchanged failures are not retried automatically, but a registration
  becomes eligible for a new queue entry when its relevant details are updated.
- An `UNKNOWN` upload or scheduler outcome is never automatically replayed; it is
  reconciled against the existing CargoMove audit first.

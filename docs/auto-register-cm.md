# Auto Register in CM scheduler

`Auto Register in CM` appears at the top of the existing administrator Scheduler
page. It advances the existing registration Excel upload workflow; it does not
replace its validation, CargoMove upload verification, processing scheduler,
leases, or duplicate-submission safeguards.

## Runtime design

GitHub Actions calls `POST /api/scheduler/auto-register-cm` every two hours. The
workflow only sends HTTPS: it does not check out the repository, install packages,
build the application, or deploy Vercel. The Vercel handler authenticates the
Bearer token, atomically checks the persisted enabled flag, and exits successfully
with `SKIPPED` before reading registrations when the scheduler is off.

When enabled, the handler resumes one unfinished registration-upload batch before
claiming new work. New work is bounded to 100 Pending records of one asset type so
the existing workbook and Vercel duration limits continue to apply. The existing
database leases serialize upload/verification transitions and the application
scheduler execution table adds a two-minute cross-instance lease. A UTC two-hour
request key makes GitHub retries idempotent. Uploaded registrations that have
already reached verified `SUCCESS` are not selected again while they wait for the
separate acceptance-email workflow.

Manual **Run Now** uses the same path and safeguards but is permitted while the
automatic enabled flag is off. It never changes that flag.

## Deployment configuration

1. Apply `supabase/migrations/20261025030000_auto_register_cm_scheduler.sql` to
   the main application Supabase project after the registration-upload migrations.
2. Set `CRON_SECRET` in Vercel to a long random value. Keep the existing server-only
   Supabase and CargoMove credentials, `SCHEDULER_PORTAL_URL`, and registration
   processing scheduler configuration.
3. In the GitHub repository, add Actions secrets:
   - `VERCEL_TASK_URL`: the production HTTPS URL ending in
     `/api/scheduler/auto-register-cm`.
   - `CRON_SECRET`: exactly the same value configured in Vercel.
4. Deploy the application once for this code change. Later scheduled executions
   call the deployed function directly and do not create new deployments.
5. Enable the scheduler from the existing Scheduler page after validation.

The migration defaults the scheduler to **OFF** so applying/deploying it cannot
start production registrations unexpectedly.

## Safe testing

Run `npm run test:scheduler`, `npm run test:registration-uploads`, `npm run lint`,
and `npm run build`. These tests use local/injected database and browser fixtures.
They do not connect to production Supabase or CargoMove.

To verify wiring without processing records, leave the toggle OFF and manually
dispatch `.github/workflows/auto-register-cm.yml`. The job should succeed and the
Scheduler page should record a `SKIPPED` automatic execution. Test **Run Now** or
turn the scheduler ON only with explicit approval to submit real registrations.

## Operational notes

- Timestamps are stored as UTC and displayed in `Asia/Kuala_Lumpur`.
- A run may report success with records still processing when the Vercel time
  budget is nearly exhausted. The next invocation resumes that durable batch.
- A registration remains Pending in this application after verified CM processing
  until its existing acceptance-email workflow completes.
- An `UNKNOWN` upload or scheduler outcome is never automatically replayed; it is
  reconciled against the existing CargoMove audit first.

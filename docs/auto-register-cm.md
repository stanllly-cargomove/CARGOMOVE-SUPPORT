# Auto Register in CM scheduler

`Auto Register in CM` is managed from Developer Settings and opens a dedicated
administrator page. The page automatically queues eligible registrations and
shows scheduled registrations, non-eligible registrations, per-registration
results, and execution history. It advances the existing registration Excel
upload workflow; it does not replace its validation, CargoMove upload
verification, processing scheduler, leases, or duplicate-submission safeguards.

## Runtime design

Vercel serves `/api/scheduler/auto-register-cm` and
`/api/scheduler/auto-register-cm-queue` through one scheduler function. An explicit
rewrite sends the queue URL to `auto-register-cm?route=queue`, preserving query
parameters such as `view=scheduled`. Both existing handlers keep their own
authorization and validation. The shared function retains Singapore (`sin1`),
the 120-second timeout and Chromium packaging. This keeps the project at the
Hobby plan's twelve-function limit; `_runtime.ts` is an excluded utility file.
Run `npx tsx --test tests/dev-tools-router.test.ts tests/auto-register-cm-router.test.ts`
after adding API routes to check the function count and scheduler routing.

GitHub Actions calls `POST /api/scheduler/auto-register-cm` at minutes 7, 27 and
47 of every hour. The existing persisted UTC two-hour request key admits one
execution per window; subsequent calls return the recorded result without
discovering or processing registrations. These extra delivery opportunities
let a later automatic trigger catch a missed event. The first planned trigger
in each window is at minute 7 of the even UTC hour (also even hours in MYT).
GitHub scheduling remains best-effort and does not guarantee punctual delivery.
The workflow only sends HTTPS: it does not check out the repository, install packages,
build the application, or deploy Vercel. The Vercel handler authenticates the
Bearer token, atomically checks the persisted enabled flag, and exits successfully
with `SKIPPED` before reading registrations when the scheduler is off.

When enabled, the handler first discovers eligible Pending assets and saves them
to the queue. Discovery uses keyset pages and a persisted cursor, with a bounded
time budget, so later registrations are inspected even when earlier ones remain
non-eligible. Verified uploads awaiting email are excluded. The page can also
request discovery; opening it is not required for automatic runs.

The handler processes only saved `SCHEDULED` queue items, in batches
of up to 100 of one asset type. It may resume an unfinished registration-upload
batch only when that batch belongs to a scheduled queue item. Manual **Run Now** consumes
the same scheduled queue as an automatic run and is disabled when that queue is
empty. Each queue entry records `SCHEDULED` until verified, then `SUCCESS` or `FAILED`.
Transient HTTP errors and upload-claim conflicts leave records scheduled;
only identified validation failures or persisted terminal upload results mark
  registrations failed. A confirmed first failure gets one more attempt at the
  next UTC two-hour run window. The second failed attempt ends automatic retries.
  Uncertain or partial upload results require manual review instead of replay.
Selected registrations are revalidated by the existing upload workflow when run,
so eligibility changes after scheduling cannot bypass its checks. The existing
database leases serialize upload/verification transitions and the application
scheduler execution table adds a two-minute cross-instance lease. A UTC two-hour
request key makes GitHub retries idempotent. Uploaded registrations that have
already reached verified `SUCCESS` are not selected again while they wait for the
separate acceptance-email workflow.

Manual **Run Now** uses the same path and safeguards but is permitted while the
automatic enabled flag is off. It never changes that flag.

The page has two registration tabs. **Scheduled registrations** shows queued
items as `SCHEDULED` and safe first failures as `RE-SCHEDULED`; hovering the
second tag explains the first failure. After a second failure, the registration
leaves that tab and its icon in Pending Registration Submissions turns red.
**Non-eligible Registration** shows submissions that currently fail eligibility
checks. Successful registrations leave both tabs. The **Execution logs** card
retains scheduler execution history. Each
execution has a human-readable `AUTOREG` ID. Execution references are read from
`automation_scheduler_run_items`, preserving the same registration in every run
that handled it, even when the queue's latest `run_id` changes.

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

Before deploying this application update, also apply
`20261025060000_auto_register_cm_hardening.sql`, followed by
`20261025070000_auto_register_cm_reliability.sql`, followed by
`20261026000000_auto_register_cm_second_attempt.sql` to the main application database.
If the migrations are pending against an older application, apply them in order
before deployment, keeping scheduling off and avoiding manual runs until all finish.
Migration 060 alone rejects older `FAIL` writes; migration 070 normalizes them to
`FAILED` before constraints and history triggers run, allowing the older
application to work during deployment. Apply only migrations still pending.

Migration 070 retains original audit fingerprints and establishes a separate
versioned retry fingerprint for existing rows. Older failures do not contain a
complete dependency snapshot, so their retry baseline is conservatively set to
  the current inputs during upgrade. Migration 260 grants one safe retry in the
  next run window. New fingerprints use canonical JSON and meaningful configuration,
including both Port Klang ports, without timezone-sensitive timestamps.

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

- The next scheduled run shown on the page estimates the next two-hour
  execution's first planned trigger at minute 7. If that trigger is missed,
  later calls at minutes 27 and 47 (and in the following hour) can still admit
  that window. The estimate does not confirm GitHub delivery.
- If execution history stops advancing, inspect the **Auto Register in CM**
  workflow in GitHub Actions. A missing workflow run means no trigger was
  recorded there; a failed workflow needs its HTTP result inspected. Eligibility
  and queue timestamps do not themselves invoke the handler. Do not dispatch
  the production workflow as a diagnostic while enabled: it processes real
  registrations.
- Timestamps are stored as UTC and displayed in `Asia/Kuala_Lumpur`.
- A run may report success with records still processing when the Vercel time
  budget is nearly exhausted. The next invocation resumes that durable batch.
- A registration remains Pending in this application after verified CM processing
  until its existing acceptance-email workflow completes.
- Queue rows are durable audit history. A first safe `FAILED` entry remains
  visible as `RE-SCHEDULED` on the page and can create one new queue entry in
  the next two-hour UTC window. A second failure stops automatic retries even
  if registration details later change. Failed upload attempts with uncertain
  or partial processing do not receive an automatic retry.
- An `UNKNOWN` upload or scheduler outcome is never automatically replayed; it is
  reconciled against the existing CargoMove audit first.

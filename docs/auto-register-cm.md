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
the 120-second timeout and Chromium packaging. Together with the shared auth
function, this leaves ten API handlers, two below the Hobby plan's twelve-function
limit; `_runtime.ts` is an excluded utility file.
Run `npx tsx --test tests/dev-tools-router.test.ts tests/auto-register-cm-router.test.ts`
after adding API routes to check the function count and scheduler routing.

GitHub Actions calls `POST /api/scheduler/auto-register-cm` at minutes 7, 27 and
47 of every hour. Each twenty-minute UTC delivery window admits one initial
execution. The workflow pins that window in its request body so a retry crossing
the next window cannot create a new initial execution.

An execution attempts the complete registration sequence for each selected asset
batch as time permits: export Excel, upload, request CargoMove processing and poll the result.
Automatic runs and manual Run Now continue checking the same saved upload inside
that execution instead of stopping after the upload. Verified registrations also complete their acceptance
email and move to Done if enough time remains. An execution works for up to
100 seconds, reserving time for audit writes before Vercel's hard timeout.

Only work that genuinely remains unfinished receives a persisted continuation
token: for example, CargoMove is still processing, the time budget is exhausted,
or its read-only listing is temporarily unavailable. GitHub follows that token
after five seconds; Supabase Cron follows it on a later minute check. Both resume
the saved upload without exporting/uploading it or dispatching processing again.
They do not wait for another twenty-minute registration window between steps.

Continuation admission rechecks the enabled flag and the shared execution lease.
A token always identifies the same next execution. Repeated delivery recovers its
saved response/token without re-uploading a file, re-dispatching processing, or
re-sending an acknowledged acceptance email. Tokens are service-only and are never
returned in browser history responses or printed in workflow logs. The workflow
retries transport interruptions and busy admission with the identical request.
Failed steps stop the chain; uncertain uploads/sends retain their audit safeguards.
Each chain is limited to eight requests and eighteen minutes; the workflow leaves
extra headroom and defers remaining durable work to a later schedule. Concurrent
GitHub runs queue instead of cancelling a request that may have submitted work.
GitHub scheduling remains best-effort and does not guarantee punctual delivery.
An optional independent Supabase Cron driver can start and continue the same
durable chain when GitHub misses an event; see the setup below.
The workflow only sends HTTPS: it does not check out the repository, install packages,
build the application, or deploy Vercel. The Vercel handler authenticates the
Bearer token, atomically checks the persisted enabled flag, and exits successfully
with `SKIPPED` before reading registrations when the scheduler is off.

When enabled, the handler discovers eligible Pending assets, then recovers
acceptance emails for already verified Pending submissions before browser work.
Discovery uses keyset pages and a persisted cursor, with a bounded
time budget, so later registrations are inspected even when earlier ones remain
non-eligible. Verified uploads awaiting email are excluded. The page can also
request discovery; opening it is not required for automatic runs.

The handler processes only saved `SCHEDULED` queue items, in batches
of up to 100 of one asset type. Automatic and manual executions can visit multiple
asset types if their time budget permits.
Never-attempted and least-recently-attempted queue items
come first, so slow uploads cannot starve other files. It may resume an unfinished registration-upload
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
scheduler execution table adds a two-minute cross-instance lease. A UTC
twenty-minute initial request key and persisted continuation tokens make deliveries idempotent. Safe failed
registration retries still wait for the next two-hour window. Uploaded
registrations that have reached verified `SUCCESS` never upload again.

Automatic acceptance emails use the existing preview/send workflow, including
port and registration-type assignments, notification recipients and the asset
PDF. The matching built-in acceptance code is preferred; otherwise exactly one
matching active code must be assigned. Missing or ambiguous configuration is
reported in execution history and keeps the submission Pending.

Manual and automatic acceptance sends share a persisted claim per submission and
verified upload. Gmail acknowledgements are saved before completion moves the
submission to Done. If completion fails, a later execution uses the saved receipt
without sending again. An explicit Gmail client rejection can retry; an interrupted
or uncertain send retains `SENDING` and requires reconciliation in Gmail before
an operator changes its delivery state. Claims never expire into automatic replay.

Manual **Run Now** uses the same path and safeguards but is permitted while the
automatic enabled flag is off. It never changes that flag.

The page opens immediately from its per-user in-memory snapshot and silently
revalidates on return. While visible and active, it checks for updates every
15 seconds, and also checks on window focus, reconnection and local storage
notifications. These reads pick up new submissions, execution results and manual
registrations completed by another administrator without requiring Refresh data.
Verified uploads are removed from the active list even if acceptance email is
still pending. Background requests do not overlap; temporary failures preserve
the snapshot and retry with backoff up to 60 seconds. Polling pauses while the
tab is hidden or the admin portal is inactive.

Migration `20261026060000_auto_register_cm_queue_completion.sql` closes stale
scheduled items for Done, Rejected or verified registrations and installs triggers
to keep manual Register & Email synchronized with the automatic queue. It does
not upload files, send email or add successes to automatic execution counters.
Each execution also rechecks registration status before grouping and claiming
work, so a completed manual registration cannot block another Pending asset.
Group messages name the registrations actually handled; database admission
failures carry a safe diagnostic code rather than a generic success or skip.

A CargoMove `not_processed` file is an accepted upload waiting for processing.
If the processing scheduler fails before its dispatch marker (for example, its
separate login fails), the upload remains `UPLOADED` and retains that diagnostic
for a later continuation. An identified waiting/processing file does not become
`UNKNOWN` just because ten minutes elapsed. A successful dispatch is never
repeated while waiting for CargoMove's result.

Migration `20261026070000_registration_upload_scheduler_recovery.sql` adds
lease-protected recovery for older uploads incorrectly marked `UNKNOWN`: the
server must find the exact file still waiting, and the linked scheduler audit
must prove `FAILED` with no dispatch. Uncertain or dispatched requests retain
their replay protection. This migration never triggers a scheduler or sends mail.

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

Before deploying this fix, apply
`supabase/migrations/20261026020000_auto_register_cm_email_completion.sql` after
the existing migrations to the **main application** database. It adds fair queue
ordering and acceptance delivery receipts and changes the displayed schedule to
Every 20 minutes. It preserves the enabled flag. Deploy the handler and workflow
changes together. Existing automatically verified submissions still Pending are
picked up by the next enabled execution; they are not uploaded again.

Apply `supabase/migrations/20261026040000_auto_register_cm_continuations.sql`
after the email visibility migration before deploying the consecutive-request
handler and workflow. It adds persisted chain metadata/tokens and service-only
admission, finish and remaining-work functions. Existing upload and email claims,
retry limits, history and the enabled flag are preserved. No new API function is
created. The worker remains HTTPS-only with no checkout, installation or build.
Automatic verification has a maximum 25-second browser budget, and its CargoMove
scheduler request has a maximum 30-second browser budget. Each shrinks with the
execution's remaining time. Processing is deferred before dispatch if there is
insufficient time to request it safely. Temporary read failures preserve an
accepted upload's UPLOADED/PROCESSING state for later verification; unknown or
partial CargoMove outcomes still require review. Browser budgets include startup;
a browser that launches after its deadline closes without performing work.

## Independent initial delivery with Supabase Cron

This addresses a missing initial GitHub event, which continuation tokens alone
cannot fix. It uses the **main application** database, never Auto Mail's project.
GitHub remains available and may follow the same tokens; persisted admission and
upload/email claims serialize both delivery drivers.

Apply `20261026050000_auto_register_cm_cron_trigger.sql` after migrations 030 and
040. This creates an **inactive** driver only; applying it does not install a job,
enable the application toggle or submit registrations. Keep migrations 030/040
already applied; do not rerun them. Push/deploy the signed-request application
before provisioning this new driver.

One-time setup after deployment:

1. In the main Supabase project's Vault, create these two named secrets:
   - `auto_register_cm_url`: your production HTTPS URL ending exactly in
     `/api/scheduler/auto-register-cm`, without query parameters.
   - `auto_register_cm_cron_secret`: the existing **Production Vercel CRON_SECRET**
     value. This is not `GOOGLE_TOKEN_ENCRYPTION_KEY` or a Supabase service key.
2. Open `supabase/setup-auto-register-cm-cron.sql` in that project's SQL Editor.
   Review and run it once. It enables pg_cron/pg_net/pgcrypto, installs one
   once-per-minute job and activates the driver. Re-running replaces the same
   named job. Keep actual secret values out of the file and source control.
3. The existing Auto Register enabled toggle controls whether registrations run.
   When enabled, the job starts windows at minutes 7, 27 and 47, catching a missed
   tick later in the same window. It follows an outstanding continuation on a
   later minute without waiting for the next 20-minute window.
4. Refresh Auto Register. Check **Last automatic**, **Supabase trigger** and the
   execution logs. The first new automatic execution confirms actual delivery;
   **Next planned trigger** remains a clock estimate. A ten-minute grace period
   precedes the overdue warning. A manual run cannot clear that warning.

The driver waits for its own pg_net response, retries the exact original body on
transport uncertainty or busy admission, and stops on rejected/failed responses.
It respects the same eight-step/eighteen-minute chain cap. HTTP retries are
bounded separately. Completed windows are not requested each minute. Configuration
and HTTP failures appear as safe diagnostic codes in the developer page.

Vault protects the cron secret at rest. Because pg_net's request queue is readable
by database roles, its queued requests contain a two-minute HMAC proof bound to
this endpoint and the specific window/token, **not the raw cron secret**. Captured
proofs cannot authorize another step, and replays of the same step remain
idempotent. The tick function is executable only by postgres; browser roles have
no state-table access, and the API selects only non-secret diagnostic columns.
Do not change pg_net's platform-owned queue grants or policies.

To stop just this delivery driver, set its state `is_enabled=false` in SQL or
unschedule `auto-register-cm-delivery` in Supabase Cron. The app toggle stops both
GitHub and Supabase from processing registrations. Do not delete upload/email
audits or reset uncertain send claims when troubleshooting delivery.

References: [Supabase Cron](https://supabase.com/docs/guides/cron),
[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), and
[queued request header visibility](https://supabase.com/kb/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net).

## Safe testing

Run `npm run test:scheduler`, `npm run test:scheduler:ui`,
`npm run test:registration-uploads`, `npm run lint`, and `npm run build`.
These tests use local/injected database and browser fixtures.
They do not connect to production Supabase or CargoMove.

Acceptance PDFs load their logo and Inter fonts from the application root.
Both the mail and scheduler functions explicitly package these files in
`vercel.json`. The registration email runtime test bundles the PDF renderer at
both API entry locations and runs it from an isolated deployment directory with
only those assets copied. Gmail token refresh uses the client ID and secret;
`APP_URL` is required for the OAuth connection flow, not for refreshing a saved grant.

Apply `supabase/migrations/20261026030000_auto_register_cm_email_visibility.sql`
after the email completion migration. It keeps uncertain sends visible to the
automatic email checker. The checker reports them without attempting a send.

Email failures now include a safe error code. `PDF_PREPARATION_FAILED`,
`ATTACHMENT_PREPARATION_FAILED`, `GMAIL_TOKEN_DECRYPT_FAILED`, and
`GMAIL_TOKEN_REFRESH_FAILED` mean preparation failed before a send request.
`GMAIL_RECONNECT_REQUIRED` means Google rejected the saved refresh grant;
reconnect the registration Gmail account. `GMAIL_OAUTH_CONFIG_INVALID` means its
server client credentials need checking. `GMAIL_HTTP_4xx` reports a confirmed
client rejection. `GMAIL_SEND_UNCERTAIN` retains the existing no-replay claim and
requires checking Gmail Sent. Missing delivery rows mean this workflow never
reached its send claim; do not describe that as an uncertain Gmail delivery.
An ACTIVE connection and saved send scope do not by themselves prove its refresh
grant is still valid. No access tokens or provider response bodies are included
in execution errors. A candidate is attempted at most once in each execution,
even when email completion runs before and after CargoMove browser work.

To verify wiring without processing records, leave the toggle OFF and manually
dispatch `.github/workflows/auto-register-cm.yml`. The job should succeed and the
Auto Register in CM page should record a `SKIPPED` automatic execution. Test
**Run Now** or turn the scheduler ON only with explicit approval to submit real
registrations.

## Operational notes

- Next planned trigger estimates a slot at minute 7, 27 or 47. It never confirms
  delivery. Last automatic and the overdue warning show actual trigger history.
  The optional Supabase trigger status also shows its last database check.
- If execution history stops advancing, inspect the **Auto Register in CM**
  workflow in GitHub Actions. A missing workflow run means no trigger was
  recorded there; a failed workflow needs its HTTP result inspected. Eligibility
  and queue timestamps do not themselves invoke the handler. Do not dispatch
  the production workflow as a diagnostic while enabled: it processes real
  registrations.
- Timestamps are stored as UTC and displayed in `Asia/Kuala_Lumpur`.
- An automatic execution may report an upload awaiting confirmation. GitHub
  follows the saved continuation to check that existing upload in the same
  workflow. If the chain reaches its time/step limit, the next delivery resumes it.
  Each API step retains its own execution log and registration references.
- Verified registrations remain Pending only until Gmail acknowledges their
  acceptance email and database completion succeeds. Automatic execution attempts
  both steps, including recovery of previously verified Pending submissions.
- Queue rows are durable audit history. A first safe `FAILED` entry remains
  visible as `RE-SCHEDULED` on the page and can create one new queue entry in
  the next two-hour UTC window. A second failure stops automatic retries even
  if registration details later change. Failed upload attempts with uncertain
  or partial processing do not receive an automatic retry.
- An `UNKNOWN` upload or scheduler outcome is never automatically replayed; it is
  reconciled against the existing CargoMove audit first.

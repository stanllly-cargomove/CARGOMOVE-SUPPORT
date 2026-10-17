# CargoMove Scheduler

The existing React/Vite portal exposes Dev Tools → Test Tools → CargoMove Scheduler.
Vercel serves `POST /api/dev-tools/run-scheduler` as a Node function; the local Express
API mounts the same handler. No registration behavior is changed.

The scheduler section is a gallery shared by administrators. Click **Add Scheduler**,
enter a title, optional description, and the **Run now** link copied from CargoMove.
Saving does not execute a task. Each saved entry has its own confirmation and Run
Scheduler button; additions are immediately runnable without another code change.
Titles and descriptions are plain text. URLs are displayed as text so clicking a
saved link cannot bypass the backend safeguards. Entries cannot be edited or
deleted from this first version; an operator may set `enabled=false` in Supabase.

## Changed files

- UI: `src/components/admin/CargoMoveScheduler.tsx` (new),
  `src/components/admin/DeveloperSettings.tsx` (card integration).
- Backend: `api/dev-tools/run-scheduler.ts`,
  `server-handlers/scheduler/handler.ts`,
  `server-handlers/scheduler/automation.ts` (new), `server.ts` (local route).
- Gallery API: `api/dev-tools/schedulers.ts`, `server-handlers/scheduler/catalog.ts`,
  shared authorization in `server-handlers/scheduler/access.ts`, URL validation in
  `server-handlers/scheduler/targets.ts`, and `src/types/scheduler.ts`.
- Database: `supabase/migrations/20261016000000_cargomove_scheduler.sql` and
  `supabase/migrations/20261017000000_cargomove_scheduler_gallery.sql`.
- Configuration: `package.json`, `package-lock.json`, `vercel.json`, `.env.example`.
- Tests: `tests/scheduler.test.ts`, `tests/scheduler-ui.ts` (new).
- Documentation: `docs/cargomove-scheduler.md` (new).

The pre-existing local changes in `src/components/admin/PortDepotConfig.tsx` were
left untouched.

## Deployment

### 45-second scheduler cooldown

Apply [`20261017020000_scheduler_cooldown_45_seconds.sql`](../supabase/migrations/20261017020000_scheduler_cooldown_45_seconds.sql) after the scheduler gallery migration to change the shared cooldown from five minutes to **45 seconds**. This replaces only the saved admission function, preserves audit rows, and also covers the legacy Northport wrapper. The cooldown is measured from the last admitted request and applies across all administrators and saved tasks. Running tasks and unresolved UNKNOWN outcomes still block admission. The recovery API's separate five-second per-administrator request limit is unchanged.

The new function returns `cooldown_seconds: 45` on cooldown rejection. The API uses that value for the message and keeps the truthful five-minute message for databases that have not applied this migration. Changing the text alone does not change the database lock. The migration does not trigger a task or alter historical timestamps.

The operator confirmed this migration was applied on 17 October 2026. Thirteen scheduler tests passed, including isolated PostgreSQL checks at 44/45/46 seconds, shared admission across tasks, the legacy Northport wrapper, retained audit records, role restrictions and RUNNING/UNKNOWN protection. No production scheduler request was issued for validation.

The matching API update is deployed as `dpl_9wGumkHU4dUruJ7i3RYuxgoCgvXm`, verified Ready on the existing production domains with Dev Tools in Singapore. Production health checks retained upload enablement; a GET-only probe of the execution endpoint returned the expected 405 without dispatching anything.

1. Apply the original `20261016000000_cargomove_scheduler.sql` if not already applied,
   then apply `supabase/migrations/20261017000000_cargomove_scheduler_gallery.sql`
   through your normal Supabase migration process. Do not rerun the original
   migration. The gallery migration seeds Northport Containers, preserves existing
   runs/resolution notes, and retains the old Northport RPC for older deployments.
   Apply it before deploying the gallery code. The new code fails closed if the
   gallery migration is missing. No migration runs a CargoMove task.
2. Run `npm ci`. Production dependencies are pinned: `playwright-core@1.63.0`
   (Chromium 153) and `@sparticuz/chromium@153.0.0`.
3. Configure server-only Vercel environment variables `CARGOMOVE_USERNAME` and
   `CARGOMOVE_PASSWORD`. The account needs Scheduled Tasks access. Keep existing
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, and authentication
   configuration. `CARGOMOVE_URL` identifies the external site
   (`https://www.cargomove.my`); the configured host is validated and execution uses the fixed allowlisted CargoMove
   domain and endpoint, with task ID/name resolved from the saved gallery entry.
   It is not used for portal CSRF checks.
   Set `SCHEDULER_PORTAL_URL` to the exact admin portal HTTPS origin. If omitted,
   the scheduler uses the existing `APP_URL` value; other `APP_URL` uses are
   unchanged. `VERCEL_URL`
   also permits the current deployment origin. Never prefix secrets with `VITE_`.

   For the current production Support Tool, use
   `SCHEDULER_PORTAL_URL=https://cargomove-register.vercel.app` and redeploy after
   changing it. This is the origin of the website sending the request. The
   CargoMove scheduler destination saved in Supabase is a separate setting;
   saving that link does not authorize the Support Tool's request origin.
4. Use Node.js 24.x (package engines). The function includes Chromium's compressed
   binary and requests a 120-second limit. Enable Fluid Compute or a plan/configuration
   supporting that duration, and at least 2 GB function memory. Check the Vercel
   build output confirms the binary is included and the function fits deployment
   size/function-count limits. No locally installed Chrome is used.
5. Deploy normally to Vercel. No live scheduler request is made by builds or tests.

Local Windows development uses Playwright's managed Chromium browser: install it
with `npx playwright-core install chromium` if it is not cached, set server-only
credentials in `.env.local`, and start both `npm run dev` and `npm run dev:api`.
Restart the API after backend changes; the current API command does not watch files.
Vercel always uses the packaged Linux binary, never a local Chrome installation.
If your Vercel plan cannot host
the binary or allow 120 seconds, the smallest alternative is to move only the
automation module into a private Linux worker with the same database admission
and audit contract, leaving this portal UI and admin authorization in place.

## Safeguards and results

The handler verifies the signed HttpOnly session and current ADMIN profile. The
database also checks the Supabase Auth identity against the current profile.
Origin allowlisting and a custom confirmation header protect the cookie endpoint.
Admins can save only HTTPS CargoMove `/administration/run_scheduled_task` URLs
containing exactly one 24-character hexadecimal `id` and one valid `name`. Other
hosts, endpoints, credentials in URLs, fragments and extra query parameters are
rejected. Only task ID/name are stored; the backend constructs the canonical URL.
The execution API accepts only the saved gallery UUID, never an arbitrary URL,
task ID, role or credential. It atomically loads the enabled saved target into the
execution audit before automation. The authenticated external task page must
contain the exact corresponding link before dispatch.

An atomic transaction advisory lock serializes admission across instances. One
run at a time and a global 45-second cooldown (after the cooldown migration) apply even to failed runs. This
limits all administrators and all saved schedulers together. RLS and revoked public function grants keep
the audit and RPCs service-role-only. A dispatch marker is persisted before the
single trigger request; redirects and network retries are disabled.

`TRIGGER_REQUESTED` means the trigger received an acceptable response, never that
the job completed. `UNKNOWN` blocks further execution until manually resolved.
Any RUNNING record left by a terminated function becomes UNKNOWN after its
three-minute lease expires on the next admission attempt. A slow or failed remote
task may outlive the trigger request; no job-completion tracking is available.

Inspect `public.cargomove_scheduler_runs` in the Supabase SQL editor for the actor,
request/start/dispatch/finish timestamps, status and sanitized error. After checking
CargoMove's Last run timestamp and confirming it is safe to allow another request,
an operator can record a resolution (preserve UNKNOWN for audit):

```sql
update public.cargomove_scheduler_runs
set resolution_note = 'Operator name, checked Last run at <time>, finding and decision'
where id = '<execution UUID>' and status = 'UNKNOWN';
```

Do not clear an active run or resolve an uncertain run without checking CargoMove.
The UI shows the latest request for the current screen session; durable history is
in Supabase. Each execution snapshots the saved scheduler ID, worker name and
external task ID; gallery additions record `created_by` and `created_at`.
No external HTML, cookies, credentials, screenshots or stack traces are
stored in audit messages or returned to the browser.

## Testing

- Run `npm run test:scheduler`, `npm run test:scheduler:ui`, `npm run lint`, and
  `npm run build`. The offline UI test uses a cached Playwright test browser; if
  absent, install it with `npx playwright-core install chromium`. This test browser
  is separate from the packaged Linux Chromium used by the production function.
- Mock tests cover session signatures/expiry, authorization, revoked roles, origin
  and confirmation protection, admission/cooldown/unknown rejection, overlapping
  handler requests, audit failures, login/form/access failures, launch/network
  failures, safe redirect handling, single dispatch and browser cleanup.
  Gallery coverage includes URL allowlisting, duplicates, admin/origin checks,
  saving without running, persistence on reload, selecting another saved target,
  and disabling all Run buttons during execution.
- On a disposable Supabase database, apply the migration and call
  `acquire_saved_cargomove_scheduler` concurrently using a real admin Auth UUID
  and saved scheduler UUIDs (including two different schedulers): exactly
  one should get an ID; the other should receive `running`. Finish that record and
  confirm the next call gets `cooldown`. Confirm anon/authenticated cannot access
  the table or RPCs. These database checks require an available test database.
- In the portal, verify the card under Dev Tools → Test Tools and its responsive
  layout. Cancel the confirmation to verify no network request is made. For loading,
  success and error UI tests, intercept the endpoint with fixture responses; never
  click through to the real scheduler merely to test the UI.
- Only after explicit live-test approval, record the CargoMove Scheduled Tasks
  **Last run** timestamp, confirm one portal request, then compare Last run after it.
  Record the observation; the application still reports request sent rather than
  completed. Do not automatically repeat an uncertain request.

The public login form action and selectors were verified from CargoMove HTML on
2026-10-16. Authenticated page structure, production browser launch, database
concurrency and actual scheduler behavior require deployment/staging validation.
The automation fails closed unless the authenticated Scheduled Tasks page contains
the exact allowlisted scheduler link. MFA, CAPTCHA or a changed page requires an
integration update; no bypass is attempted.
Saved tasks must be visible in the Scheduled Tasks table for the configured
CargoMove account. The current site displays 100 active rows; an inactive task
or one outside the loaded table will fail safely without dispatch.

The table is loaded asynchronously through `scheduled_tasks_ajax`; automation
waits for the exact task link after page navigation. To diagnose access/rendering
without triggering a task, run `node --import tsx scripts/inspect-cargomove-scheduler.ts`.
This read-only script blocks scheduler execution URLs and all POST requests except
login and the verified task-list endpoint. It prints only structural diagnostics,
not credentials, cookies, response HTML, or account data.

References: [Chromium serverless setup](https://github.com/Sparticuz/chromium),
[Playwright 1.63 browser versions](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/browsers.json),
[Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js).

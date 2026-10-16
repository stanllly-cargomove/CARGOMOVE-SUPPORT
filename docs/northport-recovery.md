# Northport container recovery

Integrated location: **Dev Tools → Test Tools → Northport Container Recovery**. Only the existing `ADMIN` role is authorized. The backend rechecks the current role in `user_registrations` on every request. No new application or production worker was created.

## Deployment and configuration

### Production deployment, 17 October 2026

The portal is deployed at [cargomove-register.vercel.app](https://cargomove-register.vercel.app). Vercel confirmed production deployment `dpl_DcZeEwEK7vXxJVbsECZTE5qowUSm` as **Ready** (created at 03:03 MYT). This deployment was uploaded from the local workspace; the source changes have not been committed or pushed to Git.

Eighteen server-only Northport settings were configured in Vercel production. The upload master flag and all eight compatibility verification flags remain `false`. No production FTP write or scheduler execution was used to validate this deployment. The public page, health and session endpoints responded successfully; recovery and scheduler catalog endpoints returned the expected JSON 401 without authentication, and GET on scheduler execution returned JSON 405. An administrator must still run **Check read-only connection** and a known-container search from the deployed portal to verify Vercel-to-FTP connectivity.

Validation for the deployed code passed: 31 Northport/router/database tests, 12 scheduler tests, the TypeScript check and the Vercel production build. The Dev Tools endpoints share one function to fit the existing Hobby plan limit while preserving their public URLs and authorization checks.

Vercel CLI 64.4.0 is authenticated, and the official Vercel plugin plus shared `https://mcp.vercel.com` configuration were installed with successful OAuth authorization. Restart Codex to load the new plugin/MCP tools. MCP documentation-search and team-list tool calls have not been verified in this session, because those tools were not loaded after installation.

### Configuration checklist

1. Apply existing scheduler migrations first, then `supabase/migrations/20261017010000_northport_recovery.sql` in a staging Supabase project. Exercise approval and concurrent upload claims there before applying it to production. This migration has not been executed against a live database by this implementation.
2. Set existing server-side Supabase/session settings and `SCHEDULER_PORTAL_URL` to the portal origin. Existing CargoMove scheduler credentials and gallery configuration remain in use.
3. Configure the server-only FTP variables in `.env.example`. Never add a `VITE_` prefix. The supplied FileZilla XML specifies FTP protocol 0, port 21, default passive mode and auto encoding, but contains **no password**. Obtain the password through the existing secret-management process.
4. Keep `NORTHPORT_RECOVERY_UPLOAD_ENABLED=false`. Deploy and use the read-only connection check before preparing any production upload.

| Variable | Purpose / default |
| --- | --- |
| `NORTHPORT_FTP_HOST` | `ftp.cargomove.my` |
| `NORTHPORT_FTP_PORT` | `21` |
| `NORTHPORT_FTP_USERNAME` | `northports` |
| `NORTHPORT_FTP_PASSWORD` | Required; no password was supplied |
| `NORTHPORT_FTP_SECURE` | `true` for explicit TLS (runtime default), `implicit` for implicit FTPS, `false` only after verification of legacy FTP |
| `NORTHPORT_FTP_ALLOW_PLAINTEXT` | Defaults disabled; explicit server-only opt-in for a verified legacy configuration |
| `NORTHPORT_FTP_BASE_DIR` | `/ftp/CY/PROD/CONTAINERS` |
| `NORTHPORT_FTP_SUCCESS_DIR` | `/ftp/CY/PROD/CONTAINERS/SUCCESS`; must be the incoming directory's SUCCESS child |
| `NORTHPORT_FTP_LISTING_MODE` | `timestamp-scan` (default, bounded exact filename checks); `full` and incomplete `date-pattern` remain legacy alternatives |
| `NORTHPORT_RECOVERY_UPLOAD_ENABLED` | `false` until all gates below pass |

The example `SECURE=false` records the observed FileZilla configuration; it is not a recommendation. Run `npm run northport:check -- --probe-tls` to test explicit AUTH TLS with certificate verification and no login. Then set the verified secure mode and run `npm run northport:check` for authenticated PWD/CWD/passive listing checks using the configured listing mode. The page has an equivalent authenticated read-only check. No check uploads, renames or deletes files. TLS connections never automatically downgrade; certificate verification is never disabled. See the local verification findings below; Vercel egress and account access require their own read-only check after deployment.

If the account is chrooted, use the absolute paths exposed **inside that account**, for example `/CONTAINERS` and `/CONTAINERS/SUCCESS`. Do not automatically fall back to guessed directories. If passive data connections fail, verify firewall/NAT rules and Vercel egress access with the FTP operator. The client rejects a different passive transfer host by default.

### Local read-only verification, 17 October 2026

The user reported applying the migration and supplied the FTP password locally. The explicit AUTH TLS probe reached the server but received FTP 500 during TLS negotiation. The user then authorized a plain FTP read-only test; local configuration now uses `NORTHPORT_FTP_SECURE=false` and `NORTHPORT_FTP_ALLOW_PLAINTEXT=true`. This does not establish that other encrypted connection modes are unsupported.

Authenticated login and CWD checks succeeded. The account root is `/`; incoming and SUCCESS resolve exactly to the configured `/ftp/CY/PROD/CONTAINERS` and `/ftp/CY/PROD/CONTAINERS/SUCCESS` paths. A direct passive download of the known GP reference succeeded twice (472 bytes, three records, exact 20-column schema); CSV contents were neither printed nor saved.

The full SUCCESS listing timed out. A date wildcard listing returned quickly (17 entries for `*20261017*`, including the known EX reference); an empty-date listing returned zero entries. However, the date wildcard listing omitted `CM_CONTAINER_20261017012016_GP.csv`, and a subsequent direct download of that same filename still succeeded. Exact LIST and SIZE also confirmed that file exists; LIST, LIST -a and NLST wildcard queries all omitted it. **Filtered-list completeness is therefore unverified; omissions must not be interpreted as missing files.** The FTP operator still needs to reconcile this server behavior.

The initial workaround used `date-pattern` with an explicit incomplete-search warning. It has now been replaced locally and by default with **`timestamp-scan`**, which discovers files independently of the incomplete wildcard listing. `date-pattern` remains available only as a legacy, explicitly incomplete mode; `full` retains the full-directory listing cost.

The **Exact Source Filename (optional)** input remains an advanced shortcut: a validated Northport filename must fall within the search window and match the GP/EX filter, then its size and bounded CSV contents are read directly. File-specific searches report only that file's coverage, never whole-window coverage. Ordinary timestamp searches now require no filename. A live check for `TXGU4841312` with Malaysia timestamp `2026-10-17T01:15:26`, five minutes before, thirty after and GP selected checked all 2,101 second-resolution filenames, downloaded ten CSVs, read 34 container records, and found record 2 in `CM_CONTAINER_20261017012016_GP.csv`. The reference CSV contains multiple different containers; the search scans every data row, not just the first. These observations are from the local runtime, not Vercel deployment verification. Production upload flags remain disabled. No new database migration is needed for these search changes.

Read-only diagnostic commands: `npm run northport:check -- --sample-file=CM_CONTAINER_20261017012016_GP.csv` downloads and validates only that bounded sample in memory; `npm run northport:check -- --list-date=20261017` probes wildcard metadata only. `--show-filenames` additionally displays filenames, never CSV contents or credentials. These diagnostics do not change recovery admission or upload gates.

`npm run northport:check -- --inspect-listing` compares exact and wildcard LIST/NLST metadata. `npm run northport:check -- --search-unit=TXGU4841312 --timestamp=2026-10-17T01:15:26 --type=GP` exercises the shared timestamp-discovery and CSV parsing code across all batches without creating approvals or saving CSV values. The script prints progress, matching filenames and record numbers. `--before` / `--after` override the default five/thirty minutes; `--source-filename` selects a single known source. `--probe-minute=202610170120` measures metadata checks for one minute without downloading CSVs. Do not place passwords on command lines or in `.env.example`; keep them in ignored `.env.local` or deployment secrets.

### Automatic timestamp search

Leave the exact filename empty. For each second in the inclusive Malaysia-time window and each selected type (GP, EX or both), the backend derives the canonical filename `CM_CONTAINER_YYYYMMDDHHMMSS_TYPE.csv` and checks it with read-only FTP SIZE. This uses Northport's confirmed uppercase convention; it does not claim coverage of filenames that violate that convention. Arbitrary-case filenames remain supported by explicit filename lookup and the legacy listing parser.

Only explicit FTP 550 **file-not-found** responses are treated as absent. Permission errors, unsupported commands, login failures and network errors stop the search. A failed query never silently advances progress. A discovered CSV is downloaded once, parsed with the fixed 20-column schema, and **every UNIT row is checked**. Unrelated dates/types are never downloaded. Original SUCCESS files are never modified.

One HTTP request handles at most 600 filename checks or 15 seconds of metadata work, followed by the discovered CSVs. The existing 45-second FTP session deadline still bounds each request. The backend returns an actor-bound, signed continuation containing normalized search parameters, progress and cumulative resource usage; it expires after thirty minutes. The browser automatically continues from that exact position, retains matches from every batch, displays filename/file/record progress and honors the shared five-second request rate limit. No CSVs, search results or queued jobs are stored in Supabase. HTTP success for one batch does not mean the search is finished: API clients must follow `nextCursor` until it is null, and inspect `complete` and any errors.

Cancel closes the current request where supported and stops further batches. Cancelled/interrupted results are explicitly incomplete. A malformed CSV also keeps the final result incomplete, including when its error occurred in an earlier batch. There is no automatic retry of failed batches and no automatic range expansion. Starting a new read-only search is safe.

The complete scan is bounded to 36,000 filename checks, 40 discovered files, 16 MiB downloaded CSVs, 100 returned matches and 1 MiB of match responses across all batches. The check count is `(seconds in window + 1) × selected types`; select GP/EX or narrow the window if the cap is exceeded. The measured 120-check, one-minute GP/EX probe took about 2.4–2.7 seconds locally; a default 35-minute search may take around a minute or longer depending on type selection and network latency. It is complete only after the entire requested canonical filename space has been checked, not when the first container match appears.

## Worker compatibility and enabling production recovery

Obtain worker-owner evidence in staging for every item, record the evidence in the deployment/change ticket, and set each corresponding server environment flag to `true` only after verification:

| Verification flag | Required evidence |
| --- | --- |
| `NORTHPORT_READONLY_VERIFIED` | Correct account-root incoming/SUCCESS paths, authenticated login, filename discovery and passive download work with the chosen TLS/security mode |
| `NORTHPORT_SINGLE_RECORD_VERIFIED` | Worker accepts a header and exactly one container record |
| `NORTHPORT_FILENAME_VERIFIED` | Worker accepts `CM_CONTAINER_YYYYMMDDHHMMSS_GP.csv` / EX, including generated timestamps, and ignores hidden `.part` transfer files |
| `NORTHPORT_SERIALIZATION_VERIFIED` | Worker accepts generated quoting, UTF-8/ASCII, BOM policy, exact field order and observed record separators, including any non-ASCII edited values |
| `NORTHPORT_NON_NORTHPORT_VERIFIED` | Worker accepts CSVs generated by this portal |
| `NORTHPORT_DUPLICATES_VERIFIED` | Known behavior for existing containers, duplicate transactions, GP/EX and record-identifying fields |
| `NORTHPORT_RENAME_NO_REPLACE_VERIFIED` | Same-directory RNFR/RNTO is atomic **and refuses an existing destination**, including competing Northport writers; ordinary FTP servers may overwrite during rename |
| `NORTHPORT_TIMEZONE_VERIFIED` | Port filename timestamps use Asia/Kuala_Lumpur; compare port evidence and FTP metadata without substituting modification times |

Only then set `NORTHPORT_RECOVERY_UPLOAD_ENABLED=true` and redeploy. The backend requires every gate in addition to the master flag. These flags attest to external evidence; they do not themselves test worker compatibility. If the server cannot guarantee no-replace rename, keep uploads disabled and arrange a server-side no-overwrite publish mechanism with the FTP operator. A preflight existence check alone cannot prevent a race with an external writer.

The implementation performed **no production FTP writes, scheduler executions, or database migrations**. Automated FTP and scheduler tests are mocked. Live rollout and worker compatibility remain integration tasks.

## Support usage

1. Enter a container number and port-generated timestamp including seconds (Malaysia time). Select All, Import GP or Export EX. Defaults are five minutes before and thirty after; each bound allows 0–1440 minutes.
2. Click **Search FTP** to check the entire time range; no filename is needed. The displayed window handles midnight/date changes. Watch progress until scanning finishes; every discovered CSV is read and all its container rows are checked. The filename timestamp is the only candidate-time criterion; modification-time fallback is not used. **Use exact filename (advanced)** exposes the optional single-file shortcut; **Search by time range** clears it and restores the normal workflow.
3. Inspect every relevant match. Nothing is selected automatically. **View Details** displays all fields read-only; **Edit Record** allows editing. Record numbers count data records, excluding headers and blank lines.
4. Reset or review changes. The comparison includes every field, with changes highlighted. UNIT, GPNO, EXPNO and BLNO changes require an additional confirmation. Business validations beyond structural safety need worker-owner confirmation.
5. Click **Approve & Generate Recovery CSV**, confirm the dialog, and inspect the plain-text preview. Approval saves only metadata and a SHA-256 fingerprint binding the source digest and generated CSV digest; complete rows are never stored in Supabase. This does not upload anything.
6. Once production gates are enabled, explicitly select **Upload Recovery CSV**. The source file is downloaded read-only and its hash checked again. The database atomically claims the approved recovery and allocates a unique Malaysia timestamp filename. Upload uses a hidden UUID `.part` file, checks size, rechecks destination absence and renames to the final filename. SUCCESS is never modified.
7. After **Recovery File Uploaded**, choose **Run Scheduler Now** or **Process Later** in history. Run Scheduler invokes the **existing** scheduler handler and database admission functions, retaining the shared global lock, five-minute cooldown and uncertain-outcome safeguards. It records the existing scheduler execution ID and response status. Its HTTP success only means a trigger was requested.

### Reprocess and run the existing Northport scheduler

Each matching result has a **Reprocess** action. It opens that selected record directly in the review section without uploading anything. Review all twenty fields, use **Back to Editor** if changes are needed, and explicitly approve with **Approve & Generate Recovery CSV**. The generated preview contains only the approved container record.

Then choose **Reprocess & Run Scheduler** and accept the confirmation. The portal uploads the new single-container CSV into `/ftp/CY/PROD/CONTAINERS`, waits for the backend to confirm `Uploaded`, then requests the existing **Northport Containers** scheduler (`northport_containers`, saved default scheduler ID ending `0005`). No scheduler is recreated and the original CSV in SUCCESS is not moved or changed. Upload and scheduler dispatch use separate existing audited API requests with a 5.1-second pause for request admission, keeping each function within its current execution budget. Scheduler dispatch occurs only after confirmed upload; there are no automatic upload or scheduler retries.

The interface reports upload progress separately from scheduler progress and preserves the recovery audit association. A scheduler failure/cooldown after upload means the file remains uploaded; check recovery history and the scheduler audit instead of submitting it again. If the browser is closed between upload and scheduler dispatch, history retains the uploaded recovery and its existing **Run Scheduler Now** action when dispatch has not been claimed. Scheduler success still reports **Verification Unavailable** for container import until a real verification API is integrated.

**Upload Recovery CSV** remains the separate upload-only choice. Both upload choices require the existing master feature flag and every production compatibility gate; adding Reprocess does not enable those flags or confirm worker compatibility. The current local production-upload settings remain disabled. All Reprocess tests use mocks and do not write to production FTP or execute the production scheduler. This workflow needs no additional database migration.

There is no existing container-import query/API in this repository. Consequently the tool reports **Verification Unavailable**, never infers import success from FTP disappearance, scheduler HTTP 200, or a moved file. `Processing` and `Import Verified` are reserved audit statuses for a future independently verified integration. Scheduler failure details use the existing handler's sanitized messages; execution IDs correlate with its existing audit table. No worker logs are available through the current integration.

## Format and safety

The reference GP fixture has three records and EX has four. Both contain ASCII bytes, no BOM and **CR CR LF (`\r\r\n`) record separators**, which look like blank lines in the editor. Generation preserves that separator. Regular CRLF and LF sources are supported too; mixed separators, bare CR, unsupported encodings and malformed records are rejected. Empty lines are skipped, all values remain strings, and header order must exactly match the confirmed 20 columns. Quoted values/commas use `csv-parse` and `csv-stringify`; no comma splitting is used. Original optional quoting is normalized to valid CSV quoting; all-quoted headers retain all-quoted serialization. This is why staging serialization verification is mandatory.

Each field is limited to 1000 characters. UNIT uses uppercase trimmed letters/digits (maximum 32), without inventing an ISO check-digit or domain rule. Blank fields are preserved. Newline/control characters in fields are rejected. Formula-looking strings are preserved for the production importer and displayed as escaped React text in a plain-text preview; they are never executed or silently prefixed with spreadsheet escapes that would alter worker data. Do not open the raw worker CSV in spreadsheet software.

Every backend mutation requires the same-origin header and a dedicated confirmation header. Request bodies are limited to 64 KiB. Search records have signed, actor-bound source tokens expiring after 30 minutes. Continuation cursors use a separate signing purpose and bind actor, filter and cumulative progress; changing the container, time window or type invalidates them. Every continuation independently repeats server-side authentication and rate admission. No CSVs or full row values enter Supabase Storage or database tables. The only search-related database write is one small per-actor request-rate record, updated once per batch; authentication uses existing infrastructure.

Database unique constraints prevent the same source record or container from receiving another independent approval. Identical repeat approval by the same actor is idempotent while still Approved (useful after a lost response or refreshing and searching again). The upload claim is a single atomic transition and cannot be repeated. Different edited UNIT values cannot bypass the source-record constraint. Audit access is server-only through current ADMIN authorization; RLS denies browser roles. Every actor can issue one POST operation per five seconds across server instances. History is limited to the latest 50 attempts, including changed **field names**, submitter, approval time, source and recovery filenames and scheduler correlation, not original/edited field values.

An upload may leave `Uploading` if a function is killed, or `Failed` if its outcome is uncertain. Do not automatically retry or delete temporary/final files. An operator must inspect incoming/SUCCESS, CargoMove records and scheduler audit, establish whether the file was consumed, and document reconciliation. The UI deliberately has no automatic resubmit button. A privileged, reviewed database change is required to release a container for a later legitimate recovery; never delete the old audit trail. Approved drafts can be resumed by repeating the same search and identical approval; expired tokens require a fresh search.

## Performance and background-worker design

In `full` mode, standard FTP LIST/MLSD retrieves the full directory listing before filename filtering. Date-pattern behavior is server-specific and may still incur a server-side scan; its reduced network response is not a guarantee of cheaper server execution or complete results. The observed server returned date listings quickly but omitted an existing file, so `date-pattern` responses always carry an incomplete warning. Exact-filename mode does not list directories. Bounds: 10-second socket inactivity, 45-second total FTP session, 8 MiB per raw directory listing, 20,000 combined date-list metadata entries, 40 candidates, 2 MiB per file, 16 MiB total downloads, 100 matches and 1 MiB match response. Date-list metadata is deduplicated; each calendar date intersecting the window is requested once. There is no automatic fallback to an unrestricted listing. A limit breach returns an error, not an incomplete success. Malformed candidates produce per-file validation errors and explicitly incomplete search results; no tokens are issued for those files. UI cancel aborts the HTTP request; the server closes the FTP connection when its runtime exposes the disconnect, otherwise the deadline closes it. There are no automatic FTP retries (zero is the bounded retry policy); read-only searches may be explicitly retried. This avoids replaying writes.

Vercel's function budget is 120 seconds for the recovery endpoint (including the existing scheduler flow), with Chromium included as for the current scheduler. The two upload FTP sessions are individually bounded to 45 seconds. Confirm these limits and account egress in the deployment plan. If the directory cannot be listed within 45 seconds/8 MiB, do not silently truncate or claim a complete search. Production uploads should stay disabled until search performance is measured against the real account.

The Hobby-plan deployment uses one `api/dev-tools.ts` dispatcher for scheduler catalog, scheduler execution and recovery. Explicit Vercel rewrites preserve `/api/dev-tools/schedulers`, `/api/dev-tools/run-scheduler` and `/api/dev-tools/northport-recovery`; each existing handler retains its own authorization and method checks. This keeps the deployment within the twelve-function limit without changing the Express development routes or creating a second scheduler. `.vercelignore` excludes local environment files, tests, diagnostics and documentation from deployment uploads; production Northport configuration is stored as server-only Vercel environment settings, with recovery uploads disabled.

For that larger-directory case, use a separately deployed long-running Node worker with the same ADMIN-gated request protocol, private service authentication and no public FTP credentials. A suitable queued extension is:

1. An authenticated API creates a metadata-only job with actor, normalized container, timestamp window/type, status, lease and expiry; one active search job per actor. Return `202` and a job ID. Do not queue uploads automatically.
2. A worker atomically claims jobs with `FOR UPDATE SKIP LOCKED`, renews leases, streams MLSD/LIST into a bounded filename index outside the request budget, and reports listing/scanning progress. Index only filename/time/type/size/modification/indexed-at metadata, never CSV content. Large backfills use durable batches and restart from an explicit checkpoint; MLSD does not universally provide pagination, so a restart may require relisting and deduplicating filenames.
3. Mark a directory snapshot complete only after a successful entire listing. Record its generation/start/end times. A partial or stale index must be shown explicitly; it cannot support an authoritative “not found” result without a live completeness check. Reconcile deleted/renamed entries after completed scans.
4. Download only candidates into worker memory using the same limits/parser, retain matching results encrypted with a short TTL in the worker's private transient result store, and return only those records to the requesting admin. Poll progress through the authenticated API. Check cancellation between FTP operations and close the socket on cancellation/deadline. Delete expired transient results.
5. Keep approval, production-upload claims and scheduler admission in the current audited database flow. Never treat a background search retry as permission to upload or dispatch a scheduler.

This queue/index is a deployment design for future larger workloads, not an enabled dependency or a claim that the directory has been indexed. The implemented default uses browser-driven, signed continuations across bounded backend → FTP sessions, independently of directory listing performance. A durable worker is still appropriate if searches must continue after the browser is closed or exceed the current filename-check cap.

## Validation

### Local API route troubleshooting

If the page receives HTML containing `Cannot GET /api/dev-tools/northport-recovery`, the API process may predate the recovery route. Restart the backend using `npm run dev:api` from this repository. That command now watches backend imports and `.env.local`, so future changes reload automatically. Vite proxies `/api` to port 8787; restarting only Vite does not replace a stale backend. The recovery page reports a clear API/deployment message for HTML responses instead of displaying a JSON parser exception.

An unauthenticated GET to this route should return HTTP 401 with JSON (`Administrator authentication required.`), both directly on port 8787 and through Vite on port 3000. That proves routing is working; authenticated requests still independently verify the current ADMIN role. Hosted portals require deployment of the matching backend API function.

Files added:

- `src/components/admin/NorthportRecovery.tsx` — dedicated recovery page.
- `src/types/northport.ts` — shared fixed schema and response types.
- `src/services/northportReprocess.ts` — upload-confirmation-before-scheduler orchestration, with explicit partial-failure messages and no retries.
- `server-handlers/northport/format.ts` — timestamps, validation, CSV parsing/generation; `scan.ts` — bounded filename probing and signed continuation state; `listing.ts` — timestamp scan and legacy listing/file discovery.
- `server-handlers/northport/ftp.ts` — bounded passive FTP sessions and guarded temporary uploads.
- `server-handlers/northport/handler.ts` and the consolidated `api/dev-tools.ts` — authorized API and existing scheduler reuse, with stable public endpoint rewrites.
- `supabase/migrations/20261017010000_northport_recovery.sql` — metadata audit, rate admission and atomic claims.
- `scripts/check-northport-ftp.ts` — read-only TLS and authenticated diagnostics.
- `tests/northport.test.ts`, `tests/northport-db.test.ts`, `tests/northport-scan.test.ts`, `tests/northport-reprocess.test.ts`, `tests/northport-ui.ts` and the two supplied CSVs under `tests/fixtures/northport/` — isolated verification, including Reprocess confirmation, feature gates, upload ordering and scheduler failures.
- `.gitattributes` — preserves fixture bytes; this guide — configuration and usage.

Files modified: `src/components/admin/AdminLayout.tsx`, `src/components/admin/DeveloperSettings.tsx` (page access); `server.ts`, `vercel.json` (local/serverless routing and execution packaging); `.env.example` (server-only settings); `package.json`, `package-lock.json` (FTP/CSV runtime dependencies, PGlite test dependency and scripts). Existing scheduler implementation and migrations were reused without modification.

Run `npm run test:northport`, `npm run test:northport:ui`, `npm run test:scheduler`, `npm run test:scheduler:ui`, `npm run lint` and `npm run build`. Run the build and TypeScript check sequentially because the existing TypeScript configuration also discovers generated JS under `dist`. Browser tests intercept all requests; FTP tests use in-memory mocks and the supplied fixtures. The migration test executes the actual SQL against isolated in-memory PostgreSQL (PGlite), checking role revocation, RLS permissions, duplicate approvals, unique filenames and one-time upload/scheduler claims. No automated test uses production FTP or Supabase. Run authenticated read-only diagnostics separately. Use the offline test environment rather than production credentials. Validation here ran on the available Node 25 runtime; deployment remains configured for Node 24 as in the existing project.

Technical references: [basic-ftp API and TLS/passive behavior](https://github.com/patrickjuchli/basic-ftp), [csv-parse options](https://csv.js.org/parse/options/).

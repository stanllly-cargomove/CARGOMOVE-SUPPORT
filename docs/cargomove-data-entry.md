# CargoMove registration Excel uploads

Authenticated, read-only inspection on 24 October 2026 confirmed that Playwright
can navigate all three Data Entry tabs. No file was selected or uploaded, no
scheduler was invoked, and no application database was queried. This established the integration points. The implementation below is covered by
offline tests; no production upload or scheduler was triggered for validation.

## Verified portal structure

All tabs share `https://www.cargomove.my/administration/data_entry` and use
Bootstrap panes. Click the tab and wait for its pane to become visible; do not
assume changing the URL fragment alone activates an already loaded tab.

| Record | Tab link | File input | Upload button | Recent uploads |
| --- | --- | --- | --- | --- |
| Vehicle | `a[href="#pane-vehicle"]` | `#file-vehicle` | `#pane-vehicle .btn-upload[data-entity="vehicle"]` | `.jmd-uploads-table[data-entity="vehicle"]` |
| Trailer | `a[href="#pane-trailer"]` | `#file-trailer` | `#pane-trailer .btn-upload[data-entity="trailer"]` | `.jmd-uploads-table[data-entity="trailer"]` |
| Driver | `a[href="#pane-driver"]` | `#file-driver` | `#pane-driver .btn-upload[data-entity="driver"]` | `.jmd-uploads-table[data-entity="driver"]` |

Each file input accepts `.xlsx`. The portal locks the picker after selection;
the separate upload button reads the selected file despite the disabled input.
Playwright's `setInputFiles({ name, mimeType, buffer })` can select a generated
workbook directly from memory without an operating-system file dialog.

The portal's `/design/js/admin_data_entry.js` reads the workbook with FileReader
and sends an AJAX POST to `/administration/data_entry_upload_ajax` with
`entity`, `country`, `base64`, `filename`, and `original_name`. The country
control is `#jmd-country`, observed as `MY`. Upload feedback is in
`#upload-feedback-<entity>`. An HTTP success alone is insufficient: the script
checks the JSON `state` field. The upload response itself was not exercised.

## Templates and existing exporter

The first row of each downloaded portal template exactly matches the existing
`EXCEL_TEMPLATES` in `src/services/excelExport.ts`:

- Vehicle: `REGISTRATION, HAULIERID, FORWARDING_AGENT_ID, COMPANYTYPE, WEIGHT, BGK_WEIGHT, HEAD, PORTS`.
- Trailer: `REGISTRATION, HAULIERID, FORWARDING_AGENT_ID, COMPANYTYPE, WEIGHT, TYPE, BDM_WEIGHT, PORTS`.
- Driver: `DRIVINGLICENSE, HAULIERID, FORWARDING_AGENT_ID, COMPANYTYPE, MOBILENO, NAME, PORTS`.

Templates are available at
`/administration/data_entry_download_template/<entity>?country=MY`.
Matching headers do not establish that all exported values will be accepted.
Validate company type, the corresponding external company ID, required record
fields and port IDs before dispatch. Preserve trailer slashes and leading zeros
in driving licences and phone numbers.

`shared/registration-excel.ts` provides the same pure mapping and validation for
browser downloads and server generation. The upload endpoint loads submissions,
company IDs and port configuration from the main application database; the client
supplies only a submission/job ID, never workbook rows or scheduler targets.

Phase one wires **Generate Excel** in the submission queue, review dialog and
Excel Export Center to the asset upload flow. Bulk export produces one workbook
per registration reference. Filenames follow
`<reference>_<type>_<attempt-UUID>.xlsx`. Company registration remains a manual
Excel download, also named by its registration reference. Draft downloads retain
a `DRAFT_` prefix and do not start uploads.

## Processing and result tracking

`POST /administration/data_entry_uploads_list_ajax` is a read-only listing with
`entity` and `country`. Authenticated reads succeeded for all three entities.
Rows expose `_id`, `filename`, `original_name`, `uploaded_by`, `t`, `status`,
and `message`. Existing results included `success` and `error`; message keys
included `not_processed`, `processing_started`, `success` and `error`.
Processing messages contain `SuccessCount` and `ErrorCount`.

The page refreshes history on initial load, tab changes and upload acceptance.
Its script has no automatic polling. Automation therefore needs bounded listing
polls or tab reloads to observe later processing results.

The inspection found the external worker `process_file_uploads`. Migration
`20261024010000_registration_cargomove_uploads.sql` binds its existing saved
scheduler UUID once in `registration_upload_settings`. Runtime requests use that
UUID, so renaming **CM PROCESS FILE UPLOAD** has no effect. A missing, disabled or
retargeted entry prevents dispatch. Existing scheduler authorization, admission,
shared cooldown, dispatch audit and uncertain-outcome handling remain in use.

## Company registration status

Company Master uses only `registration_status` (Pending/Registered/Rejected,
stored as PENDING/DONE/REJECTED). The legacy company activity field is removed.
Customers can submit drivers, trailers and vehicles for companies of any
registration status. Admin upload/processing requires registration status
Registered and the required CargoMove external ID.

For companies registered through the form, the latest COMPANY entry in the
registration queue controls this field. Queue changes, rejections and reversions
update Company Master automatically. The company editor shows a read-only linked
status for these records; stale master edits cannot override a Pending queue item.

For companies imported through Dev Tools without a Company form submission, edit
the Company list record and choose **Registration status → Registered**, then save.
JSON imports can set this explicitly:

```json
{ "registration_status": "REGISTERED" }
```

The importer also accepts DONE, PENDING and REJECTED. New records default to
Pending until approved or explicitly imported as Registered. The legacy activity
field in cached company data is stripped from outgoing master writes.

The unapplied migration performs the requested one-time conversion: existing
Company queue requests that are Pending become Registered, existing master
records become Registered, and latest Rejected company requests remain Rejected.
Driver/trailer/vehicle and user requests retain their statuses. Future Company
registrations continue to start Pending. The activity column is dropped without
CASCADE, so unexpected database dependencies stop the migration for review.

The Company list column is **Reg. status**, with fixed-size uppercase status tags.
In the Pending queue's Driver, Trailer and Vehicle tabs, company names are orange
for Pending/missing registration and red for Rejected. Hover remains blue and
shows the corresponding short explanation. Company tabs, other queues and
Registered company names retain their normal appearance.

The UI checks eligibility in the review dialog, bulk selection and Export Center;
the server and database recheck before upload, scheduler dispatch and manual
Register actions. Verification
of an already uploaded file remains available. If approval is withdrawn after
upload acceptance, processing stays blocked and the same attempt can resume once
the company becomes Registered again.

## Lifecycle and queue behavior

1. An atomic per-submission admission creates a persisted upload attempt. Duplicate
   clicks and page reloads reuse an active or successful attempt.
2. The server generates Excel from current saved data, validates required fields,
   records dispatch intent and attaches an in-memory workbook to the correct tab.
   The returned workbook is also downloaded in the browser.
3. After upload acceptance, the next check finds the exact unique filename, saves
   its CargoMove upload ID when available, and requests the saved scheduler through
   the existing scheduler handler. Shared admission/cooldown failures wait safely.
4. Further requests check the exact upload. Only a terminal success with
   `SuccessCount == expected workbook rows` and `ErrorCount == 0` marks it Done and
   records export metadata. Email previews use only verified registrations.
5. Failures return/remain Pending. Their references are red with an accessible
   information button on desktop, mobile and the review dialog. Unverified outcomes
   also remain Pending and explain the uncertainty. The popup can check the
   existing upload without uploading another copy.

The persisted states are `PREPARING`, `UPLOADING`, `UPLOADED`, `DISPATCHING`,
`PROCESSING`, `SUCCESS`, `FAILED`, and `UNKNOWN`. A 110-second lease serializes
operations. Expired upload/scheduler dispatches become UNKNOWN rather than being
replayed. Unstarted preparation can fail safely. Stale browser upserts cannot
replace authoritative summaries or mark an unsuccessful attempt Done. Active
registrations cannot be edited or deleted until verification finishes.

The browser checks for up to three minutes per batch; an interrupted or longer
operation can resume from its reference popup or Generate Excel. A server check
marks processing unverified after ten minutes. It can still reconcile a later
terminal result. Closing the browser stops advancement; this phase has no
background job runner. A saved UPLOADED attempt resumes the scheduler stage on
the next check. Each request uses the existing 120-second Dev Tools function.

A definite upload rejection or zero-success processing failure can be retried
explicitly. Partial processing and failures with unknown success counts require
operator reconciliation first, preserving their successful rows and original
counts. UNKNOWN never requests the scheduler again. After checking CargoMove and
correcting the registration to avoid resubmitting successful records, an operator
may record a `resolution_note` and change the old attempt to FAILED through the
normal database maintenance process. A new Generate Excel request then creates a
new attempt. Do not resolve active work or an uncertain scheduler audit without
checking CargoMove; scheduler UNKNOWN resolution remains separate.

## Deployment and validation

Apply these migrations in order to **the main application Supabase project**,
after the scheduler gallery and latest 30-second scheduler migration, then deploy:

1. `supabase/migrations/20261024010000_registration_cargomove_uploads.sql`
2. `supabase/migrations/20261024020000_registration_upload_registered_company.sql`
3. `supabase/migrations/20261025000000_company_registration_status.sql`

Skip migrations already applied. The last migration backfills queue-based company
approval using the one-time conversion above, removes the company activity field,
and keeps queue-linked and imported-company approvals protected.
No migration is run by builds or tests. This change has not applied migrations or
deployed code.

If manually running `20261024020000_registration_upload_registered_company.sql`
reports that its function already exists, replace the SQL editor contents with
the current complete file and run it again. This guard migration is safe to retry:
it preserves an existing approval function (including the newer Company Master
logic), replaces the trigger function and recreates its single named trigger.
An existing function alone does not establish that the entire migration finished.
The base upload-table migration still runs once. The Company registration-status
migration is also safe to retry with its current complete contents: it performs
the initial approval conversion only when adding a previously absent column.
If `registration_status` already exists, it preserves all current statuses and
repairs functions, triggers and the future-row Pending default. This also handles
a partial manual install without approving new Pending requests. Do not run the
old unguarded conversion statements on their own.

The migration selects the already saved `process_file_uploads` entry independent
of its display title. If it was absent when migrating, set the purpose binding
once using its internal gallery UUID through normal database maintenance:

```sql
insert into public.registration_upload_settings(purpose,scheduler_id)
values ('registration_excel','<saved scheduler UUID>')
on conflict (purpose) do update set scheduler_id=excluded.scheduler_id;
```

Use the existing server-only `CARGOMOVE_USERNAME`, `CARGOMOVE_PASSWORD` and
scheduler origin/session configuration. No new provider credentials or Auto Mail
schema changes are needed. Workbook limits are 1,000 rows and 2 MiB per reference.

Run:

```text
npm run test:registration-uploads
npm run test:scheduler
npm run lint
npm run build
npm run test:registration-uploads:ui
npm run test:companies:import:ui
npm run test:company-queue-status:ui
```

The new tests use disposable in-process PostgreSQL (PGlite), injected automation,
and intercepted browser fixtures. They cover template mapping, leading zeros and
trailer slashes, file selection on all panes, exact-file/full-count verification,
failed/partial processing, authorization, durable duplicate suppression, expired
leases, scheduler UUID binding, shared cooldown responses, uncertain outcomes,
stale browser writes, reference downloads and desktop/mobile failure popups.
They do not connect to live databases or mailboxes. Live end-to-end processing
and deployment remain unverified.

## Repeating inspection

Run `node --import tsx scripts/inspect-cargomove-data-entry.ts` using the existing
server-only CargoMove credentials. The script permits login, verified read-only
listings, static assets and the inspected pages; it blocks upload, save and
scheduler dispatch URLs. Fixed template download and listing requests also use
the authenticated request context. It prints structural metadata and template
headers, without credentials, cookies, workbook data or upload-history rows.

Reference: [Playwright file inputs and in-memory buffers](https://playwright.dev/docs/input#upload-files).

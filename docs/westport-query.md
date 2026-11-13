# Westport Container Query

The admin **Tools → Container Query → Westport** view uses the existing
`POST /api/dev-tools/np-query` endpoint with `{ port: 'westport', containerNumber }`.
Omitting `port` retains the Northport flow. Existing administrator access, portal
origin checks, confirmation header and the per-administrator three-second
request limit apply to both ports. No database migration is required.

## Shared company account

Configure these server-only variables in `.env.local` for local development and
in the hosting environment for deployment, then restart/redeploy the backend:

```dotenv
WESTPORT_USERNAME=
WESTPORT_PASSWORD=
```

Use an authorized company Westports ETP account with Container Enquiry access.
Keep the password's exact value, including any spaces. Do not add `VITE_`
prefixes, commit credentials, place them in browser storage, or copy Chrome
session cookies into configuration. The view reports missing configuration
without contacting Westports. Administrators do not enter Westports credentials
in CargoMove; the shared account's query access is available to portal admins.

## HTTP login and sessions

The client uses Node fetch against the fixed `https://etp.westports.com.my/`
host. It does not import Playwright or launch a browser. The login sequence is
based on the public login page's code:

1. GET `/?t=default&app=login`, retaining cookies.
2. POST to that URL with `node_ajax_id=50`, `action=signin_attempt`, `user_id`
   and `password`. Only the exact `Proceed` result advances the login.
3. POST the form to the same URL with the different field names `userid` and
   `passwd`, retaining rotated cookies and following bounded same-origin HTTPS
   login redirects.
4. POST `/` with `node_ajax_id=2609`, `action=get_container` and `cont_no`.

Cookies remain in private memory per server instance. A warm session avoids
repeating login for each search. Cookie expiry/deletion and path scoping are
respected; sessions are proactively renewed after seven hours. Changing the
configured account invalidates the in-memory session. Concurrent queries to the
shared session are rejected as busy rather than racing cookie changes.

A query redirect to login, a 401/403 response, or an HTML `signin-form` is an
authentication failure even when the login page has status 200. An expired
cached session receives one login renewal and one repeat lookup. A newly
created session that is still rejected does not enter a login loop. Unsuccessful
login attempts pause further attempts for 60 seconds per instance; network
failures during login also retain this pause. This is not a distributed account
lock or a guarantee against account lockouts across multiple server instances.
Account resets, unlocks, OTP and CAPTCHA challenges require signing in directly
to Westports; the integration does not perform these actions.

The complete request has a 20-second timeout and each response has a 2 MiB
limit. Query redirects are not followed into login pages. Credentials, cookies,
raw upstream diagnostics, HTML and scripts are never returned by the API.

## Confirmed response format

An authorized read-only login and container lookup on 13 November 2026 confirmed
that ETP returns **DataTables JSON despite a `text/html` Content-Type**. The body
contains `iTotalRecords`, `iTotalDisplayRecords` and an `aaData` array. The
adapter checks that both counts equal the returned row count, validates every
container number and display field, and limits the response to 500 movements.
Zero counts with an empty array are a valid no-results response; missing counts,
partial results, mismatched containers and malformed JSON fail explicitly.

The confirmed fields supply HDL type, order type, container number, stacked time,
container reference, carrier, line, container type, F/E, status, vessel name, SCN,
export SCN and sequence. Values and nulls remain independent. The upstream
`hdl_ref` and `container_no_href` action HTML and nested `row_data` object are
not returned to the portal. The JSON fixture in
`tests/fixtures/westport-query.json` reproduces the observed schema using only
synthetic identifiers and business values; the authenticated response is not
stored in the repository.

The fallback HTML adapter requires a single table with `HDL TYPE`, `ORDER TYPE` and
`CONTAINER NO` (or `CONTAINER NUMBER`) columns. It validates every movement's
container number, row width and response bounds; explicit DataTables no-result
rows are accepted. Unknown HTML-table columns are retained. A header-only table
is not accepted as empty. Data is rendered as escaped React text. API values and
raw exports retain Westports column labels, movement codes and timestamp text.

The UI labels the `HDL TYPE` column **Category**, using the operator-defined
mapping **IN → Export** (red tag) and **OUT → Import** (green tag), with the same
badges as Northport. This presentation rule does not alter `hdl_status`, the
backend response, or CSV/Excel/PDF export values. Unknown handling codes retain
their source text with a neutral tag. Filters and category sorting recognize the
display labels, while filters also continue to match source values.

Compact stacked timestamps such as `20261113134826` display as
`13/11/2026 13:48`, matching ETP's minute-level table display. Full source
precision remains in the response and exports. Valid four-digit-year local/ISO
timestamps are also formatted; invalid or ambiguous dates remain as supplied.
No timezone conversion is applied to these local values. The initial order is
ETP source order; stacked-time sorting uses validated full timestamp values.

The view supports filter, sorting, pagination, repeat searches and local CSV,
Excel and PDF exports of filtered rows. CSV protects spreadsheet formula
prefixes; Excel cells are strings and PDFs render text locally. Failed refreshes
retain an explicitly labeled last successful result. Changing containers clears
the previous result before fetching. Changing ports clears results and filters.
Results are not persisted or polled.

Westport defaults to **2 rows per page**, with **2, 10, 20 and 50** available in
the existing dropdown. Changing pages, page size, sort or filter collapses the
selected details. Clicking a row or its category chevron opens that source
record's Common Details, Vessel / Voyage and Movement Details below the table,
without an extra upstream request. Collapse or Escape closes the panel and
returns keyboard focus to its trigger. A successful refresh resets selection;
a failed refresh retains the last successful selected record. The details use
the same category and date presentation rules, while keeping each record's
values independent.

## Offline checks and live verification

Run `npm run test:westport-query`, `npm run test:np-query`, `npm run lint`,
`npm run build` and `npm run test:np-query:ui`. They use injected credentials,
upstream fixtures and fake administrator access; they do not connect to live
databases, mailboxes or authenticated Westports sessions. The browser harness
uses the repository's existing browser test tooling only; the runtime Westport
integration uses HTTP exclusively.

Live verification confirmed the login sequence, session cookies and seven
returned movement records for the operator's supplied container. A repeat lookup
returned the same seven records using the warm session: one login and two
lookups, with no second login. Only
request statuses, response schema and counts were inspected in tool output;
credentials, cookies, raw records and identifiers were not added to this document
or fixtures. The temporary response used for structural inspection is excluded
from Git and the code graph and removed after verification.

For future live checks, configure the shared account privately, then search a
known container from the Westport view. Check that its movements agree with the
same account's ETP page. If ETP changes its schema, update the adapter from
sanitized response evidence and rerun offline checks. Never add an authenticated
HAR, session cookies or credentials to this repository or graph.

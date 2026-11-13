# Container Query

Container Query is an admin-only, read-only Tools page alongside NP Container and Auto
Mail. It does not use the NP Container FTP recovery workflow, modify bookings,
persist query results, or require a database migration.

Northport is the default port. Westport supports authenticated queries using a
shared company account (see [Westport setup](westport-query.md)). Kuantan Port
and Penang Port are selectable previews marked Coming soon; their
views retain the search bar and export controls in a disabled state and do not
submit queries. All port prompt cards display the selected port's logo; Kuantan
and Penang retain their full card logos while their header circles use separate
transparent symbols. Changing ports clears the current search, movements,
and expanded details. Selection is disabled during a running query or export.
Each port uses a local logo in `src/assets/ports` and a header availability dot:
green for supported Northport and Westport queries, amber for Coming soon. The dot indicates
feature availability, not a live connection check. API routes and component
filenames retain the internal `np-query` name.

The browser posts a normalized container number to `/api/dev-tools/np-query`.
Both Express (`server.ts`) and the existing deployed Dev Tools dispatcher route
to `server-handlers/np-query/handler.ts`. The handler reuses CargoMove's signed
session and current administrator access check, configured portal origin check,
and explicit request header convention. The portal origin must be configured
using the existing `APP_URL`/`SCHEDULER_PORTAL_URL` or Vercel URL settings.

The server sends a form-encoded POST to Northport's fixed public endpoint, with
no Northport credentials, redirects, automatic retries or polling. Requests have
a 15-second timeout and 2 MiB response limit. Concurrent queries from the same
administrator and requests within three seconds are rejected per server
instance; this is not a distributed rate limit or a statement of Northport's
query allowance. Honor any additional restrictions Northport communicates.

`htmlparser2` (already used transitively in this repository, now declared
directly) parses every `div.div_query_output` independently. Unexpected pages,
mismatched container numbers, conflicting fields and invalid weights fail
explicitly rather than returning misleading partial data. Recognized no-result
messages return 404. Unrecognized/empty HTML returns an upstream error. Source
labels and values are retained in each movement's `rawFields`, including unknown
fields. Supported fields appear in the expanded details panel; the raw source
map remains in the API response rather than an additional UI section.

Weights use decimal strings without the kg suffix to retain precision and
trailing decimal places. Empty values are null. Usable Northport dates normalize
to `YYYY-MM-DD HH:mm:ss[.fraction]` without an inferred timezone offset. Invalid
dates normalize to null and their original text remains in `rawFields`.
Displayed dates use `DD/MM/YYYY HH:mm:ss`. `queriedAt` is the server-generated UTC
instant for the successful query; the UI labels its display as MYT.

The provisional CargoMove ordering is:

1. Movements with actual operational timestamps, descending by the maximum of
   Time Out, Time Load(Delv), Time Request(Delv), Time Stack and Time In.
2. Movements with no actual timestamps but a category-relevant ETA, descending
   by ETA and labeled Upcoming/Scheduled Movement. This label means a schedule
   exists, not that its ETA is in the future or its movement has completed.
3. Undated movements, then original source order as the tie-breaker in every group.

`latestRecordedMovementIndex` refers to the sorted response array and is null
when no record has an actual event. Expanded container details identify their
source record; all values come from that single record and its available evidence
is labeled explicitly.
Refresh replaces the entire result. Failed refreshes retain the explicitly
identified last successful result. A search for a different container clears the
previous result before querying.

PDF, CSV and Excel export all filtered rows in the selected order, across pagination,
with every supported field, source record number and movement evidence. Decimal
weights are text in spreadsheets to preserve precision. CSV protects formula
prefixes. Neither export modifies application records.

## Movement details layout

The search input, Search button, Clear / Reset and icon-only CSV/Excel/PDF download
buttons (teal, green and pink respectively) share one desktop row without a wrapper card, wrapping on narrow screens.
Search always performs a fresh query; there is no separate Refresh Query button.
The movement table is the first result. Details start collapsed. Clicking a
row or its arrow button in the Category cell expands that record below the table; selecting
another row replaces the detail view, and selecting the same row collapses it.
The toggle button exposes its expanded state for keyboard/screen-reader users.
The Collapse button restores focus to its row's toggle. Filter, sort, pagination,
successful queries and reset actions collapse details. Query time remains visible
in the movement toolbar even with details closed. Sortable headers cycle through
ascending, descending and the default operational order; there is no separate
Latest movement first button.

The movement table keeps Import/Export badges, uses the navy header style, and
contains F/E instead of the Time In, Time Out and Details columns. The number
column is omitted. Category, F/E, SCN, Yard Position and both weight columns
have centered headings and values. Operational
timestamps remain available in the expanded timeline, exports and default sort.
The Latest Recorded Movement label is omitted from the interface.

F/E is `F` for Full, `E` for Empty, or null when not supplied/recognized. The
parser accepts explicit `F/E`, `Full/Empty`, `Full Empty` and `Full or Empty`
labels with F/Full or E/Empty values, preserves the original source text, and
rejects conflicting flags within one record. No F/E value is inferred from
category, stage, size/type or weight. Northport's public response currently does
not provide that field in the checked example, so those movements display `—`.

The detail panel uses a fixed field layout: Common Details,
Vessel / Voyage, Timeline, Port Routing and Yard & Haulage. Holds & Permissions
is available from the shield icon immediately left of Collapse, on hover, focus
or tap; Escape, its close button or an outside tap dismisses the information.
All supported fields retain fixed slots, including missing values. Import prioritizes the BL and
inbound vessel column; Export prioritizes the booking number and outbound vessel
column. IN/OUT values belong to the selected record; values are never borrowed
from another movement. Selecting any returned movement requires no additional
query. Compact rows and equal-height blue headers align the cards; the connected
timeline marks only timestamps actually returned by Northport, with labels left
and timestamps right on the same line. The left column is Common Details;
the middle is Yard & Haulage/Vessel; the right is Timeline/Port Routing. Columns
share a common bottom edge on wide screens and stack at smaller widths. Yard &
Haulage values stay on one line with horizontal scrolling for long values,
and its compact card matches the Timeline height. Raw source
values are retained in the response but no longer rendered as an additional panel.

PDF export is generated locally as A4 pages with the complete supported field set
for each selected movement, continuing long values onto additional pages. It uses
print-resolution browser-rendered images to retain Unicode and decimal precision
without a new PDF library or server request. PDF text is rasterized; CSV and Excel
retain editable text data.

Navis-only fields such as commodity, freight kind, reefer, hazardous, cutoffs,
voyage, and eDO are not inferred from public query values. They require a verified
source before they can be populated. Screenshots are visual/data references, not
an additional runtime data source.

## Offline verification

`npm run test:np-query` covers the supplied synthetic two-record HTML fixture,
field mapping, independent weights, timestamp ordering, stable ties, errors,
timeouts, authorization, duplicate protection and export content.

`npm run build` followed by `npm run test:np-query:ui` exercises the real portal
navigation, NP Query UI, API dispatcher, handler, service and HTML parser with
injected admin access and upstream fixtures in desktop, tablet and mobile
browsers. It checks details, filters, sorting, pagination, refresh and downloaded
PDF/CSV/Excel files and permissions popup behavior. It never connects to a database or mailbox. Existing Northport
tests remain separate.

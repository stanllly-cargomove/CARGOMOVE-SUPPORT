# Support Inbox UI — Milestone 3

Implemented on `uat` after approval to proceed. Prior milestone changes are retained. No commit, push, merge, live database migration, AI call, automatic synchronization, email draft, or email send is performed.

## Behavior

- SUPPORT navigation provides AI Support Dashboard and Support Inbox using the existing admin layout and styling.
- `/admin/support`, `/admin/support/inbox`, and `/admin/support/case/:caseId` work as direct links and with browser history. Unauthenticated support links open the existing login view; privileged requests still require the server ADMIN guard.
- Dashboard cards, recent cases, category counts, and port distribution come from database queries. Loading/error states never substitute fabricated zero values. Resolved-today uses UTC. AI-draft count is the number of cases with DRAFTED status, not a claim of accuracy.
- Inbox queries are paginated at 20 cases. Search matches customer name/email, subject, message sender, and plain message text, including references and company names when present. Filters cover status, category, port, staff, confidence, and inclusive UTC creation dates. Staff labels map authorized application admins to Auth UUIDs on the server.
- Conversation pages contain at most 50 messages, with oldest-to-newest order within each page and newest pages first. Earlier history is accessible through Older messages. Customer and CargoMove messages, timestamps, status, assignment, category, port, urgency, and resolution timestamp are visible.
- Incoming messages render as React text; stored HTML is never injected into this UI. Attachment bytes are not available from Milestone 2 and no unsupported attachment controls are shown.
- Refresh cases reloads stored data and connection status. Sync Gmail runs one existing resumable batch only; Continue sync requests the next batch. Connection/consent errors and processing feedback are visible, with duplicate action clicks blocked. Reading stored cases is independent of Gmail connectivity.
- Status changes, staff reassignment, reply editing/sending, and AI analysis remain deferred to their milestones. No unavailable navigation sections or inactive AI controls are added.

## Files created

- `supabase/migrations/20260916000020_support_inbox_queries.sql`
- `server-handlers/support/queries.ts`, `cases.ts`, `case.ts`, `stats.ts`
- `src/hooks/support/useSupportResource.ts`
- `src/utils/support/routes.ts`, `status.ts`
- `src/components/admin/support/SupportDashboard.tsx`, `SupportInbox.tsx`, `SupportStatsCards.tsx`, `SupportSyncControls.tsx`, `SupportCaseList.tsx`, `SupportEmailFilters.tsx`, `SupportCaseDetail.tsx`, `SupportStatusBadge.tsx`
- `tests/support-inbox.test.ts`, `support-inbox.database.mjs`, `support-inbox.browser.mjs`
- `docs/support-inbox-ui.md`

## Files modified

- `src/App.tsx`: login entry for unauthenticated support links.
- `src/components/admin/AdminLayout.tsx`: SUPPORT navigation and support-only history handling, retaining existing state-based tabs.
- `src/types/support.ts`, `src/services/support.ts`: list/detail/statistics contracts and authenticated, abortable API reads.
- `api/mail.ts`, `server.ts`: three support read routes using the existing consolidated Vercel function and shared local handlers.
- `vercel.json`: support API rewrite and support-page SPA rewrite.
- `SUPABASE_SETUP.md`: migration and live UI validation instructions.

## Database and security

One additive migration creates `list_support_cases(jsonb)`, `get_support_case(uuid,integer)`, and `support_inbox_stats()`. No existing migrations or tables change. All functions revoke execution from PUBLIC/anon/authenticated and grant only service_role.

The list and detail functions are read-only SECURITY DEFINER functions with a fixed `pg_catalog, public` search path and explicit table references. They resolve staff names/IDs using private Auth data without requiring broad direct Auth-table grants for API clients. Only ADMIN application users are included; password/token fields are never returned. Statistics use a read-only invoker function. The guarded server API validates enums, UUIDs, scalar arguments, search length, date order, and bounded offsets. SQL queries use parameters and literal substring matching, so search wildcards do not expand access. Browser RLS/grants from the foundation remain unchanged.

No environment variables or Gmail OAuth permission changes are required. Cancellation on navigation/filter changes prevents stale case content from replacing a newly selected conversation. Support data is held in component state, not persistent browser storage.

## Manual deployment

Apply earlier support migrations, then `20260916000020_support_inbox_queries.sql` in nonproduction Supabase before deploying. Verify service-role execution, browser denial, real counts, staff labels, case filtering/search, multi-page conversations, direct links, history navigation, and mobile layout. Use the existing Gmail reconnection/sync setup if no cases have been imported. Verify registration, templates, preview, sending, and logs continue to operate through the existing handlers.

## Validation

Commands:

```sh
npx tsc --noEmit
npm run lint
npm run build
node --import tsx tests/support-inbox.test.ts
PGLITE_MODULE=/tmp/cargomove-sql-check/node_modules/@electric-sql/pglite/dist/index.js node tests/support-inbox.database.mjs
```

The optional database suite uses isolated PostgreSQL with modeled prerequisite Auth/application tables. The optional browser suite serves the production build locally and intercepts every API call with test fixtures; it never contacts Gmail or Supabase. Install temporary `@electric-sql/pglite` or `playwright` into /tmp to reproduce these checks without changing application dependencies. Browser testing requires a Chromium runtime and its platform libraries.

Completed checks:

- TypeScript validation and lint passed.
- Production build passed; existing large-bundle warning remains.
- 3 filter/route/authorization tests passed.
- 30 isolated PostgreSQL query/security checks passed.
- 18 desktop/mobile browser checks passed with fixture APIs, including HTML isolation, unauthenticated entry, direct links, filter requests, message pages, deliberate sync, disconnected Gmail, and retry states.
- Existing Gmail parsing/synchronization tests passed (16 tests); its isolated PostgreSQL/API suite also passed (60 checks).
- `git diff --check` passed.

Browser screenshots were inspected at desktop and mobile widths. No new dependencies were added to package manifests or lockfiles. Temporary validation tools and browser libraries remained under /tmp. Live Gmail/Supabase deployment remains a manual verification step. The build retains the existing large-bundle warning.

## Next milestone

Milestone 4: validated structured AI classification and entity extraction. No reply generation yet. Work stops at Milestone 3 pending user approval.

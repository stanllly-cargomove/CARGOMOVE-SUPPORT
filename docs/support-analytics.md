# Milestone 9 — support analytics

Open `/admin/support/analytics` or **Support Analytics** in the admin sidebar. This is a read-only dashboard. No AI, Gmail, knowledge mutation, new credential, scheduled job or automatic sending is involved.

## Set up

1. Apply `supabase/migrations/20260917000030_support_analytics.sql` after Milestone 8.
2. Restart the API server.
3. Open Support Analytics. All time is selected initially. Optionally enter a From and/or To date, then **Apply dates**. Dates are UTC; To includes the entire selected day. **Refresh analytics** reloads stored data without importing Gmail or triggering AI.

The selected period is a **case creation cohort**, using `support_cases.created_at`. All subsequent stored activity for those cases is included, even when it occurs after the To date. This is not an activity-date filter. Imported cases have application creation dates that can differ from their email receipt dates. Current status/category/subcategory/port values supply the distributions; they are not historical snapshots of values at the period end.

## Metric definitions

| Metric | Recorded source and meaning |
| --- | --- |
| Total / new / open / resolved / currently escalated | Cases in the creation cohort, filtered by their current status; open means any status other than RESOLVED. |
| Escalation actions | Audited ESCALATE events attached to cohort cases. A case can have several actions over time. Historical cases with no recorded event can still be currently escalated. |
| AI classifications | Stored interactions with a non-null analysis key. Multiple distinct analyses of one case count separately. Cached API reads are not new interactions. |
| AI knowledge drafts | Saved reply drafts using the KNOWLEDGE template, whether sent or not. Cached generation does not create another draft. |
| Static template drafts | Saved ACKNOWLEDGE / REQUEST_DETAILS reply drafts; these do not call Gemini. |
| Knowledge replies unchanged / edited | Distinct approved interactions attached to confirmed SEND deliveries and KNOWLEDGE drafts, split by the stored generated/final comparison. Static replies are excluded; pending, failed and uncertain sends are excluded. Edits reflect exact text differences, including formatting. |
| Unknown comparison | Confirmed approved knowledge replies whose stored comparison is null. It is shown separately rather than inferred. |
| Confirmed CargoMove sends | SEND delivery operations marked DONE, including static templates. Gmail draft creation is excluded. Imported/manual Gmail replies without a CargoMove delivery receipt do not count here. |
| First response time | For each cohort case with an inbound message, elapsed seconds between its earliest stored inbound message and the earliest stored outbound message at or after it. Earlier outbound messages are excluded. Imported outbound messages count. Average and median use one sample per answered case. |
| Awaiting a first response | Cases with stored inbound mail but no qualifying outbound mail. Cases without stored inbound messages have no response-time sample. |
| Category / subcategory / port | Counts of cohort cases by current taxonomy. Null subcategory is UNCLASSIFIED; UNKNOWN port/category values remain visible. |
| Knowledge usage | Distinct saved reply interactions referencing each knowledge article; sent replies are the subset attached to confirmed SEND receipts. One reply referencing several articles contributes once to each article. Historical usage remains visible for inactive articles. Labels are the article's current code/title. Top 20 articles by draft usage are displayed. |
| Cases created by UTC day | Counts by application case creation date; only days with cases appear. |

Empty counts are zero and absent response samples show **No data**, not a fabricated zero-second response. Response times are elapsed calendar time, not working hours, and imported history may be incomplete. The dashboard does not estimate hidden Gemini calls, model token cost or AI accuracy. **Classification corrections are unavailable** because manual classification correction events have not been implemented; repeated analyses do not prove a human correction.

## API and security

`GET /api/support/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` validates optional calendar dates, rejects invalid ranges and converts the inclusive To date to an exclusive next-day UTC boundary. Admin authentication occurs before database access. Unsupported write methods are rejected.

The new stable SQL RPC `support_analytics(timestamptz,timestamptz)` uses existing service-role table permissions; PUBLIC/anon/authenticated execution is revoked. It adds no table or browser grant. Aggregate counts and article labels are returned without customer emails, message bodies, prompts, credentials or hidden reasoning. Abortable resource loading hides results from a previous date range while new data loads. Errors do not substitute invented values.

## Completion report

Created:

- `supabase/migrations/20260917000030_support_analytics.sql`
- `server-handlers/support/analytics.ts`
- `src/types/supportAnalytics.ts`
- `src/services/supportAnalytics.ts`
- `src/components/admin/support/SupportAnalytics.tsx`
- `tests/support-analytics.database.mjs`
- `docs/support-analytics.md`

Modified:

- `api/mail.ts`, `server.ts`: shared analytics route.
- `AdminLayout.tsx`, `src/utils/support/routes.ts`: sidebar and direct analytics navigation.
- `tests/support-inbox.browser.mjs`: analytics fixtures, date/empty-state/mobile/auth checks alongside earlier milestone regression checks.
- `SUPABASE_SETUP.md`: setup reference.

Database/security changes: one read-only service-only RPC. Existing customer registration, email templates, preview/send/logging, OAuth permissions and support workflows remain intact. No application dependencies or `.env.local` changes were needed. Temporary validation tools remain outside the repository.

No live migration, send, model call, commit, push or deployment was performed. Work remains on `uat`. The existing large JavaScript chunk warning remains (~1.42 MB before gzip).

SQL/API checks can be reproduced using temporary PGlite tooling:

```sh
PGLITE_MODULE=/tmp/cargomove-validation/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/support-analytics.database.mjs
```

Next milestone: Milestone 10 — Controlled Automation. Implementation stops here pending user approval.

Validation passed: TypeScript/lint, production build, 39 isolated analytics SQL/API checks, 78 desktop/mobile fixture browser checks (including previous support workflows), and 3 existing inbox/date/authentication unit checks. Secret variable names were absent from the production browser JavaScript. The mobile dashboard was visually inspected; no horizontal page overflow was detected.

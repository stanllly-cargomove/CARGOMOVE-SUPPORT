# Milestone 8 — learning suggestions

Staff corrections now become reviewable knowledge proposals at `/admin/support/learning`. Detection never calls AI, writes Gmail, changes knowledge, or approves its own output. Existing classification, replies, delivery and registration flows are preserved.

## Set up and use

1. Apply `supabase/migrations/20260917000020_support_learning.sql` after the Milestone 7 delivery migration. Do not rerun earlier applied migrations.
2. Restart the API. No new secrets, environment variables, OAuth scopes or dependencies are required.
3. Open **AI Learning** in the admin sidebar, or `/admin/support/learning` directly.
4. Click **Detect repeated corrections**. The first scan includes all existing confirmed sends. Detection only runs on this explicit admin action.
5. Open a proposal and expand **Correction evidence** to compare original generated replies with final sent replies and their reviewing admins. At most 20 evidence entries appear; the count represents all distinct cases.
6. Review the current knowledge, proposed wording and evidence. Repeated wording does not verify operational facts. Remove customer names, identifiers, contact details and case-specific instructions, and independently verify the generalized procedure.
7. Click **Edit & approve**, review/edit the full Knowledge Base form, then **Approve suggestion and save knowledge**. Editing is optional, but submitting this form is the explicit approval action. New articles start inactive, human review required and AI replies disabled. Staff may explicitly change these flags when appropriate. Existing source articles retain their activation/AI settings in the review form, with human review enabled by default; required verification and high-risk safety rules remain enforced.
8. Alternatively **Reject** the proposal. Use the status filter to see approved/rejected decisions and the approval snapshot. Repeated scans do not recreate a rejected group or alter reviewed evidence.

When a linked article changed after detection, approval reports a conflict and cannot overwrite it. Review/update the current article through Knowledge Base and reject the stale proposal if it is no longer useful. Refreshing the page does not silently rebase the proposal onto changed knowledge.

## Detection rules and limits

Only confirmed `SEND` deliveries with an approved, edited AI interaction and an exact matching stored final reply count. Unsent drafts, unknown/failed writes and unapproved text do not count. Comparing lowercased text with whitespace normalized excludes formatting-only/case-only changes.

Groups share category, subcategory, port, a single knowledge source (if exactly one exists) and the exact normalized final response. At least **three distinct cases** are required. Several replies from one case count once; the evidence records a stable interaction for that case. Repeated detection adds evidence to pending groups and advances their version only when evidence changes. A database advisory lock serializes scans; row locks serialize detection and review.

No semantic similarity model or custom machine learning is used. Different wording with similar meaning will not match. Identical final wording can include stylistic edits rather than operational corrections. A reply referencing several articles cannot reliably identify which article needs changing, so it produces a new-article proposal. The proposal is a review candidate, never verified policy. It is grouped by response wording, not by an automatically inferred text diff.

Existing classification output supplies taxonomy; this milestone does not add classification editing. Lists are paginated at 20; evidence display is limited to the latest 20 entries. Detection scans historical confirmed deliveries, so it can take longer as history grows. No scheduled scan or automatic knowledge activation is added.

## Database, APIs and security

The existing private `support_learning_suggestions` table gains a unique correction key, optimistic `updated_at`, source knowledge version, approved article ID and immutable approved article snapshot. A new private `support_learning_evidence` table links proposals to case/interaction evidence. Existing proposal fields and the pending/approved/rejected audit checks remain intact.

All new RPCs are service-role only, with browser execution revoked. Evidence has RLS enabled and no browser table grants. Every API requires an admin session; actor UUIDs come from that session, not request data. Reply/customer text is displayed through escaped React text, with no HTML injection. No hidden reasoning is collected or stored.

- `GET /api/support/learning?status=PENDING|APPROVED|REJECTED&offset=0`: proposals and total count.
- `GET /api/support/learning-detail?id=<UUID>`: proposal, current linked knowledge and comparison evidence.
- `POST /api/support/learning` with `{action:"DETECT"}`: deterministic scan.
- `POST /api/support/learning` with `{action:"REJECT",id,updated_at}`: reject and record session admin/time.
- `POST /api/support/learning` with `{action:"APPROVE",id,updated_at,article}`: validate a complete article, atomically save knowledge and approve the proposal. Duplicate codes and stale article/suggestion versions leave the proposal pending. Double review is rejected.

Approval stores the exact saved article snapshot so later Knowledge Base edits cannot erase the history of what was approved. Evidence and proposed wording remain available separately from the staff-approved article content.

## Completion report

Created:

- `supabase/migrations/20260917000020_support_learning.sql`
- `server-handlers/support/learning.ts`
- `src/services/supportLearning.ts`
- `src/components/admin/support/LearningSuggestions.tsx`
- `tests/support-learning.database.mjs`
- `docs/support-learning.md`

Modified: `api/mail.ts` and `server.ts` for shared routes; `AdminLayout.tsx` and `src/utils/support/routes.ts` for sidebar/direct navigation; `KnowledgeEditor.tsx` for optional initial values and an atomic custom save callback (ordinary knowledge saves retain their existing behavior); `tests/support-inbox.browser.mjs` for learning fixtures/workflow; `SUPABASE_SETUP.md` for setup.

No live migration, mail, model call, commit, push or deployment is performed by implementation tests. Temporary SQL/browser tools are installed under `/tmp`, outside project dependencies. The existing large JavaScript bundle warning remains.

Next: Milestone 9 — Analytics. Work stops after Milestone 8 pending approval.

Validation passed: TypeScript/lint and production build; 47 isolated learning database/API checks; 72 desktop/mobile fixture browser checks (including existing inbox, knowledge and delivery regressions); 41 Knowledge Base SQL/API checks and 4 knowledge validation/authentication unit tests. The production browser bundle contains no server secret variable names. The existing bundle size warning is ~1.42 MB JavaScript before gzip.

To reproduce SQL checks with temporary PGlite tooling:

```sh
PGLITE_MODULE=/tmp/cargomove-validation/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/support-learning.database.mjs
```

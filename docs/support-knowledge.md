# Milestone 5 — Knowledge Base

Implemented on `uat` after approval of Milestone 4. Staff can manage support guidance at `/admin/support/knowledge`. Saved AI classifications retrieve matching active, staff-approved articles. No reply generation, learning approvals, sending, or automation is introduced. Work stops before Milestone 6 pending approval.

## Behavior and approval

The SUPPORT sidebar includes Knowledge Base. Admins can search the full article text/code/keywords, filter by category, subcategory, port, active state, AI reply permission and human review requirement, and page through 20 articles at a time.

The editor exposes knowledge code, title, category, compatible subcategory, port, problem, possible cause, resolution, suggested action, keywords and all safety flags. New articles start inactive, with human review enabled and AI replies disabled. Activating an article is the admin's approval for retrieval; active saves are explicitly labeled Approve and save article. Activation/deactivation controls also appear in the list. No articles are seeded automatically and no delete API exists. Deactivation preserves the row and historical references.

Required fields and bounded content are validated server-side. Codes use letters/digits/underscores/hyphens and are unique. Keywords are deduplicated and bounded to 30 entries of 80 characters. Every write derives created_by/updated_by from the ADMIN session rather than trusting browser attribution. Port verification and high-risk operational scopes require human review. Editing/activation uses updated_at as an optimistic concurrency token; stale edits receive a 409 and must be reloaded from the refreshed list before saving.

## Retrieval for AI cases

The AI analysis panel reads Matching approved knowledge for its saved classification. This is deterministic retrieval using AI-produced structured fields, without another Gemini call. It returns up to five active articles matching the exact category, compatible subcategory (exact or general/null), and port (exact or ALL). Unknown classification fields never select a specific unsupported scope. Ranking favors exact subcategory, exact port, then keyword occurrences in the subject/customer text. Stable code/ID ordering breaks ties.

No matches are returned if conversation changes make the classification stale; staff must analyze again. No classification produces an empty match list. Articles show problem, possible cause, resolution, action and safety/reply flags as escaped text. Guidance is not a claim that live operational status has been verified. AI reply permission does not remove an otherwise useful staff article from retrieval; it is displayed explicitly for the later reply gate. Staff can refresh matches after editing/deactivating knowledge.

Matches are current candidates, not articles already used by a model. Milestone 4 classifications remain unchanged and no knowledge_ids are appended merely because candidates were displayed. Milestone 6 must fetch approved/active knowledge afresh, enforce AI reply and human-review flags, and store the IDs actually used for reply generation. Deactivation prevents subsequent retrieval; already-rendered browser content remains a snapshot until refreshed.

## Files created

- `supabase/migrations/20260916000040_support_knowledge.sql`
- `server-handlers/knowledge/articles.ts`, `matches.ts`, `validation.ts`
- `src/services/knowledge.ts`
- `src/components/admin/support/KnowledgeBase.tsx`, `KnowledgeEditor.tsx`, `KnowledgeMatchesPanel.tsx`
- `tests/support-knowledge.test.ts`, `support-knowledge.database.mjs`
- `docs/support-knowledge.md`

## Files modified

- `src/types/knowledge.ts`: input/filter/page/match contracts and shared category/subcategory/safety definitions.
- `server-handlers/ai/validation.ts`: reuse the existing unchanged category mapping through the shared definition; classifier behavior is unchanged.
- `src/utils/support/routes.ts`, `src/components/admin/AdminLayout.tsx`: direct page routing/navigation.
- `src/components/admin/support/AIAnalysisPanel.tsx`: independent match panel for saved analyses.
- `api/mail.ts`, `server.ts`: existing consolidated Vercel/shared local routes.
- `tests/support-inbox.test.ts`, `support-inbox.browser.mjs`: route and browser coverage.
- `SUPABASE_SETUP.md`: manual deployment and verification.

No package dependencies, lockfiles, environment settings, Gmail permissions, or older migrations change. The existing support API and SPA rewrites cover the new routes.

## Schema, APIs and security

The additive migration creates three functions with fixed `pg_catalog, public` search paths:

- `list_support_knowledge(jsonb)` — filtered/paginated read.
- `save_support_knowledge(uuid,timestamptz,jsonb,uuid)` — atomic create/edit/activation with audit attribution and conflict detection.
- `match_support_knowledge(uuid)` — current classification-based retrieval.

Execution is revoked from PUBLIC/anon/authenticated and granted only to service_role. Existing private table grants and RLS remain intact. API guards require the existing ADMIN session before database access. SQL arguments are parameterized; literal substring searches do not interpret wildcard characters. Error responses do not expose SQL/provider secrets. Browser rendering uses React text and no injected HTML.

Routes:

| Method and path | Request/response |
|---|---|
| GET `/api/support/knowledge` | Query filters/offset → `{ articles, total }` |
| POST `/api/support/knowledge` | `{ article }` → created article, 201 |
| PUT `/api/support/knowledge` | `{ id, updated_at, article }` → saved article |
| GET `/api/support/knowledge-matches?id=<case-uuid>` | `{ interaction_id, stale, articles }`; includes ranking score |

No DELETE route is exposed. Duplicate codes and stale versions return 409; invalid inputs return 400; missing edit/case targets return 404; unavailable schema/database returns 503. Knowledge read failures do not block the stored conversation or classification panel.

## Deployment and UAT verification

1. Apply `20260916000040_support_knowledge.sql` after all previous support migrations in nonproduction Supabase. Do not rerun older already-applied migrations.
2. Deploy/restart the updated API and frontend. No new server variables are required.
3. Sign in as ADMIN and open Support → Knowledge Base. Verify empty state, then enter genuine CargoMove guidance as an inactive draft. Confirm title/code/scope/content/keywords and safety flags.
4. Edit the article, activate only after staff verification, and test all filters/search. Check created_by/updated_by and timestamps in Supabase. Open the same article in two browser tabs, save one, and confirm the stale tab receives a conflict instead of overwriting it.
5. Open an analyzed case with matching category/subcategory/port. Inspect matching guidance. Create inactive, wrong-category, wrong-port and incompatible-subcategory articles and verify they are excluded. Analyze English/Malay/mixed cases with relevant bilingual keywords; retrieval matches literal keyword occurrences rather than performing semantic translation.
6. Deactivate an article and refresh matches; it must disappear while remaining stored. Sync a new customer message and confirm matching is suppressed until reanalysis. Cases with no suitable guidance show a clear empty state.
7. Verify anonymous API access and browser-role function execution remain denied. Recheck existing registration, email templates/preview/send/logging and Gmail synchronization in UAT.

Live Supabase deployment and quality/content review remain manual UAT steps. No live knowledge was created or activated during implementation.

## Validation

Passed TypeScript, lint, production build and `git diff --check`; the existing large-bundle build warning remains.

- 4 knowledge input/filter/optimistic-version/API authorization tests.
- 41 isolated PostgreSQL and actual-handler checks for create/edit, attribution, duplicate codes, stale versions, filtering/pagination, ranking, inactive/incompatible exclusions, unknown scopes, stale classifications, retrieval cap and browser-role execution denial.
- 37 fixture browser checks passed. The suite covers draft creation/editing, activation/deactivation, filtering/search, matching guidance, empty matches, direct routing, desktop/mobile layout, and prior inbox/classification behavior. All APIs are intercepted; no live external writes occur.
- Classification regression: 6 tests and 34 isolated SQL/SDK/API checks.
- Inbox regression: 3 tests and 30 isolated SQL/security checks.
- Gmail parser/sync regression: 16 tests.
- Desktop and mobile Knowledge Base editor screenshots were visually inspected.
- Production browser assets contain no server key variable names, Gemini SDK or classification prompt.

Reproduce knowledge checks:

```sh
node --import tsx tests/support-knowledge.test.ts
PGLITE_MODULE=/tmp/cargomove-sql-check/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/support-knowledge.database.mjs
```

Temporary PostgreSQL/browser validation tools remain under /tmp; application dependencies are unchanged. SQL tests model prerequisite Auth tables and browser tests use fixtures. They do not verify live provider/account deployment.

## Next milestone

Milestone 6: knowledge-grounded suggested replies and editor, still requiring human approval. No Milestone 6 work has started.

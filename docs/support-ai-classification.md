# Milestone 4 — AI classification

Implemented on `uat`, following approval of Milestone 3. Classification is explicitly initiated by ADMIN staff from the case detail panel. No customer responses are generated or sent. Work stops here pending approval of Milestone 5.

## Behavior

`POST /api/support/analyze` accepts `{ "case_id": "<uuid>" }`. It classifies the stored conversation into category, compatible subcategory, port, language, urgency, confidence, extracted entities, suggested staff action, human review flag, and a concise issue explanation. The response contains `{ interaction, cached }`.

`GET /api/support/analysis?id=<uuid>` returns the latest saved classification and a stale flag. Opening cases only reads this endpoint; it does not invoke Gemini. The UI displays confidence with green/amber/red bands, extracted entities, staff action, and human review. Conversation reads remain independent of AI availability.

Every classification requires human review during this milestone, including high-confidence results. Successful analysis moves the case to NEEDS_REVIEW, preserving ESCALATED. Resolved cases cannot be analyzed. Suggested actions are labels for staff, not executable tools or verified operational facts.

## Files created

- `server-handlers/ai/analyze.ts`, `analysis.ts`: guarded APIs.
- `server-handlers/ai/context.ts`, `validation.ts`, `provider.ts`: bounded/redacted context, strict independent output validation, server-side Gemini request.
- `server-handlers/ai/prompts/classify.ts`: versioned classification instructions.
- `src/services/supportAI.ts`: authenticated browser API service.
- `src/components/admin/support/AIAnalysisPanel.tsx`: saved analysis, manual action, loading/error states.
- `supabase/migrations/20260916000030_support_ai_classification.sql`: locking, deduplication, attribution, atomic storage/read APIs.
- `tests/support-ai.test.ts`, `support-ai.database.mjs`.
- `docs/support-ai-classification.md`.

## Files modified

- `src/types/supportAI.ts`: validated action/classification/result contracts.
- `src/components/admin/support/SupportCaseDetail.tsx`, `SupportInbox.tsx`: panel integration and refresh of case/list/statistics after analysis.
- `api/mail.ts`, `server.ts`: routes through the established consolidated Vercel function and shared local handlers. Existing support rewrites cover both new endpoints.
- `.env.example`, `SUPABASE_SETUP.md`: server model configuration and deployment instructions.
- `tests/support-inbox.browser.mjs`: manual classification and AI failure checks.

No package dependencies or lockfiles changed. The installed `@google/genai` SDK is reused. Implementation follows Google's [structured-output documentation](https://ai.google.dev/gemini-api/docs/structured-output), then validates the JSON again on the server.

## Database and security

Apply the additive `20260916000030_support_ai_classification.sql` migration after all earlier migrations. It adds nullable `analysis_key` (unique) and `requested_by` (Auth UUID) to ai_interactions, plus private `support_ai_analysis_state`. New functions are `support_analysis_snapshot`, `claim_support_analysis`, `complete_support_analysis`, `release_support_analysis`, and `get_support_analysis`. Browser roles have no table privileges or function execution; only service_role can execute. All functions use a fixed search path; application APIs require the existing ADMIN session.

A 60-second lease prevents concurrent provider calls for the same case. A fingerprint of the stored subject/latest six messages plus model/prompt version deduplicates completed classifications. Results are committed atomically with case metadata only if the case timestamp and conversation fingerprint still match. Expired or superseded tokens cannot save results. Failures release the lease; crashed requests recover through expiry. No temporary ANALYZING status is written, so a failed provider does not strand the case. New messages invalidate old classifications, which remain available as historical audit records.

Gemini receives at most six plain-text messages (3,000 characters each) and a 300-character subject. Sender/recipient metadata, attachments, HTML, credentials from server configuration, and operational database records are excluded. Email addresses, explicitly labeled secrets, bearer tokens, common signatures, and quoted-history sections are removed before transmission. This is best-effort text redaction: customer issue text can still contain relevant personal information or unlabeled secrets; payload truncation can omit context. No prompt/payload/raw provider output is logged or stored by this feature.

Validation rejects unsupported enums, mismatched category/subcategory, unexpected keys, hidden-reasoning/reply fields, malformed entities, invalid confidence, excessive explanation length, and extracted identifiers absent from supplied customer text. Non-UNKNOWN ports require explicit evidence. Redaction placeholders cannot become entities; driver identifiers are discarded outside DRIVER issues. Instructions treat customer text as untrusted and forbid invented operational verification. Classification remains advisory and requires review because no trusted operational tools or approved knowledge retrieval are implemented yet.

Only structured classification, concise explanation, model/prompt version, source message, initiating admin, and timestamps are saved. Reply/approval fields remain empty; knowledge_ids remains empty. Provider thought parts are not persisted. Existing registration, OAuth, Gmail synchronization, templates, preview, sending, and logs retain their existing behavior.

## Deployment and live verification

1. Apply the new migration to nonproduction Supabase first.
2. Configure existing server-only `GEMINI_API_KEY` and new server-only `GEMINI_SUPPORT_MODEL`. Select an available model supporting the GenerateContent structured-output configuration. No hardcoded model default is supplied. Do not use VITE-prefixed secrets.
3. Deploy the API and UI after schema/configuration are ready. The existing API duration limit covers the 25-second provider timeout and database requests; automatic provider retries are disabled.
4. Sign in as ADMIN, sync or open a stored case, and press Analyze case. Verify representative English, Malay, mixed-language, unknown, and high-risk operational issues. Check entity fidelity, human review, case metadata/status, source/model/prompt/admin audit data, and empty reply fields.
5. Analyze unchanged messages twice and confirm the second call is cached. Add a new customer message, sync, verify the stale notice, and analyze again. Verify concurrent requests return busy, stale responses do not replace newer case state, resolved cases reject analysis, and ESCALATED is preserved.
6. Remove model configuration or simulate provider failure and confirm manual case reading remains available. Confirm unauthenticated APIs and browser-role SQL execution are denied. Recheck existing registration/email workflows with live UAT data.

Missing configuration produces a clear 503/manual-handling message. Provider/network failures produce a safe 503; invalid output produces 502; busy, stale, empty-text and resolved-case conditions produce 409. No external Gemini call or deployment was performed during implementation.

## Validation

Passed TypeScript (`npx tsc --noEmit`), lint (`npm run lint`), production build (`npm run build`), and `git diff --check`. Existing large-bundle build warning remains.

- 6 classification/context/configuration/authorization tests.
- 34 isolated PostgreSQL and actual handler/SDK integration checks: leases, deduplication, stale results, audit attribution, status preservation, forced review, provider failure, malformed JSON, and exclusion of thought parts. All HTTP is replaced by fixtures; no real model call occurs.
- 22 fixture browser checks covering desktop/mobile inbox navigation, manual AI invocation, saved analysis, provider error, readable conversation, sync, pagination, filtering, and anonymous entry. Desktop output was visually inspected.
- Inbox regression: 3 API/filter/route tests and 30 SQL/security checks.
- Gmail regression: 16 parser/sync tests and 60 SQL/API/security checks.
- Production browser bundle contains no Gemini SDK, server key/model environment names, or classification prompt.

Reproduce the core tests:

```sh
node --import tsx tests/support-ai.test.ts
PGLITE_MODULE=/tmp/cargomove-sql-check/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/support-ai.database.mjs
```

The database/browser tooling runs from temporary /tmp installations; application dependencies are unchanged. SQL tests model prerequisite Auth tables. Live Supabase role behavior and live Gemini quality/model compatibility remain UAT verification steps.

## Next milestone

Milestone 5 adds approved knowledge retrieval and Knowledge Base management. Reply generation remains a later milestone. No Milestone 5 work has started.

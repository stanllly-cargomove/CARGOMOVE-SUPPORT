# Milestone 6 — Suggested replies

Implemented on `uat` after approval of Milestone 5. Staff can select a template, explicitly generate a suggested reply, inspect its knowledge references, edit the text, and save edits. Human approval remains mandatory. No Gmail drafts, outbound messages, approval, sending, escalation or resolution actions are added in this milestone. Work stops before Milestone 7.

## Behavior

An analyzed case shows AI suggested reply and a template selector:

- Approved knowledge guidance: Gemini drafts a concise English, Malay or mixed-language reply from compatible active knowledge that explicitly allows AI replies.
- Acknowledge receipt: a fixed server-side acknowledgement, with no operational status claims or promised timelines.
- Request more information: a fixed server-side request for an issue description and relevant non-secret references.

The two fixed templates use the classification's language (Malay for MS/MIXED_MS_EN, English otherwise), need no Gemini key, and reference no operational knowledge. They are safe built-in support templates; existing registration templates contain registration-specific placeholders/credentials and remain separate and unchanged. No new editable template-management system is added.

Opening a case or analyzing it does not generate replies. Staff must click Generate suggested reply. Knowledge guidance requires a current classification and at least one compatible active article with ai_reply_allowed=true. Nonpermitted articles are never sent to the reply model. Missing guidance explains the problem and allows staff to choose an acknowledgement/information request or review Knowledge Base content.

Each generation stores a separate reply interaction with copied classification metadata, mandatory human-review flag, model/prompt version, initiating admin, actual supplied-and-selected knowledge IDs and generated_reply. The original classification interaction is unchanged. A support_reply_drafts row holds template, source classification, conversation fingerprint, article version stamps and the editable text. final_reply, was_edited and approval fields stay empty until a later approval/send flow. Original generated text remains immutable through the editor API.

Drafts survive reloads. Generation for unchanged context/template/model/prompt/knowledge versions is cached, preserving saved staff edits. Selecting a previously generated template returns that particular draft instead of inadvertently showing the latest different template. Unsaved local edits disable generation, template changes and reloading until staff save or explicitly discard them. Save uses updated_at concurrency checking and does not overwrite another admin's edits. No edits are autosaved. Switching away from the case still requires staff to save their local text first; unsaved text is only component state.

The editor shows classification confidence (not a separate model estimate of reply accuracy), the mandatory approval requirement, model, original generated text, and knowledge references. Current article text is shown for inspection; changed/deactivated/disallowed source articles make the draft stale. Stale drafts are read-only and require a current generation before continuing. Case status stays NEEDS_REVIEW, preserving ESCALATED, rather than treating confidence as permission to send. Resolved cases cannot generate or edit current drafts.

## Files created

- `supabase/migrations/20260917000000_support_reply_drafts.sql`
- `server-handlers/ai/reply-handlers.ts`, `reply-provider.ts`, `reply-validation.ts`
- `server-handlers/ai/prompts/reply.ts`
- `src/services/supportReply.ts`
- `src/components/admin/support/SuggestedReplyEditor.tsx`
- `tests/support-reply.test.ts`, `support-reply.database.mjs`
- `docs/support-suggested-replies.md`

## Files modified

- `src/types/supportAI.ts`: template/draft/read contracts.
- `src/components/admin/support/AIAnalysisPanel.tsx`: independent reply editor integration.
- `api/mail.ts`, `server.ts`: consolidated Vercel/shared local routes.
- `tests/support-inbox.browser.mjs`: template generation, persistence, cached selection, edit protection, source staleness and failure states.
- `SUPABASE_SETUP.md`: manual UAT deployment/verification.

No package/lockfile changes, new secrets, OAuth permissions, old migration edits, Gmail handler changes or registration-flow changes are required. Reuse server-only GEMINI_API_KEY and GEMINI_SUPPORT_MODEL from Milestone 4 for knowledge-guided generation. Existing support rewrites and the 60-second consolidated API limit are retained.

## Schema and APIs

The new migration adds private RLS-enabled support_reply_drafts and support_reply_generation_state tables, a case/creation index and updated_at trigger. New fixed-search-path functions are claim_support_reply, complete_support_reply, release_support_reply, get_support_reply and edit_support_reply. PUBLIC/anon/authenticated cannot execute these functions or access the tables; service_role can. Server APIs require the existing ADMIN session and derive audit IDs from it.

| Route | Contract |
|---|---|
| GET `/api/support/reply?id=<case-uuid>&draft_id=<optional-draft-uuid>` | `{ draft }`, null when none exists |
| POST `/api/support/generate-reply` | `{ case_id, template_id }` → `{ draft, cached }` |
| PUT `/api/support/reply` | `{ id, updated_at, reply_text }` → `{ draft }` |

Generation leases last 60 seconds. Completion locks the case and article rows, verifies the same case timestamp, conversation, latest classification and supplied article versions/permissions, and commits the reply interaction, draft and case state atomically. Provider failures or invalid output release the owned lease; crashed requests recover through expiry. Duplicate in-flight requests return busy; completed requests reuse their generation key. Invalid/duplicate/unsupplied knowledge IDs are rejected again in SQL. A knowledge template must reference at least one valid article; fixed templates must reference none.

Editing is separate from generation: server-bounded plain text and an optimistic version update only edited_reply/updated_by. Stale drafts or resolved cases reject edits. Knowledge changes after a draft is rendered are detected when the draft is reloaded; Milestone 7 must revalidate all context/article permissions at approval/send time rather than trusting a previously rendered draft.

Errors use 400 for invalid input, 404 for missing targets, 409 for busy/stale/concurrent edits or absent current analysis/permitted knowledge, 502 for unsupported AI output, and 503 for configuration/provider/database failures. Conversations, saved classifications and existing drafts remain independently readable on generation failure.

## AI and security

Gemini uses the existing server SDK with structured JSON output, 25-second timeout and no automatic retries. Its input contains the bounded/redacted Milestone 4 customer context, essential classification fields and at most five permitted articles. Customer metadata, HTML, attachments, browser credentials and server secrets are not supplied. Article content is bounded by Knowledge Base validation; articles must not be used to store secrets. Context redaction remains best effort and can omit relevant text through truncation.

The versioned prompt treats customer/article text as data and forbids invented operational status, causes, policies, timelines, contacts, performed actions and unnecessary secret/identity requests. Port/human verification requirements remain review requirements, not authority to answer live operational questions. Knowledge citations must be a nonempty permitted subset for guidance and empty for safe templates. The output schema and independent validator reject unexpected/reasoning fields, malformed/oversized text, HTML/redaction placeholders, invalid citations and common English/Malay verification/action claims. Only response text is parsed; provider thought parts are never persisted.

These syntactic checks cannot prove complete semantic grounding or detect every unsupported assertion in every language. Staff must inspect the reply and references before later approval. The approval gate is unconditional, including high-confidence replies and articles with human_review_required=false. No generated content can trigger sending in this milestone.

## Deployment and live UAT verification

1. Apply `20260917000000_support_reply_drafts.sql` after all earlier support migrations in nonproduction Supabase. If Milestone 5 is not applied yet, apply its knowledge migration first. Do not rerun already-applied older migrations.
2. Restart/deploy the API and frontend. Existing Gemini server settings are reused; fixed support templates work without them.
3. In Knowledge Base, enter genuine, verified CargoMove guidance, activate it and explicitly enable AI reply allowed only where appropriate. Keep required human/port verification flags. No operational seed content was created during implementation.
4. Analyze a matching case, choose Approved knowledge guidance and click Generate suggested reply. Verify English, Malay, mixed-language and operational-risk examples. Inspect every statement and reference against approved knowledge. Check the original classification is retained and the new reply interaction has knowledge_ids/generated_reply but no approval/final reply.
5. Edit/save/reload a draft, inspect the immutable original, switch between templates and confirm cached drafts preserve edits. Test unsaved-edit controls and two-tab stale-save conflicts.
6. Deactivate/edit/disallow a used article or sync a new customer message; reload and verify stale drafts cannot be edited. Verify absent permitted knowledge, provider failure, invalid output, concurrent generation and resolved-case behavior. Staff must continue manual handling when a draft is unsupported.
7. Confirm opening/analyzing cases makes no generation call, browser/anonymous access stays denied, and no Gmail draft/send/outbound message is created. Recheck existing registration, email templates/preview/send/logs and Gmail sync with live UAT data.

No external model call, live knowledge write, deployment or Gmail write was performed during implementation. Live model quality, quota/model compatibility and Supabase deployment remain manual UAT checks.

## Validation

TypeScript, lint, production build and `git diff --check` passed. The existing large-bundle build warning remains.

- 5 reply validation/editor-input/API authorization tests.
- 54 isolated PostgreSQL/SDK/actual-handler checks covering eligibility, leases, duplicate results, immutable original text, separate edited text, citations, stale conversations/analyses/knowledge, concurrency, provider failure, hidden-thought exclusion, safe templates without a key, resolved cases and browser-role denial.
- 48 fixture browser checks passed. The suite covers explicit generation, no-knowledge fallback, templates, saved edits/reload, unsaved-edit protection, cached older-template selection, provider failure, knowledge references, stale sources and prior desktop/mobile inbox/knowledge flows. All APIs are intercepted; no external writes occur.
- Knowledge regression: 4 tests and 41 isolated SQL/API checks.
- Classification regression: 6 tests and 34 isolated SQL/SDK/API checks.
- Inbox regression: 3 tests and 30 isolated SQL/security checks.
- Gmail parser/sync regression: 16 tests.
- Desktop reply editor screenshot was visually inspected; mobile layout checks passed.
- Production browser assets contain no Gemini SDK, server-secret variable names or reply prompt.

Reproduce reply tests:

```sh
node --import tsx tests/support-reply.test.ts
PGLITE_MODULE=/tmp/cargomove-validation/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/support-reply.database.mjs
```

Temporary validation tools, Chromium and extracted runtime libraries are under /tmp. No system runtime packages or project dependencies were installed for these checks. Isolated SQL uses modeled prerequisite Auth tables; browser testing uses fixtures.

## Next milestone

Milestone 7: manual approval and Gmail draft/send workflow with recipient/thread validation, auditing and duplicate-send protection. No Milestone 7 implementation has started.

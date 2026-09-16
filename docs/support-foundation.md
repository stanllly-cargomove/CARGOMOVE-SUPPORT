# AI Customer Support — Milestone 1

## Repository inspection and implementation scope

1. **Branch:** `uat`; clean working tree before implementation. No commits, pushes, or merges performed.
2. **Application:** React 19, TypeScript 5.8, Vite 6, Tailwind 4 via `@tailwindcss/vite`, Lucide icons, and shared CSS theme tokens in `src/index.css`. `src/main.tsx` loads `App.tsx`. TypeScript uses bundler resolution and no emit. No separate Tailwind config or ESLint configuration exists; `npm run lint` runs TypeScript.
3. **Admin navigation:** `App.tsx` switches customer/login/admin views. `AdminLayout.tsx` switches `activeTab` components, with separate admin/developer navigation sections. There is no URL router. Support routes and navigation are deferred to Milestone 3; introducing paths then requires accommodating this established state-based design.
4. **Authentication:** Supabase Auth verifies passwords after the API finds an `ADMIN` authorization row in `user_registrations`. APIs issue eight-hour HMAC-signed `cargomove_session` cookies with HttpOnly, SameSite=Lax, and Secure on Vercel. The session ID is the `auth.users` UUID, while application registration row IDs are text. Browser Supabase Auth is used for password recovery, not privileged data access.
5. **Supabase:** `src/services/supabase.ts` calls authenticated API endpoints for snapshots and writes. Local `server.ts` uses Express and the server-side Supabase SDK; Vercel uses `api/_runtime.ts` and its PostgREST builder. New schema belongs in chronological SQL migrations. The baseline supplies `pgcrypto` and `public.touch_updated_at()`.
6. **Gmail OAuth:** Existing `server-handlers/gmail/connect.ts`, `callback.ts`, and `status.ts` share `_email.ts`. OAuth uses expiring, one-use hashed state bound to the admin session, PKCE S256, verified Google identity, and the `openid email gmail.send` scopes. Refresh tokens use AES-256-GCM with a server-only 32-byte key. The connection is a single system mailbox.
7. **Gmail send:** `server-handlers/email/send.ts` requires an admin and a signed, expiring preview token, rechecks registration/template/recipient, claims a SENDING lock, refreshes the encrypted token, creates MIME, and calls Gmail. It records message/thread IDs and send outcomes. These registration-specific handlers should remain intact; future support sending can reuse shared low-level helpers.
8. **Templates:** `email_templates`, `EmailTemplateManager.tsx`, `RichTextEmailEditor.tsx`, and `src/services/email.ts` provide versioned DONE/REJECTED templates, validated variables, previewing, and attachments. Current template triggers are registration-specific; support extensions are deferred.
9. **Logging:** `email_logs` records template snapshots, approver, recipient, requested/sent timestamps, Gmail IDs, attachments, and errors. Admin-only logs API provides recent entries. New support outbound records and final AI feedback will be implemented in later milestones.
10. **GenAI:** `@google/genai` is installed and `GEMINI_API_KEY` is documented, but no GenAI imports or calls exist in application/server source. This milestone adds no AI calls.
11. **Security:** Preserve server-only credentials, signed sessions/preview tokens, Gmail encryption/PKCE, send locking, private attachment storage, MIME header validation, and the existing HTML allowlist sanitizer. New incoming HTML remains untrusted; the existing rich editor accepts HTML and is not itself an incoming-mail sanitizer. Future Gmail UI must sanitize content before rendering it.
12. **Reusable files:** `api/_runtime.ts` (`adminClient`, `readSession`, `requestBody`); `server-handlers/_email.ts` (`requireAdmin`, `noStore`, `configuredClient`, Gmail/token/MIME/sanitization helpers); `src/services/email.ts`; `src/services/supabase.ts`; `AdminLayout.tsx`; shared `Badge.tsx` and notifications; baseline timestamp trigger. `api/mail.ts` and `vercel.json` consolidate email routes to avoid adding one Vercel function per endpoint; `server.ts` maps the same handlers locally.
13. **Modified file:** `SUPABASE_SETUP.md`, adding support migration and security instructions only.
14. **Created files:** `supabase/migrations/20260916000000_support_foundation.sql`; `src/types/support.ts`; `src/types/supportAI.ts`; `src/types/knowledge.ts`; `src/services/support.ts`; this report.
15. **Database changes:** One transactional, additive migration creates only the six requested support tables, their constraints, indexes, grants, RLS, and timestamp triggers. Old migrations and existing tables remain unchanged.
16. **Risks/conflicts:** Older core tables have broad authenticated-role policies, whereas newer email tables have RLS with no browser policies. Support follows the newer server-only pattern and explicitly revokes browser-role grants. Existing routing is not path-based. Gmail IDs are unique globally within this single-mailbox design; future multi-mailbox support will need mailbox-scoped identifiers. No PostgreSQL/Supabase CLI is installed and Docker daemon access is denied, so SQL execution must be verified in a nonproduction database before deployment.

## Schema decisions

- `support_cases`: UUID primary key, unique nullable Gmail thread ID (manual cases remain possible), bounded confidence, typed status/category/subcategory/port/urgency, optional Auth UUID assignment, and status/resolution timestamp consistency.
- `support_messages`: unique nullable Gmail message ID, required case FK, composite case/thread FK to prevent linking to a different Gmail conversation, typed direction, plain/untrusted HTML bodies, and chronological case index. Gmail-backed messages require a thread ID. Threadless manual messages remain possible.
- `support_knowledge`: unique knowledge code, category/port matching and keyword GIN indexes, inactive default, human-review default, AI-reply permission off by default, Auth UUID editor attribution, and verification requiring human review. No example knowledge is automatically approved or seeded.
- `ai_interactions`: same-case message FK, structured classification/entities, bounded confidence, concise explanation, source IDs, suggested/final response, correction indicator, and consistent approval attribution/timestamps. No hidden reasoning fields. Multiple analyses of a message may be recorded deliberately; future sync must not create an analysis merely because a message is resynchronized.
- `support_learning_suggestions`: existing-knowledge FK, positive evidence count, PENDING default, and reviewer/timestamp required for APPROVED/REJECTED. No trigger modifies knowledge upon approval; human approval workflows are deferred.
- `support_automation_rules`: unique category/subcategory/port scope (including NULL subcategory), bounded threshold, inactive default, editor attribution, auto-send off and human review on. A named database constraint enforces both initial safety settings. Milestone 10 must explicitly migrate this constraint before selective automation can be enabled.
- Auth attribution references `auth.users`, matching existing email attribution. Audit-bearing users and related support records use restricted deletion; staff assignment alone can be cleared on user deletion. Knowledge should be deactivated rather than deleted.
- `knowledge_ids` is a UUID array retaining historical source IDs, not a relational FK. Future server handlers must validate all IDs against active, human-approved knowledge before use. `active` is enabled only through a future admin workflow; it is not proof of approval by itself.
- Free-text recommended actions and suggested actions are storage fields, not executable tool names. Later AI response validators must constrain action vocabulary and entity fields. TypeScript contracts alone do not validate untrusted model responses.

## Security and deployment

All six tables enable RLS and expose no policies or grants to PUBLIC, anon, or authenticated roles. Only the server service role receives CRUD grants; it bypasses RLS, so every future support API must call the existing admin authentication guard. No support tables are added to generic data-write allowlists or snapshot endpoints.

No new environment variables, OAuth scopes, API routes, browser database clients, UI, Gmail reads, sync, AI generation, learning jobs, or email sends are added. The reader service is a type-only contract without an implementation or network side effects.

Apply prior migrations first, then this new migration in a nonproduction Supabase database. Confirm six tables, RLS, browser grant denial, service-role access, default automation safety, and rejection of duplicate Gmail IDs/cross-case references. SQL creation is transactional. This change does not apply migrations to any live database.

## Validation

- Baseline and final `npx tsc --noEmit`: passed.
- `npm run lint` (TypeScript validation): passed.
- `npm run build`: passed; Vite reports a JavaScript chunk above 500 kB. Foundation types/contracts are not imported by the UI.
- `git diff --check`: passed.
- Migration execution during Milestone 1: not performed. PostgreSQL/Supabase CLI unavailable and Docker daemon inaccessible. A temporary attempt to obtain an embedded SQL validator could not complete under restricted network access; no project dependencies were changed.
- Manual verification remains required in nonproduction Supabase; no live database was accessed.

Milestone 2 subsequently executed this migration in an isolated PostgreSQL engine with modeled prerequisites; no live database was accessed. See `gmail-inbox-integration.md`.

## Next milestone

Milestone 2: minimum Gmail read permissions, message/thread retrieval, incremental synchronization, and idempotent case/message storage. Requires explicit user approval; work stops at Milestone 1.

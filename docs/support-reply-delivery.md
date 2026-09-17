# Milestone 7 — reviewed reply delivery

This milestone adds explicit **Create Gmail draft**, **Approve & send**, **Escalate**, **Resolve**, and **Reopen** actions. Nothing creates a Gmail draft or sends mail automatically. Existing registration mail, templates, preview tokens, and email logs retain their existing flow.

## Set up

1. Apply `supabase/migrations/20260917000010_support_reply_delivery.sql` after the Milestone 6 migration. Do not rerun or edit earlier applied migrations.
2. Keep the existing server-only `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `APP_URL`, Supabase service-role configuration and session secret. No new secret or OAuth client is needed. For the current Codespace, `APP_URL` is the origin ending in `-3000.app.github.dev`, without `/admin/support`; retain the existing callback URL configuration.
3. In Google Auth Platform → Data Access, retain `gmail.readonly` and `gmail.send`, and add `https://www.googleapis.com/auth/gmail.compose`. Google requires compose permission for Gmail draft creation and sending from drafts ([draft creation documentation](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create)).
4. Restart the API server. Reconnect the same support Gmail account and grant the new permissions. Existing read/send connections can still send directly; Gmail draft creation explains how to reconnect when compose permission is absent. Keep the existing Google test-user/audience configuration.
5. Refresh cases, open an imported conversation, analyze it, and generate a current reply. Review knowledge and any required port verification, edit wording and **Save draft edits**.
6. **Create Gmail draft** saves the reply in Gmail without sending it. Later saved revisions update the existing Gmail draft for that conversation context. If you subsequently send through CargoMove, the send request includes the exact reviewed CargoMove text, replacing any different Gmail draft text atomically ([Google draft guide](https://developers.google.com/workspace/gmail/api/guides/drafts)).
7. Check the displayed customer recipient and saved text. Tick the review confirmation, then click **Approve & send**. This is a real email action. Confirm the outbound conversation entry and `WAITING_CUSTOMER` status (escalated cases remain escalated).
8. Supply a reason before escalating, resolving or reopening. The case action history records actor, time and reason. These actions do not send mail.

## Data and APIs

New private tables: `support_reply_deliveries` and `support_case_events`. RLS is enabled with no browser grants; all new RPCs are executable only by `service_role`. The admin session is validated before any API action, and the server obtains actor UUIDs from the session. No browser-provided recipient, Gmail thread, mail body or approval actor is trusted.

- `GET /api/support/delivery?id=<case UUID>`: delivery receipts and case event history.
- `POST /api/support/delivery`: `{case_id,draft_id,updated_at,kind:"SEND"|"GMAIL_DRAFT",reviewed:true}`. Review confirmation is mandatory for sends.
- `POST /api/support/delivery-check`: `{case_id,operation_id}`. Reads Gmail to reconcile an uncertain result; never resends.
- `POST /api/support/case-status`: `{case_id,updated_at,action:"ESCALATE"|"RESOLVE"|"REOPEN",reason}`.

Before writing, the server checks the live Gmail mailbox, original inbound message, thread, single customer recipient and Reply-To. New unimported non-draft Gmail messages require another sync. RFC Message-ID, In-Reply-To, References and the original subject keep the message threaded. Reply bodies are UTF-8 plain text; there are no attachments, Cc, Bcc or injected HTML.

The database locks the case/draft, checks saved versions and knowledge freshness, and records an immutable operation before the Gmail mutation. Approval is tied to this exact reply snapshot. A sent receipt atomically stores the outbound message, final reply, generated/final comparison, reviewing admin, approval time and case status. The classification interaction is preserved separately. A later inbox sync deduplicates the Gmail message ID.

Identical repeated actions return their existing receipt. Pending/uncertain writes fence further delivery, draft edits and manual status changes. A successful send prevents another reply to the same last inbound message, including another template or re-analysis; a new customer message permits the next reply.

## Uncertain results and limits

Gmail and PostgreSQL cannot share a transaction. Network errors, timeouts, ambiguous provider responses and persistence failures after a write remain `UNKNOWN` or `IN_FLIGHT`; they never trigger an automatic retry. Definite Gmail rejections (400/401/403/404) are recorded `FAILED` and allow a subsequent explicit action.

Use **Check Gmail result** after at least 30 seconds. The server searches the recorded RFC Message-ID, then verifies the Gmail message, thread, sender, recipient and sent/draft label. A unique matching receipt finalizes the original operation with the original reviewing admin. Absence of a search result does not prove that Gmail rejected the write: the operation stays blocked. Mailbox deletion, manual Gmail edits/deletions, eventual search indexing, or a crash after recording the operation but before writing can require manual investigation of Gmail and the private delivery row. There is deliberately no browser force-retry/unlock action. After independently proving no write occurred, an authorized operator may mark an unfinished operation `FAILED`; never do so merely because a search returned no result.

There is a small unavoidable interval between live Gmail preflight and delivery during which a customer can send a new message. Admin review is still required; this milestone adds no automatic replies or external port verification. Local unsaved editor text can be lost when navigating away; save it first. Knowledge checks and conservative AI validation assist review, but do not prove operational accuracy.

## Verification

No live Gmail/Supabase calls or real email were used during implementation tests.

```sh
npm run lint
npm run build
node --import tsx tests/support-delivery.test.ts
PGLITE_MODULE=/tmp/cargomove-validation/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/support-delivery.database.mjs
```

The optional PGlite tooling is installed outside the repository. The database/API suite uses real isolated SQL and intercepted OAuth/Gmail/PostgREST requests, including lost responses, reconciliation, source-message duplicate protection, immutable approval text, direct sending without compose permission, draft sending with replaced text, definitive rejections, audit comparison and browser-role denial. The fixture browser suite covers review confirmation, unsaved edits, creating drafts without sending, outbound display, case actions and mobile layout.

Next: Milestone 8, human-reviewed learning suggestions. Implementation stops here pending approval.

## Completion report

Created:

- `supabase/migrations/20260917000010_support_reply_delivery.sql`
- `server-handlers/support/delivery.ts`
- `server-handlers/support/delivery-gmail.ts`
- `src/types/supportDelivery.ts`
- `src/services/supportDelivery.ts`
- `src/components/admin/support/ReplyDeliveryControls.tsx`
- `src/components/admin/support/CaseStatusControls.tsx`
- `tests/support-delivery.test.ts`
- `tests/support-delivery.database.mjs`
- `docs/support-reply-delivery.md`

Modified for this milestone:

- `api/mail.ts`, `server.ts`: shared delivery and status routes.
- `server-handlers/gmail/client.ts`, `connect.ts`: compose scope declaration/request.
- `server-handlers/gmail/parse.ts`: export the existing encoded-header decoder for reply subjects.
- `server-handlers/ai/reply-handlers.ts`: pending/sent edit error messages.
- `src/types/supportAI.ts`: expose stored draft context fingerprint.
- `AIAnalysisPanel.tsx`, `SuggestedReplyEditor.tsx`, `SupportCaseDetail.tsx`: delivery controls and conversation/status refresh.
- `tests/support-inbox.browser.mjs`: delivery/status fixtures and browser coverage.
- `SUPABASE_SETUP.md`: migration/setup reference.

Database/security: two private tables, service-only delivery/status/context RPCs, concurrency checks, exact approval snapshots, source-message duplicate protection, audit events, and edit fencing. No browser credentials or automatic sending.

Validation: TypeScript/lint and build passed; 4 reply MIME/preflight tests, 95 delivery SQL/API checks and 61 desktop/mobile fixture browser checks passed. Regression suites passed: reply units 5 / SQL+API 54; knowledge 4 / 41; classification 6 / 34; inbox 3 / 30; Gmail 16 / 60. The existing large JavaScript chunk warning remains (~1.41 MB before gzip). Temporary test tooling stays outside the repository.

Manual steps: apply the new migration, restart the API and reconnect the same Gmail account for compose permission as described above. Secrets and `.env.local` were not changed. No live migrations, live sends, commits, pushes or deployments were performed. Work remains on `uat`.

Next milestone: Milestone 8 (Learning Suggestions), pending user approval.

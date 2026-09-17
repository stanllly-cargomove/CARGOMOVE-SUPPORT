# Supabase setup

1. Create a new Supabase project and copy the project URL and anon/publishable key.
2. In the Supabase SQL editor, run every file in `supabase/migrations/` in filename order. Existing projects must also run newly added migrations. `20260913000050_email_workflow.sql` safely reconciles missing registration workflow columns and adds the email template, Gmail connection, OAuth state, and email-log tables.
3. In **Authentication → Users**, create and confirm `support@cargomove.com.my`. Set its password there; Supabase Auth owns the password.
4. Configure the Supabase Auth Site URL and redirect URLs for the deployed Vercel app and local development.
5. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `SESSION_SECRET` in Vercel Project Settings. Do not expose server keys as `VITE_*` variables.
6. For local development, keep server variables in ignored `.env.local`; for deployment, add them to Vercel Project Settings. Never commit them. For the initial demo data, run `npx tsx scripts/seed-supabase.ts` from a trusted environment with the server variables available.
7. Start the API with `npm run dev:api` only when those server variables are provided by your local process.

## Gmail sending setup

1. In Google Cloud Console, enable the Gmail API and configure the OAuth consent screen.
2. Create an OAuth 2.0 **Web application** client.
3. Add `<APP_URL>/api/gmail/callback` as an exact authorized redirect URI. For local development this is normally `http://localhost:3000/api/gmail/callback`.
4. Configure `APP_URL`, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET` as server environment variables.
5. Generate a 32-byte encryption key with `openssl rand -base64 32` and store it as `GOOGLE_TOKEN_ENCRYPTION_KEY`.
6. Sign in as an administrator, open **Dev Tool → Email Template**, and select **Connect Gmail**.

The integration requests Gmail's `gmail.send` permission and, from Support Milestone 2, `gmail.readonly` for inbox access. Refresh tokens are AES-256-GCM encrypted before they are stored in Supabase; OAuth and encryption secrets must never use a `VITE_*` name.

## Credential rules

- Never commit `.env.local`, a service-role key, or a database password.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may reach the browser. The anon key is protected by Row Level Security; it is not a secret.
- The service-role key bypasses RLS. Use it only for the seed script or a trusted backend and rotate it immediately if exposed.
- The admin UI uses a custom HttpOnly API session after Supabase Auth verifies the password. The public registration page does not hydrate the protected snapshot; company, submission, user-registration, and guideline data are fetched only after successful login.
- The application authorization row is stored in `public.user_registrations`; its `type` must be `ADMIN`. Its legacy `password_hash` column is retained for registration data compatibility and is not used for admin login.
- The API uses the server-only service-role key to read/write protected tables. Never put that key in a `VITE_*` variable or browser code.
- Do not put third-party API credentials or Supabase service credentials in React components or `VITE_*` variables.

## AI customer support foundation (Milestone 1)

Apply `supabase/migrations/20260916000000_support_foundation.sql` after the
existing migrations, first in a nonproduction Supabase database. It creates
`support_cases`, `support_messages`, `support_knowledge`, `ai_interactions`,
`support_learning_suggestions`, and `support_automation_rules`.

These tables are server-only: RLS is enabled, browser-role grants are revoked,
and no browser access policies are created. Future support APIs must verify the
existing ADMIN session before using the service-role client. Staff attribution
uses `auth.users` UUIDs, matching the existing Gmail/email workflow.

No additional environment variables or Gmail permissions are required yet.
Knowledge and automation rules default to inactive. Auto-send is disabled and
human review is enforced by a database constraint until a future explicitly
approved automation migration. This milestone does not add an inbox or AI calls.
See `docs/support-foundation.md` for architecture findings and validation limits.


## Gmail support inbox (Milestone 2)

1. Apply both `20260916000000_support_foundation.sql` and
   `20260916000010_gmail_inbox_sync.sql` after the existing migrations, first in
   nonproduction Supabase. Deploy the API only after the schema is ready.
2. Add `https://www.googleapis.com/auth/gmail.readonly` to the Google OAuth
   consent screen alongside existing send access. No new environment variables
   are needed. Configure Google's applicable restricted-scope verification.
3. Sign in as ADMIN and reconnect the **same** mailbox via **Email Template →
   Connect Gmail**. Grant both send and read access. `/api/gmail/status` reports
   `inboxPermissionGranted`; older send-only connections cannot read the inbox.
4. From the signed-in app's browser console, test one batch:

   ```js
   await fetch('/api/gmail/sync', { method: 'POST', credentials: 'include' })
     .then(response => response.json())
   ```

   Run another batch while `has_more` is true. A 409 sync-busy response means
   another worker still owns the lease; retry later. There is no automatic job.
5. Verify real messages via `/api/gmail/messages`,
   `/api/gmail/message?id=<message-id>`, and `/api/gmail/thread?id=<thread-id>`.
   All require ADMIN authentication.
6. Confirm stored cases/messages in Supabase, replay the same sync and confirm
   counts do not increase without new messages, then reply manually through
   Gmail and sync again to confirm the same case receives the outbound message.
7. Confirm unauthenticated API requests are rejected and anon/authenticated
   Supabase roles cannot read support tables or execute sync functions. Verify
   existing registration preview/sending/templates/logs still work normally.

Initial import covers the latest 30 days of inbox mail. Subsequent calls use
incremental Gmail history; expired history refreshes tracked threads and recent
inbox mail. Attachments are not downloaded. No email is sent by synchronization.
See `docs/gmail-inbox-integration.md` for APIs, recovery, limits, and test commands.

## Support dashboard and inbox (Milestone 3)

Apply `20260916000020_support_inbox_queries.sql` after the earlier support
migrations, first in nonproduction Supabase. Deploy the updated API/UI after
applying the migration. No new environment variables or OAuth scopes are needed.

Sign in as ADMIN and open **Support → AI Support Dashboard** or **Support Inbox**.
Direct links are `/admin/support`, `/admin/support/inbox`, and
`/admin/support/case/<case-uuid>`. Sync Gmail imports one resumable batch;
Continue sync imports another. Cases remain readable when Gmail is disconnected.

Validate real statistics, status/category/port/staff/confidence/date filters,
search for customer and operational references, case pagination, message
pagination, direct links, browser Back/Forward, and mobile layout. Confirm
anonymous API access and browser-role RPC execution remain denied. Conversation
HTML is never injected into the page. AI classification and reply actions are
not part of this milestone. See `docs/support-inbox-ui.md` for the complete report.

## Support AI classification (Milestone 4)

Apply `20260916000030_support_ai_classification.sql` after the earlier support
migrations, first in nonproduction Supabase. Configure server-only
`GEMINI_API_KEY` and `GEMINI_SUPPORT_MODEL` with an available Gemini model that
supports structured GenerateContent output. Do not prefix these with VITE.
Deploy the API/UI only after the migration and server settings are ready.

Sign in as ADMIN, open a stored case, and select **Analyze case**. Opening the
case does not trigger AI. Verify category/subcategory, port, language, urgency,
confidence, extracted entities, staff action, and human review. Every result
requires human review; no reply is generated or sent. Repeated unchanged-message
analysis is cached, changed messages display stale analysis, concurrent requests
are fenced, and failures leave conversations readable. Verify English, Malay,
mixed-language and operational-risk examples against real UAT messages; test
missing configuration/provider errors and existing registration/email workflows.
See `docs/support-ai-classification.md` for the full report and validation limits.

## Support Knowledge Base (Milestone 5)

Apply `20260916000040_support_knowledge.sql` after the earlier support migrations,
first in nonproduction Supabase. Deploy/restart the updated API/UI afterward.
No new secrets or OAuth permissions are needed.

Sign in as ADMIN and open **Support → Knowledge Base** at
`/admin/support/knowledge`. Create genuine support guidance as an inactive draft,
edit it, and activate only after staff verification. Search/filter articles and
verify two-tab stale-edit conflicts. Deactivate instead of deleting articles.
Port-verification and high-risk operational scopes require human review.

Open an analyzed case to view matching approved knowledge. Inactive and
incompatible articles are excluded, and changed conversations require
reanalysis before matching. Test activation/deactivation and refresh matches;
confirm anonymous API access and browser-role RPC execution remain denied.
No replies are generated yet. See `docs/support-knowledge.md` for the complete
report, API details and manual UAT verification steps.

## Support suggested replies (Milestone 6)

Apply `20260917000000_support_reply_drafts.sql` after the earlier support
migrations, first in nonproduction Supabase. Restart/deploy the updated API/UI.
Reuse the existing server-only Gemini key/model settings; no new OAuth
permissions are needed. Fixed acknowledgements/information requests require no
model key.

In Knowledge Base, activate verified guidance and explicitly enable **AI reply
allowed** where appropriate. Analyze a matching case, choose a reply template,
and click **Generate suggested reply**. Inspect the guidance/references and
wording, edit, and **Save draft edits**. Drafts remain inside CargoMove and
require human approval; no Gmail draft or email is created yet.

Test saved edits/reload, cached template selection, two-tab conflicts, absent
permitted knowledge, changed conversation/knowledge, provider failures and
resolved cases. Verify approval/final-reply fields remain empty and existing
registration/email/sync workflows still work. See
`docs/support-suggested-replies.md` for the full report and validation limits.

## Support reply delivery (Milestone 7)

Apply `supabase/migrations/20260917000010_support_reply_delivery.sql` after the reply draft migration, then restart the API server. Gmail draft actions require adding `gmail.compose` in Google Data Access and reconnecting the same mailbox; existing OAuth credentials are reused. See [reviewed reply delivery](docs/support-reply-delivery.md) for setup, approval, audit records and uncertain-result reconciliation. No automatic sending is enabled.

## Support learning suggestions (Milestone 8)

Apply `supabase/migrations/20260917000020_support_learning.sql` after the reply delivery migration, then restart the API. Open `/admin/support/learning` and explicitly detect repeated staff corrections. Suggestions require human review before an atomic Knowledge Base update. No additional credentials, Gmail permissions or automatic sending are introduced. See [learning setup and review guide](docs/support-learning.md).

## Support analytics (Milestone 9)

Apply `supabase/migrations/20260917000030_support_analytics.sql` after the learning migration, then restart the API. Open `/admin/support/analytics`. Optional UTC dates select cases by application creation date; subsequent recorded activity is included. No additional secrets, OAuth permissions, AI calls or automatic sending are introduced. See [analytics setup and metric definitions](docs/support-analytics.md).

## Controlled support automation (Milestone 10)

Apply `supabase/migrations/20260917000040_support_automation.sql`, then restart the API. Open `/admin/support/automation`. Rules and the server-only `SUPPORT_AUTO_SEND_ENABLED` switch default to no automatic sending. The per-case runner may analyze/draft and, only when explicitly enabled and eligible, send the fixed acknowledgement. No scheduled worker is enabled. Read [automation setup and safeguards](docs/support-automation.md) before opting in; operational guidance still requires human approval.

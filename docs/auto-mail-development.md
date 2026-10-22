# Auto Mail development

Auto Mail provides an ADMIN-only Gmail inbox, manual threaded replies, a reviewed knowledge base, and optional OpenAI reply suggestions in a separate database. Automatic replies remain disabled. KB management and keyword search do not require an AI provider; generation is opt-in.

## Separate project setup

1. Use the other Supabase project with a database backup appropriate to its existing contents.
2. Review and manually run `supabase/auto-mail/migrations/20261022000000_foundation.sql` against that project only. It creates a new `auto_mail` schema and seven tables; it does not alter existing tables. If that schema already exists, the migration fails instead of overwriting it.
3. Add `auto_mail` to the project's Data API exposed schemas, keeping existing exposed schemas. The new schema and tables grant access only to `service_role`; browser roles have no access.
4. Set these server-only values in the ignored `.env.local` file:

```dotenv
AUTO_MAIL_ENABLED=true
AUTO_MAIL_SUPABASE_URL=https://YOUR_OTHER_PROJECT.supabase.co
AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY=YOUR_OTHER_PROJECT_SERVER_KEY
```

Do not paste credentials into chat or add a `VITE_` prefix. Keep the main application's database variables unchanged. Never copy production Gmail tokens into the development project.

5. Start the local API (`npm run dev:api`) and frontend (`npm run dev`). Sign in as an existing CargoMove administrator, open Tools → Auto Mail, and check the connection.

The endpoints use the existing signed ADMIN session and do not query or write the main database. The setup endpoint reads only the separate project's schema version and mailbox connection metadata. It never returns credentials or raw database errors. The connection rejects a URL matching either main-project URL in every environment, including production. `AUTO_MAIL_ENABLED=true` explicitly enables it; otherwise no Auto Mail database connection is attempted.

This migration is deliberately outside the main `supabase/migrations` folder. Do not use the main project's migration/seed command to install it. No migrations run automatically when the application starts.

## Milestone 2: connect the actual Gmail mailbox

1. Run **only** `supabase/auto-mail/migrations/20261022010000_gmail_manual_replies.sql` in the separate Auto Mail project's SQL Editor. Do not rerun the foundation migration. This adds OAuth state, encrypted credentials and delivery tracking; it updates only the Auto Mail schema.
2. Set `AUTO_MAIL_APP_URL=http://localhost:3000` in `.env.local` if that is the URL you open in your browser. Use the actual origin if different. This is independent of the registration email `APP_URL`.
3. The existing server-only `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_TOKEN_ENCRYPTION_KEY` are reused. Tokens are newly authorized and stored only in `auto_mail.gmail_connections`; the registration Gmail connection is not modified.
4. In the Google Cloud project for that OAuth client, ensure Gmail API is enabled. In the web OAuth client's authorized redirect URIs, add `http://localhost:3000/api/auto-mail/callback` (substitute your configured origin). Preserve the existing registration callback URI.
5. Configure the OAuth consent app for `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`. If the Google app is in testing, add the actual Gmail address as a test user. Google may require further verification for broader use of restricted Gmail scopes. See [Google's scope documentation](https://developers.google.com/workspace/gmail/api/auth/scopes).
6. Restart the local API, refresh Auto Mail and click **Connect Gmail**. Select the actual support mailbox and approve both permissions. Google returns you to Auto Mail.
7. Verify the displayed email address, select an inbox conversation, and review the displayed recipient. Write your reply and click **Send reply** when ready. Reading and connecting never send mail.

Replies use Gmail's thread ID plus `In-Reply-To` and `References`, following [Google's threading requirements](https://developers.google.com/workspace/gmail/api/guides/threads). The recipient is the latest incoming message's single Reply-To address (or From if absent). This version supports Reply, not Reply All. Both the latest message and connection version are checked again before sending. Multiple-address/unsupported headers require replying in Gmail.

The inbox loads 15 conversations per page directly from Gmail; opening a conversation saves its plain-text messages into the separate database for future KB work. There is no automatic mailbox-wide sync yet. HTML-only messages show a snippet; attachments can be opened in Gmail. Opening a conversation marks it read in Gmail when the connection has gmail.modify permission. The envelope icon in the reader toolbar marks the conversation unread without discarding an unsent reply.

Each incoming message permits one manual reply request. Duplicate clicks, repeated requests and uncertain deliveries cannot send twice through Auto Mail. If the network fails after Gmail may have accepted a message, the delivery remains blocked (`UNKNOWN` or `SENDING`); check Gmail's Sent folder and handle any further action there. This conservative behavior also applies to Gmail send failures. There is no automatic retry or automated sending.

`DRAFT_ONLY` remains the **automation** policy; it does not prohibit a staff member's explicit manual send. Live Gmail consent and real delivery must be validated by the account owner; automated tests mock Google and use an in-memory database.

## Milestone 3: knowledge base first

1. Run `supabase/auto-mail/migrations/20261022020000_knowledge_base.sql` in the **separate Auto Mail project's SQL Editor**, after the Milestone 2 migration. Do not run it against the main CargoMove project.
2. Restart the local API if it is not watching files, then open **Developer / Dev Setting / Auto Email Config**. KB management is separate from the Auto Mail inbox.
3. Click **New article**. Enter the question/topic as the title, a short summary, category, port/scope (`ALL` if generally applicable), keywords separated by commas, and the answer or procedure. Save the draft.
4. Review the saved text and click **Approve article**. Only approved articles appear in email searches.
5. Open an incoming email in **Inbox**, then click **Find KB articles**. Leave keywords blank to search from its subject and latest message, or enter a more precise search. Expand an article to check its answer and port/scope.
6. Click **Add answer to reply** to append the approved answer to the reply editor. Your existing reply text is preserved. Review the final wording and recipient, then send manually when ready.

This stage uses full-text and keyword search, not generated answers or semantic embeddings. Port/scope is shown for staff review; the app does not infer the port or claim a match is a confidence score. No email or KB data is sent to an AI provider, and no API key is needed.

Editing an approved article returns it to `DRAFT` and clears its approval. Every create, edit, approval, return to draft, and archive records a numbered snapshot. Use **Reload & history** to inspect the latest 20 revisions. Stale updates are rejected instead of overwriting another administrator's edits; the editor preserves your unsaved text. Cancel edits and reload before applying them to the newer version.

Archiving removes the article from matching without deleting its history. Return it to draft before editing/reapproving it. Before inserting an answer into a reply, the server is checked again for the same approved article version; stale or withdrawn answers are rejected. Inserting an answer never sends email.

KB writes use ADMIN-authenticated, same-origin endpoints and versioned database functions. Direct service-role article writes and revision edits/deletes are denied. The original foundation articles, if any, receive an `IMPORTED` history snapshot; no main-project tables are touched.

Staff learning suggestions require the separate Milestone 4 migration. Automatic delivery (Milestone 5) is not enabled by KB setup.

## Milestone 3: OpenAI reply suggestions

1. Run `supabase/auto-mail/migrations/20261022030000_ai_reply_drafts.sql` in the **separate Auto Mail project only**, after the KB migration. It creates draft tracking, scoped retrieval and source validation; it preserves `DRAFT_ONLY` automation mode and existing manual replies.
2. Add these server-only values to the ignored `.env.local` file:

```dotenv
AUTO_MAIL_AI_ENABLED=true
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
AUTO_MAIL_AI_MODEL=YOUR_ACCESSIBLE_MODEL_ID
```

Use an API model available to your OpenAI project that supports the Responses API and Structured Outputs. No default model is silently selected. See the [official OpenAI model catalog](https://developers.openai.com/api/docs/models) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs). Do not put the API key in a `VITE_` variable or commit it. These credentials are separate from Google OAuth and Supabase keys.

3. Restart the API or let the watcher reload `.env.local`, refresh Auto Mail and open an incoming conversation.
4. In **AI reply suggestion**, select the port/scope used by your KB (`ALL` for general articles) and click **Generate AI draft**. The server retrieves up to five matching approved articles in that scope, re-reads the actual Gmail conversation, and makes one bounded OpenAI request. If no sources match, no model request is made.
5. Review the proposed reply, internal staff notes and source snapshots. A `NO_ANSWER` result cannot be added to the composer. `NEEDS_REVIEW` drafts may be added only through the explicit review flow and still need staff judgment.
6. Click **Add AI draft to reply** to append only its customer-facing text, preserving any text you already wrote. Source approval/version, mailbox and conversation are checked again before insertion. Staff notes remain outside the customer reply.
7. Edit the reply and click **Send reply** when ready. This is the existing manual delivery flow. Draft generation itself never sends email. Sending rechecks any linked draft's source versions and conversation signature; stale KB sources or a changed thread block delivery.

Only an explicit generation click calls OpenAI. The model receives the subject (up to 500 characters), the last six messages (up to 3,000 characters each), attachment-presence flags and up to five approved KB excerpts (6,000 characters each). Sender/recipient headers and attachment files are not separately supplied, but personal data already present in message bodies may be included. Users see this data-sharing notice before generating.

The request uses a strict JSON schema, no tools, `store: false`, a 1,600-token output limit and a 20-second provider timeout, following the [OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs). `store: false` is not a claim that all provider retention is disabled; consult [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) for account-specific policies. Refusals, incomplete responses and unrecognized citations are rejected without automatic model retries.

Drafts retain the provider/model, requesting administrator, selected scope, original conversation signature, source snapshots, citations and internal notes in the Auto Mail database. Delivery records retain a link to the draft alongside the actual edited text sent. Citations and structured formatting do not prove factual correctness; staff must verify operational statements and the final wording. This is retrieval-based drafting, not model training or autonomous learning.

Database admission allows one active generation per mailbox and at most 20 requests per rolling hour. Request IDs prevent the same request from generating twice. Failed requests count toward this limit because a timeout can hide provider work. A two-minute lease allows a later explicit request to recover from an interrupted generation; it never automatically retries. A draft from another administrator, mailbox, source version or conversation cannot be used to send.

All automated verification uses mocked Gmail/OpenAI responses and an in-memory database. Live model access and answer quality still need validation after the owner supplies API credentials. No customer content is sent to OpenAI during development tests.

## Milestone 4: reviewed learning from sent replies

1. Run `supabase/auto-mail/migrations/20261022040000_reviewed_learning.sql` in the **separate Auto Mail project's SQL Editor only**, after the AI draft migration. It adds review metadata and events to learning suggestions, captures confirmed reply evidence, and advances the schema version to 5. It does not change the main CargoMove database or enable automatic sending.
2. Restart the API if necessary, open **Developer / Dev Setting / Auto Email Config**, and select the **Learning review** tab. No new API key or external provider configuration is needed for this milestone.
3. Edit an AI draft and send the final reply manually. After Gmail accepts it and the local receipt is saved, its changed text is queued as a pending suggestion. The comparison trims surrounding whitespace; it is not an AI assessment of whether the edit is useful. Unchanged AI replies and failed/uncertain sends do not automatically create suggestions.
4. For a confirmed manual reply, click **Suggest this reply for the KB** immediately after sending. The source is the server's stored sent reply, not client-provided evidence. Repeated nominations or receipt retries return the same suggestion rather than creating duplicates.
5. In **Learning review**, select a pending suggestion and expand **Source evidence**. Compare the customer question, original AI draft (when applicable), actual sent reply and the KB source snapshots.
6. Rewrite the **Reusable answer** as general guidance. Remove customer names, email addresses, individual reference numbers and one-off operational claims. Set the title, summary, category, port/scope and keywords. This is manual review; the application does not automatically redact or certify the answer.
7. Choose **New KB article**, or **Update an existing KB article**. For an update, search/select the target and compare its current answer. The target version is checked on approval; if another administrator changes it, your text is preserved and you must refresh the target version and review again.
8. Click **Approve and publish KB** to publish an approved article atomically with the review result and revision history. Future KB matches and AI drafts may use the reviewed answer. Alternatively enter a rejection reason and click **Reject suggestion**; rejection does not modify any KB article.
9. Use the status filter and **Reload review history** to inspect approved/rejected suggestions and their audit events. Approval and rejection are final for that suggestion. Later KB edits use the normal draft/reapproval workflow.

Each suggestion retains the original evidence and links to its source delivery. Review records retain the reviewed article snapshot, published article/version, reviewer, note and time. Pending suggestions are excluded from KB retrieval and AI prompts. They do not retrain the OpenAI model or change a model's weights; approval improves the approved knowledge available to future drafts.

Confirmed edited AI replies are captured in the same database transaction as the sent receipt. If Gmail accepts a message but the database cannot save the receipt, the app reports the successful Gmail acceptance with a warning and blocks repeat sending; it does not label this known acceptance as an uncertain Gmail send. A suggestion is not created without a confirmed stored receipt. Reconcile such cases in Gmail before further action.

Until this migration is applied, the app retains the earlier receipt-saving path and existing Gmail/KB/AI features keep working. The learning tab explains that setup is pending. All learning tests use mocked network requests and an in-memory database; no live email is sent or modified during verification.

## Production deployment

### Formatted reading, CC/BCC and attachments

Run `supabase/auto-mail/migrations/20261022060000_rich_replies.sql` in the **separate Auto Mail project only**, after the reviewed-learning migration. It adds a private `auto-mail-attachments` Storage bucket, `reply_uploads`, `reply_details`, and an atomic rich-delivery claim function. Existing application tables and the main production database are unchanged. A restrictive policy limits the new bucket to server-authorized access even if the project already has broad Storage policies. No new Google OAuth scopes or API keys are required.

The reader supports sanitized HTML, tables, clickable web/email links, To/CC/BCC headers, plain-text fallback, sender avatars, collapsed earlier messages and quoted history. Active content and remote images are removed. Inline images are available as attachment cards where Gmail supplies an attachment part. Attachments are matched to the actual Gmail message and thread for the currently connected mailbox before loading. PDF, PNG, JPEG, GIF and WebP previews are offered after checking the file signature; other types download. Incoming attachments larger than 15 MB remain available through the Gmail link. Signed preview/download links expire after five minutes.

The reply composer supports text styles/sizes/colors, bold/italic/underline/strikethrough, lists, alignment, quotes, links, undo/redo and clear formatting. Use **Reply all** to populate the original To/CC recipients, excluding the support mailbox; edit/add addresses explicitly in To, CC and BCC. The primary Reply-To sender must remain in To. Duplicate recipients are removed across fields; the total is capped at 30. BCC is sent in the outgoing MIME headers and retained in the administrator-only delivery metadata. Original messages are not marked read in Gmail.

Use **Attach files** for up to 10 files and **15 MB total**. Supported uploads are PDF, PNG/JPEG/GIF/WebP, Word, Excel, PowerPoint, text, CSV and ZIP. The server reserves an immutable object path for the administrator, reply request, mailbox connection, conversation and source message. The browser uploads directly to a signed Storage URL; API requests do not carry file bytes. Before sending, the server downloads each selected object, checks ownership/context/expiry and size, hashes its bytes, then atomically records the recipient lists, sanitized HTML and attachment metadata alongside the existing delivery claim. Gmail receives a threaded multipart/alternative or multipart/mixed message. The existing duplicate-send protection and uncertain-outcome handling remain in place; the app never automatically retries a Gmail send.

Removing an unsent attachment deletes its object and upload registration. Uploads expire for sending after 24 hours; expiry does not automatically delete Storage objects. Sent file metadata and hashes remain with the delivery record, and files remain private in Storage until project maintenance removes them. Incoming files opened for preview/download are cached privately in the same bucket. Attachment contents are not supplied to OpenAI; AI drafts continue receiving only message text and attachment-presence flags.

Before applying this migration, the enhanced reader remains available, the composer keeps the earlier plain-text sending path, and the attachment UI explains that setup is required. Apply the migration and click the Google logo to refresh capabilities, then reload the conversation if needed. No real mail is sent by automated tests.

Implementation references: [Gmail MIME sending](https://developers.google.com/workspace/gmail/api/guides/sending), [Gmail attachment retrieval](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get), [Supabase signed uploads](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).

The server sanitizer is bundled at `server-handlers/auto-mail/vendor/sanitize-html.cjs` to support Vercel's function loader without relying on native CommonJS-to-ESM interoperability. The upstream sanitizer version and security fixes are preserved. After updating `sanitize-html`, run `npm run generate:mail-sanitizer`, commit the generated bundle and its dependency license notices, and rerun the startup/security tests. The startup regression disables native `require(ESM)` before loading the shared email router.

### Email agent model settings

Run `supabase/auto-mail/migrations/20261022050000_agent_settings.sql` in the **separate Auto Mail project's SQL Editor only**. It creates `agent_settings` and `agent_setting_events`, with server-only reads and a versioned save function. It does not alter existing tables or the schema version. Before this migration, generation continues using the current server model and enable flag; the new settings form explains that saving needs setup.

Open **Developer / Dev Setting / Auto Email Config / Email agent**. Choose the active model, enable the models you want available, and save. The active model must be enabled whenever suggestions are enabled. An administrator can disable all suggestions here. Every save records the administrator and a settings snapshot. Concurrent saves require reloading the latest version. The server's `AUTO_MAIL_AI_ENABLED` flag and `OPENAI_API_KEY` are still required; API keys are never stored in these tables or sent to the browser. Model access and Responses API/Structured Outputs compatibility are checked when generating a draft, not by a paid test during settings changes.

The first saved setting inherits the displayed server defaults. There is no automatic switch to a different model. New generation requests read the saved settings, and in-flight generation rechecks the enabled state and selected model before saving its result. Saved historical drafts retain their original model. Manual replies are unaffected by disabling suggestions.

OpenAI's [complimentary-token offer](https://help.openai.com/en/articles/10306912-sharing-feedback-evals-and-api-data-with-openai) requires eligible shared traffic and remaining daily allowance. The app does not change OpenAI organization data-sharing settings, confirm enrollment, measure organization-wide free usage, or guarantee zero charges. Shared inputs/outputs can be used for model improvement; review suitability before enabling sharing for customer email. The model options include general text models from the offer and support a custom model ID for other project-accessible models. See [GPT-5.4 mini compatibility](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

In Auto Mail, clicking the connected Google logo silently refreshes mailbox status and inbox summaries while preserving the selected conversation and typed reply. Hover/focus retains the connected account details. Use the adjacent **Auto Mail options** menu for **Manage knowledge**, **Email config**, or **Reconnect Gmail**. Reconnection remains an explicit OAuth action. The tabs in Auto Email Config use the same styling as Email Templates, with keyboard navigation and retained editor state across tab changes.

Knowledge management and learning review are under **Developer / Dev Setting / Auto Email Config**, with **Knowledge Base**, **Learning review** and **Email agent** tabs. From **Tools / Auto Mail**, the three-dot menu opens knowledge management or email agent configuration; **Open Learning review** after a confirmed reply opens the review tab. Use **Dev Setting** to return to the parent settings. Unsaved edits remain in place when switching between these two tabs. The approved-answer lookup inside an email remains available for composing replies.

Deploy the application through the existing GitHub/Vercel integration. Configure these **server-only Production environment variables** in Vercel, then redeploy. Local `.env.local` values are not uploaded by Git:

```dotenv
AUTO_MAIL_ENABLED=true
AUTO_MAIL_SUPABASE_URL=YOUR_SEPARATE_AUTO_MAIL_PROJECT_URL
AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY=YOUR_SEPARATE_PROJECT_SERVER_KEY
AUTO_MAIL_APP_URL=https://cargomove-register.vercel.app
AUTO_MAIL_GOOGLE_CLIENT_ID=YOUR_AUTO_MAIL_OAUTH_CLIENT_ID
AUTO_MAIL_GOOGLE_CLIENT_SECRET=YOUR_AUTO_MAIL_OAUTH_CLIENT_SECRET
AUTO_MAIL_TOKEN_ENCRYPTION_KEY=YOUR_EXISTING_AUTO_MAIL_TOKEN_ENCRYPTION_KEY
AUTO_MAIL_AI_ENABLED=true
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
AUTO_MAIL_AI_MODEL=YOUR_TESTED_MODEL_ID
```

Use the same encryption key that encrypted the existing Auto Mail connection: the local `AUTO_MAIL_TOKEN_ENCRYPTION_KEY`, or local `GOOGLE_TOKEN_ENCRYPTION_KEY` if no dedicated override was configured. Keep the existing production `GOOGLE_*` variables and main Supabase credentials unchanged; registration emails continue using them. The dedicated Auto Mail OAuth/encryption variables override the shared fallbacks only for Auto Mail.

Add `https://cargomove-register.vercel.app/api/auto-mail/callback` to the OAuth client's **Authorized redirect URIs** in Google Cloud Console before connecting or reconnecting Gmail on production. Keep the localhost callback for development.

The separate Auto Mail database must already have migrations through schema version 5. Deployment does not run SQL or modify the main production database. After deployment, sign in as an administrator, open **Tools → Auto Mail**, check database/Gmail readiness, and open **Developer / Dev Setting / Auto Email Config**. Verify suggestions and learning review before manually sending a test reply. Automated sending remains disabled.

## Remaining milestones

3. Configure OpenAI credentials and validate suggestion quality against representative emails.
4. Apply the reviewed-learning migration and validate the staff review workflow.
5. Preview automation, evaluation, delivery tracking and duplicate protection before controlled sending.

The remaining feature work is controlled automatic delivery after evaluation. Actor UUIDs identify existing CargoMove administrators without a cross-project foreign key.

## Exposed-schema troubleshooting

If `auto_mail` is selected in the dashboard but the API reports `PGRST106`, the database role configuration may override it. In the separate project's SQL Editor, use the [Supabase troubleshooting guidance](https://supabase.com/docs/guides/troubleshooting/pgrst106-the-schema-must-be-one-of-the-following-error-when-querying-an-exposed-schema). For a project currently exposing `public` and `graphql_public`, the verified configuration is:

```sql
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, auto_mail';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
```

Include any additional schemas already used by that project when setting this list.

## Mailbox interface

Auto Mail has Inbox and Sent folder navigation, compact conversation rows, unread emphasis, sender/recipient, subject, snippet, dates and thread counts. Rows open the existing rich reader, CC/BCC composer, attachments and KB/AI review tools. Back to the list retains the current unsent reply; reopening that conversation restores it. Changing folders, search, conversation or explicitly reloading asks before discarding an unsent reply.

Search submits to Gmail within the selected folder and supports Gmail operators such as `from:customer@example.com`, `has:attachment`, and `is:unread`. Pages contain up to 25 conversations. Load more retains the folder and search. Checkboxes select loaded rows, with Select all, Show selected, Open selected, and Clear selection. Selection is local to the current folder/search; it does not modify Gmail read status or labels. Click the Google logo to silently reload the current folder/search without clearing the reply.

No migration or new OAuth scope is required. This uses the existing read/send connection and does not change the main database. Mail0 (https://github.com/Mail-0/Zero) was reviewed as an open-source interface reference; the implementation uses our existing React components and Gmail handlers without importing that application or its backend.

Offline verification: `npm run test:auto-mail`, `npm run test:auto-mail:mailbox:ui`, `npm run test:auto-mail:rich:ui`, and `npm run test:auto-mail:ui`. Browser tests intercept requests and never send real email.

## Full workspace, Compose, Trash and Scheduled

The Auto Mail workspace fills the available portal width. Its viewport has a 520px minimum height with internal scrolling, including while a conversation loads. Opening a conversation hides the list search header. The sidebar includes Compose, Inbox, Sent, Scheduled and Trash.

Compose supports a new subject, To/CC/BCC, the rich editor, and the same 10-file / 15 MB attachment limit. A new composed message uses its own durable request ID. Its prepared MIME is saved as an immutable object in the private `auto-mail-outbox` bucket, with a SHA-256 snapshot. New tables record queue state and Gmail receipts; existing Auto Mail and production tables are not altered. The prepared object can be larger than the original attachments due to MIME encoding, so the new bucket limit is 25 MB. Prepared content is retained privately for delivery review; no automatic content cleanup is configured.

### Enable the features after deployment

1. Run `supabase/auto-mail/migrations/20261022070000_compose_outbox.sql` in the **separate Auto Mail project**. This follows the existing foundation/rich-replies migrations. Click the Google logo in Auto Mail to refresh feature readiness.
2. In Google Cloud Console, add `https://www.googleapis.com/auth/gmail.modify` to the OAuth application's data-access scopes. In Auto Mail's three-dot menu, select **Reconnect Gmail** and approve mailbox management. Read/send connections continue to work before reconnecting; Trash/Restore controls become available once the saved connection includes modify permission. The registration email integration is unchanged. [Gmail Trash API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads.trash).
3. Configure a random server-only `AUTO_MAIL_SCHEDULER_SECRET` of at least 32 characters on Vercel and locally. During this development change it was generated in ignored `.env.local` and saved to Vercel production, without displaying the value. Keep it out of browser variables and Git.
4. Open `supabase/auto-mail/setup-scheduled-worker.sql`, replace the secret placeholder with the **same value from `.env.local`**, confirm the production callback URL, and run it in the **separate Auto Mail project**. This installs a once-per-minute `pg_cron` / `pg_net` call authenticated with a Vault-held secret. Do not run the placeholder unchanged, and do not create duplicate named Vault secrets. [Supabase scheduling guidance](https://supabase.com/docs/guides/functions/schedule-functions).
5. Wait for the first worker tick, then refresh with the Google logo. **Compose ? Send later** is enabled when the server credential exists and the last worker heartbeat is less than five minutes old. Times use the browser's displayed time zone and are stored in UTC. The initial worker claims one message per minute, on the first tick after its due time; provider or service delays can make delivery later. You can schedule between two minutes and 90 days ahead.

Scheduled currently contains **new composed messages scheduled through Auto Mail**, plus their sent, cancelled, failed or uncertain history. It does not mirror Gmail web's Scheduled folder. Replies still use the existing reviewed manual-send workflow. Scheduled messages are staff-authored messages with an explicit send time; automatic AI replies remain disabled.

Moving a conversation to Trash affects all messages in its Gmail thread. Restore removes it from Trash. There is no permanent-delete action. Select up to 25 loaded rows for a bulk action; partial failures keep unconfirmed rows visible. Existing read status is preserved.

### Delivery and cancellation behavior

Queued messages can be cancelled until the worker atomically claims them. Cancellation and claiming serialize on the same queue row. Messages already sending cannot be cancelled. A reconnect changes the connection version; pending messages stop before provider sending if the saved mailbox/version is no longer current. Refresh Scheduled to see the reason and compose a new message if needed.

The worker downloads and verifies the immutable MIME snapshot before sending. It never automatically retries an ambiguous Gmail send. A stopped worker leaves SENDING messages quarantined as UNCERTAIN after ten minutes, and the UI instructs staff to check Gmail Sent. A confirmed Gmail response remains successful even if receipt storage fails; do not send a second copy. Restarting the worker does not requeue these messages.

Monitor `select last_seen from auto_mail.outbox_worker_state;` and the Scheduled view. To stop the minute trigger, run `select cron.unschedule('auto-mail-outbox-every-minute');` in the separate project. For key rotation, update both Vercel and the named Vault secret, then redeploy.

Validation adds real Postgres-compatible SQL tests and fully intercepted browser/API tests for Compose, no duplicate sends, private snapshots, mailbox changes, missed worker ticks, cancel/send races, Trash scopes, bulk partial failures, and desktop/mobile layout. No real email or live AI request is sent by these tests.

## Session cache and background compose sending

The first Auto Mail visit initializes the connection plus the first Inbox, Sent and Scheduled pages. The full-page progress screen advances only as those requests complete; an unavailable Scheduled feature is labelled Not configured. Failed requests show Retry initialization, which reuses folders already loaded successfully. Subsequent navigation uses the initialized cache.

Mailbox readiness, folder/search pages, conversation content and Scheduled lists use a bounded memory cache with a 120-second freshness interval. A per-tab sessionStorage snapshot (up to 80 entries and 2 million characters, retained for at most eight hours) restores previously loaded emails immediately after a browser refresh. Cached data is scoped to the administrator and Gmail connection version, and is cleared on login/logout or an authentication failure. No access tokens or unsent drafts are stored by this snapshot. Browser reload validates the connection and refreshes the current folder in the background, retaining the number of previously loaded pages. A different Gmail connection initializes its own data. Storage restrictions or quota errors fall back to memory caching. Concurrent reads share one in-flight request. Uncached searches, Trash and additional pages still load on demand.

While Auto Mail is visible, it checks every 120 seconds. For unfiltered Inbox/Sent/Trash lists, Gmail's profile history cursor allows an unchanged mailbox to skip thread listing and per-thread metadata requests. Searches refresh normally so time-dependent Gmail queries remain accurate. The Google logo bypasses the cache for a manual refresh. Sending, moving/restoring conversations, cancelling schedules and saving email-agent settings expire the related caches. Updated rows invalidate their cached conversation. Opening a conversation with an unsent reply preserves the draft; send-time server validation still checks the current conversation and connection.

Compose closes immediately after local subject/recipient/time validation and hands the immutable request snapshot to a session-level background task. Sending continues while navigating within the portal; completion/failure appears in a toast and in Auto Mail. A rejected validation request can restore the draft with its original request ID. Uncertain delivery is shown for review without enabling resend. Failed task snapshots include text, recipients and file registrations in memory, and are cleared on logout. This does not promise sending will begin if the browser is closed before the request reaches the server; check Gmail Sent after an interruption.

The visible Trash folder needs read permission, but moving/restoring conversations requires gmail.modify. The active connection was checked during this change and had read/send permissions only. Trash actions now display permission guidance with a reconnect button instead of remaining silently disabled. Add the mailbox-management scope in Google Console, then reconnect; the server continues enforcing the permission before any mutation.

No new migration is required. These changes are local for manual deployment; no Git push or Vercel deployment was performed. Tests: `npm run test:auto-mail`, `npm run test:auto-mail:cache:ui`, `npm run test:auto-mail:initialization:ui`, plus the existing mailbox, rich reply and KB/learning browser checks.

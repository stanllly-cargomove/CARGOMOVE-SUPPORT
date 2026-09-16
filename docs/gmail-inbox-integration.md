# Gmail Inbox Integration — Milestone 2

## Scope and files

Implemented on `uat` after user approval to proceed. Milestone 1 working-tree changes are retained. No commit, push, merge, inbox UI, GenAI call, draft/reply endpoint, background scheduler, or automatic sending is included.

Created:

- `supabase/migrations/20260916000010_gmail_inbox_sync.sql`
- `server-handlers/gmail/client.ts`, `parse.ts`, `inbox-handlers.ts`, `sync-engine.ts`
- `server-handlers/gmail/messages.ts`, `message.ts`, `thread.ts`, `sync.ts`
- `src/types/gmailInbox.ts`, `src/services/gmailInbox.ts`
- `tests/gmail-inbox.test.ts`, `tests/gmail-sync.database.mjs`
- `docs/gmail-inbox-integration.md`

Modified:

- `api/_runtime.ts`: typed RPC requests and optional query timeouts; existing callers retain their default behavior.
- `server-handlers/_email.ts`: optional refresh-token request timeout, used by new inbox operations.
- `server-handlers/gmail/connect.ts`, `callback.ts`, `status.ts`: read consent, explicit granted-scope checks, mailbox identity guard, and inbox permission status.
- `api/mail.ts`, `server.ts`: four shared handlers mapped in Vercel and local Express.
- `src/services/email.ts`: optional inbox permission field in the existing status response type.
- `vercel.json`: 60-second limit for the consolidated mail function; existing rewrites retained.
- `SUPABASE_SETUP.md`: consent, deployment, and live verification instructions.
- `docs/support-foundation.md`: records subsequent isolated validation of the foundation migration.

## APIs and reuse

All APIs require the existing signed ADMIN session and return no-store/private responses. Credentials and customer emails are not logged by the new handlers. The existing Gmail encryption, PKCE/state flow, server-only service role, and registration sending workflow remain in use. No additional dependencies or environment variables are introduced.

| Method | URL | Result |
| --- | --- | --- |
| GET | `/api/gmail/messages?pageToken=…` | Up to 20 inbox message references and an optional next-page token |
| GET | `/api/gmail/message?id=…` | Decoded, normalized message with sanitized HTML |
| GET | `/api/gmail/thread?id=…` | Related conversation messages, excluding drafts |
| POST | `/api/gmail/sync` | One resumable sync batch and `has_more` |

OAuth now requests `gmail.readonly` alongside existing `gmail.send`, `openid`, and `email`. No mailbox modification, deletion, or compose permissions are requested. Existing send-only connections remain usable for registration sending, but inbox calls require renewed consent. Gmail read access is a restricted scope; configure the consent screen and any applicable Google verification before external deployment. See [Google's scope definitions](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Synchronization

Initial bootstrap imports inbox conversations containing mail from the latest 30 days. The cutoff is fixed in the database, so pagination does not move the window. Each selected conversation's complete supported message history is stored together. Outbound-only/unrelated archived threads do not create cases. A Gmail thread maps to one case; unique message IDs deduplicate replayed messages.

The bootstrap captures a profile history ID before fetching messages and immediately catches up through history after completing the import. Normal synchronization uses `history.list`, processes added messages and INBOX label additions, and follows every page without advancing the history cursor until the final page is saved. History IDs remain strings to preserve 64-bit values. See [Google's synchronization guide](https://developers.google.com/workspace/gmail/api/guides/sync).

A staged database queue persists page thread IDs and continuation state. An invocation handles up to three threads, with a time budget and bounded provider/database requests. Call POST again while `has_more` is true; there is no implicit polling or scheduler. Slow batches can stage work and return without draining a thread; the next request resumes it.

An expired history cursor triggers a recovery phase: keyset-page and refresh stored support conversations, including archived ones; then import recent inbox mail since the previous completed sync minus one day; finally catch up from a newly captured baseline. The original 30-day cutoff is used if no completed sync exists. This is an exceptional recovery, not a repeated full-mailbox scan. Never-imported conversations that are already archived are outside inbox bootstrap scope.

Database row locks plus 90-second fenced leases prevent concurrent workers from committing stale progress. The mailbox subject and connection timestamp are checked for each write; reconnecting invalidates an older worker. On failure only the lease is released, without saving partially mutated in-memory progress. Crashes leave a lease that expires naturally. Case/message writes are transactional; if checkpointing fails afterward, retrying ignores messages already stored.

New inbound activity newer than previously stored activity reopens a case to NEW, preserving escalations. Backfill/retries preserve human status changes. Gmail deletion does not erase stored support history; stored labels/read/unread state are not mirrored in this milestone. Refreshing a tracked thread imports new inbound/outbound messages from that same conversation.

## Database and security

The additive migration creates `gmail_sync_state` with RLS and server-role-only grants. Five invoker functions expose acquisition, checkpointing, thread persistence, lease release, and tracked-thread recovery paging. PUBLIC, anon, and authenticated roles cannot execute them. There are no browser policies or generic write-allowlist changes. Approved AI interactions are untouched; sync does not run AI.

Only the existing single system mailbox is supported. Once sync state exists, OAuth reconnection rejects another Google subject. Switching mailboxes requires a separately designed migration to mailbox-scoped identifiers; do not delete sync state merely to bypass this guard.

HTML is sanitized using the existing server allowlist. Body processing is bounded to 1 MiB per message, 500 MIME parts, depth 30, and 500 messages per thread. Plain text/HTML charsets and encoded header words are decoded. Attachment bytes and inline images are excluded. A textual body supplied only through an attachment ID is explicitly unsupported rather than silently replaced with an empty body. Malformed/oversized mail returns an error and retains the pending thread for retry; do not manually advance the cursor past unsaved mail.

## Validation and limits

Completed checks:

- 16 parsing, synchronization, recovery, and authorization tests passed.
- 60 isolated PostgreSQL migration, security, and API integration checks passed.
- `npx tsc --noEmit` and `npm run lint` passed.
- `npm run build` passed, with the existing large-bundle warning.
- `git diff --check` passed.

 The database tests execute both support migrations with modeled existing prerequisites, test defaults, relational constraints, atomic rollback, deduplication, worker fencing, and browser-role denial. They also exercise the real sync API with mocked OAuth/Gmail/PostgREST HTTP backed by migrated PostgreSQL functions. They do not verify a deployed Supabase project's configuration or a live Gmail grant.

Reproduce unit tests:

```sh
node --import tsx tests/gmail-inbox.test.ts
```

Optional isolated SQL/API validation, without changing project dependencies:

```sh
npm install --prefix /tmp/cargomove-sql-check --no-save --package-lock=false @electric-sql/pglite
PGLITE_MODULE=/tmp/cargomove-sql-check/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/gmail-sync.database.mjs
```

Live verification is a manual deployment step documented in `SUPABASE_SETUP.md`. No real Gmail mailbox or Supabase database was accessed during implementation. The production build retains the existing large-bundle warning.

## Next milestone

Milestone 3 is the support dashboard/inbox UI, case browsing, filters/search, detail, conversation display, and statuses. It requires user approval. No AI is needed for that milestone.

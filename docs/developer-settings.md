# Shared developer settings

Apply `supabase/migrations/20261027000000_shared_developer_settings.sql` to the main application database before deploying the shared developer switches. Both switches start off; existing browser-local opt-ins are intentionally not imported.

Developer Settings controls Registration test tools (Auto Fill and draft Excel download) and Registration simulation (the queue's Simulate button). Only a currently authorized administrator may save changes. The public settings endpoint returns these two UI flags only.

On every application open, flags start off until a fresh server read succeeds. Open tabs refresh every 30 seconds while visible, and on focus, reconnect, or visibility changes. Failed reads disable the tools until a later successful read. Components subscribe to changes so they update without a page reload. Saving does not display a successful state until the server confirms it.

These switches control UI visibility and are not authorization for operational APIs. Existing scheduler settings remain managed by their scheduler endpoints.

Offline checks: `npx tsx --test tests/developer-settings.test.ts` and `npx tsx tests/developer-settings-ui.ts`. Do not connect these tests to a live database or mailbox.

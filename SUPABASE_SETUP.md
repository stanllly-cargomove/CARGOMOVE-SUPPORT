# Supabase setup

1. Create a Supabase project and copy the project URL and anon/publishable key.
2. In the Supabase SQL editor, run every file in `supabase/migrations/` in filename order. Existing projects must also run newly added migrations. The final `20261016000000_remove_support_auto_email.sql` migration removes the retired support/KB auto-email schema while preserving registration email data.
3. In **Authentication → Users**, create and confirm the administrator account. Supabase Auth owns its password.
4. Configure the Supabase Auth Site URL and redirect URLs for the deployed app and local development.
5. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `SESSION_SECRET` as server environment variables. Do not expose server keys as `VITE_*` variables.
6. For local development, keep server variables in ignored `.env.local`. Never commit them.
7. Start the local API with `npm run dev:api` only when those variables are available.

## Registration Gmail sending

1. In Google Cloud Console, enable the Gmail API and configure the OAuth consent screen.
2. Create an OAuth 2.0 **Web application** client.
3. Add `<APP_URL>/api/gmail/callback` as an exact authorized redirect URI. For local development this is normally `http://localhost:3000/api/gmail/callback`.
4. Configure `APP_URL`, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET` as server environment variables.
5. Generate a 32-byte encryption key with `openssl rand -base64 32` and store it as `GOOGLE_TOKEN_ENCRYPTION_KEY`.
6. Sign in as an administrator, open **Dev Tools → Registration Templates**, and select **Connect Gmail**.

The registration integration requests only Gmail's `gmail.send` permission. Refresh tokens are AES-256-GCM encrypted before storage. OAuth and encryption secrets must never use a `VITE_*` name.

## Credential rules

- Never commit `.env.local`, a service-role key, a database password, or OAuth secrets.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may reach the browser.
- Use the service-role key only in trusted backend code or maintenance scripts.
- The admin UI uses an HttpOnly API session after Supabase Auth verifies the password.
- The public registration page does not load the protected admin snapshot.
- The API uses the server-only service-role key to access protected tables.

## Removed support auto-email subsystem

The support inbox, AI email assistant, AI learning, knowledge base, automation rules, and support analytics are retired. Apply `20261016000000_remove_support_auto_email.sql` to existing databases to remove their functions, tables, and stored data. Registration submissions, templates, email logs, attachments, Gmail sending connection, and registration notifications are not removed.

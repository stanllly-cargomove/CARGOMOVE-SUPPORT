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

The integration requests only Gmail's `gmail.send` permission. Refresh tokens are AES-256-GCM encrypted before they are stored in Supabase; OAuth and encryption secrets must never use a `VITE_*` name.

## Credential rules

- Never commit `.env.local`, a service-role key, or a database password.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may reach the browser. The anon key is protected by Row Level Security; it is not a secret.
- The service-role key bypasses RLS. Use it only for the seed script or a trusted backend and rotate it immediately if exposed.
- The admin UI uses a custom HttpOnly API session after Supabase Auth verifies the password. The public registration page does not hydrate the protected snapshot; company, submission, user-registration, and guideline data are fetched only after successful login.
- The application authorization row is stored in `public.user_registrations`; its `type` must be `ADMIN`. Its legacy `password_hash` column is retained for registration data compatibility and is not used for admin login.
- The API uses the server-only service-role key to read/write protected tables. Never put that key in a `VITE_*` variable or browser code.
- Do not put third-party API credentials or Supabase service credentials in React components or `VITE_*` variables.

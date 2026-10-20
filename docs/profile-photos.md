Profile photos
==============

Profile image files are stored only in a public Vercel Blob store, under
`avatars/<account-id>/profile-<random-suffix>.jpg`. Connect the public store
to the Vercel project with environment-variable prefix `BLOB`, then deploy
the updated application code. The connection supplies `BLOB_STORE_ID`, and
the installed Blob SDK automatically uses Vercel's rotating OIDC credentials
for both uploads and deletes. No manually copied read-write token is needed
on Vercel. `BLOB_WEBHOOK_PUBLIC_KEY` may also appear but is not needed for
these server uploads.

For local development, use `vercel env pull` with the connected project and
its Development environment, or set the store's `BLOB_READ_WRITE_TOKEN` in
the existing `.env.local`, then restart `npm run dev:api`. Never use a `VITE_`
prefix for credentials. The SDK manages OIDC refreshing; do not pass a copied
OIDC token explicitly to SDK calls. Photos are publicly readable by their Blob URL.

Supabase Auth stores only the saved image URL in the user's metadata; it
does not store the image file. There is no Supabase Storage fallback. If the
Blob connection and read-write token are both missing, photo uploads fail without changing the profile
or creating a bucket in another service.

Account menu → Account & Setting → Upload photo opens the built-in crop editor. Users can
drag the image or use the zoom and position sliders. Saving exports a 512 × 512
JPEG; canceling makes no upload. The authenticated `/api/auth/profile` handler
uploads the cropped image into the signed-in user's storage directory and saves
its URL in that user's Supabase Auth `user_metadata.avatar_url`. No database
migration is needed. The profile, sidebar and account menu share the saved photo.

The handler verifies current administrator access, validates JPEG uploads and
limits payload size. Replacing or removing a photo cleans up the previous managed
photo after the profile is saved. Failed profile saves remove the new upload;
cleanup failures do not undo a successful save.

Run `npm run test:profile` for API checks. Run `npm run build`, then
`npm run test:profile:ui` for offline Chrome checks of cropping, canceling,
failed upload retry, shared avatars, removal and picker dismissal on page scroll.
The browser suite uses locally installed Google Chrome and intercepts all requests.

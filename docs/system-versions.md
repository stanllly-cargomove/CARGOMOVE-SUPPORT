# System versions

Open **Dev Tools → System Information**, directly below **Dev Setting** in the sidebar.
The General Version is the single version displayed by Home and every customer
page footer. Page and tool versions are tracked independently, starting at 1.0.0
when tracking begins. The previously displayed public version was 1.2.1;
introducing System Version advances it to 1.3.0. Earlier page/tool release
numbers and history were not recorded and are not reconstructed.

Versions are captured only by the GitHub Actions push workflow on **main**.
Development startup, file saves, local commands and production builds only read
previously recorded versions. The workflow compares source fingerprints with the
last release, records changed files and affected pages/tools, then commits the
manifest using the GitHub Actions bot. Unchanged pushes create no release.
The workflow needs permission to write repository contents; branch protection
must allow its manifest commit. Bot pushes using GITHUB_TOKEN do not trigger
another workflow run.

Changed existing code increments the general patch: 1.2.9 -> 1.2.10. Adding one
or more pages/tools increments the general minor once and resets its patch.
Removing a page/tool increments the general patch and records the removal.
Page/tool patches roll over after 9: 1.0.9 -> 1.1.0, 1.9.9 -> 1.10.0.
Existing page/tool counters are normalized (1.0.23 -> 1.2.3); historical releases
retain their original recorded numbers. New entries begin at 1.0.0.

Releases include commit author names, commit hashes and subjects, the source
commit and the GitHub account that pushed. Authors come from Git commit metadata,
not verified identities. Emails are not recorded. Existing releases are attributed
to Stanlly as requested; future authors come from Git. Concurrent pushes may be
combined into one release of the latest main state; all intervening tracked
commits are included. A rejected bot push retries against the latest main.
Force pushes that remove the recorded source commit fail rather than inventing
a provenance range.

Page discovery includes customer/auth `*Page.tsx`, admin screens (excluding
modals, icons, editors and layout fragments), queue views and registration forms.
Names, additional page scopes and tool source scopes are defined in
`scripts/system-version.ts`. New tools are discovered automatically as top-level
files or folders inside `src/tools`, `src/components/tools`, or
`server-handlers/tools`. Keep a tool's helper files inside its folder. For tools
elsewhere, register them in `definitions()` with a unique stable ID, name and
source files/directories. New helper files outside tool folders are treated as
edits to the system, rather than new tools. Imports and CSS dependencies are
followed for individual page/tool fingerprints. Shared source, API handlers,
media and database migrations also update the General Version.

The generated `src/generated/system-versions.json` contains versions,
fingerprints and recorded history. The push workflow commits it automatically.
Pull that bot commit before your next push. Keep the manifest when deploying or
checking out another machine. Builds never regenerate it. Deployment must use
the bot commit to display the newly captured release; a deployment of the
original pushed commit still contains the preceding release. Use a single
release branch and resolve the manifest together with source when merging.

## Database history

Apply `supabase/migrations/20261019000000_system_version_history.sql` and
`supabase/migrations/20261019010000_system_version_authors.sql` before
deploying the history feature. When an administrator opens System Version, the
server saves missing releases from its deployed manifest to
`public.system_version_history` and returns saved history, newest first.
Existing release records are preserved when the page is reopened or an older
deployment is used. Only the server can read and insert records; browser-supplied
history is ignored. If saving fails, the page shows release-file history with a
retry option. Database records include the date, summary, old and new versions,
individual page/tool changes, changed files and author/commit metadata. The manifest still controls
version generation and customer-facing version labels.

Validation: `npm run test:versions`, `npx tsx --test tests/system-version-history.test.ts tests/dev-tools-router.test.ts`, `npm run lint`, `npm run build`, then `npx tsx tests/system-version-ui.ts`.

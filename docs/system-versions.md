# System versions

Open **Home → Dev Setting → System Version** in the developer portal.
The General Version is the single version displayed by Home and every customer
page footer. Page and tool versions are tracked independently, starting at 1.0.0
when tracking begins. The previously displayed public version was 1.2.1;
introducing System Version advances it to 1.3.0. Earlier page/tool release
numbers and history were not recorded and are not reconstructed.

Vite records changes at development startup, after a group of source saves
(750 ms debounce), and before each production build. Changed existing code
increments the general patch: 1.2.5 → 1.2.6. Adding one or more pages or tools
increments the minor once and resets the patch: 1.2.5 → 1.3.0. A batch containing
both additions and edits uses the addition rule. Unchanged builds and browser
visits do not increment versions. Removing a page/tool increments the patch and
records its removal. A page/tool's own patch increments when its source or local
dependencies change. New entries begin at 1.0.0.

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

The generated `src/generated/system-versions.json` contains the versions,
fingerprints and complete recorded change history. **Commit this file alongside
each release's source changes.** Keep it when deploying or checking out another
machine so history remains continuous and repeated builds stay on the same
version. A build with unrecorded source changes updates the file locally; an
ephemeral deployment filesystem cannot persist that history to Git for you.
Use a single release branch and resolve this manifest together with source when
merging concurrent releases. No database, customer requests or browser storage
are used for version counters.

## Database history

Apply `supabase/migrations/20261019000000_system_version_history.sql` before
deploying the history feature. When an administrator opens System Version, the
server saves missing releases from its deployed manifest to
`public.system_version_history` and returns saved history, newest first.
Existing release records are preserved when the page is reopened or an older
deployment is used. Only the server can read and insert records; browser-supplied
history is ignored. If saving fails, the page shows release-file history with a
retry option. Database records include the date, summary, old and new versions,
individual page/tool changes and changed files. The manifest still controls
version generation and customer-facing version labels.

Validation: `npm run test:versions`, `npx tsx --test tests/system-version-history.test.ts tests/dev-tools-router.test.ts`, `npm run lint`, `npm run build`, then `npx tsx tests/system-version-ui.ts`.

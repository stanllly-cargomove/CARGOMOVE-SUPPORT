# CargoMove project guidance

## Codebase Memory

- Use the project-scoped `codebase_memory` MCP server for architecture, symbol searches, callers/callees, and impact discovery when it is available. Read `docs/codebase-memory.md` for setup and maintenance.
- The graph is an aid, not the source of truth. Confirm findings against current files and `git diff` before editing. Missing graph edges do not prove that a caller, dependency, or test does not exist.
- Check `index_status` and coverage for the relevant paths. If the graph is stale, rebuild with `node scripts/codebase-memory.mjs cli index_repository --repo-path .` from this repository, then query again. Use `rg` when MCP is unavailable or coverage is incomplete.
- Preserve `.cbmignore` exclusions. Never index credentials, mailbox contents, attachments, database dumps, logs, or one-off production patches. Do not enable shared graph exports, auxiliary file-search tools, agent hooks, or broader roots as a routine fix.
- Keep reusable project decisions in reviewed repository documentation; this code graph does not remember conversations. Do not copy secrets or customer data into documentation or graph records.

## Database boundary

- Auto Mail uses a separate Supabase project. Its schema migrations live in `supabase/auto-mail/migrations`, outside the main application's migrations. Read `docs/auto-mail-development.md` before changing this area.
- Developer indexing and tests must not connect to live databases or mailboxes or run provisioning SQL. Follow the task's existing authorization for any operational action.

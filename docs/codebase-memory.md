# Codebase Memory for CargoMove

Codebase Memory MCP provides a local, persistent graph for finding symbols,
callers, imports, architecture, and likely change impact. It does not remember
chat history or prove runtime behavior. Confirm results against current source.

## Installed configuration

- Upstream: https://github.com/DeusData/codebase-memory-mcp, release **v0.12.1**.
- Platform: Windows x64. No application dependency or API key is required.
- Executable: `%LOCALAPPDATA%/CargoMove/Tools/codebase-memory-mcp/0.12.1/codebase-memory-mcp.exe`.
- Graph, settings, and logs: `%LOCALAPPDATA%/CargoMove/codebase-memory`.
- Project MCP connection: `.codex/config.toml`, ignored by Git because it uses
  this machine's absolute paths. Global Codex configuration is unchanged.
- `scripts/codebase-memory.mjs` verifies the executable hash before each launch,
  sets the repository boundary, and forwards only an allowlist of runtime
  environment variables. Application/provider credentials are not forwarded.
- Two indexing workers; limits of 10,000 source files and 100 MiB per index.
  Automatic indexing of new projects is off. The background watcher refreshes
  this repository while a connected MCP session is open. CLI indexing alone
  does not keep the watcher alive.
- MCP uses the native `analysis` profile plus a Codex tool allowlist. Only graph
  inspection tools are enabled. Index administration remains available through
  explicit local CLI commands. UI is disabled in both stored settings and MCP
  startup arguments. No hooks, global PATH changes, or shared graph exports.

Restart the Codex IDE extension or open a new Codex session after installation.
The configuration check below confirms registration; an actual MCP tool call
in a new session confirms the connection. The VS Code extension includes its
own Codex executable, which may not be on your PowerShell PATH. That does not
prevent the extension from starting this MCP server.

## Privacy boundaries

`.cbmignore` excludes environment files (including `.env.example`), key files,
local agent configuration, logs, attachments, exports, media, generated output,
one-off SQL patches, and worker provisioning SQL. Application source, tests,
developer documentation, and schema migrations remain available.

These are discovery exclusions, not an operating-system sandbox. The native
process runs as your Windows user. The launcher limits indexing to this repository
with `CBM_ALLOWED_ROOT` and does not forward application credentials, but it does
not revoke filesystem or network privileges. Inspect new source files for embedded
secrets before indexing; filename rules cannot detect every secret or customer
record. The local graph and logs may contain proprietary code metadata and should
be treated as private. Graph results returned to Codex become part of its model
context under your existing Codex data settings.

Upstream documents that auxiliary filesystem walkers do not yet all share the
discovery ignore predicate. Accordingly, `search_code`, `get_code_snippet`, and
`detect_changes` are disabled. Use normal repository tools with explicit paths
when source inspection is needed. Graph deletion, ADR writes, trace ingestion,
cross-repository indexing, and shared export tools are not exposed through MCP.
The native root setting confines indexing; it is not a general access restriction
for every possible native tool.

## Daily use and verification

From the repository root in PowerShell:

```powershell
# Resolve the CLI from PATH, or use the VS Code extension's bundled executable.
$codexCommand = Get-Command codex -ErrorAction SilentlyContinue
$codexExecutable = if ($codexCommand) {
  $codexCommand.Source
} else {
  Get-ChildItem -Path "$env:USERPROFILE/.vscode/extensions/openai.chatgpt-*/bin/windows-x86_64/codex.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $codexExecutable) { throw 'Codex executable not found. Check that the Codex VS Code extension is installed.' }
& $codexExecutable mcp get codebase_memory

node scripts/codebase-memory.mjs --version
node scripts/codebase-memory.mjs cli list_projects
node scripts/codebase-memory.mjs config list
# Rebuild after changes when no MCP session is watching, or after ignore changes.
# Finish source edits first; changes during an index can abort publication safely.
node scripts/codebase-memory.mjs cli index_repository --repo-path .
```

In Codex, use `list_projects` to obtain the generated project name, then
`index_status`, `get_graph_schema`, `get_architecture`, `search_graph`,
`trace_path`, and `check_index_coverage` for focused discovery. Missing edges
and clean coverage are not proof of complete analysis. Use `rg` if unavailable.

The cache root participates in account-wide native daemon coordination. If you
later install another CBM version or configure another cache, do not run them
concurrently: upstream requires the exact same build and cache for active sessions.
Close connected sessions before maintenance. Do not bypass an admission error.

## Reinstall or review an upgrade

Do not use an unpinned `npx`, execute a downloaded installer, disable antivirus,
or run the upstream agent-wide installer for this project setup.

The reviewed archive is:
https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1/codebase-memory-mcp-windows-amd64.zip

Archive SHA-256:
`4e4e0f16b45233af5c757a1fcbe3c3b16e9056375b1fbe2ce020b6de75dedcc0`

Executable SHA-256 (also enforced by the launcher):
`39f6a789cd858d7428561ac5afaefb9a47b018dcba0ad6fa41ae71a45e0ed656`

Download to a staging directory, verify the archive against this pinned hash,
the release `checksums.txt`, and GitHub's release asset digest before extracting.
Copy only the executable, LICENSE, THIRD_PARTY_NOTICES.md, and checksums.txt to
the installation directory above. Do not execute the bundled installer.
Checksums verify matching bytes; they do not replace publisher trust or a
security audit. A Sigstore signature verification was not performed for this setup.

Create the cache directory and write `config.json` **before first native startup**:

```json
{"ui_enabled":false,"ui_port":9749}
```

Then use the launcher to set the resource limits and build the graph:

```powershell
node scripts/codebase-memory.mjs config set auto_index false
node scripts/codebase-memory.mjs config set index_max_files 10000
node scripts/codebase-memory.mjs config set index_max_source_mb 100
node scripts/codebase-memory.mjs cli index_repository --repo-path .
```

Create `.codex/config.toml` using actual absolute paths for this computer:

```toml
[mcp_servers.codebase_memory]
command = 'C:/Program Files/nodejs/node.exe'
args = ['C:/path/to/CARGOMOVE-SUPPORT/scripts/codebase-memory.mjs']
cwd = 'C:/path/to/CARGOMOVE-SUPPORT'
startup_timeout_sec = 30
tool_timeout_sec = 120
required = false
enabled_tools = ['search_graph', 'trace_path', 'query_graph', 'get_graph_schema', 'get_architecture', 'list_projects', 'index_status', 'check_index_coverage', 'get_file_outline']
```

Upgrade deliberately: review release changes, verify the new archive, update the
version and executable hash in the launcher, and repeat connection, query,
scope-rejection, and excluded-file checks. Keep the previous binary until verified.

## Disable or remove

Set `enabled = false` in `.codex/config.toml`, or remove only its
`[mcp_servers.codebase_memory]` table, then restart Codex sessions. After closing
all CBM sessions, the private cache and versioned executable directory listed
above can be removed to erase local graph data and uninstall the tool. Do not
run the upstream global uninstaller, which manages other agent integrations.

References: [upstream configuration](https://github.com/DeusData/codebase-memory-mcp/blob/v0.12.1/docs/CONFIGURATION.md),
[ignore semantics](https://github.com/DeusData/codebase-memory-mcp/blob/v0.12.1/docs/cbmignore.md),
[Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

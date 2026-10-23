// Local development only. No npm dependency or application runtime integration.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.12.1';
const expectedHash = '39f6a789cd858d7428561ac5afaefb9a47b018dcba0ad6fa41ae71a45e0ed656';

try {
  if (process.platform !== 'win32' || process.arch !== 'x64' || !process.env.LOCALAPPDATA) {
    throw new Error('This pinned installation requires Windows x64 and LOCALAPPDATA. See docs/codebase-memory.md.');
  }
  const local = process.env.LOCALAPPDATA;
  const executable = join(local, 'CargoMove', 'Tools', 'codebase-memory-mcp', version, 'codebase-memory-mcp.exe');
  if (createHash('sha256').update(readFileSync(executable)).digest('hex') !== expectedHash) {
    throw new Error('Codebase Memory executable checksum mismatch; reinstall the reviewed release.');
  }

  // Pass only Windows/runtime essentials, never application/provider credentials,
  // NODE_OPTIONS, proxy overrides, or arbitrary inherited CBM settings.
  const allowed = new Set([
    'systemroot', 'windir', 'comspec', 'path', 'pathext',
    'userprofile', 'homedrive', 'homepath', 'localappdata', 'appdata',
    'temp', 'tmp', 'username', 'userdomain', 'programdata', 'programfiles',
    'programfiles(x86)', 'number_of_processors', 'processor_architecture',
  ]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
  Object.assign(env, {
    CBM_ALLOWED_ROOT: root,
    CBM_CACHE_DIR: join(local, 'CargoMove', 'codebase-memory'),
    CBM_WORKERS: '2',
    CBM_LOG_LEVEL: 'warn',
  });
  const args = process.argv.slice(2);
  // The MCP surface is inspection-only. Explicit local CLI commands can rebuild
  // the graph and administer this installation when needed.
  const child = spawn(executable, args.length ? args : ['--ui=false', '--tool-profile=analysis'], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', (error) => {
    process.stderr.write(`Codebase Memory: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
} catch (error) {
  process.stderr.write(`Codebase Memory: ${error.message}\n`);
  process.exitCode = 1;
}

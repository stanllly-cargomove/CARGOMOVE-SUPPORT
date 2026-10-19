import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface VersionEntry {
  id: string;
  name: string;
  kind: 'page' | 'tool';
  area: string;
  version: string;
  updatedAt: string;
  files: string[];
  fingerprint: string;
}
export interface VersionChange {
  version: string;
  previousVersion: string | null;
  date: string;
  summary: string;
  files: string[];
  changes: { id: string; name: string; kind: 'page' | 'tool'; action: 'added' | 'updated' | 'removed'; from: string | null; to: string | null }[];
}
export interface VersionManifest {
  schema: 1;
  version: string;
  updatedAt: string;
  entries: VersionEntry[];
  sourceFiles: Record<string, string>;
  history: VersionChange[];
}
type Definition = Pick<VersionEntry, 'id' | 'name' | 'kind' | 'area' | 'files'>;
export const manifestPath = 'src/generated/system-versions.json';
const baselineVersion = '1.2.1';
const hash = (value: string) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
const excluded = new Set([manifestPath]);
const extensions = ['.ts', '.tsx', '.js', '.mjs', '.css', '.json'];

function walk(root: string, directory: string): string[] {
  if (!existsSync(path.join(root, directory))) return [];
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(root, file) : [file];
  });
}

export function bumpVersion(version: string, addition = false) {
  const [major, minor, patch] = version.split('.').map(Number);
  return addition ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

function definitions(root: string): Definition[] {
  const page = (id: string, name: string, area: string, ...files: string[]): Definition => ({ id, name, area, files, kind: 'page' });
  const entries: Definition[] = [
    page('admin', 'Admin Page', 'Admin', 'src/components/admin/AdminLayout.tsx'),
    page('developer', 'Dev Page', 'Developer', 'src/components/admin/AdminLayout.tsx'),
    page('account-settings', 'Account Settings', 'Admin', 'src/components/admin/AdminLayout.tsx'),
    ...['pending', 'done', 'rejected'].map(status => page(`queue-${status}`, `Registration Queue / ${status === 'done' ? 'Closed / Done' : status[0].toUpperCase() + status.slice(1)}`, 'Admin', 'src/components/admin/SubmissionsList.tsx')),
    ...['Company', 'Driver', 'Trailer', 'Vehicle', 'UserAccess'].map(name => page(`registration-${name.toLowerCase()}`, `${name === 'UserAccess' ? 'User Access' : name} Registration Form`, 'Customer', `src/components/customer/forms/${name}Form.tsx`)),
    page('registration-confirmation', 'Registration Confirmation', 'Customer', 'src/components/customer/ConfirmationScreen.tsx'),
  ];
  const labels: Record<string, string> = {
    HomePage: 'Home Page', RegistrationPage: 'Registration', TrackStatusPage: 'Track Status', GuidelinePage: 'Haulier Guideline', PortalLoginPage: 'Login', PasswordResetPage: 'Password Reset',
    AdminDashboard: 'Registration Dashboard', CompanyMaster: 'Company List', UserRegistration: 'User Access Registration', AdminUser: 'Admin Users', AdminUserCreate: 'Create Admin User', EmailTemplateManager: 'Registration Templates', GuidelineManager: 'Haulier Guidelines', DeveloperSettings: 'Dev Setting', PortDepotConfig: 'Ports & Depots', SchemaMappingInspector: 'Excel Mapping', CargoMoveScheduler: 'Scheduler', NorthportRecovery: 'Northport Recovery', SystemVersion: 'System Version', ExcelExportCenter: 'Excel Export',
  };
  const fragments = /(?:Modal|Icon|Editor)$|^(?:AdminLayout|SubmissionsList)$/;
  for (const directory of ['customer', 'auth', 'admin']) {
    for (const file of walk(root, `src/components/${directory}`)) {
      if (!file.endsWith('.tsx')) continue;
      const name = path.basename(file, '.tsx');
      const isPage = directory === 'admin' ? !fragments.test(name) : /Page$/.test(name);
      if (!isPage) continue;
      entries.push(page(file, labels[name] || name.replace(/([a-z])([A-Z])/g, '$1 $2'), directory === 'admin' ? (['AdminDashboard', 'UserRegistration', 'NorthportRecovery'].includes(name) ? 'Admin' : 'Developer') : 'Customer', file));
    }
  }
  // New tools are registered here so additions have a stable identity and source scope.
  entries.push(
    { id: 'registration', name: 'Cargomove Registration', kind: 'tool', area: 'Registration', files: ['src/components/customer/RegistrationPage.tsx', 'src/components/admin/SubmissionsList.tsx', 'server-handlers/registration', 'api/registration.ts'] },
    { id: 'auto-email', name: 'Auto Email', kind: 'tool', area: 'Email', files: ['src/components/admin/EmailTemplateManager.tsx', 'src/components/admin/CargoMoveScheduler.tsx', 'src/services/email.ts', 'server-handlers/email', 'server-handlers/gmail', 'server-handlers/scheduler', 'server-handlers/_email.ts', 'api/mail.ts'] },
    { id: 'northport', name: 'Northport Recovery', kind: 'tool', area: 'Recovery', files: ['src/components/admin/NorthportRecovery.tsx', 'server-handlers/northport'] },
  );
  // Each top-level module in these folders is a tool, so new tools need no
  // counter edits. Existing tools above retain their established source scopes.
  for (const directory of ['src/tools', 'src/components/tools', 'server-handlers/tools']) {
    const folder = path.join(root, directory);
    if (!existsSync(folder)) continue;
    for (const module of readdirSync(folder, { withFileTypes: true })) {
      if (!module.isDirectory() && !/\.[jt]sx?$/.test(module.name)) continue;
      const file = `${directory}/${module.name}`;
      const name = module.name.replace(/\.[jt]sx?$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
      entries.push({ id: `tool:${file}`, name: name[0].toUpperCase() + name.slice(1), kind: 'tool', area: 'Tools', files: [file] });
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function dependencies(root: string, initial: string[], sources: Record<string, string>) {
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file) || excluded.has(file)) return;
    if (!(file in sources)) {
      for (const candidate of Object.keys(sources).filter(candidate => candidate.startsWith(`${file}/`))) visit(candidate);
      return;
    }
    visited.add(file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) return;
    const content = readFileSync(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      const resolved = [base, ...extensions.map(ext => base + ext), ...extensions.map(ext => `${base}/index${ext}`)].find(candidate => candidate in sources);
      if (resolved) visit(resolved);
    }
  };
  initial.forEach(visit);
  return [...visited].sort();
}

export function updateSystemVersion(root: string, now = new Date().toISOString()): VersionManifest {
  const target = path.join(root, manifestPath);
  const previous: VersionManifest | null = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null;
  const sourceFiles: Record<string, string> = {};
  const files = ['src', 'api', 'server-handlers', 'media', 'supabase'].flatMap(dir => walk(root, dir));
  files.push('index.html', 'package.json', 'vite.config.ts', 'server.ts', 'scripts/system-version.ts', 'scripts/system-version-plugin.ts');
  for (const file of files.sort()) {
    if (excluded.has(file) || !existsSync(path.join(root, file))) continue;
    sourceFiles[file] = /\.(?:png|jpe?g|webp|avif|gif|ico|woff2?|pdf|xlsx?)$/.test(file)
      ? createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')
      : hash(readFileSync(path.join(root, file), 'utf8'));
  }
  const changedFiles = [...new Set([...Object.keys(sourceFiles), ...Object.keys(previous?.sourceFiles || {})])].filter(file => sourceFiles[file] !== previous?.sourceFiles[file]).sort();
  const changes: VersionChange['changes'] = [];
  const entries = definitions(root).map(definition => {
    const trackedFiles = dependencies(root, definition.files, sourceFiles);
    const fingerprint = hash(JSON.stringify({ definition, sources: trackedFiles.map(file => [file, sourceFiles[file]]) }));
    const old = previous?.entries.find(entry => entry.id === definition.id);
    const added = !old && Boolean(previous);
    const updated = Boolean(old && old.fingerprint !== fingerprint);
    const version = old ? (updated ? bumpVersion(old.version) : old.version) : '1.0.0';
    if (added || updated) changes.push({ id: definition.id, name: definition.name, kind: definition.kind, action: added ? 'added' : 'updated', from: old?.version || null, to: version });
    return { ...definition, version, updatedAt: !old || updated ? now : old.updatedAt, fingerprint };
  });
  for (const old of previous?.entries || []) {
    if (!entries.some(entry => entry.id === old.id)) changes.push({ id: old.id, name: old.name, kind: old.kind, action: 'removed', from: old.version, to: null });
  }
  if (previous && !changedFiles.length && !changes.length) return previous;
  // The existing public version is known; individual historical versions are not.
  const version = previous ? bumpVersion(previous.version, changes.some(change => change.action === 'added')) : bumpVersion(baselineVersion, true);
  const baseline: VersionChange = { version: baselineVersion, previousVersion: null, date: now, summary: 'Previous public version. Page and tool history before tracking is unavailable.', files: [], changes: [] };
  if (!previous) {
    for (const entry of entries.filter(entry => entry.files.includes('src/components/admin/SystemVersion.tsx'))) {
      changes.push({ id: entry.id, name: entry.name, kind: entry.kind, action: 'added', from: null, to: entry.version });
    }
  }
  const manifest: VersionManifest = {
    schema: 1, version, updatedAt: now, entries, sourceFiles,
    history: [{ version, previousVersion: previous?.version || baselineVersion, date: now, summary: previous ? (changes.some(change => change.action === 'added') ? 'Added pages or tools' : 'Updated existing pages, tools or shared system files') : 'Added System Version; initialized page and tool tracking.', files: changedFiles, changes }, ...(previous?.history || [baseline])],
  };
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(`${target}.tmp`, JSON.stringify(manifest, null, 2) + '\n');
  renameSync(`${target}.tmp`, target);
  return manifest;
}

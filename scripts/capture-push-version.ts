import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { manifestPath, updateSystemVersion, type VersionManifest } from './system-version.ts';

export function capturePushVersion(root: string, before: string, pushedBy: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const manifest: VersionManifest = JSON.parse(readFileSync(path.join(root, manifestPath), 'utf8'));
  const sourceCommit = git('rev-parse', 'HEAD');
  const baseline = manifest.history.find(release => release.sourceCommit)?.sourceCommit || before;
  let range = sourceCommit;
  if (baseline && !/^0+$/.test(baseline)) {
    // A rewritten branch must not silently invent an author range.
    git('merge-base', '--is-ancestor', baseline, sourceCommit);
    range = `${baseline}..${sourceCommit}`;
  }
  const log = git('log', '--format=%H%x00%an%x00%s', range, '--',
    'src', 'api', 'server-handlers', 'media', 'supabase', 'index.html', 'package.json',
    'vite.config.ts', 'server.ts', 'scripts/system-version.ts', 'scripts/capture-push-version.ts',
    '.github/workflows/system-version.yml', `:(exclude)${manifestPath}`);
  const commits = log ? log.split('\n').map(line => {
    const [sha, author, subject] = line.split('\0');
    return { sha, author, subject };
  }) : [];
  return updateSystemVersion(root, new Date().toISOString(), {
    sourceCommit, pushedBy, commits, authors: [...new Set(commits.map(commit => commit.author))],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'push') {
    throw new Error('Version capture runs only in the GitHub push workflow.');
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  const release = capturePushVersion(process.cwd(), event.before, process.env.GITHUB_ACTOR!);
  process.stdout.write(`System version: ${release.version}\n`);
}

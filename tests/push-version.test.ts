import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { capturePushVersion } from '../scripts/capture-push-version.ts';
import { manifestPath, updateSystemVersion } from '../scripts/system-version.ts';

test('captures authors across commits, excludes release bot, and ignores unchanged pushes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cargomove-push-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = (author: string, subject: string) => {
    git('add', '.');
    git('-c', `user.name=${author}`, '-c', 'user.email=test@example.test', 'commit', '-m', subject);
    return git('rev-parse', 'HEAD');
  };
  const home = path.join(root, 'src/components/customer/HomePage.tsx');
  try {
    git('init');
    mkdirSync(path.dirname(home), { recursive: true });
    writeFileSync(home, 'export const home = 1;');
    updateSystemVersion(root);
    const before = commit('Initial Author', 'Baseline');
    writeFileSync(home, 'export const home = 2;');
    commit('Alice', 'Update home');
    writeFileSync(home, 'export const home = 3;');
    const head = commit('Bob', 'Finish home');
    const release = capturePushVersion(root, before, 'publisher');
    assert.equal(release.version, '1.3.1');
    assert.deepEqual(release.history[0].authors, ['Bob', 'Alice']);
    assert.equal(release.history[0].sourceCommit, head);
    assert.equal(release.history[0].pushedBy, 'publisher');
    assert.deepEqual(release.history[0].files, ['src/components/customer/HomePage.tsx']);
    assert.equal(release.entries.find(entry => entry.name === 'Home Page')?.version, '1.0.1');
    commit('Release Bot', 'Save manifest');
    const unchanged = readFileSync(path.join(root, manifestPath), 'utf8');
    capturePushVersion(root, head, 'publisher');
    assert.equal(readFileSync(path.join(root, manifestPath), 'utf8'), unchanged);
    writeFileSync(home, 'export const home = 4;');
    commit('Carol', 'Next release');
    const next = capturePushVersion(root, head, 'publisher');
    assert.deepEqual(next.history[0].authors, ['Carol']);
    assert.equal(next.version, '1.3.2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bumpEntryVersion, bumpVersion, normalizeEntryVersion, manifestPath, updateSystemVersion } from '../scripts/system-version.ts';

test('version increment rules', () => {
  assert.equal(bumpVersion('1.2.5'), '1.2.6');
  assert.equal(bumpVersion('1.2.5', true), '1.3.0');
  assert.equal(bumpVersion('1.0.9'), '1.0.10');
  assert.equal(bumpEntryVersion('1.0.9'), '1.1.0');
  assert.equal(bumpEntryVersion('1.9.9'), '1.10.0');
  assert.equal(normalizeEntryVersion('1.0.23'), '1.2.3');
  assert.equal(normalizeEntryVersion('1.2.3'), '1.2.3');
});

test('records real source changes once, dependencies, additions, removals and durable history', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cargomove-version-'));
  const put = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  try {
    put('src/components/customer/HomePage.tsx', "import './HomePage.css'; export const home = 1;");
    put('src/components/customer/HomePage.css', '.home { color: red; }');
    put('src/components/admin/NorthportRecovery.tsx', 'export const recovery = 1;');
    put('server-handlers/northport/scan.ts', 'export const scan = 1;');
    const initial = updateSystemVersion(root);
    assert.equal(initial.version, '1.3.0');
    const initialText = readFileSync(path.join(root, manifestPath), 'utf8');
    assert.deepEqual(updateSystemVersion(root), initial);
    assert.equal(readFileSync(path.join(root, manifestPath), 'utf8'), initialText);
    put('src/components/customer/HomePage.css', '.home { color: blue; }');
    const edited = updateSystemVersion(root, undefined, { authors: ['Alice', 'Bob'], pushedBy: 'release-user', sourceCommit: 'abc123', commits: [{ sha: 'abc123', author: 'Alice', subject: 'Change colour' }] });
    assert.equal(edited.version, '1.3.1');
    assert.deepEqual(edited.history[0].authors, ['Alice', 'Bob']);
    assert.equal(edited.history[0].pushedBy, 'release-user');
    assert.equal(edited.entries.find(entry => entry.name === 'Home Page')?.version, '1.0.1');
    assert.equal(edited.entries.find(entry => entry.id === 'northport')?.version, '1.0.0');
    put('server-handlers/northport/scan.ts', 'export const scan = 2;');
    const tool = updateSystemVersion(root);
    assert.equal(tool.version, '1.3.2');
    assert.equal(tool.entries.find(entry => entry.id === 'northport')?.version, '1.0.1');
    put('src/components/customer/NewPage.tsx', 'export const newPage = 1;');
    put('src/components/customer/HomePage.css', '.home { color: green; }');
    const added = updateSystemVersion(root);
    assert.equal(added.version, '1.4.0');
    assert.ok(added.history[0].changes.some(change => change.action === 'added' && change.name === 'New Page'));
    assert.equal(added.entries.find(entry => entry.name === 'Home Page')?.version, '1.0.2');
    rmSync(path.join(root, 'src/components/customer/NewPage.tsx'));
    const removed = updateSystemVersion(root);
    assert.equal(removed.version, '1.4.1');
    assert.ok(removed.history[0].changes.some(change => change.action === 'removed'));
    assert.equal(removed.history.length, 6);
    assert.deepEqual(updateSystemVersion(root), removed);
    put('src/tools/report/index.ts', 'export const report = 1;');
    const newTool = updateSystemVersion(root);
    assert.equal(newTool.version, '1.5.0');
    assert.ok(newTool.history[0].changes.some(change => change.kind === 'tool' && change.action === 'added' && change.name === 'Report'));
    // Source line endings must not cause release increments between Windows and CI.
    put('server-handlers/northport/scan.ts', 'export const scan = 2;\r\n');
    const newline = updateSystemVersion(root);
    put('server-handlers/northport/scan.ts', 'export const scan = 2;\n');
    assert.deepEqual(updateSystemVersion(root), newline);
    // Migration of an older page counter still uses rollover on the next edit.
    const legacy = JSON.parse(readFileSync(path.join(root, manifestPath), 'utf8'));
    legacy.entries.find((entry: any) => entry.name === 'Home Page').version = '1.0.19';
    writeFileSync(path.join(root, manifestPath), JSON.stringify(legacy));
    put('src/components/customer/HomePage.css', '.home { color: orange; }');
    const rolled = updateSystemVersion(root);
    assert.equal(rolled.entries.find(entry => entry.name === 'Home Page')?.version, '1.2.0');
    assert.equal(rolled.history[0].changes.find(change => change.name === 'Home Page')?.from, '1.1.9');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

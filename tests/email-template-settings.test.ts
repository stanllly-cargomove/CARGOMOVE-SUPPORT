import assert from 'node:assert/strict';
import test from 'node:test';
import { clearEmailTemplateSettingsCache, getCachedEmailTemplateSettings, loadEmailTemplateSettings } from '../src/services/emailTemplateSettings';

test('email settings coalesce reads, expire, retain data on failure, and isolate cleared sessions', async () => {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let now = 100_000, calls = 0, fail = false;
  let gate: Promise<void> | null = null;
  globalThis.fetch = async input => {
    const url = String(input); calls++;
    assert.ok(['/api/email/templates', '/api/gmail/status', '/api/email/logs?offset=0&limit=30'].includes(url));
    if (gate) await gate;
    return new Response(JSON.stringify(fail ? { error: 'Test outage' } : url === '/api/email/templates'
      ? { templates: [], ports: [], portAssignmentMode: 'shared' }
      : url === '/api/gmail/status' ? { connected: false, connection: null } : { logs: [], total: 0 }), { status: fail ? 503 : 200 });
  };
  Date.now = () => now;
  clearEmailTemplateSettingsCache();
  try {
    const first = loadEmailTemplateSettings();
    assert.equal(loadEmailTemplateSettings(), first, 'Concurrent mounts share one request');
    await first;
    assert.equal(calls, 3);
    await loadEmailTemplateSettings();
    assert.equal(calls, 3, 'Fresh data needs no network');
    now += 61_000;
    const stale = getCachedEmailTemplateSettings();
    fail = true;
    await assert.rejects(loadEmailTemplateSettings(), /Test outage/);
    assert.equal(getCachedEmailTemplateSettings(), stale, 'Failed refresh preserves the last loaded data');
    fail = false;
    await loadEmailTemplateSettings();
    assert.equal(calls, 9, 'Expired/failed data is retried');
    let release!: () => void;
    gate = new Promise(resolve => { release = resolve; });
    const oldSessionRequest = loadEmailTemplateSettings(true);
    clearEmailTemplateSettingsCache();
    release(); gate = null;
    await oldSessionRequest;
    assert.equal(getCachedEmailTemplateSettings(), null, 'An old response cannot restore data after sign-out');
    await loadEmailTemplateSettings();
    assert.equal(calls, 15, 'A new session must load its own settings');
  } finally {
    clearEmailTemplateSettingsCache(); globalThis.fetch = originalFetch; Date.now = originalNow;
  }
});

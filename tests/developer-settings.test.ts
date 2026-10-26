import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createDeveloperSettingsHandler } from '../server-handlers/developer-settings.js';

const response = () => ({ code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } });
test('shared settings expose only flags and require an active administrator and same-origin confirmation for writes', async () => {
  let row = { registration_test_tools_enabled: false, simulation_enabled: false };
  let actor: any = null, revoked = false, writes = 0;
  const client: any = { from(table: string) {
    let change: any;
    const query: any = { select() { return query; }, eq() { return query; }, timeout() { return query; }, update(value: any) { change = value; return query; }, async maybeSingle() {
      if (table === 'user_registrations') return { data: revoked ? null : { id: 'admin' }, error: null };
      if (change) { writes++; row = { ...row, ...change }; }
      return { data: row, error: null };
    } };
    return query;
  } };
  const handler = createDeveloperSettingsHandler({ adminClient: () => client, readSession: () => actor });
  const invoke = async (method: string, body?: any, headers: any = {}) => { const res = response(); await handler({ method, body, headers }, res); return res; };
  assert.deepEqual((await invoke('GET')).body, { settings: { registrationTestToolsEnabled: false, simulationEnabled: false } });
  assert.equal((await invoke('PATCH', { simulationEnabled: true })).code, 401);
  actor = { id: 'admin', email: 'admin@example.test', type: 'ADMIN' };
  assert.equal((await invoke('PATCH', { simulationEnabled: true })).code, 403);
  const previousUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://settings.test';
  try {
    const headers = { origin: 'https://settings.test', 'x-cargomove-confirm': 'manage-developer-settings' };
    assert.equal((await invoke('PATCH', { simulationEnabled: 'true' }, headers)).code, 400);
    assert.equal((await invoke('PATCH', { unknown: true }, headers)).code, 400);
    assert.equal((await invoke('PATCH', { simulationEnabled: true }, { ...headers, 'sec-fetch-site': 'cross-site' })).code, 403);
    assert.deepEqual((await invoke('PATCH', { simulationEnabled: true }, headers)).body.settings, { registrationTestToolsEnabled: false, simulationEnabled: true });
    revoked = true;
    assert.equal((await invoke('PATCH', { simulationEnabled: false }, headers)).code, 403);
    assert.equal(writes, 1);
  } finally { if (previousUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousUrl; }
});

test('developer settings migration defaults off and restricts direct database access', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync(new URL('../supabase/migrations/20261027000000_shared_developer_settings.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('select registration_test_tools_enabled, simulation_enabled from developer_settings')).rows, [{ registration_test_tools_enabled: false, simulation_enabled: false }]);
    await db.exec('set role anon');
    await assert.rejects(() => db.query('select * from developer_settings'), /permission denied/);
    await db.exec('reset role; set role service_role');
    await db.exec("update developer_settings set simulation_enabled = true where id = 'system'");
    assert.equal((await db.query<any>('select simulation_enabled from developer_settings')).rows[0].simulation_enabled, true);
  } finally { await db.close(); }
});

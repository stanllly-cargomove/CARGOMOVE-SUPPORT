import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { adminClient } from '../api/_runtime.js';
import { createSystemVersionHandler } from '../server-handlers/system-versions.js';
import manifest from '../src/generated/system-versions.json';

test('history migration preserves releases and permits only server-side reads and inserts', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync(new URL('../supabase/migrations/20261019000000_system_version_history.sql', import.meta.url), 'utf8'));
    const insert = "insert into system_version_history(version,changed_at,summary) values('1.0.0',now(),'Original') on conflict(version) do nothing";
    await db.exec(insert);
    await db.exec(insert.replace('Original', 'Replacement'));
    const authorMigration = readFileSync(new URL('../supabase/migrations/20261019010000_system_version_authors.sql', import.meta.url), 'utf8');
    await db.exec(authorMigration);
    assert.deepEqual((await db.query('select metadata from system_version_history')).rows, [{ metadata: { authors: ['Stanlly'] } }]);
    assert.deepEqual((await db.query('select version,summary from system_version_history')).rows, [{ version: '1.0.0', summary: 'Original' }]);
    await db.query("update system_version_history set metadata = $1 where version = '1.0.0'", [JSON.stringify({ authors: ['Alice'], pushedBy: 'release-user' })]);
    await db.exec(authorMigration);
    assert.deepEqual((await db.query('select metadata from system_version_history')).rows, [{ metadata: { authors: ['Alice'], pushedBy: 'release-user' } }]);
    for (const role of ['anon', 'authenticated']) {
      for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const result = await db.query<{ allowed: boolean }>('select has_table_privilege($1, $2, $3) as allowed', [role, 'system_version_history', permission]);
        assert.equal(result.rows[0].allowed, false);
      }
    }
    for (const permission of ['SELECT', 'INSERT']) {
      assert.equal((await db.query<{ allowed: boolean }>("select has_table_privilege('service_role','system_version_history',$1) as allowed", [permission])).rows[0].allowed, true);
    }
  } finally { await db.close(); }
});

test('history endpoint checks access, records only deployed releases and preserves duplicate records', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, app: process.env.APP_URL, scheduler: process.env.SCHEDULER_PORTAL_URL };
  process.env.SUPABASE_URL = 'https://database.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.APP_URL = 'https://portal.example.test';
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  let authenticated = true, revoked = false, failSave = false;
  let saved: any[] = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://database.example.test');
    if (url.pathname.endsWith('/user_registrations')) return Response.json(revoked ? [] : [{ id: 'admin' }]);
    assert.ok(url.pathname.endsWith('/system_version_history'));
    if (options?.method === 'POST') {
      assert.equal(url.searchParams.get('on_conflict'), 'version');
      assert.match(String((options.headers as any).Prefer), /resolution=ignore-duplicates/);
      if (failSave) return Response.json({ message: 'Missing table' }, { status: 404 });
      const rows = JSON.parse(String(options.body));
      assert.equal(rows.length, manifest.history.length);
      for (const row of rows) if (!saved.some(old => old.version === row.version)) saved.push(row);
      return new Response(null, { status: 201 });
    }
    assert.equal(url.searchParams.get('order'), 'changed_at.desc,version.asc');
    return Response.json(saved);
  };
  const handler = createSystemVersionHandler({ adminClient, readSession: () => authenticated ? { id: 'admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 10000 } : null });
  const request = () => ({ method: 'POST', body: { history: [{ version: '99.0.0' }] }, headers: { origin: 'https://portal.example.test', 'x-cargomove-confirm': 'record-system-versions' } });
  const invoke = async (req = request()) => {
    const res = { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
    await handler(req, res); return res;
  };
  try {
    authenticated = false; assert.equal((await invoke()).code, 401);
    authenticated = true; revoked = true; assert.equal((await invoke()).code, 403); revoked = false;
    assert.equal((await invoke({ ...request(), method: 'GET' })).code, 405);
    const crossSite = request(); crossSite.headers.origin = 'https://other.example.test';
    assert.equal((await invoke(crossSite)).code, 403);
    assert.equal((await invoke()).code, 200);
    saved[0].summary = 'Previously saved description';
    saved[0].metadata = { authors: ['Alice', 'Bob'], pushedBy: 'release-user', sourceCommit: 'abc123' };
    const repeated = await invoke();
    assert.equal(repeated.body.history[0].summary, 'Previously saved description');
    assert.deepEqual(repeated.body.history[0].authors, ['Alice', 'Bob']);
    assert.equal(repeated.body.history[0].pushedBy, 'release-user');
    assert.equal(saved.length, manifest.history.length);
    assert.ok(!saved.some(row => row.version === '99.0.0'));
    failSave = true; assert.equal((await invoke()).code, 503);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries({ SUPABASE_URL: originalEnv.url, SUPABASE_SERVICE_ROLE_KEY: originalEnv.key, APP_URL: originalEnv.app, SCHEDULER_PORTAL_URL: originalEnv.scheduler })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

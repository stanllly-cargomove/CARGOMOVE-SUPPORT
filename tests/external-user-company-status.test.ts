import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import handler from '../api/external-user-access.js';

test('Done requires a completed linked company registration before any update', async () => {
  const originalFetch = globalThis.fetch;
  const previousEnv = { secret: process.env.SESSION_SECRET, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SESSION_SECRET = 'offline-test-secret';
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-key';
  const encoded = Buffer.from(JSON.stringify({ type: 'ADMIN', exp: Date.now() + 60000 })).toString('base64url');
  const cookie = `cargomove_session=${encoded}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(encoded).digest('base64url')}`;
  try {
    for (const scenario of ['unregistered', 'unlinked', 'registered', 'lookup-failed', 'missing-user', 'pending', 'public-done']) {
      const writes: unknown[] = [];
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (init?.method === 'PATCH') { writes.push(JSON.parse(String(init.body))); return Response.json([{ id: 'u1', status: 'DONE' }]); }
        if (url.pathname.endsWith('/external_user_access')) return Response.json(scenario === 'missing-user' ? [] : [{ company_id: scenario === 'unlinked' ? null : 'c1' }]);
        assert.equal(url.pathname, '/rest/v1/registration_submissions');
        assert.equal(url.searchParams.get('company_id'), 'eq.c1');
        assert.equal(url.searchParams.get('registration_type'), 'eq.COMPANY');
        assert.equal(url.searchParams.get('status'), 'eq.DONE');
        return scenario === 'lookup-failed' ? Response.json({ error: 'Offline lookup failure' }, { status: 503 }) : Response.json(scenario === 'registered' ? [{ id: 'company-registration' }] : []);
      }) as typeof fetch;
      const response: any = { statusCode: 200, body: null, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
      await handler({ method: scenario === 'public-done' ? 'POST' : 'PATCH', headers: { cookie }, body: { id: 'u1', status: scenario === 'pending' ? 'PENDING' : 'DONE' } }, response);
      if (scenario === 'registered' || scenario === 'pending') {
        assert.equal(response.statusCode, 200, scenario);
        assert.equal(writes.length, 1, scenario);
      } else {
        assert.equal(writes.length, 0, scenario + ' must not mutate a record');
        assert.equal(response.statusCode, scenario === 'lookup-failed' ? 502 : scenario === 'missing-user' ? 404 : scenario === 'public-done' ? 400 : 409, scenario);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ SESSION_SECRET: previousEnv.secret, SUPABASE_URL: previousEnv.url, SUPABASE_SERVICE_ROLE_KEY: previousEnv.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

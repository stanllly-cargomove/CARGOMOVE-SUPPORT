import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://database.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
const { default: configuration } = await import('../server-handlers/registration/config.js');
const { default: registration } = await import('../api/registration.js');
const response = () => ({ code: 200, body: null as any, headers: {} as Record<string, string>, setHeader(key: string, value: string) { this.headers[key] = value; }, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } });

test('public registration configuration uses live active facilities and exposes only explicit fields', async () => {
  const original = globalThis.fetch;
  const seen: URL[] = [];
  globalThis.fetch = (async input => {
    const url = new URL(String(input)); seen.push(url);
    assert.equal(url.origin, 'https://database.example.test');
    assert.equal(url.searchParams.get('active'), 'eq.true');
    assert.ok(url.searchParams.get('select'));
    assert.ok(!url.searchParams.get('select')?.includes('*'));
    return new Response(JSON.stringify([{ id: url.pathname.endsWith('port_configs') ? 'live-port' : 'live-depot' }]), { status: 200 });
  }) as typeof fetch;
  try {
    const res = response(); await configuration({ method: 'GET' }, res);
    assert.equal(res.code, 200); assert.equal(res.body.ports[0].id, 'live-port'); assert.equal(res.body.depots[0].id, 'live-depot');
    assert.equal(seen.length, 2); assert.deepEqual(Object.keys(res.body), ['ports', 'depots']);
    assert.match(res.headers['Cache-Control'], /no-store/);
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'database unavailable' }), { status: 400 })) as typeof fetch;
    const failed = response(); await configuration({ method: 'GET' }, failed);
    assert.equal(failed.code, 502); assert.equal(failed.body.ports, undefined);
    const post = response(); await configuration({ method: 'POST' }, post); assert.equal(post.code, 405);
  } finally { globalThis.fetch = original; }
});

test('registration dispatcher rejects unknown and inherited property names; production routes preserve APIs and deep links', async () => {
  for (const route of ['unknown', 'constructor', '__proto__', undefined]) {
    const res = response(); await registration({ query: { route } }, res); assert.equal(res.code, 404);
  }
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(config.rewrites.some((rule: any) => rule.source === '/api/registration-config' && rule.destination === '/api/registration?route=config'));
  assert.equal(config.rewrites.at(-1).destination, '/index.html');
  assert.match(config.rewrites.at(-1).source, /api/);
  assert.equal(config.redirects.length, 5);
});

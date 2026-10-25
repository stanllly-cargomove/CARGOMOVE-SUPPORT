import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import auth, { createAuthRouter } from '../api/auth.js';

function response() {
  return { code: 200, body: null as any, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.code = code; return this; },
    json(body: any) { this.body = body; return this; }, end() { return this; } };
}

test('auth dispatcher forwards complete requests to the existing handlers', async () => {
  for (const route of ['login', 'session', 'users', 'logout']) {
    for (const method of ['GET', 'POST']) {
      const request = { method, query: { route, username: 'fixture' }, body: { password: 'fixture' }, headers: { cookie: 'fixture' } };
      const result = response();
      const router = createAuthRouter({ [route]: (req, res) => {
        assert.equal(req, request);
        assert.equal(res, result);
        return res.json({ route });
      } });
      await router(request, result);
      assert.deepEqual(result.body, { route });
      assert.equal(result.headers['Cache-Control'], 'no-store');
    }
  }
});

test('invalid auth selectors cannot invoke a handler', async () => {
  for (const route of [undefined, '', 'constructor', '__proto__', ['login', 'logout']]) {
    const result = response();
    await auth({ query: { route } }, result);
    assert.equal(result.code, 404);
  }
});

test('session, logout and protected users routes retain offline behavior', async () => {
  const current = response();
  await auth({ method: 'GET', query: { route: 'session' }, headers: {} }, current);
  assert.deepEqual(current.body, { authenticated: false, user: null });
  const logout = response();
  await auth({ method: 'POST', query: { route: 'logout' }, headers: {} }, logout);
  assert.equal(logout.code, 204);
  assert.match(logout.headers['Set-Cookie'], /cargomove_session=;.*Max-Age=0/);
  const users = response();
  await auth({ method: 'GET', query: { route: 'users' }, headers: {} }, users);
  assert.equal(users.code, 401);
});

test('every public auth URL has an explicit rewrite to the shared function', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const route of ['login', 'session', 'users', 'logout']) {
    assert.ok(config.rewrites.some((rule: any) => rule.source === `/api/auth/${route}` && rule.destination === `/api/auth?route=${route}`));
  }
  assert.ok(config.rewrites.some((rule: any) => rule.source === '/api/auth/profile' && rule.destination === '/api/dev-tools?route=profile'));
});

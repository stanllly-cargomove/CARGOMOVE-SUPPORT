import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import handler, { createAutoRegisterCmRouter } from '../api/scheduler/auto-register-cm.js';

function response() {
  return { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
}

test('scheduler dispatcher preserves requests for scheduled runs and queue operations', async () => {
  for (const route of [undefined, 'queue']) {
    for (const method of ['GET', 'POST', 'PATCH']) {
      const request = { method, query: { ...(route ? { route } : {}), view: 'scheduled' }, headers: { authorization: 'Bearer fixture' }, body: { submissionIds: ['fixture'] } };
      const result = response();
      const check = (selected: string) => (req: any, res: any) => {
        assert.equal(req, request);
        assert.equal(res, result);
        return res.json({ selected });
      };
      await createAutoRegisterCmRouter({ scheduler: check('scheduler'), queue: check('queue') })(request, result);
      assert.equal(result.body.selected, route === 'queue' ? 'queue' : 'scheduler');
    }
  }
});

test('unknown and repeated route selectors never invoke scheduler handlers', async () => {
  const unexpected = () => { throw new Error('Unexpected handler invocation'); };
  const router = createAutoRegisterCmRouter({ scheduler: unexpected, queue: unexpected });
  for (const route of ['', 'unknown', '__proto__', ['queue', 'queue'], null]) {
    const result = response();
    await router({ query: { route } }, result);
    assert.equal(result.code, 404);
  }
});

test('both deployed scheduler routes retain authentication checks', async () => {
  for (const route of [undefined, 'queue']) {
    const result = response();
    await handler({ method: 'GET', query: { route }, headers: {} }, result);
    assert.equal(result.code, 401);
  }
});

test('queue URL rewrites to the shared scheduler with its existing deployment settings', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(config.rewrites.some((rule: any) => rule.source === '/api/scheduler/auto-register-cm-queue' && rule.destination === '/api/scheduler/auto-register-cm?route=queue'));
  const settings = config.functions['api/scheduler/auto-register-cm.ts'];
  assert.equal(settings.maxDuration, 120);
  assert.deepEqual(settings.regions, ['sin1']);
  assert.match(settings.includeFiles, /chromium/);
  assert.equal(config.functions['api/scheduler/auto-register-cm-queue.ts'], undefined);
});

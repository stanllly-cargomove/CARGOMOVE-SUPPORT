import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoRegisterCmQueueHandler } from '../server-handlers/scheduler/auto-register-cm-queue.js';

function responseMock() {
  return { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
}

function dependencies() {
  let session: any = { id: 'admin-id', email: 'admin@example.test', type: 'ADMIN' };
  const client = {
    from() {
      const query: any = {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        timeout() { return this; },
        async maybeSingle() { return { data: { id: 'admin-id' }, error: null }; },
        then(resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return {
    handler: createAutoRegisterCmQueueHandler({ adminClient: () => client as any, readSession: () => session }),
    setSession(value: any) { session = value; },
  };
}

test('Auto Register queue requires an administrator, same-origin confirmation, and bounded selections', async () => {
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  const { handler, setSession } = dependencies();
  const call = async (request: any) => {
    const response = responseMock();
    await handler(request, response);
    return response;
  };

  setSession(null);
  assert.equal((await call({ method: 'GET', headers: {} })).code, 401);
  setSession({ id: 'admin-id', email: 'admin@example.test', type: 'ADMIN' });
  const invalidOrigin = await call({ method: 'POST', body: { submissionIds: ['asset-1'] }, headers: {
    origin: 'https://attacker.example', 'x-cargomove-confirm': 'auto-schedule-auto-register-cm',
  } });
  assert.equal(invalidOrigin.code, 403);

  const invalidIds = await call({ method: 'POST', body: { submissionIds: [] }, headers: {
    origin: 'https://portal.example.test', 'x-cargomove-confirm': 'auto-schedule-auto-register-cm',
  } });
  assert.equal(invalidIds.code, 400);

  const loaded = await call({ method: 'GET', headers: {} });
  assert.equal(loaded.code, 200);
  assert.deepEqual(loaded.body, { registrations: [], history: [] });
});

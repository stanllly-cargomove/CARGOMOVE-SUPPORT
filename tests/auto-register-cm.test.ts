import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoRegisterCmHandler } from '../server-handlers/scheduler/auto-register-cm.js';

function responseMock() {
  return { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
}

test('cron authentication is required and a disabled scheduler exits before registration access', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  const calls: string[] = [];
  const client = {
    async rpc(name: string) {
      calls.push(name);
      if (name === 'auto_register_cm_actor') return { data: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_automation_scheduler') return { data: { id: '20000000-0000-4000-8000-000000000001', reason: 'disabled', status: 'SKIPPED' }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
    from() { throw new Error('Disabled execution must not inspect or modify registrations'); },
  };
  const handler = createAutoRegisterCmHandler({
    adminClient: () => client as any, readSession: () => null,
    uploadWorkbook: async () => { throw new Error('Upload must not run'); },
    verifyWorkbook: async () => { throw new Error('Verification must not run'); },
    runAutomation: async () => { throw new Error('CM scheduler must not run'); },
  });
  const unauthorized = responseMock();
  await handler({ method: 'POST', body: {}, headers: { authorization: 'Bearer wrong' } }, unauthorized);
  assert.equal(unauthorized.code, 401);
  assert.deepEqual(calls, []);

  const disabled = responseMock();
  await handler({ method: 'POST', body: {}, headers: { authorization: 'Bearer offline-auto-register-secret' } }, disabled);
  assert.equal(disabled.code, 200);
  assert.equal(disabled.body.status, 'skipped');
  assert.deepEqual(calls, ['auto_register_cm_actor', 'acquire_automation_scheduler']);
});

test('an enabled run skips an empty scheduled queue without inspecting pending or active registrations', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  const calls: string[] = [];
  const tables: string[] = [];
  const client = {
    async rpc(name: string) {
      calls.push(name);
      if (name === 'auto_register_cm_actor') return { data: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_automation_scheduler') return { data: { id: '20000000-0000-4000-8000-000000000001', reason: 'acquired', status: 'RUNNING' }, error: null };
      if (name === 'finish_automation_scheduler') return { data: true, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      tables.push(table);
      if (table !== 'auto_register_cm_scheduled_items') throw new Error(`Unexpected table ${table}`);
      const query: any = {
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        async timeout() { return { data: [], error: null }; },
      };
      return query;
    },
  };
  const handler = createAutoRegisterCmHandler({
    adminClient: () => client as any, readSession: () => null,
    uploadWorkbook: async () => { throw new Error('Upload must not run'); },
    verifyWorkbook: async () => { throw new Error('Verification must not run'); },
    runAutomation: async () => { throw new Error('CM scheduler must not run'); },
  });

  const response = responseMock();
  await handler({ method: 'POST', body: {}, headers: { authorization: 'Bearer offline-auto-register-secret' } }, response);

  assert.equal(response.code, 200);
  assert.deepEqual(response.body, {
    executionId: '20000000-0000-4000-8000-000000000001', status: 'skipped',
    message: 'No scheduled registrations are ready to process.', processedCount: 0, successCount: 0, failedCount: 0,
  });
  assert.deepEqual(tables, ['auto_register_cm_scheduled_items']);
  assert.deepEqual(calls, ['auto_register_cm_actor', 'acquire_automation_scheduler', 'finish_automation_scheduler']);
});

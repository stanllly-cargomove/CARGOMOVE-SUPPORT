import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { cronSigningPayload, signedCronMatches } from '../server-handlers/scheduler/cron-signature.js';
import { createAutoRegisterCmHandler } from '../server-handlers/scheduler/auto-register-cm.js';

test('Supabase proofs expire, bind to one step and cannot authorize modified bodies', () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'offline-signing-secret';
  try {
    const now = Date.parse('2026-10-26T13:07:00Z'), timestamp = String(now / 1000);
    const root = { window: Math.floor(now / 1_200_000) };
    const headers = { 'x-cargomove-cron-timestamp': timestamp,
      'x-cargomove-cron-signature': crypto.createHmac('sha256', 'offline-signing-secret').update(cronSigningPayload(timestamp, root)!).digest('hex') };
    assert.equal(cronSigningPayload(timestamp, root), `auto-register-cm:v1\n${timestamp}\nwindow:${root.window}`);
    assert.equal(signedCronMatches(headers, root, now), true);
    assert.equal(signedCronMatches(headers, root, now + 121_000), false);
    assert.equal(signedCronMatches(headers, root, now - 121_000), false);
    assert.equal(signedCronMatches(headers, { window: root.window + 1 }, now), false);
    assert.equal(signedCronMatches(headers, { ...root, extra: true }, now), false);
    assert.equal(signedCronMatches(headers, { continuationToken: '80000000-0000-4000-8000-000000000001' }, now), false);
    assert.equal(signedCronMatches({ ...headers, 'x-cargomove-cron-signature': 'a'.repeat(64) }, root, now), false);
    assert.equal(signedCronMatches({ ...headers, 'x-cargomove-cron-timestamp': [timestamp] }, root, now), false);
    process.env.CRON_SECRET = 'different-offline-secret';
    assert.equal(signedCronMatches(headers, root, now), false);
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
});

test('a signed Cron request uses automatic admission, reads its body once and obeys the disabled toggle', async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'offline-signing-secret';
  try {
    const body = { window: Math.floor(Date.now() / 1_200_000) }, timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', 'offline-signing-secret').update(cronSigningPayload(timestamp, body)!).digest('hex');
    const calls: string[] = [];
    const client = { async rpc(name: string) {
      calls.push(name);
      return { error: null, data: name === 'auto_register_cm_actor' ? { id: 'admin', email: 'admin@example.test' }
        : { id: 'disabled-run', reason: 'disabled', status: 'SKIPPED' } };
    }, from() { throw new Error('A disabled Cron trigger must never inspect registrations'); } };
    const handler = createAutoRegisterCmHandler({ adminClient: () => client as any, readSession: () => null,
      uploadWorkbook: async () => { throw new Error('Must not upload'); }, verifyWorkbook: async () => { throw new Error('Must not verify'); },
      runAutomation: async () => { throw new Error('Must not dispatch'); } });
    const capture = () => ({ code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } });
    let reads = 0;
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST',
      headers: { 'x-cargomove-cron-timestamp': timestamp, 'x-cargomove-cron-signature': signature } });
    request.on('data', () => { reads++; });
    const response = capture(); await handler(request, response);
    assert.equal(response.code, 200); assert.match(response.body.message, /disabled/); assert.equal(reads, 1);
    assert.deepEqual(calls, ['auto_register_cm_actor', 'acquire_auto_register_cm_step']);
    const invalid = capture();
    await handler({ method: 'POST', body: { window: body.window + 1 }, headers: request.headers }, invalid);
    assert.equal(invalid.code, 401); assert.equal(calls.length, 2);
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
});

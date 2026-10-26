import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoRegisterCmHandler } from '../server-handlers/scheduler/auto-register-cm.js';
import { adminClient } from '../api/_runtime.js';

test('the deployed database client orders unattempted registrations first', async context => {
  const previousUrl = process.env.SUPABASE_URL, previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.env.SUPABASE_URL = 'https://offline.example.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-key';
    context.mock.method(globalThis, 'fetch', async (url: string) => {
      assert.equal(new URL(url).searchParams.get('order'), 'last_attempted_at.asc.nullsfirst,scheduled_at.asc');
      return new Response('[]');
    });
    const result = await adminClient()!.from('auto_register_cm_scheduled_items').select('id')
      .order('last_attempted_at', { ascending: true, nullsFirst: true }).order('scheduled_at', { ascending: true });
    assert.equal(result.error, null);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('one automatic execution verifies trailer and vehicle batches without uploading again or linking untouched files', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  process.env.CARGOMOVE_USERNAME = 'offline'; process.env.CARGOMOVE_PASSWORD = 'offline';
  const subs = ['TRAILER', 'VEHICLE', 'TRAILER'].map((type, i) => ({ id: `s${i}`, registration_type: type,
    reference_no: `CMREG${i}`, cargomove_upload: { id: `30000000-0000-4000-8000-00000000000${i}`, state: 'PROCESSING' } }));
  const links: string[][] = [];
  const verified: string[] = [];
  const client = {
    async rpc(name: string, args: any) {
      if (name === 'auto_register_cm_has_work') return { data: false, error: null };
      if (name === 'auto_register_cm_actor') return { data: { id: 'admin', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_auto_register_cm_step') return { data: { id: 'run', status: 'RUNNING' }, error: null };
      if (['auto_register_cm_email_candidates', 'auto_register_cm_pending_page'].includes(name)) return { data: [], error: null };
      if (name === 'finish_auto_register_cm_step') return { data: true, error: null };
      const sub = subs.find(sub => sub.cargomove_upload.id === args.p_id)!;
      const job = { id: sub.cargomove_upload.id, batch_id: sub.cargomove_upload.id, submission_id: sub.id, state: sub.cargomove_upload.state };
      if (name === 'claim_registration_upload_batch') return { data: { job, token: 'lease' }, error: null };
      if (name === 'transition_registration_upload_batch') {
        sub.cargomove_upload.state = args.p_state;
        return { data: { ...job, state: args.p_state }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      let update: any;
      const filters = new Map<string, any>();
      const q: any = {
        select() { return this; }, eq(key: string, value: any) { filters.set(key, value); return this; },
        in(key: string, value: any) { filters.set(key, value); return this; }, not() { return this; },
        order() { return this; }, limit() { return this; }, timeout() { return this; },
        update(value: any) { update = value; return this; },
        async maybeSingle() { return { data: table === 'automation_schedulers' ? { discovery_cursor: null }
          : table === 'registration_submissions' ? subs.find(sub => sub.id === filters.get('id')) : { id: 'admin' }, error: null }; },
        then(resolve: any, reject: any) {
          let data: any[] = [];
          if (table === 'auto_register_cm_scheduled_items') {
            if (update?.run_id) links.push(filters.get('submission_id'));
            if (!update) data = subs.map(sub => ({ id: `q-${sub.id}`, submission_id: sub.id, registration_type: sub.registration_type, reference_no: sub.reference_no }));
          }
          if (table === 'registration_uploads') data = subs.filter(sub => filters.has('batch_id')
            ? sub.cargomove_upload.id === filters.get('batch_id')
            : filters.get('submission_id')?.includes(sub.id) && sub.cargomove_upload.state !== 'SUCCESS')
            .map(sub => ({ id: sub.cargomove_upload.id, batch_id: sub.cargomove_upload.id, submission_id: sub.id, state: sub.cargomove_upload.state }));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      }; return q;
    },
  };
  const handler = createAutoRegisterCmHandler({ adminClient: () => client as any, readSession: () => null,
    uploadWorkbook: async () => { throw new Error('Verified/resumed files must never upload again'); },
    verifyWorkbook: async (_credentials, job) => { verified.push((job as any).id); return { state: 'SUCCESS', message: 'Verified', successCount: 1, errorCount: 0 }; },
    runAutomation: async () => { throw new Error('Already processed files must never dispatch again'); } });
  const res = responseMock();
  await handler({ method: 'POST', body: {}, headers: { authorization: 'Bearer offline-auto-register-secret' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.successCount, 2);
  assert.deepEqual(verified, [subs[0].cargomove_upload.id, subs[1].cargomove_upload.id]);
  assert.deepEqual(links, [['s0'], ['s1']], 'The untouched second trailer belongs to a later batch/run');
});

function responseMock() {
  return { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
}

test('continuations require cron authentication, reject invalid bodies and recover only persisted responses', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  const token = '80000000-0000-4000-8000-000000000001';
  let admission: any = { reason: 'invalid_continuation' }, admitted = 0;
  const client = {
    async rpc(name: string) {
      if (name === 'auto_register_cm_actor') return { data: { id: 'admin', email: 'admin@example.test' }, error: null };
      assert.equal(name, 'acquire_auto_register_cm_step'); admitted++;
      return { data: admission, error: null };
    },
    from() { throw new Error('Invalid, in-flight and duplicate continuations must never inspect registrations'); },
  };
  const handler = createAutoRegisterCmHandler({ adminClient: () => client as any, readSession: () => null,
    uploadWorkbook: async () => { throw new Error('Must not upload'); }, verifyWorkbook: async () => { throw new Error('Must not verify'); },
    runAutomation: async () => { throw new Error('Must not dispatch'); } });
  const call = async (body: any, secret = 'offline-auto-register-secret') => {
    const res = responseMock();
    await handler({ method: 'POST', body, headers: { authorization: `Bearer ${secret}` } }, res); return res;
  };
  assert.equal((await call({ continuationToken: token }, 'wrong')).code, 401);
  for (const body of [{ continuationToken: 'bad' }, { continuationToken: token, window: 1 }, { continuationToken: token, extra: true }, { window: 0 }, { window: '1' }]) {
    assert.equal((await call(body)).code, 400);
  }
  assert.equal(admitted, 0);
  assert.equal((await call({ continuationToken: token })).code, 410);
  admission = { id: 'saved', reason: 'duplicate', status: 'RUNNING' };
  assert.equal((await call({ continuationToken: token })).code, 409);
  admission = { id: 'saved', reason: 'duplicate', status: 'SUCCESS', continuationToken: token, message: 'Saved result' };
  const duplicate = await call({ continuationToken: token });
  assert.equal(duplicate.code, 200); assert.equal(duplicate.body.continuationToken, token); assert.equal(duplicate.body.message, 'Saved result');
});

test('each twenty-minute delivery advances work while duplicate delivery never inspects registrations', async context => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  const keys: string[] = [];
  const client = {
    async rpc(name: string, args: any) {
      if (name === 'auto_register_cm_has_work') return { data: false, error: null };
      if (name === 'auto_register_cm_actor') return { data: { id: 'admin', email: 'admin@example.test' }, error: null };
      assert.equal(name, 'acquire_auto_register_cm_step');
      keys.push(args.p_request_key);
      return { data: { id: 'existing-run', reason: 'duplicate', status: 'SUCCESS' }, error: null };
    },
    from() { throw new Error('Duplicate triggers must not inspect registrations'); },
  };
  const handler = createAutoRegisterCmHandler({ adminClient: () => client as any, readSession: () => null,
    uploadWorkbook: async () => { throw new Error('Must not upload'); },
    verifyWorkbook: async () => { throw new Error('Must not verify'); },
    runAutomation: async () => { throw new Error('Must not dispatch'); } });
  const clock = context.mock.method(Date, 'now');
  for (const time of ['00:07', '00:08', '00:19', '00:27', '00:47', '01:07', '02:07']) {
    clock.mock.mockImplementation(() => Date.parse(`2026-10-26T${time}:00+08:00`));
    const response = responseMock();
    await handler({ method: 'POST', body: {}, headers: { authorization: 'Bearer offline-auto-register-secret' } }, response);
    assert.equal(response.code, 200);
    assert.match(response.body.message, /already handled/);
  }
  assert.equal(new Set(keys.slice(0, 3)).size, 1);
  assert.notEqual(keys[3], keys[0], 'The next twenty-minute slot admits more work');
});

test('cron authentication is required and a disabled scheduler exits before registration access', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  const calls: string[] = [];
  const client = {
    async rpc(name: string) {
      if (name === 'auto_register_cm_has_work') return { data: false, error: null };
      calls.push(name);
      if (name === 'auto_register_cm_actor') return { data: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_auto_register_cm_step') return { data: { id: '20000000-0000-4000-8000-000000000001', reason: 'disabled', status: 'SKIPPED' }, error: null };
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
  assert.deepEqual(calls, ['auto_register_cm_actor', 'acquire_auto_register_cm_step']);
});

test('temporary upload-check errors preserve every scheduled registration and report no terminal registration failures', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  process.env.CARGOMOVE_USERNAME = 'offline'; process.env.CARGOMOVE_PASSWORD = 'offline';
  const writes: any[] = [];
  let final: any;
  const client = {
    async rpc(name: string, args: any) {
      if (name === 'auto_register_cm_has_work') return { data: false, error: null };
      if (name === 'auto_register_cm_actor') return { data: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_auto_register_cm_step') return { data: { id: '20000000-0000-4000-8000-000000000001', status: 'RUNNING' }, error: null };
      if (name === 'auto_register_cm_email_candidates') return { data: [], error: null };
      if (name === 'auto_register_cm_pending_page') return { data: [], error: null };
      if (name === 'claim_registration_upload_batch') return { data: null, error: { message: 'Temporary database timeout' } };
      if (name === 'finish_auto_register_cm_step') { final = args; return { data: true, error: null }; }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      let update: any;
      const query: any = {
        select() { return this; }, eq() { return this; }, in() { return this; }, not() { return this; },
        order() { return this; }, limit() { return this; }, timeout() { return this; },
        update(value: any) { update = value; return this; },
        async maybeSingle() { return { data: table === 'automation_schedulers' ? { discovery_cursor: null } : { id: 'admin' }, error: null }; },
        then(resolve: any, reject: any) {
          let data: any[] = [];
          if (table === 'auto_register_cm_scheduled_items') {
            if (update) writes.push(update);
            else data = ['s1', 's2'].map((id, index) => ({ id: `q${index}`, submission_id: id, registration_type: 'VEHICLE', reference_no: `CMREG${index}` }));
          }
          if (table === 'registration_uploads') data = [{ id: '30000000-0000-4000-8000-000000000001', submission_id: 's1', state: 'PROCESSING' }];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const handler = createAutoRegisterCmHandler({ adminClient: () => client as any, readSession: () => null,
    uploadWorkbook: async () => { throw new Error('Must not upload'); }, verifyWorkbook: async () => { throw new Error('Must not verify'); },
    runAutomation: async () => { throw new Error('Must not dispatch'); } });
  const response = responseMock();
  await handler({ method: 'POST', body: {}, headers: { authorization: 'Bearer offline-auto-register-secret' } }, response);
  assert.equal(response.body.status, 'skipped');
  assert.deepEqual([final.p_processed, final.p_success, final.p_failed], [0, 0, 0]);
  assert.ok(writes.some(write => write.run_id));
  assert.ok(writes.every(write => !write.status), 'A temporary error never turns scheduled rows into failed rows');
});

test('execution references come from every persisted run association rather than the latest queue pointer', async () => {
  const client = {
    from(table: string) {
      const query: any = {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; },
        limit() { return this; }, range() { return this; }, timeout() { return this; },
        async maybeSingle() { return { data: table === 'automation_schedulers' ? { scheduler_key: 'auto_register_cm', is_enabled: true } : { id: 'admin' }, error: null }; },
        then(resolve: any, reject: any) {
          let data: any[];
          if (table === 'automation_scheduler_runs') data = [{ id: 'old-run' }, { id: 'latest-run' }];
          else if (table === 'automation_scheduler_run_items') data = [
            { run_id: 'old-run', scheduled_item_id: 'q1', auto_register_cm_scheduled_items: { reference_no: 'CMREG1' } },
            { run_id: 'latest-run', scheduled_item_id: 'q1', auto_register_cm_scheduled_items: { reference_no: 'CMREG1' } },
          ];
          else throw new Error(`Unexpected table ${table}`);
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const handler = createAutoRegisterCmHandler({ adminClient: () => client as any,
    readSession: () => ({ id: 'admin', email: 'admin@example.test', type: 'ADMIN', exp: 1 }),
    uploadWorkbook: async () => { throw new Error('Must not upload'); }, verifyWorkbook: async () => { throw new Error('Must not verify'); },
    runAutomation: async () => { throw new Error('Must not dispatch'); } });
  const response = responseMock();
  await handler({ method: 'GET', headers: {} }, response);
  assert.equal(response.code, 200);
  assert.deepEqual(response.body.runs.map((run: any) => run.registrationReferences), [['CMREG1'], ['CMREG1']]);
});

test('delivery status distinguishes a recent manual execution from the last automatic chain and exposes only safe Cron diagnostics', async () => {
  const client = { from(table: string) {
    const q: any = { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; },
      limit() { return this; }, timeout() { return this; }, range() { return this; },
      async maybeSingle() {
        return { error: null, data: table === 'automation_schedulers'
          ? { scheduler_key: 'auto_register_cm', last_run_at: '2026-10-26T04:20:00Z' }
          : table === 'automation_scheduler_runs' ? { started_at: '2026-10-26T01:37:00Z', chain_started_at: '2026-10-26T01:32:00Z' }
          : table === 'auto_register_cm_cron_state' ? { is_enabled: true, last_tick_at: '2026-10-26T05:40:00Z', last_status: 'FAILED',
            last_error_code: 'HTTP_401', request_body: { continuationToken: 'private-step-token' }, privateSecret: 'private-fixture-secret' }
          : { id: 'admin' } };
      },
      then(resolve: any, reject: any) { return Promise.resolve({ data: table === 'automation_scheduler_runs'
        ? [{ id: 'manual', execution_type: 'MANUAL', started_at: '2026-10-26T04:20:00Z' }] : [], error: null }).then(resolve, reject); },
    }; return q;
  } };
  const handler = createAutoRegisterCmHandler({ adminClient: () => client as any,
    readSession: () => ({ id: 'admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60_000 }),
    uploadWorkbook: async () => { throw new Error('Must not upload'); }, verifyWorkbook: async () => { throw new Error('Must not verify'); },
    runAutomation: async () => { throw new Error('Must not dispatch'); } });
  const result = responseMock(); await handler({ method: 'GET', headers: {} }, result);
  assert.equal(result.code, 200);
  assert.equal(result.body.scheduler.lastRunAt, '2026-10-26T04:20:00Z');
  assert.equal(result.body.scheduler.lastAutomaticRunAt, '2026-10-26T01:32:00Z');
  assert.deepEqual(result.body.scheduler.cronTrigger, { isEnabled: true, lastTickAt: '2026-10-26T05:40:00Z', status: 'FAILED', errorCode: 'HTTP_401' });
  assert.doesNotMatch(JSON.stringify(result.body), /private-step-token|private-fixture-secret/);
});

test('only identified ineligible registrations fail when the rest of a batch hits an admission conflict', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  process.env.CARGOMOVE_USERNAME = 'offline'; process.env.CARGOMOVE_PASSWORD = 'offline';
  const writes: any[] = [];
  let transientApproval = false;
  const client = {
    async rpc(name: string, args: any) {
      if (name === 'auto_register_cm_has_work') return { data: false, error: null };
      if (name === 'auto_register_cm_actor') return { data: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_auto_register_cm_step') return { data: { id: '20000000-0000-4000-8000-000000000001', status: 'RUNNING' }, error: null };
      if (name === 'auto_register_cm_email_candidates') return { data: [], error: null };
      if (name === 'auto_register_cm_pending_page') return { data: [], error: null };
      if (name === 'registration_upload_company_block_reason') return {
        data: transientApproval ? null : args.p_company_id === 'blocked' ? 'Parent company is not registered.' : null,
        error: transientApproval ? { message: 'Database timeout' } : null,
      };
      if (name === 'begin_registration_upload_batch') return { data: null, error: { message: 'Another upload owns this batch' } };
      if (name === 'finish_auto_register_cm_step') return { data: true, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      let update: any, id: string, submissionId: string;
      const query: any = {
        select() { return this; }, in() { return this; }, not() { return this; },
        eq(field: string, value: string) { if (field === 'id') id = value; if (field === 'submission_id') submissionId = value; return this; },
        order() { return this; }, limit() { return this; }, timeout() { return this; },
        update(value: any) { update = value; return this; },
        async maybeSingle() {
          const data = table === 'automation_schedulers' ? { discovery_cursor: null }
            : table === 'registration_submissions' ? { id, reference_no: id === 's1' ? 'CMREG1' : 'CMREG2', registration_type: 'DRIVER',
              company_id: id === 's1' ? 'blocked' : 'registered', company_type: 'HAULAGE', port_id: 'port', port_location: 'JOHOR',
              data: { drivers: [{ name: 'Driver', driving_license: '12345', mobile_no: '0123456789' }] } }
              : table === 'companies' ? { id, company_type: 'HAULAGE', haulier_id: 'H1' } : { id: 'admin' };
          return { data, error: null };
        },
        then(resolve: any, reject: any) {
          let data: any[] = [];
          if (table === 'auto_register_cm_scheduled_items') {
            if (update) writes.push({ ...update, submissionId });
            else data = ['s1', 's2'].map((id, index) => ({ id: `q${index}`, submission_id: id, registration_type: 'DRIVER', reference_no: `CMREG${index + 1}` }));
          }
          if (table === 'port_configs') data = [{ id: 'port', location: 'JOHOR', backend_port_id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const handler = createAutoRegisterCmHandler({ adminClient: () => client as any, readSession: () => null,
    uploadWorkbook: async () => { throw new Error('Must not upload'); }, verifyWorkbook: async () => { throw new Error('Must not verify'); },
    runAutomation: async () => { throw new Error('Must not dispatch'); } });
  const call = async () => {
    const response = responseMock();
    await handler({ method: 'POST', body: {}, headers: { authorization: 'Bearer offline-auto-register-secret' } }, response);
    return response;
  };
  const blocked = await call();
  assert.equal(blocked.body.failedCount, 1);
  assert.deepEqual(writes.filter(write => write.status).map(write => write.submissionId), ['s1']);
  writes.length = 0;
  transientApproval = true;
  const unavailable = await call();
  assert.equal(unavailable.code, 500);
  assert.equal(unavailable.body.failedCount, 0);
  assert.ok(writes.every(write => !write.status), 'An unavailable eligibility check fails the execution without failing registrations');
});

test('an enabled run discovers pending registrations before skipping an empty scheduled queue', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  const calls: string[] = [];
  const tables: string[] = [];
  const client = {
    async rpc(name: string) {
      if (name === 'auto_register_cm_has_work') return { data: false, error: null };
      calls.push(name);
      if (name === 'auto_register_cm_actor') return { data: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_auto_register_cm_step') return { data: { id: '20000000-0000-4000-8000-000000000001', reason: 'acquired', status: 'RUNNING' }, error: null };
      if (name === 'finish_auto_register_cm_step') return { data: true, error: null };
      if (name === 'auto_register_cm_email_candidates') return { data: [], error: null };
      if (name === 'auto_register_cm_pending_page') return { data: [], error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      tables.push(table);
      if (!['auto_register_cm_scheduled_items', 'automation_schedulers'].includes(table)) throw new Error(`Unexpected table ${table}`);
      const query: any = {
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        timeout() { return this; },
        async maybeSingle() { return { data: { discovery_cursor: null }, error: null }; },
        then(resolve: any, reject: any) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
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
  assert.deepEqual(tables, ['automation_schedulers', 'auto_register_cm_scheduled_items']);
  assert.deepEqual(calls, ['auto_register_cm_actor', 'acquire_auto_register_cm_step', 'auto_register_cm_pending_page', 'auto_register_cm_email_candidates', 'finish_auto_register_cm_step']);
});

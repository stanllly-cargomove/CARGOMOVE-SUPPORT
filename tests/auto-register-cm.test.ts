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

test('temporary upload-check errors preserve every scheduled registration and report no terminal registration failures', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  process.env.CARGOMOVE_USERNAME = 'offline'; process.env.CARGOMOVE_PASSWORD = 'offline';
  const writes: any[] = [];
  let final: any;
  const client = {
    async rpc(name: string, args: any) {
      if (name === 'auto_register_cm_actor') return { data: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_automation_scheduler') return { data: { id: '20000000-0000-4000-8000-000000000001', status: 'RUNNING' }, error: null };
      if (name === 'auto_register_cm_pending_page') return { data: [], error: null };
      if (name === 'claim_registration_upload_batch') return { data: null, error: { message: 'Temporary database timeout' } };
      if (name === 'finish_automation_scheduler') { final = args; return { data: true, error: null }; }
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

test('only identified ineligible registrations fail when the rest of a batch hits an admission conflict', async () => {
  process.env.CRON_SECRET = 'offline-auto-register-secret';
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  process.env.CARGOMOVE_USERNAME = 'offline'; process.env.CARGOMOVE_PASSWORD = 'offline';
  const writes: any[] = [];
  let transientApproval = false;
  const client = {
    async rpc(name: string, args: any) {
      if (name === 'auto_register_cm_actor') return { data: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_automation_scheduler') return { data: { id: '20000000-0000-4000-8000-000000000001', status: 'RUNNING' }, error: null };
      if (name === 'auto_register_cm_pending_page') return { data: [], error: null };
      if (name === 'registration_upload_company_block_reason') return {
        data: transientApproval ? null : args.p_company_id === 'blocked' ? 'Parent company is not registered.' : null,
        error: transientApproval ? { message: 'Database timeout' } : null,
      };
      if (name === 'begin_registration_upload_batch') return { data: null, error: { message: 'Another upload owns this batch' } };
      if (name === 'finish_automation_scheduler') return { data: true, error: null };
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
      calls.push(name);
      if (name === 'auto_register_cm_actor') return { data: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.test' }, error: null };
      if (name === 'acquire_automation_scheduler') return { data: { id: '20000000-0000-4000-8000-000000000001', reason: 'acquired', status: 'RUNNING' }, error: null };
      if (name === 'finish_automation_scheduler') return { data: true, error: null };
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
  assert.deepEqual(calls, ['auto_register_cm_actor', 'acquire_automation_scheduler', 'auto_register_cm_pending_page', 'finish_automation_scheduler']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { autoRegistrationRecordCount, createAutoRegisterCmQueueHandler } from '../server-handlers/scheduler/auto-register-cm-queue.js';
import { scheduleEligibleAutoRegistrations, loadPendingAutoRegistrations } from '../server-handlers/scheduler/auto-register-cm-discovery.js';

function responseMock() {
  return { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
}

function dependencies(pending: any[] = []) {
  let session: any = { id: 'admin-id', email: 'admin@example.test', type: 'ADMIN' };
  const client = {
    async rpc(name: string) {
      assert.equal(name, 'auto_register_cm_pending_page');
      return { data: pending, error: null };
    },
    from() {
      const query: any = {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        range() { return this; },
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

test('Auto Register registration details count singular and batch asset records', () => {
  const fixture = (registration_type: string, data: any) => ({ registration_type, data }) as any;
  assert.equal(autoRegistrationRecordCount(fixture('DRIVER', { driver: { name: 'One' } })), 1);
  assert.equal(autoRegistrationRecordCount(fixture('TRAILER', { trailers: Array.from({ length: 10 }, () => ({})) })), 10);
  assert.equal(autoRegistrationRecordCount(fixture('VEHICLE', { vehicles: [] })), 0);
});

test('Auto Register queue removes completed manual registrations even with stale scheduled entries', async () => {
  const { handler } = dependencies([
    { id: 'completed', status: 'COMPLETED' },
    { id: 'rejected', status: 'REJECTED' },
    { id: 'awaiting-email', status: 'PENDING', cargomove_upload: { state: 'SUCCESS' } },
  ]);
  const response = responseMock();
  await handler({ method: 'GET', headers: {} }, response);
  assert.equal(response.code, 200);
  assert.deepEqual(response.body.registrations, [], 'Already registered assets do not remain scheduled or become ineligible rows');
});

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

test('discovery resumes a bounded scan beyond 300 blocked registrations without opening the page', async () => {
  const submissions: any[] = Array.from({ length: 351 }, (_, index) => ({
    id: `s-${String(index).padStart(4, '0')}`, reference_no: `CMREG${index}`, registration_type: 'DRIVER',
    status: 'PENDING', company_id: index === 350 ? 'registered' : 'blocked', company_name: 'Fixture',
    company_type: 'HAULAGE', submitted_at: '2026-10-25T00:00:00Z', port_id: 'port', port_location: 'JOHOR',
    data: { drivers: [{ name: 'Driver', driving_license: '12345', mobile_no: '0123456789' }] },
  }));
  let cursor: string | null = null;
  let elapsed = 0;
  let pages = 0;
  const scheduled = new Set<string>();
  const client = {
    async rpc(name: string, args: any) {
      if (name === 'auto_register_cm_pending_page') {
        pages++;
        return { data: submissions.filter(sub => (!args.p_after || sub.id > args.p_after)
          && (!args.p_candidates_only || !scheduled.has(sub.id))).slice(0, args.p_limit), error: null };
      }
      if (name === 'registration_upload_company_block_reason') {
        return { data: args.p_company_id === 'blocked' ? 'Parent company is not registered.' : null, error: null };
      }
      if (name === 'schedule_auto_register_cm_submissions') {
        for (const id of args.p_submission_ids) scheduled.add(id);
        return { data: args.p_submission_ids.map((submission_id: string) => ({ submission_id })), error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      let id = '', update: any;
      const query: any = {
        select() { return this; }, limit() { return this; }, timeout() { return this; },
        eq(field: string, value: string) { if (field === 'id') id = value; return this; },
        update(value: any) { update = value; return this; },
        async maybeSingle() {
          return { data: table === 'automation_schedulers' ? { discovery_cursor: cursor }
            : { id, company_type: 'HAULAGE', haulier_id: 'H1' }, error: null };
        },
        then(resolve: any, reject: any) {
          if (table === 'automation_schedulers' && update) { cursor = update.discovery_cursor; elapsed++; }
          const data = table === 'port_configs' ? [{ id: 'port', location: 'JOHOR', backend_port_id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }] : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  let scans = 0;
  while (!scheduled.size && scans++ < 20) {
    await scheduleEligibleAutoRegistrations(client, 'admin-id', { now: () => elapsed, deadline: elapsed + 4 });
  }
  assert.ok(scans > 1, 'The work budget forces multiple scans');
  assert.deepEqual([...scheduled], ['s-0350'], 'Only the eligible record beyond the old 300-row limit is queued');
  assert.ok(pages > 3);
  const allPending = await loadPendingAutoRegistrations(client);
  assert.equal(allPending.length, 351, 'The overview also reads every pending page');
});

test('Auto Register queue exposes scheduled, retrying and stopped submission indicators', async () => {
  const selectedFields: string[] = [];
  let status = '';
  const client = {
    from(table: string) {
      if (table === 'user_registrations') {
        const adminQuery: any = {
          select() { return this; }, eq() { return this; }, timeout() { return this; },
          async maybeSingle() { return { data: { id: 'admin-id' }, error: null }; },
        };
        return adminQuery;
      }
      assert.equal(table, 'auto_register_cm_scheduled_items');
      const query: any = {
        select(fields: string) { selectedFields.push(fields); return this; },
        eq(field: string, value: string) {
          assert.equal(field, 'status'); status = value;
          return this;
        },
        in(field: string, values: string[]) { assert.equal(field, 'status'); assert.deepEqual(values, ['FAILED', 'SUCCESS']); status = 'TERMINAL'; return this; },
        limit() { return this; },
        order() { return this; }, range() { return this; },
        timeout() { return Promise.resolve({ data: status === 'SCHEDULED'
          ? [{ submission_id: 'asset-1' }, { submission_id: 'asset-2' }]
          : [{ submission_id: 'asset-2', status: 'FAILED', message: 'First failure', completed_at: '2026-10-25T00:00:00Z', retry_allowed: true },
            { submission_id: 'asset-3', status: 'FAILED', message: 'First failure', completed_at: '2026-10-25T00:00:00Z', retry_allowed: true },
            { submission_id: 'asset-3', status: 'FAILED', message: 'Second failure', completed_at: '2026-10-25T02:00:00Z', retry_allowed: true },
            { submission_id: 'asset-4', status: 'FAILED', message: 'First failure', completed_at: '2026-10-25T00:00:00Z', retry_allowed: true },
            { submission_id: 'asset-4', status: 'SUCCESS', message: 'Completed', completed_at: '2026-10-25T02:00:00Z', retry_allowed: true },
            { submission_id: 'asset-5', status: 'FAILED', message: 'Partial upload', completed_at: '2026-10-25T00:00:00Z', retry_allowed: false }], error: null }); },
      };
      return query;
    },
  };
  const handler = createAutoRegisterCmQueueHandler({
    adminClient: () => client as any,
    readSession: () => ({ id: 'admin-id', email: 'admin@example.test', type: 'ADMIN', exp: 1 }),
  });
  const response = responseMock();
  await handler({ method: 'GET', query: { view: 'scheduled' }, headers: {} }, response);
  assert.equal(response.code, 200);
  assert.deepEqual(selectedFields, ['submission_id', 'submission_id,status,message,completed_at,retry_allowed']);
  assert.deepEqual(response.body, { scheduledSubmissionIds: ['asset-1', 'asset-2'], failedSubmissionIds: ['asset-3', 'asset-5'] });
});

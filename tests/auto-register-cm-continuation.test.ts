import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoRegisterCmHandler } from '../server-handlers/scheduler/auto-register-cm.js';
import { encryptRefreshToken } from '../server-handlers/_email.js';

for (const scenario of ['fast', 'manual-fast', 'budget', 'read-timeout', 'slow-result']) test(`one execution exports/uploads/runs/checks; safe continuation only when needed (${scenario})`, async context => {
  let clock = Date.now();
  context.mock.method(Date, 'now', () => clock);
  const env = { CRON_SECRET: 'offline-chain-secret', SCHEDULER_PORTAL_URL: 'https://offline.example.test',
    CARGOMOVE_USERNAME: 'offline', CARGOMOVE_PASSWORD: 'offline', SESSION_SECRET: 'offline-session',
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), GOOGLE_OAUTH_CLIENT_ID: 'offline', GOOGLE_OAUTH_CLIENT_SECRET: 'offline' };
  const previous = Object.keys(env).map(key => process.env[key]);
  Object.assign(process.env, env);
  try {
    const actor = '10000000-0000-4000-8000-000000000001', schedulerId = '60000000-0000-4000-8000-000000000001';
    const jobId = '30000000-0000-4000-8000-000000000001';
    const sub: any = { id: 'driver', reference_no: 'CMREG-TEST', registration_type: 'DRIVER', status: 'PENDING',
      company_id: 'company', company_name: 'Offline Carrier', company_type: 'HAULAGE', port_id: 'port', port_location: 'JOHOR',
      notification_email: 'recipient@example.test', data: { drivers: [{ name: 'Fixture', driving_license: '001234', mobile_no: '0123456789' }] } };
    const company = { id: 'company', company_type: 'HAULAGE', haulier_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', contact_email: 'recipient@example.test' };
    const port = { id: 'port', location: 'JOHOR', backend_port_id: 'bbbbbbbbbbbbbbbbbbbbbbbb' };
    const template = { id: 'acceptance-driver', name: 'Acceptance', active: true, trigger_status: 'DONE', version: 1, template_code: 'D1',
      recipient_template: '{{user.email}}', subject_template: 'Accepted', body_template: '<p>Approved.</p>', attachments: [] };
    const queue: any = { id: 'q', submission_id: sub.id, registration_type: 'DRIVER', reference_no: sub.reference_no, status: 'SCHEDULED' };
    let job: any, receipt: any, uploads = 0, verifications = 0, dispatches = 0, emails = 0;
    let deferredOnce = false;
    const runs = new Map<string, any>();
    context.mock.method(globalThis, 'fetch', async (url: any) => {
      if (String(url) === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'offline-access' }));
      assert.equal(String(url), 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
      assert.equal(job.state, 'SUCCESS'); assert.equal(sub.status, 'PENDING');
      emails++; return new Response(JSON.stringify({ id: 'offline-gmail-receipt' }));
    });
    const connection = { id: 'system', status: 'ACTIVE', email: 'sender@example.test', ...encryptRefreshToken('offline-refresh') };
    const client = {
      async rpc(name: string, args: any) {
        let data: any;
        if (name === 'auto_register_cm_actor') data = { id: actor, email: 'admin@example.test' };
        else if (name === 'acquire_automation_scheduler') {
          data = { id: '20000000-0000-4000-8000-000000000001', status: 'RUNNING' }; runs.set('manual', data);
        }
        else if (name === 'acquire_auto_register_cm_step') {
          const key = args.p_continuation ? `after:${args.p_continuation}` : args.p_request_key;
          if (runs.has(key)) return { data: { ...runs.get(key), reason: 'duplicate' }, error: null };
          data = { id: `20000000-0000-4000-8000-${String(runs.size + 1).padStart(12, '0')}`, status: 'RUNNING' };
          runs.set(key, data);
        } else if (['finish_auto_register_cm_step', 'finish_automation_scheduler'].includes(name)) {
          const run = [...runs.values()].find(run => run.id === args.p_id);
          run.status = args.p_status; run.message = args.p_message;
          run.continuationToken = args.p_has_more ? `80000000-0000-4000-8000-${String(runs.size).padStart(12, '0')}` : null;
          data = name === 'finish_automation_scheduler' ? true : { continuationToken: run.continuationToken, continuationDelayMs: 5000 };
        } else if (name === 'auto_register_cm_has_work') data = queue.status === 'SCHEDULED' || sub.status === 'PENDING' && job?.state === 'SUCCESS';
        else if (name === 'auto_register_cm_pending_page') data = [];
        else if (name === 'auto_register_cm_email_candidates') data = queue.status === 'SUCCESS' && sub.status === 'PENDING' ? [sub] : [];
        else if (name === 'registration_upload_company_block_reason') data = null;
        else if (name === 'begin_registration_upload_batch') {
          assert.equal(job, undefined, 'A physical workbook can be created only once');
          job = { id: jobId, batch_id: jobId, submission_id: sub.id, state: 'PREPARING', entity: 'driver', filename: 'CMREG-TEST_DRIVER.xlsx',
            scheduler_id: schedulerId, created_at: new Date().toISOString(), expected_rows: 1 };
          data = { job: { ...job }, token: 'lease', submissions: [sub], existing: false };
        } else if (name === 'claim_registration_upload_batch') data = { job: { ...job }, token: 'lease' };
        else if (name === 'transition_registration_upload_batch') {
          job.state = args.p_state;
          sub.cargomove_upload = { id: jobId, state: job.state, message: args.p_message };
          data = { ...job };
        } else if (name === 'acquire_saved_cargomove_scheduler') data = { id: schedulerId, task_id: 'cccccccccccccccccccccccc', worker_name: 'process_file_uploads' };
        else if (['mark_cargomove_scheduler_dispatch', 'finish_cargomove_scheduler'].includes(name)) data = true;
        else if (name === 'claim_registration_acceptance') {
          assert.equal(receipt, undefined); receipt = { state: 'SENDING', submission_id: sub.id, upload_id: jobId }; data = 'CLAIMED';
        } else if (name === 'complete_registration_email') {
          assert.equal(receipt.state, 'SENT'); assert.equal(emails, 1); sub.status = 'DONE'; data = sub;
        } else throw new Error(`Unexpected RPC ${name}`);
        return { data, error: null };
      },
      from(table: string) {
        const filters = new Map<string, any>(); let update: any, excludeTerminal = false;
        const execute = () => {
          const tables: Record<string, any[]> = {
            automation_schedulers: [{ scheduler_key: 'auto_register_cm', discovery_cursor: null }],
            user_registrations: [{ id: actor, email: 'admin@example.test', type: 'ADMIN' }],
            registration_submissions: [sub], auto_register_cm_scheduled_items: [queue], registration_uploads: job ? [job] : [],
            companies: [company], port_configs: [port], cargomove_schedulers: [{ id: schedulerId, worker_name: 'process_file_uploads', enabled: true }],
            registration_acceptance_deliveries: receipt ? [receipt] : [], email_templates: [template], gmail_connections: [connection],
            email_template_ports: [{ template_id: template.id, port_id: 'port', email_templates: template }],
          };
          assert.ok(table in tables, table);
          const rows = tables[table].filter(row => [...filters].every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)
            && (!excludeTerminal || !['SUCCESS', 'FAILED'].includes(row.state)));
          if (update) rows.forEach(row => Object.assign(row, update));
          return { data: rows, error: null };
        };
        const query: any = { select() { return this; }, eq(key: string, value: any) { filters.set(key, value); return this; },
          in(key: string, value: any) { filters.set(key, value); return this; }, not() { excludeTerminal = true; return this; },
          order() { return this; }, limit() { return this; }, timeout() { return this; }, update(value: any) { update = value; return this; },
          async maybeSingle() { const result = execute(); return { ...result, data: result.data[0] || null }; },
          then(resolve: any, reject: any) { return Promise.resolve(execute()).then(resolve, reject); } };
        return query;
      },
    };
    const handler = createAutoRegisterCmHandler({ adminClient: () => client as any,
      readSession: () => scenario === 'manual-fast' ? { id: actor, email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60_000 } : null,
      uploadWorkbook: async (_credentials, _job, buffer, beforeUpload, _launch, budget) => {
        assert.equal(buffer.subarray(0, 2).toString(), 'PK', 'The same execution generates an Excel workbook before upload');
        assert.ok(budget! <= 65_000 && budget! > 0);
        uploads++; await beforeUpload();
        if (scenario === 'budget') clock += 70_000;
        if (scenario === 'slow-result') clock += 45_000;
        return { state: 'UPLOADED', message: 'Uploaded' };
      },
      verifyWorkbook: async (_credentials, _job, _launch, budget) => {
        assert.ok(budget! <= 25_000 && budget! > 0); verifications++;
        if (scenario === 'read-timeout' && !deferredOnce) {
          deferredOnce = true; return { state: 'UNKNOWN', retryable: true, message: 'Temporary listing timeout' };
        }
        if (scenario === 'budget' && !deferredOnce) { deferredOnce = true; clock += 15_000; }
        if (scenario === 'slow-result' && !deferredOnce) {
          if (job.state === 'UPLOADED') clock += 15_000;
          else { clock += 12_000; deferredOnce = true; return { state: 'PROCESSING', message: 'CargoMove is still processing' }; }
        }
        return job.state === 'UPLOADED' ? { state: 'PROCESSING', message: 'Ready', readyForScheduler: true }
          : { state: 'SUCCESS', message: 'Verified', successCount: 1, errorCount: 0 };
      },
      runAutomation: async (_credentials, beforeDispatch, _launch, budget) => {
        assert.ok(budget! <= 30_000 && budget! > 0); await beforeDispatch(); dispatches++;
        if (scenario === 'slow-result') clock += 20_000;
        return { status: 'TRIGGER_REQUESTED', message: 'Requested' };
      } });
    const call = async (body: any) => {
      const res = { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
      await handler({ method: 'POST', body, headers: scenario === 'manual-fast'
        ? { origin: 'https://offline.example.test', 'x-cargomove-confirm': 'run-auto-register-cm' }
        : { authorization: 'Bearer offline-chain-secret' } }, res);
      assert.equal(res.code, 200, JSON.stringify(res.body)); return res.body;
    };
    const body = scenario === 'manual-fast' ? {} : { window: Math.floor(Date.now() / 1_200_000) };
    const initial = await call(body);
    if (scenario !== 'manual-fast') assert.equal((await call(body)).continuationToken, initial.continuationToken);
    if (scenario === 'fast' || scenario === 'manual-fast') {
      assert.equal(job.state, 'SUCCESS'); assert.equal(sub.status, 'DONE');
      assert.equal(initial.successCount, 1); assert.ok(!initial.continuationToken);
      assert.equal(runs.size, 1, 'Upload, CM processing and final verification share a single execution');
    } else {
      assert.ok(initial.continuationToken, 'Only genuinely unfinished work receives a continuation');
      assert.equal(job.state, scenario === 'slow-result' ? 'PROCESSING' : 'UPLOADED');
      assert.equal(dispatches, scenario === 'slow-result' ? 1 : 0, 'No CM dispatch when there is insufficient time or verification is unavailable');
      assert.equal(sub.status, 'PENDING');
      const nextBody = { continuationToken: initial.continuationToken };
      const resumed = await call(nextBody);
      assert.equal((await call(nextBody)).continuationToken, resumed.continuationToken);
      assert.equal(resumed.continuationToken, null); assert.equal(runs.size, 2);
    }
    assert.deepEqual({ uploads, verifications, dispatches, emails }, { uploads: 1, verifications: ['fast', 'manual-fast'].includes(scenario) ? 2 : 3, dispatches: 1, emails: 1 });
    assert.equal(sub.status, 'DONE'); assert.equal(queue.status, 'SUCCESS');
  } finally {
    Object.keys(env).forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

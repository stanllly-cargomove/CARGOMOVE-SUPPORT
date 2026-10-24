import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';
import { verifyUploadRows, cleanMessage } from '../server-handlers/registration-uploads/automation.js';
import { createRegistrationUploadsHandler } from '../server-handlers/registration-uploads/handler.js';
import { buildExcelRowData, EXCEL_TEMPLATES } from '../shared/registration-excel.js';
import { assetCompanyBlockReason, normalizeCompanyRegistrationStatus, COMPANY_REGISTRATION_REQUIRED } from '../shared/registration-eligibility.js';

const actor = '10000000-0000-4000-8000-000000000001';
const scheduler = '60000000-0000-4000-8000-000000000001';
const company = { id: 'company', company_type: 'HAULAGE', haulier_id: '5adc9dd77753d26fb07d6f26', status: 'ACTIVE' };
const port = { id: 'port', code: 'TEST', location: 'JOHOR', backend_port_id: '5ad78eeb458efa4c5a1fc007' };
const submission = { id: 'driver', reference_no: 'CMREG400001', registration_type: 'DRIVER', company_id: 'company', company_type: 'HAULAGE',
  port_id: 'port', port_location: 'JOHOR', status: 'PENDING', data: { drivers: [{ driving_license: '001234', mobile_no: '0123456789', name: 'Fixture Driver' }] } };
function response() { return { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } }; }

async function fixture(applyRegistrationStatus = true) {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create table user_registrations(id text,email text,type text);
    insert into auth.users values('${actor}','admin@example.test');
    insert into user_registrations values('admin','admin@example.test','ADMIN');
    create table companies(id text primary key,company_type text,haulier_id text,status text,updated_at timestamptz default now());
    create table port_configs(id text,code text,location text,backend_port_id text);
    create table registration_submissions(id text primary key,reference_no text,registration_type text,company_id text,company_type text,
      port_id text,port_location text,status text,data jsonb,exported_at timestamptz,export_filename text,rejection_reason text,rejection_detail text,submitted_at timestamptz default now());
  `);
  for (const file of ['20261016000000_cargomove_scheduler.sql', '20261017000000_cargomove_scheduler_gallery.sql', '20261017020000_scheduler_cooldown_45_seconds.sql', '20261021000000_scheduler_verification_30_seconds.sql'])
    await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
  await db.query(`insert into cargomove_schedulers(id,display_name,task_id,worker_name) values($1,'CM PROCESS FILE UPLOAD','5ff7ea8633904c1dd1bd892c','process_file_uploads')`, [scheduler]);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261024010000_registration_cargomove_uploads.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261024020000_registration_upload_registered_company.sql', import.meta.url), 'utf8'));
  if (applyRegistrationStatus) await db.exec(readFileSync(new URL('../supabase/migrations/20261025000000_company_registration_status.sql', import.meta.url), 'utf8'));
  await db.query(`insert into companies(id,company_type,haulier_id${applyRegistrationStatus ? '' : ',status'}) values($1,$2,$3${applyRegistrationStatus ? '' : " ,'ACTIVE'"})`, [company.id, company.company_type, company.haulier_id]);
  await db.query('insert into port_configs values($1,$2,$3,$4)', [port.id, port.code, port.location, port.backend_port_id]);
  await db.query('insert into registration_submissions(id,reference_no,registration_type,company_id,company_type,port_id,port_location,status,data) values($1,$2,$3,$4,$5,$6,$7,$8,$9)', Object.values(submission));
  await db.exec(`insert into registration_submissions(id,reference_no,registration_type,company_id,status) values('company-registration','CMREG400000','COMPANY','company','DONE')`);
  async function rpc(name: string, args: Record<string, unknown>) {
    try {
      assert.match(name, /^[a-z_]+$/);
      const entries = Object.entries(args);
      const result = await db.query<any>(`select ${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')}) as result`, entries.map(([, value]) => value));
      return { data: result.rows[0].result, error: null };
    } catch (error) { return { data: null, error: { message: String(error) } }; }
  }
  const client = { rpc, from(table: string) {
    assert.match(table, /^[a-z_]+$/);
    let columns = '*', limit = 1000;
    const filters: [string, unknown][] = [];
    const execute = async (single = false) => {
      const result = await db.query(`select ${columns} from ${table}${filters.length ? ' where ' + filters.map(([key], i) => `${key}=$${i + 1}`).join(' and ') : ''} limit ${limit}`, filters.map(([, value]) => value));
      return { data: single ? result.rows[0] || null : result.rows, error: null };
    };
    return { select(value: string) { columns = value; return this; }, eq(key: string, value: unknown) { filters.push([key, value]); return this; },
      limit(value: number) { limit = value; return this; }, timeout() { return this; }, maybeSingle() { return execute(true); },
      then(resolve: any, reject: any) { return execute().then(resolve, reject); } };
  } };
  return { db, client, rpc, async begin() { const result = await rpc('begin_registration_upload', { p_actor: actor, p_submission_id: 'driver' }); assert.equal(result.error, null); return result.data; },
    async transition(job: any, state: string, extra = {}) { const result = await rpc('transition_registration_upload', {
      p_id: job.job.id, p_token: job.token, p_state: state, p_message: state, ...extra,
    }); assert.equal(result.error, null); return result.data; } };
}

test('registered-company guard migration can be retried without duplicate objects or downgrading newer registration approval', async () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261024020000_registration_upload_registered_company.sql', import.meta.url), 'utf8');
  for (const currentSchema of [false, true]) {
    const f = await fixture(currentSchema);
    try {
      const definition = async () => (await f.db.query<any>(`select pg_get_functiondef('public.registration_upload_company_block_reason(text)'::regprocedure) as source`)).rows[0].source;
      const before = await definition();
      await f.db.exec('drop trigger guard_registration_upload_company on public.registration_uploads');
      await f.db.exec(sql);
      await f.db.exec(sql);
      assert.equal(await definition(), before, 'Keep the existing approval function, including the newer imported-company logic');
      assert.equal((await f.db.query<any>(`select count(*)::int as count from pg_trigger where tgrelid='public.registration_uploads'::regclass and tgname='guard_registration_upload_company'`)).rows[0].count, 1);
      assert.equal((await f.db.query<any>(`select count(*)::int as count from registration_submissions`)).rows[0].count, 2, 'Reruns do not modify registrations');
      assert.equal((await f.db.query<any>(`select has_function_privilege('authenticated','registration_upload_company_block_reason(text)','EXECUTE') as allowed`)).rows[0].allowed, false);
      if (currentSchema) {
        await f.db.exec(`insert into companies(id,registration_status) values('imported','DONE')`);
        assert.equal((await f.rpc('registration_upload_company_block_reason', { p_company_id: 'imported' })).data, null, 'A rerun must not reinstate the old requirement for an imported company to have a queue entry');
      }
      const admitted = await f.begin();
      assert.ok(admitted.job.id);
    } finally { await f.db.close(); }
  }
});

test('registration status migration repairs repeated and partial installs without approving new Pending requests again', async () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261025000000_company_registration_status.sql', import.meta.url), 'utf8');
  for (const installed of [true, false]) {
    const f = await fixture(installed);
    try {
      if (!installed) await f.db.exec(`alter table companies add column registration_status text not null default 'PENDING' check (registration_status in ('PENDING','DONE','REJECTED'))`);
      await f.db.exec(`insert into companies(id,registration_status) values('new-pending-company','PENDING'),('new-rejected-company','REJECTED');
        insert into registration_submissions(id,company_id,registration_type,status) values
          ('new-pending-request','new-pending-company','COMPANY','PENDING'),
          ('new-rejected-request','new-rejected-company','COMPANY','REJECTED')`);
      const statuses = async () => (await f.db.query<any>(`select 'company' as kind,id,registration_status as status from companies
        union all select 'submission',id,status from registration_submissions order by kind,id`)).rows;
      const before = await statuses();
      if (installed) await f.db.exec('drop trigger sync_company_registration_status on registration_submissions');
      await f.db.exec(sql);
      await f.db.exec(sql);
      assert.deepEqual(await statuses(), before, 'Retried migration must preserve every existing registration decision');
      const guards = (await f.db.query<any>(`select tgname from pg_trigger where not tgisinternal and tgname in
        ('guard_company_registration_status','sync_company_registration_status','guard_asset_company_registration') order by tgname`)).rows;
      assert.equal(guards.length, 3, 'All three guards are installed exactly once');
      assert.equal((await f.rpc('registration_upload_company_block_reason', { p_company_id: 'new-pending-company' })).data, COMPANY_REGISTRATION_REQUIRED);
      assert.equal((await f.rpc('registration_upload_company_block_reason', { p_company_id: 'new-rejected-company' })).data, COMPANY_REGISTRATION_REQUIRED);
      await f.db.exec(`update registration_submissions set status='DONE' where id='new-pending-request'`);
      assert.equal((await f.db.query<any>(`select registration_status from companies where id='new-pending-company'`)).rows[0].registration_status, 'DONE', 'Reinstalled queue sync still works');
      await f.db.exec(`insert into companies(id) values('future-after-retry')`);
      assert.equal((await f.db.query<any>(`select registration_status from companies where id='future-after-retry'`)).rows[0].registration_status, 'PENDING');
      assert.equal((await f.db.query<any>(`select has_function_privilege('authenticated','guard_company_registration_status()','EXECUTE') as allowed`)).rows[0].allowed, false);
    } finally { await f.db.close(); }
  }
});

test('verification matches the exact reference file and requires full counts; partial, foreign, duplicate and unknown results never complete', () => {
  const job = { entity: 'driver', filename: 'CMREG400001_DRIVER_attempt.xlsx', expected_rows: 2 };
  const row = { _id: 'upload-id', original_name: job.filename, status: 'success', message: { success: 'File processed successfully. SuccessCount: 2, ErrorCount: 0' } };
  assert.equal(verifyUploadRows([row], job).state, 'SUCCESS');
  assert.equal(verifyUploadRows([row], { ...job, upload_id: 'another' }).state, 'MISSING');
  assert.equal(verifyUploadRows([{ ...row, original_name: 'different.xlsx' }], job).state, 'MISSING');
  assert.equal(verifyUploadRows([row, row], job).state, 'UNKNOWN');
  assert.equal(verifyUploadRows([{ ...row, message: { success: 'SuccessCount: 1, ErrorCount: 1' } }], job).state, 'FAILED');
  assert.equal(verifyUploadRows([{ ...row, message: { success: 'File processed successfully.' } }], job).state, 'UNKNOWN');
  assert.equal(verifyUploadRows([{ ...row, message: { success: 'SuccessCount: 2.5, ErrorCount: 0' } }], job).state, 'UNKNOWN');
  assert.equal(verifyUploadRows([{ ...row, status: 'not_processed' }], job).readyForScheduler, true);
  assert.equal(verifyUploadRows([{ ...row, status: 'processing_started' }], job).readyForScheduler, undefined);
  assert.equal(verifyUploadRows([{ ...row, status: 'error', message: { error: '<b>Invalid registration</b>' } }], job).state, 'FAILED');
  assert.equal(cleanMessage('<script>text</script>\u0000'), 'text');
});

test('shared workbook mapping preserves leading zeros, trailer slashes, column order and company export behavior', () => {
  const context = { companies: [company], ports: [port], depots: [] } as any;
  const driver = buildExcelRowData([submission as any], context);
  assert.equal(driver.rows[0].DRIVINGLICENSE, '001234');
  assert.equal(driver.rows[0].MOBILENO, '0123456789');
  assert.equal(driver.rows[0].HAULIERID, company.haulier_id);
  const trailer = buildExcelRowData([{ ...submission, registration_type: 'TRAILER', data: { trailers: [{ registration_number: 'T/BA123', weight: '2000', trailer_type: 'Skeletal', bdm_weight: '40000' }] } } as any], context);
  assert.equal(trailer.rows[0].REGISTRATION, 'T/BA123');
  assert.deepEqual(trailer.headers, EXCEL_TEMPLATES.TRAILER);
  const comp = buildExcelRowData([{ ...submission, registration_type: 'COMPANY', data: { company: { name: 'Fixture', assigned_port_ids: ['port'] } } } as any], context);
  assert.equal(comp.rows[0].PORTS, port.backend_port_id);
  assert.equal(comp.rows[0].TYPE, 'HAULAGE');
});

test('asset eligibility requires only Company registration approval', () => {
  const approved = { ...submission, id: 'approval', registration_type: 'COMPANY', status: 'DONE', submitted_at: '2026-10-23T00:00:00Z' } as any;
  const latest = { ...approved, id: 'latest', submitted_at: '2026-10-24T00:00:00Z', status: 'PENDING' };
  for (const type of ['DRIVER', 'TRAILER', 'VEHICLE']) {
    const asset = { ...submission, registration_type: type } as any;
    assert.equal(assetCompanyBlockReason(asset, company as any, [approved]), null);
    for (const status of ['PENDING', 'REJECTED'])
      assert.equal(assetCompanyBlockReason(asset, company as any, [approved, { ...latest, status }]), COMPANY_REGISTRATION_REQUIRED);
    assert.equal(assetCompanyBlockReason(asset, company as any, []), COMPANY_REGISTRATION_REQUIRED);
    assert.equal(assetCompanyBlockReason(asset, { ...company, registration_status: 'DONE' } as any, []), null, 'An administrator-confirmed imported company needs no synthetic queue entry');
    assert.equal(assetCompanyBlockReason(asset, { ...company, registration_status: 'DONE' } as any, [latest]), COMPANY_REGISTRATION_REQUIRED, 'Pending queue approval overrides a master edit');
    assert.equal(assetCompanyBlockReason(asset, company as any, [{ ...approved, company_id: 'other' }]), COMPANY_REGISTRATION_REQUIRED);
    assert.equal(assetCompanyBlockReason(asset, { ...company, status: 'INACTIVE' } as any, [approved]), null, 'A legacy activity flag does not block processing');
  }
  assert.equal(assetCompanyBlockReason(latest, company as any, [latest]), null, 'The Company itself can still be exported for registration');
});

test('company registration status backfills and follows the queue while imported companies can be explicitly registered without a queue', async () => {
  const f = await fixture(false);
  try {
    await f.db.exec(`insert into companies(id,company_type,haulier_id,status) values('imported','HAULAGE','existing-cargomove-id','ACTIVE')`);
    await f.db.exec(`insert into companies(id,status) values('pending-company','INACTIVE'),('rejected-company','ACTIVE');
      insert into registration_submissions(id,company_id,registration_type,status) values
      ('pending-company-request','pending-company','COMPANY','PENDING'),('rejected-company-request','rejected-company','COMPANY','REJECTED')`);
    await f.db.exec(readFileSync(new URL('../supabase/migrations/20261025000000_company_registration_status.sql', import.meta.url), 'utf8'));
    const status = async (id = 'company') => (await f.db.query<any>('select registration_status from companies where id=$1', [id])).rows[0].registration_status;
    const reason = async (id = 'company') => (await f.rpc('registration_upload_company_block_reason', { p_company_id: id })).data;
    assert.equal(await status(), 'DONE', 'Existing Company queue approval is backfilled');
    assert.equal(await status('imported'), 'DONE', 'Existing pending company records become Registered during the one-time migration');
    assert.equal(await reason('imported'), null);
    assert.equal(await status('pending-company'), 'DONE');
    assert.equal(await status('rejected-company'), 'REJECTED');
    assert.equal((await f.db.query<any>(`select status from registration_submissions where id='pending-company-request'`)).rows[0].status, 'DONE');
    assert.equal((await f.db.query<any>(`select status from registration_submissions where id='rejected-company-request'`)).rows[0].status, 'REJECTED');
    assert.equal((await f.db.query<any>(`select status from registration_submissions where id='driver'`)).rows[0].status, 'PENDING', 'Asset requests are not included in the one-time conversion');
    await f.db.exec(`insert into companies(id) values('future-company')`);
    assert.equal(await status('future-company'), 'PENDING', 'New companies still start Pending');
    await f.db.exec(`update companies set registration_status='DONE' where id='imported'`);
    assert.equal(await reason('imported'), null, 'An imported registered company passes without a Company queue row');
    await f.db.exec(`update registration_submissions set company_id='imported' where id='driver'`);
    const importedAttempt = await f.begin();
    assert.ok(importedAttempt.job.id, 'Asset upload admission accepts explicitly registered companies without a Company form submission');
    await f.transition(importedAttempt, 'UPLOADING', { p_expected_rows: 1 });
    for (const next of ['PENDING', 'REJECTED', 'DONE']) {
      await f.db.query(`update registration_submissions set status=$1 where id='company-registration'`, [next]);
      assert.equal(await status(), next);
      assert.equal(await reason(), next === 'DONE' ? null : COMPANY_REGISTRATION_REQUIRED);
      await f.db.exec(`update companies set registration_status='DONE' where id='company'`);
      assert.equal(await status(), next, 'Stale master writes cannot override the queue');
    }
    await f.db.exec(`insert into registration_submissions(id,company_id,registration_type,status,submitted_at) values('new-company-request','company','COMPANY','PENDING',now()+interval '1 second')`);
    assert.equal(await status(), 'PENDING', 'The latest Company request controls approval');
    await f.db.exec(`delete from registration_submissions where id='new-company-request'`);
    assert.equal(await status(), 'DONE', 'Deleting a newer request restores the earlier queue result');
    await f.db.exec(`delete from registration_submissions where id='company-registration'`);
    assert.equal(await status(), 'PENDING', 'Deleting all queue approvals requires an explicit registration decision');
    assert.equal((await f.db.query<any>(`select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='companies' and column_name='status'`)).rows[0].count, 0, 'The activity column is removed');
    await assert.rejects(() => f.db.exec(`update companies set registration_status='REGISTERED' where id='imported'`), /check constraint/);
    assert.equal(normalizeCompanyRegistrationStatus('registered'), 'DONE');
    assert.equal(normalizeCompanyRegistrationStatus('pending'), 'PENDING');
    assert.throws(() => normalizeCompanyRegistrationStatus('ACTIVE'), /Registration status/);
  } finally { await f.db.close(); }
});

test('server and database block unregistered companies before upload and recheck approval before scheduler dispatch', async () => {
  const f = await fixture();
  const previous = { origin: process.env.SCHEDULER_PORTAL_URL, username: process.env.CARGOMOVE_USERNAME, password: process.env.CARGOMOVE_PASSWORD };
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test'; process.env.CARGOMOVE_USERNAME = 'fixture'; process.env.CARGOMOVE_PASSWORD = 'fixture';
  let uploads = 0, runs = 0;
  const handler = createRegistrationUploadsHandler({ adminClient: () => f.client as any,
    readSession: () => ({ id: actor, email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60000 }),
    uploadWorkbook: async (_credentials, _job, _buffer, before) => { await before(); uploads++; return { state: 'UPLOADED', message: 'Accepted' }; },
    verifyWorkbook: async () => ({ state: 'PROCESSING', readyForScheduler: true, message: 'Waiting', uploadId: 'fixture-upload' }),
    runScheduler: async (_req: any, res: any) => { runs++; return res.json({ status: 'trigger_requested' }); },
  });
  const call = async (body: any) => { const res = response(); await handler({ method: 'POST', body,
    headers: { origin: 'https://portal.example.test', 'x-cargomove-confirm': 'registration-upload' } }, res); return res; };
  try {
    for (const status of ['PENDING', 'REJECTED']) {
      await f.db.query(`update registration_submissions set status=$1 where id='company-registration'`, [status]);
      for (const type of ['DRIVER', 'TRAILER', 'VEHICLE']) {
        await f.db.query(`update registration_submissions set registration_type=$1 where id='driver'`, [type]);
        await assert.rejects(() => f.db.exec(`update registration_submissions set status='DONE' where id='driver'`), /Company registration status must be Registered/, 'A manual admin upsert cannot bypass registration approval');
        const blocked = await call({ action: 'start', submissionId: 'driver' });
        assert.equal(blocked.code, 409); assert.equal(blocked.body.error, COMPANY_REGISTRATION_REQUIRED);
      }
    }
    assert.equal(uploads, 0); assert.equal(runs, 0);
    assert.equal((await f.db.query<any>('select count(*)::int as count from registration_uploads')).rows[0].count, 0);
    await f.db.exec(`update registration_submissions set status='DONE' where id='company-registration'; update registration_submissions set registration_type='DRIVER' where id='driver'; delete from registration_submissions where id='company-registration'`);
    assert.equal((await call({ action: 'start', submissionId: 'driver' })).body.error, COMPANY_REGISTRATION_REQUIRED);
    await f.db.exec(`insert into registration_submissions(id,reference_no,registration_type,company_id,status) values('company-registration','CMREG400000','COMPANY','company','DONE')`);
    const preparing = await f.begin();
    await f.db.exec(`update registration_submissions set status='PENDING' where id='company-registration'`);
    const race = await f.rpc('transition_registration_upload', { p_id: preparing.job.id, p_token: preparing.token, p_state: 'UPLOADING', p_message: 'Uploading', p_expected_rows: 1 });
    assert.ok(race.error?.message.includes(COMPANY_REGISTRATION_REQUIRED), 'An approval change after preparation prevents upload dispatch');
    await f.transition(preparing, 'FAILED');
    await f.db.exec(`update registration_submissions set status='DONE' where id='company-registration'`);
    const started = await call({ action: 'start', submissionId: 'driver' });
    assert.equal(started.code, 200); assert.equal(uploads, 1);
    const jobId = started.body.submission.cargomove_upload.id;
    await f.db.exec(`update registration_submissions set status='PENDING' where id='company-registration'`);
    const paused = await call({ action: 'check', jobId });
    assert.equal(paused.body.blocked, true); assert.equal(paused.body.submission.status, 'PENDING'); assert.equal(runs, 0);
    assert.equal(paused.body.submission.cargomove_upload.state, 'UPLOADED', 'Accepted uploads wait safely and can resume after approval');
    const claim = await f.rpc('claim_registration_upload', { p_actor: actor, p_id: jobId });
    const blockedDispatch = await f.rpc('transition_registration_upload', { p_id: jobId, p_token: claim.data.token, p_state: 'DISPATCHING', p_message: 'Dispatch' });
    assert.ok(blockedDispatch.error?.message.includes(COMPANY_REGISTRATION_REQUIRED));
    await f.transition(claim.data, 'UPLOADED');
    await f.db.exec(`update registration_submissions set status='DONE' where id='company-registration'`);
    const resumed = await call({ action: 'check', jobId });
    assert.equal(resumed.body.submission.cargomove_upload.state, 'PROCESSING'); assert.equal(runs, 1); assert.equal(uploads, 1);
    assert.equal((await f.db.query<any>(`select has_function_privilege('authenticated','registration_upload_company_block_reason(text)','EXECUTE') as allowed`)).rows[0].allowed, false);
  } finally {
    for (const [key, value] of Object.entries({ SCHEDULER_PORTAL_URL: previous.origin, CARGOMOVE_USERNAME: previous.username, CARGOMOVE_PASSWORD: previous.password }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await f.db.close();
  }
});

test('database serializes attempts, protects summaries from stale writes, reverts failures and verifies counts before Done', async () => {
  const f = await fixture();
  try {
    const first = await f.begin();
    const repeated = await f.begin();
    assert.equal(repeated.existing, true); assert.equal(repeated.job.id, first.job.id);
    assert.match(first.job.filename, /^CMREG400001_DRIVER_[a-f0-9-]+\.xlsx$/);
    assert.equal(first.job.scheduler_id, scheduler);
    await f.db.query(`update cargomove_schedulers set display_name='Renamed processing task' where id=$1`, [scheduler]);
    await f.transition(first, 'UPLOADING', { p_expected_rows: 1 });
    await f.db.query(`update registration_submissions set status='DONE',cargomove_upload='{}'::jsonb where id='driver'`);
    const pending = (await f.db.query<any>(`select status,cargomove_upload from registration_submissions where id='driver'`)).rows[0];
    assert.equal(pending.status, 'PENDING'); assert.equal(pending.cargomove_upload.state, 'UPLOADING');
    await assert.rejects(() => f.db.exec(`update registration_submissions set data='{}' where id='driver'`), /before editing/);
    await assert.rejects(() => f.db.exec(`delete from registration_submissions where id='driver'`), /before deleting/);
    await f.transition(first, 'FAILED', { p_success_count: 0, p_error_count: 0 });
    const retry = await f.begin(); assert.notEqual(retry.job.id, first.job.id);
    await f.transition(retry, 'UPLOADING', { p_expected_rows: 1 }); await f.transition(retry, 'UPLOADED');
    const claim = await f.rpc('claim_registration_upload', { p_actor: actor, p_id: retry.job.id });
    const stale = await f.rpc('transition_registration_upload', { p_id: retry.job.id, p_token: retry.token, p_state: 'SUCCESS', p_message: 'wrong' });
    assert.ok(stale.error);
    const badCounts = await f.rpc('transition_registration_upload', { p_id: retry.job.id, p_token: claim.data.token, p_state: 'SUCCESS', p_message: 'wrong', p_success_count: 0, p_error_count: 0 });
    assert.ok(badCounts.error);
    await f.transition(claim.data, 'SUCCESS', { p_success_count: 1, p_error_count: 0 });
    const done = (await f.db.query<any>(`select status,export_filename,cargomove_upload from registration_submissions where id='driver'`)).rows[0];
    assert.equal(done.status, 'DONE'); assert.equal(done.export_filename, retry.job.filename);
    assert.equal(done.cargomove_upload.state, 'SUCCESS');
    assert.equal((await f.begin()).existing, true, 'A verified workbook is not uploaded again');
    assert.equal((await f.db.query<any>(`select has_function_privilege('authenticated','begin_registration_upload(uuid,text)','EXECUTE') as allowed`)).rows[0].allowed, false);
    assert.equal((await f.db.query<any>(`select has_table_privilege('authenticated','registration_uploads','SELECT') as allowed`)).rows[0].allowed, false);
    assert.ok((await f.rpc('begin_registration_upload', { p_actor: '10000000-0000-4000-8000-000000000002', p_submission_id: 'driver' })).error);
  } finally { await f.db.close(); }
});

test('expired dispatch leases become Unknown and partial successes cannot accidentally upload the entire file again', async () => {
  const f = await fixture();
  try {
    const first = await f.begin(); await f.transition(first, 'UPLOADING', { p_expected_rows: 2 });
    await f.db.query(`update registration_uploads set lease_until=now()-interval '1 second' where id=$1`, [first.job.id]);
    const claim = await f.rpc('claim_registration_upload', { p_actor: actor, p_id: first.job.id });
    assert.equal(claim.data.job.state, 'UNKNOWN'); assert.equal((await f.begin()).existing, true);
    await f.transition(claim.data, 'FAILED', { p_success_count: 1, p_error_count: 1 });
    assert.equal((await f.begin()).existing, true, 'Partial success requires reconciliation before a new attempt');
    assert.equal((await f.db.query<any>("select status from registration_submissions where id='driver'")).rows[0].status, 'PENDING');
    await f.db.query(`update registration_uploads set resolution_note='Fixture operator reconciled the successful record and corrected the remaining registration.' where id=$1`, [first.job.id]);
    assert.notEqual((await f.begin()).job.id, first.job.id, 'An audited operator reconciliation permits a deliberate new attempt');
  } finally { await f.db.close(); }
});

test('API uploads server-resolved Excel once, invokes the saved scheduler UUID, and finishes only after file verification', async () => {
  const f = await fixture();
  const previous = { origin: process.env.SCHEDULER_PORTAL_URL, username: process.env.CARGOMOVE_USERNAME, password: process.env.CARGOMOVE_PASSWORD };
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test'; process.env.CARGOMOVE_USERNAME = 'fixture'; process.env.CARGOMOVE_PASSWORD = 'fixture';
  let uploads = 0, runs = 0, checked = false, active = false;
  const handler = createRegistrationUploadsHandler({ adminClient: () => f.client as any,
    readSession: () => ({ id: actor, email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60000 }),
    uploadWorkbook: async (_credentials, job, buffer, before) => {
      uploads++; await before();
      const book = XLSX.read(buffer, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json<any[]>(book.Sheets.Sheet1, { header: 1 });
      assert.deepEqual(rows[0], [...EXCEL_TEMPLATES.DRIVER]); assert.equal(rows[1][0], '001234');
      assert.equal(job.filename.startsWith('CMREG400001_DRIVER_'), true);
      return { state: 'UPLOADED', message: 'Fixture accepted' };
    },
    verifyWorkbook: async () => checked ? { state: 'SUCCESS', message: 'Verified', uploadId: 'fixture-upload', successCount: 1, errorCount: 0 }
      : { state: 'PROCESSING', readyForScheduler: true, message: 'Waiting', uploadId: 'fixture-upload' },
    runScheduler: async (req: any, res: any) => {
      runs++; assert.equal(req.body.schedulerId, scheduler); assert.equal(req.headers['x-cargomove-confirm'], 'run-scheduler');
      assert.equal(active, false); active = true;
      const run = (await f.db.query<any>('select acquire_saved_cargomove_scheduler($1,$2) as result', [actor, scheduler])).rows[0].result;
      assert.ok(run.id); await f.db.query(`update cargomove_scheduler_runs set status='TRIGGER_REQUESTED' where id=$1`, [run.id]);
      return res.json({ status: 'trigger_requested', executionId: run.id });
    },
  });
  const call = async (body: any, headers = {}) => { const res = response(); await handler({ method: 'POST', body,
    headers: { origin: 'https://portal.example.test', 'x-cargomove-confirm': 'registration-upload', ...headers } }, res); return res; };
  try {
    assert.equal((await call({ action: 'start', submissionId: 'driver', rows: [] })).code, 400, 'Client-supplied Excel rows rejected');
    assert.equal((await call({ action: 'start', submissionId: 'driver' }, { origin: 'https://foreign.example.test' })).code, 403);
    const started = await call({ action: 'start', submissionId: 'driver' }); assert.equal(started.code, 200);
    assert.equal(started.body.submission.status, 'PENDING'); assert.ok(started.body.download.base64);
    assert.equal(JSON.stringify(started.body).includes('lease_token'), false);
    await call({ action: 'start', submissionId: 'driver' }); assert.equal(uploads, 1);
    const jobId = started.body.submission.cargomove_upload.id;
    const triggered = await call({ action: 'check', jobId }); assert.equal(triggered.body.submission.cargomove_upload.state, 'PROCESSING'); assert.equal(runs, 1);
    checked = true;
    const finished = await call({ action: 'check', jobId }); assert.equal(finished.body.submission.status, 'DONE');
    await call({ action: 'check', jobId }); assert.equal(runs, 1); assert.equal(uploads, 1);
  } finally {
    for (const [key, value] of Object.entries({ SCHEDULER_PORTAL_URL: previous.origin, CARGOMOVE_USERNAME: previous.username, CARGOMOVE_PASSWORD: previous.password }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await f.db.close();
  }
});

test('API failure paths keep each reference Pending and do not replay uploads or uncertain schedulers', async () => {
  const f = await fixture();
  const previous = { origin: process.env.SCHEDULER_PORTAL_URL, username: process.env.CARGOMOVE_USERNAME, password: process.env.CARGOMOVE_PASSWORD };
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test'; process.env.CARGOMOVE_USERNAME = 'fixture'; process.env.CARGOMOVE_PASSWORD = 'fixture';
  let uploads = 0, runs = 0, mode = 'failed', admin = true;
  const handler = createRegistrationUploadsHandler({ adminClient: () => f.client as any,
    readSession: () => admin ? { id: actor, email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60000 } : null,
    uploadWorkbook: async (_credentials, _job, _buffer, before) => {
      uploads++; await before();
      return mode === 'failed' ? { state: 'FAILED', message: 'Upload rejected.' } : { state: 'UPLOADED', message: 'Accepted' };
    },
    verifyWorkbook: async () => mode === 'partial' ? { state: 'FAILED', message: 'Partial processing: review the successful record before retrying.', successCount: 1, errorCount: 1 }
      : mode === 'unavailable' ? { state: 'UNKNOWN', message: 'Verification unavailable' }
      : { state: 'PROCESSING', readyForScheduler: true, message: 'Waiting', uploadId: 'fixture' },
    runScheduler: async (_req: any, res: any) => {
      runs++;
      return mode === 'cooldown' ? res.status(429).json({ status: 'failed', message: 'Please wait 30 seconds between scheduler requests.' })
        : res.status(502).json({ status: 'unknown', message: 'Uncertain response.' });
    },
  });
  const call = async (body: any, method = 'POST') => { const res = response(); await handler({ method, body,
    headers: { origin: 'https://portal.example.test', 'x-cargomove-confirm': 'registration-upload' } }, res); return res; };
  const start = () => call({ action: 'start', submissionId: 'driver' });
  try {
    admin = false; assert.equal((await start()).code, 401); admin = true;
    assert.equal((await call({}, 'GET')).code, 405); assert.equal(uploads, 0);
    const failed = await start(); assert.equal(failed.body.submission.status, 'PENDING');
    assert.equal(failed.body.submission.cargomove_upload.state, 'FAILED'); assert.equal(runs, 0);
    mode = 'cooldown';
    const accepted = await start(); const jobId = accepted.body.submission.cargomove_upload.id;
    assert.equal(uploads, 2);
    const cooldown = await call({ action: 'check', jobId });
    assert.equal(cooldown.body.submission.cargomove_upload.state, 'UPLOADED'); assert.equal(cooldown.body.nextCheckMs, 30000);
    mode = 'unknown';
    const uncertain = await call({ action: 'check', jobId }); assert.equal(uncertain.body.submission.cargomove_upload.state, 'UNKNOWN');
    await start(); assert.equal(uploads, 2, 'An uncertain job never starts another upload');
    const sent = runs;
    await call({ action: 'check', jobId }); assert.equal(runs, sent, 'An uncertain scheduler is never requested again');
    mode = 'unavailable';
    const unavailable = await call({ action: 'check', jobId }); assert.equal(unavailable.body.submission.status, 'PENDING');
    assert.equal(unavailable.body.submission.cargomove_upload.state, 'UNKNOWN');
    mode = 'partial';
    const partial = await call({ action: 'check', jobId }); assert.equal(partial.body.submission.status, 'PENDING');
    assert.equal(partial.body.submission.cargomove_upload.successCount, 1);
    await start(); assert.equal(uploads, 2, 'Partial processing must be reconciled before retrying');
  } finally {
    for (const [key, value] of Object.entries({ SCHEDULER_PORTAL_URL: previous.origin, CARGOMOVE_USERNAME: previous.username, CARGOMOVE_PASSWORD: previous.password }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await f.db.close();
  }
});

// Offline handler integration: replace the runtime before bundling, so local
// credentials are never loaded and database/mailbox clients cannot be created.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { emailTemplateRegistrationType, isEmailTemplateForRegistration } from '../src/utils/registrationEmailTemplates';

const types = ['COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE'] as const;

test('saved registration types restrict codes; explicit All overrides legacy inference', () => {
  for (const type of types) for (const target of types) {
    assert.equal(isEmailTemplateForRegistration({ id: 'custom', registration_type: type }, target), type === target);
  }
  for (const id of ['cargomove-welcome', 'rejection-other', 'acceptance-driver', 'custom']) {
    for (const target of types) assert.equal(isEmailTemplateForRegistration({ id, registration_type: null }, target), true);
  }
  assert.equal(emailTemplateRegistrationType({ id: 'acceptance-driver' }), 'DRIVER');
  assert.equal(emailTemplateRegistrationType({ id: 'rejection-other' }), 'COMPANY');
  assert.equal(emailTemplateRegistrationType({ id: 'custom' }), undefined);
});

test('migration backfills built-ins, preserves custom templates, and rejects invalid types', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table public.email_templates(id text primary key);
      insert into email_templates values ('cargomove-welcome'), ('rejection-other'),
        ('acceptance-driver'), ('acceptance-trailer'), ('acceptance-vehicle'), ('custom');`);
    const sql = await readFile(new URL('../supabase/migrations/20261026010000_email_template_registration_type.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    const result = await db.query<{ id: string; registration_type: string | null }>('select * from email_templates');
    const assignments = Object.fromEntries(result.rows.map(row => [row.id, row.registration_type]));
    assert.deepEqual(assignments, { 'cargomove-welcome': 'COMPANY', 'rejection-other': 'COMPANY', 'acceptance-driver': 'DRIVER', 'acceptance-trailer': 'TRAILER', 'acceptance-vehicle': 'VEHICLE', custom: null });
    await db.query("update email_templates set registration_type='VEHICLE' where id='custom'");
    await assert.rejects(db.query("update email_templates set registration_type='INVALID' where id='custom'"), /email_templates_registration_type_check/);
    await db.exec(sql);
    assert.equal((await db.query<{ registration_type: string }>("select registration_type from email_templates where id='custom'")).rows[0].registration_type, 'VEHICLE');
  } finally { await db.close(); }
});

test('template API persists types and preview/send handlers enforce actual selected columns', async () => {
  const runtimeKey = '__emailRegistrationFixture';
  const session = { id: 'admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60000 };
  const tables: Record<string, any[]> = {
    email_templates: [], port_configs: [{ id: 'port', display_name: 'Fixture port', active: true }],
    email_template_ports: [], gmail_connections: [],
    registration_submissions: [{ id: 'submission', registration_type: 'DRIVER', port_id: 'port', status: 'REJECTED', submitted_by_email: 'recipient@example.test', company_name: 'Fixture', data: {} }],
    external_user_access: [{ id: 'user', email: 'recipient@example.test', username: 'fixture', password: 'synthetic', status: 'REJECTED', rejection_reason: 'OTHER', rejection_detail: 'Fixture', email_status: 'READY' }],
  };
  const client = { from(table: string) {
    assert.ok(tables[table], `Unexpected table ${table}`);
    let columns = '*', single = false;
    const filters: Array<(row: any) => boolean> = [];
    const query = {
      select(value = '*') { columns = value; return this; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return this; },
      not(key: string, _operation: string, value: unknown) { filters.push(row => row[key] !== value); return this; },
      order() { return this; }, limit() { return this; },
      maybeSingle() { single = true; return this; }, single() { single = true; return this; },
      upsert(input: any) {
        for (const value of Array.isArray(input) ? input : [input]) {
          const existing = tables[table].find(row => value.id ? row.id === value.id : row.template_id === value.template_id && row.port_id === value.port_id);
          if (existing) Object.assign(existing, value); else tables[table].push({ ...value });
        }
        return this;
      },
      then(resolve: (result: any) => unknown, reject: (reason: any) => unknown) {
        const rows = tables[table].filter(row => filters.every(filter => filter(row))).map(row => columns === '*' ? { ...row }
          : Object.fromEntries(columns.split(',').map(column => [column, row[column]])));
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      export {default as templates} from './server-handlers/email/templates.ts';
      export {default as preview} from './server-handlers/email/preview.ts';
      export {default as send} from './server-handlers/email/send.ts';
      export {default as submissionPreview} from './server-handlers/email/submission-preview.ts';
      export {default as submissionSend} from './server-handlers/email/submission-send.ts';
      export {createPreviewToken,createSubmissionPreviewToken} from './server-handlers/_email.ts';
    ` }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'offline-runtime', setup(builder) {
      builder.onLoad({ filter: /[\\/]api[\\/]_runtime\.ts$/ }, () => ({ contents: `
        export const adminClient=()=>globalThis.${runtimeKey}.client;
        export const readSession=()=>globalThis.${runtimeKey}.session;
        export const requestBody=async request=>request.body;
        export const supabaseUrl=undefined,serviceRoleKey=undefined;
      `, loader: 'js' }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  const handlers = module.exports;
  const originalFetch = globalThis.fetch, originalSecret = process.env.SESSION_SECRET;
  (globalThis as any)[runtimeKey] = { client, session };
  process.env.SESSION_SECRET = 'offline-registration-email-test-key';
  globalThis.fetch = async () => { throw new Error('Network access forbidden in offline email tests'); };
  const call = async (handler: any, body: any, method = 'POST') => {
    const response = { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
    await handler({ method, body }, response);
    return response;
  };
  try {
    const template = { id: 'custom', name: 'Fixture rejection', trigger_status: 'REJECTED', registration_type: 'DRIVER', template_code: 'REJ099', rejection_reason: null, recipient_template: '{{user.email}}', subject_template: 'Registration outcome', body_template: '<p>Fixture</p>', attachments: [], port_ids: ['port'], active: true };
    assert.equal((await call(handlers.templates, { ...template, registration_type: 'INVALID' })).code, 400);
    assert.equal(tables.email_templates.length, 0);
    const created = await call(handlers.templates, template);
    assert.equal(created.code, 200); assert.equal(created.body.template.registration_type, 'DRIVER');
    assert.equal((await call(handlers.templates, {}, 'GET')).body.templates[0].registration_type, 'DRIVER');
    assert.equal((await call(handlers.templates, { ...template, registration_type: 'TRAILER' }, 'PUT')).body.template.registration_type, 'TRAILER');
    const { registration_type: _omitted, ...olderClient } = template;
    assert.equal((await call(handlers.templates, olderClient, 'PUT')).body.template.registration_type, 'TRAILER', 'An older client must preserve the saved assignment');
    assert.equal((await call(handlers.templates, { ...template, registration_type: null }, 'PUT')).body.template.registration_type, null);

    const saved = tables.email_templates[0];
    for (const target of ['DRIVER', 'TRAILER', 'VEHICLE']) {
      tables.registration_submissions[0].registration_type = target;
      for (const assigned of [...types, null]) {
        saved.registration_type = assigned;
        const result = await call(handlers.submissionPreview, { submissionId: 'submission', status: 'REJECTED', templateId: 'custom', portId: 'port' });
        assert.equal(result.code, assigned === null || assigned === target ? 200 : 409, `${assigned} code for ${target} preview`);
      }
    }
    tables.external_user_access[0].company_id = 'company';
    tables.registration_submissions.push({ id: 'company', company_id: 'company', registration_type: 'COMPANY', port_id: 'port', status: 'REJECTED' });
    for (const assigned of [...types, null]) {
      saved.registration_type = assigned;
      const result = await call(handlers.preview, { userId: 'user', templateId: 'custom', portId: 'port' });
      assert.equal(result.code, assigned === null || assigned === 'COMPANY' ? 200 : 409, `${assigned} code for Company preview`);
    }

    tables.registration_submissions[0].registration_type = 'DRIVER';
    saved.registration_type = 'TRAILER';
    const submissionToken = handlers.createSubmissionPreviewToken(session, 'submission', 'REJECTED', 'recipient@example.test', saved, 'port');
    const submissionSend = await call(handlers.submissionSend, { previewToken: submissionToken, recipient: 'recipient@example.test', subject: 'Fixture', body: '<p>Fixture</p>' });
    assert.equal(submissionSend.code, 409); assert.match(submissionSend.body.error, /registration type/);
    saved.registration_type = 'DRIVER';
    const matchingSend = await call(handlers.submissionSend, { previewToken: submissionToken, recipient: 'recipient@example.test', subject: 'Fixture', body: '<p>Fixture</p>' });
    assert.match(matchingSend.body.error, /Connect a Gmail account/, 'Matching type proceeds past type validation without sending');
    const userToken = handlers.createPreviewToken(session, tables.external_user_access[0], saved, 'port');
    const userSend = await call(handlers.send, { previewToken: userToken, recipient: 'recipient@example.test', subject: 'Fixture', body: '<p>Fixture</p>' });
    assert.equal(userSend.code, 409); assert.match(userSend.body.error, /company acceptance or rejection code/);
    saved.registration_type = 'COMPANY';
    const matchingUserSend = await call(handlers.send, { previewToken: userToken, recipient: 'recipient@example.test', subject: 'Fixture', body: '<p>Fixture</p>' });
    assert.match(matchingUserSend.body.error, /Connect a Gmail account/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalSecret;
    delete (globalThis as any)[runtimeKey];
  }
});

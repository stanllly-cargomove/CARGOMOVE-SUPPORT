// Offline send integration: replace the runtime before bundling so no local
// credentials, database connections or mailbox access can be used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { normalizeEmailRecipients } from '../shared/email-recipients';

test('recipient lists accept corrections and additions, normalize and deduplicate addresses', () => {
  assert.equal(normalizeEmailRecipients(' Corrected@Example.test ; other@example.test, CORRECTED@example.test '), 'corrected@example.test, other@example.test');
  assert.equal(normalizeEmailRecipients('new@example.test'), 'new@example.test');
  for (const value of [undefined, [], '', ' ', 'wrong', 'first@example.test;wrong', 'first@example.test,',
    ',first@example.test', 'first@example.test;;other@example.test', 'Name <first@example.test>',
    'first@example.test\r\nBcc: hidden@example.test', 'first@example.test\n', 'first@example.test\0',
    'first@example.test other@example.test', 'first..last@example.test', 'first@example.test:other@example.test',
    'first@example..test', `${'a'.repeat(65)}@example.test`, Array.from({ length: 50 }, (_, i) => `user${i}@example.test`).join(', ')]) {
    assert.throws(() => normalizeEmailRecipients(value), Error, `Must reject ${JSON.stringify(value)}`);
  }
});

test('admin preview sends use edited recipients in Gmail and the log, with send protections intact', async context => {
  const fixtureKey = '__welcomeRecipientsFixture';
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      export {default as send} from './server-handlers/email/send.ts';
      export {createPreviewToken,encryptRefreshToken} from './server-handlers/_email.ts';
    ` }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'offline-runtime', setup(builder) {
      builder.onLoad({ filter: /[\\/]api[\\/]_runtime\.ts$/ }, () => ({ contents: `
        export const adminClient=()=>globalThis.${fixtureKey}.client;
        export const readSession=()=>globalThis.${fixtureKey}.session;
        export const requestBody=async request=>request.body;
        export const supabaseUrl='https://database.example.test',serviceRoleKey='offline-service-key';
      `, loader: 'js' }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  const { send, createPreviewToken, encryptRefreshToken } = module.exports;
  const env = { SESSION_SECRET: 'offline-recipient-session', GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    GOOGLE_OAUTH_CLIENT_ID: 'offline-client', GOOGLE_OAUTH_CLIENT_SECRET: 'offline-secret' };
  const previous = Object.keys(env).map(key => process.env[key]);
  Object.assign(process.env, env);
  const session = { id: 'admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60_000 };
  const user = { id: 'user', email: 'mistyped@example.test', company_id: 'company', status: 'DONE', email_status: 'READY', email_sent: 0 };
  const template = { id: 'acceptance', name: 'Acceptance', active: true, trigger_status: 'DONE', registration_type: 'COMPANY',
    template_code: 'ACC001', version: 1, attachments: [] };
  const tables: Record<string, any[]> = {
    external_user_access: [user], email_templates: [template], email_logs: [],
    registration_submissions: [{ company_id: 'company', registration_type: 'COMPANY', status: 'DONE', port_id: 'port' }],
    email_template_ports: [{ template_id: template.id, port_id: 'port' }],
    gmail_connections: [{ id: 'system', email: 'sender@example.test', status: 'ACTIVE', ...encryptRefreshToken('offline-refresh') }],
  };
  const fixture = { session: session as any, client: { from(table: string) {
    assert.ok(table in tables, `Unexpected table ${table}`);
    const filters: Array<(row: any) => boolean> = [];
    let update: any, insert: any, single = false;
    const q = {
      select() { return this; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return this; },
      neq(key: string, value: unknown) { filters.push(row => row[key] !== value); return this; },
      update(value: any) { update = value; return this; },
      insert(value: any) { insert = value; return this; },
      maybeSingle() { single = true; return this; }, single() { single = true; return this; },
      then(resolve: any, reject: any) {
        const inserted = insert ? { id: `log-${tables[table].length}`, ...insert } : null;
        if (inserted) tables[table].push(inserted);
        const rows = inserted ? [inserted] : tables[table].filter(row => filters.every(filter => filter(row)));
        if (update) rows.forEach(row => Object.assign(row, update));
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      },
    };
    return q;
  } } };
  (globalThis as any)[fixtureKey] = fixture;
  const delivered: string[] = [];
  let failDelivery = false;
  context.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'offline-access' });
    assert.equal(String(url), 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'All external traffic is intercepted');
    delivered.push(Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8'));
    return failDelivery ? Response.json({ error: { status: 'OFFLINE_FAILURE' } }, { status: 503 }) : Response.json({ id: 'offline-message' });
  });
  const token = createPreviewToken(session, user, template, 'port');
  const call = async (recipient: unknown, previewToken = token) => {
    const res = { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
    await send({ method: 'POST', body: { previewToken, recipient, subject: 'Accepted', body: '<p>Welcome</p>' } }, res);
    return res;
  };
  try {
    fixture.session = null;
    assert.equal((await call('corrected@example.test')).code, 401);
    fixture.session = { ...session, type: 'USER' };
    assert.equal((await call('corrected@example.test')).code, 401);
    fixture.session = session;
    assert.equal((await call('corrected@example.test', `${token}invalid`)).code, 400);
    const expired = createPreviewToken(session, user, template, 'port');
    const now = Date.now();
    const timeMock = context.mock.method(Date, 'now', () => now + 16 * 60_000);
    assert.equal((await call('corrected@example.test', expired)).code, 400);
    timeMock.mock.restore();
    for (const invalid of ['', 'wrong', 'corrected@example.test;wrong', 'corrected@example.test\r\nBcc: other@example.test']) {
      assert.equal((await call(invalid)).code, 400);
    }
    assert.equal(user.email_status, 'READY'); assert.equal(tables.email_logs.length, 0); assert.equal(delivered.length, 0);

    template.version = 2;
    assert.equal((await call('corrected@example.test')).code, 409);
    template.version = 1;
    tables.registration_submissions[0].status = 'PENDING';
    assert.equal((await call('corrected@example.test')).code, 409);
    tables.registration_submissions[0].status = 'DONE';
    user.email_status = 'SENDING';
    assert.equal((await call('corrected@example.test')).code, 409);
    user.email_status = 'READY';
    assert.equal(delivered.length, 0);

    for (const [input, expected] of [
      ['Corrected@Example.test', 'corrected@example.test'],
      ['corrected@example.test; Added@example.test, CORRECTED@example.test', 'corrected@example.test, added@example.test'],
      ['added@example.test', 'added@example.test'],
    ]) {
      assert.equal((await call(input)).code, 200);
      assert.ok(delivered.at(-1)!.includes(`\r\nTo: ${expected}\r\n`));
      assert.ok(!delivered.at(-1)!.includes(user.email));
      assert.equal(tables.email_logs.at(-1).recipient, expected);
      assert.equal(tables.email_logs.at(-1).sent_by, session.id);
      assert.equal(tables.email_logs.at(-1).status, 'SENT');
      assert.equal(user.email_status, 'SENT'); assert.equal(user.email_sent, 1);
      assert.equal(user.email, 'mistyped@example.test', 'Sending must not change saved account details');
    }
    failDelivery = true;
    assert.equal((await call('retry@example.test')).code, 502);
    assert.equal(tables.email_logs.at(-1).recipient, 'retry@example.test');
    assert.equal(tables.email_logs.at(-1).status, 'FAILED');
    assert.equal(user.email_status, 'FAILED');
  } finally {
    Object.keys(env).forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    delete (globalThis as any)[fixtureKey];
  }
});

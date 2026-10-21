import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { autoMailConfiguration } from '../server-handlers/auto-mail/configuration.js';
import autoMailStatus from '../server-handlers/auto-mail/status.js';
import { READ_SCOPE, SEND_SCOPE, gmailReply, gmailConnect, gmailCallback, gmailThread, gmailThreads, oauthConfig, presentThread, rawReply, replyContext, singleAddress } from '../server-handlers/auto-mail/gmail.js';
import { decryptRefreshToken, encryptRefreshToken } from '../server-handlers/_email.js';
import { decryptMailboxToken, encryptMailboxToken } from '../server-handlers/auto-mail/token-encryption.js';
import { signSession } from '../api/_runtime.js';

const environment = { AUTO_MAIL_ENABLED: 'true', AUTO_MAIL_SUPABASE_URL: 'https://development.supabase.co', AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY: 'test-key', SUPABASE_URL: 'https://primary.supabase.co' };

test('dedicated Auto Mail credentials and encryption preserve registration email configuration', () => {
  const originalShared = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  const originalDedicated = process.env.AUTO_MAIL_TOKEN_ENCRYPTION_KEY;
  try {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    delete process.env.AUTO_MAIL_TOKEN_ENCRYPTION_KEY;
    const registration = encryptRefreshToken('registration-token');
    assert.equal(decryptMailboxToken(registration), 'registration-token', 'Existing Auto Mail tokens retain legacy-key compatibility');
    process.env.AUTO_MAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString('base64');
    const mailbox = encryptMailboxToken('auto-mail-token');
    assert.equal(decryptMailboxToken(mailbox), 'auto-mail-token');
    assert.equal(decryptRefreshToken(registration), 'registration-token', 'Registration token encryption is unchanged');
    assert.throws(() => decryptRefreshToken(mailbox));
    const config = oauthConfig({ AUTO_MAIL_APP_URL: 'https://portal.example.com', GOOGLE_OAUTH_CLIENT_ID: 'registration-client', GOOGLE_OAUTH_CLIENT_SECRET: 'registration-secret', AUTO_MAIL_GOOGLE_CLIENT_ID: 'mail-client', AUTO_MAIL_GOOGLE_CLIENT_SECRET: 'mail-secret' });
    assert.equal(config.clientId, 'mail-client'); assert.equal(config.clientSecret, 'mail-secret');
  } finally {
    if (originalShared === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY; else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalShared;
    if (originalDedicated === undefined) delete process.env.AUTO_MAIL_TOKEN_ENCRYPTION_KEY; else process.env.AUTO_MAIL_TOKEN_ENCRYPTION_KEY = originalDedicated;
  }
});

test('Auto Mail fails closed and never falls back to the main project', () => {
  assert.equal(autoMailConfiguration({}).ready, false);
  assert.equal(autoMailConfiguration({ ...environment, AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY: '' }).ready, false);
  assert.equal(autoMailConfiguration({ ...environment, VERCEL_ENV: 'production' }).ready, true);
  assert.equal(autoMailConfiguration({ ...environment, VERCEL_ENV: 'production', AUTO_MAIL_SUPABASE_URL: environment.SUPABASE_URL }).ready, false);
  assert.equal(autoMailConfiguration({ ...environment, SUPABASE_URL: '' }).ready, false);
  assert.equal(autoMailConfiguration({ ...environment, AUTO_MAIL_SUPABASE_URL: 'https://PRIMARY.supabase.co/' }).ready, false);
  assert.equal(autoMailConfiguration({ ...environment, VITE_SUPABASE_URL: environment.AUTO_MAIL_SUPABASE_URL }).ready, false);
  assert.equal(autoMailConfiguration(environment).ready, true);
});

function incomingThread() {
  return { id: 'thread1', messages: [{ id: 'incoming1', internalDate: '1720000000000', labelIds: ['INBOX'], payload: {
    mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'Customer <customer@example.com>' },
      { name: 'Reply-To', value: 'support@example.com' }, { name: 'Subject', value: 'Registration help' },
      { name: 'Message-ID', value: '<customer-message@example.com>' }],
    parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Please help with registration.').toString('base64url') } },
      { mimeType: 'text/plain', filename: 'private.txt', body: { data: Buffer.from('ATTACHMENT CONTENT').toString('base64url') } }],
  } }] };
}

test('thread parsing excludes attachments and replies honor Reply-To with correct MIME headers', () => {
  const thread = incomingThread();
  const view = presentThread(thread, 'operator@example.com');
  assert.equal(view.messages[0].body, 'Please help with registration.');
  assert.equal(view.messages[0].attachments, true);
  const context = replyContext(thread, 'operator@example.com', 'incoming1');
  assert.equal(context.recipient, 'support@example.com');
  const raw = Buffer.from(rawReply('operator@example.com', context, 'Hello, here is the answer. 你好', '10000000-0000-4000-8000-000000000001'), 'base64url').toString();
  assert.match(raw, /To: support@example.com\r\n/);
  assert.match(raw, /In-Reply-To: <customer-message@example.com>/);
  assert.match(raw, /References: <customer-message@example.com>/);
  assert.match(raw, /Content-Type: text\/plain; charset=UTF-8/);
  assert.equal(Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString(), 'Hello, here is the answer. 你好');
  assert.throws(() => singleAddress('customer@example.com\r\nBcc: attacker@example.com'));
  assert.throws(() => singleAddress('one@example.com, two@example.com'));
  assert.throws(() => replyContext(thread, 'operator@example.com', 'stale-message'), /changed/);
  thread.messages[0].labelIds = ['SENT'];
  assert.throws(() => replyContext(thread, 'operator@example.com', 'incoming1'), /outgoing/);
  assert.throws(() => oauthConfig({ AUTO_MAIL_APP_URL: 'https://portal.example.com/extra', GOOGLE_OAUTH_CLIENT_ID: 'x', GOOGLE_OAUTH_CLIENT_SECRET: 'y' }));
});

test('Gmail handlers require an administrator', async () => {
  for (const handler of [gmailConnect, gmailCallback, gmailThread, gmailThreads, gmailReply]) {
    let status = 200;
    const response = { setHeader() {}, status(code: number) { status = code; return this; }, json() {} };
    await handler({ method: 'GET', headers: {} }, response);
    assert.equal(status, 401);
  }
});

test('manual sending enforces origin, freshness and durable duplicate protection without real Gmail calls', async () => {
  const overrides = { ...environment, VITE_SUPABASE_URL: 'https://primary.supabase.co', VERCEL_ENV: 'development',
    AUTO_MAIL_APP_URL: 'http://localhost:3000', GOOGLE_OAUTH_CLIENT_ID: 'test-client', GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret',
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), SESSION_SECRET: 'test-session-secret' };
  const before = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const realFetch = globalThis.fetch;
  const version = '10000000-0000-4000-8000-000000000001';
  const mailbox = '10000000-0000-4000-8000-000000000002';
  let sendCount = 0;
  let claimCount = 0;
  let deliveryClaimed = false;
  let failSend = false;
  const calls: string[] = [];
  const connection = { id: 'system', version, mailbox_id: mailbox, email: 'operator@example.com', scopes: [READ_SCOPE, SEND_SCOPE], ...encryptRefreshToken('fake-refresh-token') };
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input); calls.push(url);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    assert.ok(!url.includes('primary.supabase.co'), 'Never access the main database');
    if (url.includes('/gmail_connections')) return json(connection);
    if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'fake-access' });
    if (url.includes('/threads/thread1')) return json(incomingThread());
    if (url.includes('/rpc/claim_manual_reply')) {
      claimCount++;
      if (deliveryClaimed) return json({ code: '23505', message: 'duplicate' }, 409);
      deliveryClaimed = true; return json('10000000-0000-4000-8000-000000000003');
    }
    if (url.endsWith('/messages/send')) {
      sendCount++;
      const sent = JSON.parse(init.body);
      assert.equal(sent.threadId, 'thread1');
      assert.match(Buffer.from(sent.raw, 'base64url').toString(), /To: support@example.com/);
      if (failSend) throw new Error('Simulated timeout after Gmail may have accepted');
      return json({ id: 'sent1', threadId: 'thread1' });
    }
    if (url.includes('/reply_deliveries')) return new Response(null, { status: 204 });
    throw new Error('Unexpected test URL');
  }) as typeof fetch;
  const cookie = 'cargomove_session=' + signSession({ id: version, email: 'admin@example.com', type: 'ADMIN', exp: Date.now() + 60000 });
  const body = { threadId: 'thread1', body: 'A manually written reply.', recipient: 'support@example.com', sourceMessageId: 'incoming1', connectionVersion: version, requestId: '10000000-0000-4000-8000-000000000003' };
  const invoke = async (changes = {}, origin = 'http://localhost:3000') => {
    let code = 200; let result: any;
    const response = { setHeader() {}, status(value: number) { code = value; return this; }, json(value: any) { result = value; } };
    await gmailReply({ method: 'POST', headers: { cookie, origin }, body: { ...body, ...changes } }, response);
    return { code, result };
  };
  try {
    assert.equal((await invoke({}, 'https://attacker.example.com')).code, 403);
    assert.equal(calls.length, 0);
    assert.equal((await invoke({ sourceMessageId: 'stale' })).code, 409);
    assert.equal(claimCount, 0);
    assert.equal((await invoke({ recipient: 'attacker@example.com' })).code, 409);
    assert.equal(claimCount, 0);
    assert.equal((await invoke()).result.status, 'SENT');
    assert.equal(sendCount, 1);
    assert.equal((await invoke()).code, 409);
    assert.equal(sendCount, 1, 'A second request cannot send again');
    deliveryClaimed = false; failSend = true;
    const uncertain = await invoke();
    assert.equal(uncertain.code, 409);
    assert.match(uncertain.result.error, /uncertain/);
    assert.equal((await invoke()).code, 409);
    assert.equal(sendCount, 2, 'An uncertain send cannot be sent a second time');
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(overrides)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
});

test('Gmail migration protects secrets, enforces one delivery per source and detects reconnects', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    for (const file of ['20261022000000_foundation.sql', '20261022010000_gmail_manual_replies.sql']) await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/' + file, import.meta.url), 'utf8'));
    const actor = '10000000-0000-4000-8000-000000000001';
    const mailbox = '10000000-0000-4000-8000-000000000002';
    const version = '10000000-0000-4000-8000-000000000003';
    await db.query("insert into auto_mail.mailboxes(id,email) values($1,'operator@example.com')", [mailbox]);
    await db.query("insert into auto_mail.gmail_connections(id,mailbox_id,google_subject,email,refresh_token_ciphertext,token_iv,token_auth_tag,scopes,connected_by,version) values('system',$1,'google-user','operator@example.com','cipher','iv','tag','{}',$2,$3)", [mailbox, actor, version]);
    const data = { id: '10000000-0000-4000-8000-000000000004', mailbox_id: mailbox, gmail_thread_id: 'thread1', source_message_id: 'message1', connection_version: version, recipient: 'customer@example.com', body_text: 'Reply', requested_by: actor };
    const claim = (delivery: any) => db.query('select auto_mail.claim_manual_reply($1::jsonb)', [JSON.stringify(delivery)]);
    await claim(data);
    await assert.rejects(() => claim({ ...data, id: '10000000-0000-4000-8000-000000000005' }), /unique constraint/);
    await db.exec("update auto_mail.reply_deliveries set status='UNKNOWN'");
    await assert.rejects(() => claim({ ...data, id: '10000000-0000-4000-8000-000000000006' }), /unique constraint/);
    await assert.rejects(() => claim({ ...data, connection_version: mailbox, source_message_id: 'new-message' }), /CONNECTION_CHANGED/);
    for (const table of ['gmail_connections', 'oauth_states', 'reply_deliveries']) {
      const result = await db.query<any>(`select has_table_privilege('authenticated','auto_mail.${table}','SELECT') as allowed`);
      assert.equal(result.rows[0].allowed, false);
    }
    assert.equal((await db.query<any>("select has_function_privilege('anon','auto_mail.claim_manual_reply(jsonb)','EXECUTE') as allowed")).rows[0].allowed, false);
    assert.equal((await db.query<any>('select schema_version from auto_mail.settings')).rows[0].schema_version, 2);
    assert.equal((await db.query<any>('select reply_mode from auto_mail.settings')).rows[0].reply_mode, 'DRAFT_ONLY');
  } finally { await db.close(); }
});

test('Gmail OAuth binds single-use state to the administrator, checks scopes and stores only encrypted tokens', async () => {
  const overrides = { ...environment, VITE_SUPABASE_URL: 'https://primary.supabase.co', VERCEL_ENV: 'development', AUTO_MAIL_APP_URL: 'http://localhost:3000',
    GOOGLE_OAUTH_CLIENT_ID: 'test-client', GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret', GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'), SESSION_SECRET: 'test-session-secret' };
  const before = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const realFetch = globalThis.fetch;
  const actor = '10000000-0000-4000-8000-000000000001';
  let state: any = null;
  let connection: any = null;
  let exchangeCount = 0;
  let scopeGranted = true;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    assert.notEqual(url.hostname, 'primary.supabase.co');
    if (url.pathname.endsWith('/oauth_states')) {
      if (init.method === 'POST') { state = JSON.parse(init.body); return new Response(null, { status: 201 }); }
      if (url.searchParams.has('expires_at') && !url.searchParams.has('state_hash')) return new Response(null, { status: 204 });
      assert.equal(init.method, 'DELETE');
      assert.equal(url.searchParams.get('admin_id'), 'eq.' + actor);
      assert.match(url.searchParams.get('expires_at')!, /^gt\./);
      const found = state && url.searchParams.get('state_hash') === 'eq.' + state.state_hash ? { pkce_verifier: state.pkce_verifier } : null;
      state = null;
      return json(found);
    }
    if (url.hostname === 'oauth2.googleapis.com') {
      exchangeCount++;
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('redirect_uri'), 'http://localhost:3000/api/auto-mail/callback');
      assert.ok(params.get('code_verifier'));
      return json({ access_token: 'fake-access', refresh_token: 'plaintext-refresh-must-not-be-stored', scope: scopeGranted ? `${READ_SCOPE} ${SEND_SCOPE} openid email` : SEND_SCOPE });
    }
    if (url.hostname === 'openidconnect.googleapis.com') return json({ sub: 'verified-google-user', email: 'operator@example.com', email_verified: true });
    if (url.pathname.endsWith('/profile')) return json({ emailAddress: 'operator@example.com' });
    if (url.pathname.endsWith('/mailboxes')) return json({ id: '10000000-0000-4000-8000-000000000002' });
    if (url.pathname.endsWith('/gmail_connections')) { connection = JSON.parse(init.body); return new Response(null, { status: 201 }); }
    throw new Error('Unexpected OAuth test request');
  }) as typeof fetch;
  const cookie = 'cargomove_session=' + signSession({ id: actor, email: 'admin@example.com', type: 'ADMIN', exp: Date.now() + 60000 });
  const invoke = async (handler: any, method: string, query = {}) => {
    const response = { code: 200, value: null as any, setHeader() {}, status(code: number) { this.code = code; return this; },
      json(data: any) { this.value = data; }, send(data: any) { this.value = data; }, redirect(code: number, url: string) { this.code = code; this.value = url; } };
    await handler({ method, query, headers: { cookie, origin: 'http://localhost:3000' } }, response);
    return response;
  };
  try {
    const start = await invoke(gmailConnect, 'POST');
    const auth = new URL(start.value.authorizationUrl);
    assert.equal(auth.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auto-mail/callback');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(state.admin_id, actor);
    assert.notEqual(state.state_hash, auth.searchParams.get('state'));
    const query = { state: auth.searchParams.get('state'), code: 'fake-code' };
    const callback = await invoke(gmailCallback, 'GET', query);
    assert.equal(callback.code, 302);
    assert.equal(callback.value, 'http://localhost:3000/admin?auto_mail=connected');
    assert.equal(connection.email, 'operator@example.com');
    assert.ok(connection.refresh_token_ciphertext);
    assert.ok(!JSON.stringify(connection).includes('plaintext-refresh-must-not-be-stored'));
    assert.equal((await invoke(gmailCallback, 'GET', query)).code, 400);
    assert.equal(exchangeCount, 1, 'Callback replay cannot exchange code again');
    scopeGranted = false;
    const nextStart = await invoke(gmailConnect, 'POST');
    const nextAuth = new URL(nextStart.value.authorizationUrl);
    assert.equal((await invoke(gmailCallback, 'GET', { state: nextAuth.searchParams.get('state'), code: 'new-code' })).code, 400);
    assert.equal(exchangeCount, 2);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(overrides)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
});

test('status requires an administrator before checking configuration', async () => {
  let status = 200;
  let body: any;
  const response = { setHeader() {}, status(code: number) { status = code; return this; }, json(value: any) { body = value; } };
  await autoMailStatus({ method: 'GET', headers: {} }, response);
  assert.equal(status, 401);
  assert.deepEqual(body, { error: 'Authentication required.' });
});

test('isolated migration preserves existing data and restricts browser roles', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table public.existing_data(value text); insert into public.existing_data values ('preserve me');");
    await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/20261022000000_foundation.sql', import.meta.url), 'utf8'));
    const scalar = async (sql: string) => Object.values((await db.query<any>(sql)).rows[0])[0];
    assert.equal(await scalar('select value from public.existing_data'), 'preserve me');
    assert.equal(await scalar('select reply_mode from auto_mail.settings'), 'DRAFT_ONLY');
    assert.equal(await scalar("select count(*)::int from pg_tables where schemaname='auto_mail' and rowsecurity"), 7);
    assert.equal(await scalar("select has_schema_privilege('authenticated','auto_mail','USAGE')"), false);
    assert.equal(await scalar("select has_table_privilege('anon','auto_mail.knowledge_articles','SELECT')"), false);
    assert.equal(await scalar("select has_table_privilege('service_role','auto_mail.settings','SELECT')"), true);
    await assert.rejects(() => db.exec("update auto_mail.settings set reply_mode='AUTO_SEND'"), /check constraint/);
    await assert.rejects(() => db.exec("insert into auto_mail.knowledge_articles(title,content,status,created_by) values('Answer','Content','APPROVED',gen_random_uuid())"), /check constraint/);
  } finally { await db.close(); }
});

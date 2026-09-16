// Optional isolated PostgreSQL validation; does not access any live database.
// Install @electric-sql/pglite into /tmp, then supply its module path via PGLITE_MODULE.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
let checks = 0;
async function rejects(sql, params, code) {
  await assert.rejects(db.query(sql, params), e => e.code === code); checks++;
}
try {
  // Model the existing prerequisites without modifying/applying old migrations.
  const baseline = await readFile('supabase/migrations/20260913000000_init.sql', 'utf8');
  const email = await readFile('supabase/migrations/20260913000050_email_workflow.sql', 'utf8');
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema public to anon, authenticated, service_role;
    ${baseline.match(/create or replace function public.touch_updated_at\(\)[\s\S]*?\$\$;/)[0]}
    ${email.match(/create table if not exists public.gmail_connections \([\s\S]*?\n\);/)[0]}
    grant all on public.gmail_connections to service_role;`);
  for (const path of ['20260916000000_support_foundation.sql', '20260916000010_gmail_inbox_sync.sql']) {
    await db.exec(await readFile(`supabase/migrations/${path}`, 'utf8')); checks++;
  }
  const user = randomUUID();
  await db.query('insert into auth.users(id) values ($1)', [user]);
  await db.exec(`insert into public.gmail_connections(id,google_subject,email,refresh_token_ciphertext,token_iv,token_auth_tag)
    values ('system','subject1','support@example.com','test','test','test');`);
  const version = (await db.query("select connected_at::text from public.gmail_connections where id='system'")).rows[0].connected_at;
  await db.exec('set role service_role');
  const token = randomUUID();
  const s = (await db.query('select acquire_gmail_sync($1,$2,$3) as state', ['subject1', version, token])).rows[0].state;
  await rejects('select acquire_gmail_sync($1,$2,$3)', ['subject1', version, randomUUID()], 'P0001');
  s.page_staged = true; s.pending_threads = ['thread1']; s.pending_history_id = '100';
  await db.query('select checkpoint_gmail_sync($1,$2)', [token, s]);
  const messages = [{ gmail_message_id: 'm1', gmail_thread_id: 'thread1', direction: 'INBOUND', in_inbox: true,
    sender_name: 'Customer', sender_email: 'customer@example.com', recipient_email: 'support@example.com',
    subject: 'Booking question', body_text: 'Please help', body_html: null, sent_at: '2026-09-15T10:00:00Z' }];
  assert.equal((await db.query('select persist_gmail_thread($1,$2,$3) as count', [token, 'thread1', messages])).rows[0].count, 1); checks++;
  assert.equal((await db.query('select persist_gmail_thread($1,$2,$3) as count', [token, 'thread1', messages])).rows[0].count, 0); checks++;
  assert.equal((await db.query('select count(*)::int as n from support_cases')).rows[0].n, 1); checks++;
  assert.equal((await db.query('select count(*)::int as n from support_messages')).rows[0].n, 1); checks++;
  const cid = (await db.query('select id from support_cases')).rows[0].id;
  await db.query("update support_cases set status='RESOLVED',resolved_at=now() where id=$1", [cid]);
  await db.query('select persist_gmail_thread($1,$2,$3)', [token, 'thread1', messages]);
  assert.equal((await db.query('select status from support_cases where id=$1', [cid])).rows[0].status, 'RESOLVED'); checks++;
  messages.push({ ...messages[0], gmail_message_id: 'm2', sent_at: '2026-09-16T10:00:00Z' });
  assert.equal((await db.query('select persist_gmail_thread($1,$2,$3) as n', [token, 'thread1', messages])).rows[0].n, 1); checks++;
  assert.equal((await db.query('select status from support_cases where id=$1', [cid])).rows[0].status, 'NEW'); checks++;
  await db.query("update support_cases set status='ESCALATED' where id=$1", [cid]);
  messages.push({ ...messages[0], gmail_message_id: 'm3', sent_at: '2026-09-16T11:00:00Z' });
  await db.query('select persist_gmail_thread($1,$2,$3)', [token, 'thread1', messages]);
  assert.equal((await db.query('select status from support_cases where id=$1', [cid])).rows[0].status, 'ESCALATED'); checks++;
  const outbound = { ...messages[0], gmail_message_id: 'outbound1', direction: 'OUTBOUND', in_inbox: false,
    sender_email: 'support@example.com', recipient_email: 'customer@example.com', sent_at: '2026-09-16T12:00:00Z' };
  await db.query('select persist_gmail_thread($1,$2,$3)', [token, 'thread1', [outbound]]);
  assert.equal((await db.query("select case_id from support_messages where gmail_message_id='outbound1'")).rows[0].case_id, cid); checks++;
  await rejects("insert into support_cases(gmail_thread_id,customer_email) values ('thread1','other@example.com')", [], '23505');
  await rejects("insert into support_cases(customer_email,status) values ('other@example.com','BAD')", [], '23514');
  await rejects("insert into support_cases(customer_email,ai_confidence) values ('other@example.com',1.1)", [], '23514');
  await rejects("insert into support_messages(case_id,gmail_message_id,gmail_thread_id,direction,sender_email,recipient_email,sent_at) values ($1,'bad','wrong','INBOUND','a@example.com','b@example.com',now())", [cid], '23503');
  const other = (await db.query("insert into support_cases(customer_email) values ('other@example.com') returning id")).rows[0].id;
  const mid = (await db.query("select id from support_messages where gmail_message_id='m1'")).rows[0].id;
  await rejects("insert into ai_interactions(case_id,message_id,model,prompt_version,confidence) values ($1,$2,'test','v1',0.9)", [other, mid], '23503');
  await rejects("insert into support_learning_suggestions(suggested_problem,suggested_resolution,status) values ('p','r','APPROVED')", [], '23514');
  await db.exec('insert into support_automation_rules default values');
  const rule = (await db.query('select auto_send_enabled,always_require_human,active from support_automation_rules')).rows[0];
  assert.deepEqual(rule, { auto_send_enabled: false, always_require_human: true, active: false }); checks++;
  await rejects('update support_automation_rules set auto_send_enabled=true', [], '23514');
  await rejects('update support_automation_rules set always_require_human=false', [], '23514');
  await rejects('insert into support_automation_rules default values', [], '23505');
  await rejects("insert into support_knowledge(knowledge_code,title,problem,resolution,requires_port_verification,human_review_required) values ('KB1','t','p','r',true,false)", [], '23514');
  // Atomic rollback: a valid first new message must not survive a bad second one.
  await rejects('select persist_gmail_thread($1,$2,$3)', [token, 'thread1', [
    { ...messages[0], gmail_message_id: 'atomic1' }, { ...messages[0], gmail_message_id: 'atomic2', direction: 'BAD' },
  ]], '23514');
  assert.equal((await db.query("select count(*)::int as n from support_messages where gmail_message_id='atomic1'")).rows[0].n, 0); checks++;
  // Reconnection fences the old worker, even when the Google subject is the same.
  await db.exec("update gmail_connections set connected_at=connected_at + interval '1 second'");
  await rejects('select persist_gmail_thread($1,$2,$3)', [token, 'thread1', messages], 'P0001');
  await rejects('select checkpoint_gmail_sync($1,$2)', [token, s], 'P0001');
  await db.query('select release_gmail_sync($1)', [token]);
  const v2 = (await db.query("select connected_at::text from gmail_connections where id='system'")).rows[0].connected_at;
  const token2 = randomUUID();
  await db.query('select acquire_gmail_sync($1,$2,$3)', ['subject1', v2, token2]); checks++;
  await db.query('select release_gmail_sync($1)', [token]);
  assert.equal((await db.query('select lease_token from gmail_sync_state')).rows[0].lease_token, token2); checks++;
  await db.query('select release_gmail_sync($1)', [token2]);
  // Browser roles cannot read tables or execute privileged functions.
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const table of ['support_cases', 'support_messages', 'support_knowledge', 'ai_interactions', 'support_learning_suggestions', 'support_automation_rules', 'gmail_sync_state']) {
      await rejects(`select * from public.${table}`, [], '42501');
    }
    await rejects('select acquire_gmail_sync($1,$2,$3)', ['subject1', v2, randomUUID()], '42501');
    await rejects('select checkpoint_gmail_sync($1,$2)', [token2, s], '42501');
    await rejects('select persist_gmail_thread($1,$2,$3)', [token2, 'thread1', messages], '42501');
    await rejects('select release_gmail_sync($1)', [token2], '42501');
    await rejects('select tracked_gmail_threads($1)', [null], '42501');
    await db.exec('reset role');
  }
  assert.equal((await db.query("select count(*)::int as n from pg_class where relname in ('support_cases','support_messages','support_knowledge','ai_interactions','support_learning_suggestions','support_automation_rules','gmail_sync_state') and relrowsecurity")).rows[0].n, 7); checks++;
  // Exercise the actual authenticated API handler with mocked Gmail HTTP and
  // PostgREST HTTP backed by these real migrated PostgreSQL functions.
  process.env.VERCEL = '1';
  process.env.SESSION_SECRET = 'isolated-session-secret';
  process.env.SUPABASE_URL = 'https://isolated-db.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-service-key';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'isolated-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'isolated-client-secret';
  process.env.APP_URL = 'https://isolated-app.invalid';
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const { encryptRefreshToken } = await import('../server-handlers/_email.ts');
  const { signSession } = await import('../api/_runtime.ts');
  const { default: syncHandler } = await import('../server-handlers/gmail/sync.ts');
  const encrypted = encryptRefreshToken('isolated-refresh-token');
  await db.query(`update gmail_connections set refresh_token_ciphertext=$1,token_iv=$2,token_auth_tag=$3,scopes=$4`,
    [encrypted.refresh_token_ciphertext, encrypted.token_iv, encrypted.token_auth_tag,
      ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send']]);
  await db.exec(`update gmail_sync_state set mode='HISTORY',history_id='100',page_staged=false,
    pending_threads='{}',page_token=null,bootstrap_history_id=null; set role service_role;`);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === 'oauth2.googleapis.com') {
      assert.equal(new URLSearchParams(init.body).get('refresh_token'), 'isolated-refresh-token');
      return Response.json({ access_token: 'isolated-access-token' });
    }
    if (u.hostname === 'gmail.googleapis.com') {
      assert.equal(init.headers.Authorization, 'Bearer isolated-access-token');
      if (u.pathname.endsWith('/history')) return Response.json(u.searchParams.get('startHistoryId') === '100'
        ? { historyId: '500', history: [{ messagesAdded: [{ message: { id: 'api-message', threadId: 'thread1' } }] }] }
        : { historyId: '500', history: [] });
      if (u.pathname.endsWith('/threads/thread1')) return Response.json({ id: 'thread1', messages: [{
        id: 'api-message', threadId: 'thread1', labelIds: ['INBOX'], internalDate: '1789556400000',
        payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Customer <customer@example.com>' }],
          body: { data: Buffer.from('API integration message').toString('base64url') } },
      }] });
      throw new Error('Unexpected Gmail request');
    }
    assert.equal(u.hostname, 'isolated-db.invalid');
    assert.equal(init.headers.apikey, 'isolated-service-key');
    if (u.pathname === '/rest/v1/gmail_connections') return Response.json((await db.query('select * from gmail_connections')).rows);
    if (u.pathname === '/rest/v1/support_cases') return Response.json((await db.query('select id from support_cases where gmail_thread_id=$1',
      [u.searchParams.get('gmail_thread_id').slice(3)])).rows);
    const fn = u.pathname.split('/').pop();
    const signatures = {
      acquire_gmail_sync: ['p_subject', 'p_version', 'p_token'],
      checkpoint_gmail_sync: ['p_token', 'p_state', 'p_release'],
      persist_gmail_thread: ['p_token', 'p_thread_id', 'p_messages'],
      release_gmail_sync: ['p_token'], tracked_gmail_threads: ['p_after'],
    };
    const fields = signatures[fn]; assert.ok(fields, 'RPC must be explicitly allowed');
    const args = JSON.parse(init.body);
    try {
      const result = await db.query(`select public.${fn}(${fields.map((_, i) => '$' + (i + 1)).join(',')}) as result`, fields.map(f => args[f]));
      return Response.json(result.rows[0].result ?? null);
    } catch (e) { return Response.json({ message: e.message, code: e.code }, { status: 400 }); }
  };
  try {
    const cookie = 'cargomove_session=' + signSession({ id: user, email: 'support@example.com', type: 'ADMIN', exp: Date.now() + 60000 });
    for (const expected of [1, 0]) {
      let status = 200; let result;
      const response = { setHeader() {}, status(n) { status = n; return this; }, json(value) { result = value; return this; } };
      await syncHandler({ method: 'POST', headers: { cookie }, query: {} }, response);
      assert.equal(status, 200, JSON.stringify(result)); assert.equal(result.inserted_messages, expected); checks++;
    }
    assert.equal((await db.query("select count(*)::int as n from support_messages where gmail_message_id='api-message'")).rows[0].n, 1); checks++;
    assert.equal((await db.query('select history_id from gmail_sync_state')).rows[0].history_id, '500'); checks++;
    await db.exec("update gmail_connections set scopes=array['https://www.googleapis.com/auth/gmail.send']");
    let deniedStatus; let deniedBody;
    const denied = { setHeader() {}, status(n) { deniedStatus = n; return this; }, json(value) { deniedBody = value; return this; } };
    await syncHandler({ method: 'POST', headers: { cookie }, query: {} }, denied);
    assert.equal(deniedStatus, 409); assert.equal(deniedBody.code, 'GMAIL_RECONSENT_REQUIRED'); checks++;
    assert.equal((await db.query('select history_id from gmail_sync_state')).rows[0].history_id, '500'); checks++;
  } finally { globalThis.fetch = originalFetch; await db.exec('reset role'); }
  console.log(`${checks} isolated PostgreSQL migration and security checks passed.`);
} finally { await db.close(); }

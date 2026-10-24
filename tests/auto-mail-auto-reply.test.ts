import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { autoReplyBlock, deliverAutoReply, validateAutoReplyEvaluation, evaluateAutoReply } from '../server-handlers/auto-mail/auto-reply.js';
import { presentThread, rawReply, replyContext, SEND_SCOPE } from '../server-handlers/auto-mail/gmail.js';
import { threadSignature } from '../server-handlers/auto-mail/thread-signature.js';
import { incomingSettings, runIncomingAi } from '../server-handlers/auto-mail/incoming-ai.js';
import { encryptRefreshToken } from '../server-handlers/_email.js';
import { signSession } from '../api/_runtime.js';

const actor = '10000000-0000-4000-8000-000000000001', mailbox = '10000000-0000-4000-8000-000000000002', connectionVersion = '10000000-0000-4000-8000-000000000003', token = '10000000-0000-4000-8000-000000000004';
const rawThread = () => ({ id: 'thread', messages: [{ id: 'incoming', internalDate: String(Date.now()), labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'customer@example.com' }, { name: 'To', value: 'support@example.com' }, { name: 'Subject', value: 'Registration' }, { name: 'Message-ID', value: '<source@example.com>' }], body: { data: Buffer.from('What documents are needed?').toString('base64url') } } }] });

test('auto-reply blocks loops and attachments; evaluation rejects invalid confidence and automatic MIME is identified', () => {
  assert.equal(autoReplyBlock(rawThread(), 'support@example.com'), null);
  for (const [name, value] of [['Auto-Submitted', 'auto-replied'], ['Precedence', 'bulk'], ['List-Id', 'list.example.com'], ['Return-Path', '<>'], ['From', 'no-reply@example.com'], ['X-Auto-Response-Suppress', 'All']]) {
    const raw = rawThread(); raw.messages[0].payload.headers = raw.messages[0].payload.headers.filter(header => header.name !== name).concat({ name, value });
    assert.ok(autoReplyBlock(raw, 'support@example.com'), name);
  }
  const attachment: any = rawThread(); attachment.messages[0].payload.parts = [{ filename: 'document.pdf', mimeType: 'application/pdf', body: { attachmentId: 'file' } }];
  assert.ok(autoReplyBlock(attachment, 'support@example.com'));
  const spam = rawThread(); spam.messages[0].labelIds = ['SPAM']; assert.ok(autoReplyBlock(spam, 'support@example.com'));
  for (const confidence of [-1, 1.1, NaN, '0.99']) assert.throws(() => validateAutoReplyEvaluation({ grounded: true, needs_human: false, confidence, reason: 'Supported' }));
  const mime = Buffer.from(rawReply('support@example.com', replyContext(rawThread(), 'support@example.com', 'incoming'), 'Answer', crypto.randomUUID(), true), 'base64url').toString();
  assert.match(mime, /Auto-Submitted: auto-replied/); assert.match(mime, /In-Reply-To: <source@example.com>/);
});

test('controlled auto-reply SQL defaults off, audits policy, revalidates sources and serializes unique/rate-limited delivery without live databases', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
    for (const file of ['20261022000000_foundation.sql', '20261022010000_gmail_manual_replies.sql', '20261022020000_knowledge_base.sql', '20261022030000_ai_reply_drafts.sql', '20261022040000_reviewed_learning.sql', '20261022050000_agent_settings.sql', '20261023010000_incoming_ai_workflow.sql', '20261024000000_controlled_auto_replies.sql']) await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/' + file, import.meta.url), 'utf8'));
    const scalar = async (sql: string, params: unknown[] = []) => Object.values((await db.query<any>(sql, params)).rows[0])[0] as any;
    assert.equal(await scalar("select auto_reply_enabled from auto_mail.incoming_agent_settings"), false);
    await db.query("insert into auto_mail.mailboxes(id,email) values($1,'support@example.com')", [mailbox]);
    await db.query("insert into auto_mail.gmail_connections(id,mailbox_id,google_subject,email,refresh_token_ciphertext,token_iv,token_auth_tag,scopes,connected_by,version) values('system',$1,'google','support@example.com','cipher','iv','tag',$4,$2,$3)", [mailbox, actor, connectionVersion, [SEND_SCOPE]]);
    await scalar("select auto_mail.save_agent_settings(true,'test-model',array['test-model'],0,$1)", [actor]);
    let settings = await scalar("select auto_mail.save_incoming_settings(true,'ALL',1,$1)", [actor]);
    assert.equal(settings.auto_reply_enabled, false, 'Legacy save calls cannot enable sending');
    await assert.rejects(() => scalar("select auto_mail.save_incoming_settings(true,'ALL',$1,$2,true,0.5,5)", [settings.version, actor]), /AGENT_INVALID/);
    const save = async (enabled: boolean, limit = 5) => { settings = await scalar("select auto_mail.save_incoming_settings(true,'ALL',$1,$2,$3,0.95,$4)", [settings.version, actor, enabled, limit]); };
    await save(true);
    const savedPolicy = await scalar('select settings from auto_mail.incoming_agent_events order by created_at desc limit 1'); assert.equal(savedPolicy.auto_reply_enabled, true);
    await scalar('select auto_mail.begin_incoming_tick($1)', [token]);
    let article = await scalar('select auto_mail.save_knowledge_article(null,null,$1,$2)', [JSON.stringify({ title: 'Registration', summary: '', content: 'Supply the certificate.', category: 'Registration', port: 'ALL', keywords: ['registration'] }), actor]);
    article = await scalar("select auto_mail.review_knowledge_article($1,1,'APPROVE',$2)", [article.id, actor]);
    let sequence = 0;
    const makeJob = async (changes: any = {}, threadId?: string) => {
      const source = 'incoming-' + ++sequence;
      const job = await scalar('select auto_mail.claim_incoming_message($1,$2)', [token, JSON.stringify({ source_message_id: source, gmail_thread_id: threadId || 'thread-' + source, conversation_hash: 'hash', subject: 'Registration' })]);
      const result = { status: 'DRAFT_READY', source_received_at: new Date(Date.now()+1000).toISOString(), classification: { category: 'SUPPORT_REQUEST', confidence: 0.99, kb_match: 'STRONG', source_ids: [article.id] }, model: 'test-model', draft_kind: 'KB', sources: [{ id: article.id, version: article.version, title: article.title, port: 'ALL', content: article.content }], cited_source_ids: [article.id], body_text: article.content, review_notes: 'Checked', auto_send_eligible: true, auto_reply_evaluation: { grounded: true, needs_human: false, confidence: 0.99, reason: 'Supported.' }, ...changes };
      await scalar('select auto_mail.finish_incoming_message($1,$2,$3)', [token, job.id, JSON.stringify(result)]);
      const delivery = { id: crypto.randomUUID(), mailbox_id: mailbox, connection_version: connectionVersion, gmail_thread_id: job.gmail_thread_id, source_message_id: job.source_message_id, conversation_hash: 'hash', recipient: 'customer@example.com', body_text: result.body_text, requested_by: actor, ai_draft_id: job.id };
      return { job, delivery };
    };
    const claim = (item: Awaited<ReturnType<typeof makeJob>>, override = item.delivery) => scalar('select auto_mail.claim_auto_reply($1,$2,$3)', [token, item.job.id, JSON.stringify(override)]);
    for (const changes of [{ source_received_at: '2020-01-01T00:00:00Z' }, { source_received_at: null }, { auto_send_eligible: false }, { classification: { category: 'NEW_TECHNICAL_ISSUE', confidence: 1, kb_match: 'STRONG' } }, { classification: { confidence: 1, kb_match: 'STRONG' } }, { classification: { category: 'SUPPORT_REQUEST', confidence: 0.94, kb_match: 'STRONG' } }, { auto_reply_evaluation: { grounded: false, needs_human: false, confidence: 1 } }, { auto_reply_evaluation: { grounded: true, needs_human: true, confidence: 1 } }, { auto_reply_evaluation: { grounded: true, needs_human: false, confidence: 0.94 } }]) assert.equal(await claim(await makeJob(changes)), null);
    const changed = await makeJob(); await save(false); assert.equal(await claim(changed), null, 'OFF blocks work already generated'); await save(true);
    const stale = await makeJob();
    await scalar("select auto_mail.review_knowledge_article($1,$2,'DRAFT',$3)", [article.id, article.version, actor]);
    await assert.rejects(() => claim(stale), /AI_SOURCES_CHANGED/);
    article = await scalar("select auto_mail.review_knowledge_article($1,$2,'APPROVE',$3)", [article.id, article.version + 1, actor]);
    const ready = await makeJob();
    await assert.rejects(() => claim(ready, { ...ready.delivery, body_text: 'Invented answer' }), /AI_DRAFT_CHANGED/);
    assert.equal(await claim(ready), ready.delivery.id); assert.equal(await claim(ready), null, 'Duplicate ticks cannot resend');
    assert.equal(await scalar('select status from auto_mail.reply_deliveries where id=$1', [ready.delivery.id]), 'SENDING');
    await scalar('select auto_mail.finish_auto_reply($1,$2,null)', [ready.job.id, ready.delivery.id]);
    assert.equal(await scalar('select auto_reply_state from auto_mail.incoming_ai_jobs where id=$1', [ready.job.id]), 'UNKNOWN');
    assert.equal(await claim(ready), null, 'Uncertain outcomes cannot retry');
    assert.equal(await claim(await makeJob({}, ready.job.gmail_thread_id)), null, 'One automatic reply per thread in 24 hours');
    await save(true, 1); assert.equal(await claim(await makeJob()), null, 'All claims, including uncertain delivery, count toward the hourly cap');
    await save(true, 5);
    const manual = await makeJob(); await scalar('select auto_mail.claim_manual_reply($1)', [JSON.stringify(manual.delivery)]); await assert.rejects(() => claim(manual), /AI_ALREADY_REPLIED/);
    const sent = await makeJob(); assert.equal(await claim(sent), sent.delivery.id);
    await scalar("select auto_mail.finish_auto_reply($1,$2,'gmail-confirmed')", [sent.job.id, sent.delivery.id]);
    await scalar('select auto_mail.finish_auto_reply($1,$2,null)', [sent.job.id, sent.delivery.id]);
    assert.equal(await scalar('select auto_reply_state from auto_mail.incoming_ai_jobs where id=$1', [sent.job.id]), 'SENT', 'Confirmed acceptance cannot be downgraded');
    await db.query("update auto_mail.incoming_ai_jobs set auto_reply_state='SENDING' where id=$1",[sent.job.id]);
    await scalar('select auto_mail.finish_auto_reply($1,$2,null)',[sent.job.id,sent.delivery.id]);
    assert.equal(await scalar('select status from auto_mail.reply_deliveries where id=$1',[sent.delivery.id]),'SENT','A saved receipt survives an interrupted audit update');
    assert.equal(await scalar('select count(*)::int from auto_mail.learning_suggestions'), 0, 'Unedited automatic answers never publish or nominate their own learning');
    assert.equal(await scalar("select has_function_privilege('authenticated','auto_mail.claim_auto_reply(uuid,uuid,jsonb)','EXECUTE')"), false);
    assert.equal(await scalar("select has_function_privilege('service_role','auto_mail.finish_incoming_draft_internal(uuid,uuid,jsonb)','EXECUTE')"), false);
    assert.equal(await scalar("select reply_mode from auto_mail.settings"), 'DRAFT_ONLY', 'Global automation policy is preserved; auto-reply has separate explicit admission');
  } finally { await db.close(); }
});

const testEnv = { AUTO_MAIL_ENABLED: 'true', AUTO_MAIL_SUPABASE_URL: 'https://auto-reply-test.supabase.co', AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY: 'fake-key', SUPABASE_URL: 'https://primary.supabase.co', AUTO_MAIL_APP_URL: 'http://localhost:3000', AUTO_MAIL_AI_ENABLED: 'true', OPENAI_API_KEY: 'fake-key', AUTO_MAIL_AI_MODEL: 'test-model', AUTO_MAIL_AUTO_REPLY_ENABLED: 'true', SESSION_SECRET: 'auto-reply-test-session' };
function setEnv() {
  const previous = Object.fromEntries(Object.keys(testEnv).map(key => [key, process.env[key]])); Object.assign(process.env, testEnv);
  return () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}

test('automatic delivery rechecks policy/context and never retries ambiguous Gmail sends or receipt failures', async () => {
  const restore = setEnv(), originalFetch = globalThis.fetch;
  try {
    for (const mode of ['success', 'server-off', 'toggle-off', 'policy-changed', 'model-changed', 'reconnected', 'thread-changed', 'source-withdrawn', 'claim-refused', 'uncertain', 'receipt-failed'] as const) {
      let sends = 0, claims = 0; const finishes: any[] = [];
      const original = rawThread(); const signature = threadSignature(presentThread(original, 'support@example.com'));
      const job = { id: token, actor_id: actor, settings_version: 3, connection_version: connectionVersion, gmail_thread_id: 'thread', source_message_id: 'incoming', conversation_hash: signature };
      const policy = { enabled: true, auto_reply_enabled: mode !== 'toggle-off', version: mode === 'policy-changed' ? 4 : 3 };
      const client: any = {
        from(table: string) {
          const data = table === 'incoming_agent_settings' ? policy : table === 'agent_settings' ? { enabled: true, model: mode === 'model-changed' ? 'other-model' : 'test-model', enabled_models: ['test-model', 'other-model'] } : { mailbox_id: mailbox, version: mode === 'reconnected' ? 'other-version' : connectionVersion, email: 'support@example.com', scopes: [SEND_SCOPE] };
          const builder: any = { select() { return builder; }, eq() { return builder; }, maybeSingle: async () => ({ data, error: null }) }; return builder;
        },
        async rpc(name: string, body: any) {
          if (name === 'validate_ai_draft') return mode === 'source-withdrawn' ? { error: { message: 'AI_SOURCES_CHANGED' } } : { data: { draft_kind: 'KB', body_text: 'Supply the certificate.' } };
          if (name === 'claim_auto_reply') { claims++; assert.equal(body.p_delivery.ai_draft_id, token); return { data: mode === 'claim-refused' ? null : body.p_delivery.id }; }
          if (name === 'finish_auto_reply') { finishes.push(body); return { data: null }; }
          if (name === 'finish_manual_reply') return mode === 'receipt-failed' ? { error: { code: 'XX000' } } : { data: { learning_queued: false } };
          throw new Error('Unexpected RPC ' + name);
        },
      };
      process.env.AUTO_MAIL_AUTO_REPLY_ENABLED = mode === 'server-off' ? 'false' : 'true';
      globalThis.fetch = (async (input: any, init: any = {}) => {
        const url = new URL(String(input)); assert.equal(url.hostname, 'gmail.googleapis.com');
        if (url.pathname.endsWith('/threads/thread')) {
          const raw = structuredClone(original); if (mode === 'thread-changed') raw.messages[0].payload.body.data = Buffer.from('Changed question').toString('base64url');
          return new Response(JSON.stringify(raw));
        }
        assert.ok(url.pathname.endsWith('/messages/send')); sends++;
        const body = JSON.parse(init.body); assert.equal(body.threadId, 'thread');
        const mime = Buffer.from(body.raw, 'base64url').toString(); assert.match(mime, /To: customer@example.com/); assert.match(mime, /Auto-Submitted: auto-replied/);
        if (mode === 'uncertain') throw new Error('Network lost after possible acceptance');
        return new Response(JSON.stringify({ id: 'gmail-confirmed' }));
      }) as typeof fetch;
      await deliverAutoReply(client, token, job, 'fake-access', 'test-model');
      const delivered = ['success', 'uncertain', 'receipt-failed'].includes(mode);
      assert.equal(sends, delivered ? 1 : 0, mode);
      assert.ok(claims <= 1); assert.equal(finishes.length, delivered ? 1 : 0);
      if (delivered) assert.equal(finishes[0].p_gmail_id, mode === 'uncertain' ? null : 'gmail-confirmed');
    }
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('answer evaluation uses bounded structured outputs and fails closed on refusals, incomplete or invalid answers', async () => {
  const restore = setEnv(), originalFetch = globalThis.fetch;
  try {
    for (const mode of ['valid', 'refusal', 'incomplete', 'invalid'] as const) {
      let calls = 0;
      globalThis.fetch = (async (input: any, init: any) => {
        assert.equal(new URL(String(input)).hostname, 'api.openai.com'); calls++;
        const body = JSON.parse(init.body); assert.equal(body.store, false); assert.equal(body.tools, undefined); assert.equal(body.text.format.strict, true); assert.ok(body.max_output_tokens <= 800);
        return new Response(JSON.stringify({ status: mode === 'incomplete' ? 'incomplete' : 'completed', output: [{ type: 'message', content: mode === 'refusal' ? [{ type: 'refusal' }] : [{ type: 'output_text', text: JSON.stringify({ grounded: true, needs_human: false, confidence: mode === 'invalid' ? 2 : 0.99, reason: 'Verified against excerpts.' }) }] }] }));
      }) as typeof fetch;
      const evaluate = () => evaluateAutoReply({ ready: true, key: 'fake-key', model: 'test-model', message: '' }, presentThread(rawThread(), 'support@example.com'), [], 'Supply the certificate.');
      if (mode === 'valid') assert.equal((await evaluate()).confidence, 0.99); else await assert.rejects(evaluate);
      assert.equal(calls, 1, 'No automatic provider retries');
    }
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('auto-reply settings enforce ADMIN/origin/thresholds and allow OFF even when the model or server switch is disabled', async () => {
  const restore = setEnv(), originalFetch = globalThis.fetch;
  const cookie = 'cargomove_session=' + signSession({ id: actor, email: 'admin@example.com', type: 'ADMIN', exp: Date.now() + 60000 });
  let writes = 0, enabled = true;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input)); assert.equal(url.hostname, 'auto-reply-test.supabase.co');
    if (url.pathname.endsWith('/incoming_agent_settings')) return new Response(JSON.stringify({ enabled: true, auto_reply_enabled: enabled, version: 2 }));
    if (url.pathname.endsWith('/agent_settings')) return new Response(JSON.stringify({ enabled: true, model: 'test-model', enabled_models: ['test-model'], version: 1 }));
    assert.ok(url.pathname.endsWith('/save_incoming_settings')); writes++;
    const body = JSON.parse(init.body); assert.equal(body.p_actor, actor); enabled = body.p_auto_reply_enabled;
    return new Response(JSON.stringify({ enabled: true, auto_reply_enabled: enabled, version: 3 }));
  }) as typeof fetch;
  const invoke = async (body: any, headers: any = { cookie, origin: 'http://localhost:3000' }) => {
    const res = { code: 200, value: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(value: any) { this.value = value; } };
    await incomingSettings({ method: 'POST', headers, body }, res); return res;
  };
  const body = { enabled: true, auto_reply_enabled: true, scope: 'ALL', min_confidence: 0.95, max_auto_replies_per_hour: 5, version: 2 };
  try {
    assert.equal((await invoke(body, {})).code, 401);
    assert.equal((await invoke(body, { cookie, origin: 'https://evil.test' })).code, 403);
    for (const invalid of [{ min_confidence: 0.79 }, { min_confidence: 1.1 }, { min_confidence: '0.95' }, { max_auto_replies_per_hour: 0 }, { max_auto_replies_per_hour: 21 }, { enabled: false }]) assert.equal((await invoke({ ...body, ...invalid })).code, 400);
    assert.equal(writes, 0);
    assert.equal((await invoke(body)).code, 200); assert.equal(writes, 1);
    process.env.AUTO_MAIL_AUTO_REPLY_ENABLED = 'false'; process.env.AUTO_MAIL_AI_ENABLED = 'false';
    assert.equal((await invoke({ ...body, auto_reply_enabled: false })).code, 200, 'OFF does not require a working AI provider'); assert.equal(enabled, false);
    assert.equal((await invoke(body)).code, 409); assert.equal(writes, 2);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('incoming worker only sends verified high-confidence KB answers and respects OFF after generation', async () => {
  const restore = setEnv(), originalFetch = globalThis.fetch;
  const extra = { GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'), GOOGLE_OAUTH_CLIENT_ID: 'fake-client', GOOGLE_OAUTH_CLIENT_SECRET: 'fake-secret', AUTO_MAIL_SCHEDULER_SECRET: 'x'.repeat(40) };
  const previous = Object.fromEntries(Object.keys(extra).map(key => [key, process.env[key]])); Object.assign(process.env, extra);
  try {
    for (const mode of ['verified', 'low-answer-confidence', 'off-after-generation'] as const) {
      const raw = rawThread(), source = { id: actor, title: 'Registration', version: 2, content: 'Supply the certificate.', port: 'ALL' };
      const job = { id: token, actor_id: actor, mailbox_id: mailbox, settings_version: 2, connection_version: connectionVersion, gmail_thread_id: 'thread', source_message_id: 'incoming', conversation_hash: threadSignature(presentThread(raw, 'support@example.com')) };
      let sends = 0, evaluations = 0, finished: any = null, claims = 0;
      globalThis.fetch = (async (input: any, init: any = {}) => {
        const url = new URL(String(input)); const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : {};
        const json = (value: any) => new Response(JSON.stringify(value));
        assert.ok(['auto-reply-test.supabase.co', 'oauth2.googleapis.com', 'gmail.googleapis.com', 'api.openai.com'].includes(url.hostname), 'No main DB or unmocked service');
        if (url.pathname.endsWith('/agent_settings')) return json({ enabled: true, model: 'test-model', enabled_models: ['test-model'], version: 1 });
        if (url.pathname.endsWith('/begin_incoming_tick')) return json({ enabled_at: new Date(Date.now() - 60000).toISOString(), scope: 'ALL', cursor: null, connection_version: connectionVersion, auto_reply_enabled: true, auto_reply_enabled_at: new Date(Date.now()-60000).toISOString(), min_confidence: 0.95 });
        if (url.pathname.endsWith('/gmail_connections')) return json({ id: 'system', mailbox_id: mailbox, version: connectionVersion, email: 'support@example.com', scopes: [SEND_SCOPE], ...encryptRefreshToken('fake-refresh') });
        if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: 'fake-access' });
        if (url.pathname.endsWith('/gmail/v1/users/me/messages')) return json({ messages: [{ id: 'incoming', threadId: 'thread' }] });
        if (url.pathname.endsWith('/gmail/v1/users/me/threads/thread')) return json(raw);
        if (url.pathname.endsWith('/incoming_ai_jobs')) return json([]);
        if (url.pathname.endsWith('/claim_incoming_message')) return json(job);
        if (url.pathname.endsWith('/match_knowledge_articles')) return json([source]);
        if (url.pathname.endsWith('/acknowledgement_body')) return json('Please share more details.');
        if (url.hostname === 'api.openai.com') {
          const name = body.text.format.name;
          let value: any;
          if (name === 'incoming_mail_classification') value = { category: 'SUPPORT_REQUEST', confidence: 0.99, language: 'en', kb_match: 'STRONG', source_ids: [source.id], reason: 'Direct KB answer.' };
          else if (name === 'auto_reply_evaluation') { evaluations++; value = { grounded: true, needs_human: false, confidence: mode === 'low-answer-confidence' ? 0.94 : 0.99, reason: 'Answer checked.' }; }
          else value = { status: 'READY', body_text: source.content, review_notes: '', cited_source_ids: [source.id] };
          return json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
        }
        if (url.pathname.endsWith('/finish_incoming_message')) { finished = body.p_result; return json(token); }
        if (url.pathname.endsWith('/incoming_agent_settings')) return json({ enabled: true, auto_reply_enabled: mode !== 'off-after-generation', version: 2 });
        if (url.pathname.endsWith('/validate_ai_draft')) return json({ draft_kind: 'KB', body_text: source.content });
        if (url.pathname.endsWith('/claim_auto_reply')) { claims++; return json(body.p_delivery.id); }
        if (url.pathname.endsWith('/messages/send')) { sends++; return json({ id: 'gmail-test' }); }
        if (url.pathname.endsWith('/finish_manual_reply')) return json({ learning_queued: false });
        if (url.pathname.endsWith('/finish_auto_reply') || url.pathname.endsWith('/end_incoming_tick')) return json(null);
        throw new Error('Unexpected request ' + url.pathname);
      }) as typeof fetch;
      const res = { code: 200, value: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(value: any) { this.value = value; } };
      await runIncomingAi({ method: 'POST', headers: { authorization: 'Bearer ' + extra.AUTO_MAIL_SCHEDULER_SECRET } }, res);
      assert.equal(res.code, 200, JSON.stringify(res.value)); assert.equal(res.value.processed, 1); assert.equal(evaluations, 1);
      assert.equal(finished.auto_send_eligible, mode !== 'low-answer-confidence');
      assert.equal(sends, mode === 'verified' ? 1 : 0); assert.equal(claims, sends);
    }
  } finally {
    globalThis.fetch = originalFetch; restore();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

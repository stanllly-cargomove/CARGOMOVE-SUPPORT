import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { signSession } from '../api/_runtime.js';
import { knowledgeDetail, knowledgeList, knowledgeMatches, knowledgeReview, knowledgeSave, validateArticle } from '../server-handlers/auto-mail/knowledge.js';

const actor = '10000000-0000-4000-8000-000000000001';
const article = { title: 'Registration documents', content: 'Provide the company registration certificate and authorization letter.', summary: 'Documents required to register a haulier.', category: 'Registration', port: 'ALL', keywords: ['registration', 'documents'] };

test('KB validates reusable answers and does not accept approval or actor fields from article input', () => {
  assert.deepEqual(validateArticle({ ...article, status: 'APPROVED', created_by: 'attacker' }), article);
  assert.throws(() => validateArticle({ ...article, title: '   ' }));
  assert.throws(() => validateArticle({ ...article, content: 'x'.repeat(30001) }));
  assert.throws(() => validateArticle({ ...article, keywords: ['x'.repeat(61)] }));
  assert.throws(() => validateArticle({ ...article, keywords: 'not-an-array' }));
});

test('KB keeps versioned history, resets approvals on edit and retrieves only approved articles', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table public.untouched(value text); insert into public.untouched values('original');");
    for (const file of ['20261022000000_foundation.sql', '20261022010000_gmail_manual_replies.sql', '20261022020000_knowledge_base.sql']) {
      await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/' + file, import.meta.url), 'utf8'));
    }
    const scalar = async (sql: string, params: unknown[] = []) => Object.values((await db.query<any>(sql, params)).rows[0])[0] as any;
    const save = (id: string | null, version: number | null, payload = article) => scalar('select auto_mail.save_knowledge_article($1,$2,$3::jsonb,$4)', [id, version, JSON.stringify(payload), actor]);
    const review = (id: string, version: number, action: string) => scalar('select auto_mail.review_knowledge_article($1,$2,$3,$4)', [id, version, action, actor]);
    const match = (query: string) => scalar('select auto_mail.match_knowledge_articles($1)', [query]);
    await db.exec('set role service_role');
    const created = await save(null, null);
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.version, 1);
    assert.deepEqual(await match('What registration documents are required?'), []);
    const approved = await review(created.id, 1, 'APPROVE');
    assert.equal(approved.approved_by, actor);
    const sources = await match('What registration documents are required?');
    assert.equal(sources[0].id, created.id);
    assert.equal(sources[0].version, 2);
    assert.equal(sources[0].content, article.content);
    assert.deepEqual(await match('the and for please help'), []);
    assert.deepEqual(await match('unrelatedbanana'), []);
    assert.equal((await scalar("select auto_mail.list_knowledge_articles('certificate','APPROVED',0)")).total, 1);
    await assert.rejects(() => save(created.id, 1), /KB_CONFLICT/);
    const edited = await save(created.id, 2, { ...article, content: 'Updated approved procedure.' });
    assert.equal(edited.status, 'DRAFT');
    assert.equal(edited.approved_by, null);
    assert.deepEqual(await match('registration'), []);
    await review(created.id, 3, 'APPROVE');
    await review(created.id, 4, 'ARCHIVE');
    assert.deepEqual(await match('registration'), []);
    await assert.rejects(() => review(created.id, 5, 'APPROVE'), /KB_INVALID_TRANSITION/);
    const revisions = (await db.query<any>('select version,action,snapshot from auto_mail.knowledge_revisions order by version')).rows;
    assert.deepEqual(revisions.map(row => row.action), ['CREATED', 'APPROVED', 'EDITED', 'APPROVED', 'ARCHIVED']);
    assert.equal(revisions[1].snapshot.content, article.content);
    assert.equal(revisions[2].snapshot.content, 'Updated approved procedure.');
    await assert.rejects(() => db.exec("update auto_mail.knowledge_articles set status='APPROVED'"), /permission denied/);
    await assert.rejects(() => db.exec('delete from auto_mail.knowledge_revisions'), /permission denied/);
    await db.exec('reset role');
    assert.equal(await scalar('select value from public.untouched'), 'original');
    assert.equal(await scalar('select schema_version from auto_mail.settings'), 3);
    assert.equal(await scalar("select has_function_privilege('authenticated','auto_mail.save_knowledge_article(uuid,integer,jsonb,uuid)','EXECUTE')"), false);
    assert.equal(await scalar("select has_table_privilege('anon','auto_mail.knowledge_revisions','SELECT')"), false);
    const restored = await review(created.id, 5, 'DRAFT');
    assert.equal(restored.status, 'DRAFT');
  } finally { await db.close(); }
});

test('KB endpoints require ADMIN and same origin, use session actor and never call Gmail or AI', async () => {
  const overrides = { AUTO_MAIL_ENABLED: 'true', AUTO_MAIL_SUPABASE_URL: 'https://kb-development.supabase.co', AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY: 'test-key', SUPABASE_URL: 'https://main.supabase.co', VITE_SUPABASE_URL: 'https://main.supabase.co', VERCEL_ENV: 'development', AUTO_MAIL_APP_URL: 'http://localhost:3000', SESSION_SECRET: 'kb-test-session', GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '' };
  const originals = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const realFetch = globalThis.fetch;
  let requests = 0;
  let conflict = false;
  globalThis.fetch = (async (input: any, init: any) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.hostname, 'kb-development.supabase.co');
    const payload = JSON.parse(init.body);
    assert.equal(new Headers(init.headers).get('content-profile'), 'auto_mail');
    let response: any;
    if (url.pathname.endsWith('/save_knowledge_article')) {
      assert.equal(payload.p_actor, actor);
      assert.equal(payload.p_article.status, undefined);
      response = conflict ? { message: 'KB_CONFLICT' } : { ...article, id: actor, version: 1, status: 'DRAFT' };
    } else if (url.pathname.endsWith('/match_knowledge_articles')) response = [];
    else if (url.pathname.endsWith('/list_knowledge_articles')) response = { articles: [], total: 0 };
    else throw new Error('Unexpected request');
    return new Response(JSON.stringify(response), { status: conflict ? 400 : 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const cookie = 'cargomove_session=' + signSession({ id: actor, email: 'admin@example.com', type: 'ADMIN', exp: Date.now() + 60000 });
  const invoke = async (handler: any, method: string, body: any = {}, headers: any = { cookie, origin: 'http://localhost:3000' }) => {
    const response = { code: 200, value: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(value: any) { this.value = value; } };
    await handler({ method, headers, body, query: {} }, response);
    return response;
  };
  try {
    for (const handler of [knowledgeList, knowledgeDetail, knowledgeSave, knowledgeReview, knowledgeMatches]) assert.equal((await invoke(handler, 'POST', {}, {})).code, 401);
    assert.equal((await invoke(knowledgeSave, 'POST', article, { cookie, origin: 'https://attacker.example' })).code, 403);
    assert.equal(requests, 0);
    assert.equal((await invoke(knowledgeSave, 'POST', { ...article, status: 'APPROVED', created_by: 'someone-else' })).value.article.status, 'DRAFT');
    assert.equal((await invoke(knowledgeMatches, 'POST', { query: 'registration' })).value.aiGenerated, false);
    conflict = true;
    const changed = await invoke(knowledgeSave, 'POST', { ...article, id: actor, version: 1 });
    assert.equal(changed.code, 409);
    assert.match(changed.value.error, /unsaved text is preserved/);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(overrides)) { if (originals[key] === undefined) delete process.env[key]; else process.env[key] = originals[key]; }
  }
});

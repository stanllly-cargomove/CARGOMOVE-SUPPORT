import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessage, parseThread } from '../server-handlers/gmail/parse.js';
import type { GmailRawMessage } from '../server-handlers/gmail/parse.js';
import { GmailError, InboxError, validGmailId } from '../server-handlers/gmail/client.js';
import type { GmailReader } from '../server-handlers/gmail/client.js';
import { runSync } from '../server-handlers/gmail/sync-engine.js';
import type { SyncState, SyncStore } from '../server-handlers/gmail/sync-engine.js';
import messages from '../server-handlers/gmail/messages.js';
import message from '../server-handlers/gmail/message.js';
import thread from '../server-handlers/gmail/thread.js';
import sync from '../server-handlers/gmail/sync.js';
import type { Request, Response } from 'express';

const email = 'support@example.com';
const encode = (text: string) => Buffer.from(text).toString('base64url');
function raw(id = 'msg1', threadId = 'thread1'): GmailRawMessage {
  return { id, threadId, internalDate: '1720000000000', labelIds: ['INBOX'], payload: {
    mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'Customer <customer@example.com>' }, { name: 'Subject', value: 'Booking help' }],
    parts: [ { mimeType: 'text/plain', body: { data: encode('Please help with booking') } },
      { mimeType: 'text/html', body: { data: encode('<p onclick="attack()">Please help<script>attack()</script><a href="javascript:attack()">link</a></p>') } },
      { mimeType: 'application/pdf', filename: 'private.pdf', body: { attachmentId: 'attachment1' } } ],
  } };
}
function state(): SyncState { return {
  mode: 'BOOTSTRAP', history_id: null, bootstrap_history_id: null, bootstrap_after: 1710000000,
  recovery_pending: false, recovery_cursor: null, pending_recovery_cursor: null,
  page_token: null, page_staged: false, pending_threads: [], pending_page_token: null, pending_history_id: null, last_synced_at: null,
}; }
function fakeReader(work: (path: string, query: URLSearchParams) => unknown): GmailReader {
  return { async get<T>(path: string, query = new URLSearchParams()): Promise<T> { return work(path, query) as T; } };
}
function store() {
  let durable = state(); const seen = new Set<string>(); const saves: SyncState[] = [];
  const api: SyncStore = {
    async isTracked() { return true; },
    async listTracked() { return []; },
    async checkpoint(next) { durable = structuredClone(next); saves.push(durable); },
    async persist(thread) { let n = 0; for (const m of thread.messages) if (!seen.has(m.gmail_message_id)) { seen.add(m.gmail_message_id); n++; } return n; },
  };
  return { api, saves, seen, durable: () => structuredClone(durable) };
}

test('parses Bcc inbound, sanitizes HTML and excludes attachment bytes', () => {
  const parsed = parseMessage(raw(), email);
  assert.equal(parsed.recipient_email, email); assert.equal(parsed.direction, 'INBOUND');
  assert.equal(parsed.body_text, 'Please help with booking');
  assert.doesNotMatch(parsed.body_html!, /onclick|<script|javascript:/i);
  assert.equal(parsed.sender_name, 'Customer'); assert.equal(parsed.in_inbox, true);
});
test('SENT label identifies an outbound alias; drafts stay out of persisted threads', () => {
  const sent = raw(); sent.labelIds = ['SENT']; sent.payload!.headers!.push({ name: 'To', value: 'Customer <customer@example.com>' });
  assert.equal(parseMessage(sent, email).direction, 'OUTBOUND');
  const draft = raw('draft'); draft.labelIds = ['DRAFT'];
  assert.equal(parseThread({ id: 'thread1', messages: [sent, draft] }, email).messages.length, 1);
});
test('rejects invalid identifiers, missing send recipient, mismatched thread and invalid MIME', () => {
  assert.throws(() => validGmailId('../other'), InboxError);
  const sent = raw(); sent.labelIds = ['SENT']; assert.throws(() => parseMessage(sent, email), InboxError);
  assert.throws(() => parseThread({ id: 'wrong', messages: [raw()] }, email), InboxError);
  const bad = raw(); bad.payload!.parts![0].body!.data = '%%%'; assert.throws(() => parseMessage(bad, email), InboxError);
  bad.internalDate = 'oops'; assert.throws(() => parseMessage(bad, email), InboxError);
});
test('large bodies and MIME depth fail without silently truncating stored mail', () => {
  const large = raw(); large.payload!.parts![0].body!.data = encode('x'.repeat(1024 * 1024 + 1));
  assert.throws(() => parseMessage(large, email), InboxError);
  const deep = raw(); let part = deep.payload!;
  for (let n = 0; n < 40; n++) { part.parts = [{}]; part = part.parts[0]; }
  assert.throws(() => parseMessage(deep, email), InboxError);
});
test('bootstrap captures baseline first, deduplicates threads and catches up via history', async () => {
  const db = store(), calls: string[] = [];
  const gmail = fakeReader((path, query) => {
    calls.push(path);
    if (path === 'profile') return { historyId: '90071992547409999' };
    if (path === 'messages') { assert.equal(query.get('labelIds'), 'INBOX'); return { messages: [{ id: 'a', threadId: 'thread1' }, { id: 'b', threadId: 'thread1' }] }; }
    if (path === 'threads/thread1') return { id: 'thread1', messages: [raw()] };
    assert.equal(query.get('startHistoryId'), '90071992547409999'); return { historyId: '90071992547410000', history: [] };
  });
  const first = await runSync(gmail, db.api, state(), email);
  assert.equal(first.inserted_messages, 1); assert.equal(first.processed_threads, 1); assert.equal(first.has_more, true);
  assert.deepEqual(calls, ['profile', 'messages', 'threads/thread1']);
  const second = await runSync(gmail, db.api, db.durable(), email);
  assert.equal(second.has_more, false); assert.equal(second.history_id, '90071992547410000');
  assert.ok(db.durable().last_synced_at);
});
test('pending queue resumes without fetching the page again', async () => {
  const db = store(); const s = state(); const calls: string[] = [];
  const gmail = fakeReader(path => {
    calls.push(path);
    if (path === 'profile') return { historyId: '100' };
    if (path === 'messages') return { messages: [1, 2, 3, 4].map(n => ({ id: `m${n}`, threadId: `t${n}` })), nextPageToken: 'page2' };
    const id = path.split('/')[1]; return { id, messages: [raw(`m${id}`, id)] };
  });
  const first = await runSync(gmail, db.api, s, email);
  assert.equal(first.processed_threads, 3); assert.deepEqual(db.durable().pending_threads, ['t4']); assert.equal(db.durable().page_token, null);
  calls.length = 0;
  const next = await runSync(gmail, db.api, db.durable(), email);
  assert.deepEqual(calls, ['threads/t4']); assert.equal(next.has_more, true); assert.equal(db.durable().page_token, 'page2');
});
test('history pagination never advances its cursor before the last page', async () => {
  const db = store(), s = state(); s.mode = 'HISTORY'; s.history_id = '100'; s.last_synced_at = new Date().toISOString();
  const gmail = fakeReader((path, q) => {
    if (path === 'history') return q.get('pageToken') ? { historyId: '200', history: [] } : { historyId: '180', nextPageToken: 'next', history: [] };
    throw new Error('unexpected');
  });
  assert.equal((await runSync(gmail, db.api, s, email)).has_more, true);
  assert.equal(db.durable().history_id, '100');
  assert.equal((await runSync(gmail, db.api, db.durable(), email)).has_more, false);
  assert.equal(db.durable().history_id, '200');
});
test('a failed checkpoint retries the same thread without duplicate inserts', async () => {
  const db = store(), s = state(); s.mode = 'HISTORY'; s.history_id = '100'; s.page_staged = true;
  s.pending_threads = ['thread1']; s.pending_history_id = '200';
  await db.api.checkpoint(s);
  let fail = true;
  const broken: SyncStore = { isTracked: db.api.isTracked, listTracked: db.api.listTracked, persist: db.api.persist, async checkpoint(next, release) {
    if (fail) { fail = false; throw new Error('database unavailable'); } await db.api.checkpoint(next, release);
  } };
  const gmail = fakeReader(() => ({ id: 'thread1', messages: [raw()] }));
  await assert.rejects(runSync(gmail, broken, s, email));
  assert.deepEqual(db.durable().pending_threads, ['thread1']);
  assert.equal((await runSync(gmail, db.api, db.durable(), email)).inserted_messages, 0);
  assert.equal(db.seen.size, 1);
});
test('expired history rebaselines once; rate limiting never resets history', async () => {
  const db = store(), s = state(); s.mode = 'HISTORY'; s.history_id = '1'; s.last_synced_at = '2026-09-14T00:00:00Z';
  const calls: string[] = [];
  const gmail = fakeReader(path => {
    calls.push(path); if (path === 'history') throw new GmailError(404);
    if (path === 'profile') return { historyId: '200' }; return { messages: [] };
  });
  assert.equal((await runSync(gmail, db.api, s, email)).has_more, true);
  assert.deepEqual(calls, ['history']);
  await runSync(gmail, db.api, db.durable(), email);
  assert.deepEqual(calls, ['history', 'profile']);
  await runSync(gmail, db.api, db.durable(), email);
  assert.deepEqual(calls, ['history', 'profile', 'messages']);
  const prior = db.durable(); prior.mode = 'HISTORY'; prior.history_id = '200';
  await assert.rejects(runSync(fakeReader(() => { throw new GmailError(429); }), db.api, prior, email), GmailError);
  assert.equal(prior.history_id, '200');
});
test('INBOX label additions enter sync; vanished threads are safely skipped', async () => {
  const db = store(), s = state(); s.mode = 'HISTORY'; s.history_id = '100';
  const gmail = fakeReader(path => path === 'history' ? { historyId: '200', history: [{ labelsAdded: [
    { message: { id: 'a', threadId: 'thread1' }, labelIds: ['INBOX'] },
    { message: { id: 'b', threadId: 'unrelated' }, labelIds: ['STARRED'] },
  ] }] } : (() => { throw new GmailError(404); })());
  const result = await runSync(gmail, db.api, s, email);
  assert.equal(result.processed_threads, 1); assert.equal(result.history_id, '200');
});
test('all inbox APIs reject unauthorized requests before any provider/database call', async () => {
  for (const [handler, method] of [[messages, 'GET'], [message, 'GET'], [thread, 'GET'], [sync, 'POST']] as const) {
    let status = 0; let body: unknown;
    const response = { setHeader() {}, status(n: number) { status = n; return this; }, json(value: unknown) { body = value; return this; } };
    await handler({ method, headers: {}, query: {} } as Request, response as unknown as Response);
    assert.equal(status, 401); assert.deepEqual(body, { error: 'Authentication required.' });
  }
});

test('recovery refreshes archived tracked conversations before recent inbox import', async () => {
  const db = store(), s = state(); s.recovery_pending = true;
  const calls: string[] = [];
  const recovery: SyncStore = { ...db.api, async listTracked(after) {
    assert.equal(after, null); return [{ id: 'case1', gmail_thread_id: 'archived' }];
  } };
  const gmail = fakeReader(path => {
    calls.push(path);
    if (path === 'profile') return { historyId: '100' };
    if (path === 'messages') return { messages: [] };
    const mail = raw('archived-message', 'archived'); mail.labelIds = [];
    return { id: 'archived', messages: [mail] };
  });
  await runSync(gmail, recovery, s, email);
  assert.deepEqual(calls, ['profile', 'threads/archived']); assert.equal(db.seen.size, 1);
  assert.equal(db.durable().recovery_pending, false); assert.equal(db.durable().history_id, null);
  await runSync(gmail, recovery, db.durable(), email);
  assert.deepEqual(calls, ['profile', 'threads/archived', 'messages']);
});
test('unrelated archived mail is skipped before parsing its invalid headers', async () => {
  const db = store(), s = state(); s.page_staged = true; s.pending_threads = ['unrelated']; s.pending_history_id = '100';
  const untracked: SyncStore = { ...db.api, async isTracked() { return false; } };
  const gmail = fakeReader(() => ({ id: 'unrelated', messages: [{ ...raw('mail', 'unrelated'), labelIds: [], payload: {} }] }));
  assert.equal((await runSync(gmail, untracked, s, email)).inserted_messages, 0);
  assert.equal(db.seen.size, 0);
});
test('deadline preserves staged work for the next invocation', async () => {
  const db = store(), s = state(); s.page_staged = true; s.pending_threads = ['thread1']; s.pending_history_id = '100';
  const result = await runSync(fakeReader(() => { throw new Error('must not fetch'); }), db.api, s, email, Date.now());
  assert.equal(result.has_more, true); assert.equal(result.processed_threads, 0);
  assert.deepEqual(db.durable().pending_threads, ['thread1']); assert.equal(db.durable().history_id, null);
});
test('Gmail 403 quota and permission errors have actionable public codes', () => {
  assert.equal(new GmailError(403, 'userRateLimitExceeded').status, 429);
  assert.equal(new GmailError(403, 'insufficientPermissions').code, 'GMAIL_RECONSENT_REQUIRED');
});

test('decodes UTF-8 encoded header words and strips NUL from PostgreSQL text bodies', () => {
  const mail = raw(); mail.payload!.headers = [
    { name: 'From', value: '=?UTF-8?B?' + Buffer.from('Pelanggan').toString('base64') + '?= <customer@example.com>' },
    { name: 'Subject', value: '=?UTF-8?Q?Bantuan_tempahan?=' },
  ];
  mail.payload!.parts![0].body!.data = encode('Help\0please');
  const parsed = parseMessage(mail, email);
  assert.equal(parsed.sender_name, 'Pelanggan'); assert.equal(parsed.subject, 'Bantuan tempahan');
  assert.equal(parsed.body_text, 'Helpplease');
});

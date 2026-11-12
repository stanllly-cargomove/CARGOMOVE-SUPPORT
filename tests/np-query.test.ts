import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signSession } from '../api/_runtime.js';
import { createDevToolsRouter } from '../api/dev-tools.js';
import { schedulerAdmin } from '../server-handlers/scheduler/access.js';
import { createNpQueryHandler } from '../server-handlers/np-query/handler.js';
import { NpQueryError, parseNpHtml } from '../server-handlers/np-query/parser.js';
import { NP_QUERY_URL, queryNorthport } from '../server-handlers/np-query/service.js';
import { NP_FIELDS, latestNpEvent, normalizeContainerNumber, normalizeNpDate, npShipping, sortNpMovements, validContainerNumber, formatNpDate, formatNpWeight } from '../shared/np-query.js';
import { npCsv, npExportRows } from '../src/services/npQuery.js';

const html = readFileSync(new URL('./fixtures/np-query.html', import.meta.url), 'utf8');
const unit = 'SYLU5004458';
const records = () => parseNpHtml(html, unit);
const fakeFetch = (body = html, status = 200): typeof fetch => async () => new Response(body, { status });
const response = () => ({ code: 200, body: null as any, headers: {} as Record<string, string>, setHeader(name: string, value: string) { this.headers[name] = value; }, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } });
const request = (value: any = unit) => ({ method: 'POST', headers: { origin: 'http://localhost:3000', 'x-cargomove-confirm': 'np-query' }, body: { containerNumber: value } });
function deps() {
  return { authorize: async () => ({ session: { id: 'test-admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 10000 }, client: {} as any }), allowedOrigin: (origin: unknown) => origin === 'http://localhost:3000', requestBody: async (req: any) => req.body, queryNorthport: (value: string) => queryNorthport(value, fakeFetch()), now: () => 10000 };
}
test('all supplied Import/Export fields remain independent, including exact decimal precision and original local dates', () => {
  const [exp, imp] = records();
  assert.equal(Object.keys(imp).length, Object.keys(NP_FIELDS).length + 2);
  assert.equal(exp.sourceIndex, 0); assert.equal(imp.sourceIndex, 1);
  assert.equal(exp.grossWeight, '30000'); assert.equal(exp.vgm, '30000.0');
  assert.equal(imp.grossWeight, '4000'); assert.equal(imp.vgm, null);
  assert.equal(imp.timeOut, '2026-11-07 17:42:52.480'); assert.equal(exp.timeOut, null);
  assert.equal(exp.stage, null); assert.equal(imp.stage, 'Departed');
  assert.equal(imp.rawFields['Gross Weight'], '4000 kg');
  assert.equal(exp.holdPermissions, '!CUSTOMS_EXP_PRM,!VGM_PRM');
  assert.match(imp.grantedPermissions!, /DISCHLIST_PRM \(2026-10-28 16:14:26\)/);
  assert.deepEqual(npShipping(exp), { vessel: 'DANUM 115 (LMY13941)', scn: '26AWT1', eta: '2026-11-16 07:59:00' });
  assert.deepEqual(npShipping(imp), { vessel: 'DANUM 173 (LMY998290)', scn: '269SI9', eta: '2026-10-31 17:00:00' });
  assert.equal(formatNpDate(imp.timeOut), '07/11/2026 17:42:52');
  assert.equal(formatNpWeight(exp.vgm), '30,000.0');
  assert.equal(exp.fullEmpty, null); assert.equal(imp.fullEmpty, null);
});
test('F/E uses explicit source values and never guesses from category, stage, ISO or weight', () => {
  for (const [label, value, expected] of [['F/E', 'F', 'F'], ['F/E', 'E', 'E'], ['Full/Empty', 'Full', 'F'], ['Full Empty', ' empty ', 'E'], ['Full or Empty', 'unknown', null]] as const) {
    const [record] = parseNpHtml(html.replace('<p>VGM : <span>30000.0</span></p>', `<p>VGM : <span>30000.0</span></p><p>${label} : <span>${value}</span></p>`), unit);
    assert.equal(record.fullEmpty, expected);
    assert.equal(record.rawFields[label], value.trim());
    const rows = npExportRows([record]); assert.equal(rows[1][rows[0].indexOf('F/E')], expected ?? '');
  }
  const [noFlag] = parseNpHtml(html.replace('<p>Stage : <span></span></p>', '<p>Stage : <span>Empty</span></p>').replace('30000 kg', '0 kg'), unit);
  assert.equal(noFlag.fullEmpty, null);
  const withEquivalentLabels = html.replace('<p>VGM : <span>30000.0</span></p>', '<p>VGM : <span>30000.0</span></p><p>F/E : <span>Full</span></p><p>Full/Empty : <span>F</span></p>');
  assert.equal(parseNpHtml(withEquivalentLabels, unit)[0].fullEmpty, 'F');
  assert.throws(() => parseNpHtml(withEquivalentLabels.replace('<span>F</span>', '<span>E</span>'), unit), /conflicting/);
});
test('latest actual event outranks ETA, category, source order and weights; ties use source order', () => {
  const [exp, imp] = records();
  assert.deepEqual(sortNpMovements([exp, imp]).map(r => r.category), ['Import', 'Export']);
  assert.equal(latestNpEvent(imp)?.field, 'timeOut');
  const updated = { ...exp, timeStack: '2026-11-08 01:00:00', sourceIndex: 3 };
  assert.equal(sortNpMovements([imp, updated])[0], updated);
  const maxEvent = { ...imp, timeIn: '2026-11-10 00:00:00' };
  assert.equal(latestNpEvent(maxEvent)?.field, 'timeIn');
  const tied = { ...imp, sourceIndex: 5, etaImport: '2099-01-01 00:00:00', grossWeight: '999999' };
  assert.equal(sortNpMovements([tied, imp])[0], imp);
  const noDates = { ...exp, etaExport: null, sourceIndex: 6 };
  assert.deepEqual(sortNpMovements([noDates, exp, imp]), [imp, exp, noDates]);
  assert.equal(sortNpMovements([{ ...exp, sourceIndex: 4, etaExport: '2026-11-17 00:00:00' }, exp])[0].sourceIndex, 4);
  assert.equal(sortNpMovements([{ ...imp, sourceIndex: 9, timeOut: '2026-11-07 17:42:52.4800' }, imp])[0], imp);
});
test('validation and local date normalization reject invalid dates and inferred timezone offsets', () => {
  assert.equal(normalizeContainerNumber('  sylu5004458  '), unit);
  for (const value of [unit, 'ABCU1234567', 'ABCJ1234567', 'ABCZ1234567']) assert.equal(validContainerNumber(value), true);
  for (const value of ['AAAA1234567', 'SYLU500445', 'SYLU50044588', '<script>', 'SYLU 5004458']) assert.equal(validContainerNumber(value), false);
  assert.equal(normalizeNpDate('2026-11-07T17:42:52.480'), '2026-11-07 17:42:52.480');
  for (const value of ['2026-02-29 00:00:00', '2026-11-31 00:00:00', '2026-13-01 00:00:00', '2026-11-07 24:00:00', '2026-11-07T17:42:52Z', 'unknown']) assert.equal(normalizeNpDate(value), null);
});
test('HTML parser handles entities, nested values, optional fields and extra labels without rendering markup', () => {
  const [exp] = parseNpHtml(html.replace('GEN_TRUCK</span>', '<b>GEN</b>_TRUCK &amp; CO</span>').replace('30000 kg', '30,000.1250 KG').replace('SYL (SHIN', 'SYL (SHIN').replace('<hr>', '<p>Unknown Label : <span>outside block</span></p>'), unit);
  assert.equal(exp.yardPosition, 'T-GEN_TRUCK & CO'); assert.equal(exp.grossWeight, '30000.1250');
  const modified = parseNpHtml(html.replace('<p>VGM : <span>30000.0</span></p>', '<p>VGM : <span><span>30000.0</span></span></p><p>Extra : <span>kept</span></p>'), unit);
  assert.equal(modified[0].vgm, '30000.0'); assert.equal(modified[0].rawFields.Extra, 'kept');
});
test('empty, blocked, malformed and mismatched responses do not masquerade as valid data', () => {
  assert.throws(() => parseNpHtml('No records found', unit), (e: NpQueryError) => e.status === 404);
  assert.throws(() => parseNpHtml('<div><p>Something interrupted this request. Please retry in a moment.</p></div>', unit), (e: NpQueryError) => e.status === 502);
  assert.throws(() => parseNpHtml(html.replace('30000 kg', '30,00 kg'), unit), NpQueryError);
  for (const body of ['', '<html>Access denied</html>', '<div class="div_query_output"><p>Container Number : <span>SYLU5004458</span></p></div>', html.replaceAll(unit, 'ABCU1234567'), html.replace('30000 kg', 'unknown kg'), html.replace('<p>VGM :', '<p>Stage : <span>Conflicting</span></p><p>VGM :').replace('<p>Stage : <span></span>', '<p>Stage : <span>Existing</span>')]) assert.throws(() => parseNpHtml(body, unit), NpQueryError);
});
test('backend posts form data and returns all sorted records with dynamically generated query time', async () => {
  let calls = 0;
  const result = await queryNorthport(unit, async (url, options) => {
    calls++; assert.equal(url, NP_QUERY_URL); assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(String(options.body), `cont_num_N4=${unit}`); assert.equal(options.cache, 'no-store');
    return new Response(html);
  }, () => new Date('2026-11-12T06:00:01Z'));
  assert.equal(calls, 1); assert.equal(result.queriedAt, '2026-11-12T06:00:01.000Z');
  assert.equal(result.totalMovements, 2); assert.equal(result.latestRecordedMovementIndex, 0);
  assert.equal(result.movements[0].grossWeight, '4000');
  const scheduled = await queryNorthport(unit, fakeFetch(html.slice(0, html.indexOf('<hr>'))));
  assert.equal(scheduled.latestRecordedMovementIndex, null);
});
test('network, upstream, timeout, response size and body-read failures have safe errors', async () => {
  for (const status of [403, 429, 500]) await assert.rejects(queryNorthport(unit, fakeFetch('secret upstream diagnostics', status)), (e: NpQueryError) => e.status >= 500 && !e.message.includes('secret'));
  await assert.rejects(queryNorthport(unit, async () => { throw new Error('private diagnostics'); }), (e: NpQueryError) => e.status === 503 && !e.message.includes('private'));
  const hanging: typeof fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort'))));
  await assert.rejects(queryNorthport(unit, hanging, undefined, 10), (e: NpQueryError) => e.status === 504);
  await assert.rejects(queryNorthport(unit, fakeFetch('a'.repeat(2 * 1024 * 1024 + 1))), /large response/);
  await assert.rejects(queryNorthport(unit, async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('private')); } }))), /Unable to contact/);
});
test('handler enforces method, admin, origin and validation before making upstream requests', async () => {
  let calls = 0; const base = deps(); base.queryNorthport = async value => { calls++; return queryNorthport(value, fakeFetch()); };
  const handler = createNpQueryHandler(base);
  const cases = [{ req: { ...request(), method: 'GET' }, status: 405 }, { req: { ...request(), headers: { origin: 'https://evil.test' } }, status: 403 }, { req: request('invalid'), status: 400 }, { req: request(null), status: 400 }];
  for (const item of cases) { const res = response(); await handler(item.req, res); assert.equal(res.code, item.status); }
  assert.equal(calls, 0);
  const denied = createNpQueryHandler({ ...base, authorize: async () => ({ code: 401, message: 'Administrator authentication required.' }) });
  const res = response(); await denied(request(), res); assert.equal(res.code, 401); assert.equal(calls, 0);
  const good = response(); await handler(request(' sylu5004458 '), good); assert.equal(good.body.containerNumber, unit); assert.equal(good.headers['Cache-Control'], 'no-store');
});
test('duplicate and rapid requests are rejected; a later refresh fetches fresh data without merging', async () => {
  let now = 10000, release: () => void, calls = 0;
  const base = deps(), query = base.queryNorthport;
  const handler = createNpQueryHandler({ ...base, now: () => now, queryNorthport: async value => { calls++; if (calls === 1) await new Promise<void>(resolve => { release = resolve; }); return query(value); } });
  const first = response(); const pending = handler(request(), first);
  await new Promise(resolve => setImmediate(resolve));
  const duplicate = response(); await handler(request(), duplicate); assert.equal(duplicate.code, 429);
  release!(); await pending;
  const rapid = response(); await handler(request(), rapid); assert.equal(rapid.code, 429);
  now += 3001; const refreshed = response(); await handler(request(), refreshed); assert.equal(calls, 2); assert.equal(refreshed.body.movements.length, 2);
});
test('existing session access checks reject non-admin and revoked access without touching a live database', async () => {
  const previous = process.env.SESSION_SECRET; process.env.SESSION_SECRET = 'np-query-offline-test-secret';
  try {
    for (const type of ['CUSTOMER', 'ADMIN']) {
      const token = signSession({ id: 'test', email: 'test@example.test', type, exp: Date.now() + 10000 });
      const req = { headers: { cookie: `cargomove_session=${token}` } };
      let databaseReads = 0;
      const revokedClient = { from() { databaseReads++; return { select() { return this; }, eq() { return this; }, timeout() { return this; }, async maybeSingle() { return { data: null, error: null }; } }; } };
      const access = await schedulerAdmin(req, { readSession: (await import('../api/_runtime.js')).readSession, adminClient: () => revokedClient as any });
      assert.equal('code' in access && access.code, type === 'ADMIN' ? 403 : 401);
      assert.equal(databaseReads, type === 'ADMIN' ? 1 : 0);
    }
  } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; }
});
test('deployed dispatcher and rewrite expose NP Query using the existing function budget', async () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(config.rewrites.some((r: any) => r.source === '/api/dev-tools/np-query' && r.destination === '/api/dev-tools?route=np-query'));
  const handler = createDevToolsRouter({ 'np-query': createNpQueryHandler(deps()) });
  const res = response(); await handler({ ...request(), query: { route: 'np-query' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.totalMovements, 2);
});
test('CSV and Excel row data retain all movement fields, decimals and local timestamps; CSV escapes formula injection', () => {
  const data = sortNpMovements(records()), rows = npExportRows(data);
  assert.equal(rows.length, 3); assert.equal(rows[0].length, Object.keys(NP_FIELDS).length + 2);
  assert.equal(rows[1][rows[0].indexOf('Gross Weight')], '4000'); assert.equal(rows[2][rows[0].indexOf('VGM')], '30000.0');
  assert.equal(rows[1][rows[0].indexOf('Time Out')], '07/11/2026 17:42:52');
  assert.match(npCsv([{ ...data[0], agentName: '=HYPERLINK("bad")' }]), /'\=HYPERLINK\(""bad""\)/);
});

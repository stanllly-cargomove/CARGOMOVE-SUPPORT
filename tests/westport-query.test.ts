import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWestportClient, WESTPORT_URL, WESTPORT_LOGIN_URL } from '../server-handlers/westport-query/service.js';
import { parseWestportHtml, parseWestportResponse, WestportSessionExpired } from '../server-handlers/westport-query/parser.js';
import { WestportCookies } from '../server-handlers/westport-query/cookies.js';
import { NpQueryError } from '../server-handlers/np-query/parser.js';
import { createNpQueryHandler } from '../server-handlers/np-query/handler.js';
import { createDevToolsRouter } from '../api/dev-tools.js';
import { westportCsv, westportExportRows } from '../src/services/westportQuery.js';
import { formatWestportStackedTime, westportCategory, westportColumnLabel, westportDisplayValue, westportStackedTimeKey } from '../src/services/westportPresentation.js';

const unit = 'ABCU1234567';
const fixture = readFileSync(new URL('./fixtures/westport-query.html', import.meta.url), 'utf8');
// Schema confirmed live; every identifier and business value here is synthetic.
const jsonFixture = readFileSync(new URL('./fixtures/westport-query.json', import.meta.url), 'utf8');
const loginPage = '<html><form id="signin-form"><input name="userid"><input name="passwd" type="password"></form></html>';
const credentials = () => ({ username: 'fixture-user', password: 'fixture-password' });
const sessionPage = '<html><h1>Dashboard</h1></html>';
const cookie = (value: string, path = '/') => ({ 'Set-Cookie': `WPTETP=${value}; Path=${path}; HttpOnly; Secure; Max-Age=28800` });
type Call = { url: string; data: URLSearchParams; headers: Record<string, string> };
function upstream(lookup?: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = []; let lookups = 0;
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(new URL(String(url)).origin, new URL(WESTPORT_URL).origin);
    assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store');
    const call = { url: String(url), data: new URLSearchParams(String(options.body || '')), headers: options.headers as Record<string, string> };
    calls.push(call);
    if (call.data.get('action') === 'get_container') return lookup ? lookup(call, ++lookups) : new Response(fixture);
    if (call.data.get('action') === 'signin_attempt') {
      assert.equal(call.url, WESTPORT_LOGIN_URL);
      assert.equal(call.data.get('node_ajax_id'), '50'); assert.equal(call.data.get('user_id'), 'fixture-user'); assert.equal(call.data.get('password'), 'fixture-password');
      assert.equal(call.headers.Cookie, 'WPTETP=initial');
      return new Response('Proceed');
    }
    if (call.data.has('userid')) {
      assert.equal(call.data.get('userid'), 'fixture-user'); assert.equal(call.data.get('passwd'), 'fixture-password');
      return new Response(sessionPage, { headers: cookie('authenticated') });
    }
    return new Response(loginPage, { headers: cookie('initial') });
  };
  return { calls, fetcher };
}

test('Westport table retains source order, all columns, blank cells, entities and local timestamps', () => {
  const table = parseWestportHtml(fixture, unit);
  assert.equal(table.columns.length, 8); assert.equal(table.movements.length, 2);
  assert.deepEqual(table.movements.map(row => row[0]), ['IN', 'OUT']);
  assert.equal(table.movements[0][3], ''); assert.equal(table.movements[1][3], '12/11/2026 17:12');
  assert.equal(table.movements[1][6], 'TEST & CO');
  assert.equal(table.movements[0][2], unit);
  assert.deepEqual(westportExportRows(table), [table.columns, ...table.movements]);
  assert.match(westportCsv({ columns: ['HDL TYPE'], movements: [['=HYPERLINK("bad")'], [' +1']] }), /'\=HYPERLINK\(""bad""\)/);
});

test('confirmed DataTables JSON preserves display values and excludes upstream action HTML and internal payloads', async () => {
  const table = parseWestportResponse(jsonFixture, unit);
  assert.equal(table.columns.length, 14); assert.equal(table.movements.length, 2);
  assert.deepEqual(table.movements.map(row => row[0]), ['IN', 'OUT']);
  assert.equal(table.movements[0][3], ''); assert.equal(table.movements[1][3], '20261112171200');
  assert.equal(table.movements[0][12], 'TEST01'); assert.equal(table.movements[1][11], 'TEST02');
  assert.equal(table.movements[1][6], 'TEST & CO');
  assert.ok(!JSON.stringify(table).includes('<a')); assert.ok(!JSON.stringify(table).includes('INTERNAL TEST DATA'));
  const mock = upstream(() => new Response(jsonFixture, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }));
  const result = await createWestportClient({ credentials, fetcher: mock.fetcher })(unit);
  assert.equal(result.totalMovements, 2); assert.deepEqual(result.columns, table.columns);
});

test('Westport presentation formats local stacked times and category labels without changing source rows or exports', () => {
  assert.equal(formatWestportStackedTime('20261113134826'), '13/11/2026 13:48');
  assert.equal(formatWestportStackedTime('20261028183136'), '28/10/2026 18:31');
  assert.equal(formatWestportStackedTime('202611131348'), '13/11/2026 13:48');
  assert.equal(formatWestportStackedTime('2026-11-13 13:48:26'), '13/11/2026 13:48');
  assert.equal(formatWestportStackedTime('13/11/2026 13:48:26'), '13/11/2026 13:48');
  assert.equal(formatWestportStackedTime('29/02/2024 00:01'), '29/02/2024 00:01');
  assert.equal(formatWestportStackedTime(''), '');
  for (const invalid of ['20260229134826', '20261313134826', '20261113244826', 'unknown', '12/11/26 17:12']) assert.equal(formatWestportStackedTime(invalid), invalid);
  assert.ok(westportStackedTimeKey('20261028183136') < westportStackedTimeKey('20261113134826'));
  assert.equal(westportColumnLabel('HDL TYPE'), 'Category');
  assert.equal(westportCategory('IN'), 'Export'); assert.equal(westportCategory(' out '), 'Import');
  assert.equal(westportCategory('OTHER'), 'OTHER'); assert.equal(westportCategory(''), null);
  const table = parseWestportResponse(jsonFixture, unit), original = JSON.stringify(table);
  table.movements.forEach(Object.freeze); Object.freeze(table.columns); Object.freeze(table.movements);
  assert.equal(westportDisplayValue(table.columns[0], table.movements[0][0]), 'Export');
  assert.equal(westportDisplayValue(table.columns[0], table.movements[1][0]), 'Import');
  assert.equal(westportDisplayValue(table.columns[3], table.movements[1][3]), '12/11/2026 17:12');
  assert.equal(JSON.stringify(table), original);
  assert.match(westportCsv(table), /"HDL TYPE"/); assert.match(westportCsv(table), /"IN","MTI"/);
  assert.match(westportCsv(table), /"OUT","FOT"/); assert.match(westportCsv(table), /"20261112171200"/);
});

test('DataTables counts, identity, field types and bounds are checked before accepting empty or partial results', () => {
  const data = JSON.parse(jsonFixture);
  for (const invalid of [
    { ...data, iTotalRecords: 3 }, { ...data, iTotalDisplayRecords: 1 }, { ...data, iTotalRecords: '2' },
    { ...data, aaData: [] }, { aaData: [] }, [], null,
    { ...data, aaData: [data.aaData[0], { ...data.aaData[1], container_no: 'ABCZ0000001' }] },
    { ...data, aaData: [data.aaData[0], { ...data.aaData[1], order_type: '' }] },
    { ...data, aaData: [data.aaData[0], { ...data.aaData[1], vessel_name: {} }] },
    { ...data, aaData: [data.aaData[0], { ...data.aaData[1], container_type: 'x'.repeat(4001) }] },
    { iTotalRecords: 501, iTotalDisplayRecords: 501, aaData: Array(501).fill(data.aaData[0]) },
  ]) assert.throws(() => parseWestportResponse(JSON.stringify(invalid), unit), NpQueryError);
  assert.throws(() => parseWestportResponse('{"aaData":', unit), /invalid movement JSON/);
  const empty = parseWestportResponse('{"iTotalRecords":0,"iTotalDisplayRecords":0,"aaData":[]}', unit);
  assert.equal(empty.columns.length, 14); assert.deepEqual(empty.movements, []);
  assert.throws(() => parseWestportResponse(loginPage, unit), WestportSessionExpired);
});

test('login, mismatched, incomplete, ambiguous and unsupported responses never appear as empty results', () => {
  assert.throws(() => parseWestportHtml(loginPage, unit), WestportSessionExpired);
  for (const body of ['', 'No records found', '{"data":[]}', '<html>Dashboard</html>', fixture.replaceAll(unit, 'ABCZ0000001'), fixture.replace('<td>TR</td>', ''), fixture + fixture, fixture.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody></tbody>'), fixture.replace('<td>MTI</td>', '<td colspan="2">MTI</td>')]) {
    assert.throws(() => parseWestportHtml(body, unit), NpQueryError);
  }
  const empty = fixture.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody><tr><td colspan="8">No data available in table</td></tr></tbody>');
  assert.deepEqual(parseWestportHtml(empty, unit).movements, []);
  assert.throws(() => parseWestportHtml(empty.replace('</tbody>', '<tr><td>IN</td></tr></tbody>'), unit), NpQueryError);
  const harmless = parseWestportHtml(fixture.replace('TEST &amp; CO', '<b>TEST</b> &amp; CO<script>stealCookies()</script>'), unit);
  assert.equal(harmless.movements[1][6], 'TEST & CO');
});

test('shared account performs both login posts, retains rotated cookies, then reuses its session', async () => {
  const mock = upstream(call => {
    assert.equal(call.url, WESTPORT_URL); assert.equal(call.headers.Cookie, 'WPTETP=authenticated');
    assert.equal(call.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(call.data.get('node_ajax_id'), '2609'); assert.equal(call.data.get('cont_no'), unit);
    return new Response(fixture);
  });
  const query = createWestportClient({ fetcher: mock.fetcher, credentials, now: () => Date.UTC(2026, 10, 13, 5) });
  const result = await query(unit); await query(unit);
  assert.equal(mock.calls.length, 5); assert.equal(result.port, 'westport'); assert.equal(result.totalMovements, 2);
  assert.equal(result.queriedAt, '2026-11-13T05:00:00.000Z');
  for (const secret of ['fixture-password', 'authenticated', 'initial']) assert.ok(!JSON.stringify(result).includes(secret));
});

test('expired cached sessions renew once; 200 login pages and 302 login redirects are authentication failures', async () => {
  for (const expiredResponse of [() => new Response(loginPage), () => new Response(null, { status: 302, headers: { Location: WESTPORT_LOGIN_URL } })]) {
    const mock = upstream((_call, index) => index === 2 ? expiredResponse() : new Response(fixture));
    const query = createWestportClient({ fetcher: mock.fetcher, credentials });
    await query(unit); assert.equal((await query(unit)).totalMovements, 2);
    assert.equal(mock.calls.filter(call => call.data.get('action') === 'signin_attempt').length, 2);
    assert.equal(mock.calls.filter(call => call.data.get('action') === 'get_container').length, 3);
  }
});

test('failed credentials and sessions pause logins, return safe messages and do not retry indefinitely', async () => {
  let now = 100000, calls = 0;
  const query = createWestportClient({ credentials, now: () => now, fetcher: async (_url, options) => {
    calls++; return new Response(String(options.body || '').includes('signin_attempt') ? 'Locked fixture-password' : loginPage);
  } });
  await assert.rejects(query(unit), /rejected the shared account/);
  assert.equal(calls, 2);
  await assert.rejects(query(unit), /paused/); assert.equal(calls, 2);
  now += 60001; await assert.rejects(query(unit), /rejected/); assert.equal(calls, 4);
  const mock = upstream(() => new Response(loginPage));
  const invalidSession = createWestportClient({ credentials, fetcher: mock.fetcher });
  await assert.rejects(invalidSession(unit), /did not accept/);
  assert.equal(mock.calls.length, 4); await assert.rejects(invalidSession(unit), /paused/); assert.equal(mock.calls.length, 4);
});

test('missing configuration and invalid containers never contact Westports; credential changes invalidate sessions', async () => {
  let calls = 0;
  const unconfigured = createWestportClient({ credentials: () => ({ username: '', password: '' }), fetcher: async () => { calls++; throw new Error('Unexpected network'); } });
  await assert.rejects(unconfigured(unit), /not configured/); await assert.rejects(unconfigured('bad'), /valid container/); assert.equal(calls, 0);
  let password = 'one';
  const mock = upstream();
  const query = createWestportClient({ credentials: () => ({ username: 'fixture-user', password }), fetcher: async (url, options) => {
    const data = new URLSearchParams(String(options.body || ''));
    if (data.has('password')) data.set('password', 'fixture-password');
    if (data.has('passwd')) data.set('passwd', 'fixture-password');
    return mock.fetcher(url, { ...options, body: options.body ? data : undefined });
  } });
  await query(unit); password = 'two'; await query(unit);
  assert.equal(mock.calls.filter(call => call.data.get('action') === 'signin_attempt').length, 2);
});

test('same-origin login redirects preserve cookies and off-origin redirects never receive credentials or cookies', async () => {
  let count = 0;
  const redirected = createWestportClient({ credentials, fetcher: async (url, options) => {
    count++;
    if (count === 1) return new Response(loginPage, { headers: cookie('initial') });
    if (count === 2) return new Response('Proceed');
    if (count === 3) return new Response(null, { status: 302, headers: { Location: '/', ...cookie('rotated') } });
    assert.equal(String(url), WESTPORT_URL); assert.equal((options.headers as any).Cookie, 'WPTETP=rotated');
    if (count === 4) { assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); return new Response(sessionPage); }
    return new Response(fixture);
  } });
  await redirected(unit); assert.equal(count, 5);
  let externalCalls = 0;
  const external = createWestportClient({ credentials, fetcher: async () => { externalCalls++; return new Response(null, { status: 307, headers: { Location: 'https://other.example.test/' } }); } });
  await assert.rejects(external(unit), /unexpected redirect/); assert.equal(externalCalls, 1);
});

test('cookie jar respects path, expiry, rotation and domain restrictions', () => {
  let now = 100000; const jar = new WestportCookies(() => now), url = new URL(WESTPORT_URL);
  jar.update(new Headers(cookie('first')), url); assert.equal(jar.header(url), 'WPTETP=first');
  jar.update(new Headers(cookie('second')), url); assert.equal(jar.header(url), 'WPTETP=second');
  jar.update(new Headers({ 'Set-Cookie': 'BAD=private; Domain=other.example.test; Path=/' }), url); assert.equal(jar.header(url), 'WPTETP=second');
  jar.update(new Headers({ 'Set-Cookie': 'SCOPED=private; Path=/private; Max-Age=1' }), url);
  assert.equal(jar.header(new URL('/private/query', url)), 'SCOPED=private; WPTETP=second');
  assert.equal(jar.header(new URL('/private-other', url)), 'WPTETP=second');
  now += 1001; assert.equal(jar.header(new URL('/private/query', url)), 'WPTETP=second');
  jar.update(new Headers({ 'Set-Cookie': 'WPTETP=; Path=/; Max-Age=0' }), url); assert.equal(jar.header(url), '');
  jar.update(new Headers({ 'Set-Cookie': 'DEFAULT=scoped' }), new URL('/private/login', url));
  assert.equal(jar.header(new URL('/private', url)), 'DEFAULT=scoped');
  assert.equal(jar.header(new URL('/private-other', url)), '');
  assert.throws(() => jar.header(new URL('http://etp.westports.com.my/')), /destination/);
});

test('shared session rejects concurrent work and bounds network, timeout and response failures', async () => {
  let release: () => void;
  const mock = upstream(async () => { await new Promise<void>(resolve => { release = resolve; }); return new Response(fixture); });
  const query = createWestportClient({ credentials, fetcher: mock.fetcher });
  const first = query(unit); while (!release!) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(query(unit), (error: NpQueryError) => error.status === 429); release!(); await first;
  const hanging: typeof fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('private network data'))));
  await assert.rejects(createWestportClient({ credentials, fetcher: hanging, timeoutMs: 10 })(unit), (error: NpQueryError) => error.status === 504);
  await assert.rejects(createWestportClient({ credentials, fetcher: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) })(unit), /large response/);
  await assert.rejects(createWestportClient({ credentials, fetcher: async () => { throw new Error('fixture-password'); } })(unit), error => !String(error).includes('fixture-password'));
  await assert.rejects(createWestportClient({ credentials, fetcher: async () => new Response('private upstream diagnostics', { status: 500 }) })(unit), /temporarily unavailable/);
});

test('portal dispatcher routes Westport through administrator, origin, validation and shared request limits', async () => {
  const mock = upstream(); let upstreamCalls = 0, clock = 10000;
  const query = createWestportClient({ credentials, fetcher: mock.fetcher });
  const deps = { authorize: async () => ({ session: { id: 'offline-admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 10000 }, client: {} as any }), allowedOrigin: (origin: unknown) => origin === 'http://localhost:3000', requestBody: async (req: any) => req.body, queryNorthport: async () => { throw new Error('Must not query Northport'); }, now: () => clock };
  const handler = createNpQueryHandler(deps, async value => { upstreamCalls++; return query(value); });
  const router = createDevToolsRouter({ 'np-query': handler });
  const request = (port: unknown = 'westport') => ({ method: 'POST', query: { route: 'np-query' }, headers: { origin: 'http://localhost:3000', 'x-cargomove-confirm': 'np-query', cookie: 'portal-cookie=never-forward' }, body: { port, containerNumber: unit } });
  const response = () => ({ code: 200, body: null as any, headers: {} as Record<string, string>, setHeader(name: string, value: string) { this.headers[name] = value; }, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } });
  for (const port of ['other', {}, null]) { const res = response(); await router(request(port), res); assert.equal(res.code, 400); }
  const denied = response(); await router({ ...request(), headers: { origin: 'https://other.test', 'x-cargomove-confirm': 'np-query', cookie: '' } }, denied); assert.equal(denied.code, 403);
  assert.equal(upstreamCalls, 0);
  const good = response(); await router(request(), good); assert.equal(good.body.port, 'westport'); assert.equal(good.headers['Cache-Control'], 'no-store');
  assert.equal(good.headers['Set-Cookie'], undefined); assert.ok(mock.calls.every(call => !call.headers.Cookie.includes('portal-cookie')));
  const rapid = response(); await router(request(), rapid); assert.equal(rapid.code, 429); assert.equal(upstreamCalls, 1);
  clock += 4000; const refreshed = response(); await router(request(), refreshed); assert.equal(refreshed.body.totalMovements, 2);
  const anonymous = createNpQueryHandler({ ...deps, authorize: async () => ({ code: 401, message: 'Administrator authentication required.' }) }, query);
  const noSession = response(); await anonymous(request(), noSession); assert.equal(noSession.code, 401);
});

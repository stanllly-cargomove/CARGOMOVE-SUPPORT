import test from 'node:test';
import assert from 'node:assert/strict';
import { readSession, signSession } from '../api/_runtime.js';
import { allowedOrigin, createSchedulerHandler } from '../server-handlers/scheduler/handler.js';
import { classifySchedulerResponse, runAutomation, compareLastRun, lastRunTimestamp, launchWindowsBrowser, RUN_URL, TASKS_URL } from '../server-handlers/scheduler/automation.js';
import { DEFAULT_SCHEDULER_ID, NORTHPORT_TARGET, parseSchedulerUrl, schedulerUrl } from '../server-handlers/scheduler/targets.js';
import { createSchedulerCatalog } from '../server-handlers/scheduler/catalog.js';

test('signed sessions reject tampering and expiration', () => {
  process.env.SESSION_SECRET = 'scheduler-test-only';
  const payload = { id: 'admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60000 };
  const token = signSession(payload);
  assert.equal(readSession({ headers: { cookie: `cargomove_session=${token}` } })?.id, 'admin');
  assert.equal(readSession({ headers: { cookie: `cargomove_session=${token}x` } }), null);
  assert.equal(readSession({ headers: { cookie: `cargomove_session=${signSession({ ...payload, exp: 1 })}` } }), null);
});

function responseMock() {
  return { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
}

test('Windows launcher selects full managed Chromium and falls back after launch failures', async () => {
  for (const managedExists of [true, false]) {
    const attempts: string[] = [];
    const browser = {} as any;
    const result = await launchWindowsBrowser({
      executablePath: () => 'managed-chromium',
      launch: async options => {
        assert.equal(options?.headless, true);
        attempts.push(options!.channel!);
        if (options?.channel !== 'msedge') throw new Error('Browser unavailable');
        return browser;
      },
    }, () => managedExists);
    assert.equal(result, browser);
    assert.deepEqual(attempts, managedExists ? ['chromium', 'chrome', 'msedge'] : ['chrome', 'msedge']);
  }
  await assert.rejects(() => launchWindowsBrowser({
    executablePath: () => 'missing',
    launch: async () => { throw new Error('No installed browser'); },
  }, () => false), /No installed browser/);
});

test('API authorization, origin, revoked roles, shared admission and audit failures', async () => {
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  process.env.CARGOMOVE_URL = 'https://www.cargomove.my/administration/scheduled_tasks';
  assert.equal(allowedOrigin('https://portal.example.test'), true);
  assert.equal(allowedOrigin('https://www.cargomove.my'), false);
  process.env.CARGOMOVE_USERNAME = 'test-only';
  process.env.CARGOMOVE_PASSWORD = 'test-only-secret';
  let session: any = { id: 'admin', email: 'admin@example.test', type: 'ADMIN' };
  let profile: any = { id: 'profile' };
  let reason: string | undefined;
  let cooldownSeconds: number | undefined;
  let occupied = false;
  let executions = 0;
  let failAudit = false;
  let release: (() => void) | undefined;
  const client = {
    from() { return { select() { return this; }, eq() { return this; }, timeout() { return this; }, async maybeSingle() { return { data: profile, error: null }; } }; },
    async rpc(name: string) {
      if (name.startsWith('acquire')) {
        if (reason || occupied) return { data: { reason: reason || 'running', cooldown_seconds: cooldownSeconds }, error: null };
        occupied = true;
        return { data: { id: 'run-1', worker_name: NORTHPORT_TARGET.workerName, task_id: NORTHPORT_TARGET.taskId }, error: null };
      }
      return { data: !failAudit, error: null };
    },
  };
  const handler = createSchedulerHandler({
    readSession: () => session, adminClient: () => client as any,
    runAutomation: async (_credentials, mark) => {
      executions++;
      await mark();
      if (release === undefined) await new Promise<void>(resolve => { release = resolve; });
      return { status: 'TRIGGER_REQUESTED', message: 'Scheduler request sent.' };
    },
  });
  const request = { method: 'POST', body: {} as Record<string, unknown>, headers: { origin: 'https://portal.example.test', 'x-cargomove-confirm': 'run-northport-containers' } };
  const call = async (req = request) => { const res = responseMock(); await handler(req, res); return res; };
  session = null;
  assert.equal((await call()).code, 401);
  session = { id: 'admin', email: 'admin@example.test', type: 'COMPANY_ADMIN' };
  assert.equal((await call()).code, 401);
  session.type = 'ADMIN';
  assert.equal((await call({ ...request, method: 'GET' })).code, 405);
  assert.equal((await call({ ...request, headers: { ...request.headers, origin: 'https://evil.test' } })).code, 403);
  assert.equal((await call({ ...request, headers: { ...request.headers, 'x-cargomove-confirm': '' } })).code, 403);
  profile = null;
  assert.equal((await call()).code, 403);
  profile = { id: 'profile' };
  assert.equal((await call({ ...request, body: { schedulerId: 'invalid' } })).code, 400);
  assert.equal((await call({ ...request, body: { schedulerId: DEFAULT_SCHEDULER_ID, url: RUN_URL } })).code, 400);
  reason = 'unavailable';
  assert.equal((await call()).code, 404);
  for (const [value, code] of [['cooldown', 429], ['unknown', 409], ['running', 409]] as const) {
    reason = value;
    assert.equal((await call()).code, code);
  }
  assert.equal(executions, 0);
  reason='cooldown';cooldownSeconds=45;
  assert.equal((await call()).body.message,'Please wait 45 seconds between scheduler requests.');
  cooldownSeconds=30;
  assert.equal((await call()).body.message,'Please wait 30 seconds between scheduler requests.');
  cooldownSeconds=undefined;
  assert.equal((await call()).body.message,'Please wait five minutes between scheduler requests.','Old databases retain an accurate message until migration');
  reason = undefined;
  const first = call();
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await call()).code, 409);
  release();
  const result = await first;
  assert.equal(result.body.status, 'trigger_requested');
  assert.equal(result.body.success, true);
  assert.equal(executions, 1);
  assert.ok(!JSON.stringify(result.body).includes('test-only-secret'));
  occupied = false;
  failAudit = true;
  assert.equal((await call()).body.status, 'unknown');
});

function browserMock(options: { login?: boolean; tasks?: boolean; dispatchError?: boolean; status?: number; body?: string; location?: string; loginFormMissing?: boolean; taskLinkMissing?: boolean; taskListDelay?: boolean; target?: typeof NORTHPORT_TARGET; lastRuns?: [string,string] } = {}) {
  let url = '';
  let closed = 0;
  let sends = 0;
  let requestOptions: any;
  let taskListReady = !options.taskListDelay;
  const expectedUrl = schedulerUrl(options.target || NORTHPORT_TARGET);
  const child = { async waitFor() { if (options.loginFormMissing) throw new Error('secret'); }, async fill() {}, async click() {} };
  const page = {
    async goto(target: string) { url = target; return { ok: () => options.tasks !== false || target !== TASKS_URL }; },
    url: () => url,
    async waitForNavigation() { url = 'https://www.cargomove.my/bookings'; },
    locator(selector: string) {
      return {
        first() { return this; },
        locator: (selector:string) => selector==='xpath=ancestor::tr[1]' ? {locator:()=>({nth:()=>({innerText:async()=>options.lastRuns?.[sends?1:0]||'Not available'})}),waitFor:async()=>{}} : child,
        async waitFor() {
          if (options.taskLinkMissing) throw new Error();
          if (options.taskListDelay) await new Promise(resolve => setTimeout(resolve, 20));
          taskListReady = true;
        },
        count: async () => selector.startsWith('form') && options.login === false ? 1 : 0,
        evaluateAll: async () => taskListReady ? [expectedUrl] : [],
      };
    },
  };
  const context = {
    async route() {}, async newPage() { return page; },
    request: { async get(target: string, opts: any) {
      assert.equal(target, expectedUrl);
      sends++; requestOptions = opts;
      if (options.dispatchError) throw new Error('secret cookie token');
      return { status: () => options.status ?? 200, headers: () => ({ location: options.location }), text: async () => options.body ?? 'Request accepted', ok: () => (options.status ?? 200) < 300 };
    } },
  };
  const browser = { async newContext() { return context; }, async close() { closed++; } };
  return { browser, stats: () => ({ closed, sends, requestOptions }) };
}

test('automation sends exactly once, does not claim completion, and closes the browser', async () => {
  const mock = browserMock();
  let marked = 0;
  const result = await runAutomation({ username: 'test', password: 'secret' }, async () => { marked++; }, async () => mock.browser as any);
  assert.equal(result.status, 'TRIGGER_REQUESTED');
  assert.equal(marked, 1);
  assert.equal(mock.stats().sends, 1);
  assert.equal(mock.stats().closed, 1);
  assert.equal(mock.stats().requestOptions.maxRetries, 0);
  assert.equal(mock.stats().requestOptions.maxRedirects, 0);
});

test('Last run comparison handles Malaysia midnight, minute precision, missing values and future timestamps',()=>{
  const before=Date.parse('2026-10-20T15:59:50Z');
  const after=Date.parse('2026-10-20T16:00:20Z');
  assert.equal(lastRunTimestamp('Today at 11:59 PM',before),Date.parse('2026-10-20T15:59:00Z'));
  assert.equal(compareLastRun('Today at 11:59 PM','Yesterday at 11:59 PM',before,after,after).status,'UNCHANGED');
  assert.equal(compareLastRun('Today at 11:59 PM','Today at 12:00 AM',before,after,after).status,'ADVANCED');
  assert.equal(compareLastRun('Today at 12:00 AM','Today at 12:00 AM',after,after,after).status,'UNCHANGED');
  assert.equal(compareLastRun(null,'Today at 12:00 AM',before,after,after).status,'UNAVAILABLE');
  assert.equal(compareLastRun('Today at 11:59 PM','Today at 12:01 AM',before,after,after).status,'UNCHANGED');
  for(const text of ['Never','Invalid','Today at 13:00 PM','Yesterday at 12:60 AM'])assert.equal(lastRunTimestamp(text,after),null);
});

test('automation observes Last run advancing after exactly one scheduler trigger',async()=>{
  const display=(time:number)=>{const date=new Date(time+8*3600000);return `Today at ${date.getUTCHours()%12||12}:${String(date.getUTCMinutes()).padStart(2,'0')} ${date.getUTCHours()>=12?'PM':'AM'}`;};
  const now=Date.now();
  // Use yesterday for the baseline so this also works in the first minute of a day.
  const mock=browserMock({lastRuns:[display(now).replace('Today','Yesterday'),display(now)]});
  const result=await runAutomation({username:'test',password:'secret'},async()=>{},async()=>mock.browser as any);
  assert.equal(result.status,'TRIGGER_REQUESTED');
  assert.equal(result.lastRunVerification?.status,'ADVANCED');
  assert.equal(mock.stats().sends,1);
  assert.match(result.message,/Container import is not verified/);
});

test('login, missing form, access, timeout, upstream error and redirect failures are safe', async () => {
  for (const [options, status, sends] of [
    [{ login: false }, 'FAILED', 0],
    [{ loginFormMissing: true }, 'FAILED', 0],
    [{ tasks: false }, 'FAILED', 0],
    [{ taskLinkMissing: true }, 'FAILED', 0],
    [{ dispatchError: true }, 'UNKNOWN', 1],
    [{ status: 500 }, 'UNKNOWN', 1],
    [{ body: '<input type="password">' }, 'FAILED', 1],
    [{ status: 302, location: '/user/login' }, 'FAILED', 1],
    [{ status: 302, location: 'https://evil.test' }, 'UNKNOWN', 1],
    [{ status: 302, location: TASKS_URL }, 'TRIGGER_REQUESTED', 1],
  ] as const) {
    const mock = browserMock(options);
    const result = await runAutomation({ username: 'test', password: 'secret' }, async () => {}, async () => mock.browser as any);
    assert.equal(result.status, status);
    assert.equal(mock.stats().sends, sends);
    assert.equal(mock.stats().closed, 1);
    assert.ok(!result.message.includes('secret'));
  }
  const result = await runAutomation({ username: 'test', password: 'secret' }, async () => {}, async () => { throw new Error('secret'); });
  assert.equal(result.status, 'FAILED');
  const mock = browserMock();
  const blocked = await runAutomation({ username: 'test', password: 'secret' }, async () => { throw new Error(); }, async () => mock.browser as any);
  assert.equal(blocked.status, 'FAILED');
  assert.equal(mock.stats().sends, 0);
  assert.equal(mock.stats().closed, 1);
});

test('waits for asynchronous task rows before inspecting links or dispatching', async () => {
  const mock = browserMock({ taskListDelay: true });
  let marked = false;
  const result = await runAutomation({ username: 'test', password: 'secret' }, async () => { marked = true; }, async () => mock.browser as any);
  assert.equal(result.status, 'TRIGGER_REQUESTED');
  assert.equal(marked, true);
  assert.equal(mock.stats().sends, 1);
  assert.equal(mock.stats().closed, 1);
});

test('a browser that launches after the deadline is closed without dispatch', async () => {
  const mock = browserMock();
  const result = await runAutomation({ username: 'test', password: 'secret' }, async () => {},
    async () => { await new Promise(resolve => setTimeout(resolve, 20)); return mock.browser as any; }, 1);
  assert.equal(result.status, 'FAILED');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(mock.stats().closed, 1);
  assert.equal(mock.stats().sends, 0);
});

test('external URL configuration cannot change the fixed scheduler host', async () => {
  const previous = process.env.CARGOMOVE_URL;
  let launched = false;
  try {
    process.env.CARGOMOVE_URL = 'https://evil.example.test/administration/scheduled_tasks';
    const result = await runAutomation({ username: 'test', password: 'secret' }, async () => {}, async () => {
      launched = true;
      throw new Error();
    });
    assert.equal(result.status, 'FAILED');
    assert.match(result.message, /CARGOMOVE_URL/);
    assert.equal(launched, false);
  } finally {
    if (previous === undefined) delete process.env.CARGOMOVE_URL;
    else process.env.CARGOMOVE_URL = previous;
  }
});

test('response classification distinguishes script error handlers from explicit errors', () => {
  assert.equal(classifySchedulerResponse(200, undefined, '<html><script>table.on("error.dt", function () {});</script></html>').status, 'TRIGGER_REQUESTED');
  assert.equal(classifySchedulerResponse(302, `${TASKS_URL}?notice=requested`, '').status, 'TRIGGER_REQUESTED');
  assert.equal(classifySchedulerResponse(302, 'scheduled_tasks', '').status, 'TRIGGER_REQUESTED');
  assert.equal(classifySchedulerResponse(302, 'https://evil.example.test', '').status, 'UNKNOWN');
  assert.equal(classifySchedulerResponse(200, undefined, '{"success":false}').status, 'UNKNOWN');
  assert.equal(classifySchedulerResponse(200, undefined, '{"error":"failed"}').status, 'UNKNOWN');
  assert.equal(classifySchedulerResponse(200, undefined, '<div class="alert alert-danger">Failure</div>').status, 'UNKNOWN');
  assert.equal(classifySchedulerResponse(200, undefined, 'Error: failed to send').status, 'UNKNOWN');
  assert.equal(classifySchedulerResponse(200, undefined, '<input type="password">').status, 'FAILED');
});

test('scheduler URLs allow only the CargoMove task endpoint and validated parameters', () => {
  assert.deepEqual(parseSchedulerUrl(RUN_URL), NORTHPORT_TARGET);
  assert.equal(schedulerUrl(parseSchedulerUrl(RUN_URL.replace('www.cargomove.my', 'cargomove.my'))), RUN_URL);
  for (const url of [
    RUN_URL.replace('https:', 'http:'), RUN_URL.replace('www.cargomove.my', 'evil.example.test'),
    RUN_URL.replace('www.cargomove.my', 'www.cargomove.my.evil.example.test'),
    RUN_URL.replace('www.cargomove.my', 'user:password@www.cargomove.my'),
    RUN_URL.replace('run_scheduled_task', 'delete_scheduled_task'),
    RUN_URL.replace(NORTHPORT_TARGET.taskId, 'invalid'), RUN_URL + '&id=' + NORTHPORT_TARGET.taskId,
    RUN_URL + '&name=other', RUN_URL + '&redirect=https://evil.example.test', RUN_URL + '#fragment',
    RUN_URL.replace('northport_containers', 'unsafe%22%5D'),
  ]) assert.throws(() => parseSchedulerUrl(url));
});

test('gallery API enforces admin access, validates targets, persists and rejects duplicates', async () => {
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  let session: any = { id: 'actor', email: 'admin@example.test', type: 'ADMIN' };
  let revoked = false;
  const rows: any[] = [];
  const client = {
    from(table: string) {
      let payload: any;
      return {
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, timeout() { return this; },
        insert(value: any) { payload = value; return this; },
        async maybeSingle() { return { data: revoked ? null : { id: 'profile' }, error: null }; },
        async single() {
          assert.equal(table, 'cargomove_schedulers');
          if (rows.some(row => row.task_id === payload.task_id)) return { data: null, error: { code: '23505' } };
          const row = { ...payload, id: DEFAULT_SCHEDULER_ID, enabled: true };
          rows.push(row);
          return { data: row, error: null };
        },
        then(resolve: any) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
      };
    },
  };
  const handler = createSchedulerCatalog({ adminClient: () => client as any, readSession: () => session });
  const request = { method: 'POST', headers: { origin: 'https://portal.example.test', 'x-cargomove-confirm': 'manage-schedulers' },
    body: { displayName: 'Northport Containers', description: 'Manual task', url: RUN_URL } };
  const call = async (changes = {}) => { const response = responseMock(); await handler({ ...request, ...changes }, response); return response; };
  session = null;
  assert.equal((await call({ method: 'GET' })).code, 401);
  session = { id: 'actor', email: 'admin@example.test', type: 'COMPANY_ADMIN' };
  assert.equal((await call()).code, 401);
  session.type = 'ADMIN';
  revoked = true;
  assert.equal((await call()).code, 403);
  revoked = false;
  assert.equal((await call({ headers: { ...request.headers, origin: 'https://evil.example.test' } })).code, 403);
  assert.equal((await call({ body: { ...request.body, url: 'https://evil.example.test' } })).code, 400);
  assert.equal((await call({ body: { ...request.body, displayName: '' } })).code, 400);
  assert.equal(rows.length, 0);
  const saved = await call();
  assert.equal(saved.code, 201);
  assert.equal(saved.body.scheduler.url, RUN_URL);
  assert.equal(rows[0].created_by, 'actor');
  assert.equal(rows[0].task_id, NORTHPORT_TARGET.taskId);
  assert.equal((await call()).code, 409);
  const gallery = await call({ method: 'GET' });
  assert.equal(gallery.code, 200);
  assert.equal(gallery.body.schedulers.length, 1);
  assert.equal(gallery.body.schedulers[0].displayName, 'Northport Containers');
});

test('a saved target drives the exact verified automation URL', async () => {
  const target = { taskId: '5ff7ea8633904c1dd1bd892c', workerName: 'example_task' };
  const mock = browserMock({ target, taskListDelay: true });
  const result = await runAutomation({ username: 'test', password: 'secret' }, async () => {
    assert.equal(mock.stats().sends, 0);
  }, async () => mock.browser as any, 85000, target);
  assert.equal(result.status, 'TRIGGER_REQUESTED');
  assert.equal(mock.stats().sends, 1);
});

test('run API resolves only the selected saved ID and trusts the database target', async () => {
  process.env.SCHEDULER_PORTAL_URL = 'https://portal.example.test';
  process.env.CARGOMOVE_USERNAME = 'test';
  process.env.CARGOMOVE_PASSWORD = 'secret';
  const selectedId = '00000000-0000-4000-8000-000000000006';
  const target = { taskId: '5ff7ea8633904c1dd1bd892c', workerName: 'example_task' };
  const client = {
    from() { return { select() { return this; }, eq() { return this; }, timeout() { return this; }, async maybeSingle() { return { data: { id: 'profile' }, error: null }; } }; },
    async rpc(name: string, args: any) {
      if (name === 'acquire_saved_cargomove_scheduler') {
        assert.equal(args.p_scheduler_id, selectedId);
        return { data: { id: 'run-2', worker_name: target.workerName, task_id: target.taskId }, error: null };
      }
      return { data: true, error: null };
    },
  };
  let runs = 0;
  const handler = createSchedulerHandler({ adminClient: () => client as any,
    readSession: () => ({ id: 'admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 1000 }),
    runAutomation: async (_credentials, mark, _launch, _budget, actualTarget) => {
      runs++;
      assert.deepEqual(actualTarget, target);
      await mark();
      return { status: 'TRIGGER_REQUESTED', message: 'Scheduler request sent.' };
    },
  });
  const response = responseMock();
  await handler({ method: 'POST', body: { schedulerId: selectedId }, headers: { origin: 'https://portal.example.test', 'x-cargomove-confirm': 'run-scheduler' } }, response);
  assert.equal(response.code, 200);
  assert.equal(response.body.scheduler, 'example_task');
  assert.equal(runs, 1);
});

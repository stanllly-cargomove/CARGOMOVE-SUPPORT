import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/auto-register-cm.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const source = workflow.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n\s*NODE(?:\n|$)/)![1].replace(/^ {10}/gm, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const token = (index: number) => `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const response = (body: any, status = 200) => new Response(JSON.stringify(body), { status });

async function run(deliver: (index: number, body: any) => Response | Promise<Response>, start = Date.parse('2026-10-26T00:19:59Z')) {
  let clock = start;
  const requests: any[] = [], logs: string[] = [];
  await new AsyncFunction('fetch', 'process', 'setTimeout', 'console', 'Date', source)(
    async (url: URL, init: any) => {
      assert.equal(url.href, 'https://offline.example.test/api/scheduler/auto-register-cm');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer offline-workflow-secret');
      const body = JSON.parse(init.body); requests.push(body);
      return deliver(requests.length - 1, body);
    },
    { env: { VERCEL_TASK_URL: 'https://offline.example.test/api/scheduler/auto-register-cm', CRON_SECRET: 'offline-workflow-secret' },
      exit() { throw new Error('Unexpected workflow budget exit'); } },
    (callback: () => void, milliseconds: number) => { clock += milliseconds; callback(); },
    { log(value: string) { logs.push(value); } }, { now: () => clock },
  );
  assert.doesNotMatch(logs.join('\n'), /offline-workflow-secret|80000000-0000-4000-8000/);
  return { requests, logs };
}

test('GitHub follows upload, processing, verification and email continuations without waiting for another schedule', async () => {
  const phases = ['uploaded', 'processing requested', 'verified', 'email sent and Done'];
  const result = await run(index => response({ status: 'success', message: phases[index],
    continuationToken: index < 3 ? token(index + 1) : null, continuationDelayMs: 5000 }));
  assert.equal(result.requests.length, 4);
  assert.deepEqual(result.requests.slice(1), [1, 2, 3].map(index => ({ continuationToken: token(index) })));
  assert.match(result.logs.at(-1)!, /email sent and Done/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /actions\/checkout|npm install|npm run build/);
});

test('an interrupted delivery retries the identical root request across a window boundary', async () => {
  const requests: any[] = [];
  await run((index, body) => {
    requests.push(body);
    if (index === 0) throw new Error('Simulated transport interruption after the server committed');
    return response({ status: 'success', message: 'Recovered saved response', continuationToken: index === 1 ? token(1) : null });
  });
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(requests[2], { continuationToken: token(1) });
});

test('busy admission retries safely; disabled, failed and bounded chains stop', async () => {
  const busy = await run(index => index === 0 ? response({ message: 'Still running' }, 409)
    : response({ status: 'success', continuationToken: null }));
  assert.equal(busy.requests.length, 2);
  assert.deepEqual(busy.requests[0], busy.requests[1]);
  assert.equal((await run(() => response({ status: 'skipped', message: 'Disabled' }))).requests.length, 1);
  await assert.rejects(run(() => response({ status: 'failed', message: 'Gmail authorization needs attention' }, 500)), /Gmail authorization needs attention/);
  await assert.rejects(run(() => response({ status: 'success', continuationToken: 'invalid' })), /Invalid scheduler continuation/);
  const capped = await run(index => response({ status: 'success', continuationToken: index < 7 ? token(index + 1) : null,
    continuationLimitReached: index === 7 }));
  assert.equal(capped.requests.length, 8);
  assert.match(capped.logs.at(-1)!, /Step limit reached/);
});

import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { launchBrowser } from '../server-handlers/scheduler/automation.js';

const bundle = await build({
  stdin: {
    contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AutoRegisterCmPage}from'./src/components/admin/AutoRegisterCm';function App(){const[open,setOpen]=useState(true),[active,setActive]=useState(true);return <><button onClick={()=>setActive(!active)}>Change active</button>{open?<AutoRegisterCmPage pollEnabled={active} onBack={()=>setOpen(false)}/>:<button onClick={()=>setOpen(true)}>Open queue</button>}</>}createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const otherAdmin = await browser.newPage();
  await page.clock.install();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const records = [{ id: 'CMREG1', pending: true, scheduled: false }];
  let loads = 0, discoveries = 0, fail = false;
  let gate: Promise<void> | undefined;
  let release = () => {};
  const holdReads = () => { gate = new Promise<void>(resolve => { release = () => { gate = undefined; resolve(); }; }); };
  const waitUntil = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      assert.ok(Date.now() < deadline, 'Timed out waiting for intercepted requests');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, 'http://live-register.test', 'No live services may be contacted');
    if (url.pathname === '/api/scheduler/auto-register-cm') return route.fulfill({ json: {
      scheduler: { name: 'Auto Register in CM', description: 'Fixture', schedule: 'Every 20 minutes', isEnabled: true, lastRunAt: null, lastStatus: null }, runs: [],
    } });
    if (url.pathname === '/api/scheduler/auto-register-cm-queue') {
      if (request.method() === 'POST') {
        discoveries++;
        const fresh = records.filter(record => record.pending && !record.scheduled);
        fresh.forEach(record => { record.scheduled = true; });
        return route.fulfill({ json: { scheduled: fresh.length } });
      }
      loads++;
      if (gate) await gate;
      if (fail) return route.fulfill({ status: 503, json: { error: 'Temporary queue failure' } });
      return route.fulfill({ json: { history: [], registrations: records.filter(record => record.pending).map(record => ({
        id: record.id, referenceNo: record.id, registrationType: 'VEHICLE', companyName: 'Fixture', companyRegNo: '',
        submittedAt: '2026-10-26T00:00:00Z', submittedBy: 'Fixture', details: {}, recordCount: 1,
        submission: { id: record.id, status: 'PENDING', data: {} }, eligible: true, reason: null, scheduled: record.scheduled,
        queueStatus: 'SCHEDULED', firstFailureReason: null, firstFailedAt: null,
      })) } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
  });
  await otherAdmin.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'http://live-register.test');
    if (url.pathname === '/api/email/submission-send') {
      records[0].pending = false;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ contentType: 'text/html', body: '<button onclick="fetch(\'/api/email/submission-send\',{method:\'POST\'}).then(()=>this.textContent=\'Completed\')">Register & Email</button>' });
  });
  await page.goto('http://live-register.test');
  const row = (reference: string) => page.getByRole('button', { name: `Review ${reference}`, exact: true });
  await row('CMREG1').waitFor();
  assert.equal(discoveries, 1);

  records.push({ id: 'CMREG2', pending: true, scheduled: false });
  await page.clock.fastForward(15_000);
  await row('CMREG2').waitFor();
  assert.equal(discoveries, 2, 'New submissions are discovered without clicking Refresh');

  await otherAdmin.goto('http://live-register.test');
  await otherAdmin.getByRole('button', { name: 'Register & Email' }).click();
  await otherAdmin.getByRole('button', { name: 'Completed' }).waitFor();
  await page.clock.fastForward(15_000);
  await row('CMREG1').waitFor({ state: 'detached' });
  assert.equal(discoveries, 2, 'Another admin completing a submission only requires a background read');

  await page.getByRole('button', { name: 'Back to Developer Settings' }).click();
  records[1].pending = false;
  records.push({ id: 'CMREG3', pending: true, scheduled: true });
  holdReads();
  const beforeReopen = loads;
  await page.getByRole('button', { name: 'Open queue' }).click();
  await row('CMREG2').waitFor();
  assert.equal(await page.getByRole('status', { name: 'Preparing Auto Register in CM' }).count(), 0, 'Cached rows remain visible even while revalidation is blocked');
  await waitUntil(() => loads > beforeReopen);
  const inFlightLoads = loads;
  await page.clock.fastForward(60_000);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
  assert.equal(loads, inFlightLoads, 'Slow reads and focus events do not overlap requests');
  release();
  await row('CMREG3').waitFor();
  await row('CMREG2').waitFor({ state: 'detached' });
  // Drain the single coalesced focus refresh before testing paused polling.
  await page.clock.fastForward(200);
  await page.getByRole('button', { name: 'Change active' }).click();
  const pausedLoads = loads;
  await page.clock.fastForward(60_000);
  assert.equal(loads, pausedLoads, 'Inactive portal does not poll');
  await page.getByRole('button', { name: 'Change active' }).click();
  await waitUntil(() => loads > pausedLoads);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenLoads = loads;
  await page.clock.fastForward(60_000);
  assert.equal(loads, hiddenLoads, 'Hidden browser tab does not poll');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitUntil(() => loads > hiddenLoads);

  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('status').filter({ hasText: 'Live updates are temporarily unavailable' }).waitFor();
  assert.equal(await row('CMREG3').count(), 1, 'Background failure preserves usable cached rows');
  fail = false;
  records[2].pending = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.clock.fastForward(200);
  await row('CMREG3').waitFor({ state: 'detached' });
  await page.getByRole('status').filter({ hasText: 'Live updates are temporarily unavailable' }).waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('Auto Register live UI: new submissions, independent admin completion, instant cached return, serialized requests, inactive polling and failure recovery passed.');
} finally {
  await browser.close();
}

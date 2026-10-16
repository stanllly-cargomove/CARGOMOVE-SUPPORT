// Offline component interaction test. Every network request is intercepted.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { RUN_URL } from '../server-handlers/scheduler/automation.js';
import { DEFAULT_SCHEDULER_ID } from '../server-handlers/scheduler/targets.js';

const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {DeveloperSettings} from './src/components/admin/DeveloperSettings'; createRoot(document.getElementById('root')).render(<DeveloperSettings/>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
});
// A cached Playwright test browser is used here only; production uses Sparticuz.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  let requests = 0;
  let invalidResponse = false;
  let finish: (() => void) | undefined;
  const secondId = '00000000-0000-4000-8000-000000000006';
  const secondUrl = 'https://www.cargomove.my/administration/run_scheduled_task?id=5ff7ea8633904c1dd1bd892c&name=example_task';
  const saved = [{ id: DEFAULT_SCHEDULER_ID, displayName: 'Northport Containers', workerName: 'northport_containers', description: 'Manual task', url: RUN_URL, enabled: true }];
  let lastSchedulerId = '';
  let response = { success: true, status: 'trigger_requested', message: 'Scheduler request sent successfully.', timestamp: '2026-10-16T01:00:00.000Z' };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'http://scheduler.test', 'External requests are forbidden in this test');
    if (url.pathname === '/api/dev-tools/schedulers') {
      if (route.request().method() === 'GET') await route.fulfill({ json: { schedulers: saved } });
      else {
        const body = route.request().postDataJSON();
        assert.equal(route.request().headers()['x-cargomove-confirm'], 'manage-schedulers');
        if (body.url !== secondUrl) await route.fulfill({ status: 400, json: { error: 'Use a CargoMove scheduler link.' } });
        else {
          const scheduler = { ...body, id: secondId, workerName: 'example_task', enabled: true };
          saved.push(scheduler);
          await route.fulfill({ status: 201, json: { scheduler } });
        }
      }
    } else if (url.pathname === '/api/dev-tools/run-scheduler') {
      requests++;
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-cargomove-confirm'], 'run-scheduler');
      const body = route.request().postDataJSON();
      assert.deepEqual(Object.keys(body), ['schedulerId']);
      lastSchedulerId = body.schedulerId;
      await new Promise<void>(resolve => { finish = resolve; });
      if (invalidResponse) await route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not found</h1>' });
      else await route.fulfill({ status: response.success ? 200 : 502, json: response });
    } else {
      await route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    }
  });
  await page.goto('http://scheduler.test');
  await page.getByRole('heading', { name: 'CargoMove Scheduler' }).waitFor();
  await page.getByRole('heading', { name: 'Registration test tools' }).waitFor();
  await page.getByRole('button', { name: 'Add Scheduler', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Example Scheduler');
  await page.getByLabel('Scheduler link', { exact: true }).fill('https://evil.example.test');
  await page.getByRole('button', { name: 'Save Scheduler', exact: true }).click();
  await page.getByText('Use a CargoMove scheduler link.', { exact: true }).waitFor();
  await page.getByLabel('Scheduler link', { exact: true }).fill(secondUrl);
  await page.getByLabel('Description (optional)', { exact: true }).fill('Saved for future use');
  await page.getByRole('button', { name: 'Save Scheduler', exact: true }).click();
  await page.getByRole('heading', { name: 'Example Scheduler', exact: true }).waitFor();
  assert.equal(requests, 0, 'Saving must never trigger a scheduler');
  const northport = page.getByRole('article', { name: 'Northport Containers', exact: true });
  const second = page.getByRole('article', { name: 'Example Scheduler', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await northport.getByRole('button', { name: 'Run Scheduler', exact: true }).click();
  assert.equal(requests, 0);
  page.once('dialog', dialog => dialog.accept());
  await northport.getByRole('button', { name: 'Run Scheduler', exact: true }).click();
  await page.getByRole('button', { name: 'Running Scheduler...' }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Running Scheduler...' }).isDisabled());
  assert.ok(await second.getByRole('button', { name: 'Run Scheduler', exact: true }).isDisabled());
  assert.equal(await page.locator('.animate-spin').count(), 1);
  await page.waitForFunction(() => document.body.textContent?.includes('Status: Running'));
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(requests, 1);
  assert.equal(lastSchedulerId, DEFAULT_SCHEDULER_ID);
  finish();
  await page.getByRole('button', { name: 'Scheduler request sent', exact: true }).waitFor();
  assert.ok(await page.getByText('Latest request:', { exact: false }).isVisible());
  response = { ...response, success: false, status: 'unknown', message: 'Check CargoMove before another run.' };
  finish = undefined;
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Scheduler request sent', exact: true }).click();
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  finish();
  await page.getByText('Check CargoMove before another run.', { exact: true }).waitFor();
  assert.ok(await northport.getByRole('button', { name: 'Run Scheduler', exact: true }).isEnabled());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  invalidResponse = true;
  finish = undefined;
  page.once('dialog', dialog => dialog.accept());
  await second.getByRole('button', { name: 'Run Scheduler', exact: true }).click();
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  finish();
  await page.getByText(/Scheduler API was not found.*HTTP 404/).waitFor();
  assert.equal(lastSchedulerId, secondId);
  await page.reload();
  await page.getByRole('heading', { name: 'Example Scheduler', exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 2);
  console.log('Scheduler gallery UI: load, add, validation errors, persistence, no execution on save, selected task ID, confirmation, global loading lock, success/error states and mobile layout passed.');
} finally { await browser.close(); }

// Offline component interaction test. Every network request is intercepted.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { launchBrowser, RUN_URL } from '../server-handlers/scheduler/automation.js';
import { DEFAULT_SCHEDULER_ID } from '../server-handlers/scheduler/targets.js';

const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CargoMoveScheduler} from './src/components/admin/CargoMoveScheduler'; createRoot(document.getElementById('root')).render(<CargoMoveScheduler/>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
});

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  let enabled = false;
  let manualRequests = 0;
  const runs: any[] = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, 'http://scheduler.test', 'External requests are forbidden in this test');
    if (url.pathname === '/api/scheduler/auto-register-cm') {
      if (request.method() === 'GET') return route.fulfill({ json: { scheduler: {
        key: 'auto_register_cm', name: 'Auto Register in CM', description: 'Automatically execute CM registration',
        schedule: 'Every 2 hours', isEnabled: enabled, lastRunAt: runs[0]?.startedAt || null,
        lastStatus: runs[0]?.status || null, updatedAt: '2026-10-25T02:00:00.000Z',
      }, runs } });
      if (request.method() === 'PATCH') {
        assert.equal(request.headers()['x-cargomove-confirm'], 'manage-auto-register-cm');
        enabled = request.postDataJSON().isEnabled;
        return route.fulfill({ json: { isEnabled: enabled } });
      }
      manualRequests++;
      assert.equal(request.headers()['x-cargomove-confirm'], 'run-auto-register-cm');
      assert.deepEqual(request.postDataJSON(), {});
      runs.unshift({ id: 'run-1', executionType: 'MANUAL', status: 'SKIPPED', startedAt: '2026-10-25T06:00:00.000Z',
        finishedAt: '2026-10-25T06:00:01.000Z', durationMs: 1000, processedCount: 0, successCount: 0, failedCount: 0,
        message: 'No pending asset registrations are ready to process.', errorMessage: null });
      return route.fulfill({ json: { executionId: 'run-1', status: 'skipped', message: runs[0].message,
        processedCount: 0, successCount: 0, failedCount: 0 } });
    }
    if (url.pathname === '/api/dev-tools/schedulers') return route.fulfill({ json: { schedulers: [{
      id: DEFAULT_SCHEDULER_ID, displayName: 'Northport Containers', workerName: 'northport_containers', origin: 'CargoMove',
      description: 'Existing scheduler', url: RUN_URL, enabled: true, lastRun: null,
    }] } });
    return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
  });

  await page.goto('http://scheduler.test');
  await page.getByRole('heading', { name: 'Auto Register in CM', exact: true }).waitFor();
  assert.ok(await page.getByText('Every 2 hours', { exact: false }).isVisible());
  assert.ok(await page.getByText('Not scheduled', { exact: true }).isVisible());
  await page.getByRole('switch', { name: 'Enable Auto Register in CM' }).click();
  await page.getByText('Enabled', { exact: true }).waitFor();
  assert.equal(enabled, true);
  await page.getByRole('switch', { name: 'Enable Auto Register in CM' }).click();
  await page.getByText('Disabled', { exact: true }).waitFor();

  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Run Now', exact: true }).click();
  assert.equal(manualRequests, 0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Run Now', exact: true }).click();
  await page.getByText('25 Oct 2026, 2:00 pm', { exact: true }).waitFor();
  assert.equal(manualRequests, 1, 'Manual execution is allowed while automatic scheduling is off');
  await page.getByRole('button', { name: 'View logs' }).click();
  await page.getByRole('table', { name: 'Auto Register in CM execution logs' }).waitFor();
  assert.ok(await page.getByText('Northport Containers', { exact: true }).isVisible(), 'Existing scheduler remains visible');
  assert.equal(await page.evaluate(() => document.querySelector('section')!.getBoundingClientRect().right <= window.innerWidth), true);
  console.log('Auto Register in CM UI: load, persistent toggle, OFF manual run, MYT history, existing scheduler and mobile layout passed.');
} finally { await browser.close(); }

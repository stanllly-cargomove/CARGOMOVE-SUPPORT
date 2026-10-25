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
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, 'http://scheduler.test', 'External requests are forbidden in this test');
    if (url.pathname === '/api/dev-tools/schedulers') return route.fulfill({ json: { schedulers: [{
      id: DEFAULT_SCHEDULER_ID, displayName: 'Northport Containers', workerName: 'northport_containers', origin: 'CargoMove',
      description: 'Existing scheduler', url: RUN_URL, enabled: true, lastRun: null,
    }] } });
    return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
  });

  await page.goto('http://scheduler.test');
  await page.getByRole('table', { name: 'Scheduler list' }).waitFor();
  assert.ok(await page.getByText('Northport Containers', { exact: true }).isVisible());
  assert.equal(await page.evaluate(() => document.querySelector('section')!.getBoundingClientRect().right <= window.innerWidth), true);
  console.log('CargoMove scheduler gallery: saved scheduler list and mobile layout passed.');
} finally { await browser.close(); }

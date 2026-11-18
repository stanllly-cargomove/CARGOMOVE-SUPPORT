// Offline regression for result labels and action menus in the scaled portal.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { selectEirTime } from './northport-picker-helpers';

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {NorthportRecovery} from './src/components/admin/NorthportRecovery';createRoot(document.getElementById('root')).render(<NorthportRecovery onBack={()=>{}}/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile(join('dist/assets', file), 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const scale of [1, 1.25, 1.5]) {
    const page = await browser.newPage({ viewport: { width: 2272, height: 1000 }, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let downloads = 0;
    let currentType = 'GP';
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, 'http://northport.test', 'No external requests');
      if (url.pathname === '/api/dev-tools/northport-recovery') {
        if (request.method() === 'GET') return route.fulfill({ json: { history: [], uploadsEnabled: false, missingGates: [] } });
        const body = request.postDataJSON();
        if (body.action === 'download-source') {
          downloads++;
          return route.fulfill({ contentType: 'text/csv', body: 'offline fixture' });
        }
        const values = Array(20).fill('');
        values[0] = 'PCVU2589384'; values[1] = 'IMPORT-GP'; values[2] = 'EXPORT-EXP';
        if (body.action === 'editor-records') return route.fulfill({ json: { filename: `CM_CONTAINER_20261106160202_${currentType}.csv`, rows: [values], editorToken: 'offline-editor' } });
        assert.equal(body.action, 'search');
        currentType = body.type;
        return route.fulfill({ json: { matches: [{ filename: `CM_CONTAINER_20261106160202_${body.type}.csv`, type: body.type, timestamp: '2026-11-06T16:02:02', record: 1, totalRecords: 9, values, token: 'offline-token' }], errors: [], complete: true, candidates: 1 } });
      }
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      return route.fulfill({ contentType: 'text/html', body: `<link rel="stylesheet" href="/styles.css"><main class="admin-shell" style="--admin-ui-scale:${scale};padding:24px"><div id="root"></div></main><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://northport.test');
    await page.getByLabel('Container No.', { exact: true }).fill('PCVU2589384');
    await selectEirTime(page, '2026-11-06T16:07');
    for (const type of ['EX', 'GP']) {
      await page.getByRole('combobox').selectOption(type);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const table = page.getByRole('table', { name: 'Scanned File', exact: true });
      await table.getByRole('columnheader', { name: type === 'EX' ? 'EXP No.' : 'Gatepass No.', exact: true }).waitFor();
      assert.equal(await table.locator('tbody tr td').nth(1).innerText(), type === 'EX' ? 'EXPORT-EXP' : 'IMPORT-GP');
      const trigger = table.getByRole('button', { name: 'Record actions', exact: true });
      await trigger.click();
      const menu = page.getByRole('dialog', { name: 'Record actions', exact: true });
      await menu.waitFor();
      const checkPosition = async () => {
        const box = (await menu.boundingBox())!;
        const anchor = (await trigger.boundingBox())!;
        assert.ok(box.x >= 0 && box.y >= 0 && box.x+box.width <= 2273 && box.y+box.height <= 1001, `Menu fits viewport at ${scale}`);
        assert.ok(Math.abs(box.x+box.width-anchor.x-anchor.width) < 3, 'Menu aligns with its trigger');
      };
      await checkPosition();
      await page.evaluate(() => window.scrollBy(0, 60));
      await checkPosition();
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden' });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await menu.waitFor();
      const download = page.waitForEvent('download');
      await menu.getByRole('button', { name: 'Download whole file', exact: true }).click();
      await download;
      await menu.waitFor({ state: 'hidden' });
      await trigger.click();
      await page.mouse.click(2, 2);
      await menu.waitFor({ state: 'hidden' });
      await trigger.click();
      await menu.getByRole('button', { name: 'View/Edit File', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Container file editor', exact: true });
      await editor.waitFor();
      await editor.getByRole('button', { name: 'Close', exact: true }).click();
    }
    assert.equal(downloads, 2);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Northport: import/export labels and clickable action menus at 100%, 125%, and 150% passed offline.');
} finally { await browser.close(); }

// Offline navigation regression: no production requests or recovery writes.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { GENERAL_VERSION } from '../src/constants/versions';

const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AdminLayout} from './src/components/admin/AdminLayout'; createRoot(document.getElementById('root')).render(<AdminLayout user={{id:'test',email:'admin@example.test',type:location.search.includes('external')?'EXTERNAL':'ADMIN'}} onSwitchToCustomer={()=>{}} onRefreshData={async()=>{}} onLogout={()=>{}}/>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{}' },
});
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let recoveryReads = 0;
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, 'http://navigation.test');
    assert.equal(request.method(), 'GET', 'Navigation must not perform writes');
    if (url.pathname === '/api/dev-tools/northport-recovery') {
      recoveryReads++;
      return route.fulfill({ json: { history: [], uploadsEnabled: false, missingGates: [] } });
    }
    if (url.pathname === '/api/external-user-access') return route.fulfill({ json: { users: [] } });
    if (url.pathname === '/api/dev-tools/schedulers') return route.fulfill({ json: { schedulers: [] } });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  const mount = async (query = '') => {
    await page.goto(`http://navigation.test/${query}`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  };
  await mount();
  const adminNavigation = page.getByRole('navigation', { name: 'Admin navigation' });
  await adminNavigation.getByText('Tools', { exact: true }).waitFor();
  await adminNavigation.getByRole('button', { name: 'NP Container', exact: true }).click();
  await page.getByRole('heading', { name: 'Northport Container Recovery', exact: true }).waitFor();
  await page.getByText('Tools / NP Container', { exact: true }).waitFor();
  assert.equal(await adminNavigation.getByRole('button', { name: 'NP Container' }).getAttribute('aria-current'), 'page');
  await page.getByRole('button', { name: 'How it works', exact: true }).click();
  await page.getByRole('button', { name: 'Go to Admin Portal home', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Northport Container Recovery', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Open Dev Tools', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'NP Container', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Dev Setting', exact: true }).click();
  await page.getByRole('heading', { name: 'Developer Settings', exact: true }).waitFor();
  await page.getByRole('button', { name: /System Version/ }).click();
  await page.getByRole('heading', { name: 'System Version', exact: true }).waitFor();
  await page.getByLabel(`System version ${GENERAL_VERSION}`, { exact: true }).waitFor();
  await page.getByRole('region', { name: 'Page Version', exact: true }).getByRole('rowheader', { name: 'Admin Page', exact: true }).waitFor();
  await page.getByRole('region', { name: 'Page Version', exact: true }).getByRole('rowheader', { name: 'Dev Page', exact: true }).waitFor();
  const tools = page.getByRole('region', { name: 'Tool Version', exact: true });
  for (const name of ['Cargomove Registration', 'Auto Email', 'Northport Recovery']) await tools.getByRole('rowheader', { name, exact: true }).waitFor();
  await page.getByRole('region', { name: 'Version changes', exact: true }).waitFor();
  await page.getByLabel('Search pages and tools').fill('northport');
  assert.equal(await tools.getByRole('rowheader').count(), 1);
  await page.getByLabel('Search pages and tools').fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Version tables must scroll inside their panels on mobile');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Dev Setting', exact: true }).last().click();
  await page.getByRole('heading', { name: 'Developer Settings', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open Northport Container Recovery', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Return to Admin Portal', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'NP Container', exact: true }).click();
  await page.getByRole('heading', { name: 'Northport Container Recovery', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
  await adminNavigation.getByRole('button', { name: 'NP Container', exact: true }).click();
  assert.ok(recoveryReads > 0, 'The moved page must load its existing recovery API');
  await mount('?external');
  await page.getByRole('navigation', { name: 'Admin navigation' }).waitFor({ state: 'attached' });
  assert.equal(await page.getByRole('button', { name: 'NP Container', exact: true }).count(), 0, 'Recovery remains admin-only');
  assert.deepEqual(errors, []);
  console.log('Admin navigation and System Version passed: desktop, mobile, page/tool inventory, filtering, breadcrumbs and role restriction.');
} finally {
  await browser.close();
}

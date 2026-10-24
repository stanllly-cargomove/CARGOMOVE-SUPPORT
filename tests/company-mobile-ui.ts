// Production UI checks using local API fixtures. No deployed data is read or changed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const companies = Array.from({ length: 26 }, (_, index) => ({
  id: `mobile-company-${index + 1}`, name: index === 25 ? 'SOUTHERN INTERNATIONAL LOGISTICS AND TRANSPORT SERVICES (MALAYSIA) SDN BHD' : `Company ${String(index + 1).padStart(2, '0')} SDN BHD`,
  short_name: '', registration_number: `REG-${index + 1}`, registration_number_new: `202601${String(index).padStart(6, '0')}`,
  company_type: index % 2 ? 'FORWARDER' : 'HAULAGE', haulier_id: index % 2 ? '' : `H-${index + 1}`,
  port_id: index % 2 ? 'port-north' : 'port-west', status: 'ACTIVE',
  created_at: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`, updated_at: '2026-10-21T00:00:00Z',
}));
const ports = [
  { id: 'port-west', code: 'WESTPORT', display_name: 'WESTPORT', active: true },
  { id: 'port-north', code: 'NORTHPORT', display_name: 'NORTHPORT', active: true },
];
const user = { id: 'mobile-admin', email: 'admin@example.test', type: 'ADMIN', full_name: 'Mobile Test Admin' };
const root = path.resolve('dist');
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const unexpected: string[] = [];
const server = createServer((request, response) => {
  const url = new URL(request.url!, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET') { unexpected.push(`${request.method} ${url.pathname}`); response.writeHead(405).end(); return; }
    response.setHeader('Content-Type', 'application/json');
    const fixtures: Record<string, unknown> = {
      '/api/auth/session': { authenticated: true, user },
      '/api/registration-config': { ports, depots: [] },
      '/api/snapshot': { ports, depots: [], companies, submissions: [], userRegistrations: [], guideline: null },
      '/api/external-user-access': { users: [] },
      '/api/auth/profile': { profile: null },
    };
    if (!(url.pathname in fixtures)) unexpected.push(`GET ${url.pathname}`);
    response.end(JSON.stringify(fixtures[url.pathname] || {}));
    return;
  }
  const file = path.resolve(root, `.${url.pathname}`);
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  const target = existsSync(file) && statSync(file).isFile() ? file : path.join(root, 'index.html');
  response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
  response.end(readFileSync(target));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/admin`);
  await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
  await page.getByRole('button', { name: 'Open Developer', exact: true }).click();
  await page.getByRole('heading', { name: 'Company list', exact: true, level: 2 }).waitFor();
  await page.getByRole('list', { name: 'Company cards' }).waitFor();
  assert.equal(await page.getByRole('article').count(), 25);
  mkdirSync('test-results', { recursive: true });
  const noOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Page fits ${page.viewportSize()!.width}px`);
    assert.equal(await page.locator('.company-list-toolbar').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'All filters fit the toolbar');
  };
  for (const width of [320, 390, 640, 767, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    if (width < 768) {
      await page.getByRole('list', { name: 'Company cards' }).waitFor();
      assert.equal(await page.getByRole('table', { name: 'Company list', exact: true }).count(), 0);
      assert.equal(await page.getByRole('article').count(), 25);
      assert.equal(await page.getByLabel('Sort companies', { exact: true }).count(), 0, 'Sorting is removed on phones');
      const filterRow = await page.locator('.company-list-filters').evaluate(element => Array.from(element.children).map(child => Math.round(child.getBoundingClientRect().top)));
      assert.equal(new Set(filterRow).size, 1, 'Type, port and missing IDs share one row');
    } else await page.getByRole('table', { name: 'Company list', exact: true }).waitFor();
    await noOverflow();
    if (width === 390 || width === 1440) await page.screenshot({ path: `test-results/company-list-${width}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCard = page.getByRole('article', { name: companies[25].name });
  const headingBox = await mobileCard.locator('.company-card-name').boundingBox();
  const registrationBox = await mobileCard.locator('.company-card-registrations').boundingBox();
  const typeBox = await mobileCard.locator('.company-card-type').boundingBox();
  const metaBox = await mobileCard.locator('.company-card-meta').boundingBox();
  const portBox = await mobileCard.getByLabel('Port', { exact: true }).boundingBox();
  const updatedBox = await mobileCard.getByText(/^Updated /).boundingBox();
  assert.ok(headingBox && registrationBox && registrationBox.y >= headingBox.y + headingBox.height, 'Registration values appear below the company name');
  assert.ok(registrationBox && typeBox && metaBox && Math.abs(registrationBox.y - typeBox.y) < 2 && Math.abs(typeBox.x - registrationBox.x) < 2 && typeBox.y < metaBox.y, 'Company type leads the registration row');
  assert.ok(portBox && updatedBox && Math.abs(portBox.y - updatedBox.y) < 2, 'Port and updated date share one line');
  assert.ok(updatedBox && portBox && updatedBox.x < portBox.x, 'Updated date stays left of the port');
  await page.screenshot({ path: 'test-results/company-list-390.png', fullPage: false });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByLabel('Search companies', { exact: true }).fill('REG-26');
  await page.getByText('Showing 1-1 of 1', { exact: true }).waitFor({ state: 'attached' });
  await page.getByLabel('Select all companies on this page', { exact: true }).check();
  await page.getByRole('button', { name: 'Company list options' }).click();
  await noOverflow();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'EXPORT SELECTED COMPANIES' }).click();
  assert.match((await download).suggestedFilename(), /^cargomove-companies-.*\.xlsx$/);
  await page.getByRole('button', { name: 'Actions for ' + companies[25].name }).click();
  await page.getByRole('menuitem', { name: 'Edit Company Details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Master Company' });
  await dialog.waitFor();
  for (const title of ['Identity & Registration', 'Operations & IDs', 'Registered Address', 'Contact Details']) {
    await dialog.getByRole('tab', { name: new RegExp(title.replace('&', '&')) }).click();
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, `Editor fits at section ${title}`);
    await noOverflow();
  }
  await page.getByRole('button', { name: 'Close company details' }).click();
  await page.getByRole('button', { name: 'Actions for ' + companies[25].name }).click();
  await page.getByRole('menuitem', { name: 'Assign / Edit ID' }).click();
  await page.getByRole('dialog', { name: 'Assign Master Backend ID' }).waitFor();
  await noOverflow();
  await page.getByRole('button', { name: 'Close ID assignment' }).click();
  await page.getByLabel('Search companies', { exact: true }).fill('');
  await page.getByLabel('Filter companies by type').selectOption('HAULAGE');
  await page.getByText('Showing 1-13 of 13', { exact: true }).waitFor({ state: 'attached' });
  await page.getByLabel('Filter companies by port').selectOption('port-north');
  await page.getByText('No company master records matching current filters.', { exact: true }).waitFor();
  await page.getByLabel('Filter companies by type').selectOption('ALL');
  await page.getByLabel('Filter companies by port').selectOption('ALL');
  await page.getByRole('button', { name: 'Enable Missing IDs Only filter' }).click();
  await page.getByText('Showing 1-13 of 13', { exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Disable Missing IDs Only filter' }).click();
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.getByLabel('Sort companies', { exact: true }).selectOption('CREATED_ASC');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.company-mobile-list article').length === 1);
  await noOverflow();
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log('Company list passed at 320, 390, 640, 767, 768, 1024 and 1440px.');
  console.log('Search, filters, sorting, pagination, selection/export, editing sections, and ID assignment passed.');
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

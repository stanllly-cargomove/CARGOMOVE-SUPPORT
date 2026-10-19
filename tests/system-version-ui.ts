// Exercise the production bundle with mocked APIs; no live records are changed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import manifest from '../src/generated/system-versions.json';

const server = createServer((req, res) => {
  const pathname = new URL(req.url!, 'http://localhost').pathname;
  const file = path.join(process.cwd(), 'dist', pathname);
  const target = existsSync(file) && path.extname(file) ? file : path.join(process.cwd(), 'dist/index.html');
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2' } as Record<string, string>)[path.extname(target)] || 'application/octet-stream');
  res.end(readFileSync(target));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let failHistory = true;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    switch (url.pathname) {
      case '/api/auth/session': return reply({ authenticated: true, user: { id: 'test-admin', email: 'admin@example.test', type: 'ADMIN', full_name: 'Test Admin' } });
      case '/api/snapshot': return reply({ ports: [], depots: [], companies: [], submissions: [], userRegistrations: [], guideline: null });
      case '/api/external-user-access': return reply({ users: [] });
      case '/api/registration-config': return reply({ ports: [], depots: [] });
      case '/api/dev-tools/system-versions':
        assert.equal(route.request().method(), 'POST');
        assert.equal(route.request().headers()['x-cargomove-confirm'], 'record-system-versions');
        return failHistory ? reply({ error: 'History storage unavailable.' }, 503) : reply({ history: manifest.history.map((release, index) => index ? release : {
          ...release, authors: ['Alice', 'Bob'], pushedBy: 'release-user',
          commits: [{ sha: 'abcdef1234567', author: 'Alice', subject: 'Update home page' }],
        }) });
      default: throw new Error('Unexpected API: ' + url.pathname);
    }
  });
  await page.goto(origin + '/admin');
  await page.getByRole('button', { name: 'Open Dev Tools', exact: true }).click();
  await page.getByRole('button', { name: 'System Information', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Showing history from this release.' }).waitFor();
  assert.ok(await page.getByRole('cell', { name: 'Stanlly', exact: true }).count());
  failHistory = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('status').filter({ hasText: 'Version history saved to the database.' }).waitFor();
  await page.getByRole('region', { name: 'Version changes' }).getByRole('cell', { name: /Alice, Bob/ }).waitFor();
  await page.getByText('Pushed by release-user', { exact: true }).waitFor();
  for (const width of [1440, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    const pageTab = page.getByRole('tab', { name: 'Page Version' });
    const toolTab = page.getByRole('tab', { name: 'Tool Version' });
    await pageTab.click();
    assert.equal(await pageTab.getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('region', { name: 'Tool Version', exact: true }).count(), 0);
    await pageTab.press('ArrowRight');
    assert.equal(await toolTab.getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('region', { name: 'Page Version', exact: true }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Tool Version', exact: true }).count(), 1);
    for (const kind of ['Page', 'Tool']) {
      await page.getByRole('tab', { name: kind + ' Version' }).click();
      const rows = page.getByRole('region', { name: kind + ' Version', exact: true }).locator('tbody tr');
      const values = await rows.evaluateAll(elements => elements.map(row => ({
        name: row.children[0].textContent || '', area: row.children[1].textContent || '', height: row.getBoundingClientRect().height,
      })));
      const sorted = [...values].sort((a, b) => a.area.localeCompare(b.area, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
      assert.deepEqual(values, sorted, kind + ' versions should sort by area, then name');
      assert.ok(values.every(row => row.height <= 30), kind + ' version rows should be compact');
    }
    const card = await page.getByRole('region', { name: 'General Version', exact: true }).boundingBox();
    const version = await page.getByLabel('System version ' + manifest.version, { exact: true }).boundingBox();
    assert.ok(card && version);
    assert.ok(Math.abs(version.y + version.height / 2 - card.y - card.height / 2) < 2, 'Version vertically centered');
    assert.ok(Math.abs(card.x + card.width - version.x - version.width - 21) < 2, 'Version aligned to right padding');
  }
  const headers = await page.getByRole('region', { name: 'Version changes' }).getByRole('columnheader').allTextContents();
  assert.deepEqual(headers, ['Date', 'Time (MYT)', 'Author', 'Changes', 'Old version', 'New version']);
  assert.equal(await page.getByText('Existing page or tool updated:', { exact: false }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByRole('tab').count(), 0);
  assert.equal(await page.getByRole('region', { name: 'Page Version', exact: true }).count(), 1);
  assert.equal(await page.getByRole('region', { name: 'Tool Version', exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('System Version desktop, tablet, mobile, keyboard tabs, columns and save retry passed.');
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

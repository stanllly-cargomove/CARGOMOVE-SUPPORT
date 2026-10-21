// Exercise the built app and its real service worker against local, read-only API fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve('dist');
const mime: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
};
const server = createServer((request, response) => {
  const url = new URL(request.url!, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(url.pathname === '/api/auth/session'
      ? { authenticated: false, user: null }
      : url.pathname === '/api/registration-config' ? { ports: [], depots: [] } : { privateFixture: 'never cache this' }));
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
  // A regular temporary profile is needed: Chrome blocks app installation in incognito.
  const context = await chromium.launchPersistentContext('', { channel: 'chrome', headless: true });
  browser = context.browser()!;
  // Local fixtures only; don't contact any deployed service.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, [], 'Browser parses the linked manifest');
  assert.equal(manifest.url, `${origin}/manifest.webmanifest`);
  const installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, [], 'Chrome installability checks pass');
  for (const icon of JSON.parse(manifest.data!).icons) {
    const response = await context.request.get(origin + icon.src);
    assert.equal(response.headers()['content-type'], 'image/png');
    const png = await response.body();
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  console.log('Manifest, icons and Chrome installability checks passed');

  await page.evaluate(async () => {
    await fetch('/api/private-fixture');
    await fetch('/api/private-fixture', { method: 'POST', body: 'fixture' });
  });
  const cachedUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat();
  });
  assert.deepEqual(cachedUrls, ['/offline.html'], 'Only generic offline HTML is stored in Cache Storage');

  // Customers should not see an install prompt; installation remains available through the browser.
  const promptWasPrevented = await page.evaluate(`(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => { document.documentElement.dataset.installPrompted = 'true'; },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  assert.equal(promptWasPrevented, false, 'The app leaves the install prompt to the browser');
  assert.equal(await page.getByText('Install CargoMove', { exact: true }).count(), 0);

  await context.setOffline(true);
  await page.goto(`${origin}/admin?section=registrations`);
  await page.getByRole('heading', { name: "You're offline" }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/admin', 'Offline fallback preserves the requested URL');
  await assert.rejects(page.evaluate(() => fetch('/api/private-fixture')), 'APIs never receive cached offline HTML');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.locator('#root').waitFor();
  await page.getByRole('heading', { name: "You're offline" }).waitFor({ state: 'hidden' });
  console.log('Browser installation, data cache isolation, offline navigation and reconnection passed');

  const ios = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  await ios.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const iphone = await ios.newPage();
  await iphone.goto(origin);
  await iphone.waitForLoadState('networkidle');
  assert.equal(await iphone.getByText('Add to Home Screen', { exact: true }).count(), 0);
  assert.equal(await iphone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await iphone.getByRole('complementary', { name: 'Install CargoMove' }).count(), 0);
  console.log('No installation notice appears on desktop or mobile');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

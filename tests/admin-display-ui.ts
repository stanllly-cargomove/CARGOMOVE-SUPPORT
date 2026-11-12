import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const unrelated = ['CompanyMaster', 'SubmissionsList', 'PortDepotConfig', 'SchemaMappingInspector', 'GuidelineManager', 'UserRegistration', 'AdminUser', 'EmailTemplateManager', 'DeveloperSettings', 'SystemVersion', 'CargoMoveScheduler', 'AccountSettings', 'NorthportRecovery', 'AutoEmailConfig', 'AutoRegisterCm'];
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AdminLayout} from './src/components/admin/AdminLayout';createRoot(document.getElementById('root')).render(<AdminLayout user={{id:'offline',email:'admin@example.test',type:'ADMIN'}} onSwitchToCustomer={()=>{}} onRefreshData={async()=>{}} onLogout={()=>{}} onUserChange={()=>{}}/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
  loader: { '.webp': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
  plugins: [{ name: 'display-offline', setup(builder) {
    builder.onLoad({ filter: /[\\/]components[\\/].*\.tsx$/ }, args => {
      const name = basename(args.path, '.tsx');
      if (name === 'AdminDashboard' || name === 'AutoMail') return { contents: `export { ${name === 'AdminDashboard' ? 'AdminDisplayProbe' : 'AdminDisplayMailbox'} as ${name} } from './tests/fixtures/admin-display-probe';`, resolveDir: process.cwd(), loader: 'tsx' };
      if (!unrelated.includes(name)) return;
      const extra = name === 'AccountSettings' ? 'export const profileRequest=async()=>null;export function ProfileAvatar(){return null;}' : '';
      return { contents: `import React from 'react';export function ${name === 'AutoRegisterCm' ? 'AutoRegisterCmPage' : name}(){return <div>${name}</div>;} ${extra}`, loader: 'tsx' };
    });
    builder.onLoad({ filter: /[\\/]services[\\/]auth\.ts$/ }, () => ({ contents: 'export const getExternalUserAccess=async()=>[];export const subscribeToExternalUserAccess=()=>()=>{};export const createAdminUser=async()=>{throw new Error("Unexpected account creation");};' }));
    builder.onLoad({ filter: /[\\/]services[\\/]storage\.ts$/ }, () => ({ contents: 'export const getSubmissions=()=>[];export const subscribeToStorage=()=>()=>{};export const refreshProtectedStorage=async()=>{};' }));
    builder.onLoad({ filter: /[\\/]services[\\/]supabaseAuth\.ts$/ }, () => ({ contents: 'export const browserSupabaseAuth=null;' }));
  } }],
});
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile(join('dist/assets', file), 'utf8')))).join('\n');
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let reads = 0;
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url()); assert.equal(url.origin, 'http://display.test');
      if (url.pathname === '/api/dev-tools/northport-recovery') { reads++; assert.equal(req.postDataJSON().action, 'list-containers'); return route.fulfill({ json: { containers: [{ record: 1, container: 'ABCU1234567', number: 'fixture', fullEmpty: 'F' }] } }); }
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname.startsWith('/api/')) throw new Error(`Unexpected API request: ${url.pathname}`);
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://display.test/admin');
    const size = page.getByLabel('Display size', { exact: true });
    const scale = () => page.locator('.admin-shell').evaluate(element => Number(getComputedStyle(element).getPropertyValue('--admin-ui-scale')));
    const waitScale = (value: number) => page.waitForFunction(expected => Number(getComputedStyle(document.querySelector('.admin-shell')!).getPropertyValue('--admin-ui-scale')) === expected, value);
    await waitScale(1.5); assert.equal(await scale(), 1.5, 'High DPI must not apply a second scale multiplier');
    const main = await page.locator('main').boundingBox(); assert.ok(main!.x + main!.width >= 2558, 'Wide layout uses available width');
    for (const value of ['100', '115', '125', '150', 'auto']) { await size.selectOption(value); await waitScale(value === 'auto' ? 1.5 : Number(value) / 100); }
    await size.selectOption('125'); await page.reload(); await waitScale(1.25); assert.equal(await size.inputValue(), '125', 'Preference persists after reload');
    await size.selectOption('auto'); await waitScale(1.5);
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('main')!.getBoundingClientRect().left < 100);
    assert.ok((await page.locator('main').boundingBox())!.x < 100, 'Collapsed sidebar also scales');
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('main')!.getBoundingClientRect().left > 270);
    const pickerTrigger = page.getByRole('button', { name: 'EIR time (Malaysia)', exact: true });
    await pickerTrigger.click();
    const picker = page.getByRole('dialog', { name: 'EIR time (Malaysia) picker', exact: true }); await picker.waitFor();
    const anchor = await pickerTrigger.boundingBox(), popup = await picker.boundingBox();
    assert.ok(Math.abs(popup!.x - anchor!.x) < 16, 'Scaled picker stays aligned with its trigger');
    assert.ok(popup!.y >= anchor!.y + anchor!.height && popup!.y + popup!.height <= 1440, 'Picker fits below its trigger');
    await page.setViewportSize({ width: 1920, height: 1080 }); await waitScale(1.2);
    await page.waitForFunction(() => {
      const anchor = document.querySelector('[aria-label="EIR time (Malaysia)"]')!.getBoundingClientRect();
      const popup = document.querySelector('[aria-label="EIR time (Malaysia) picker"]')!.getBoundingClientRect();
      return Math.abs(anchor.x - popup.x) < 16 && popup.bottom <= innerHeight;
    });
    await page.setViewportSize({ width: 2560, height: 1440 }); await waitScale(1.5);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open container file', exact: true }).click();
    const file = page.getByRole('dialog'); await file.waitFor();
    await file.getByText('ABCU1234567', { exact: true }).waitFor();
    const fileBox = await file.boundingBox(); assert.ok(fileBox!.y >= 0 && fileBox!.x >= 0 && fileBox!.y + fileBox!.height <= 1442 && fileBox!.x + fileBox!.width <= 2562, 'Native dialog fits the scaled viewport');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open admin form', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Admin User', exact: true }); await form.waitFor();
    const formBox = await form.boundingBox(); assert.ok(formBox!.y >= 0 && formBox!.y + formBox!.height <= 1442, 'Account form stays inside the viewport');
    await form.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Auto Mail', exact: true }).click();
    const mail = page.getByRole('region', { name: 'Initializing Auto Mail', exact: true }); await mail.waitFor();
    const workspace = await mail.boundingBox(); assert.ok(Math.abs(workspace!.y + workspace!.height - 1440) < 3, 'Mailbox fits below the scaled header');
    await size.selectOption('125');
    await page.setViewportSize({ width: 390, height: 844 }); await waitScale(1);
    assert.equal(await size.isVisible(), false, 'Mobile keeps its compact header');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal page overflow');
    await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 }); await waitScale(1.25);
    await size.selectOption('auto'); await waitScale(1);
    await page.setViewportSize({ width: 1920, height: 1080 }); await waitScale(1.2);
    await page.evaluate(() => localStorage.setItem('cargomove.admin.display-size', 'invalid')); await page.reload(); await waitScale(1.2); assert.equal(await size.inputValue(), 'auto');
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage unavailable', 'SecurityError'); } }));
    await page.reload(); await waitScale(1.2); await size.selectOption('150'); await waitScale(1.5);
    assert.equal(reads, 1); assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Admin display: responsive sizing, persistence, blocked storage, DPI, sidebar, native/form dialogs, date picker and mailbox viewport passed offline.');
} finally { await browser.close(); }

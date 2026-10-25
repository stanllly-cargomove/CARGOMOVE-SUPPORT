// Offline large-queue regression: tab navigation must reuse the loaded snapshot.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const types = ['COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE'];
const statuses = ['PENDING', 'DONE', 'REJECTED'];
const companies = Array.from({ length: 1000 }, (_, index) => ({
  id: `company-${index}`, name: `FIXTURE COMPANY ${index}`, registration_number: `REG-${index}`,
  short_name: `CO${index}`, company_type: 'HAULAGE', haulier_id: `external-${index}`,
  registration_status: 'DONE', created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00Z',
}));
const submissions = statuses.flatMap((status, statusIndex) => types.flatMap((registration_type, typeIndex) =>
  Array.from({ length: 100 }, (_, index) => {
    const company = companies[index];
    return {
      id: `sub-${statusIndex}-${typeIndex}-${index}`,
      reference_no: `CMREG${400000 + statusIndex * 400 + typeIndex * 100 + index}`,
      registration_type, status, company_id: company.id, company_name: company.name,
      company_reg_no: company.registration_number, company_type: company.company_type,
      port_id: 'fixture', port_location: 'JOHOR', data: {},
      submitted_at: new Date(Date.UTC(2026, 9, 25, 0, 0, index)).toISOString(),
    };
  })));

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {AdminLayout} from './src/components/admin/AdminLayout';
  import {startProtectedStorageSync,refreshProtectedStorage} from './src/services/storage';
  const reads={companies:0,submissions:0}; window.fixtureReads=reads;
  const originalGet=Storage.prototype.getItem;
  Storage.prototype.getItem=function(key){
    if(key==='port_reg_companies_v1')reads.companies++;
    if(key==='port_reg_submissions_v1')reads.submissions++;
    return originalGet.call(this,key);
  };
  window.refreshQueue=refreshProtectedStorage;
  async function boot(){
    startProtectedStorageSync(); await refreshProtectedStorage();
    createRoot(document.getElementById('root')).render(<AdminLayout
      user={{id:'offline-admin',email:'admin@example.test',type:'ADMIN'}}
      onSwitchToCustomer={()=>{}} onRefreshData={refreshProtectedStorage}
      onLogout={()=>{}} onUserChange={()=>{}}/>);
  }
  void boot();
` }, bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css'))
  .map(file => readFile(`dist/assets/${file}`, 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  let snapshotReads = 0;
  let eligibilityRuns = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'http://queue-navigation.test');
    if (url.pathname === '/api/snapshot') {
      snapshotReads++;
      return route.fulfill({ json: { companies, submissions, ports: [], depots: [], userRegistrations: [], guideline: null } });
    }
    if (url.pathname === '/api/external-user-access') return route.fulfill({ json: { users: [] } });
    if (url.pathname === '/api/auth/profile') return route.fulfill({ json: { avatarUrl: null } });
    if (url.pathname === '/api/scheduler/auto-register-cm-queue' && route.request().method() === 'POST') {
      eligibilityRuns++;
      assert.equal(route.request().headers()['x-cargomove-confirm'], 'auto-schedule-auto-register-cm');
      assert.deepEqual(route.request().postDataJSON(), {});
      return route.fulfill({ json: { scheduled: 1 } });
    }
    if (url.pathname === '/api/scheduler/auto-register-cm-queue' && url.searchParams.get('view') === 'scheduled') {
      return route.fulfill({ json: { scheduledSubmissionIds: ['sub-0-3-0'], failedSubmissionIds: ['sub-0-3-1'] } });
    }
    if (url.pathname.startsWith('/api/')) throw new Error(`Unexpected API ${url.pathname}`);
    return route.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
  });
  await page.goto('http://queue-navigation.test');
  const nav = page.getByRole('navigation', { name: 'Admin navigation' });
  await nav.getByRole('button', { name: /Registration Queue/ }).click();
  await nav.getByRole('button', { name: /^Pending/ }).click();
  await page.getByRole('heading', { name: 'Pending Registration Submissions', exact: true }).waitFor();
  await page.getByRole('tab', { name: /^Vehicle/ }).click();
  const scheduledIndicator = page.getByRole('img', { name: 'AUTO REGISTER BY SYSTEM. The system will automatically process this scheduled registration in CargoMove.' });
  await scheduledIndicator.waitFor();
  assert.ok(eligibilityRuns >= 1, 'Opening Pending runs eligibility before loading scheduled icons');
  await scheduledIndicator.hover();
  const scheduledTooltip = page.getByRole('tooltip');
  await scheduledTooltip.waitFor();
  assert.equal(await scheduledTooltip.locator('span').first().textContent(), 'AUTO REGISTER BY SYSTEM');
  assert.equal(await scheduledTooltip.locator('span').nth(1).textContent(), 'The system will automatically process this scheduled registration in CargoMove.');
  assert.match(await scheduledTooltip.getAttribute('class') || '', /bg-slate-900.*shadow-xl/, 'Bot icon uses the Register action tooltip style');
  const failedIndicator = page.getByRole('img', { name: 'Automatic registration failed twice or could not be retried safely. Review the registration and CargoMove result.' });
  await failedIndicator.waitFor();
  assert.match(await failedIndicator.getAttribute('class') || '', /bg-red-100 text-red-700/, 'Stopped automatic registration uses a red icon');
  await page.getByRole('tab', { name: /^Company/ }).click();
  await page.evaluate(() => {
    (window as any).fixtureReads.companies = 0;
    (window as any).fixtureReads.submissions = 0;
    (window as any).queueElement = document.querySelector('[role="tablist"][aria-label="Registration type"]');
  });
  const loadedSnapshots = snapshotReads;
  const timings: number[] = [];
  for (const [label, heading] of [
    ['Closed / Done', 'Closed / Done Registration Submissions'],
    ['Rejected', 'Rejected Registration Submissions'],
    ['Pending', 'Pending Registration Submissions'],
  ]) {
    const queueMenu = nav.getByRole('button', { name: /Registration Queue/ });
    if (await queueMenu.getAttribute('aria-expanded') !== 'true') await queueMenu.click();
    await nav.getByRole('button', { name: label === 'Pending' ? /^Pending/ : label, exact: label !== 'Pending' }).click();
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    for (const type of types) {
      const title = type.charAt(0) + type.slice(1).toLowerCase();
      const elapsed = await page.getByRole('tab', { name: new RegExp(`^${title}`) }).evaluate(async button => {
        const started = performance.now();
        (button as HTMLButtonElement).click();
        await new Promise(requestAnimationFrame);
        return performance.now() - started;
      });
      timings.push(elapsed);
      assert.equal(await page.getByRole('tab', { name: new RegExp(`^${title}`) }).getAttribute('aria-selected'), 'true');
    }
  }
  assert.deepEqual(await page.evaluate(() => (window as any).fixtureReads), { companies: 0, submissions: 0 },
    'Tab/status navigation must not re-read, parse or normalize the browser data');
  assert.equal(await page.evaluate(() => (window as any).queueElement === document.querySelector('[role="tablist"][aria-label="Registration type"]')), true,
    'Status navigation reuses the mounted queue');
  assert.equal(snapshotReads, loadedSnapshots, 'Navigation must not fetch a new database snapshot');

  // Keeping navigation cached must not prevent new data from appearing.
  submissions[0].company_name = 'UPDATED COMPANY FROM BACKGROUND SYNC';
  await page.evaluate(() => (window as any).refreshQueue());
  await page.getByRole('tab', { name: /^Company/ }).click();
  await page.getByText('UPDATED COMPANY FROM BACKGROUND SYNC', { exact: true }).filter({ visible: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`1,000 companies / 1,200 submissions: 12 tab switches, three status switches, zero storage reloads/network requests; slowest click-to-frame ${Math.max(...timings).toFixed(1)}ms. Background refresh passed.`);
} finally {
  await browser.close();
}

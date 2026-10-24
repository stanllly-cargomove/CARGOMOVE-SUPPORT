// Synthetic fixtures only. Storage is replaced; no database or mailbox traffic.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CompanyMaster}from'./src/components/admin/CompanyMaster';createRoot(document.getElementById('root')).render(<CompanyMaster/>);`, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'offline-storage', setup(builder) {
    builder.onLoad({ filter: /[\\/]services[\\/]storage\.ts$/ }, () => ({ contents: `
      window.savedCompanies=[];
      export const getCompanies=()=>[];
      export const getSubmissions=()=>[];
      export const getPorts=()=>[];
      export const getDepots=()=>[];
      export const subscribeToStorage=()=>()=>{};
      export const checkDuplicateRegNo=()=>false;
      export const updateCompanyId=()=>{throw new Error('Unexpected ID write')};
      export const saveCompanyPersisted=async company=>{window.savedCompanies.push(company);return company};
    `, loader: 'js' }));
  } }],
});
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
const php = `stdClass Object
(
    [name] => EXAMPLE TRANSPORT
    [type] => haulage
    [ids] => stdClass Object
        (
            [registration] => TEST-123-X
            [registration_new] => 202601000123
        )
    [contact] => stdClass Object
        (
            [name] => EXAMPLE CONTACT
            [email] => test@example.test
        )
    [phone] => stdClass Object
        (
            [office] =>
            [fax] =>
        )
)`;
const fixtures = [
  php,
  php.replace(/ /g, '&#x20;').split('\n').join('\\\n'),
  JSON.stringify({ name: 'EXAMPLE TRANSPORT', registration_status: 'REGISTERED', ids: { registration: 'TEST-123-X', registration_new: '202601000123' } }),
  JSON.stringify({ name: 'EXAMPLE TRANSPORT', registration_number_old: 'TEST-123-X', registration_number_new: '202601000123' }),
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, 'http://company.test');
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname.startsWith('/assets/')) return route.fulfill({ path: 'dist' + url.pathname });
      assert.equal(url.pathname, '/', 'No API calls are allowed');
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://company.test');
    const saved = () => page.evaluate(() => (window as unknown as { savedCompanies: Record<string, string>[] }).savedCompanies);
    for (const [index, fixture] of fixtures.entries()) {
      await page.getByRole('button', { name: width < 640 ? 'ADD' : 'Add Company', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add New Master Company', exact: true });
      await dialog.getByRole('button', { name: 'Import company data', exact: true }).click();
      await dialog.getByRole('button', { name: 'Paste JSON', exact: true }).click();
      await dialog.getByRole('textbox').fill(fixture);
      await dialog.getByRole('button', { name: 'Confirm data', exact: true }).click();
      assert.equal(await dialog.getByLabel('Registration status', { exact: true }).inputValue(), index === 2 ? 'DONE' : 'PENDING', 'Only explicit registration_status can approve an imported company');
      await dialog.getByLabel('Registration status', { exact: true }).selectOption('DONE');
      assert.equal(await dialog.getByLabel('Old Registration No *', { exact: true }).inputValue(), 'TEST-123-X');
      assert.equal(await dialog.getByLabel('SSM New 12-Digit Reg No', { exact: true }).inputValue(), '202601000123');
      await dialog.getByLabel('Company Legal Name *', { exact: true }).press('Enter');
      for (let section = 0; section < 3; section++) await dialog.getByRole('button', { name: 'Next', exact: true }).click();
      await dialog.getByRole('button', { name: 'Create Master Company', exact: true }).waitFor();
      assert.equal((await saved()).length, index, 'Import and Next must never save');
      assert.equal(await dialog.isVisible(), true, 'Fourth page stays open for review');
      await dialog.getByRole('textbox').first().press('Enter');
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
      assert.equal((await saved()).length, index, 'Enter and repeated navigation must never save');
      await dialog.getByRole('button', { name: 'Create Master Company', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      const companies = await saved();
      assert.equal(companies.length, index + 1);
      assert.equal(companies[index].registration_number_new, '202601000123');
      assert.equal(companies[index].registration_number_old, 'TEST-123-X');
      assert.equal(companies[index].registration_status, 'DONE');
      if (index < 2) assert.equal(companies[index].office_phone, '');
    }
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Company JSON/PHP imports, new registration and explicit-only saving passed at 390/1440px.');
} finally { await browser.close(); }

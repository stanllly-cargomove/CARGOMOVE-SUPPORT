// Offline navigation regression: exercise the real App, AdminLayout, and
// Northport screen while replacing unrelated pages and external services.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { selectEirTime } from './northport-picker-helpers';

const unrelatedPages = ['AdminDashboard','CompanyMaster','SubmissionsList','PortDepotConfig','SchemaMappingInspector','GuidelineManager','UserRegistration','AdminUser','EmailTemplateManager','DeveloperSettings','SystemVersion','CargoMoveScheduler','AccountSettings','HomePage','RegistrationPage','TrackStatusPage','GuidelinePage','PortalLoginPage','PasswordResetPage'];
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'offline-navigation', setup(builder) {
    builder.onLoad({ filter: /[\\/]components[\\/].*\.tsx$/ }, args => {
      const name = basename(args.path, '.tsx');
      if (!unrelatedPages.includes(name)) return;
      const extra = name === 'AccountSettings' ? `export const profileRequest=async()=>null;export function ProfileAvatar(){return null;}` : '';
      return { contents: `import React from 'react';export function ${name}(){return <div>${name}</div>;} ${extra}`, loader: 'tsx' };
    });
    builder.onLoad({ filter: /[\\/]services[\\/]auth\.ts$/ }, () => ({ contents: `export const getApplicationSession=async()=>({authenticated:true,user:{id:'admin',email:'admin@example.test',type:'ADMIN'}});export const getExternalUserAccess=async()=>[];export const subscribeToExternalUserAccess=()=>()=>{};export const logoutApplicationUser=async()=>{};` }));
    builder.onLoad({ filter: /[\\/]services[\\/]storage\.ts$/ }, () => ({ contents: `export const getSubmissions=()=>[];export const subscribeToStorage=()=>()=>{};export const startProtectedStorageSync=()=>()=>{};export const refreshProtectedStorage=async()=>{};export const clearProtectedStorage=()=>{};` }));
    builder.onLoad({ filter: /[\\/]services[\\/]supabaseAuth\.ts$/ }, () => ({ contents: 'export const browserSupabaseAuth=null;' }));
  } }],
});
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile(join('dist/assets',file),'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390,1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(15000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let searches = 0;
    let finishBatch: (() => void) | undefined;
    const values = Array(20).fill(''); values[0] = 'MSBU4179350';
    const match = { filename: 'CM_CONTAINER_20261017012016_GP.csv', timestamp: '2026-10-17T01:20:16', type: 'GP', record: 1, totalRecords: 3, values, token: 'record-token' };
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()); assert.equal(url.origin, 'http://navigation.test');
      if (url.pathname === '/api/dev-tools/northport-recovery') {
        if (route.request().method() === 'GET') return route.fulfill({ json: { history: [], uploadsEnabled: false, missingGates: [] } });
        const body = route.request().postDataJSON(); assert.equal(body.action,'search'); searches++;
        assert.equal(body.unit,'MSBU4179350');
        if (body.cursor) { assert.equal(body.cursor,'next-batch'); await new Promise<void>(resolve => { finishBatch = resolve; }); }
        return route.fulfill({ json: { matches: [{ ...match, record: body.cursor ? 2 : 1 }], errors: [], complete: !!body.cursor, candidates: 1, nextCursor: body.cursor ? null : 'next-batch', progress: { checked: body.cursor ? 20 : 10, total: 20, files: body.cursor ? 2 : 1, records: body.cursor ? 6 : 3 } } });
      }
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://navigation.test/admin');
    async function nav(name: string) {
      const menu = page.getByRole('button',{ name: 'Open navigation menu', exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('button',{ name, exact: true }).click();
    }
    await nav('NP Container');
    await page.getByLabel('Container No.',{ exact: true }).fill('MSBU4179350');
    await selectEirTime(page,'2026-10-17T01:20:00');
    await page.getByRole('button',{ name: 'Search FTP', exact: true }).click();
    await page.getByRole('table',{ name: 'Scanned File', exact: true }).waitFor();
    await nav('Overview');
    await page.getByText('AdminDashboard',{ exact: true }).waitFor();
    await page.waitForRequest(request => request.method() === 'POST' && request.postDataJSON()?.cursor === 'next-batch');
    await nav('NP Container');
    assert.equal(await page.getByLabel('Container No.',{ exact: true }).inputValue(),'MSBU4179350');
    assert.equal(await page.getByRole('table',{ name: 'Scanned File', exact: true }).locator('tbody tr').count(),1,'Partial results survive navigation');
    assert.equal(await page.getByRole('button',{ name: 'Search FTP', exact: true }).isDisabled(),true,'The original search is still running');
    await nav('Open Dev Tools');
    await page.getByText('CompanyMaster',{ exact: true }).waitFor();
    await nav('Return to Admin Portal');
    await nav('NP Container');
    assert.equal(searches,2,'Navigation does not restart or duplicate requests');
    // The real App uses URL state for customer pages. Simulate browser routing
    // without a document reload, including its route-key changes.
    await page.evaluate(() => { history.pushState(null,'','/register'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByText('RegistrationPage',{ exact: true }).waitFor();
    await page.evaluate(() => { history.pushState(null,'','/'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByText('HomePage',{ exact: true }).waitFor();
    assert.equal(await page.getByRole('heading',{ name: 'Northport Container Recovery', exact: true }).count(),0);
    assert.ok(finishBatch); finishBatch();
    await page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.cursor === 'next-batch');
    await page.evaluate(() => { history.pushState(null,'','/admin'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByRole('button',{ name: 'Search FTP', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[aria-label="Cancel Search"]'));
    assert.equal(await page.getByRole('table',{ name: 'Scanned File', exact: true }).locator('tbody tr').count(),2,'A search completed on another page retains all results');
    assert.equal(searches,2);
    assert.equal(await page.getByText('Search cancelled.',{ exact: true }).count(),0);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('Northport navigation: searches continue across admin, developer and customer pages; progress and completed results persist on return.');
} finally { await browser.close(); }

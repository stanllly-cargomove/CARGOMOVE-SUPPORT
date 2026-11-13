// Full offline NP Query flow: portal → dispatcher → handler → fixture upstream → parser → UI.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import express from 'express';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import * as XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createDevToolsRouter } from '../api/dev-tools.js';
import { createNpQueryHandler } from '../server-handlers/np-query/handler.js';
import { queryNorthport } from '../server-handlers/np-query/service.js';
import { createWestportClient } from '../server-handlers/westport-query/service.js';
import { NP_FIELDS } from '../shared/np-query.js';

const unrelatedPages = ['AdminDashboard', 'CompanyMaster', 'SubmissionsList', 'PortDepotConfig', 'SchemaMappingInspector', 'GuidelineManager', 'UserRegistration', 'AdminUser', 'EmailTemplateManager', 'DeveloperSettings', 'SystemVersion', 'CargoMoveScheduler', 'AccountSettings', 'HomePage', 'RegistrationPage', 'TrackStatusPage', 'GuidelinePage', 'PortalLoginPage', 'PasswordResetPage', 'NorthportRecovery', 'AutoMail', 'AutoEmailConfig', 'AutoRegisterCm'];
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
  loader: { '.webp': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
  plugins: [{ name: 'np-query-offline', setup(builder) {
    builder.onLoad({ filter: /[\\/]components[\\/].*\.tsx$/ }, args => {
      const name = basename(args.path, '.tsx'); if (!unrelatedPages.includes(name)) return;
      const extra = name === 'AccountSettings' ? 'export const profileRequest=async()=>null;export function ProfileAvatar(){return null;}' : '';
      return { contents: `import React from 'react';export function ${name === 'AutoRegisterCm' ? 'AutoRegisterCmPage' : name}(){return <div>${name}</div>;} ${extra}`, loader: 'tsx' };
    });
    builder.onLoad({ filter: /[\\/]services[\\/]auth\.ts$/ }, () => ({ contents: `export const getApplicationSession=async()=>({authenticated:true,user:{id:'admin',email:'admin@example.test',type:'ADMIN'}});export const getExternalUserAccess=async()=>[];export const subscribeToExternalUserAccess=()=>()=>{};export const logoutApplicationUser=async()=>{};` }));
    builder.onLoad({ filter: /[\\/]services[\\/]storage\.ts$/ }, () => ({ contents: 'export const getSubmissions=()=>[];export const subscribeToStorage=()=>()=>{};export const startProtectedStorageSync=()=>()=>{};export const refreshProtectedStorage=async()=>{};export const clearProtectedStorage=()=>{};' }));
    builder.onLoad({ filter: /[\\/]services[\\/]supabaseAuth\.ts$/ }, () => ({ contents: 'export const browserSupabaseAuth=null;' }));
    builder.onLoad({ filter: /[\\/]services[\\/]developerSettings\.ts$/ }, () => ({ contents: 'export const startDeveloperSettingsSync=()=>()=>{};' }));
  } }],
});
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile(join('dist/assets', file), 'utf8')))).join('\n');
const fixture = await readFile(new URL('./fixtures/np-query.html', import.meta.url), 'utf8');
const fullEmptyFixture = fixture.replace('<p>Category : <span>Import</span></p>', '<p>Category : <span>Import</span></p><p>F/E : <span>F</span></p>').replace('<p>Category : <span>Export</span></p>', '<p>Category : <span>Export</span></p><p>Full/Empty : <span>Empty</span></p>');
await mkdir('test-results', { recursive: true });
let mode: 'normal' | 'many' | 'empty' | 'outage' | 'pending' | 'fe' = 'normal';
let queries = 0, clock = 10000, release: (() => void) | undefined;
let origin = '';
const westportFixture = await readFile(new URL('./fixtures/westport-query.json', import.meta.url), 'utf8');
let westportQueries = 0, westportLogins = 0;
let westportMode: 'normal' | 'many' | 'outage' | 'pending' | 'empty' | 'login' = 'normal';
const westport = createWestportClient({
  credentials: () => ({ username: 'offline-westport-user', password: 'offline-westport-password' }),
  now: () => clock,
  fetcher: async (_url, options) => {
    const data = new URLSearchParams(String(options.body || ''));
    if (data.get('action') === 'signin_attempt') { westportLogins++; return new Response('Proceed'); }
    if (data.has('userid')) return new Response('<html>Dashboard</html>', { headers: { 'Set-Cookie': 'WPTETP=offline-session; Path=/; HttpOnly; Secure; Max-Age=28800' } });
    if (data.get('action') === 'get_container') {
      westportQueries++;
      assert.equal(data.get('cont_no'), 'ABCU1234567');
      assert.match((options.headers as Record<string, string>).Cookie, /WPTETP=offline-session/);
      if (westportMode === 'pending') await new Promise<void>(resolve => { release = resolve; });
      if (westportMode === 'outage') return new Response('private diagnostics', { status: 503 });
      if (westportMode === 'login') return new Response('<form id="signin-form"></form>');
      if (westportMode === 'many') {
        const data = JSON.parse(westportFixture);
        const rows = Array.from({ length: 6 }, (_, index) => ({ ...data.aaData[index % 2], container_ref_no: `TEST${index + 1}` }));
        return new Response(JSON.stringify({ iTotalRecords: rows.length, iTotalDisplayRecords: rows.length, aaData: rows }));
      }
      return new Response(westportMode === 'empty' ? JSON.stringify({ iTotalRecords: 0, iTotalDisplayRecords: 0, aaData: [] }) : westportFixture, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }
    return new Response('<form id="signin-form"></form>', { headers: { 'Set-Cookie': 'WPTETP=initial-session; Path=/; HttpOnly; Secure' } });
  },
});
const handler = createNpQueryHandler({
  authorize: async () => ({ session: { id: 'offline-admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 10000 }, client: {} as any }),
  allowedOrigin: value => value === origin,
  requestBody: async request => request.body,
  now: () => clock += 4000,
  queryNorthport: async unit => {
    queries++;
    if (mode === 'pending') await new Promise<void>(resolve => { release = resolve; });
    return queryNorthport(unit, async (_url, options) => {
      assert.equal(String(options.body), 'cont_num_N4=SYLU5004458');
      return new Response(mode === 'outage' ? 'upstream private details' : mode === 'empty' ? 'No records found' : mode === 'many' ? Array(13).fill(fixture).join('\n') : mode === 'fe' ? fullEmptyFixture : fixture, { status: mode === 'outage' ? 503 : 200 });
    }, () => new Date(Date.UTC(2026, 10, 12, 6, 0, queries)));
  },
}, westport);
const router = createDevToolsRouter({ 'np-query': handler });
const app = express(); app.use(express.json());
app.post('/api/dev-tools/np-query', (request, response) => { request.query.route = 'np-query'; void router(request, response); });
app.get('/styles.css', (_request, response) => response.type('css').send(css));
app.get('/favicon.ico', (_request, response) => response.status(204).end());
app.get('*', (_request, response) => response.type('html').send(`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`));
const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
origin = `http://127.0.0.1:${(server.address() as any).port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [320, 390, 768, 1366, 1440, 1920, 2560]) {
    mode = 'normal'; const baseline = queries;
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(15000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { assert.equal(new URL(route.request().url()).origin, origin, 'No external browser requests'); return route.continue(); });
    await page.goto(`${origin}/admin`);
    async function nav(name: string) {
      const menu = page.getByRole('button', { name: 'Open navigation menu', exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name, exact: true }).click();
    }
    await nav('Container Query');
    await page.getByRole('heading', { name: 'Container Query', exact: true }).waitFor();
    const portSelect = page.getByLabel('Port', { exact: true });
    assert.equal(await portSelect.inputValue(), 'northport', 'Northport is selected by default');
    const northportBrand = page.getByRole('img', { name: 'Northport: Queries available', exact: true });
    await northportBrand.waitFor();
    const northportLogo = await northportBrand.locator('img').getAttribute('src');
    await northportBrand.locator('img').evaluate(image => (image as HTMLImageElement).decode());
    assert.ok(await northportBrand.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth > 0), 'Northport logo loads with its correct image format');
    const prompt = page.getByRole('region', { name: 'Container query prompt', exact: true });
    assert.equal(await prompt.getByRole('img', { name: 'Northport logo', exact: true }).getAttribute('src'), northportLogo, 'Northport prompt uses its logo');
    const displayScale = Math.min(1.5, Math.max(1, width / 1600));
    assert.equal(await page.locator('.admin-shell').evaluate(element => Number(getComputedStyle(element).getPropertyValue('--admin-ui-scale'))), displayScale);
    if (width >= 1280) {
      const layout = await page.locator('.admin-shell').evaluate(element => ({ sidebar: element.querySelector('aside')!.getBoundingClientRect().toJSON(), main: element.querySelector('main')!.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight }));
      assert.ok(Math.abs(layout.sidebar.height - layout.height) <= 2, 'Scaled sidebar fits the viewport height');
      assert.ok(layout.main.right >= width - 2 && layout.main.left <= layout.sidebar.right + 2, 'Main content fills the available width');
      const searchBox = await page.getByRole('region', { name: 'Container search' }).locator('form > div').first().boundingBox();
      assert.ok(searchBox!.height >= 44 * displayScale - 1, 'Search bar grows with the display size');
    }
    assert.equal(await page.getByRole('button', { name: 'Container Query', exact: true }).getAttribute('aria-current'), 'page');
    const input = page.getByLabel('Container Number', { exact: true });
    assert.equal(await input.getAttribute('placeholder'), 'Search container number');
    await input.fill('invalid'); await input.press('Enter');
    await page.getByRole('alert').waitFor(); assert.equal(queries, baseline);
    await input.fill(' sylu5004458 '); await input.press('Enter');
    const table = page.getByRole('table', { name: 'Container Movement', exact: true }); await table.waitFor();
    assert.equal(await input.inputValue(), 'SYLU5004458');
    const rows = table.locator('tbody tr:not([aria-hidden="true"])');
    const headers = (await table.locator('thead th').allTextContents()).map(label => label.trim().toUpperCase());
    assert.deepEqual(headers, ['CATEGORY', 'F/E', 'STAGE', 'VESSEL NAME', 'SCN', 'VESSEL ETA', 'YARD POSITION', 'GROSS WEIGHT (KG)', 'VGM (KG)']);
    for (const label of ['CATEGORY', 'F/E', 'STAGE', 'SCN', 'YARD POSITION', 'GROSS WEIGHT (KG)', 'VGM (KG)']) {
      const index = headers.indexOf(label);
      assert.equal(await table.locator('thead th').nth(index).evaluate(element => getComputedStyle(element).textAlign), 'center');
      assert.equal(await rows.first().locator('td').nth(index).evaluate(element => getComputedStyle(element).textAlign), 'center');
    }
    assert.doesNotMatch(await table.innerText(), /Recorded Movement|Upcoming\/Scheduled Movement|Show Details/);
    const fullEmptyColumn = headers.indexOf('F/E');
    assert.equal(await rows.first().locator('td').nth(fullEmptyColumn).innerText(), '\u2014', 'Unavailable F/E is not guessed');
    assert.equal(await rows.count(), 2); assert.match(await rows.nth(0).innerText(), /Import[\s\S]*Departed[\s\S]*DANUM 173[\s\S]*4,000/);
    assert.match(await rows.nth(1).innerText(), /Export[\s\S]*DANUM 115[\s\S]*30,000[\s\S]*30,000.0/);
    if (width >= 768) {
      const tableBox = await table.boundingBox();
      const regionBox = await page.getByRole('region', { name: 'Scrollable container movements' }).boundingBox();
      assert.ok(tableBox && regionBox && Math.abs(regionBox.y + regionBox.height - tableBox.y - tableBox.height) < 2, 'No empty strip remains below movement rows');
    }
    const badgeWidths = await rows.locator('td:first-child > span').evaluateAll(badges => badges.map(badge => badge.getBoundingClientRect().width));
    assert.equal(badgeWidths[0], badgeWidths[1], 'Import and Export tags have the same width');
    assert.equal(await page.getByRole('button', { name: 'Refresh Query', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Latest movement first', exact: true }).count(), 0);
    assert.equal(await page.getByText('Select a movement to expand its container details below.', { exact: false }).count(), 0);
    const searchRegion = page.getByRole('region', { name: 'Container search', exact: true });
    assert.equal(await searchRegion.getByRole('button', { name: 'Clear / Reset' }).getAttribute('title'), 'Clear / Reset');
    assert.ok(await searchRegion.getByRole('button', { name: 'Clear / Reset' }).locator('svg').count());
    assert.ok(await searchRegion.getByRole('button', { name: 'Clear / Reset' }).evaluate(element => element.parentElement?.contains(document.querySelector('#np-container-number'))), 'Clear control is inside the search bar');
    for (const format of ['PDF', 'Excel', 'CSV']) assert.ok(await searchRegion.getByRole('button', { name: format, exact: true }).isVisible(), 'Exports are alongside search controls');
    for (const [format, color] of [['CSV', 'rgb(0, 185, 189)'], ['Excel', 'rgb(31, 189, 58)'], ['PDF', 'rgb(236, 0, 140)']]) {
      const action = searchRegion.getByRole('button', { name: format, exact: true });
      assert.equal(await action.evaluate(element => getComputedStyle(element).backgroundColor), color);
      assert.equal(await action.locator('svg[aria-hidden="true"]').count(), 1, 'Export buttons use accessible file icons');
      assert.ok(Math.abs(await action.evaluate(element => element.getBoundingClientRect().width / Number(getComputedStyle(element.closest('.admin-shell')!).getPropertyValue('--admin-ui-scale'))) - 48) < 1, 'Download buttons have the reduced width');
      assert.equal(await action.evaluate(element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()), '');
    }
    if (width >= 1366) {
      const toolbar = await searchRegion.locator('input, button').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return box.y + box.height / 2; }));
      assert.ok(Math.max(...toolbar) - Math.min(...toolbar) < 2, 'Search and all actions share one desktop row');
    }
    const summary = page.getByRole('region', { name: 'Container Details', exact: true });
    assert.equal(await summary.count(), 0, 'Details start collapsed; movement history is the first result');
    assert.equal(await page.getByRole('region', { name: 'Container Summary', exact: true }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Container search', exact: true }).evaluate(element => getComputedStyle(element).boxShadow), 'none', 'Search controls have no card wrapper');
    await page.screenshot({ path: `test-results/np-query-movements-${width}.png` });
    await rows.first().locator('td').nth(0).click();
    await summary.waitFor();
    assert.equal(await rows.first().getByRole('button', { name: /^Collapse Import movement,/ }).getAttribute('aria-expanded'), 'true');
    assert.ok(await summary.evaluate(element => !!(document.querySelector('table[aria-label="Container Movement"]')!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Details follow the movement table');
    assert.match(await summary.innerText(), /Recorded Movement · Source record 2/);
    assert.doesNotMatch(await summary.innerText(), /30,000/);
    const expectedFields = Object.keys(NP_FIELDS).sort();
    const summaryFields = () => summary.locator('[data-np-field]').evaluateAll(elements => elements.map(element => element.getAttribute('data-np-field')).sort());
    assert.deepEqual(await summaryFields(), expectedFields, 'Import always renders the complete fixed field set');
    for (const name of ['Common Details', 'Vessel / Voyage', 'Timeline', 'Port Routing', 'Yard & Haulage']) await summary.getByRole('region', { name, exact: true }).waitFor();
    assert.deepEqual(await summary.locator('.np-timeline-label').evaluateAll(elements => elements.map(element => element.firstChild?.textContent)), ['Time In', 'Time Stack', 'Time Request(Delv)', 'Time Load(Delv)', 'Time Out'], 'Timeline retains Northport field names');
    const vessel = summary.getByRole('table', { name: 'Vessel information' });
    assert.deepEqual((await vessel.locator('thead th').allTextContents()).map(text => text.trim()), ['Details', 'IN (IMPORT)', 'OUT (EXPORT)']);
    assert.ok(await vessel.locator('thead th').nth(1).evaluate(element => element.classList.contains('bg-emerald-100')));
    assert.ok(await vessel.locator('thead th').nth(2).evaluate(element => element.classList.contains('bg-red-100')));
    assert.notEqual(await vessel.locator('thead th').nth(1).evaluate(element => getComputedStyle(element).backgroundColor), await vessel.locator('thead th').nth(2).evaluate(element => getComputedStyle(element).backgroundColor));
    assert.equal(await summary.locator('[data-np-field="grossWeight"] dd').innerText(), '4,000');
    assert.equal(await summary.locator('[data-np-field="vgm"] dd').innerText(), '—');
    assert.equal(await summary.locator('[data-np-field="vesselImport"]').innerText(), 'DANUM 173 (LMY998290)');
    assert.equal(await summary.locator('[data-np-field="vesselExport"]').innerText(), '—');
    const beforeSwitch = queries;
    await rows.nth(1).locator('td').nth(0).click();
    assert.deepEqual(await summaryFields(), expectedFields, 'Export uses fixed slots even when timestamps are missing');
    assert.equal(await summary.locator('[data-np-field="grossWeight"] dd').innerText(), '30,000');
    assert.equal(await summary.locator('[data-np-field="vgm"] dd').innerText(), '30,000.0');
    assert.equal(await summary.locator('[data-np-field="vesselImport"]').innerText(), '—');
    assert.equal(await summary.locator('[data-np-field="vesselExport"]').innerText(), 'DANUM 115 (LMY13941)');
    assert.match(await summary.innerText(), /Upcoming\/Scheduled Movement · Source record 1/);
    assert.doesNotMatch(await summary.innerText(), /Departed|DANUM 173|17:42:52/);
    await summary.screenshot({ path: `test-results/np-query-export-${width}.png`, style: 'header { visibility: hidden !important; }' });
    await rows.nth(0).locator('td').nth(0).click();
    assert.equal(queries, beforeSwitch, 'Switching a movement only selects its stored source record');
    const initialLayout = await page.evaluate(() => ({
      viewport: innerWidth, scroll: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > innerWidth && getComputedStyle(element).position !== 'fixed').slice(0, 8).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })),
    }));
    assert.ok(initialLayout.scroll <= initialLayout.viewport, JSON.stringify(initialLayout, null, 2));
    if (width === 1440 || width <= 390) assert.equal(await summary.locator('.np-record-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), width === 1440 ? 3 : 1, 'Summary sections adapt to the available width');
    await summary.screenshot({ path: `test-results/np-query-${width}.png`, style: 'header { visibility: hidden !important; }' });
    const heights = await summary.locator('.np-info-header').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    assert.equal(new Set(heights).size, 1, 'All detail card headers align to the same height');
    assert.doesNotMatch(await summary.innerText(), /Original Northport fields|All values use source record|Northport local time/);
    assert.deepEqual(await summary.locator('.np-record-column').evaluateAll(columns => columns.map(column => [...column.querySelectorAll(':scope > section')].map(card => card.getAttribute('aria-label')))), [['Common Details'], ['Yard & Haulage', 'Vessel / Voyage'], ['Timeline', 'Port Routing']]);
    assert.equal(await summary.locator('.np-record-layout > section').count(), 0, 'Permissions are no longer a standalone card');
    if (width >= 1440) {
      const yard = await summary.getByRole('region', { name: 'Yard & Haulage', exact: true }).boundingBox();
      const timeline = await summary.getByRole('region', { name: 'Timeline', exact: true }).boundingBox();
      assert.ok(yard && timeline && Math.abs(yard.height - timeline.height) < 2 && Math.abs(yard.y - timeline.y) < 2, 'Yard and Timeline have matching heights and align at the top');
      const bottoms = await summary.locator('.np-record-column').evaluateAll(columns => columns.map(column => column.lastElementChild!.getBoundingClientRect().bottom));
      assert.ok(Math.max(...bottoms) - Math.min(...bottoms) < 2, 'All desktop card columns end at the same height');
    }
    const alignedTimeline = await summary.locator('.np-timeline-value-row').evaluateAll(rows => rows.every(row => {
      const label = row.querySelector('.np-timeline-label')!.getBoundingClientRect(), time = row.querySelector('time')!.getBoundingClientRect(), bounds = row.getBoundingClientRect();
      return Math.abs(label.y - time.y) < 2 && time.right <= bounds.right + 1 && label.right <= time.left;
    }));
    assert.ok(alignedTimeline, 'Timeline labels and right-aligned timestamps share one line without overlap');
    const toggle = rows.first().getByRole('button', { name: /^Collapse Import movement,/ });
    await toggle.click(); assert.equal(await summary.count(), 0, 'Clicking the same movement collapses its details');
    const show = rows.first().getByRole('button', { name: /^Expand Import movement,/ });
    await show.focus(); await show.press('Enter'); await summary.waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'Details expand inline');
    const permissionsButton = summary.getByRole('button', { name: 'Holds & Permissions', exact: true });
    const permissions = summary.getByRole('region', { name: 'Holds & Permissions', exact: true });
    assert.equal(await permissions.isVisible(), false);
    await permissionsButton.hover(); await permissions.waitFor();
    assert.match(await permissions.innerText(), /CUSTOMS_IMP_PRM/);
    const permissionBox = await permissions.boundingBox();
    assert.ok(permissionBox && permissionBox.x >= 0 && permissionBox.x + permissionBox.width <= width, 'Hover information stays inside the viewport');
    await permissionsButton.press('Escape'); assert.equal(await permissions.isVisible(), false);
    assert.equal(await summary.count(), 1, 'Dismissing permissions keeps movement details open');
    await permissionsButton.focus(); await permissionsButton.press('Tab');
    await permissionsButton.focus(); await permissions.waitFor();
    await permissionsButton.press('Escape');
    await permissionsButton.click(); await permissions.waitFor();
    await summary.getByRole('heading', { name: 'Container Details', exact: true }).click();
    assert.equal(await permissions.isVisible(), false, 'A tap outside dismisses permissions');
    await summary.getByRole('button', { name: 'Collapse movement details', exact: true }).click();
    assert.equal(await summary.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'np-movement-toggle-1');
    await show.click(); await summary.waitFor();
    await page.getByLabel('Category filter').selectOption('Export'); assert.equal(await rows.count(), 1); assert.equal(await summary.count(), 0, 'Filtering collapses details');
    await page.getByLabel('Category filter').selectOption('All');
    await page.getByLabel('Filter movements').fill('269SI9'); assert.equal(await rows.count(), 1);
    await page.getByLabel('Filter movements').fill('no match'); await page.getByText('No data available in table', { exact: true }).waitFor();
    await page.getByLabel('Filter movements').fill('');
    await table.getByRole('button', { name: 'Gross Weight (kg)', exact: true }).click();
    await table.getByRole('button', { name: 'Gross Weight (kg)', exact: true }).click();
    assert.match(await rows.first().innerText(), /Export/);
    await table.getByRole('button', { name: 'Gross Weight (kg)', exact: true }).click();
    assert.match(await rows.first().innerText(), /Import/);
    for (const format of ['PDF', 'Excel', 'CSV']) {
      const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: format, exact: true }).click();
      const download = await downloadPromise; const path = await download.path(); assert.ok(path);
      const bytes = await readFile(path);
      if (format === 'CSV') { assert.match(bytes.toString('utf8'), /"4000"/); assert.match(bytes.toString('utf8'), /"30000.0"/); }
      else if (format === 'PDF') {
        assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
        const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
        assert.equal(pdf.numPages, 2, 'PDF contains both complete movement records');
        const page = await pdf.getPage(1); assert.equal(page.getViewport({ scale: 1 }).width, 595);
        assert.ok((await page.getOperatorList()).fnArray.length > 0); await pdf.loadingTask.destroy();
      }
      else { const book = XLSX.read(bytes, { type: 'buffer' }); const exported = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1 }); assert.equal(exported.length, 3); assert.ok(exported[2].includes('30000.0')); }
    }
    const previousTime = await page.locator('[data-np-query-updated]').innerText();
    const idleSearchBox = await page.getByRole('button', { name: 'Search', exact: true }).boundingBox();
    mode = 'pending'; const beforePending = queries;
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#np-container-number')?.disabled);
    assert.equal(await page.getByRole('button', { name: 'Search', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Search', exact: true }).locator('svg.animate-spin').count(), 1);
    const loadingSearchBox = await page.getByRole('button', { name: 'Search', exact: true }).boundingBox();
    assert.equal(loadingSearchBox?.width, idleSearchBox?.width, 'Loading preserves Search button width');
    assert.equal(loadingSearchBox?.height, idleSearchBox?.height, 'Loading preserves Search button height');
    assert.equal(await page.getByRole('button', { name: 'Clear / Reset', exact: true }).isDisabled(), true);
    assert.equal(await portSelect.isDisabled(), true, 'Port cannot change while a query is running');
    // Server-side latch proves only one query is active while all search controls are disabled.
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    mode = 'normal'; release(); release = undefined;
    await page.locator('button[type="submit"][aria-busy="false"]').waitFor();
    assert.equal(queries, beforePending + 1); assert.notEqual(await page.locator('[data-np-query-updated]').innerText(), previousTime); assert.equal(await summary.count(), 0, 'A successful refresh starts with collapsed details');
    await rows.first().locator('td').nth(0).click(); await summary.waitFor();
    mode = 'outage'; await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /last successful query/); assert.equal(await rows.count(), 2); assert.equal(await summary.count(), 1, 'A failed refresh retains the last successful selected record');
    mode = 'fe'; await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.locator('button[type="submit"][aria-busy="false"]').waitFor();
    assert.equal(await rows.first().locator('td').nth(fullEmptyColumn).innerText(), 'F');
    assert.equal(await rows.nth(1).locator('td').nth(fullEmptyColumn).innerText(), 'E');
    await table.getByRole('button', { name: 'F/E', exact: true }).click();
    assert.match(await rows.first().innerText(), /Export/);
    await table.getByRole('button', { name: 'F/E', exact: true }).click();
    await table.getByRole('button', { name: 'F/E', exact: true }).click();
    await page.getByLabel('Filter movements').fill('Full'); assert.equal(await rows.count(), 1); assert.match(await rows.first().innerText(), /Import/);
    assert.equal(await table.locator('tbody tr[aria-hidden="true"] td').count(), headers.length, 'A single movement shows one blank striped table row');
    await page.getByLabel('Filter movements').fill('Empty'); assert.equal(await rows.count(), 1); assert.match(await rows.first().innerText(), /Export/);
    await page.getByLabel('Filter movements').fill('');
    const beforePortSwitch = queries;
    const logos = new Set([northportLogo]);
    await portSelect.selectOption('westport');
    const westportBrand = page.getByRole('img', { name: 'Westport: Queries available', exact: true });
    await westportBrand.waitFor(); logos.add(await westportBrand.locator('img').getAttribute('src'));
    assert.equal(await table.count(), 0, 'Northport results clear when Westport is selected');
    assert.equal(await input.isDisabled(), false);
    assert.match(await page.getByRole('region', { name: 'Container query prompt' }).innerText(), /company’s Westports account/);
    const westportBaseline = westportQueries;
    await input.fill('bad'); await input.press('Enter'); await page.getByRole('alert').waitFor();
    assert.equal(westportQueries, westportBaseline);
    westportMode = 'normal'; await input.fill(' abcu1234567 '); await input.press('Enter'); await table.waitFor();
    assert.equal(await input.inputValue(), 'ABCU1234567');
    assert.deepEqual(await table.locator('thead th').allTextContents(), ['Category', 'ORDER TYPE', 'CONTAINER NO', 'STACKED TIME', 'CONTAINER REF NO', 'CARRIER', 'LINE', 'CONTAINER TYPE', 'F/E', 'STATUS', 'VESSEL NAME', 'SCN', 'EXPORT SCN', 'SEQUENCE']);
    assert.equal(await table.locator('tbody tr').count(), 2);
    assert.equal(await page.getByLabel('Rows per page').inputValue(), '2');
    assert.deepEqual(await page.getByLabel('Rows per page').locator('option').allTextContents(), ['2', '10', '20', '50']);
    assert.match(await table.innerText(), /12\/11\/2026 17:12/);
    assert.ok(!(await table.innerText()).includes('20261112171200'));
    assert.match(await table.locator('tbody tr').first().locator('td').first().innerText(), /Export/);
    assert.match(await table.locator('tbody tr').nth(1).locator('td').first().innerText(), /Import/);
    assert.ok(await table.locator('tbody tr').first().locator('td').first().locator('span').evaluate(element => element.classList.contains('bg-red-500')));
    assert.ok(await table.locator('tbody tr').nth(1).locator('td').first().locator('span').evaluate(element => element.classList.contains('bg-emerald-600')));
    const westportDetails = page.getByRole('region', { name: 'Container Details', exact: true });
    const queriesBeforeDetails = westportQueries;
    await table.getByRole('button', { name: 'Expand Import movement, source record 2', exact: true }).click();
    await westportDetails.waitFor(); assert.match(await westportDetails.innerText(), /Source record 2/);
    assert.match(await westportDetails.innerText(), /12\/11\/2026 17:12/); assert.match(await westportDetails.innerText(), /TEST000002/);
    assert.equal(westportQueries, queriesBeforeDetails, 'Opening a movement uses the selected source record without another query');
    if (width === 1440 || width === 390) await page.screenshot({ path: `test-results/container-query-westport-details-${width}.png` });
    await westportDetails.getByRole('button', { name: 'Collapse movement details' }).press('Escape');
    assert.equal(await westportDetails.count(), 0); assert.equal(await page.evaluate(() => document.activeElement?.id), 'westport-movement-toggle-1');
    await table.locator('tbody tr').first().locator('td').nth(2).click(); await westportDetails.waitFor();
    assert.match(await westportDetails.innerText(), /Source record 1/); assert.match(await westportDetails.innerText(), /TEST000001/);
    await westportDetails.getByRole('button', { name: 'Collapse movement details' }).click();
    await page.getByLabel('Filter movements').fill('Export'); assert.equal(await table.locator('tbody tr').count(), 1);
    assert.match(await table.locator('tbody tr').first().innerText(), /MTI/);
    await page.getByLabel('Filter movements').fill('12/11/2026'); assert.equal(await table.locator('tbody tr').count(), 1);
    await page.getByLabel('Filter movements').fill('TEST & CO'); assert.equal(await table.locator('tbody tr').count(), 1);
    for (const format of ['CSV', 'Excel', 'PDF']) {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: format, exact: true }).click()]);
      assert.match(download.suggestedFilename(), /^Westport_Query_ABCU1234567\./);
      const bytes = await readFile((await download.path())!);
      if (format === 'CSV') { assert.match(bytes.toString('utf8'), /TEST & CO/); assert.ok(!bytes.toString('utf8').includes('MTI')); assert.match(bytes.toString('utf8'), /"OUT","FOT"/); assert.match(bytes.toString('utf8'), /20261112171200/); }
      else if (format === 'Excel') { const book = XLSX.read(bytes, { type: 'buffer' }); assert.equal(XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1 }).length, 2); }
      else { const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise; assert.equal(pdf.numPages, 1); await pdf.loadingTask.destroy(); }
    }
    await page.getByLabel('Filter movements').fill('');
    await table.getByRole('button', { name: 'Category', exact: true }).click();
    await table.getByRole('button', { name: 'Category', exact: true }).click();
    assert.match(await table.locator('tbody tr').first().innerText(), /^Import/);
    westportMode = 'many'; await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '1–2 of 6 movements' }).waitFor();
    await table.getByRole('button', { name: 'Expand Export movement, source record 1', exact: true }).click(); await westportDetails.waitFor();
    await page.getByRole('button', { name: 'Next movement page' }).click(); assert.equal(await westportDetails.count(), 0);
    assert.equal(await table.locator('tbody tr').count(), 2);
    await table.getByRole('button', { name: 'Expand Export movement, source record 3', exact: true }).click(); await westportDetails.waitFor();
    assert.match(await westportDetails.innerText(), /TEST3/); assert.match(await westportDetails.innerText(), /Source record 3/);
    await page.getByLabel('Rows per page').selectOption('10'); assert.equal(await table.locator('tbody tr').count(), 6); assert.equal(await westportDetails.count(), 0);
    await page.getByLabel('Rows per page').selectOption('2'); assert.equal(await table.locator('tbody tr').count(), 2);
    const previousLogins = westportLogins;
    westportMode = 'pending'; await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#container-query-port')?.disabled);
    assert.equal(await input.isDisabled(), true);
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    westportMode = 'normal'; release(); release = undefined;
    await page.locator('button[type="submit"][aria-busy="false"]').waitFor();
    assert.equal(westportLogins, previousLogins, 'Warm Westport searches reuse the session');
    westportMode = 'outage'; await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /last successful query/);
    assert.equal(await table.locator('tbody tr').count(), 2);
    assert.ok(!(await page.getByRole('alert').innerText()).includes('private diagnostics'));
    if (width === 1440 || width === 390) await page.screenshot({ path: `test-results/container-query-westport-${width}.png` });
    westportMode = 'empty'; await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByText('No data available in table', { exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Clear / Reset', exact: true }).click(); assert.equal(await table.count(), 0);
    westportMode = 'login'; await input.fill('ABCU1234567'); await input.press('Enter');
    await page.getByRole('alert').waitFor(); assert.equal(await table.count(), 0, 'An HTTP 200 login page never renders an empty movement table');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Westport controls and results fit the viewport');
    clock += 61000; westportMode = 'normal';
    for (const [id, name] of [['kuantan', 'Kuantan Port'], ['penang', 'Penang Port']]) {
      await portSelect.selectOption(id);
      const portCard = page.getByRole('region', { name: `${name} coming soon`, exact: true });
      await portCard.waitFor();
      const brand = page.getByRole('img', { name: `${name}: Coming soon`, exact: true });
      const logo = brand.locator('img');
      await logo.evaluate(image => (image as HTMLImageElement).decode());
      assert.ok(await logo.evaluate(image => (image as HTMLImageElement).naturalWidth > 0));
      logos.add(await logo.getAttribute('src'));
      assert.equal(await logo.evaluate(element => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const context = canvas.getContext('2d')!; context.drawImage(element as HTMLImageElement, 0, 0, 64, 64); return context.getImageData(0, 0, 1, 1).data[3]; }), 0, 'Circle logo has a transparent background');
      const cardLogo = portCard.getByRole('img', { name: `${name} logo`, exact: true });
      await cardLogo.evaluate(image => (image as HTMLImageElement).decode());
      if (id === 'kuantan' || id === 'penang') assert.notEqual(await cardLogo.getAttribute('src'), await logo.getAttribute('src'), 'Circle symbol and existing card wordmark use separate images');
      assert.equal(await table.count(), 0, 'Previous port movements are cleared');
      assert.equal(await summary.count(), 0, 'Previous port details are cleared');
      assert.equal(await input.isVisible(), true, 'Search bar remains visible');
      assert.equal(await input.isDisabled(), true, 'Coming soon search input is inactive');
      for (const action of ['Search', 'CSV', 'Excel', 'PDF']) {
        const control = page.getByRole('button', { name: action, exact: true });
        assert.equal(await control.isVisible(), true, `${action} stays visible`);
        assert.equal(await control.isDisabled(), true, `${action} is inactive for coming soon ports`);
      }
      await page.getByRole('region', { name: 'Container search' }).locator('form').evaluate(form => (form as HTMLFormElement).requestSubmit());
      assert.equal(await page.getByText('Select Northport to search container movements.', { exact: true }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Port controls fit the viewport');
      if (width === 1440 || width === 390) await page.screenshot({ path: `test-results/container-query-${id}-${width}.png` });
    }
    assert.equal(logos.size, 4, 'Every port displays its own logo');
    assert.equal(queries, beforePortSwitch, 'Selecting coming soon ports makes no upstream queries');
    await portSelect.selectOption('northport');
    assert.equal(await input.inputValue(), '');
    assert.equal(await table.count(), 0, 'Returning to Northport starts with a fresh search');
    assert.equal(await northportBrand.locator('img').getAttribute('src'), northportLogo);
    await input.fill('SYLU5004458');
    mode = 'many'; await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.locator('button[type="submit"][aria-busy="false"]').waitFor();
    assert.equal(await rows.count(), 10);
    await page.getByRole('button', { name: 'Next movement page' }).click(); assert.equal(await rows.count(), 10);
    await page.getByRole('button', { name: 'Next movement page' }).click(); assert.equal(await rows.count(), 6);
    await page.getByLabel('Rows per page').selectOption('20'); assert.equal(await rows.count(), 20);
    await page.getByLabel('Rows per page').selectOption('50'); assert.equal(await rows.count(), 26);
    const beforeRecordSelect = queries;
    await rows.nth(25).locator('td').nth(0).click(); await summary.waitFor();
    assert.match(await summary.innerText(), /Source record 25/);
    assert.equal(await summary.locator('[data-np-field="grossWeight"] dd').innerText(), '30,000');
    assert.equal(queries, beforeRecordSelect, 'Every historical movement can be opened without querying again');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal page overflow');
    if (width <= 768) assert.ok(await page.getByRole('region', { name: 'Scrollable container movements' }).evaluate(element => element.scrollWidth > element.clientWidth), 'Table scrolls within its own region');
    if (width === 390) { await page.getByRole('region', { name: 'Scrollable container movements' }).evaluate(element => element.scrollLeft = element.scrollWidth); assert.ok(await page.getByRole('region', { name: 'Scrollable container movements' }).evaluate(element => element.scrollLeft > 0)); }
    await page.getByRole('button', { name: 'Clear / Reset', exact: true }).click();
    assert.equal(await input.inputValue(), ''); assert.equal(await table.count(), 0);
    mode = 'empty'; await input.fill('SYLU5004458'); await input.press('Enter');
    await table.waitFor();
    assert.equal(await table.locator('thead th').count(), headers.length);
    assert.equal(await rows.count(), 1);
    assert.equal(await rows.first().locator('td').count(), 1);
    assert.equal(await rows.first().locator('td').getAttribute('colspan'), String(headers.length));
    assert.equal(await rows.first().innerText(), 'No data available in table');
    assert.equal(await page.getByRole('status').filter({ hasText: '0 of 0 movements' }).count(), 1);
    assert.equal(await page.getByRole('alert').count(), 0);
    await nav('NP Container'); await page.getByText('NorthportRecovery', { exact: true }).waitFor();
    await nav('Container Query'); await page.getByRole('heading', { name: 'Container Query', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Container Query: Northport and Westport desktop, tablet and mobile portal/API flow, details, sorting, filters, pagination, session reuse, login rejection and PDF/Excel/CSV downloads passed offline.');
} finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

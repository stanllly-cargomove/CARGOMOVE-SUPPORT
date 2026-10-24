// Offline UI: uploads, downloads, persistence and verification are fully intercepted.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import * as XLSX from 'xlsx';

const bundle = await build({ stdin: { contents: `
  import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
  import{SubmissionsList}from'./src/components/admin/SubmissionsList';
  import{SubmissionDetailModal}from'./src/components/admin/SubmissionDetailModal';
  import{NotificationToaster}from'./src/components/common/NotificationToaster';
  import{getSubmissions,subscribeToStorage,startProtectedStorageSync}from'./src/services/storage';
  function App(){const[,tick]=useState(0),[review,setReview]=useState(false);
    useEffect(()=>{const unsubscribe=subscribeToStorage(()=>tick(n=>n+1));const stop=startProtectedStorageSync();return()=>{unsubscribe();stop();}},[]);
    return <><button onClick={()=>setReview(true)}>Single review fixture</button><SubmissionsList status="PENDING" initialType="DRIVER"/>
      <SubmissionDetailModal submission={getSubmissions()[0]||null} isOpen={review} onClose={()=>setReview(false)} onOpenAssignId={()=>{}}
        onStatusChange={()=>tick(n=>n+1)} onExportSuccess={s=>{window.verifiedReference=s.reference_no;}}/><NotificationToaster/></>;
  }createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let starts = 0, checks = 0, companyStatus = 'PENDING', includeCompanyQueue = true;
    let sub: any = { id: 'driver', reference_no: 'CMREG400001', registration_type: 'DRIVER', company_id: 'company', company_type: 'HAULAGE', company_name: 'Fixture Haulier',
      port_id: 'port', port_location: 'JOHOR', status: 'PENDING', submitted_at: '2026-10-24T01:00:00Z', data: { drivers: [{ driving_license: '00123', name: 'Fixture', mobile_no: '0123456789' }] } };
    const summary = { id: '90000000-0000-4000-8000-000000000001', filename: 'CMREG400001_DRIVER_attempt.xlsx', expectedRows: 1,
      successCount: null, errorCount: null, updatedAt: '2026-10-24T02:00:00Z' };
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, 'http://uploads.test', 'External network access is forbidden');
      if (url.pathname === '/api/snapshot') return route.fulfill({ json: { companies: [{ id: 'company', name: 'Fixture Haulier', company_type: 'HAULAGE', haulier_id: 'fixture-id', status: 'ACTIVE', registration_status: companyStatus }],
        ports: [{ id: 'port', location: 'JOHOR', code: 'FIXTURE', display_name: 'Fixture', backend_port_id: '5ad78eeb458efa4c5a1fc007' }], depots: [], submissions: [sub, ...(includeCompanyQueue ? [{ ...sub, id: 'company-registration', reference_no: 'CMREG400000', registration_type: 'COMPANY', status: companyStatus, data: {} }] : [])], userRegistrations: [], guideline: null } });
      if (url.pathname === '/api/external-user-access') return route.fulfill({ json: { users: [] } });
      if (url.pathname === '/api/dev-tools/registration-uploads') {
        assert.equal(request.headers()['x-cargomove-confirm'], 'registration-upload');
        const body = request.postDataJSON();
        assert.equal(body.schedulerId, undefined);
        if (body.action === 'start') {
          starts++; assert.deepEqual(body.submissionIds, ['driver']);
          sub = { ...sub, cargomove_upload: { ...summary, state: starts === 1 ? 'FAILED' : 'UNKNOWN', successCount: starts === 1 ? 0 : null, message: starts === 1 ? 'CargoMove rejected the fixture file.' : 'File upload response was interrupted. Check the existing upload.' } };
          const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['DRIVINGLICENSE'], ['00123']]), 'Sheet1');
          return route.fulfill({ json: { submission: sub, nextCheckMs: 1000, download: { filename: summary.filename, base64: XLSX.write(book, { type: 'base64', bookType: 'xlsx' }) } } });
        }
        assert.equal(body.jobId, summary.id); checks++;
        sub = { ...sub, status: 'PENDING', cargomove_upload: { ...summary, state: checks >= 2 ? 'SUCCESS' : 'PROCESSING',
          message: checks >= 2 ? 'All fixture rows verified.' : 'Processing fixture.', successCount: checks >= 2 ? 1 : null, errorCount: checks >= 2 ? 0 : null } };
        return route.fulfill({ json: { submission: sub, nextCheckMs: 1000 } });
      }
      if (url.pathname.startsWith('/api/')) { errors.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } }); }
      return route.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://uploads.test');
    await page.getByText('CMREG400001', { exact: true }).filter({ visible: true }).waitFor();
    if (width < 768) await page.getByRole('checkbox', { name: 'Select CMREG400001', exact: true }).check();
    else await page.locator('tbody tr').filter({ hasText: 'CMREG400001' }).getByRole('checkbox').check();
    assert.equal(await page.getByRole('button', { name: 'REGISTER & EMAIL', exact: true }).isDisabled(), false);
    assert.equal(starts, 0);
    await page.getByRole('button', { name: 'Single review fixture', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Generate Excel & Upload', exact: true }).isDisabled(), true);
    await page.getByRole('alert').filter({ hasText: 'Register the parent company before processing' }).waitFor();
    await page.getByRole('button', { name: 'Close submission review', exact: true }).click();
    companyStatus = 'DONE';
    includeCompanyQueue = false;
    await page.reload();
    await page.getByText('CMREG400001', { exact: true }).filter({ visible: true }).waitFor();
    if (width < 768) await page.getByRole('checkbox', { name: 'Select CMREG400001', exact: true }).check();
    else await page.locator('tbody tr').filter({ hasText: 'CMREG400001' }).getByRole('checkbox').check();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'REGISTER & EMAIL', exact: true }).click();
    assert.equal((await downloadPromise).suggestedFilename(), summary.filename);
    const info = () => page.getByRole('button', { name: 'CargoMove upload information for CMREG400001', exact: true }).filter({ visible: true });
    await info().waitFor();
    const reference = page.getByText('CMREG400001', { exact: true }).filter({ visible: true }).first();
    assert.equal(await reference.evaluate(element => element.classList.contains('text-red-600')), true);
    await info().click();
    let dialog = page.getByRole('dialog', { name: 'CargoMove upload for CMREG400001', exact: true });
    await dialog.getByText('Failed to upload or process this registration in CargoMove.', { exact: true }).waitFor();
    assert.ok(await dialog.getByText('This registration remains Pending.', { exact: true }).isVisible());
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.reload(); await info().waitFor();
    assert.equal(starts, 1, 'Reload does not resubmit');
    await page.getByRole('button', { name: 'Single review fixture', exact: true }).click();
    const generate = page.getByRole('button', { name: 'Generate Excel & Upload', exact: true });
    await generate.click();
    await page.waitForFunction(() => (window as any).verifiedReference === 'CMREG400001');
    assert.equal(starts, 2); assert.equal(checks, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Registration uploads: desktop/mobile failures, red references, information popups, persistence, reference downloads and verified completion passed.');
} finally { await browser.close(); }

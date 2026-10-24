// Fully offline UI coverage: no portal, database, scheduler or email is contacted.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import * as XLSX from 'xlsx';

const bundle = await build({ stdin: { contents: `
  import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
  import{SubmissionsList}from'./src/components/admin/SubmissionsList';
  import{NotificationToaster}from'./src/components/common/NotificationToaster';
  import{startProtectedStorageSync}from'./src/services/storage';
  function App(){const[status,setStatus]=React.useState<'PENDING'|'DONE'|'REJECTED'>('PENDING');useEffect(()=>startProtectedStorageSync(),[]);(window as any).setQueueStatus=setStatus;return <><SubmissionsList status={status} initialType="DRIVER"/><NotificationToaster/></>}
  createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  let starts = 0, sends = 0, failSend = true;
  const companies = [{ id: 'registered', name: 'Registered Carrier', company_type: 'HAULAGE', registration_status: 'DONE', haulier_id: '5adc9dd77753d26fb07d6f26' },
    { id: 'pending', name: 'Pending Carrier', company_type: 'HAULAGE', registration_status: 'PENDING', haulier_id: '5adc9dd77753d26fb07d6f26' },
    { id: 'manual', name: 'Manual Carrier', company_type: 'HAULAGE', registration_status: 'DONE', haulier_id: '5adc9dd77753d26fb07d6f26' },
    { id: 'forwarder-1', name: 'Forwarder One', company_type: 'FORWARDER', registration_status: 'PENDING' },
    { id: 'forwarder-2', name: 'Forwarder Two', company_type: 'FORWARDER', registration_status: 'PENDING' }];
  let submissions: any[] = [1, 2, 3].map(n => ({ id: `driver-${n}`, reference_no: `CMREG40000${n}`, registration_type: 'DRIVER', company_id: n === 3 ? 'pending' : 'registered', company_name: n === 3 ? 'Pending Carrier' : 'Registered Carrier', company_type: 'HAULAGE',
    port_id: 'port', port_location: 'JOHOR', status: 'PENDING', submitted_at: `2026-10-24T01:00:0${n}Z`, data: { drivers: [{ driving_license: `00${n}`, name: `Driver ${n}`, mobile_no: '0123456789' }] } }));
  submissions.push({ id: 'company-1', reference_no: 'CMREG400004', registration_type: 'COMPANY', company_id: 'manual', company_reg_no: 'REG-004', company_name: 'Manual Carrier', company_type: 'HAULAGE',
    port_id: 'port', port_location: 'JOHOR', status: 'PENDING', submitted_at: '2026-10-24T01:00:04Z', data: { company: { name: 'Manual Carrier', company_type: 'HAULAGE', haulier_id: '5adc9dd77753d26fb07d6f26', registration_number_old: 'REG-004', contact_email: 'manual@example.test' } } });
  submissions.push(...[1, 2].map(n => ({ id: `company-missing-${n}`, reference_no: `CMREG40000${n + 4}`, registration_type: 'COMPANY', company_id: `forwarder-${n}`, company_reg_no: `REG-00${n + 4}`, company_name: `Forwarder ${n}`, company_type: 'FORWARDER',
    port_id: 'port', port_location: 'JOHOR', status: 'PENDING', submitted_at: `2026-10-24T01:00:0${n + 4}Z`, data: { company: { name: `Forwarder ${n}`, company_type: 'FORWARDER', registration_number_old: `REG-00${n + 4}` } } })));
  const templates = ['DONE', 'REJECTED'].flatMap(status => [1, 2].map(n => ({ id: `${status}-${n}`, name: `${status} reason ${n}`, template_code: `${status}-${n}`, active: true, trigger_status: status, port_ids: ['port'], attachments: [] })));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, 'http://batch.test');
    if (url.pathname === '/api/external-user-access') return route.fulfill({ json: { users: [] } });
    if (url.pathname === '/api/snapshot') return route.fulfill({ json: { companies, ports: [{ id: 'port', code: 'FIXTURE', display_name: 'Fixture Port', location: 'JOHOR', backend_port_id: '5ad78eeb458efa4c5a1fc007' }], depots: [], submissions, userRegistrations: [], guideline: null } });
    if (url.pathname === '/api/dev-tools/registration-uploads') {
      const body = request.postDataJSON(); starts++;
      assert.equal(body.action, 'start'); assert.deepEqual(body.submissionIds, ['driver-1', 'driver-2']);
      const filename = 'CMREG400001 - CMREG400002_DRIVER_ BY:cargomove-register.vercel.app.xlsx';
      submissions = submissions.map(sub => ['driver-1', 'driver-2'].includes(sub.id) ? { ...sub, cargomove_upload: { id: '90000000-0000-4000-8000-000000000001', filename, expectedRows: 2, state: 'SUCCESS', successCount: 2, errorCount: 0, message: 'Verified' } } : sub);
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['NAME'], ['Driver 1'], ['Driver 2']]), 'Sheet1');
      return route.fulfill({ json: { submission: submissions[0], submissions: submissions.slice(0, 2), nextCheckMs: 1000, download: { filename, base64: XLSX.write(book, { type: 'base64', bookType: 'xlsx' }) } } });
    }
    if (url.pathname === '/api/email/templates') return route.fulfill({ json: { templates, ports: [{ id: 'port', display_name: 'Fixture Port', active: true }] } });
    if (url.pathname === '/api/email/submission-preview') {
      const body = request.postDataJSON();
      return route.fulfill({ json: { recipient: 'recipient@example.test', subject: `${body.status} ${body.submissionId}`, body: '<p>Offline preview</p>', templateName: body.templateId, templateCode: body.templateId, previewToken: `${body.submissionId}:${body.status}`, attachments: [] } });
    }
    if (url.pathname === '/api/email/submission-send') {
      sends++; const [id, status] = request.postDataJSON().previewToken.split(':');
      if (failSend) { failSend = false; return route.fulfill({ status: 502, json: { error: 'Offline send failure' } }); }
      if (status === 'DONE') submissions = submissions.map(sub => sub.id === id ? { ...sub, status: 'DONE' } : sub);
      return route.fulfill({ json: { status: 'SENT', sentAt: '2026-10-25T01:00:00Z', gmailMessageId: 'offline' } });
    }
    if (url.pathname === '/api/data/registration_submissions') {
      const saved = request.postDataJSON(); submissions = submissions.map(sub => sub.id === saved.id ? saved : sub);
      return route.fulfill({ json: saved });
    }
    if (url.pathname.startsWith('/api/')) { errors.push(url.pathname); return route.fulfill({ status: 500, json: {} }); }
    return route.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
  });
  await page.goto('http://batch.test');
  const selectAll = async () => { for (const checkbox of await page.locator('tbody input[type="checkbox"]').all()) await checkbox.check(); };
  await page.getByText('CMREG400001', { exact: true }).filter({ visible: true }).waitFor();
  const badgeFits = await page.locator('tbody tr').first().locator('td').nth(6).evaluate(td => {
    const badge = td.querySelector('span')!; const box = badge.getBoundingClientRect(), cell = td.getBoundingClientRect();
    return box.width >= 104 && box.left >= cell.left && box.right <= cell.right;
  });
  assert.ok(badgeFits, 'Status badge must fit inside its column');
  await selectAll();
  await page.getByRole('button', { name: 'More registration actions', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: /Export Excel without register/ }).waitFor();
  const draftDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Export Excel without register/ }).click();
  const draft = await draftDownload;
  assert.equal(draft.suggestedFilename(), 'CMREG400001 - CMREG400003_DRIVER_ BY-cargomove-register.vercel.app.xlsx');
  assert.equal(XLSX.utils.sheet_to_json(XLSX.read(await readFile((await draft.path())!)).Sheets.Sheet1).length, 3);
  assert.equal(starts, 0); assert.ok(submissions.every(sub => sub.status === 'PENDING'));
  const registrationDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'REGISTER & EMAIL', exact: true }).click();
  assert.equal((await registrationDownload).suggestedFilename(), 'CMREG400001 - CMREG400002_DRIVER_ BY-cargomove-register.vercel.app.xlsx');
  const codes = page.getByRole('dialog', { name: 'Batch email codes' }); await codes.waitFor();
  assert.equal(starts, 1); assert.ok(submissions.every(sub => sub.status === 'PENDING'));
  await page.getByText(/2 successful, 1 incomplete/).waitFor();
  await codes.getByRole('combobox', { name: 'Batch email code' }).selectOption('DONE-1');
  await codes.getByRole('button', { name: 'Batch code page 2', exact: true }).click();
  await codes.getByRole('combobox', { name: 'Batch email code' }).selectOption('DONE-2');
  await codes.getByRole('button', { name: 'Preview emails', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Registration Email Preview' }); await preview.waitFor();
  assert.ok(await preview.getByRole('navigation', { name: 'Email preview pagination' }).isVisible());
  await preview.getByRole('button', { name: 'Send Email', exact: true }).click();
  await page.getByText('Offline send failure', { exact: true }).waitFor();
  assert.equal(submissions[0].status, 'PENDING');
  await preview.getByRole('button', { name: 'Send Email', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('tbody')?.textContent?.includes('CMREG400001'));
  assert.equal(submissions[0].status, 'DONE'); assert.equal(submissions[1].status, 'PENDING');
  await preview.getByRole('button', { name: 'Close email preview', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for CMREG400002', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Preview Email', exact: true }).click();
  const singleCode = page.getByRole('dialog', { name: 'Select acceptance code', exact: true });
  await singleCode.waitFor();
  assert.equal(submissions[1].status, 'PENDING', 'Reopening a verified email must not mark it Done');
  await singleCode.getByRole('button', { name: 'Close code selection', exact: true }).click();
  await selectAll(); await page.getByRole('button', { name: 'More registration actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reject selected registrations' }).click(); await codes.waitFor();
  await codes.getByRole('combobox', { name: 'Batch email code' }).selectOption('REJECTED-1');
  await codes.getByRole('button', { name: 'Batch code page 2', exact: true }).click();
  await codes.getByRole('combobox', { name: 'Batch email code' }).selectOption('REJECTED-2');
  await codes.getByRole('button', { name: 'Reject and preview emails', exact: true }).click();
  await preview.waitFor(); assert.deepEqual(submissions.slice(0, 3).map(sub => sub.status), ['DONE', 'REJECTED', 'REJECTED']);
  assert.ok(await preview.getByRole('button', { name: 'Email preview page 2', exact: true }).isVisible());
  const rejectedEmailSent = page.waitForResponse(response => response.url().endsWith('/api/email/submission-send'));
  await preview.getByRole('button', { name: 'Send Email', exact: true }).click();
  await rejectedEmailSent; assert.equal(sends, 3); assert.equal(submissions[1].status, 'REJECTED');
  await preview.getByRole('button', { name: 'Close email preview', exact: true }).click();
  await page.evaluate(() => (window as any).setQueueStatus('DONE'));
  const doneRow = page.locator('tbody tr').filter({ hasText: 'CMREG400001' });
  await doneRow.waitFor();
  await doneRow.locator('input[type="checkbox"]').check();
  const doneExport = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  await doneExport;
  assert.equal(submissions[0].status, 'DONE');
  assert.equal(starts, 1); assert.equal(sends, 3, 'Exporting Closed/Done records must not upload or email');
  await page.getByRole('button', { name: 'More registration actions', exact: true }).click();
  const doneMenu = page.getByRole('menu');
  assert.equal(await doneMenu.getByRole('menuitem', { name: 'Download Excel without register', exact: true }).count(), 0);
  await doneMenu.getByRole('menuitem', { name: 'Revert selected to Pending', exact: true }).waitFor();
  await doneMenu.getByRole('menuitem', { name: 'Revert selected to Pending', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('tbody')?.textContent?.includes('CMREG400001'));
  assert.equal(submissions[0].status, 'PENDING');
  await page.evaluate(() => (window as any).setQueueStatus('REJECTED'));
  const rejectedRow = page.locator('tbody tr').filter({ hasText: 'CMREG400002' });
  await rejectedRow.waitFor();
  await rejectedRow.locator('input[type="checkbox"]').check();
  const rejectedExport = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  await rejectedExport;
  assert.equal(submissions[1].status, 'REJECTED');
  assert.equal(starts, 1); assert.equal(sends, 3, 'Exporting Rejected records must not upload or email');
  await page.getByRole('button', { name: 'More registration actions', exact: true }).click();
  const rejectedMenu = page.getByRole('menu');
  assert.equal(await rejectedMenu.getByRole('menuitem', { name: 'Download Excel without register', exact: true }).count(), 0);
  await rejectedMenu.getByRole('menuitem', { name: 'Revert selected to Pending', exact: true }).waitFor();
  await rejectedMenu.getByRole('menuitem', { name: 'Revert selected to Pending', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('tbody')?.textContent?.includes('CMREG400002'));
  assert.equal(submissions[1].status, 'PENDING');
  await page.evaluate(() => (window as any).setQueueStatus('PENDING'));
  const pendingRow = page.locator('tbody tr').filter({ hasText: 'CMREG400002' });
  await pendingRow.waitFor();
  await pendingRow.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'More registration actions', exact: true }).click();
  const pendingMenu = page.getByRole('menu');
  await pendingMenu.getByRole('menuitem', { name: /Downloads a workbook and keeps these submissions Pending/ }).waitFor();
  await pendingMenu.getByRole('menuitem', { name: /Moves the selected submissions to Rejected/ }).waitFor();
  await pendingMenu.getByRole('menuitem', { name: /Moves them to Closed\/Done without sending email/ }).waitFor();
  await pendingMenu.getByRole('menuitem', { name: /Mark selected as Closed\/Done/ }).click();
  await page.waitForFunction(() => !document.querySelector('tbody')?.textContent?.includes('CMREG400002'));
  assert.equal(submissions[1].status, 'DONE');
  assert.equal(starts, 1); assert.equal(sends, 3, 'Marking a Pending registration Closed/Done must not upload or send email');
  await page.getByRole('tab', { name: /Company/ }).click();
  const missingIdRow = page.locator('tbody tr').filter({ hasText: 'CMREG400005' });
  await missingIdRow.waitFor();
  await page.getByRole('button', { name: 'Actions for CMREG400005', exact: true }).click();
  const missingIdRegister = page.getByRole('menu').getByRole('button', { name: 'Register', exact: true });
  assert.equal(await missingIdRegister.isDisabled(), true, 'Company registration without a CargoMove ID must be blocked');
  assert.match(await missingIdRegister.getAttribute('title') || '', /Assign FORWARDING_AGENT_ID/);
  await page.getByRole('button', { name: 'Actions for CMREG400005', exact: true }).click();
  await page.locator('thead input[type="checkbox"]').check();
  const manualRegister = page.getByRole('button', { name: 'MANUAL REGISTER', exact: true });
  await manualRegister.focus();
  await manualRegister.press('Enter');
  await page.getByText('2 records missing FORWARDING_ID.', { exact: true }).waitFor();
  assert.equal(submissions.find(sub => sub.id === 'company-missing-1').status, 'PENDING');
  assert.equal(submissions.find(sub => sub.id === 'company-missing-2').status, 'PENDING');
  await page.locator('thead input[type="checkbox"]').uncheck();
  const companyRow = page.locator('tbody tr').filter({ hasText: 'CMREG400004' });
  await companyRow.waitFor();
  await companyRow.locator('input[type="checkbox"]').check();
  const companyExportButton = page.getByRole('button', { name: 'MANUAL REGISTER', exact: true });
  const labelToDividerGap = await companyExportButton.evaluate(button => {
    const textNode = Array.from(button.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    if (!textNode) return -1;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return button.getBoundingClientRect().right - range.getBoundingClientRect().right;
  });
  assert.ok(labelToDividerGap >= 12, `Manual Register label should have clear space before the divider (got ${labelToDividerGap}px)`);
  await companyExportButton.hover();
  const companyExportTooltip = page.getByRole('tooltip', {
    name: 'Downloads the company registration Excel for manual processing. Selected submissions are moved to Closed/Done. No email is sent.',
    exact: true,
  });
  await companyExportTooltip.waitFor();
  const moreActionsButton = page.getByRole('button', { name: 'More registration actions', exact: true });
  await moreActionsButton.hover();
  await companyExportTooltip.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Close registration actions', exact: true }).count(), 0);
  const companyDownload = page.waitForEvent('download');
  await companyExportButton.focus();
  await companyExportButton.press('Enter');
  assert.match((await companyDownload).suggestedFilename(), /CMREG400004.*COMPANY/);
  await page.waitForFunction(() => !document.querySelector('tbody')?.textContent?.includes('CMREG400004'));
  assert.equal(submissions.find(sub => sub.id === 'company-1').status, 'DONE');
  assert.equal(starts, 1); assert.equal(sends, 3, 'Company manual registration export must not upload or send email');
  assert.deepEqual(errors, []);
  console.log('Queue exports, register-and-email upload, code pagination, status reverts, action menus, and status badges passed.');
} finally { await browser.close(); }

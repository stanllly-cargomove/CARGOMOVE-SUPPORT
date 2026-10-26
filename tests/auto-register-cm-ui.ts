import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { launchBrowser } from '../server-handlers/scheduler/automation.js';

const bundle = await build({
  stdin: {
    contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{DeveloperSettings}from'./src/components/admin/DeveloperSettings';import{AutoRegisterCmPage}from'./src/components/admin/AutoRegisterCm';function App(){const[page,setPage]=useState(false);return page?<AutoRegisterCmPage onBack={()=>setPage(false)}/>:<DeveloperSettings onOpenAutoRegisterCm={()=>setPage(true)} onOpenScheduler={()=>{}} onOpenExcelMapping={()=>{}} onOpenPortDepotConfig={()=>{}} onOpenAutoEmailConfig={()=>{}}/>}createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
});

const browser = await launchBrowser();
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css'))
  .map(file => readFile(`dist/assets/${file}`, 'utf8')))).join('\n');
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let enabled = false;
  let scheduled = false;
  let manualRuns = 0;
  let history: any[] = [];
  let schedulerLoads = 0;
  let queueLoads = 0;
  let schedulingRequests = 0;
  const vehicleSubmission = {
    id: 'registration-1', reference_no: 'CMREG400001', registration_type: 'VEHICLE', company_id: 'company-1',
    company_reg_no: '123456-A', company_name: 'Example Logistics', company_type: 'HAULAGE', port_location: 'JOHOR',
    port_id: 'port-1', status: 'PENDING', submitted_at: '2026-10-25T01:00:00.000Z', submitted_by_name: 'Admin User',
    submitted_by_email: 'admin@example.test', submitted_by_mobile: '0123456789',
    data: { vehicles: [{ registration_number: 'ABC1234', weight: '12000', bgk_weight: '9000', head: 'HEAD-1' }] },
  };
  const trailerSubmission = {
    ...vehicleSubmission, id: 'registration-3', reference_no: 'CMREG400003', registration_type: 'TRAILER',
    data: { trailers: Array.from({ length: 10 }, (_, index) => ({ registration_number: `TRL${index + 1}`, weight: '6000', bdm_weight: '3500', trailer_type: 'FL' })) },
  };
  const stoppedSubmission = { ...trailerSubmission, id: 'registration-4', reference_no: 'CMREG400004' };
  const blockedSubmission = {
    ...vehicleSubmission, id: 'registration-2', reference_no: 'CMREG400002', registration_type: 'DRIVER',
    submitted_at: '2026-10-25T00:00:00.000Z', data: { drivers: [{ name: 'Driver Example', driving_license: 'D1', mobile_no: '0123456789' }] },
  };

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, 'http://auto-register.test', 'External requests are forbidden in this test');
    if (url.pathname === '/api/scheduler/auto-register-cm') {
      if (request.method() === 'GET') {
        schedulerLoads++;
        return route.fulfill({ json: { scheduler: {
        key: 'auto_register_cm', name: 'Auto Register in CM', description: 'Automatically execute CM registration',
        schedule: 'Every 20 minutes', isEnabled: enabled, lastRunAt: '2026-10-26T04:20:00.000Z', lastStatus: null,
        lastAutomaticRunAt: '2026-10-25T02:00:00.000Z',
        cronTrigger: { isEnabled: true, status: 'REQUESTED', lastTickAt: '2026-10-26T05:40:00.000Z', errorCode: null },
        updatedAt: '2026-10-25T02:00:00.000Z',
      }, runs: [
        { id: 'run-1', executionId: 'AUTOREG1000001', executionType: 'AUTOMATIC', status: 'SUCCESS', startedAt: '2026-10-25T02:00:00.000Z', finishedAt: '2026-10-25T02:01:00.000Z', durationMs: 60000, processedCount: 2, successCount: 2, failedCount: 0, message: 'Completed 2 registrations.', errorMessage: null, registrationReferences: ['CMREG400187', 'CMREG400188'] },
        { id: 'run-0', executionId: 'AUTOREG1000002', executionType: 'AUTOMATIC', status: 'FAILED', startedAt: '2026-10-25T00:00:00.000Z', finishedAt: '2026-10-25T00:01:00.000Z', durationMs: 60000, processedCount: 1, successCount: 0, failedCount: 1, message: 'CargoMove rejected the registration.', errorMessage: null, registrationReferences: ['CMREG400189', 'CMREG400187'] },
        ] } });
      }
      if (request.method() === 'PATCH') {
        assert.equal(request.headers()['x-cargomove-confirm'], 'manage-auto-register-cm');
        enabled = request.postDataJSON().isEnabled;
        return route.fulfill({ json: { isEnabled: enabled } });
      }
      assert.equal(request.headers()['x-cargomove-confirm'], 'run-auto-register-cm');
      manualRuns++;
      return route.fulfill({ json: { executionId: 'manual-run', status: 'skipped', message: 'No pending registrations.' } });
    }
    if (url.pathname === '/api/scheduler/auto-register-cm-queue') {
      if (request.method() === 'POST') {
        schedulingRequests++;
        assert.equal(request.headers()['x-cargomove-confirm'], 'auto-schedule-auto-register-cm');
        assert.deepEqual(request.postDataJSON(), {});
        scheduled = true;
        history = [
          { id: 'queue-1', submissionId: 'registration-1', referenceNo: 'CMREG400001', registrationType: 'VEHICLE', companyName: 'Example Logistics', status: 'SCHEDULED', scheduledAt: '2026-10-25T02:00:00.000Z', completedAt: null, message: 'Queued for the next automatic registration run.', runId: null },
          { id: 'queue-2', submissionId: 'registration-2', referenceNo: 'CMREG400187', registrationType: 'DRIVER', companyName: 'Example Logistics', status: 'SUCCESS', scheduledAt: '2026-10-25T00:00:00.000Z', completedAt: '2026-10-25T02:00:00.000Z', message: 'Registration completed successfully.', runId: 'run-1' },
          { id: 'queue-4', submissionId: 'registration-4', referenceNo: 'CMREG400188', registrationType: 'DRIVER', companyName: 'Example Logistics', status: 'SUCCESS', scheduledAt: '2026-10-25T00:00:00.000Z', completedAt: '2026-10-25T02:00:00.000Z', message: 'Registration completed successfully.', runId: 'run-1' },
          { id: 'queue-3', submissionId: 'registration-3', referenceNo: 'CMREG400189', registrationType: 'TRAILER', companyName: 'Example Logistics', status: 'FAILED', scheduledAt: '2026-10-24T22:00:00.000Z', completedAt: '2026-10-25T00:00:00.000Z', message: 'CargoMove rejected the registration.', runId: 'run-0' },
          { id: 'queue-5', submissionId: 'registration-4', referenceNo: 'CMREG400004', registrationType: 'TRAILER', companyName: 'Example Logistics', status: 'FAILED', scheduledAt: '2026-10-24T20:00:00.000Z', completedAt: '2026-10-24T22:00:00.000Z', message: 'First attempt failed.', runId: 'run-0' },
          { id: 'queue-6', submissionId: 'registration-4', referenceNo: 'CMREG400004', registrationType: 'TRAILER', companyName: 'Example Logistics', status: 'FAILED', scheduledAt: '2026-10-24T22:00:00.000Z', completedAt: '2026-10-25T00:00:00.000Z', message: 'Second attempt failed.', runId: 'run-0' },
        ];
        return route.fulfill({ json: { scheduled: 1 } });
      }
      queueLoads++;
      return route.fulfill({ json: {
        registrations: [
          { id: 'registration-1', referenceNo: 'CMREG400001', registrationType: 'VEHICLE', companyName: 'Example Logistics', companyRegNo: '123456-A', submittedAt: '2026-10-25T01:00:00.000Z', submittedBy: 'Admin User', details: { registration: 'ABC1234', weight: '12000', bgkWeight: '9000' }, recordCount: 1, submission: vehicleSubmission, eligible: true, reason: null, scheduled, queueStatus: 'SCHEDULED', firstFailureReason: null, firstFailedAt: null },
          { id: 'registration-3', referenceNo: 'CMREG400003', registrationType: 'TRAILER', companyName: 'Example Logistics', companyRegNo: '123456-A', submittedAt: '2026-10-25T01:30:00.000Z', submittedBy: 'Admin User', details: { registration: 'TRL1' }, recordCount: 10, submission: trailerSubmission, eligible: true, reason: null, scheduled: false, queueStatus: 'RE-SCHEDULED', firstFailureReason: 'CargoMove rejected the registration.', firstFailedAt: '2026-10-25T00:00:00.000Z' },
          { id: 'registration-4', referenceNo: 'CMREG400004', registrationType: 'TRAILER', companyName: 'Example Logistics', companyRegNo: '123456-A', submittedAt: '2026-10-25T01:30:00.000Z', submittedBy: 'Admin User', details: { registration: 'TRL2' }, recordCount: 1, submission: stoppedSubmission, eligible: true, reason: null, scheduled: false, queueStatus: 'FAILED', firstFailureReason: null, firstFailedAt: null },
          { id: 'registration-2', referenceNo: 'CMREG400002', registrationType: 'DRIVER', companyName: 'Example Logistics', companyRegNo: '123456-A', submittedAt: '2026-10-25T00:00:00.000Z', submittedBy: 'Admin User', details: { name: 'Driver Example' }, recordCount: 1, submission: blockedSubmission, eligible: false, reason: 'Register the parent company before processing its drivers, trailers or vehicles. Company registration status must be Registered.', scheduled: false, queueStatus: 'SCHEDULED', firstFailureReason: null, firstFailedAt: null },
        ],
        history,
      } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
  });

  await page.goto('http://auto-register.test');
  await page.getByRole('heading', { name: 'Developer Settings' }).waitFor();
  const toggle = page.getByRole('switch', { name: 'Enable Auto Register in CM' });
  await toggle.waitFor();
  const referenceToggle = page.getByRole('switch', { name: 'Registration test tools' });
  assert.deepEqual(
    await toggle.evaluate(element => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    }),
    await referenceToggle.evaluate(element => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    }),
    'Auto Register switch matches the Developer Settings switch dimensions',
  );
  await toggle.click();
  assert.equal(enabled, true);
  await page.getByRole('heading', { name: 'Developer Settings' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Auto Register in CM' }).count(), 0, 'Toggling must not open the details page');

  await page.getByText('Auto Register in CM', { exact: true }).click();
  await page.locator('h2').getByText('Auto Register in CM', { exact: true }).waitFor();
  await page.getByText('Next planned trigger', { exact: true }).waitFor();
  await page.getByText('Estimate only; execution is confirmed in the logs.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('status').filter({ hasText: 'Automatic trigger overdue' }).isVisible(), true);
  assert.equal(await page.getByText(/Last automatic:/).isVisible(), true);
  assert.equal(await page.getByText(/Supabase trigger: REQUESTED/).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).count(), 0, 'Auto Register uses the shared Refresh data action');
  const scheduledTab = page.getByRole('tab', { name: /Scheduled registrations/ });
  await scheduledTab.waitFor();
  await page.getByRole('table', { name: 'Scheduled registrations' }).waitFor();
  const scheduledPager = page.getByRole('navigation', { name: 'Scheduled registrations pagination' });
  assert.equal(await scheduledPager.getByText('1', { exact: true }).count(), 1);
  assert.equal(await scheduledPager.getByRole('button', { name: 'Previous scheduled registrations pagination page' }).isDisabled(), true);
  assert.equal(await scheduledPager.getByRole('button', { name: 'Next scheduled registrations pagination page' }).isDisabled(), true);
  assert.equal(await page.getByTestId('registration-table-viewport').evaluate(element => getComputedStyle(element).minHeight), '410px', 'Table reserves space for ten compact rows plus the header');
  assert.equal(scheduled, true, 'Eligible registrations are scheduled automatically on page load');
  assert.equal(await page.getByRole('button', { name: /Schedule selected/ }).count(), 0);
  assert.ok(await page.getByText('Registration No.', { exact: true }).isVisible());
  assert.ok(await page.getByText('Registration Type', { exact: true }).isVisible());
  assert.ok(await page.getByText('Reg schedule', { exact: true }).isVisible());
  assert.equal(await page.getByRole('table', { name: 'Scheduled registrations' }).getByRole('columnheader', { name: 'Status' }).count(), 1);
  const statusTags = page.getByRole('table', { name: 'Scheduled registrations' }).locator('tbody span[aria-label]');
  assert.deepEqual(await statusTags.allTextContents(), ['SCHEDULED', 'RE-SCHEDULED']);
  assert.equal(await statusTags.evaluateAll(tags => tags.every(tag => tag.getBoundingClientRect().width === tags[0].getBoundingClientRect().width
    && tag.getBoundingClientRect().height === tags[0].getBoundingClientRect().height)), true, 'Both statuses use the same tag size');
  assert.equal(await statusTags.nth(1).getAttribute('title'), 'CargoMove rejected the registration.');
  assert.equal(await page.getByRole('button', { name: 'Review CMREG400004' }).count(), 0, 'Second failures leave Scheduled registrations');
  const recordTags = page.getByRole('table', { name: 'Scheduled registrations' }).locator('tbody span').filter({ hasText: /RECORD$/ });
  assert.deepEqual(await recordTags.allTextContents(), ['1 RECORD', '10 RECORD']);
  assert.equal(await recordTags.evaluateAll(tags => tags.every(tag => tag.getBoundingClientRect().width === tags[0].getBoundingClientRect().width
    && tag.getBoundingClientRect().height === tags[0].getBoundingClientRect().height)), true, 'All record tags use the same size');
  const registrationButton = page.getByRole('button', { name: 'Review CMREG400001' });
  assert.match(await registrationButton.getAttribute('class') || '', /hover:bg-slate-100.*hover:text-blue-700/, 'Registration number has the queue-style hover treatment');
  await registrationButton.click();
  await page.getByRole('dialog').getByText('CMREG400001', { exact: true }).waitFor();
  await page.getByText('Vehicles', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close submission review' }).click();
  await page.getByRole('tab', { name: /Non-eligible Registration/ }).click();
  await page.getByRole('table', { name: 'Non-eligible registrations' }).waitFor();
  const ineligibleTab = page.getByRole('tab', { name: /Non-eligible Registration/ });
  const ineligibleHeader = page.getByRole('table', { name: 'Non-eligible registrations' }).locator('thead tr');
  assert.equal(await ineligibleTab.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(236, 0, 63)');
  assert.equal(await ineligibleHeader.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(236, 0, 63)');
  assert.equal(await ineligibleHeader.evaluate(element => getComputedStyle(element).borderTopColor), 'rgb(236, 0, 63)');
  assert.equal(await page.getByRole('columnheader', { name: 'Reasons' }).count(), 1);
  assert.ok(await page.getByText('Parent company is not registered.', { exact: true }).isVisible());
  assert.equal(await page.getByText('Register the parent company before processing its drivers', { exact: false }).count(), 0);
  assert.equal(await page.getByText('123456-A', { exact: true }).count(), 0, 'Company registration numbers are omitted from the company column');
  assert.equal(await page.getByText('These registrations cannot be processed until the parent company is registered', { exact: false }).count(), 0);
  assert.equal(await page.getByText('Reg schedule', { exact: true }).count(), 0);
  await scheduledTab.click();
  assert.equal(await page.getByRole('table', { name: 'Scheduled registrations' }).getByText('Scheduled', { exact: true }).count(), 0, 'Schedule cell shows only the date without a badge');
  await page.getByRole('table', { name: 'Scheduled registrations' }).waitFor();
  await page.getByRole('heading', { name: 'Execution logs' }).waitFor();
  const overview = page.getByRole('region', { name: 'Auto Register schedule overview' });
  assert.equal(await overview.getByText(/No automatic execution is recorded/).count(), 0);
  assert.equal(await overview.getByText('2 registrations', { exact: true }).count(), 1, 'Scheduled registrations remain included in Eligible now');
  assert.equal(await overview.getByRole('button', { name: 'Run Now' }).count(), 1, 'Run Now is grouped in the first card');
  const pageToggle = overview.getByRole('switch', { name: 'Enable Auto Register in CM' });
  assert.equal(await pageToggle.getAttribute('aria-checked'), 'true');
  await pageToggle.click();
  assert.equal(enabled, false, 'The scheduler can be toggled from the overview card');
  await pageToggle.click();
  assert.equal(enabled, true);
  assert.equal(await page.getByRole('table', { name: 'Auto Register in CM registration logs' }).count(), 0, 'Per-registration results are shown in the registrations tab, not duplicated in the logs card');
  assert.equal(await page.getByRole('heading', { name: 'Results & Execution logs' }).count(), 0);
  assert.equal(await page.getByRole('table', { name: 'Auto Register in CM execution logs' }).count(), 1);
  const executionLogs = page.getByRole('table', { name: 'Auto Register in CM execution logs' });
  const logPageSize = page.getByRole('combobox', { name: 'Execution logs per page' });
  assert.equal(await logPageSize.inputValue(), '25');
  await logPageSize.selectOption('50');
  assert.equal(await logPageSize.inputValue(), '50');
  const logSearch = page.getByRole('searchbox', { name: 'Search execution logs' });
  await logSearch.fill('AUTOREG1000001');
  assert.equal(await executionLogs.getByText('AUTOREG1000001', { exact: true }).count(), 1);
  assert.equal(await executionLogs.getByText('AUTOREG1000002', { exact: true }).count(), 0);
  await logSearch.fill('');
  const executionPager = page.getByRole('navigation', { name: 'Execution logs pagination' });
  assert.equal(await executionPager.getByText('1', { exact: true }).count(), 1);
  assert.equal(await page.getByTestId('execution-logs-viewport').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Execution logs fit without horizontal scrolling');
  assert.equal(await executionLogs.evaluate(table => getComputedStyle(table).tableLayout), 'fixed');
  assert.equal(await executionLogs.getByRole('columnheader').evaluateAll(headers => headers.slice(0, -1).every(header => getComputedStyle(header).textAlign === 'center')), true, 'Execution headers are centered except Message');
  assert.equal(await executionLogs.getByRole('row').nth(1).locator('td').evaluateAll(cells => cells.slice(0, -1).every(cell => getComputedStyle(cell).textAlign === 'center')), true, 'Execution values are centered except Message');
  assert.equal(await executionLogs.getByTestId('execution-log-message').first().evaluate(element => getComputedStyle(element).webkitLineClamp), '3');
  assert.equal(await executionLogs.getByRole('columnheader', { name: 'Execution ID' }).count(), 1);
  assert.equal(await executionLogs.getByRole('columnheader', { name: 'Registration ID' }).count(), 1);
  const firstRunRow = executionLogs.getByRole('row').filter({ hasText: 'AUTOREG1000001' });
  await firstRunRow.getByText('CMREG400187', { exact: true }).waitFor();
  await firstRunRow.getByText('CMREG400188', { exact: true }).waitFor();
  assert.equal(await firstRunRow.getByText('AUTOREG1000001', { exact: true }).count(), 1, 'Batch registrations share one execution ID in its separate column');
  const secondRunRow = executionLogs.getByRole('row').filter({ hasText: 'AUTOREG1000002' });
  await secondRunRow.getByText('CMREG400189', { exact: true }).waitFor();
  await secondRunRow.getByText('CMREG400187', { exact: true }).waitFor();
  await logSearch.fill('CMREG400187');
  assert.equal(await executionLogs.getByText('CMREG400187', { exact: true }).count(), 2,
    'A resumed registration remains searchable and visible in each execution, even though the queue only has its latest run pointer');
  await logSearch.fill('');
  const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
    .filter(element => element.getBoundingClientRect().right > innerWidth + 1)
    .map(element => `${element.tagName}.${(element as HTMLElement).className} (${Math.round(element.getBoundingClientRect().right)}px)`));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `The page must fit a mobile viewport: ${overflow.slice(0, 8).join(', ')}`);
  const tablist = page.getByRole('tablist', { name: 'Registration status' });
  assert.equal(await tablist.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Registration tabs fit with the original one-pixel shared border overlap');
  assert.equal(await scheduledTab.textContent(), 'Scheduled registrations (2)', 'Original tab labels and inline counts are preserved');
  const divider = page.getByTestId('auto-register-tab-divider');
  assert.equal(await divider.evaluate(element => element.getBoundingClientRect().height), 1);
  assert.equal(await page.getByRole('tabpanel').evaluate(element => getComputedStyle(element).borderTopWidth), '0px', 'Original attached table has no duplicate top border');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const tabBottom = await scheduledTab.evaluate(element => element.getBoundingClientRect().bottom);
  const headerTop = await page.getByRole('table', { name: 'Scheduled registrations' }).locator('thead').evaluate(element => element.getBoundingClientRect().top);
  assert.ok(Math.abs(headerTop - tabBottom) <= 2, 'Original tabs remain attached directly to the table');
  const rowHeight = await page.getByRole('table', { name: 'Scheduled registrations' }).locator('tbody tr').first().evaluate(element => element.getBoundingClientRect().height);
  assert.ok(rowHeight <= 37, `Registrations use compact single-line rows: ${rowHeight}px`);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await scheduledTab.evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap', 'Registration tab labels stay on one line');
  const registrationHeader = page.getByRole('table', { name: 'Scheduled registrations' }).locator('thead tr');
  assert.match(await registrationHeader.getAttribute('class') || '', /admin-registration-table-header/);
  assert.equal(await scheduledTab.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(0, 153, 102)');
  assert.equal(await registrationHeader.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(0, 153, 102)');
  assert.equal(await registrationHeader.evaluate(element => getComputedStyle(element).borderTopColor), 'rgb(0, 153, 102)');
  assert.equal(
    await registrationHeader.evaluate(element => getComputedStyle(element).backgroundColor),
    await scheduledTab.evaluate(element => getComputedStyle(element).backgroundColor),
    'Registration table header matches the active tab color',
  );
  const registrationWidth = await page.getByTestId('registration-table-viewport').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, table: element.querySelector('table')?.getBoundingClientRect().width }));
  assert.equal(registrationWidth.scroll <= registrationWidth.client + 1, true, `Registration table fits without horizontal scrolling: ${JSON.stringify(registrationWidth)}`);
  page.once('dialog', dialog => dialog.accept());
  await overview.getByRole('button', { name: 'Run Now' }).click();
  assert.equal(manualRuns, 1);
  await page.getByRole('button', { name: 'Back to Developer Settings' }).click();
  await page.getByRole('heading', { name: 'Developer Settings' }).waitFor();
  const loadsBeforeReopen = { schedulerLoads, queueLoads, schedulingRequests };
  await page.getByText('Auto Register in CM', { exact: true }).click();
  await page.locator('h2').getByText('Auto Register in CM', { exact: true }).waitFor();
  assert.equal(await page.getByRole('status', { name: 'Preparing Auto Register in CM' }).count(), 0, 'Cached Auto Register data opens immediately');
  assert.deepEqual({ schedulerLoads, queueLoads, schedulingRequests }, loadsBeforeReopen, 'Reopening Auto Register does not fetch unchanged data again');
  assert.deepEqual(errors, []);
  console.log('Auto Register in CM UI: settings toggle/navigation, scheduled and non-eligible tabs, queue, result logs, execution history, manual run and mobile layout passed.');
} finally {
  await browser.close();
}

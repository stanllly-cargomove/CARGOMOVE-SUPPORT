import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { launchBrowser } from '../server-handlers/scheduler/automation.js';

const bundle = await build({
  stdin: {
    contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{DeveloperSettings}from'./src/components/admin/DeveloperSettings';import{AutoRegisterCmPage}from'./src/components/admin/AutoRegisterCm';function App(){const[page,setPage]=useState(false);return page?<AutoRegisterCmPage onBack={()=>setPage(false)}/>:<DeveloperSettings onOpenAutoRegisterCm={()=>setPage(true)} onOpenScheduler={()=>{}} onOpenExcelMapping={()=>{}} onOpenPortDepotConfig={()=>{}} onOpenAutoEmailConfig={()=>{}}/>}createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
});

const browser = await launchBrowser();
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

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, 'http://auto-register.test', 'External requests are forbidden in this test');
    if (url.pathname === '/api/scheduler/auto-register-cm') {
      if (request.method() === 'GET') {
        schedulerLoads++;
        return route.fulfill({ json: { scheduler: {
        key: 'auto_register_cm', name: 'Auto Register in CM', description: 'Automatically execute CM registration',
        schedule: 'Every 2 hours', isEnabled: enabled, lastRunAt: null, lastStatus: null, updatedAt: '2026-10-25T02:00:00.000Z',
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
        ];
        return route.fulfill({ json: { scheduled: 1 } });
      }
      queueLoads++;
      return route.fulfill({ json: {
        registrations: [
          { id: 'registration-1', referenceNo: 'CMREG400001', registrationType: 'VEHICLE', companyName: 'Example Logistics', companyRegNo: '123456-A', submittedAt: '2026-10-25T01:00:00.000Z', submittedBy: 'Admin User', details: { registration: 'ABC1234', weight: '12000', bgkWeight: '9000' }, eligible: true, reason: null, scheduled },
          { id: 'registration-2', referenceNo: 'CMREG400002', registrationType: 'DRIVER', companyName: 'Example Logistics', companyRegNo: '123456-A', submittedAt: '2026-10-25T00:00:00.000Z', submittedBy: 'Admin User', details: { name: 'Driver Example' }, eligible: false, reason: 'Register the parent company before processing its drivers, trailers or vehicles. Company registration status must be Registered.', scheduled: false },
        ],
        history,
      } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
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
  assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).count(), 0, 'Auto Register uses the shared Refresh data action');
  const scheduledTab = page.getByRole('tab', { name: /Scheduled registrations/ });
  await scheduledTab.waitFor();
  await page.getByRole('table', { name: 'Scheduled registrations' }).waitFor();
  const scheduledPager = page.getByRole('navigation', { name: 'Scheduled registrations pagination' });
  assert.equal(await scheduledPager.getByText('1', { exact: true }).count(), 1);
  assert.equal(await scheduledPager.getByRole('button', { name: 'Previous scheduled registrations pagination page' }).isDisabled(), true);
  assert.equal(await scheduledPager.getByRole('button', { name: 'Next scheduled registrations pagination page' }).isDisabled(), true);
  assert.equal(await page.getByTestId('registration-table-viewport').evaluate(element => getComputedStyle(element).minHeight), '520px', 'Registration table reserves ten rows of height');
  assert.equal(scheduled, true, 'Eligible registrations are scheduled automatically on page load');
  assert.equal(await page.getByRole('button', { name: /Schedule selected/ }).count(), 0);
  assert.ok(await page.getByText('Registration No.', { exact: true }).isVisible());
  assert.ok(await page.getByText('Registration Type', { exact: true }).isVisible());
  assert.ok(await page.getByText('Reg schedule', { exact: true }).isVisible());
  assert.ok(await page.getByText('ABC1234', { exact: false }).isVisible());
  await page.getByRole('tab', { name: /Non-eligible Registration/ }).click();
  await page.getByRole('table', { name: 'Non-eligible registrations' }).waitFor();
  const ineligibleTab = page.getByRole('tab', { name: /Non-eligible Registration/ });
  const ineligibleHeader = page.getByRole('table', { name: 'Non-eligible registrations' }).locator('thead tr');
  assert.equal(await ineligibleTab.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(236, 0, 63)');
  assert.equal(await ineligibleTab.evaluate(element => getComputedStyle(element).borderTopColor), 'rgb(236, 0, 63)');
  assert.equal(await ineligibleHeader.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(236, 0, 63)');
  assert.equal(await ineligibleHeader.evaluate(element => getComputedStyle(element).borderTopColor), 'rgb(236, 0, 63)');
  assert.equal(await page.getByRole('columnheader', { name: 'Reasons' }).count(), 1);
  assert.ok(await page.getByText('Parent company is not registered.', { exact: true }).isVisible());
  assert.equal(await page.getByText('Register the parent company before processing its drivers', { exact: false }).count(), 0);
  assert.equal(await page.getByText('123456-A', { exact: true }).count(), 0, 'Company registration numbers are omitted from the company column');
  assert.equal(await page.getByText('These registrations cannot be processed until the parent company is registered', { exact: false }).count(), 0);
  assert.equal(await page.getByText('Reg schedule', { exact: true }).count(), 0);
  await scheduledTab.click();
  await page.getByRole('table', { name: 'Scheduled registrations' }).getByText('Scheduled', { exact: true }).waitFor();
  await page.getByRole('table', { name: 'Scheduled registrations' }).waitFor();
  await page.getByRole('heading', { name: 'Execution logs' }).waitFor();
  const overview = page.getByRole('region', { name: 'Auto Register schedule overview' });
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
  assert.equal(await tablist.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Registration tabs should not require horizontal scrolling');
  const tabDivider = page.getByTestId('auto-register-tab-divider');
  assert.equal(await tabDivider.count(), 1, 'A single underline separates the tabs from the table header');
  assert.equal(await tabDivider.evaluate(element => element.getBoundingClientRect().height), 1);
  assert.equal(await scheduledTab.evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap', 'Registration tab labels stay on one line');
  assert.equal(await page.getByRole('tabpanel').evaluate(element => getComputedStyle(element).borderTopStyle), 'none', 'Panel border does not duplicate the table top border');
  const registrationHeader = page.getByRole('table', { name: 'Scheduled registrations' }).locator('thead tr');
  assert.match(await registrationHeader.getAttribute('class') || '', /admin-registration-table-header/);
  assert.notEqual(await registrationHeader.evaluate(element => getComputedStyle(element).borderTopStyle), 'solid', 'The header edge does not duplicate the tab underline');
  assert.equal(await scheduledTab.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(0, 153, 102)');
  assert.equal(await scheduledTab.evaluate(element => getComputedStyle(element).borderTopColor), 'rgb(0, 153, 102)');
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

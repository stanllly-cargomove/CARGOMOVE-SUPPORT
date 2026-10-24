// Tests the actual production bundle. APIs are intercepted so no customer
// records, emails, accounts or external schedulers are changed by this suite.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import * as XLSX from 'xlsx';
import { INITIAL_PORTS, INITIAL_DEPOTS } from '../src/services/storage';

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.avif': 'image/avif', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = createServer((request, response) => {
  const pathname = new URL(request.url!, 'http://localhost').pathname;
  const file = path.join(process.cwd(), 'dist', pathname === '/' ? 'index.html' : pathname);
  const target = existsSync(file) && path.extname(file) ? file : path.join(process.cwd(), 'dist/index.html');
  response.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
  response.end(readFileSync(target));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address() as { port: number };
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
let authenticated = false;
let loginFails = true;
let configFails = false;
let lookupMode: 'found' | 'missing' | 'error' | 'pending' | 'rejected' = 'found';
let trackingMode: 'PENDING' | 'SUCCESS' | 'REJECTED' | 'missing' | 'error' = 'PENDING';
let submitFails = false;
const submissions: any[] = [];
const user = { id: 'admin-test', email: 'admin@example.test', type: 'ADMIN', full_name: 'Test Admin' };
const company = { id: 'company-test', name: 'Connected Test Company', registration_number: '123456-X', company_type: 'HAULAGE', status: 'ACTIVE', contact_name: 'Test Operator', contact_email: 'operator@example.test', contact_mobile: '0123456789', port_id: 'johor-port', depot_id: 'depot-ics-1' };
const dashboardCompany = { ...company, id: 'dashboard-company', name: 'Dashboard Connected Haulage', short_name: 'DASH HAULAGE' };
const dashboardSubmissions = [
  { id: 'dashboard-company-request', reference_no: 'CMREG410001', registration_type: 'COMPANY', company_id: dashboardCompany.id, company_reg_no: dashboardCompany.registration_number, company_name: dashboardCompany.name, company_type: dashboardCompany.company_type, port_location: 'JOHOR', port_id: dashboardCompany.port_id, depot_id: dashboardCompany.depot_id, status: 'PENDING', submitted_at: '2026-10-18T01:00:00Z', submitted_by_name: 'Test Operator', submitted_by_email: 'operator@example.test', submitted_by_mobile: '0123456789', data: {} },
  { id: 'dashboard-driver-request', reference_no: 'CMREG410002', registration_type: 'DRIVER', company_id: dashboardCompany.id, company_reg_no: dashboardCompany.registration_number, company_name: dashboardCompany.name, company_type: dashboardCompany.company_type, port_location: 'JOHOR', port_id: dashboardCompany.port_id, depot_id: dashboardCompany.depot_id, status: 'PENDING', submitted_at: '2026-10-18T02:00:00Z', submitted_by_name: 'Test Operator', submitted_by_email: 'operator@example.test', submitted_by_mobile: '0123456789', data: { drivers: [] } },
  { id: 'dashboard-trailer-complete', reference_no: 'CMREG410003', registration_type: 'TRAILER', company_id: dashboardCompany.id, company_reg_no: dashboardCompany.registration_number, company_name: dashboardCompany.name, company_type: dashboardCompany.company_type, port_location: 'JOHOR', port_id: dashboardCompany.port_id, depot_id: dashboardCompany.depot_id, status: 'DONE', submitted_at: '2026-10-17T01:00:00Z', submitted_by_name: 'Test Operator', submitted_by_email: 'operator@example.test', submitted_by_mobile: '0123456789', data: { trailers: [] } },
];
const dashboardUsers = [{ id: 'dashboard-user', username: 'dashboard.user', email: 'dashboard.user@example.test', password: 'unused', company_id: dashboardCompany.id, company_name: dashboardCompany.name, full_name: 'Dashboard User', mobile_number: '0123456789', status: 'PENDING', email_status: 'NOT_READY', email_sent: 0, created_at: '2026-10-18T03:00:00Z', updated_at: '2026-10-18T03:00:00Z' }];
const config = { ports: INITIAL_PORTS.filter(port => port.active), depots: INITIAL_DEPOTS.filter(depot => depot.active) };
await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) { await route.abort(); return; }
  if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
  const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
  switch (url.pathname) {
    case '/api/auth/session': return reply({ authenticated, user: authenticated ? user : null });
    case '/api/auth/profile': return reply({ avatarUrl: null });
    case '/api/auth/login':
      assert.deepEqual(request.postDataJSON(), { identifier: 'admin@example.test', password: 'test-password' });
      if (loginFails) return reply({ error: 'Invalid login credentials.' }, 401);
      authenticated = true; return reply({ user });
    case '/api/auth/logout': authenticated = false; return reply({ ok: true });
    case '/api/registration-config': return configFails ? reply({ error: 'Facilities unavailable' }, 502) : reply(config);
    case '/api/company-lookup': return lookupMode === 'error' ? reply({ error: 'Lookup unavailable' }, 502) : reply({ company: lookupMode === 'missing' ? null : { ...company, registration_status: lookupMode === 'rejected' ? 'REJECTED' : lookupMode === 'pending' ? 'PENDING' : 'DONE' } });
    case '/api/registration-status': return trackingMode === 'error' ? reply({ error: 'Tracking unavailable' }, 502) : reply({ tracking: trackingMode === 'missing' ? null : { reference_no: url.searchParams.get('reference_no'), registration_type: 'COMPANY', company_name: company.name, port_location: 'JOHOR', status: trackingMode, submission_status: trackingMode === 'PENDING' ? 'PENDING' : trackingMode === 'SUCCESS' ? 'DONE' : 'REJECTED', user_email_sent: trackingMode === 'SUCCESS', submitted_at: '2026-10-19T01:00:00Z' } });
    case '/api/company-registration': {
      const input = request.postDataJSON();
      if (submitFails) return reply({ error: 'Submission temporarily unavailable' }, 502);
      submissions.push(input);
      return reply({ company: input.registration_type === 'COMPANY' ? { ...company, ...input.company } : null, submission: { ...input, id: `submission-${submissions.length}`, reference_no: 'CMREG400001', status: 'PENDING', submitted_at: '2026-10-19T01:00:00Z' } });
    }
    case '/api/snapshot': return reply({ ...config, companies: [dashboardCompany], submissions: dashboardSubmissions, userRegistrations: [], guideline: null });
    case '/api/external-user-access': return reply({ users: dashboardUsers });
    default: errors.push(`Unexpected API: ${request.method()} ${url.pathname}`); return reply({ error: 'Unexpected test request' }, 500);
  }
});

const button = (name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
const heading = (name: string | RegExp) => page.getByRole('heading', { name, exact: typeof name === 'string' }).waitFor();
const go = (url: string) => page.goto(origin + url);
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow at ${page.url()}`);
const enterJohor = async (type: string) => {
  await go('/register');
  await page.locator('.group').filter({ has: page.getByRole('heading', { name: 'JOHOR DEPOT', exact: true }) }).getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: `${type} Registration`, exact: true }).click();
  await button('Continue to Form').click();
};
const verifyCompany = async () => {
  await page.getByPlaceholder('Enter the registered company number').fill(company.registration_number);
  await button('Verify Company').click();
};
const acceptAndSubmit = async (asset = true) => {
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await button('Confirm & Submit Registration').click();
  if (!asset) return;
  await page.getByPlaceholder('additional@example.com').fill('copy@example.test');
  await button('Submit & send confirmation').click();
};

try {
  console.log('Checking production navigation, themes and responsive pages');
  for (const width of (process.env.PORTAL_QUICK ? [390] : [1440, 768, 390, 320])) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of ['/', '/register', '/track-status', '/guideline', '/login']) {
      await go(url);
      await page.locator('.cm-home-header').waitFor();
      if (url === '/register') {
        await heading('JOHOR DEPOT');
        assert.equal(await page.getByText(/Loading registration facilities/).count(), 0, 'Registration content renders without a blocking facilities screen');
      }
      assert.equal(await page.getByRole('main').count(), 1, 'One main landmark per page');
      for (let theme = 0; theme < 2; theme++) { await page.getByRole('switch', { name: 'Dark theme' }).click(); await noOverflow(); }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go('/'); await button('REGISTER').click(); assert.equal(new URL(page.url()).pathname, '/register');
  await button('TRACK STATUS').click(); assert.equal(new URL(page.url()).pathname, '/track-status');
  await page.goBack(); await heading('JOHOR DEPOT');
  await page.goForward(); await heading(/Check your/);
  await page.reload(); await heading(/Check your/);
  await page.getByRole('link', { name: 'CargoMove home', exact: true }).click(); await heading(/Your next move/);
  await button('GUIDELINE').click(); await heading('Coming soon.');
  await button('REGISTER').click(); await heading('JOHOR DEPOT');
  await page.getByRole('switch', { name: 'Dark theme' }).click();
  const savedTheme = await page.locator('.cm-home').getAttribute('data-theme');
  await button('TRACK STATUS').click(); assert.equal(await page.locator('.cm-home').getAttribute('data-theme'), savedTheme);

  console.log('Checking facility loading failures and retry');
  configFails = true; await go('/register'); await page.getByText(/Facilities unavailable/).waitFor();
  configFails = false; await button('Try again').click(); await heading('JOHOR DEPOT');

  console.log('Checking tracking data, empty, pending, success, rejected and API failure');
  for (const state of ['PENDING', 'SUCCESS', 'REJECTED', 'missing', 'error'] as const) {
    trackingMode = state; await go('/track-status?reference_no=CMREG400001');
    assert.equal(await page.getByLabel('Registration reference number', { exact: true }).inputValue(), 'CMREG400001');
    await button('Track status').click();
    if (state === 'error') await page.getByRole('alert').waitFor();
    else if (state === 'missing') await page.getByText('No registration found', { exact: true }).waitFor();
    else { await heading('Registration status'); assert.ok(await page.locator('.cm-track-summary').innerText().then(text => text.includes(company.name))); }
  }

  console.log('Checking company lookup accepts Pending and Rejected companies and handles missing/error states');
  await enterJohor('Driver');
  for (const mode of ['missing', 'pending', 'rejected', 'error', 'found'] as const) {
    lookupMode = mode; await verifyCompany();
    if (mode === 'missing') await page.getByText(/No company record found/).waitFor();
    if (mode === 'pending' || mode === 'rejected') await button('Proceed to Asset Form').waitFor();
    if (mode === 'error') await page.getByText('Lookup unavailable', { exact: true }).waitFor();
    if (mode === 'found') await button('Proceed to Asset Form').waitFor();
  }

  console.log('Checking driver, trailer and vehicle add/remove, validation, review editing and persisted payloads');
  for (const type of ['Driver', 'Trailer', 'Vehicle']) {
    await page.setViewportSize({ width: type === 'Driver' ? 390 : type === 'Trailer' ? 320 : 768, height: 1000 });
    await enterJohor(type); await verifyCompany(); await button('Proceed to Asset Form').click();
    await heading(type === 'Vehicle' ? 'Prime Mover / Vehicle Registration' : `${type} Registration`);
    await button(`Add Another ${type} Row`).click();
    assert.equal(await page.getByTitle(`Remove this ${type.toLowerCase()} row`).count(), 2);
    await page.getByTitle(`Remove this ${type.toLowerCase()} row`).last().click();
    await button(`Add Another ${type} Row`).click();
    const form = page.locator('form.customer-form');
    await form.locator('button[type=submit]').click();
    assert.equal(await page.locator('.cm-track-result').count(), 0);
    const values = type === 'Driver' ? ['900101101234', 'TEST DRIVER', '123456789'] : type === 'Trailer' ? ['JTE8832', '6400', '38000'] : ['JVF4920', 'HD801', '8400', '44000'];
    const inputs = form.locator('input:not([type=hidden])');
    const allValues = [...values, ...values.map(value => value + '2')];
    assert.equal(await inputs.count(), allValues.length);
    for (let i = 0; i < allValues.length; i++) await inputs.nth(i).fill(allValues[i]);
    if (type === 'Driver') {
      await button('Country code').last().click();
      await button('+62 Indonesia').click();
    }
    await noOverflow();
    await form.locator('button[type=submit]').click(); await button(/Back to Edit/).click();
    assert.equal(await inputs.nth(0).inputValue(), values[0], `${type} edit preserved`);
    if (type === 'Driver') assert.ok((await button('Country code').last().innerText()).includes('+62'), 'Driver country code preserved');
    await form.locator('button[type=submit]').click();
    assert.ok(await button('Confirm & Submit Registration').isDisabled(), 'Consent required');
    if (type === 'Driver') {
      submitFails = true; await acceptAndSubmit(); await page.getByRole('alert').waitFor();
      submitFails = false;
    }
    await acceptAndSubmit(); await heading('Registration Submitted Successfully');
    const payload = submissions.at(-1);
    assert.equal(payload.registration_type, type.toUpperCase());
    assert.equal(payload.company_id, company.id);
    assert.equal(payload.depot_id, company.depot_id);
    assert.equal(payload.additional_confirmation_email, 'copy@example.test');
    assert.equal(payload.data[type.toLowerCase() + 's'].length, 2);
    assert.equal(payload.data.company, undefined);
    assert.equal(payload.data.driver?.mobile_no, type === 'Driver' ? '0123456789' : undefined);
    if (type === 'Driver') {
      assert.deepEqual(payload.data.drivers, [
        { driving_license: values[0], name: values[1], mobile_no: '0123456789' },
        { driving_license: values[0] + '2', name: values[1] + '2', mobile_no: '+621234567892' },
      ]);
    } else if (type === 'Vehicle') assert.deepEqual(payload.data.vehicles[0], { registration_number: values[0], head: values[1], weight: values[2], bgk_weight: values[3] });
    else assert.deepEqual(payload.data.trailers[0], { registration_number: values[0], weight: values[1], bdm_weight: values[2], trailer_type: 'FL' });
    await button('Check Status').click(); assert.equal(new URL(page.url()).searchParams.get('reference_no'), 'CMREG400001');
  }

  console.log('Checking company registration, Excel template/import, address, user access, edit and payload');
  lookupMode = 'missing';
  for (const location of ['PORT_KLANG', 'JOHOR']) {
    await page.setViewportSize({ width: location === 'PORT_KLANG' ? 1440 : 390, height: 1000 });
    if (location === 'JOHOR') await enterJohor('Company');
    else {
      await go('/register');
      await page.locator('.group').filter({ has: page.getByRole('heading', { name: 'PORT KLANG', exact: true }) }).getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await page.getByPlaceholder('LUMORA TECH SDN BHD').waitFor();
    await button('Next').click();
    await page.getByText('Company Name is required.', { exact: true }).waitFor();
    await button('Company form options').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download Form Template' }).click();
    assert.equal((await downloadPromise).suggestedFilename(), 'CargoMove_Company_Registration_Template.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['COMPANY FULL LEGAL NAME', 'COMPANY SHORT NAME (TRADE NAME)', 'OLD COMPANY REG. NUMBER', 'NEW COMPANY REG. NUMBER (SSM 12-DIGIT)'],
      ['IMPORTED TEST SDN BHD', 'IMPORTED TEST', '1234567-X', '202601123456'],
    ]), 'Company Registration');
    await page.getByLabel('Upload company details Excel file').setInputFiles({ name: 'company.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
    if (location === 'JOHOR') { await page.getByPlaceholder('Wisma Logistik, Level 3').waitFor(); await button('Back').click(); }
    await page.waitForFunction(() => (document.querySelector('input[placeholder="LUMORA TECH SDN BHD"]') as HTMLInputElement)?.value === 'IMPORTED TEST SDN BHD');
    await page.getByPlaceholder('LUMORA TECH SDN BHD').fill('TEST CONNECTED SDN BHD');
    await page.evaluate(() => { window.location.hash = 'register-main'; });
    await button('REGISTER').click();
    assert.equal(await page.getByPlaceholder('LUMORA TECH SDN BHD').inputValue(), 'TEST CONNECTED SDN BHD', 'Same-page navigation preserves entered data');
    await page.getByPlaceholder('LUMORA TECH', { exact: true }).fill('TEST CONNECTED');
    await page.getByPlaceholder('IP0123456-X').fill('1234567-X');
    await page.getByPlaceholder('201901004521').fill('202601123456');
    if (location === 'PORT_KLANG') {
      await page.locator('form select').selectOption('FORWARDER');
      await page.getByLabel('WESTPORT', { exact: true }).check();
      await page.getByLabel('NORTHPORT', { exact: true }).check();
      await page.getByPlaceholder('WESTPORT ledger code').fill('WP-LEDGER');
      await page.getByPlaceholder('NORTHPORT ledger code').fill('NP-LEDGER');
    }
    await button('Next').click();
    await page.getByPlaceholder('Wisma Logistik, Level 3').fill('Level 3');
    await page.getByPlaceholder('No. 12, Jalan Perindustrian 4').fill('12 Jalan Test');
    await page.getByPlaceholder('Kawasan Perindustrian Pelabuhan').fill('Industrial Park');
    await page.getByPlaceholder('81700').fill('81700');
    await button('Next').click();
    await page.getByPlaceholder('Kevin Tan').fill('Test Contact');
    await page.getByPlaceholder('kevin@company.com').fill('contact@example.test');
    await page.getByPlaceholder('+60123456789').fill('+60123456789');
    await page.getByPlaceholder('+6072518899').fill('+6072518899');
    await page.getByPlaceholder('+6072518898').fill('+6072518898');
    await button('Next: Login Account').click(); await heading('Register User Access');
    await noOverflow();
    for (const [placeholder, value] of [['company.admin', 'test.admin'], ['admin@company.com', 'user@example.test'], ['Minimum 6 characters', 'test-password'], ['Kevin Tan', 'Test User'], ['+60123456789', '+60111111111']]) await page.getByPlaceholder(placeholder).fill(value);
    await button('Continue to Review').click();
    await button(/Back to Edit/).click(); assert.equal(await page.getByPlaceholder('company.admin').inputValue(), 'test.admin');
    await button('Back').click(); assert.equal(await page.getByPlaceholder('kevin@company.com').inputValue(), 'contact@example.test');
    await button('Next: Login Account').click(); await button('Continue to Review').click();
    await acceptAndSubmit(false); await heading('Registration Submitted Successfully');
    const input = submissions.at(-1);
    assert.equal(input.port_location, location); assert.equal(input.registration_type, 'COMPANY');
    assert.equal(input.company.name, 'TEST CONNECTED SDN BHD');
    assert.equal(input.company.address1, '12 Jalan Test'); assert.equal(input.company.contact_email, 'contact@example.test');
    for (const [field, value] of Object.entries({ short_name: 'TEST CONNECTED', registration_number: '1234567-X', registration_number_old: '1234567-X', registration_number_new: '202601123456', block: 'Level 3', address2: 'Industrial Park', city: location === 'PORT_KLANG' ? 'Pelabuhan Klang' : 'Pasir Gudang', state: location === 'PORT_KLANG' ? 'Selangor' : 'Johor', postcode: '81700', country: 'Malaysia', contact_name: 'Test Contact', contact_mobile: '+60123456789', office_phone: '+6072518899', fax: '+6072518898' })) assert.equal(input.company[field], value, `Connected company field ${field}`);
    assert.equal(input.user_access.username, 'test.admin'); assert.equal(input.user_access.password_hash.length, 64);
    assert.equal(input.user_access.email, 'user@example.test'); assert.equal(input.user_access.full_name, 'Test User'); assert.equal(input.user_access.mobile_number, '+60111111111');
    assert.equal(input.submitted_by_name, 'Test Contact'); assert.equal(input.submitted_by_email, 'contact@example.test'); assert.equal(input.submitted_by_mobile, '+60123456789');
    assert.equal(input.port_id, location === 'PORT_KLANG' ? 'pk-westport' : 'johor-port');
    if (location === 'PORT_KLANG') {
      assert.deepEqual(input.company.assigned_port_ids, ['pk-westport', 'pk-northport']);
      assert.equal(input.company.ledger_codes, 'WP-LEDGER,NP-LEDGER');
    }
  }

  console.log('Checking login errors, authenticated admin handoff, refresh and logout');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go('/admin'); await heading('Admin Login');
  await page.locator('form button[type=submit]').click(); await page.getByText('Enter your username or email and password.', { exact: true }).waitFor();
  await page.getByLabel('Username or email').fill('admin@example.test'); await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.locator('form button[type=submit]').click(); await page.getByText('Invalid login credentials.', { exact: true }).waitFor();
  loginFails = false; await page.locator('form button[type=submit]').click(); await page.getByRole('navigation', { name: 'Admin navigation' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/admin');
  await heading('Registration operations');
  await page.getByText('Needs review', { exact: true }).waitFor();
  assert.equal(await page.getByText('3 waiting', { exact: true }).count(), 1, 'Dashboard queue combines pending registrations and linked user access');
  await button('View Driver registrations: 1 pending and 0 registered').click();
  await heading('Pending Registration Submissions');
  assert.equal(await page.getByText('CMREG410002', { exact: true }).filter({ visible: true }).count(), 1, 'Registration category opens the connected filtered submission');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('button', { name: 'Actions for CMREG410002', exact: true }).filter({ visible: true }).click();
    await button('Review').click();
    const review = page.getByRole('dialog');
    await review.waitFor();
    assert.equal(await review.evaluate(dialog => {
      const overlay = dialog.parentElement!;
      return [[10,10],[200,20]].every(([x,y]) => overlay.contains(document.elementFromPoint(x,y)));
    }), true, 'Review backdrop covers the sidebar and header with normal motion enabled');
    await button('Close submission review').click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button('Go to Admin Portal home').click();
  await heading('Registration operations');
  await page.getByLabel('Search pending registrations').fill('Dashboard Connected');
  assert.equal(await page.getByText('CMREG410001', { exact: true }).filter({ visible: true }).count(), 2, 'Dashboard search filters connected company and linked user records');
  await page.getByLabel('Filter by registration type').selectOption('USER');
  assert.equal(await page.getByText('CMREG410002', { exact: true }).count(), 0, 'Queue type filter excludes other registration types');
  assert.equal(await page.getByRole('button', { name: 'Manage', exact: true }).count(), 1, 'Linked user access request opens its management action');
  await page.getByLabel('Search pending registrations').fill('no matching company');
  await page.getByText('No pending registrations match the current filters.', { exact: true }).filter({ visible: true }).waitFor();
  await page.getByLabel('Search pending registrations').fill('');
  await page.getByLabel('Filter by registration type').selectOption('ALL');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Admin dashboard has no mobile horizontal overflow');
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: 'User Access Reg.' }).click();
  await page.getByRole('heading', { name: 'User Registration', exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload(); await page.getByRole('navigation', { name: 'Admin navigation' }).waitFor();
  await button('Account menu').click(); await button('Logout').click(); await heading(/Your next move/);
  assert.equal(authenticated, false);
  await go('/#error_code=otp_expired');
  await page.getByText('This reset link has expired or has already been used. Request a new reset email.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: production portal navigation, responsive themes, API failures, 5 registration submissions with connected payloads, tracking and authentication; no browser errors.`);
} catch (error) {
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/portal-failure.png', fullPage: true });
  console.error('Page:', page.url(), '\nVisible text:', (await page.locator('body').innerText()).slice(-6000), '\nBrowser errors:', errors);
  throw error;
} finally {
  await context.close(); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));
}

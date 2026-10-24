// Structural inspection only: no files selected, uploads submitted, or schedulers run.
import '../api/_runtime.js';
import { launchBrowser, ORIGIN } from '../server-handlers/scheduler/automation.js';
import * as XLSX from 'xlsx';

const dataEntryPath = '/administration/data_entry';
let phase = 'credentials';
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  if (!process.env.CARGOMOVE_USERNAME || !process.env.CARGOMOVE_PASSWORD) throw new Error();
  phase = 'browser launch';
  browser = await launchBrowser();
  const activeBrowser = browser;
  deadline = setTimeout(() => { void activeBrowser.close().catch(() => {}); }, 60000);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let blockedRequests = 0;
  // A strict request allowlist also prevents side effects through GET endpoints.
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    const read = ['GET', 'HEAD'].includes(request.method());
    const login = url.pathname === '/user/login' && request.method() === 'POST';
    // Verified as a read-only listing in /design/js/admin_data_entry.js.
    const listing = ['/administration/data_entry_uploads_list_ajax', '/administration/scheduled_tasks_ajax'].includes(url.pathname) && request.method() === 'POST';
    const navigation = ['/', '/bookings', dataEntryPath, '/administration/scheduled_tasks'].includes(url.pathname);
    const asset = /\.(?:js|css|woff2?|ttf|eot|svg|png|jpe?g|gif|ico|webp)$/i.test(url.pathname);
    const allowed = url.origin === ORIGIN && (login || listing || (read && (navigation || asset)))
      && !/run_scheduled_task|data_entry_upload_ajax|delete|save|update/i.test(url.pathname);
    if (!allowed) blockedRequests++;
    return allowed ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  phase = 'login form';
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  const form = page.locator(`form[action="${ORIGIN}/user/login"]`);
  await form.locator('#materialFormUsername').fill(process.env.CARGOMOVE_USERNAME);
  await form.locator('#materialFormLoginPasswordEx').fill(process.env.CARGOMOVE_PASSWORD);
  phase = 'login';
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    form.locator('button[type="submit"]').click(),
  ]);
  if (await page.locator('input[type="password"]').count()) throw new Error();
  phase = 'data entry';
  const response = await page.goto(`${ORIGIN}${dataEntryPath}#pane-vehicle`, { waitUntil: 'load' });
  if (!response?.ok() || new URL(page.url()).pathname !== dataEntryPath) throw new Error();
  console.log(JSON.stringify({ phase, httpStatus: response.status() }));
  console.log(JSON.stringify(await page.locator('#admin-data-entry-root').evaluate(root => ({
    endpoints: [...root.attributes].filter(attribute => attribute.name.startsWith('data-url-')).map(attribute => ({
      key: attribute.name, path: new URL(attribute.value, location.origin).pathname,
    })),
    country: (document.querySelector('#jmd-country') as HTMLSelectElement | null)?.value,
  }))));
  for (const type of ['vehicle', 'trailer', 'driver']) {
    phase = `${type} tab`;
    const selector = `#pane-${type}`;
    await page.locator(`a[href="${selector}"]`).click();
    await page.locator(selector).waitFor({ state: 'visible' });
    const structure = await page.locator(selector).evaluate(pane => ({
      pane: pane.id,
      active: pane.classList.contains('active'),
      forms: [...pane.querySelectorAll('form')].map(form => ({
        id: form.id, method: form.method, actionPath: new URL(form.action).pathname,
        enctype: form.enctype,
        inputs: [...form.querySelectorAll('input, select')].map(input => ({
          tag: input.tagName, id: input.id, name: input.getAttribute('name'),
          type: input.getAttribute('type'), accept: input.getAttribute('accept'),
        })),
        buttons: [...form.querySelectorAll('button')].map(button => ({
          id: button.id, type: button.type, label: button.textContent?.trim(),
        })),
      })),
      fileInputs: [...pane.querySelectorAll('input[type="file"]')].map(input => ({
        id: input.id, name: input.getAttribute('name'), accept: input.getAttribute('accept'),
      })),
      uploadButtons: [...pane.querySelectorAll('.btn-upload')].map(button => ({
        tag: button.tagName, entity: button.getAttribute('data-entity'), label: button.textContent?.trim(),
      })),
      tables: [...pane.querySelectorAll('table')].map(table => ({
        id: table.id,
        headers: [...table.querySelectorAll('th')].map(header => header.textContent?.trim()),
        hasRows: !!table.querySelector('tbody tr'),
        hasSuccessCount: /SuccessCount/i.test(table.textContent || ''),
        hasErrorCount: /ErrorCount/i.test(table.textContent || ''),
      })),
    }));
    console.log(JSON.stringify(structure));
    phase = `${type} recent uploads`;
    const listing = await page.request.post(`${ORIGIN}/administration/data_entry_uploads_list_ajax`, {
      form: { entity: type, country: 'MY' }, maxRedirects: 0, timeout: 15000,
    });
    if (!listing.ok()) throw new Error();
    const data = await listing.json();
    if (!data?.state || !Array.isArray(data.results)) throw new Error();
    console.log(JSON.stringify({ entity: type, listingState: !!data.state,
      rowFields: [...new Set(data.results.flatMap((row: Record<string, unknown>) => Object.keys(row)))],
      observedStatuses: [...new Set(data.results.map((row: { status?: string }) => row.status))],
      messageFields: [...new Set(data.results.flatMap((row: { message?: Record<string, unknown> }) => Object.keys(row.message || {})))],
      hasSuccessCount: data.results.some((row: { message?: unknown }) => /SuccessCount/i.test(JSON.stringify(row.message))),
      hasErrorCount: data.results.some((row: { message?: unknown }) => /ErrorCount/i.test(JSON.stringify(row.message))),
    }));
    phase = `${type} template`;
    const template = await page.request.get(`${ORIGIN}/administration/data_entry_download_template/${type}?country=MY`, {
      maxRedirects: 0, timeout: 15000,
    });
    if (!template.ok()) throw new Error();
    const workbook = XLSX.read(await template.body(), { type: 'buffer', sheetRows: 1 });
    console.log(JSON.stringify({ entity: type,
      templateHeaders: XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })[0],
    }));
  }
  // Only public implementation structure is printed; never table rows or inline data.
  const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => new URL((node as HTMLScriptElement).src))
    .filter(url => url.origin === 'https://www.cargomove.my' && url.pathname === '/design/js/admin_data_entry.js').map(url => url.pathname));
  for (const path of scripts) {
    phase = 'data entry script';
    const response = await page.request.get(`${ORIGIN}${path}`, { maxRedirects: 0, timeout: 15000 });
    if (!response.ok()) throw new Error();
    const script = await response.text();
    console.log(JSON.stringify({ scriptPath: path,
      endpoints: [...new Set(script.match(/\/administration\/[a-z_]+/g) || [])],
      usesFormData: /FormData/.test(script), usesPolling: /setInterval|setTimeout/.test(script),
      uploadsUseBase64: /base64: b64/.test(script),
      uploadResponseStateChecked: /if \(resp && resp.state\)/.test(script),
      refreshOnTabChange: /shown\.bs\.tab/.test(script),
      filePickerLocksOnSelection: /function lockFilePicker/.test(script),
    }));
  }
  phase = 'processing scheduler discovery';
  await page.goto(`${ORIGIN}/administration/scheduled_tasks`, { waitUntil: 'domcontentloaded' });
  await page.locator('#scheduled_tasks a[href*="run_scheduled_task"]').first().waitFor({ state: 'attached' });
  const workers = await page.locator('#scheduled_tasks a[href*="run_scheduled_task"]').evaluateAll(links =>
    [...new Set(links.map(link => new URL((link as HTMLAnchorElement).href).searchParams.get('name')))]
      .filter(name => name && /upload|registration|vehicle|trailer|driver|batch|data_entry/i.test(name)));
  console.log(JSON.stringify({ candidateProcessingWorkers: workers,
    note: 'Names visible in the loaded task table only; not evidence of processing behavior or a saved Support Tool scheduler.' }));
  console.log(JSON.stringify({ blockedRequests, uploadsSubmitted: 0, schedulersInvoked: 0 }));
} catch {
  console.log(JSON.stringify({ failedPhase: phase, message: 'Structural inspection failed. No upload or scheduler request was sent.' }));
  process.exitCode = 1;
} finally {
  if (deadline) clearTimeout(deadline);
  await browser?.close().catch(() => {});
}

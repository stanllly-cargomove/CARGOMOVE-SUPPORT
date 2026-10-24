import type { Browser, Page } from 'playwright-core';
import { launchBrowser, ORIGIN } from '../scheduler/automation.js';

export type UploadIdentity = { entity: string; filename: string; upload_id?: string | null; expected_rows: number };
export type UploadResult = { state: 'UPLOADED' | 'FAILED' | 'UNKNOWN'; message: string };
export type Verification = { state: 'SUCCESS' | 'FAILED' | 'PROCESSING' | 'UNKNOWN' | 'MISSING'; message: string;
  uploadId?: string; successCount?: number; errorCount?: number; readyForScheduler?: boolean };
type Credentials = { username: string; password: string };
const ENTRY = `${ORIGIN}/administration/data_entry`;
const UPLOAD = `${ORIGIN}/administration/data_entry_upload_ajax`;
const LIST = `${ORIGIN}/administration/data_entry_uploads_list_ajax`;
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function cleanMessage(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 350) : '';
}

export function verifyUploadRows(results: unknown[], job: UploadIdentity): Verification {
  const matches = results.filter((row: any) => row && (row.original_name === job.filename || row.filename === job.filename)
    && (!job.upload_id || String(row._id) === job.upload_id)) as any[];
  if (!matches.length) return { state: 'MISSING', message: 'Waiting for this reference file to appear in CargoMove.' };
  if (matches.length !== 1) return { state: 'UNKNOWN', message: 'Multiple matching CargoMove uploads were found. Review the file before retrying.' };
  const row = matches[0];
  const status = String(row.status || '').toLowerCase();
  const rawMessage = row.message?.[status];
  const message = cleanMessage(rawMessage);
  const success = message.match(/\bSuccessCount\s*:\s*(\d+)(?![\d.])\b/i);
  const errors = message.match(/\bErrorCount\s*:\s*(\d+)(?![\d.])\b/i);
  const successCount = success ? Number(success[1]) : undefined;
  const errorCount = errors ? Number(errors[1]) : undefined;
  const details = { uploadId: typeof row._id === 'string' ? row._id : undefined, successCount, errorCount };
  if (['success', 'processed', 'done'].includes(status)) {
    if (job.expected_rows > 0 && successCount === job.expected_rows && errorCount === 0)
      return { ...details, state: 'SUCCESS', message: `CargoMove processed all ${successCount} record(s).` };
    if ((errorCount ?? 0) > 0 || successCount !== undefined && successCount !== job.expected_rows)
      return { ...details, state: 'FAILED', message: `CargoMove processing failed or was incomplete. ${message}`.slice(0, 500) };
    return { ...details, state: 'UNKNOWN', message: 'CargoMove reports success, but full processing counts could not be verified.' };
  }
  if (/error|fail/.test(status)) return { ...details, state: 'FAILED', message: `Failed to upload/process this file in CargoMove. ${message}`.slice(0, 500) };
  if (status === 'not_processed') return { ...details, state: 'PROCESSING', readyForScheduler: true, message: 'File uploaded. Waiting for CargoMove processing.' };
  if (['processing_started', 'processing'].includes(status)) return { ...details, state: 'PROCESSING', message: 'CargoMove is processing this file.' };
  return { ...details, state: 'UNKNOWN', message: 'CargoMove returned an unrecognized file status. Check the existing upload before retrying.' };
}

async function portal<T>(credentials: Credentials, work: (page: Page, armUpload: () => void) => Promise<T>, launch = launchBrowser): Promise<T> {
  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await launch();
    const activeBrowser = browser;
    timer = setTimeout(() => { void activeBrowser.close().catch(() => {}); }, 65000);
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur' });
    let armed = false;
    let sent = false;
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      const read = ['GET', 'HEAD'].includes(request.method());
      const login = url.href === `${ORIGIN}/user/login` && request.method() === 'POST';
      const listing = url.href === LIST && request.method() === 'POST';
      const upload = url.href === UPLOAD && request.method() === 'POST' && armed && !sent;
      const navigation = ['/', '/bookings', '/administration/data_entry'].includes(url.pathname);
      const asset = /\.(?:js|css|woff2?|ttf|eot|svg|png|jpe?g|gif|ico|webp)$/i.test(url.pathname);
      const allowed = url.origin === ORIGIN && (login || listing || upload || read && (navigation || asset))
        && !/run_scheduled_task|data_entry_save|delete|update/i.test(url.pathname);
      if (allowed && upload) sent = true;
      return allowed ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
    const form = page.locator(`form[action="${ORIGIN}/user/login"]`);
    await form.locator('#materialFormUsername').fill(credentials.username);
    await form.locator('#materialFormLoginPasswordEx').fill(credentials.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      form.locator('button[type="submit"]').click(),
    ]);
    if (new URL(page.url()).origin !== ORIGIN || await page.locator('input[type="password"]').count()) throw new Error();
    const response = await page.goto(ENTRY, { waitUntil: 'domcontentloaded' });
    if (!response?.ok() || new URL(page.url()).origin !== ORIGIN || new URL(page.url()).pathname !== '/administration/data_entry'
      || await page.locator('input[type="password"]').count()) throw new Error();
    return await work(page, () => { armed = true; });
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
}

export async function uploadWorkbook(credentials: Credentials, job: UploadIdentity, buffer: Buffer,
  beforeUpload: () => Promise<void>, launch = launchBrowser): Promise<UploadResult> {
  let dispatched = false;
  try {
    if (!['vehicle', 'trailer', 'driver'].includes(job.entity) || !/^[\w-]+\.xlsx$/.test(job.filename)) throw new Error();
    return await portal(credentials, async (page, armUpload) => {
      await page.locator('#jmd-country').selectOption('MY');
      await page.locator(`a[href="#pane-${job.entity}"]`).click();
      const pane = page.locator(`#pane-${job.entity}`);
      await pane.waitFor({ state: 'visible' });
      await pane.locator(`#file-${job.entity}`).setInputFiles({ name: job.filename, mimeType: MIME, buffer });
      await beforeUpload();
      dispatched = true;
      armUpload();
      const [response] = await Promise.all([
        page.waitForResponse(response => response.url() === UPLOAD && response.request().method() === 'POST', { timeout: 30000 }),
        pane.locator(`.btn-upload[data-entity="${job.entity}"]`).click(),
      ]);
      const body = await response.json().catch(() => null);
      if (response.ok() && [true, 1].includes(body?.state)) return { state: 'UPLOADED', message: 'File uploaded to CargoMove. Preparing processing.' };
      if (body?.state === false) return { state: 'FAILED', message: `Failed to upload this file in CargoMove. ${cleanMessage(body.message)}` };
      return { state: 'UNKNOWN', message: 'CargoMove upload acceptance could not be confirmed. Check the existing file before retrying.' };
    }, launch);
  } catch {
    return dispatched
      ? { state: 'UNKNOWN', message: 'The CargoMove upload response was interrupted. Check the existing file before retrying.' }
      : { state: 'FAILED', message: 'Failed to upload this file in CargoMove. The browser or login could not complete; no upload was sent.' };
  }
}

export async function verifyWorkbook(credentials: Credentials, job: UploadIdentity, launch = launchBrowser): Promise<Verification> {
  try {
    return await portal(credentials, async page => {
      const response = await page.request.post(LIST, { form: { entity: job.entity, country: 'MY' }, maxRedirects: 0, maxRetries: 0, timeout: 15000 });
      const data = await response.json().catch(() => null);
      if (!response.ok() || !data?.state || !Array.isArray(data.results)) throw new Error();
      return verifyUploadRows(data.results, job);
    }, launch);
  } catch {
    return { state: 'UNKNOWN', message: 'CargoMove file verification is unavailable. The registration remains Pending; no file was uploaded again.' };
  }
}

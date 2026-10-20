import type { Browser, BrowserType } from 'playwright-core';
import { existsSync } from 'node:fs';
import { NORTHPORT_TARGET, schedulerUrl, type SchedulerTarget } from './targets.js';

export const SCHEDULER = 'northport_containers';
export const ORIGIN = 'https://www.cargomove.my';
export const TASKS_URL = `${ORIGIN}/administration/scheduled_tasks`;
export const RUN_URL = `${ORIGIN}/administration/run_scheduled_task?id=5ff7ea8633904c1dd1bd892b&name=${SCHEDULER}`;
export type LastRunVerification = { status: 'ADVANCED' | 'UNCHANGED' | 'UNAVAILABLE'; before: string | null; after: string | null; observedAt: string };
export type Outcome = { status: 'TRIGGER_REQUESTED' | 'FAILED' | 'UNKNOWN'; message: string; lastRunVerification?: LastRunVerification };

// CargoMove displays relative dates in Malaysia time, with minute precision.
export function lastRunTimestamp(text: string, observedAt = Date.now()): number | null {
  const match = text.trim().match(/^(Today|Yesterday)\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const hour=Number(match[2]),minute=Number(match[3]);
  if (hour<1||hour>12||minute>59) return null;
  const local = new Date(observedAt+8*3600000);
  return Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-(match[1].toLowerCase()==='yesterday'?1:0),hour%12+(match[4].toUpperCase()==='PM'?12:0),minute)-8*3600000;
}

export function compareLastRun(before: string | null, after: string | null, beforeObservedAt: number, afterObservedAt: number, dispatchedAt: number): LastRunVerification {
  const previous=before?lastRunTimestamp(before,beforeObservedAt):null;
  const current=after?lastRunTimestamp(after,afterObservedAt):null;
  const status=previous===null||current===null?'UNAVAILABLE':current>previous&&current>=Math.floor(dispatchedAt/60000)*60000&&current<=afterObservedAt?'ADVANCED':'UNCHANGED';
  return {status,before,after,observedAt:new Date(afterObservedAt).toISOString()};
}

export function classifySchedulerResponse(status: number, location: string | undefined, body: string): Outcome {
  if ([401, 403].includes(status) || /type\s*=\s*["']password|materialFormLoginPasswordEx|\/user\/login/i.test(body)
    || (location && /\/user\/|login|authenticate|challenge/i.test(location))) {
    return { status: 'FAILED', message: 'CargoMove rejected authentication for the scheduler request.' };
  }
  if (status >= 400) return { status: 'UNKNOWN', message: `CargoMove returned an error after dispatch (HTTP ${status}). Check Scheduled Tasks before attempting another run.` };
  let safeRedirect = false;
  if (location) {
    try {
      const url = new URL(location, TASKS_URL);
      safeRedirect = url.origin === ORIGIN && url.pathname === '/administration/scheduled_tasks'
        && !url.username && !url.password;
    } catch { /* An invalid redirect remains uncertain. */ }
  }
  // Do not scan an entire HTML document for the word "error": normal CargoMove
  // pages contain DataTables error handlers. Inspect explicit response errors.
  let reportedError = false;
  try {
    const data = JSON.parse(body);
    reportedError = data?.success === false || Boolean(data?.error)
      || ['error', 'failed', 'denied'].includes(String(data?.status).toLowerCase());
  } catch {
    const html = /^\s*</.test(body);
    reportedError = html
      ? /<[^>]+\bclass\s*=\s*["'][^"']*\balert-(?:danger|error)\b/i.test(body)
        || /<title>\s*(?:error|exception|access denied)\b/i.test(body)
      : /^\s*(?:error|exception|failed|denied|unauthorized|forbidden)\b/i.test(body);
  }
  if (reportedError || (!(status >= 200 && status < 300) && !([301, 302, 303, 307, 308].includes(status) && safeRedirect))) {
    return { status: 'UNKNOWN', message: `CargoMove returned an unrecognized response (HTTP ${status}${location ? safeRedirect ? ', redirected to Scheduled Tasks' : ', unrecognized redirect' : ''}). Check Scheduled Tasks before attempting another run.` };
  }
  return { status: 'TRIGGER_REQUESTED', message: 'Scheduler request sent successfully. Completion has not been verified.' };
}

export async function launchWindowsBrowser(playwright: Pick<BrowserType, 'executablePath' | 'launch'>, exists = existsSync): Promise<Browser> {
  // The managed executablePath is full Chromium, not the separate headless shell.
  // Explicitly select it, and still try installed browsers if its launch fails.
  const channels = exists(playwright.executablePath()) ? ['chromium', 'chrome', 'msedge'] : ['chrome', 'msedge'];
  let failure: unknown;
  for (const channel of channels) {
    try { return await playwright.launch({ channel, headless: true, timeout: 6000 }); }
    catch (error) { failure = error; }
  }
  throw failure;
}

export async function launchBrowser(): Promise<Browser> {
  const { chromium: playwright } = await import('playwright-core');
  // Prefer managed Chromium locally; use installed browsers when it is absent.
  // Vercel continues to use the packaged Linux binary.
  if (process.platform === 'win32' && !process.env.VERCEL) {
    return launchWindowsBrowser(playwright);
  }
  const { default: chromium } = await import('@sparticuz/chromium');
  return playwright.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, timeout: 20000 });
}

// No raw upstream errors, URLs, HTML, credentials or cookies leave this module.
export async function runAutomation(
  credentials: { username: string; password: string },
  beforeDispatch: () => Promise<void>,
  launch: () => Promise<Browser> = launchBrowser,
  budgetMs = 85000,
  scheduler: SchedulerTarget = NORTHPORT_TARGET,
): Promise<Outcome> {
  let browser: Browser | undefined;
  let dispatched = false;
  let message = 'The server browser could not start.';
  const deadline = Date.now() + budgetMs;
  const remaining = () => Math.max(1, Math.min(15000, deadline - Date.now()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let launchTimer: ReturnType<typeof setTimeout> | undefined;
  let launchExpired = false;
  try {
    const runUrl = schedulerUrl(scheduler);
    // Accept either CargoMove spelling, but always use the canonical fixed host.
    // A configured Scheduled Tasks path is harmless; never use it as a trigger URL.
    message = 'CARGOMOVE_URL must point to https://www.cargomove.my.';
    const target = new URL(process.env.CARGOMOVE_URL || ORIGIN);
    if (target.protocol !== 'https:' || !['www.cargomove.my', 'cargomove.my'].includes(target.hostname)
      || target.port || target.username || target.password) throw new Error();
    message = 'The server browser could not start.';
    browser = await Promise.race([
      launch().then(async launched => {
        if (launchExpired) { await launched.close().catch(() => {}); throw new Error(); }
        return launched;
      }),
      new Promise<never>((_, reject) => {
        launchTimer = setTimeout(() => { launchExpired = true; reject(new Error()); }, Math.min(25000, budgetMs));
      }),
    ]);
    if (launchTimer) clearTimeout(launchTimer);
    const activeBrowser = browser;
    timer = setTimeout(() => { void activeBrowser.close().catch(() => {}); }, Math.max(1, deadline - Date.now()));
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // Page scripts cannot accidentally invoke any scheduler or send data off-domain.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin !== ORIGIN || /run_scheduled_task/i.test(url.pathname)
        ? route.abort() : route.continue();
    });
    const page = await context.newPage();
    message = 'CargoMove is unavailable or the login page could not be loaded.';
    const home = await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: remaining() });
    if (!home?.ok() || new URL(page.url()).origin !== ORIGIN) throw new Error();
    // Verified against the public login HTML on 2026-10-16.
    const form = page.locator(`form[action="${ORIGIN}/user/login"]`);
    message = 'The CargoMove login form could not be found. The site may have changed.';
    await form.locator('#materialFormUsername').waitFor({ timeout: remaining() });
    await form.locator('#materialFormUsername').fill(credentials.username);
    await form.locator('#materialFormLoginPasswordEx').fill(credentials.password);
    message = 'CargoMove login failed or requires additional authentication.';
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: remaining() }),
      form.locator('button[type="submit"]').click({ timeout: remaining() }),
    ]);
    if (await form.count() || new URL(page.url()).origin !== ORIGIN || /\/user\//i.test(new URL(page.url()).pathname)) throw new Error();
    message = 'The CargoMove Scheduled Tasks page is inaccessible or requires additional authentication.';
    const tasks = await page.goto(TASKS_URL, { waitUntil: 'domcontentloaded', timeout: remaining() });
    if (!tasks?.ok() || page.url().split('?')[0] !== TASKS_URL || await page.locator('input[type="password"]').count()) throw new Error();
    // Verified in CargoMove's admin-scheduled_tasks.js: DataTables populates
    // #scheduled_tasks through POST scheduled_tasks_ajax after the HTML loads.
    // Wait for the exact link in that table rather than inspecting the empty DOM.
    message = 'CargoMove task list did not load, or the saved scheduler is not listed for this account. No scheduler request was sent.';
    await page.locator(`#scheduled_tasks a[href*="run_scheduled_task?"][href*="id=${scheduler.taskId}"][href*="name=${scheduler.workerName}"]`)
      .waitFor({ state: 'attached', timeout: remaining() });
    const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => (node as HTMLAnchorElement).href));
    if (!links.some(href => {
      const url = new URL(href);
      return url.origin === ORIGIN && url.pathname === '/administration/run_scheduled_task'
        && url.searchParams.get('id') === scheduler.taskId && url.searchParams.get('name') === scheduler.workerName;
    })) throw new Error();
    const taskRow=page.locator(`#scheduled_tasks a[href*="run_scheduled_task?"][href*="id=${scheduler.taskId}"][href*="name=${scheduler.workerName}"]`).first().locator('xpath=ancestor::tr[1]');
    const readLastRun=async()=>{
      try { return (await taskRow.locator('td').nth(2).innerText({timeout:Math.min(2500,remaining())})).trim() || null; }
      catch { return null; }
    };
    const before=await readLastRun();
    const beforeObservedAt=Date.now();
    if (Date.now() >= deadline) throw new Error();
    message = 'Unable to record the scheduler dispatch. No scheduler request was sent.';
    await beforeDispatch();
    // Mark uncertain BEFORE the sole outbound trigger. Never retry, follow a
    // redirect, or navigate a browser to the mutating URL.
    dispatched = true;
    const dispatchedAt=Date.now();
    const result = await context.request.get(runUrl, { maxRedirects: 0, maxRetries: 0, timeout: remaining() });
    const status = result.status();
    const location = result.headers().location;
    const body = await result.text();
    const outcome=classifySchedulerResponse(status, location, body);
    if(outcome.status!=='TRIGGER_REQUESTED') return outcome;
    let verification:LastRunVerification={status:'UNAVAILABLE',before,after:null,observedAt:new Date().toISOString()};
    // Read-only observations after the single dispatch. Never repeat the run URL.
    for(let attempt=0;attempt<2&&Date.now()+5000<deadline;attempt++) {
      try {
        const refreshed=await page.goto(TASKS_URL,{waitUntil:'domcontentloaded',timeout:Math.min(5000,remaining())});
        if(!refreshed?.ok()||page.url().split('?')[0]!==TASKS_URL) break;
        await taskRow.waitFor({state:'attached',timeout:Math.min(3000,remaining())});
        verification=compareLastRun(before,await readLastRun(),beforeObservedAt,Date.now(),dispatchedAt);
        if(verification.status==='ADVANCED') break;
      } catch { break; }
    }
    return {...outcome,lastRunVerification:verification,message:verification.status==='ADVANCED'
      ?'Scheduler request accepted. CargoMove Last run advanced; a scheduler run was observed. Container import is not verified.'
      :verification.status==='UNCHANGED'?'Scheduler request accepted. CargoMove Last run has not advanced yet. Completion is not verified.'
      :'Scheduler request accepted. CargoMove Last run could not be verified. Completion is not verified.'};
  } catch {
    return dispatched
      ? { status: 'UNKNOWN', message: 'The request may have been sent. Check CargoMove Scheduled Tasks before attempting another run.' }
      : { status: 'FAILED', message };
  } finally {
    if (launchTimer) clearTimeout(launchTimer);
    if (timer) clearTimeout(timer);
    if (browser) await browser.close().catch(() => {});
  }
}

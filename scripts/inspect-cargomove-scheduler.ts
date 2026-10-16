// Read-only diagnosis. Never navigates to or invokes a scheduler endpoint.
import '../api/_runtime.js';
import { launchBrowser, ORIGIN, TASKS_URL, SCHEDULER } from '../server-handlers/scheduler/automation.js';

let phase = 'browser launch';
const browser = await launchBrowser();
const deadline = setTimeout(() => { void browser.close().catch(() => {}); }, 60000);
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked: { method: string; host: string; path: string }[] = [];
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    const login = url.href === `${ORIGIN}/user/login` && request.method() === 'POST';
    // Verified read-only DataTables listing endpoint in admin-scheduled_tasks.js.
    const taskListing = url.href === `${ORIGIN}/administration/scheduled_tasks_ajax` && request.method() === 'POST';
    const deny = url.origin !== ORIGIN || /run_scheduled_task/i.test(url.pathname)
      || (!['GET', 'HEAD'].includes(request.method()) && !login && !taskListing);
    if (deny) blocked.push({ method: request.method(), host: url.hostname, path: url.pathname });
    return deny ? route.abort() : route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  phase = 'login form';
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.locator('#materialFormUsername').fill(process.env.CARGOMOVE_USERNAME || '');
  await page.locator('#materialFormLoginPasswordEx').fill(process.env.CARGOMOVE_PASSWORD || '');
  phase = 'login navigation';
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator(`form[action="${ORIGIN}/user/login"] button[type="submit"]`).click(),
  ]);
  console.log(JSON.stringify({ phase, bookingsRedirect: new URL(page.url()).pathname === '/bookings', passwordFormPresent: await page.locator('input[type="password"]').count() > 0 }));
  phase = 'scheduled tasks page';
  const response = await page.goto(TASKS_URL, { waitUntil: 'domcontentloaded' });
  const html = await response?.text() || '';
  console.log(JSON.stringify({ phase, httpStatus: response?.status(), exactTasksUrl: page.url().split('?')[0] === TASKS_URL,
    passwordFormPresent: await page.locator('input[type="password"]').count() > 0,
    taskNameInResponse: html.includes(SCHEDULER), taskIdInResponse: html.includes('5ff7ea8633904c1dd1bd892b') }));
  phase = 'waiting for task rendering';
  await page.locator('#scheduled_tasks a[href*="run_scheduled_task?"][href*="id=5ff7ea8633904c1dd1bd892b"][href*="name=northport_containers"]')
    .waitFor({ state: 'attached', timeout: 15000 });
  const inspect = await page.evaluate(({ name }) => {
      const links = [...document.querySelectorAll('a[href]')].filter(a => a.getAttribute('href')?.includes('run_scheduled_task'));
      return { schedulerLinkCount: links.length, targetNameRendered: document.body.textContent?.includes(name),
        scripts: [...document.scripts].filter(script => script.src).map(script => ({ host: new URL(script.src).hostname, path: new URL(script.src).pathname })),
        administrationPathsInScripts: [...new Set([...document.scripts].flatMap(script => script.textContent?.match(/\/administration\/[a-z_]+/g) || []))],
        targetLinks: links.filter(a => a.getAttribute('href')?.includes(name)).map(a => {
        const url = new URL(a.getAttribute('href')!, 'https://www.cargomove.my/administration/scheduled_tasks');
        const row = a.closest('tr');
        const table = (window as any).jQuery?.('#scheduled_tasks').DataTable();
        const taskData = table && row ? table.row(row).data() : null;
        return { canonicalHost: url.origin === 'https://www.cargomove.my', correctPath: url.pathname === '/administration/run_scheduled_task',
          lastRun: taskData?.t?.last_run ?? null,
          correctId: url.searchParams.get('id') === '5ff7ea8633904c1dd1bd892b', correctName: url.searchParams.get('name') === name };
      }) };
  }, { name: SCHEDULER });
  console.log(JSON.stringify(inspect));
  console.log(JSON.stringify({ blocked }));
} catch {
  console.log(JSON.stringify({ failedPhase: phase, message: 'Read-only inspection failed; no scheduler was invoked.' }));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser.close().catch(() => {});
}

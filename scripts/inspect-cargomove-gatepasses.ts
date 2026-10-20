// Read-only structural inspection: no recovery, upload or scheduler dispatch.
import '../api/_runtime.js';
import { launchBrowser, ORIGIN } from '../server-handlers/scheduler/automation.js';

const browser = await launchBrowser();
const timer = setTimeout(() => void browser.close(), 55000);
let phase = 'login page';
try {
  const context = await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    return url.origin !== ORIGIN || /run_scheduled_task/i.test(url.pathname)
      || (!['GET','HEAD'].includes(request.method()) && !(url.pathname === '/user/login' && request.method() === 'POST'))
      ? route.abort() : route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(ORIGIN,{waitUntil:'domcontentloaded'});
  phase = 'login form';
  await page.locator('#materialFormUsername').fill(process.env.CARGOMOVE_USERNAME || '');
  await page.locator('#materialFormLoginPasswordEx').fill(process.env.CARGOMOVE_PASSWORD || '');
  phase = 'login navigation';
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded'}),
    page.locator(`form[action="${ORIGIN}/user/login"] button[type="submit"]`).click(),
  ]);
  phase = 'Gatepasses navigation link';
  const href = await page.locator('a[href]').evaluateAll(nodes => nodes.map(n=>({text:n.textContent?.trim(),href:(n as HTMLAnchorElement).href})).find(n=>/gatepass/i.test(n.text || '') || /gatepass/i.test(n.href))?.href || null);
  if (!href) {
    console.log(JSON.stringify({path:new URL(page.url()).pathname,passwordFormPresent:await page.locator('input[type="password"]').count()>0,gatepassLinkFound:false}));
    throw new Error();
  }
  const url = new URL(href || '',ORIGIN);
  if (url.origin !== ORIGIN || !/gatepass/i.test(url.pathname)) throw new Error();
  phase = 'Gatepasses page';
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  console.log(JSON.stringify(await page.evaluate(() => ({
    path:location.pathname,
    portSelectorPresent:!!document.querySelector('#NameofPort'),
    tables:[...document.querySelectorAll('table')].map(table => ({id:table.id,headers:[...table.querySelectorAll('thead th')].map(th=>th.textContent?.trim())})),
    scripts:[...document.scripts].filter(s=>s.src && s.src.includes('gatepass')).map(s=>new URL(s.src).pathname),
  }))));
  const sources = await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>(n as HTMLScriptElement).src).filter(src=>src.includes('gatepass')));
  for (const src of sources) {
    if (new URL(src).origin !== ORIGIN) continue;
    const response = await context.request.get(src);
    // Only print application code, never table data or authenticated page HTML.
    console.log(await response.text());
  }
} catch {
  console.log(JSON.stringify({phase,message:'Read-only Gatepasses inspection failed. No scheduler was invoked.'}));
  process.exitCode=1;
} finally {
  clearTimeout(timer);
  await browser.close();
}

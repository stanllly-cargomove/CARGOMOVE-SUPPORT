import type { Browser } from 'playwright-core';
import { launchBrowser, ORIGIN } from '../scheduler/automation.js';
import type { GpVerification } from '../../src/types/northport.js';

export const NORTHPORT_PORT_ID = '5adc9dd77753d26fb07d6f26';
const PAGE_URL = `${ORIGIN}/bookings/gatepasses`;
const LIST_URL = `${ORIGIN}/bookings/gatepasses_list_ajax`;
export const UPDATED_TOLERANCE_MS = 2 * 60 * 1000;
const identifier = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase() : '';

// CargoMove gatepasses.js supplies raw id, container and t.updated fields.
// Preserve punctuation and leading zeros; never accept a substring match.
export function matchGatepass(rows: unknown[], gatepass: string, container: string, dispatchAt: number | null, observedAt = Date.now()): GpVerification | null {
  const matches = rows.filter((row: any) => identifier(row?.id) === identifier(gatepass) && identifier(row?.container) === identifier(container));
  if (!identifier(gatepass) || !identifier(container) || !matches.length) return null;
  const timestamps = matches.map((row: any) => {
    const raw = row?.t?.updated;
    return typeof raw === 'number' || (typeof raw === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(raw)) ? new Date(raw).getTime() : NaN;
  }).filter(Number.isFinite);
  const updatedAt = timestamps.length ? Math.max(...timestamps) : null;
  return {status:'VERIFIED',gatepass:identifier(gatepass),container:identifier(container),observedAt:new Date(observedAt).toISOString(),
    updatedAt:updatedAt === null ? null : new Date(updatedAt).toISOString(),
    updatedWithinTolerance:updatedAt === null || dispatchAt === null ? null : Math.abs(updatedAt-dispatchAt) <= UPDATED_TOLERANCE_MS,
    toleranceSeconds:120};
}

export async function verifyGatepass(expected: {gatepass:string;container:string;dispatchAt:number|null}, launch:()=>Promise<Browser> = launchBrowser): Promise<GpVerification> {
  const pending = (status:'NOT_FOUND'|'UNAVAILABLE'):GpVerification => ({status,gatepass:expected.gatepass,container:expected.container,observedAt:new Date().toISOString(),updatedAt:null,updatedWithinTolerance:null,toleranceSeconds:120});
  if (!expected.gatepass.trim() || !expected.container.trim() || !process.env.CARGOMOVE_USERNAME || !process.env.CARGOMOVE_PASSWORD) return pending('UNAVAILABLE');
  let browser:Browser|undefined;
  let expired = false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    // Also closes a browser that finishes launching after the overall deadline.
    const work = async () => {
      browser = await launch();
      if (expired) {await browser.close();return pending('UNAVAILABLE');}
      const context = await browser.newContext({serviceWorkers:'block'});
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        const permittedPost = request.method() === 'POST' && [ORIGIN+'/user/login',LIST_URL].includes(url.href);
        return url.origin !== ORIGIN || /run_scheduled_task/i.test(url.pathname) || (!['GET','HEAD'].includes(request.method()) && !permittedPost)
          ? route.abort() : route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.setDefaultNavigationTimeout(10000);
      await page.goto(ORIGIN,{waitUntil:'domcontentloaded'});
      const form = page.locator(`form[action="${ORIGIN}/user/login"]`);
      await form.locator('#materialFormUsername').fill(process.env.CARGOMOVE_USERNAME!);
      await form.locator('#materialFormLoginPasswordEx').fill(process.env.CARGOMOVE_PASSWORD!);
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),form.locator('button[type="submit"]').click()]);
      if (new URL(page.url()).origin !== ORIGIN || await page.locator('input[type="password"]').count()) return pending('UNAVAILABLE');
      const response = await page.goto(PAGE_URL,{waitUntil:'domcontentloaded'});
      if (!response?.ok() || page.url().split('?')[0] !== PAGE_URL || await page.locator('input[type="password"]').count()) return pending('UNAVAILABLE');
      await page.locator('#NameofPort').selectOption(NORTHPORT_PORT_ID);
      // Same read-only POST and parameters as CargoMove's verified DataTables code.
      const columns = ['id','container','company','used','','t.updated'];
      for (let attempt=0;attempt<2;attempt++) {
        for (let start=0;start<200;start+=50) {
          const form:Record<string,string|number> = {draw:attempt+1,start,length:50,port:NORTHPORT_PORT_ID,showinactive:1,'search[value]':expected.gatepass,'search[regex]':'false','order[0][column]':5,'order[0][dir]':'desc'};
          columns.forEach((name,index)=>Object.assign(form,{[`columns[${index}][data]`]:name,[`columns[${index}][name]`]:'',[`columns[${index}][searchable]`]:'true',[`columns[${index}][orderable]`]:'true',[`columns[${index}][search][value]`]:'',[`columns[${index}][search][regex]`]:'false'}));
          const listing = await context.request.post(LIST_URL,{form,maxRedirects:0,maxRetries:0,timeout:8000});
          if (!listing.ok()) return pending('UNAVAILABLE');
          const result = await listing.json();
          if (!Array.isArray(result?.data) || !Number.isFinite(Number(result.recordsFiltered)) || result.error) return pending('UNAVAILABLE');
          const found = matchGatepass(result.data,expected.gatepass,expected.container,expected.dispatchAt);
          if (found) return found;
          if (start+50 >= Number(result.recordsFiltered)) break;
          if (start===150) return pending('UNAVAILABLE'); // Never claim a complete search after truncation.
        }
        if (attempt===0) await page.waitForTimeout(2000);
      }
      return pending('NOT_FOUND');
    };
    return await Promise.race([work(),new Promise<GpVerification>(resolve=>{timer=setTimeout(()=>{expired=true;void browser?.close().catch(()=>{});resolve(pending('UNAVAILABLE'));},45000);})]);
  } catch {return pending('UNAVAILABLE');}
  finally {if(timer)clearTimeout(timer);await browser?.close().catch(()=>{});}
}

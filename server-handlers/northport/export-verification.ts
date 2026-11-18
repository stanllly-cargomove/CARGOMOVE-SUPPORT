import type { Browser } from 'playwright-core';
import { launchBrowser, ORIGIN } from '../scheduler/automation.js';
import type { ExportVerification } from '../../src/types/northport.js';

const PAGE_URL = `${ORIGIN}/administration/containers`;
const HEADERS = ['#','Type','ID','Location','SCN / Op.','Type size','Booked / Total','Updated','Expiry'];
const identifier = (value: string) => value.trim().toUpperCase();
export type ExportLookup = {container:string;scn:string;dispatchAt:number};

// The Containers table displays wall-clock timestamps in Malaysia time.
export function containerUpdatedTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const parsed = Date.parse(value.replace(' ', 'T')+'+08:00');
  if (!Number.isFinite(parsed) || new Date(parsed+8*3600000).toISOString().slice(0,19).replace('T',' ')!==value) return null;
  return parsed;
}

export function matchExportContainer(rows: string[][], expected: ExportLookup, observedAt=Date.now()): ExportVerification {
  const evidence:ExportVerification = {status:'NOT_FOUND',container:identifier(expected.container),scn:identifier(expected.scn),location:'Northport',observedAt:new Date(observedAt).toISOString(),dispatchAt:Number.isFinite(expected.dispatchAt)?new Date(expected.dispatchAt).toISOString():null,updatedAt:null,toleranceSeconds:120};
  if (!evidence.container || !evidence.scn || !evidence.dispatchAt || expected.dispatchAt>observedAt) return {...evidence,status:'UNAVAILABLE'};
  const matches = rows.filter(row => row.length===HEADERS.length && identifier(row[1])==='EXPORT' && identifier(row[2])===evidence.container && identifier(row[3])==='NORTHPORT' && identifier(row[4])===evidence.scn);
  if (!matches.length) return evidence;
  const timestamps = matches.map(row=>containerUpdatedTimestamp(row[7].trim())).filter((value):value is number=>value!==null);
  if (!timestamps.length) return {...evidence,status:'UNAVAILABLE'};
  const updatedAt = Math.max(...timestamps);
  return {...evidence,status:updatedAt>observedAt ? 'UNAVAILABLE' : updatedAt>=expected.dispatchAt-120000 ? 'VERIFIED' : 'STALE',updatedAt:new Date(updatedAt).toISOString()};
}

export async function verifyExportContainer(expected:ExportLookup, launch:()=>Promise<Browser>=launchBrowser):Promise<ExportVerification> {
  const unavailable=():ExportVerification=>({status:'UNAVAILABLE',container:expected.container,scn:expected.scn,location:'Northport',observedAt:new Date().toISOString(),dispatchAt:Number.isFinite(expected.dispatchAt)?new Date(expected.dispatchAt).toISOString():null,updatedAt:null,toleranceSeconds:120});
  if (!expected.container.trim() || !expected.scn.trim() || !Number.isFinite(expected.dispatchAt) || !process.env.CARGOMOVE_USERNAME || !process.env.CARGOMOVE_PASSWORD) return unavailable();
  let browser:Browser|undefined,expired=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const work=async()=>{
      browser=await launch();
      if(expired){await browser.close();return unavailable();}
      const context=await browser.newContext({serviceWorkers:'block'});
      await context.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        const permittedPost=request.method()==='POST'&&[ORIGIN+'/user/login',PAGE_URL].includes(url.href);
        return url.origin!==ORIGIN || /run_scheduled_task/i.test(url.pathname) || (!['GET','HEAD'].includes(request.method())&&!permittedPost) ? route.abort() : route.continue();
      });
      const page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(10000);
      await page.goto(ORIGIN,{waitUntil:'domcontentloaded'});
      const login=page.locator(`form[action="${ORIGIN}/user/login"]`);
      await login.locator('#materialFormUsername').fill(process.env.CARGOMOVE_USERNAME!);
      await login.locator('#materialFormLoginPasswordEx').fill(process.env.CARGOMOVE_PASSWORD!);
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),login.locator('button[type="submit"]').click()]);
      if(new URL(page.url()).origin!==ORIGIN||await page.locator('input[type="password"]').count())return unavailable();
      let evidence=unavailable();
      for(let attempt=0;attempt<2;attempt++) {
        const response=await page.goto(PAGE_URL,{waitUntil:'domcontentloaded'});
        if(!response?.ok()||page.url().split('?')[0]!==PAGE_URL||await page.locator('input[type="password"]').count())return unavailable();
        const form=page.locator('form[action="containers"]');
        await form.locator('input[name="container"]').fill(expected.container);
        await form.locator('input[name="booking_reference"]').fill('');
        const [searched]=await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),form.locator('button[type="submit"]').click()]);
        if(!searched?.ok()||page.url().split('?')[0]!==PAGE_URL||await page.locator('input[type="password"]').count())return unavailable();
        const tables=await page.locator('table').evaluateAll(tables=>tables.map(table=>({headers:Array.from(table.querySelectorAll('thead th,thead td'),cell=>cell.textContent?.trim()||''),rows:Array.from(table.querySelectorAll('tbody tr'),row=>Array.from(row.querySelectorAll('td'),cell=>cell.textContent?.trim()||''))})));
        const matching=tables.filter(table=>table.headers.length===HEADERS.length&&table.headers.every((header,index)=>header===HEADERS[index]));
        // Unexpected markup is unavailable, never a negative business result.
        if(matching.length!==1||matching[0].rows.some(row=>row.length!==HEADERS.length))return unavailable();
        evidence=matchExportContainer(matching[0].rows,expected);
        if(evidence.status==='VERIFIED'||evidence.status==='UNAVAILABLE')return evidence;
        if(attempt===0)await page.waitForTimeout(2000);
      }
      return evidence;
    };
    return await Promise.race([work(),new Promise<ExportVerification>(resolve=>{timer=setTimeout(()=>{expired=true;void browser?.close().catch(()=>{});resolve(unavailable());},45000);})]);
  } catch {return unavailable();}
  finally {if(timer)clearTimeout(timer);await browser?.close().catch(()=>{});}
}

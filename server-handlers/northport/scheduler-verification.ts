import type { Browser } from 'playwright-core';
import { compareLastRun, launchBrowser, ORIGIN, TASKS_URL, type LastRunVerification } from '../scheduler/automation.js';
import { schedulerUrl, type SchedulerTarget } from '../scheduler/targets.js';

export async function verifySchedulerRun(input:SchedulerTarget&{before:string|null;dispatchAt:number},launch:()=>Promise<Browser>=launchBrowser):Promise<LastRunVerification> {
  const unavailable=():LastRunVerification=>({status:'UNAVAILABLE',before:input.before,after:null,observedAt:new Date().toISOString()});
  if(!process.env.CARGOMOVE_USERNAME||!process.env.CARGOMOVE_PASSWORD||!Number.isFinite(input.dispatchAt))return unavailable();
  let browser:Browser|undefined,expired=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    schedulerUrl(input);
    const work=async()=>{
      browser=await launch();
      if(expired){await browser.close();return unavailable();}
      const context=await browser.newContext({serviceWorkers:'block'});
      await context.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        const allowedPost=request.method()==='POST'&&[ORIGIN+'/user/login',ORIGIN+'/administration/scheduled_tasks_ajax'].includes(url.href);
        return url.origin!==ORIGIN||/run_scheduled_task/i.test(url.pathname)||(!['GET','HEAD'].includes(request.method())&&!allowedPost)?route.abort():route.continue();
      });
      const page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(10000);
      await page.goto(ORIGIN,{waitUntil:'domcontentloaded'});
      const form=page.locator(`form[action="${ORIGIN}/user/login"]`);
      await form.locator('#materialFormUsername').fill(process.env.CARGOMOVE_USERNAME!);
      await form.locator('#materialFormLoginPasswordEx').fill(process.env.CARGOMOVE_PASSWORD!);
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),form.locator('button[type="submit"]').click()]);
      if(new URL(page.url()).origin!==ORIGIN||await page.locator('input[type="password"]').count())return unavailable();
      const result=await page.goto(TASKS_URL,{waitUntil:'domcontentloaded'});
      if(!result?.ok()||page.url().split('?')[0]!==TASKS_URL||await page.locator('input[type="password"]').count())return unavailable();
      const link=page.locator(`#scheduled_tasks a[href*="run_scheduled_task?"][href*="id=${input.taskId}"][href*="name=${input.workerName}"]`).first();
      await link.waitFor({state:'attached'});
      const after=(await link.locator('xpath=ancestor::tr[1]').locator('td').nth(2).innerText()).trim();
      return compareLastRun(input.before,after,input.dispatchAt,Date.now(),input.dispatchAt);
    };
    return await Promise.race([work(),new Promise<LastRunVerification>(resolve=>{timer=setTimeout(()=>{expired=true;void browser?.close().catch(()=>{});resolve(unavailable());},45000);})]);
  } catch{return unavailable();}
  finally{if(timer)clearTimeout(timer);await browser?.close().catch(()=>{});}
}

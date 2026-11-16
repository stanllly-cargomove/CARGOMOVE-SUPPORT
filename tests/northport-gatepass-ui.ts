// Offline coverage: no live FTP, database, mailbox or scheduler requests.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { selectEirTime } from './northport-picker-helpers';

const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{NorthportRecovery}from'./src/components/admin/NorthportRecovery';createRoot(document.getElementById('root')).render(<NorthportRecovery onBack={()=>{}}/>);`},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(name=>name.endsWith('.css')).map(name=>readFile('dist/assets/'+name,'utf8')))).join('\n');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
    page.setDefaultTimeout(10000);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const requests:string[]=[];let historyReads=0;
    const numbers={GP:'000123456789000001',EX:'000987654321000002'};
    const makeMatch=(type:'GP'|'EX')=>{
      const values=Array(20).fill('');values[0]=type==='GP'?'ABCU1234567':'DEFU7654321';values[type==='GP'?1:2]=numbers[type];
      return {filename:`CM_CONTAINER_20261116120000_${type}.csv`,type,sourceFolder:type==='GP'?'SUCCESS':'SUCCESS_ARCHIVES',timestamp:'2026-11-16T12:00:00',record:1,totalRecords:2,values,token:'record-'+type,fileToken:'file-'+type};
    };
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());assert.equal(url.origin,'http://northport-gatepass.test');
      if(url.pathname==='/api/dev-tools/northport-recovery') {
        if(request.method()==='GET'){historyReads++;return route.fulfill({json:{history:[],uploadsEnabled:false,missingGates:[]}});}
        const body=request.postDataJSON();requests.push(body.action);
        assert.equal(request.headers()['x-cargomove-confirm'],'northport-recovery');
        if(body.action==='search') {
          assert.equal(body.searchBy,'gatepass');assert.equal(body.unit,numbers[body.type as 'GP'|'EX']);
          assert.equal(body.timestamp,'2026-11-16T12:00:00');assert.equal(body.before,10);assert.equal(body.after,30);
          return route.fulfill({json:{matches:[makeMatch(body.type)],scannedFiles:[],errors:[],complete:true,candidates:1}});
        }
        if(body.action==='editor-records') {
          const type=body.token.endsWith('EX')?'EX':'GP';const match=makeMatch(type);
          assert.equal(body.kind,'file');
          return route.fulfill({json:{filename:match.filename,sourceFolder:match.sourceFolder,rows:[match.values,[...match.values]],editorToken:'editor-'+type}});
        }
        assert.fail('Search and closing the editor must not mutate recovery state: '+body.action);
      }
      if(url.pathname.startsWith('/api/'))assert.fail('Unexpected external API');
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.clock.setFixedTime(new Date('2026-11-16T04:00:00Z'));
    await page.goto('http://northport-gatepass.test');
    await page.getByLabel('Container No.',{exact:true}).fill('ABCU1234567');
    await page.getByRole('button',{name:'Container search options',exact:true}).click();
    await page.getByRole('button',{name:'Search GP/EXP NO',exact:true}).click();
    const input=page.getByLabel('Gatepass No.',{exact:true});assert.equal(await input.inputValue(),'');
    await input.fill(numbers.GP);await selectEirTime(page,'2026-11-16T12:00');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    const table=page.getByRole('table',{name:'Scanned File',exact:true});await table.waitFor();
    assert.deepEqual(await table.locator('thead th').allTextContents(),['Container No.','Gatepass No.','Type','Source Filename','Source Folder','File Timestamp','No. of Record','Match Status','Actions']);
    const row=table.locator('tbody tr').first();
    assert.equal(await row.locator('td').nth(1).innerText(),numbers.GP);assert.equal(await row.locator('td').nth(4).innerText(),'SUCCESS');
    const editor=page.getByRole('dialog',{name:'Container file editor',exact:true});
    const openEditor=async()=>{
      await row.getByRole('button',{name:'Record actions',exact:true}).click();
      await page.getByRole('button',{name:'View/Edit File',exact:true}).click();await editor.waitFor();
      await page.waitForFunction(()=>(document.querySelector('button[aria-label="Next container"]') as HTMLButtonElement|null)?.disabled===false);
    };
    await openEditor();await editor.getByLabel('GPNO',{exact:true}).fill('UNSAVED');
    const beforeClose=[requests.length,historyReads];
    await editor.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await editor.count(),0);
    assert.deepEqual([requests.length,historyReads],beforeClose,'Closing the editor makes no API or cancellation audit request');
    await openEditor();assert.equal(await editor.getByLabel('GPNO',{exact:true}).inputValue(),numbers.GP);
    await page.keyboard.press('Escape');assert.equal(await editor.count(),0);
    assert.deepEqual([requests.length,historyReads],beforeClose,'Escape only closes the popup');
    await input.fill(numbers.EX);await page.getByRole('combobox',{name:'Container Type',exact:true}).selectOption('EX');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByText('DEFU7654321',{exact:true}).waitFor();
    assert.equal(await row.locator('td').nth(1).innerText(),numbers.EX);assert.equal(await row.locator('td').nth(4).innerText(),'SUCCESS_ARCHIVES');
    await page.getByRole('button',{name:'Container search options',exact:true}).click();
    await page.getByRole('button',{name:'Search Container',exact:true}).click();
    assert.equal(await page.getByLabel('Container No.',{exact:true}).inputValue(),'');
    assert.ok(!requests.includes('cancel'));assert.deepEqual(errors,[]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Tables scroll inside the page on mobile');
    console.log(`Gatepass search, GP/EXP and folder columns, and editor close without cancellation passed offline at ${width}px.`);
    await page.close();
  }
} finally {await browser.close();}

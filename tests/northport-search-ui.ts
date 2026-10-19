import { selectEirTime } from './northport-picker-helpers';
// Offline mode selection, file browsing and raw-content inspection workflow.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { unzipSync, zipSync } from 'fflate';

const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {NorthportRecovery} from './src/components/admin/NorthportRecovery';createRoot(document.getElementById('root')).render(<NorthportRecovery onBack={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(file=>file.endsWith('.css')).map(file=>readFile(join('dist/assets',file),'utf8')))).join('\n');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [320,390,768,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
    page.setDefaultTimeout(15000);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const unit='WHSU5195154';
    const values=Array(20).fill('');values[0]=unit;
    const file={filename:'CM_CONTAINER_20261019121156_GP.csv',timestamp:'2026-10-19T12:11:56',type:'GP',bytes:472,records:3,matches:0,status:'no-match',token:'inspection-token'};
    const match={...file,record:2,totalRecords:3,fileToken:'inspection-token',values,token:'record-token'};
    const matchedFile={...file,filename:'CM_CONTAINER_20261019121200_GP.csv',timestamp:'2026-10-19T12:12:00',status:'match',matches:1,token:'inspection-match-token'};
    const raw='UNIT,WRONG\r\nWHSU5195154,"broken';
    let downloads=0,archives=0,searches=0;
    const bodies:any[]=[];
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());assert.equal(url.origin,'http://northport.test');
      if(url.pathname==='/api/dev-tools/northport-recovery') {
        if(route.request().method()==='GET')return route.fulfill({json:{history:[],uploadsEnabled:false,missingGates:[]}});
        const body=route.request().postDataJSON();bodies.push(body);
        if(body.action==='download-file') {downloads++;assert.equal(body.token,file.token);return route.fulfill({contentType:'application/octet-stream',body:raw});}
        if(body.action==='download-all') {
          archives++;assert.deepEqual(body.files,[{kind:'file',token:file.token},{kind:'file',token:matchedFile.token}]);
          return route.fulfill({contentType:'application/zip',body:Buffer.from(zipSync({[file.filename]:Buffer.from('original no-match file'),[matchedFile.filename]:Buffer.from('original matching file')}))});
        }
        assert.equal(body.action,'search','Browsing must not approve, upload or trigger a scheduler');
        assert.equal(body.type,'GP');assert.equal(body.before,10);assert.equal(body.after,30);assert.equal(body.timestamp,'2026-10-19T11:49:00');assert.equal(body.sourceFilename,'');searches++;
        if(body.mode==='standard')return route.fulfill({json:{mode:body.mode,matches:[match],scannedFiles:[],errors:[],complete:true,candidates:1}});
        if(body.mode==='files')return route.fulfill({json:{mode:body.mode,matches:body.cursor?[{...match,filename:matchedFile.filename,timestamp:matchedFile.timestamp,fileToken:matchedFile.token}]:[],scannedFiles:[body.cursor?matchedFile:file],errors:[],complete:!!body.cursor,candidates:1,nextCursor:body.cursor?null:'batch-two',progress:{checked:body.cursor?601:600,total:601,files:body.cursor?2:1,records:body.cursor?6:3}}});
        assert.equal(body.mode,'content');return route.fulfill({json:{mode:body.mode,matches:[],scannedFiles:[{...file,records:0,status:'content-match',error:'Unexpected CSV headers.'}],errors:[{filename:file.filename,message:'Unexpected CSV headers.'}],complete:false,candidates:1,nextCursor:null,progress:{checked:601,total:601,files:1,records:0}}});
      }
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main style="padding:16px"><div id="root"></div></main><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.clock.setFixedTime(new Date('2026-10-19T03:49:00Z'));
    await page.goto('http://northport.test');
    await page.getByRole('button',{name:'EIR time (Malaysia)',exact:true}).click();
    const defaultPicker=page.getByRole('dialog',{name:'EIR time (Malaysia) picker',exact:true});
    await page.waitForTimeout(200);
    for(const [label,expected] of [['Hour','11'],['Minute','49']]) {
      const wheel=defaultPicker.getByRole('listbox',{name:label,exact:true});
      assert.equal(await wheel.getByRole('option',{selected:true}).innerText(),expected,'Empty picker defaults to the current Malaysia time');
      await wheel.focus();await page.keyboard.press('End');await page.keyboard.press('ArrowDown');
      assert.equal(await wheel.getByRole('option',{selected:true}).innerText(),'00',`${label} wraps forward to zero`);
      await page.keyboard.press('ArrowUp');
      assert.equal(await wheel.getByRole('option',{selected:true}).innerText(),label==='Hour'?'23':'59',`${label} wraps backward from zero`);
    }
    await page.keyboard.press('Escape');
    const modeButton=()=>page.getByRole('button',{name:/^Search mode:/});
    assert.equal(await modeButton().innerText(),'Basic Scan (Fast)');
    const initialModeWidth=(await modeButton().boundingBox())?.width;
    assert.equal(await page.getByRole('combobox',{name:'Container Type'}).inputValue(),'GP');
    await page.getByLabel('Container No.',{exact:true}).fill(unit);
    await selectEirTime(page, '2026-10-19T11:49:53');
    assert.match(await page.getByRole('button',{name:'EIR time (Malaysia)',exact:true}).innerText(),/11:49$/);
    if(width<640) {
      const eir=await page.getByRole('button',{name:'EIR time (Malaysia)',exact:true}).boundingBox();
      const type=await page.getByRole('combobox',{name:'Container Type',exact:true}).boundingBox();
      const before=await page.getByRole('button',{name:'Minutes before',exact:true}).boundingBox();
      assert.ok(eir&&type&&before&&Math.abs(eir.y-type.y)<1&&Math.abs(eir.height-type.height)<1&&Math.abs(eir.width-type.width)<1&&Math.abs(eir.width-before.width)<1,'Mobile fields align in equal columns after selecting a timestamp');
      await page.locator('.northport-search-card').screenshot({path:join(tmpdir(),`northport-mobile-form-${width}.png`)});
    }
    await page.getByRole('button',{name:'Minutes before',exact:true}).click();
    const rangePicker=page.getByRole('dialog',{name:'Minutes before picker',exact:true});
    const slider=rangePicker.getByRole('listbox',{name:'Minutes before',exact:true});
    assert.equal(await slider.getByRole('option').count(),13);
    await slider.focus();await page.keyboard.press('ArrowDown');assert.equal(await slider.getByRole('option',{selected:true}).innerText(),'15');
    await rangePicker.getByRole('button',{name:'Decrease Minutes before',exact:true}).click();assert.equal(await slider.getByRole('option',{selected:true}).innerText(),'10');
    await slider.evaluate(element => { element.scrollTop=3*36; });
    await page.waitForFunction(() => document.querySelector('[role="listbox"][aria-label="Minutes before"] [aria-selected="true"]')?.textContent==='15');
    await slider.focus();await page.keyboard.press('Home');assert.equal(await slider.getByRole('option',{selected:true}).innerText(),'00');
    await page.keyboard.press('End');assert.equal(await slider.getByRole('option',{selected:true}).innerText(),'60');
    assert.equal(await rangePicker.getByRole('button',{name:'Increase Minutes before',exact:true}).isDisabled(),true);
    await page.keyboard.press('ArrowDown');assert.equal(await slider.getByRole('option',{selected:true}).innerText(),'60');
    await slider.evaluate(element => { element.scrollTop=0; });
    await page.waitForFunction(() => document.querySelector('[role="listbox"][aria-label="Minutes before"] [aria-selected="true"]')?.textContent==='00');
    assert.equal(await rangePicker.getByRole('button',{name:'Decrease Minutes before',exact:true}).isDisabled(),true);
    await slider.focus();await page.keyboard.press('ArrowUp');assert.equal(await slider.getByRole('option',{selected:true}).innerText(),'00');
    await slider.getByRole('option',{name:'Minutes before 10',exact:true}).click();
    await rangePicker.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'Minutes after',exact:true}).click();
    const afterPicker=page.getByRole('dialog',{name:'Minutes after picker',exact:true});
    const afterWheel=afterPicker.getByRole('listbox',{name:'Minutes after',exact:true});
    assert.deepEqual(await afterWheel.getByRole('option').allTextContents(),['00','05','10','15','20','25','30','35','40','45','50','55','60']);
    assert.equal(await afterWheel.getByRole('option',{selected:true}).innerText(),'30');
    await afterWheel.focus();await page.keyboard.press('End');await page.keyboard.press('ArrowDown');
    assert.equal(await afterWheel.getByRole('option',{selected:true}).innerText(),'60');
    assert.equal(await afterPicker.getByRole('button',{name:'Increase Minutes after',exact:true}).isDisabled(),true);
    await page.keyboard.press('Home');await page.keyboard.press('ArrowUp');
    assert.equal(await afterWheel.getByRole('option',{selected:true}).innerText(),'00');
    await afterWheel.getByRole('option',{name:'Minutes after 30',exact:true}).click();
    await afterPicker.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'EIR time (Malaysia)',exact:true}).click();
    const datePicker=page.getByRole('dialog',{name:'EIR time (Malaysia) picker',exact:true});
    await page.waitForTimeout(200);
    assert.equal(await datePicker.getByRole('listbox',{name:'Hour',exact:true}).getByRole('option',{selected:true}).innerText(),'11','Opening the wheel preserves the selected hour');
    assert.equal(await datePicker.getByRole('listbox',{name:'Minute',exact:true}).getByRole('option',{selected:true}).innerText(),'49','Opening the wheel preserves the selected minute');
    const eirTrigger=page.getByRole('button',{name:'EIR time (Malaysia)',exact:true});
    await datePicker.getByRole('listbox',{name:'Hour',exact:true}).evaluate(element=>{element.scrollTop=(24+13)*36;});
    await page.waitForFunction(()=>document.querySelector('[aria-label="EIR time (Malaysia)"]')?.textContent?.includes('13:49'));
    await datePicker.getByRole('listbox',{name:'Minute',exact:true}).evaluate(element=>{element.scrollTop=(60+7)*36;});
    await page.waitForFunction(()=>document.querySelector('[aria-label="EIR time (Malaysia)"]')?.textContent?.includes('13:07'));
    await page.keyboard.press('Escape');
    assert.match(await eirTrigger.innerText(),/13:07$/,'Scrolling commits the time without pressing Done');
    await eirTrigger.click();
    assert.equal(await datePicker.getByRole('listbox',{name:'Hour',exact:true}).getByRole('option',{selected:true}).innerText(),'13');
    assert.equal(await datePicker.getByRole('listbox',{name:'Minute',exact:true}).getByRole('option',{selected:true}).innerText(),'07');
    await datePicker.getByRole('option',{name:'Hour 11',exact:true}).click();
    await datePicker.getByRole('option',{name:'Minute 49',exact:true}).click();
    assert.match(await eirTrigger.innerText(),/11:49$/);
    const pickerBounds=await datePicker.boundingBox();
    const calendarBounds=await datePicker.locator('[data-calendar]').boundingBox();
    for(const label of ['Hour','Minute']) {
      const column=await datePicker.locator(`[data-scroll-column="${label}"]`).boundingBox();
      assert.ok(calendarBounds&&column&&column.x>=calendarBounds.x+calendarBounds.width&&Math.abs(column.y-calendarBounds.y)<1&&Math.abs(column.height-calendarBounds.height)<1,'Time columns sit beside the calendar at the same height');
    }
    assert.ok(pickerBounds&&pickerBounds.x>=0&&pickerBounds.x+pickerBounds.width<=width&&pickerBounds.y>=0&&pickerBounds.y+pickerBounds.height<=1000,'Date picker fits the viewport');
    await page.screenshot({path:join(tmpdir(),`northport-date-picker-${width}.png`)});
    await page.keyboard.press('Escape');
    await page.getByRole('dialog',{name:'EIR time (Malaysia) picker',exact:true}).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Search FTP',exact:true}).click();
    await page.getByRole('button',{name:'Clear',exact:true}).waitFor();
    assert.equal(await page.getByRole('table',{name:'Scanned File',exact:true}).locator('tbody tr').count(),1);
    assert.equal(await page.getByRole('button',{name:'Download all',exact:true}).count(),0,'Basic Scan hides the bulk download control');
    await modeButton().click();
    const options=page.getByRole('dialog',{name:'Search mode options',exact:true});await options.waitFor();
    assert.equal(await options.getByRole('radio').count(),3);
    assert.equal(await options.getByRole('radio').evaluateAll(items=>items.every(item=>item.querySelector('svg')!==null)),true,'Each mode has an icon');
    await options.getByRole('radio',{name:/^Advanced Scan \(Enhanced\)/}).click();
    assert.equal(searches,1,'Choosing a mode must not start searching');
    await modeButton().click();await page.keyboard.press('ArrowUp');
    assert.equal(await options.getByRole('radio',{name:/^Basic Scan \(Fast\)/}).getAttribute('aria-checked'),'true');
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
    await options.waitFor({state:'hidden'});assert.equal(await modeButton().innerText(),'Advanced Scan (Enhanced)');
    assert.equal((await modeButton().boundingBox())?.width,initialModeWidth,'Mode selector width stays fixed');
    await page.getByRole('button',{name:'Search FTP',exact:true}).click();
    const files=page.getByRole('region',{name:'Scanned File',exact:true});await files.waitFor();
    assert.equal(await modeButton().isDisabled(),true);
    assert.equal(await files.getByRole('button',{name:`Download ${file.filename}`,exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Cancel Search',exact:true}).waitFor({state:'hidden'});
    const rows=files.locator('tbody tr');assert.equal(await rows.count(),2,'File results from both batches remain visible');
    assert.match(await rows.first().innerText(),/WHSU5195154/);assert.match(await rows.first().innerText(),/MATCH/);assert.match(await rows.last().innerText(),/NO MATCH/);
    assert.match(await rows.last().locator('td').first().getAttribute('class')??'',/text-center/,'Empty container values are centered');
    assert.equal(await page.getByRole('table',{name:'Scanned File',exact:true}).count(),1,'File and match results share one table');
    assert.equal(await page.getByRole('heading',{name:'Matching container records',exact:true}).count(),0);
    assert.equal(await page.getByText(/SUCCESS folder · filenames use MYT/).count(),0,'Result mode summary is hidden');
    const archive=page.waitForEvent('download');await files.getByRole('button',{name:'Download all',exact:true}).click();
    const zip=await archive;assert.equal(zip.suggestedFilename(),'NORTHPORT_SCANNED_FILES.zip');
    const contents=unzipSync(await readFile((await zip.path())!));assert.equal(Buffer.from(contents[file.filename]).toString(),'original no-match file');assert.equal(Buffer.from(contents[matchedFile.filename]).toString(),'original matching file');assert.equal(archives,1);
    await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('[aria-label^="Search mode:"]')?.disabled);
    await modeButton().click();
    const menuBox=await options.boundingBox();assert.ok(menuBox&&menuBox.x>=0&&menuBox.x+menuBox.width<=width&&menuBox.y>=0&&menuBox.y+menuBox.height<=1000);
    await page.screenshot({path:join(tmpdir(),`northport-search-menu-${width}.png`)});
    await options.getByRole('radio',{name:/^Deep Scan \(Maximum\)/}).click();
    assert.equal((await modeButton().boundingBox())?.width,initialModeWidth,'Mode selector width stays fixed');
    await page.getByRole('button',{name:'Search FTP',exact:true}).click();
    await files.getByText('TEXT FOUND',{exact:true}).waitFor();await files.getByText('Unverified',{exact:true}).waitFor();
    assert.equal(await rows.count(),1,'A new search clears previous file results');
    await page.getByRole('status').filter({hasText:'Container text found in 1 file'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Record actions',exact:true}).count(),0);
    const download=page.waitForEvent('download');await files.getByRole('button',{name:`Download ${file.filename}`,exact:true}).click();
    const downloaded=await download;assert.equal(downloaded.suggestedFilename(),file.filename);assert.equal(await readFile((await downloaded.path())!,'utf8'),raw);assert.equal(downloads,1);
    await modeButton().waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('[aria-label^="Search mode:"]')?.disabled);
    await files.scrollIntoViewIfNeeded();await page.screenshot({path:join(tmpdir(),`northport-content-scan-${width}.png`)});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Search controls and file list must fit the viewport');
    await modeButton().click();await options.getByRole('radio',{name:/^Advanced Scan \(Enhanced\)/}).click();await page.getByRole('button',{name:'Search FTP',exact:true}).click();
    await files.waitFor();await page.getByRole('button',{name:'Cancel Search',exact:true}).click();
    await page.getByRole('button',{name:'Clear',exact:true}).waitFor();assert.equal(await rows.count(),1,'Cancel retains scanned files');
    await page.getByRole('button',{name:'Clear',exact:true}).click();assert.equal(await modeButton().innerText(),'Basic Scan (Fast)');assert.equal(await page.getByRole('combobox',{name:'Container Type'}).inputValue(),'GP');
    assert.equal(await files.count(),0);assert.equal(bodies.filter(body=>body.cursor).length,1);assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('Northport search modes: desktop/mobile selection, batching, raw-content download, cancellation and reset passed.');
} finally {await browser.close();}

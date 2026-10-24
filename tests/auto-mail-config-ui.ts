// Settings page layout and behavior, with every request intercepted.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{AutoEmailConfig}from'./src/components/admin/AutoEmailConfig';function App(){const[view,setView]=useState('settings');return <main className="min-h-screen bg-slate-50 p-4 sm:p-6">{view==='settings'?<AutoEmailConfig onBack={()=>setView('back')} onOpenMail={()=>setView('mail')}/>:<p>{view==='mail'?'Auto Mail opened':'Developer settings opened'}</p>}</main>}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [360, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let model = { enabled: true, model: 'configured-model', enabled_models: ['configured-model'], version: 1 };
    let incoming = { enabled: true, scope: 'ALL', auto_reply_enabled: false, min_confidence: 0.95, max_auto_replies_per_hour: 5, version: 1 };
    let writes = 0, modelLoads = 0, incomingLoads = 0;
    await page.route('**/*', route => {
      const url = new URL(route.request().url()); assert.equal(url.origin, 'http://settings.test');
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname.startsWith('/assets/')) return route.fulfill({ path: 'dist' + url.pathname });
      if (url.pathname === '/api/auto-mail/agent-settings') {
        if (route.request().method() === 'POST') { writes++; const data = route.request().postDataJSON(); model = { enabled: data.enabled, model: data.model, enabled_models: data.enabledModels, version: model.version + 1 }; return route.fulfill({ json: { settings: model } }); }
        modelLoads++; return route.fulfill({ json: { settings: model, models: ['configured-model', 'another-model'], storageReady: true, serverEnabled: true, keyConfigured: true } });
      }
      if (url.pathname === '/api/auto-mail/incoming-settings') {
        if (route.request().method() === 'POST') { writes++; incoming = { ...route.request().postDataJSON(), version: incoming.version + 1 }; return route.fulfill({ json: { settings: incoming } }); }
        incomingLoads++; return route.fulfill({ json: { settings: incoming, storageReady: true, autoReplyReady: true, autoReplyServerEnabled: true, worker: null } });
      }
      assert.equal(url.pathname, '/', 'Settings must not load KB, learning, status, or mailbox data');
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://settings.test');
    await page.getByRole('checkbox', { name: 'Let AI send eligible replies automatically', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 0);
    assert.equal(await page.getByRole('table').count(), 0);
    assert.equal(writes, 0, 'Opening settings never saves or enables sending');
    const refresh = page.getByRole('button', { name: 'Refresh AI settings', exact: true });
    await page.locator('[data-ai-status="ready"]').waitFor();
    assert.equal(await page.getByRole('button', { name: /Reload/ }).count(), 0);
    const refreshBox = (await refresh.boundingBox())!;
    assert.equal(refreshBox.width, 48); assert.equal(refreshBox.height, 48);
    await refresh.click();
    await page.locator('[data-ai-status="ready"]').waitFor();
    assert.equal(modelLoads, 2); assert.equal(incomingLoads, 2); assert.equal(writes, 0);
    for (const saveName of ['Save agent settings', 'Save incoming draft settings']) {
      assert.equal((await page.getByRole('button', { name: saveName, exact: true }).boundingBox())!.height, 36);
    }
    const toggles = page.getByRole('checkbox',{name:/Enable AI reply suggestions|Automatically prepare drafts for incoming emails|Let AI send eligible replies automatically/});
    const positions = await toggles.evaluateAll(inputs => inputs.filter(input => input.getBoundingClientRect().width > 0).map(input => input.getBoundingClientRect().right));
    assert.equal(positions.length, 3); assert.ok(Math.max(...positions) - Math.min(...positions) < 1, 'All primary toggles align');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `test-results/auto-email-settings-${width}.png`, fullPage: true });
    await page.getByRole('combobox', { name: 'Active reply model', exact: true }).selectOption('another-model');
    page.once('dialog', dialog => void dialog.dismiss());
    await page.getByRole('button', { name: 'Auto Mail', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: 'Active reply model', exact: true }).inputValue(), 'another-model');
    await page.getByRole('button', { name: 'Save agent settings', exact: true }).click();
    await page.getByText('Email agent settings saved. New drafts use these settings.', { exact: true }).waitFor();
    assert.equal(model.model, 'another-model');
    const scope=page.getByRole('group',{name:'Authoritative KB scope',exact:true});
    await scope.getByRole('checkbox',{name:'WESTPORT',exact:true}).check();
    await scope.getByRole('checkbox',{name:'NORTHPORT',exact:true}).check();
    assert.equal(await scope.getByRole('checkbox',{name:'ALL - general guidance',exact:true}).isChecked(),false);
    await page.getByRole('spinbutton', { name: 'Minimum confidence (%)', exact: true }).fill('98');
    page.once('dialog', dialog => void dialog.dismiss());
    await page.getByRole('button', { name: 'Refresh AI settings', exact: true }).click();
    assert.equal(await page.getByRole('spinbutton', { name: 'Minimum confidence (%)', exact: true }).inputValue(), '98');
    await page.getByRole('button', { name: 'Save incoming draft settings', exact: true }).click();
    await page.getByText('Automatic replies are OFF. Replies require staff review and Send.', { exact: true }).waitFor();
    assert.equal(incoming.scope,'NORTHPORT, WESTPORT'); assert.equal(incoming.min_confidence, 0.98); assert.equal(incoming.auto_reply_enabled, false);
    await page.getByRole('combobox', { name: 'Active reply model', exact: true }).selectOption('configured-model');
    await page.getByRole('spinbutton', { name: 'Minimum confidence (%)', exact: true }).fill('99');
    page.once('dialog', dialog => void dialog.accept());
    await refresh.click();
    await page.locator('[data-ai-status="ready"]').waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Active reply model', exact: true }).inputValue(), 'another-model');
    assert.equal(await page.getByRole('spinbutton', { name: 'Minimum confidence (%)', exact: true }).inputValue(), '98');
    assert.equal(modelLoads, 3); assert.equal(incomingLoads, 3); assert.equal(writes, 2);
    model = { ...model, enabled: false };
    await refresh.click();
    await page.locator('[data-ai-status="inactive"]').waitFor();
    assert.equal(writes, 2, 'Refresh must never save or enable AI');
    model = { ...model, enabled: true };
    await refresh.click();
    await page.locator('[data-ai-status="ready"]').waitFor();
    await page.getByRole('button', { name: 'Auto Mail', exact: true }).click();
    await page.getByText('Auto Mail opened', { exact: true }).waitFor();
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Clean Auto Email settings, aligned actions/toggles, isolated saves and unsaved navigation passed at 360/768/1440px.');
} finally { await browser.close(); }

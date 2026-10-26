// All requests are intercepted; no live database or mailbox access.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { launchBrowser } from '../server-handlers/scheduler/automation.js';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
  import{DeveloperSettings}from'./src/components/admin/DeveloperSettings';
  import{startDeveloperSettingsSync,useDeveloperSettings}from'./src/services/developerSettings';
  function App(){const s=useDeveloperSettings();useEffect(()=>startDeveloperSettingsSync(),[]);return <>
    <DeveloperSettings onOpenScheduler={()=>{}} onOpenExcelMapping={()=>{}} onOpenPortDepotConfig={()=>{}} onOpenAutoEmailConfig={()=>{}}/>
    {s.registrationTestToolsEnabled&&<button>Auto Fill probe</button>}{s.simulationEnabled&&<button>Simulate probe</button>}</>}
  createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const browser = await launchBrowser();
try {
  let settings = { registrationTestToolsEnabled: false, simulationEnabled: false }, fail = false;
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('cargomove_registration_test_tools_enabled', 'true'));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    assert.equal(url.origin, 'http://settings.test');
    if (url.pathname === '/api/dev-tools/settings') {
      if (fail) return route.fulfill({ status: 503, json: { error: 'Settings unavailable' } });
      if (req.method() === 'PATCH') settings = { ...settings, ...req.postDataJSON() };
      return route.fulfill({ json: { settings } });
    }
    if (url.pathname === '/api/scheduler/auto-register-cm') return route.fulfill({ json: { scheduler: { isEnabled: false } } });
    assert.equal(url.pathname, '/');
    return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
  });
  const admin = await context.newPage(), visitor = await context.newPage();
  await visitor.clock.install();
  await admin.goto('http://settings.test'); await visitor.goto('http://settings.test');
  const tools = admin.getByRole('switch', { name: 'Registration test tools' });
  await tools.waitFor();
  assert.equal(await tools.getAttribute('aria-checked'), 'false');
  assert.equal(await visitor.getByRole('button', { name: 'Auto Fill probe' }).count(), 0, 'Legacy local flag cannot enable autofill');
  await admin.getByText('System Scheduler', { exact: true }).waitFor();
  await tools.click();
  await admin.getByRole('button', { name: 'Auto Fill probe' }).waitFor();
  await visitor.evaluate(() => window.dispatchEvent(new Event('focus')));
  await visitor.getByRole('button', { name: 'Auto Fill probe' }).waitFor();
  await admin.getByRole('switch', { name: 'Registration simulation' }).click();
  await visitor.evaluate(() => window.dispatchEvent(new Event('focus')));
  await visitor.getByRole('button', { name: 'Simulate probe' }).waitFor();
  await tools.click();
  await visitor.clock.fastForward(30_000);
  await visitor.getByRole('button', { name: 'Auto Fill probe' }).waitFor({ state: 'detached' });
  fail = true;
  await visitor.evaluate(() => window.dispatchEvent(new Event('online')));
  await visitor.getByRole('button', { name: 'Simulate probe' }).waitFor({ state: 'detached' });
  await admin.getByRole('switch', { name: 'Registration simulation' }).click();
  await admin.getByRole('alert').waitFor();
  assert.equal(settings.simulationEnabled, true, 'Failed saves do not alter the persisted setting');
  fail = false;
  await visitor.evaluate(() => window.dispatchEvent(new Event('online')));
  await visitor.getByRole('button', { name: 'Simulate probe' }).waitFor();
  console.log('Shared developer settings: stale local flag, cross-tab changes, simulation toggle and failure defaults passed.');
} finally { await browser.close(); }

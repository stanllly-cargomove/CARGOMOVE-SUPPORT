// Real components with synthetic API fixtures. No database or email traffic.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{ReviewScreen}from'./src/components/customer/ConfirmationScreen';
    import{EmailTemplateManager}from'./src/components/admin/EmailTemplateManager';
    import{logoutApplicationUser}from'./src/services/auth';
    import{loadDeveloperSettings}from'./src/services/developerSettings';
    void loadDeveloperSettings();
    window.submitted=0;window.previewed=0;
    function App(){const[view,setView]=useState('review');return <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mb-6 flex gap-4"><button onClick={()=>setView('review')}>Review</button><button onClick={()=>setView('templates')}>Templates</button><button onClick={()=>setView('away')}>Leave</button><button onClick={()=>void logoutApplicationUser().then(()=>setView('away'))}>End session</button></div>
      {view==='review'?<ReviewScreen location="JOHOR" port={{id:'port',display_name:'Johor'}} type="DRIVER" company={{id:'company',name:'EXAMPLE TRANSPORT',registration_number:'TEST-123',company_type:'HAULAGE'}} formData={{drivers:[{name:'EXAMPLE DRIVER',driving_license:'TEST-456',mobile_no:'0120000000'}]}} onBack={()=>setView('away')} onSubmitSuccess={async()=>{window.submitted++;return 'test'}}/>:view==='templates'?<EmailTemplateManager/>:<p>Away</p>}
    </main>}createRoot(document.getElementById('root')).render(<App/>);
  ` },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'offline-excel', setup(builder) { builder.onLoad({ filter: /[\\/]services[\\/]excelExport\.ts$/ }, () => ({ contents: 'export const exportSubmissionPreview=()=>{window.previewed++}', loader: 'js' })); } }],
});
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let reads = 0, writes = 0, fail = false, gmailConnected = true;
  let release!: () => void;
  let gate: Promise<void> | null = new Promise(resolve => { release = resolve; });
  let template = { id: 'example', name: 'Example acceptance', template_code: 'ACC001', port_ids: ['port'], trigger_status: 'DONE', recipient_template: '{{user.email}}', subject_template: 'Example subject', body_template: '<p>Example body</p>', active: true, version: 1, attachments: [] };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, 'http://review.test');
    if (url.pathname === '/api/dev-tools/settings') return route.fulfill({ json: { settings: { registrationTestToolsEnabled: true, simulationEnabled: false } } });
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
    if (url.pathname.startsWith('/assets/')) return route.fulfill({ path: 'dist' + url.pathname });
    if (url.pathname === '/api/auth/logout') return route.fulfill({ json: {} });
    if (url.pathname === '/api/email/templates' && request.method() === 'PUT') {
      writes++; template = { ...template, ...request.postDataJSON(), version: template.version + 1 };
      return route.fulfill({ json: { template } });
    }
    if (url.pathname.startsWith('/api/')) {
      assert.equal(request.method(), 'GET', 'No sends or other mutations'); reads++;
      if (gate) await gate;
      if (fail) return route.fulfill({ status: 503, json: { error: 'Temporary test outage.' } });
      if (url.pathname === '/api/email/templates') return route.fulfill({ json: { templates: [template], ports: [{ id: 'port', display_name: 'Johor', active: true }], portAssignmentMode: 'shared' } });
      if (url.pathname === '/api/gmail/status') return route.fulfill({ json: { connected: gmailConnected, connection: gmailConnected ? { email: 'test@example.test', status: 'CONNECTED' } : null } });
      assert.equal(url.pathname, '/api/email/logs'); return route.fulfill({ json: { logs: [], total: 0 } });
    }
    assert.equal(url.pathname, '/');
    return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
  });
  await page.goto('http://review.test');
  const nav = page.getByRole('navigation', { name: 'Review submission actions' });
  await nav.getByRole('button', { name: /Excel/i }).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const boxes = await nav.getByRole('button').evaluateAll(buttons => buttons.map(button => { const rect = button.getBoundingClientRect(); return { top: rect.top, width: rect.width, height: rect.height, fits: button.scrollHeight <= button.clientHeight }; }));
    assert.equal(boxes.length, 3);
    for (const box of boxes) { assert.equal(box.top, boxes[0].top); assert.ok(Math.abs(box.width - boxes[0].width) < 1); assert.equal(box.height, 48); assert.equal(box.fits, true); }
    assert.equal(await page.getByText('Your registration will be sent to our team for processing.').count(), 0);
    assert.equal(await nav.getByRole('button', { name: 'Confirm & Submit Registration', exact: true }).isDisabled(), true);
    await page.screenshot({ path: `test-results/registration-review-${width}.png`, fullPage: true });
  }
  await nav.getByRole('button', { name: 'Generate Excel', exact: true }).click();
  assert.equal(await page.evaluate(() => (window as any).previewed), 1);
  await page.getByRole('checkbox').nth(0).check(); await page.getByRole('checkbox').nth(1).check();
  await nav.getByRole('button', { name: 'Confirm & Submit Registration', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.evaluate(() => (window as any).submitted), 0);
  await page.getByRole('button', { name: 'Close email confirmation', exact: true }).click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('status', { name: 'Loading email settings' }).waitFor();
  await page.screenshot({ path: 'test-results/email-settings-loading.png', fullPage: true });
  release(); gate = null;
  await page.getByRole('button', { name: 'Example acceptance', exact: true }).click();
  await page.getByRole('textbox', { name: 'Template name', exact: true }).fill('Saved acceptance');
  await page.getByRole('button', { name: 'Save Template', exact: true }).click();
  await page.getByRole('button', { name: 'Saved acceptance', exact: true }).waitFor();
  assert.equal(writes, 1);
  assert.equal(await page.getByRole('button', { name: 'Refresh email settings', exact: true }).count(), 0, 'The standalone refresh button is removed');
  assert.equal(await page.getByRole('button', { name: /Google.*Click to refresh email settings/ }).count(), 1);
  await page.getByRole('button', { name: 'Reconnect Gmail', exact: true }).waitFor();
  const loadedReads = reads;
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Saved acceptance', exact: true }).waitFor();
  assert.equal(await page.getByRole('status', { name: 'Loading email settings' }).count(), 0);
  assert.equal(reads, loadedReads, 'Reopening uses fresh session data');
  fail = true;
  await page.getByRole('button', { name: /Google.*Click to refresh email settings/ }).click();
  await page.getByRole('alert').filter({ hasText: 'Showing saved settings.' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Saved acceptance', exact: true }).isVisible(), true);
  fail = false; gmailConnected = false; template = { ...template, name: 'Updated acceptance' };
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: 'Updated acceptance', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Connect Gmail', exact: true }).waitFor();
  const beforeDisconnectedRefresh = reads;
  await page.getByRole('button', { name: /Google is not connected.*Click to refresh email settings/ }).click();
  await page.waitForFunction(() => document.querySelector('button[aria-label^="Google is not connected"]')?.getAttribute('aria-busy') === 'false');
  assert.equal(reads, beforeDisconnectedRefresh + 3, 'The disconnected Google logo also refreshes instead of starting OAuth');
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByText('Away', { exact: true }).waitFor();
  gate = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('status', { name: 'Loading email settings' }).waitFor();
  release(); gate = null;
  await page.getByRole('button', { name: 'Updated acceptance', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Review actions align at 320/390/768/1440px; consent/export and template loading, saved cache, refresh/retry and logout clearing passed.');
} finally { await browser.close(); }

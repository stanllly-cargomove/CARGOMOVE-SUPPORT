// Render the real preview and email service with synthetic APIs only.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'react-hot-toast';
    import{UserRegistration}from'./src/components/admin/UserRegistration';
    createRoot(document.getElementById('root')).render(<main className="p-4"><Toaster/><UserRegistration/></main>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'offline-user-data', setup(builder) {
    builder.onLoad({ filter: /[\\/]services[\\/]auth\.ts$/ }, () => ({ contents: `
      export async function getExternalUserAccess(){return [{id:'user',username:'fixture-user',email:'mistyped@example.test',company_id:'company',company_name:'Fixture Company',status:'DONE',email_status:'READY',created_at:'2026-01-01'}];}
      export async function updateExternalUserAccess(){throw new Error('Account changes are forbidden in this test');}
    `, loader: 'js' }));
    builder.onLoad({ filter: /[\\/]services[\\/]storage\.ts$/ }, () => ({ contents: `
      export function getSubmissions(){return [{company_id:'company',registration_type:'COMPANY',port_id:'port',status:'DONE'}];}
      export function getCompanyById(){return null;}
      export function subscribeToStorage(){return ()=>{};}
    `, loader: 'js' }));
  } }],
});
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(8000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const sends: any[] = [];
    let fail = true, release!: () => void;
    let gate: Promise<void> | null = null;
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, 'https://recipients.test', 'External traffic is forbidden');
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname.startsWith('/assets/')) return route.fulfill({ path: 'dist' + url.pathname });
      if (url.pathname === '/api/email/templates') return route.fulfill({ json: { templates: [{ id: 'acceptance', name: 'Acceptance',
        template_code: 'ACC001', trigger_status: 'DONE', registration_type: 'COMPANY', active: true, port_ids: ['port'] }], ports: [{ id: 'port', display_name: 'Fixture port', active: true }], portAssignmentMode: 'shared' } });
      if (url.pathname === '/api/email/preview') return route.fulfill({ json: { recipient: 'mistyped@example.test', subject: 'Welcome',
        body: '<p>Welcome to CargoMove.</p>', templateName: 'Acceptance', templateCode: 'ACC001', previewToken: 'offline-preview-token', attachments: [] } });
      if (url.pathname === '/api/email/send') {
        sends.push(request.postDataJSON());
        if (gate) await gate;
        return fail ? route.fulfill({ status: 502, json: { error: 'Mock Gmail failure.' } }) : route.fulfill({ json: { status: 'SENT', gmailMessageId: 'offline-message' } });
      }
      assert.equal(url.pathname, '/');
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('https://recipients.test');
    await page.getByRole('tab', { name: /Closed \/ Done/ }).click();
    const open = async () => {
      await page.getByRole('button', { name: 'Actions for fixture-user', exact: true }).filter({ visible: true }).click();
      await page.getByRole('menuitem', { name: 'Resend Email', exact: true }).click();
      await page.getByRole('dialog', { name: 'Email Preview', exact: true }).waitFor();
    };
    await open();
    const dialog = page.getByRole('dialog', { name: 'Email Preview', exact: true });
    const to = dialog.getByRole('textbox', { name: 'To', exact: true });
    const send = dialog.getByRole('button', { name: 'Send Email', exact: true });
    assert.equal(await to.inputValue(), 'mistyped@example.test');
    await to.fill('corrected@example.test; added@example.test');
    assert.equal(await send.isEnabled(), true);
    await to.fill('');
    assert.equal(await send.isDisabled(), true);
    await dialog.getByRole('alert').filter({ hasText: 'Enter at least one recipient' }).waitFor();
    await to.fill('corrected@example.test;bad-address');
    assert.equal(await send.isDisabled(), true);
    assert.equal(await to.getAttribute('aria-invalid'), 'true');
    assert.equal(sends.length, 0);
    await to.fill('Corrected@Example.test; Added@example.test, corrected@example.test');
    await send.click();
    await page.getByRole('status').filter({ hasText: 'Mock Gmail failure.' }).waitFor();
    assert.equal(await to.inputValue(), 'Corrected@Example.test; Added@example.test, corrected@example.test', 'Failure preserves edits');
    assert.equal(sends[0].recipient, 'corrected@example.test, added@example.test');
    assert.equal(sends[0].previewToken, 'offline-preview-token');
    // Remove the first recipient, then ensure the in-flight send freezes the list.
    await to.fill('added@example.test');
    fail = false; gate = new Promise(resolve => { release = resolve; });
    await send.click();
    await page.waitForFunction(() => (document.querySelector('input[aria-describedby^="email-recipients-help"]') as HTMLInputElement)?.disabled);
    assert.equal(await dialog.getByRole('button', { name: 'Sending...', exact: true }).isDisabled(), true);
    await page.screenshot({ path: `test-results/welcome-recipients-${width}.png`, fullPage: true });
    release(); gate = null;
    await dialog.waitFor({ state: 'detached' });
    assert.equal(sends.length, 2); assert.equal(sends[1].recipient, 'added@example.test');
    await open();
    assert.equal(await to.inputValue(), 'mistyped@example.test', 'A new preview uses the saved account email');
    await to.fill('cancelled@example.test');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(sends.length, 2, 'Cancel does not send');
    assert.deepEqual(errors, []);
    console.log(`Passed: editable welcome recipients at ${width}px`);
    await page.close();
  }
} finally { await browser.close(); }

// Render the real editor with synthetic, fully intercepted APIs. No live services.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{EmailTemplateManager}from'./src/components/admin/EmailTemplateManager';
    createRoot(document.getElementById('root')).render(<main className="p-4"><EmailTemplateManager/></main>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
});
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const touch of [false, true]) {
    const page = await browser.newPage({ viewport: { width: touch ? 390 : 1280, height: 900 }, hasTouch: touch, isMobile: touch });
    page.setDefaultTimeout(8000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let templates: any[] = [
      { id: 'cargomove-welcome', name: 'Company acceptance', template_code: 'ACC001', registration_type: 'COMPANY', trigger_status: 'DONE', legacy_fallback: true },
      { id: 'custom', name: 'Driver acceptance', template_code: 'ACC099', registration_type: 'DRIVER', trigger_status: 'DONE' },
      { id: 'reject-driver', name: 'Driver rejection', template_code: 'REJ099', registration_type: 'DRIVER', trigger_status: 'REJECTED' },
    ].map(template => ({ ...template, recipient_template: '{{user.email}}', subject_template: 'Fixture subject', body_template: '<p>Fixture body</p>', port_ids: ['port'], attachments: [], active: true, version: 1 }));
    const writes: any[] = [];
    let deletes = 0;
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, 'https://email-types.test', 'External traffic is forbidden');
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname.startsWith('/assets/')) return route.fulfill({ path: 'dist' + url.pathname });
      if (url.pathname === '/api/email/templates') {
        if (request.method() === 'DELETE') {
          deletes++; templates = templates.filter(template => template.id !== request.postDataJSON().id);
          return route.fulfill({ json: {} });
        }
        if (['PUT', 'POST'].includes(request.method())) {
          const saved = { ...request.postDataJSON(), version: 2 }; writes.push(saved);
          templates = [...templates.filter(template => template.id !== saved.id), saved];
          return route.fulfill({ json: { template: saved } });
        }
        return route.fulfill({ json: { templates, ports: [{ id: 'port', display_name: 'Fixture port', active: true }], portAssignmentMode: 'shared' } });
      }
      if (url.pathname === '/api/gmail/status') return route.fulfill({ json: { connected: false, connection: null } });
      if (url.pathname === '/api/email/logs') return route.fulfill({ json: { logs: [], total: 0 } });
      assert.equal(url.pathname, '/');
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('https://email-types.test');
    const trigger = page.getByRole('button', { name: 'Actions for ACC099', exact: true });
    const open = async () => { if (touch) await trigger.tap(); else await trigger.hover(); await page.getByRole('menu').waitFor(); };
    await open();
    assert.equal(await page.getByRole('menuitem', { name: 'Delete', exact: true }).isEnabled(), true);
    const edit = page.getByRole('menuitem', { name: 'Edit', exact: true });
    assert.equal(await edit.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
        && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, 'Last-row menu remains visible outside the scrolling table');
    if (!touch) {
      // Cross the trigger/menu gap slowly, as a person would when hovering.
      const buttonBox = (await trigger.boundingBox())!, editBox = (await edit.boundingBox())!;
      await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height - 1);
      await page.mouse.move(editBox.x + editBox.width / 2, editBox.y + editBox.height / 2, { steps: 20 });
      assert.equal(await edit.isVisible(), true);
    }
    await edit.click();
    await page.getByRole('combobox', { name: 'Assigned type', exact: true }).waitFor();
    if (!touch) {
      const subject = (await page.getByRole('textbox', { name: 'Subject', exact: true }).boundingBox())!;
      const type = (await page.getByRole('combobox', { name: 'Assigned type', exact: true }).boundingBox())!;
      const recipient = (await page.getByRole('textbox', { name: 'Recipient', exact: true }).boundingBox())!;
      const triggerBox = (await page.getByRole('textbox', { name: 'Trigger', exact: true }).boundingBox())!;
      const codeLabel = (await page.locator('label').filter({ has: page.getByRole('textbox', { name: 'Three-digit code number' }) }).boundingBox())!;
      assert.equal(subject.y, type.y); assert.equal(type.y, recipient.y);
      assert.ok(Math.abs(type.x - codeLabel.x) < 1, 'Type aligns beneath acceptance code');
      assert.ok(Math.abs(recipient.width - triggerBox.width) < 1, 'Recipient follows Trigger width');
    }
    await page.getByRole('combobox', { name: 'Assigned type' }).selectOption('VEHICLE');
    await page.getByRole('button', { name: 'Save Template', exact: true }).click();
    await page.getByRole('button', { name: 'Driver acceptance', exact: true }).waitFor();
    assert.equal(writes.at(-1).registration_type, 'VEHICLE');
    assert.equal(await page.getByRole('row').filter({ hasText: 'ACC099' }).getByRole('cell', { name: 'VEHICLE', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Driver acceptance', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: 'Assigned type' }).inputValue(), 'VEHICLE');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Explicit All must also work for templates that once used ID inference.
    await page.getByRole('button', { name: 'Company acceptance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Assigned type' }).selectOption('');
    await page.getByRole('button', { name: 'Save Template', exact: true }).click();
    await page.getByRole('button', { name: 'Company acceptance', exact: true }).waitFor();
    assert.equal(writes.at(-1).registration_type, null);
    assert.equal(await page.getByRole('row').filter({ hasText: 'ACC001' }).getByRole('cell', { name: 'All', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Company acceptance', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: 'Assigned type' }).inputValue(), '');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('button', { name: 'Add acceptance code', exact: true }).click();
    await page.getByRole('textbox', { name: 'Template name', exact: true }).fill('Trailer acceptance');
    await page.getByRole('textbox', { name: 'Three-digit code number' }).fill('100');
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Fixture trailer subject');
    await page.getByRole('combobox', { name: 'Assigned type' }).selectOption('TRAILER');
    await page.getByRole('checkbox', { name: 'Fixture port', exact: true }).check();
    await page.locator('[contenteditable="true"][role="textbox"]').fill('Fixture trailer body');
    await page.getByRole('button', { name: 'Save Template', exact: true }).click();
    await page.getByRole('button', { name: 'Trailer acceptance', exact: true }).waitFor();
    assert.equal(writes.at(-1).registration_type, 'TRAILER');
    await page.getByRole('tab', { name: 'Rejection codes', exact: true }).click();
    await page.getByRole('button', { name: 'Driver rejection', exact: true }).click();
    await page.getByRole('combobox', { name: 'Assigned type' }).selectOption('TRAILER');
    await page.getByRole('button', { name: 'Save Template', exact: true }).click();
    await page.getByRole('button', { name: 'Driver rejection', exact: true }).waitFor();
    assert.equal(writes.at(-1).registration_type, 'TRAILER');
    await page.getByRole('tab', { name: 'Acceptance codes', exact: true }).click();
    await open();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    await trigger.press('Enter');
    await page.getByRole('menu').waitFor();
    await page.getByRole('heading', { name: 'Email Templates', exact: true }).click();
    assert.equal(await page.getByRole('menu').count(), 0);
    await open();
    await page.screenshot({ path: `test-results/email-registration-actions-${touch ? 'touch' : 'desktop'}.png`, fullPage: true });
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Driver acceptance', exact: true }).waitFor({ state: 'detached' });
    assert.equal(deletes, 1);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Email types: desktop/touch menu visibility, hover gap, keyboard/outside dismissal, add/edit persistence, explicit All, rejection edit and deletion passed.');
} finally { await browser.close(); }

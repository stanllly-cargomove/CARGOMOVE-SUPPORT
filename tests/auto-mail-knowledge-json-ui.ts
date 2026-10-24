// Offline browser checks: every network request is intercepted.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AutoMailKnowledge} from './src/components/admin/AutoMailKnowledge';createRoot(document.getElementById('root')).render(<AutoMailKnowledge ready/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [360, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let saves = 0;
    let saved: any;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      if (path === '/api/auto-mail/knowledge') {
        if (route.request().method() === 'GET') return route.fulfill({ json: { articles: [], total: 0 } });
        saves++;
        saved = { ...route.request().postDataJSON(), id: 'article-1', version: saves, status: 'DRAFT' };
        return route.fulfill({ json: { article: saved } });
      }
      return route.abort();
    });
    await page.goto('http://kb.test');
    await page.addScriptTag({ content: 'window.__name = (value) => value;' });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).copiedTemplate = text; } } }));
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('button', { name: 'New article' }).click();
    await page.getByRole('button',{name:'Article options',exact:true}).click();
    await page.getByRole('menuitem', { name: 'Copy JSON template' }).click();
    await page.getByText('JSON template copied.', { exact: false }).waitFor();
    const template = JSON.parse(await page.evaluate(() => (window as any).copiedTemplate));
    assert.deepEqual(Object.keys(template).sort(), ['category', 'content', 'keywords', 'port', 'summary', 'title']);
    await page.getByRole('button',{name:'Article options',exact:true}).click();
    await page.getByRole('menuitem', { name: 'Paste JSON', exact: true }).click();
    const json = page.getByRole('textbox', { name: 'Article JSON', exact: true });
    const paste = async (text: string) => json.evaluate((element, value) => {
      const data = new DataTransfer(); data.setData('text', value);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
    const article = { title: 'Registration help', summary: 'Documents to prepare', category: 'Registration', port: 'northport', keywords: ['registration', 'documents'], content: '1. Prepare documents.\n2. Submit the request.' };
    await paste(JSON.stringify(article));
    await page.getByText('JSON loaded into the article fields.', { exact: false }).waitFor();
    for (const [label, value] of [['Article title', article.title], ['Short summary', article.summary], ['Category', article.category], ['Port or scope', 'NORTHPORT'], ['Keywords (comma separated)', 'registration, documents'], ['Answer / procedure', article.content]]) {
      assert.equal(await page.getByRole('textbox', { name: label, exact: true }).inputValue(), value);
    }
    assert.equal(saves, 0, 'Pasting must not save or approve an article');
    for (const invalid of ['{bad', '[]', JSON.stringify({ ...article, content: 42 }), JSON.stringify({ ...article, title: 'x'.repeat(161) }), JSON.stringify({ ...article, keywords: ['x'.repeat(61)] })]) {
      await paste(invalid);
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'Article title', exact: true }).inputValue(), article.title, 'Invalid JSON preserves existing fields');
      assert.equal(await page.getByRole('textbox', { name: 'Answer / procedure', exact: true }).inputValue(), article.content);
    }
    await json.fill(JSON.stringify({ title: 'General help', content: 'Contact support.' }));
    await page.getByRole('button', { name: 'Fill fields from JSON' }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Category', exact: true }).inputValue(), 'General');
    assert.equal(await page.getByRole('textbox', { name: 'Port or scope', exact: true }).inputValue(), 'ALL');
    assert.equal(await page.getByRole('textbox', { name: 'Short summary', exact: true }).inputValue(), '');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByText('Draft saved.', { exact: false }).waitFor();
    assert.equal(saves, 1); assert.equal(saved.status, 'DRAFT');
    await page.getByRole('button',{name:'Article options',exact:true}).click();
    await page.getByRole('menuitem', { name: 'Paste JSON', exact: true }).click();
    await paste(JSON.stringify({ ...article, id: 'other-article', version: 99, status: 'APPROVED' }));
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByText('Draft saved.', { exact: false }).waitFor();
    assert.equal(saved.id, 'article-1'); assert.equal(saved.version, 2); assert.equal(saved.status, 'DRAFT');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
    await page.getByRole('button',{name:'Article options',exact:true}).click();
    await page.getByRole('menuitem', { name: 'Copy JSON template' }).click();
    await page.getByText('Clipboard is unavailable.', { exact: false }).waitFor();
    assert.deepEqual(JSON.parse(await json.inputValue()), template, 'Copy failure offers a selectable template');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('KB JSON browser checks passed at 360px and 1440px.');
} finally { await browser.close(); }

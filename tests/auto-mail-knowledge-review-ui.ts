// Offline regression coverage for related knowledge, reload recovery and queue freshness.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AutoMailKnowledge} from './src/components/admin/AutoMailKnowledge';import {AutoMailLearning} from './src/components/admin/AutoMailLearning';createRoot(document.getElementById('root')).render(<><AutoMailKnowledge ready/><AutoMailLearning ready refreshToken={0} onReviewed={()=>{}}/></>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [360, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let article = { id: 'kb-1', title: 'Registration procedure', summary: 'Documents', content: 'Current approved instructions.', category: 'Registration', port: 'ALL', keywords: ['registration'], status: 'APPROVED', version: 2 };
    const suggestion = { id: 'suggestion-1', version: 1, status: 'PENDING', reason: 'MANUAL_REPLY', proposed_title: 'Registration help', proposed_summary: 'Documents', proposed_content: 'Proposed reusable instructions.', proposed_category: 'Registration', proposed_port: 'ALL', proposed_keywords: ['registration'], review_note: '', created_at: '2026-10-23T00:00:00Z' };
    let reviews = 0, writes = 0, matches = 0, detailLoads = 0;
    let failMatch = false, targetConflict = false, failTarget = false;
    let resolveSlow: (() => void) | undefined;
    let finishSlow: (() => void) | undefined;
    const slowFinished = new Promise<void>(resolve => { finishSlow = resolve; });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, 'http://review.test', 'No external traffic');
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      const path = url.pathname.replace('/api/auto-mail/', '');
      if (path === 'knowledge') return route.fulfill({ json: { articles: [article], total: 1 } });
      if (path === 'knowledge-article') {
        detailLoads++;
        return route.fulfill(failTarget ? { status: 503, json: { error: 'Target unavailable.' } } : { json: { article, revisions: [] } });
      }
      if (path === 'knowledge-matches') {
        matches++;
        const query = route.request().postDataJSON().query;
        assert.ok(query.includes('Registration'));
        if (query.includes('Slow')) await new Promise<void>(resolve => { resolveSlow = resolve; });
        await route.fulfill(failMatch ? { status: 503, json: { error: 'Search unavailable.' } } : { json: { articles: [article] } });
        if (query.includes('Slow')) finishSlow?.();
        return;
      }
      if (path === 'learning') return route.fulfill({ json: { suggestions: [suggestion], total: 1 } });
      if (path === 'learning-suggestion') return route.fulfill({ json: { suggestion, events: [] } });
      if (path === 'learning-review') {
        reviews++;
        const data = route.request().postDataJSON();
        assert.equal(data.targetId, article.id); assert.equal(data.targetVersion, article.version);
        assert.equal(data.content, 'Reviewed reusable instructions.');
        if (targetConflict) return route.fulfill({ status: 409, json: { error: 'The target KB article changed. Refresh its version.' } });
        suggestion.status = 'APPROVED'; suggestion.version++;
        writes++;
        return route.fulfill({ json: { suggestion } });
      }
      throw new Error('Unexpected request: ' + url.pathname);
    });
    await page.goto('http://review.test');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const kb = page.getByRole('region', { name: 'Knowledge base management', exact: true });
    const learning = page.getByRole('region', { name: 'Learning review queue', exact: true });
    await kb.getByRole('button', { name: 'Edit Registration procedure' }).click();
    await kb.getByRole('button', { name: 'Find related approved articles' }).click();
    await kb.getByText('No other approved articles matched.', { exact: false }).waitFor();
    assert.equal(matches, 1, 'Related search is explicit and excludes the current article');
    await kb.getByRole('textbox', { name: 'Answer / procedure' }).fill('Unsaved work');
    page.once('dialog', dialog => void dialog.dismiss());
    const beforeCancel = detailLoads;
    await kb.getByRole('button', { name: 'Reload & history' }).click();
    assert.equal(await kb.getByRole('textbox', { name: 'Answer / procedure' }).inputValue(), 'Unsaved work');
    assert.equal(detailLoads, beforeCancel, 'Cancel reload retains edits and makes no request');
    failTarget = true;
    page.once('dialog', dialog => void dialog.accept());
    await kb.getByRole('button', { name: 'Reload & history' }).click();
    await kb.getByRole('alert').filter({ hasText: 'Target unavailable' }).waitFor();
    assert.equal(await kb.getByRole('textbox', { name: 'Answer / procedure' }).inputValue(), 'Unsaved work', 'Failed reload preserves unsaved work');
    failTarget = false;
    article = { ...article, version: 3, content: 'Updated by another administrator.' };
    page.once('dialog', dialog => void dialog.accept());
    await kb.getByRole('button', { name: 'Reload & history' }).click();
    await page.waitForFunction(() => (document.querySelector('textarea[maxlength="30000"]') as HTMLTextAreaElement)?.value === 'Updated by another administrator.');
    assert.equal(writes, 0, 'Reload does not save or approve');

    await learning.getByRole('button', { name: 'Review Registration help' }).click();
    const answer = learning.getByRole('textbox', { name: 'Reusable answer', exact: true });
    await answer.fill('Unsaved review');
    page.once('dialog', dialog => void dialog.dismiss());
    await learning.getByRole('button', { name: 'Reload review history' }).click();
    assert.equal(await answer.inputValue(), 'Unsaved review');
    page.once('dialog', dialog => void dialog.accept());
    await learning.getByRole('button', { name: 'Reload review history' }).click();
    await page.waitForFunction(() => (document.querySelector('textarea[rows="9"]') as HTMLTextAreaElement)?.value === 'Proposed reusable instructions.');

    const related = learning.getByRole('complementary', { name: 'Related approved knowledge' });
    failMatch = true;
    await related.getByRole('button', { name: 'Find related approved articles' }).click();
    await related.getByRole('alert').filter({ hasText: 'Search unavailable' }).waitFor();
    failMatch = false;
    await related.getByRole('button', { name: 'Find related approved articles' }).click();
    await related.locator('summary').click();
    await related.getByText('Updated by another administrator.', { exact: true }).waitFor();
    failTarget = true;
    await related.getByRole('button', { name: 'Compare as update target' }).click();
    await learning.getByRole('alert').filter({ hasText: 'Target unavailable' }).waitFor();
    assert.equal(await learning.getByRole('combobox', { name: 'Publish as' }).inputValue(), 'NEW', 'Failed target lookup does not switch publication mode');
    failTarget = false;
    await related.getByRole('button', { name: 'Compare as update target' }).click();
    await learning.getByRole('region', { name: 'Current KB answer', exact: true }).waitFor();
    assert.equal(await learning.getByRole('combobox', { name: 'Publish as' }).inputValue(), 'UPDATE');
    await answer.fill('Reviewed reusable instructions.');
    await learning.getByRole('region', { name: 'Proposed KB answer', exact: true }).getByText('Reviewed reusable instructions.').waitFor();
    targetConflict = true;
    await learning.getByRole('button', { name: 'Approve and publish KB' }).click();
    await learning.getByRole('alert').filter({ hasText: 'target KB article changed' }).waitFor();
    assert.equal(await answer.inputValue(), 'Reviewed reusable instructions.');
    targetConflict = false; article.version++;
    await learning.getByRole('button', { name: 'Refresh target version' }).click();
    await learning.getByText('Selected target: Registration procedure', { exact: false }).filter({ hasText: 'v4' }).waitFor();
    await learning.getByRole('button', { name: 'Approve and publish KB' }).click();
    await learning.getByText('Learning approved and published', { exact: false }).waitFor();
    await learning.getByRole('button', { name: 'Back to Learning review' }).click();
    await learning.getByRole('cell', { name: 'Approved', exact: true }).waitFor();
    assert.equal(await learning.getByRole('cell', { name: 'Pending review', exact: true }).count(), 0, 'Queue refreshes after review even if the parent does not change refreshToken');
    assert.equal(reviews, 2); assert.equal(writes, 1);

    // Changing the query cancels an older related-article response.
    await kb.getByRole('textbox', { name: 'Article title', exact: true }).fill('Registration Slow');
    const slowStarted = page.waitForRequest(request => request.url().endsWith('/knowledge-matches'));
    await kb.getByRole('button', { name: 'Find related approved articles' }).click();
    await slowStarted;
    await kb.getByRole('textbox', { name: 'Article title', exact: true }).fill('New question');
    resolveSlow?.();
    await slowFinished;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await kb.getByRole('complementary', { name: 'Related approved knowledge' }).locator('details').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Related knowledge, comparison, conflict recovery and review queue freshness passed at mobile and desktop widths.');
} finally { await browser.close(); }

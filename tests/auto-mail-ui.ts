// Offline UI checks. All requests are intercepted; no actual mailbox is used.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {AutoMail} from './src/components/admin/AutoMail';import {AutoEmailConfig} from './src/components/admin/AutoEmailConfig';import {DeveloperSettings} from './src/components/admin/DeveloperSettings';function App(){const [view,setView]=useState('mail');const [tab,setTab]=useState('knowledge');const openConfig=(tab='knowledge')=>{setTab(tab);setView('config');};return <main className="p-4"><nav className="mb-4 flex gap-3"><button onClick={()=>setView('settings')}>Developer settings</button><button onClick={()=>setView('mail')}>Auto Mail workspace</button></nav>{view==='mail'?<AutoMail onOpenConfig={openConfig}/>:view==='config'?<AutoEmailConfig initialTab={tab} onBack={()=>setView('settings')}/>:<DeveloperSettings onOpenAutoEmailConfig={()=>openConfig()} onOpenScheduler={()=>{}} onOpenExcelMapping={()=>{}} onOpenPortDepotConfig={()=>{}}/>}</main>}createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [360, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let sends = 0;
    let inboxLoads = 0;
    let agent = { enabled: true, model: 'gpt-5.4-mini', enabled_models: ['gpt-5.4-mini'], version: 1 };
    let agentConflict = false;
    let uncertain = false;
    let knowledge: any = null;
    let revisions: any[] = [];
    let knowledgeConflict = false;
    let staleSource = false;
    let aiRequests = 0;
    let aiUseStale = false;
    let noAiAnswer = true;
    const learning: any[] = [];
    let learningConflict = false;
    const sentDeliveryId = '10000000-0000-4000-8000-000000000009';
    const makeLearning = (manual = false) => ({ id: manual ? '10000000-0000-4000-8000-000000000011' : '10000000-0000-4000-8000-000000000010', version: 1, status: 'PENDING', reason: manual ? 'MANUAL_REPLY' : 'AI_CORRECTION', proposed_title: manual ? 'Manual support reply' : 'Learning from registration reply', proposed_content: 'Here are the instructions.', proposed_summary: '', proposed_category: 'Registration', proposed_port: 'ALL', proposed_keywords: ['registration'], evidence: { mailbox: 'operator@example.com', question: 'Customer reference REF123 needs help.', sent_reply: 'Here are the instructions.', ai_original: manual ? null : 'Please provide your company certificate.', ai_sources: [] }, created_at: new Date().toISOString(), review_note: '', source_delivery_id: sentDeliveryId });
    const aiId = '10000000-0000-4000-8000-000000000008';
    const aiDraft = () => ({ id: aiId, status: noAiAnswer ? 'NO_ANSWER' : 'NEEDS_REVIEW', body: noAiAnswer ? '' : 'Please provide your company certificate and authorization letter.', reviewNotes: 'Confirm the port requirements before sending.', provider: 'OpenAI', model: 'test-model', sources: [{ id: knowledge.id, title: knowledge.title, port: knowledge.port, version: knowledge.version, content: knowledge.content, cited: !noAiAnswer }] });
    const record = (action: string) => revisions.unshift({ id: 'revision-' + knowledge.version, version: knowledge.version, action, created_at: new Date().toISOString(), snapshot: structuredClone(knowledge) });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, 'http://localhost:3000');
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (/^\/assets\/[\w.-]+\.woff2?$/.test(url.pathname)) return route.fulfill({ path: 'dist' + url.pathname });
      if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
      if (url.pathname === '/api/auto-mail/agent-settings') {
        if (route.request().method() === 'POST') {
          if (agentConflict) return route.fulfill({ status: 409, json: { error: 'Another administrator changed the agent settings. Reload before saving; your changes are preserved.' } });
          const data = route.request().postDataJSON(); assert.equal(data.version, agent.version);
          agent = { enabled: data.enabled, model: data.model, enabled_models: data.enabledModels, version: agent.version + 1 };
          return route.fulfill({ json: { settings: agent } });
        }
        return route.fulfill({ json: { settings: agent, models: ['gpt-5.4-mini', 'gpt-4.1-mini'], storageReady: true, serverEnabled: true, keyConfigured: true } });
      }
      if (url.pathname === '/api/auto-mail/status') return route.fulfill({ json: { state: 'READY', message: 'Gmail connected.', mailboxConnected: true, oauthReady: true, mailbox: 'operator@example.com', knowledgeReady: true, aiEnabled: true, learningReady: true } });
      if (url.pathname === '/api/auto-mail/learning') {
        const status = url.searchParams.get('status'); const filtered = learning.filter(item => !status || item.status === status);
        return route.fulfill({ json: { suggestions: filtered, total: filtered.length } });
      }
      if (url.pathname === '/api/auto-mail/learning-suggestion') {
        const suggestion = learning.find(item => item.id === url.searchParams.get('id'));
        return route.fulfill({ json: { suggestion, events: [{ id: 'created', action: 'CREATED', created_at: suggestion.created_at }, ...(suggestion.status === 'PENDING' ? [] : [{ id: 'reviewed', action: suggestion.status, created_at: suggestion.created_at }])] } });
      }
      if (url.pathname === '/api/auto-mail/learning-propose') {
        assert.equal(sends, 3, 'Manual nomination follows a confirmed manual send');
        const suggestion = makeLearning(true); learning.push(suggestion);
        return route.fulfill({ json: { suggestion } });
      }
      if (url.pathname === '/api/auto-mail/learning-review') {
        const data = route.request().postDataJSON(); const suggestion = learning.find(item => item.id === data.id);
        assert.equal(data.version, suggestion.version);
        if (learningConflict) { knowledge.version++; return route.fulfill({ status: 409, json: { error: 'The target KB article changed. Refresh its version and review it again. Your unsaved text is preserved.' } }); }
        if (data.action === 'APPROVE') {
          assert.equal(data.targetId, knowledge.id); assert.equal(data.targetVersion, knowledge.version);
          knowledge = { ...knowledge, title: data.title, content: data.content, version: knowledge.version + 2, status: 'APPROVED' };
          suggestion.reviewed_article = structuredClone(knowledge);
        }
        suggestion.status = data.action === 'APPROVE' ? 'APPROVED' : 'REJECTED'; suggestion.version++; suggestion.review_note = data.note;
        return route.fulfill({ json: { suggestion } });
      }
      if (url.pathname === '/api/auto-mail/ai-generate') {
        aiRequests++;
        const data = route.request().postDataJSON();
        assert.equal(data.threadId, 'thread1'); assert.equal(data.scope, 'ALL');
        return route.fulfill({ json: { draft: aiDraft() } });
      }
      if (url.pathname === '/api/auto-mail/ai-use') return route.fulfill(aiUseStale ? { status: 409, json: { error: 'A KB source changed or is no longer approved. Generate a new draft.' } } : { json: { draft: aiDraft() } });
      if (url.pathname === '/api/auto-mail/knowledge') {
        if (route.request().method() === 'GET') return route.fulfill({ json: { articles: knowledge ? [knowledge] : [], total: knowledge ? 1 : 0 } });
        if (knowledgeConflict) return route.fulfill({ status: 409, json: { error: 'Another administrator changed this article. Your unsaved text is preserved.' } });
        const data = route.request().postDataJSON();
        knowledge = { ...data, id: '10000000-0000-4000-8000-000000000001', version: (knowledge?.version || 0) + 1, status: 'DRAFT', updated_at: new Date().toISOString() };
        record(knowledge.version === 1 ? 'CREATED' : 'EDITED');
        return route.fulfill({ json: { article: knowledge } });
      }
      if (url.pathname === '/api/auto-mail/knowledge-review') {
        const data = route.request().postDataJSON();
        assert.equal(data.version, knowledge.version);
        knowledge = { ...knowledge, version: knowledge.version + 1, status: data.action === 'APPROVE' ? 'APPROVED' : data.action === 'ARCHIVE' ? 'ARCHIVED' : 'DRAFT' };
        record(data.action === 'APPROVE' ? 'APPROVED' : data.action === 'ARCHIVE' ? 'ARCHIVED' : 'RETURNED_TO_DRAFT');
        return route.fulfill({ json: { article: knowledge } });
      }
      if (url.pathname === '/api/auto-mail/knowledge-article') return route.fulfill({ json: { article: { ...knowledge, ...(staleSource ? { status: 'DRAFT' } : {}) }, revisions } });
      if (url.pathname === '/api/auto-mail/knowledge-matches') return route.fulfill({ json: { articles: knowledge?.status === 'APPROVED' ? [knowledge] : [], aiGenerated: false, retrieval: 'KEYWORD' } });
      if (url.pathname === '/api/auto-mail/threads') { inboxLoads++; return route.fulfill({ json: { threads: [{ id: 'thread1', subject: 'Registration help', from: 'customer@example.com', snippet: 'Please help.', unread: true }], nextPageToken: null } }); }
      if (url.pathname === '/api/auto-mail/thread') return route.fulfill({ json: { id: 'thread1', subject: 'Registration help', mailbox: 'operator@example.com', connectionVersion: 'version1', recipient: 'customer@example.com', replyBlocked: '', messages: [{ id: 'incoming1', from: 'customer@example.com', to: 'operator@example.com', date: '2026-10-22T01:00:00Z', body: '<script>window.mailInjected=true</script> Please help.', outbound: false, attachments: true }] } });
      if (url.pathname === '/api/auto-mail/reply') {
        sends++;
        const data = route.request().postDataJSON();
        assert.equal(data.recipient, 'customer@example.com');
        assert.equal(data.sourceMessageId, 'incoming1');
        assert.equal(data.body, 'Here are the instructions.');
        assert.equal(data.aiDraftId, sends === 1 ? aiId : null, 'AI provenance travels with the manual send and resets on conversation reload');
        if (uncertain) return route.fulfill({ status: 409, json: { error: 'The send outcome is uncertain. Check Sent in Gmail.' } });
        if (sends === 1) learning.push(makeLearning());
        return route.fulfill({ json: { status: 'SENT', deliveryId: sentDeliveryId, learningQueued: sends === 1 } });
      }
      assert.equal(url.pathname, '/');
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://localhost:3000/');
    assert.equal(await page.getByRole('tab', { name: 'Knowledge base', exact: true }).count(), 0, 'KB management is no longer an Auto Mail tab');
    assert.equal(await page.getByRole('tab', { name: 'Learning review', exact: true }).count(), 0, 'Learning review moved out of Auto Mail');
    assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).count(), 0);
    assert.equal(await page.getByText('Gmail connected.', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Developer settings', exact: true }).click();
    await page.getByRole('button', { name: /^Auto Email Config/ }).click();
    await page.getByRole('tab', { name: 'Email agent', exact: true }).click();
    await page.getByRole('combobox', { name: 'Active reply model', exact: true }).selectOption('gpt-4.1-mini');
    await page.getByRole('checkbox', { name: 'Enable AI reply suggestions', exact: true }).uncheck();
    agentConflict = true;
    await page.getByRole('button', { name: 'Save agent settings', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Another administrator' }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Active reply model', exact: true }).inputValue(), 'gpt-4.1-mini');
    agentConflict = false;
    await page.getByRole('button', { name: 'Save agent settings', exact: true }).click();
    await page.getByText('Email agent settings saved. New drafts use these settings.').waitFor();
    assert.equal(agent.enabled, false); assert.equal(agent.model, 'gpt-4.1-mini');
    await page.getByRole('tab', { name: 'Knowledge Base', exact: true }).click();
    await page.getByRole('button', { name: 'New article' }).click();
    await page.getByRole('textbox', { name: 'Article title', exact: true }).fill('Required registration documents');
    await page.getByRole('tab', { name: 'Learning review', exact: true }).click();
    await page.getByRole('tab', { name: 'Knowledge Base', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Article title', exact: true }).inputValue(), 'Required registration documents', 'Switching configuration tabs preserves unsaved KB work');
    await page.getByRole('textbox', { name: 'Short summary' }).fill('A reusable registration procedure.');
    await page.getByRole('textbox', { name: 'Keywords (comma separated)' }).fill('registration, documents');
    await page.getByRole('textbox', { name: 'Answer / procedure' }).fill('Provide the company certificate.');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByText('Draft saved. Review and approve it before using it in email searches.').waitFor();
    assert.equal(knowledge.status, 'DRAFT');
    await page.getByRole('button', { name: 'Approve article', exact: true }).click();
    await page.getByText('Article approved. It is now available in email searches.').waitFor();
    assert.equal(knowledge.status, 'APPROVED');
    await page.getByRole('textbox', { name: 'Answer / procedure' }).fill('Provide the company certificate and authorization letter.');
    knowledgeConflict = true;
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByText(/Another administrator changed/).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Answer / procedure' }).inputValue(), 'Provide the company certificate and authorization letter.');
    knowledgeConflict = false;
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByRole('button', { name: 'Approve article', exact: true }).waitFor();
    assert.equal(knowledge.status, 'DRAFT', 'Editing an approved article removes approval');
    await page.getByRole('button', { name: 'Approve article', exact: true }).click();
    await page.getByText('Article approved. It is now available in email searches.').waitFor();
    await page.getByRole('button', { name: 'Reload & history', exact: true }).click();
    await page.getByText('Revision history (latest 20)').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'KB has no horizontal overflow');
    await page.screenshot({ path: `test-results/auto-mail-kb-${width}.png`, fullPage: true });
    assert.equal(sends, 0, 'KB operations cannot send mail');
    await page.getByRole('button', { name: 'Dev Setting', exact: true }).click();
    await page.getByRole('heading', { name: 'Developer Settings', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Auto Mail workspace', exact: true }).click();
    await page.getByRole('button', { name: /Registration help/ }).click();
    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await editor.waitFor();
    assert.equal(sends, 0, 'Opening inbox and conversation never sends mail');
    assert.equal(await page.evaluate(() => (window as any).mailInjected), undefined, 'Email body is rendered as text');
    assert.equal(await page.getByRole('button', { name: 'Send reply', exact: true }).isDisabled(), true);
    await editor.fill('My existing note.');
    const loadsBeforeRefresh = inboxLoads;
    await page.getByRole('button', { name: 'Google connected as operator@example.com. Click to refresh inbox.', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('button[aria-busy="false"][aria-label*="refresh inbox"]'));
    assert.equal(inboxLoads, loadsBeforeRefresh + 1, 'Google logo refreshes the inbox without OAuth');
    assert.equal(await editor.inputValue(), 'My existing note.', 'Silent refresh preserves unsent reply text');
    await page.getByRole('button', { name: /Click to refresh inbox/ }).hover();
    await page.getByRole('tooltip').getByText('operator@example.com', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Auto Mail options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Email config', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Auto Mail options', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Find an approved answer', exact: true }).click();
    await page.getByRole('button', { name: 'Find KB articles', exact: true }).click();
    await page.getByRole('complementary', { name: 'Approved knowledge search' }).locator('summary').filter({ hasText: 'Required registration documents' }).click();
    staleSource = true;
    await page.getByRole('button', { name: 'Add answer to reply', exact: true }).click();
    await page.getByText(/This article changed or is no longer approved/).waitFor();
    assert.equal(await editor.inputValue(), 'My existing note.', 'Stale sources cannot overwrite or append to reply');
    staleSource = false;
    await page.getByRole('button', { name: 'Add answer to reply', exact: true }).click();
    await page.getByText('Approved KB answer added. Review and edit the reply before sending.').waitFor();
    assert.equal(await editor.inputValue(), 'My existing note.\n\nProvide the company certificate and authorization letter.');
    assert.equal(sends, 0, 'Inserting a KB answer requires a separate explicit send');
    assert.equal(aiRequests, 0, 'Opening an email does not automatically invoke AI');
    const previousBody = await editor.inputValue();
    await page.getByRole('button', { name: 'AI reply suggestion', exact: true }).click();
    await page.getByRole('button', { name: 'Generate AI draft', exact: true }).click();
    await page.getByText('The KB does not support a reliable answer.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Add AI draft to reply', exact: true }).count(), 0, 'Unsupported answers cannot be inserted');
    assert.equal(await editor.inputValue(), previousBody);
    noAiAnswer = false;
    await page.getByRole('button', { name: 'Generate AI draft', exact: true }).click();
    await page.getByText('Additional review or information is needed.', { exact: false }).waitFor();
    aiUseStale = true;
    await page.getByRole('button', { name: 'Add AI draft to reply', exact: true }).click();
    await page.getByText('A KB source changed or is no longer approved. Generate a new draft.').waitFor();
    assert.equal(await editor.inputValue(), previousBody, 'Stale AI sources cannot change the composer');
    aiUseStale = false;
    await page.getByRole('button', { name: 'Add AI draft to reply', exact: true }).click();
    await page.getByText('AI draft added. Review and edit your reply before sending.').waitFor();
    assert.equal(await editor.inputValue(), previousBody + '\n\nPlease provide your company certificate and authorization letter.');
    assert.ok(!(await editor.inputValue()).includes('Confirm the port requirements'), 'Internal review notes are never copied into customer reply');
    assert.equal(sends, 0, 'Generating or using an AI draft does not send email');
    await editor.fill('Here are the instructions.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow');
    await page.screenshot({ path: `test-results/auto-mail-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await page.getByText(/Reply sent through Gmail/).waitFor();
    assert.equal(sends, 1);
    assert.equal(await editor.isDisabled(), true, 'Successful sends block repeat clicks');
    await page.getByRole('button', { name: 'Open Learning review', exact: true }).click();
    const reviewPanel = page.getByRole('tabpanel', { name: 'Learning review', exact: true });
    await reviewPanel.getByRole('button', { name: /Learning from registration reply/ }).click();
    await reviewPanel.locator('summary').filter({ hasText: 'Source evidence' }).click();
    await reviewPanel.getByText('Customer reference REF123 needs help.').waitFor();
    await reviewPanel.getByRole('textbox', { name: 'Article title', exact: true }).fill('Generalized authorization procedure');
    await reviewPanel.getByRole('textbox', { name: 'Reusable answer', exact: true }).fill('A reusable answer without personal references.');
    await reviewPanel.getByRole('combobox', { name: 'Publish as', exact: true }).selectOption('UPDATE');
    await reviewPanel.getByRole('button', { name: 'Search KB targets', exact: true }).click();
    await reviewPanel.getByRole('button', { name: /^Use Required registration documents/ }).click();
    learningConflict = true;
    await reviewPanel.getByRole('button', { name: 'Approve and publish KB', exact: true }).click();
    await reviewPanel.getByText(/The target KB article changed/).waitFor();
    assert.equal(await reviewPanel.getByRole('textbox', { name: 'Reusable answer', exact: true }).inputValue(), 'A reusable answer without personal references.');
    assert.equal(learning[0].status, 'PENDING');
    learningConflict = false;
    await reviewPanel.getByRole('button', { name: 'Refresh target version', exact: true }).click();
    await reviewPanel.getByRole('button', { name: 'Approve and publish KB', exact: true }).click();
    await reviewPanel.getByText('Learning approved and published to the KB. Future drafts can use the reviewed answer.').waitFor();
    assert.equal(knowledge.content, 'A reusable answer without personal references.');
    await reviewPanel.getByRole('button', { name: 'Reload review history', exact: true }).click();
    await reviewPanel.getByText('Review history', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Learning review has no horizontal overflow');
    await page.screenshot({ path: `test-results/auto-mail-learning-${width}.png`, fullPage: true });
    assert.equal(sends, 1, 'Learning approval cannot send email');
    await page.getByRole('button', { name: 'Auto Mail workspace', exact: true }).click();
    await page.getByRole('button', { name: /Registration help/ }).click();
    uncertain = true;
    await editor.fill('Here are the instructions.');
    await page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await editor.isDisabled(), true, 'Uncertain send requires reload and server verification');
    assert.equal(sends, 2);
    assert.equal(learning.length, 1, 'Uncertain sends never create learning evidence');
    assert.equal(await page.getByRole('button', { name: 'Suggest this reply for the KB', exact: true }).count(), 0);
    uncertain = false;
    await page.getByRole('button', { name: 'Back to Inbox', exact: true }).click();
    page.once('dialog', dialog => dialog.accept()); // Discard the uncertain-send draft and verify fresh server state.
    await page.getByRole('button', { name: /Registration help/ }).click();
    await editor.fill('Here are the instructions.');
    await page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await page.getByRole('button', { name: 'Suggest this reply for the KB', exact: true }).click();
    await page.getByText('Reply added to Learning review. It will not affect the KB until approved.').waitFor();
    await page.getByRole('button', { name: 'Open Learning review', exact: true }).click();
    await reviewPanel.getByRole('button', { name: /Manual support reply/ }).click();
    await reviewPanel.getByRole('textbox', { name: 'Review note / rejection reason' }).fill('One-off case; not reusable.');
    const approvedContent = knowledge.content;
    await reviewPanel.getByRole('button', { name: 'Reject suggestion', exact: true }).click();
    await reviewPanel.getByText('Suggestion rejected. The KB was not changed.').waitFor();
    assert.equal(knowledge.content, approvedContent); assert.equal(sends, 3);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Auto Mail KB, AI drafts, reviewed learning, target conflicts, manual nomination, rejection and delivery safeguards passed at mobile and desktop widths.');
} finally { await browser.close(); }

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, MoreVertical, Settings, Send } from 'lucide-react';
import { GoogleConnectionButton } from '../common/GoogleConnectionButton';
import { AutoMailKnowledgeMatches } from './AutoMailKnowledge';
import { AutoMailAiDraft } from './AutoMailAiDraft';
import type { AutoEmailConfigTab } from './AutoEmailConfig';

type Status = { state: string; message: string; oauthReady?: boolean; mailboxConnected: boolean; mailbox?: string; knowledgeReady?: boolean; aiEnabled?: boolean; aiMessage?: string; learningReady?: boolean };
type Summary = { id: string; subject: string; from: string; snippet: string; unread: boolean };
type Message = { id: string; from: string; to: string; date: string; body: string; outbound: boolean; attachments: boolean };
type Thread = { id: string; subject: string; messages: Message[]; recipient: string; replyBlocked: string; mailbox: string; connectionVersion: string };

async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/auto-mail/${path}`, { credentials: 'include', cache: 'no-store', signal,
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Unable to complete the Auto Mail request.');
  return data;
}

export function AutoMail({ onOpenConfig }: { onOpenConfig?: (tab: AutoEmailConfigTab) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const refreshController = useRef<AbortController | null>(null);
  useEffect(() => () => refreshController.current?.abort(), []);
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  const [status, setStatus] = useState<Status | null>(null);
  const [threads, setThreads] = useState<Summary[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState('setup');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [sendBlocked, setSendBlocked] = useState(false);
  const [aiDraftId, setAiDraftId] = useState<string | null>(null);
  const [lastDeliveryId, setLastDeliveryId] = useState<string | null>(null);
  const [learningQueued, setLearningQueued] = useState(false);
  const threadRequest = useRef(0);
  const sending = useRef(false);
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    setBusy('setup'); setError(''); setNotice(''); setThread(null); setBody(''); setThreads([]); setNextPage(null); setAiDraftId(null); setLastDeliveryId(null); setLearningQueued(false);
    void api<Status>('status', undefined, controller.signal).then(async result => {
      if (controller.signal.aborted) return;
      setStatus(result);
      if (result.mailboxConnected && result.oauthReady) {
        const inbox = await api<{ threads: Summary[]; nextPageToken: string | null }>('threads', undefined, controller.signal);
        if (!controller.signal.aborted) { setThreads(inbox.threads); setNextPage(inbox.nextPageToken); }
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(''); });
    return () => { controller.abort(); threadRequest.current++; };
  }, [attempt]);

  const openThread = async (id: string) => {
    const serial = ++threadRequest.current;
    setBusy('thread'); setError(''); setNotice(''); setThread(null); setBody(''); setSendBlocked(false); setAiDraftId(null); setLastDeliveryId(null); setLearningQueued(false);
    try {
      const result = await api<Thread>(`thread?id=${encodeURIComponent(id)}`);
      if (serial === threadRequest.current) { setThread(result); requestId.current = crypto.randomUUID(); }
    } catch (reason) { if (serial === threadRequest.current) setError(reason instanceof Error ? reason.message : 'Unable to open conversation.'); }
    finally { if (serial === threadRequest.current) setBusy(''); }
  };
  const connect = async () => {
    setBusy('connect'); setError('');
    try { const result = await api<{ authorizationUrl: string }>('connect', {}); window.location.assign(result.authorizationUrl); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to connect Gmail.'); setBusy(''); }
  };
  const refreshMailbox = async () => {
    if (refreshController.current || busy) return;
    const controller = new AbortController(); refreshController.current = controller; setRefreshing(true); setError('');
    try {
      const latest = await api<Status>('status', undefined, controller.signal);
      if (!controller.signal.aborted) setStatus(latest);
      if (latest.mailboxConnected && latest.oauthReady) {
        const inbox = await api<{ threads: Summary[]; nextPageToken: string | null }>('threads', undefined, controller.signal);
        if (!controller.signal.aborted) { setThreads(inbox.threads); setNextPage(inbox.nextPageToken); }
      }
      if (thread && (!latest.mailboxConnected || latest.mailbox !== thread.mailbox)) { setSendBlocked(true); setError('The connected mailbox changed. Reload the conversation before sending.'); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to refresh inbox.'); }
    finally { if (!controller.signal.aborted) setRefreshing(false); refreshController.current = null; }
  };
  const loadMore = async () => {
    if (!nextPage) return;
    setBusy('more'); setError('');
    try {
      const result = await api<{ threads: Summary[]; nextPageToken: string | null }>(`threads?pageToken=${encodeURIComponent(nextPage)}`);
      setThreads(current => [...current, ...result.threads.filter(item => !current.some(existing => existing.id === item.id))]); setNextPage(result.nextPageToken);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load inbox.'); }
    finally { setBusy(''); }
  };
  const send = async () => {
    if (!thread || sending.current || sendBlocked || !body.trim()) return;
    sending.current = true; setBusy('send'); setError(''); setNotice('');
    try {
      const result = await api<{ status: string; warning?: string; deliveryId?: string; learningQueued?: boolean }>('reply', { threadId: thread.id, body, recipient: thread.recipient,
        sourceMessageId: thread.messages.at(-1)?.id, connectionVersion: thread.connectionVersion, requestId: requestId.current, aiDraftId });
      setSendBlocked(true); setBody(''); setLastDeliveryId(result.deliveryId || null); setLearningQueued(!!result.learningQueued);
      setNotice(result.warning || (result.learningQueued ? 'Reply sent through Gmail. Your edits were queued for KB review.' : 'Reply sent through Gmail. Reload the conversation to see the latest messages.'));
    } catch (reason) {
      // A browser/network error can hide a successful send. Require a fresh server check.
      setSendBlocked(true); setError(reason instanceof Error ? reason.message : 'Check Sent in Gmail before retrying.');
    } finally { sending.current = false; setBusy(''); }
  };
  const proposeLearning = async () => {
    if (!lastDeliveryId) return;
    setBusy('learning'); setError('');
    try {
      const result = await api<{ suggestion: { status: string } }>('learning-propose', { deliveryId: lastDeliveryId });
      setLearningQueued(true);
      setNotice(result.suggestion.status === 'PENDING' ? 'Reply added to Learning review. It will not affect the KB until approved.' : `This reply already has a ${result.suggestion.status.toLowerCase()} learning suggestion.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to propose learning.'); }
    finally { setBusy(''); }
  };
  const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50';
  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Auto Mail</h2><p className="mt-1 text-sm text-slate-500">{status?.mailbox || 'Connect Gmail to read conversations and reply.'}</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800">Manual replies only</span><GoogleConnectionButton email={status?.mailboxConnected ? status.mailbox || '' : ''} connecting={busy === 'connect' || refreshing} connectedAction="refresh" disabled={!!busy || status?.state !== 'READY' || !status.oauthReady} onConnect={() => void (status?.mailboxConnected ? refreshMailbox() : connect())} />
      <div ref={menuRef} className="relative"><button ref={menuButton} type="button" aria-label="Auto Mail options" aria-haspopup="menu" aria-expanded={menuOpen} disabled={!!busy} onClick={() => setMenuOpen(value => !value)} className="inline-flex h-10 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"><MoreVertical className="h-5 w-5" /></button>
      {menuOpen && <div role="menu" aria-label="Auto Mail options" onKeyDown={event => { const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')); const index = items.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null; if (next !== null) { event.preventDefault(); items[next]?.focus(); } if (event.key === 'Tab') setMenuOpen(false); }} className="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
      {onOpenConfig && <><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenConfig('knowledge'); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"><BookOpen className="h-4 w-4" />Manage knowledge</button><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenConfig('agent'); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"><Settings className="h-4 w-4" />Email config</button></>}
      {status?.mailboxConnected && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void connect(); }} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50">Reconnect Gmail</button>}
      </div>}</div></div></div>
    {busy === 'setup' && <p role="status" className="text-sm text-slate-500">Loading inbox...</p>}
    {status && status.state !== 'READY' && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{status.message}</p>}
    {status?.state === 'READY' && !status.oauthReady && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Configure AUTO_MAIL_APP_URL, Google OAuth credentials, and GOOGLE_TOKEN_ENCRYPTION_KEY on the server, then refresh. See the Auto Mail development guide.</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div>
    {status?.mailboxConnected && <div className="grid min-h-[480px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside aria-label="Inbox conversations" className="overflow-hidden rounded-xl border border-slate-200 bg-white"><h3 className="border-b border-slate-100 p-4 text-sm font-semibold">Inbox</h3>
        {!threads.length && !busy && <p className="p-4 text-sm text-slate-500">No inbox conversations loaded. Refresh to check Gmail.</p>}
        <div className="max-h-[650px] overflow-y-auto">{threads.map(item => <button key={item.id} type="button" disabled={!!busy} onClick={() => void openThread(item.id)} aria-pressed={thread?.id === item.id} className={`w-full border-b border-slate-100 p-4 text-left hover:bg-sky-50 disabled:opacity-60 ${thread?.id === item.id ? 'bg-sky-50' : ''}`}><p className={`truncate text-sm ${item.unread ? 'font-bold' : 'font-medium'}`}>{item.subject}</p><p className="mt-1 truncate text-xs text-slate-500">{item.from}</p><p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.snippet}</p></button>)}</div>
        {nextPage && <div className="p-3"><button className={`${button} w-full`} disabled={!!busy} onClick={() => void loadMore()}>Load more</button></div>}
      </aside>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        {busy === 'thread' ? <p role="status" className="text-sm text-slate-500">Loading conversation...</p> : !thread ? <p className="text-sm text-slate-500">Select a conversation to read and reply.</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="break-words font-semibold text-slate-900">{thread.subject}</h3><div className="flex items-center gap-3"><button className={button} disabled={!!busy} onClick={() => void openThread(thread.id)}>Reload conversation</button><a href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(thread.mailbox)}#all/${encodeURIComponent(thread.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700">Gmail <ExternalLink className="h-3 w-3" /></a></div></div>
          <div className="my-4 max-h-[500px] space-y-3 overflow-y-auto">{thread.messages.map(message => <article key={message.id} className={`rounded-lg border p-3 ${message.outbound ? 'border-sky-100 bg-sky-50/50' : 'border-slate-200'}`}><div className="flex flex-wrap justify-between gap-2 text-xs"><p className="min-w-0 break-words font-medium text-slate-700">{message.from}</p><time className="text-slate-400" dateTime={message.date}>{new Date(message.date).toLocaleString()}</time></div><p className="mt-1 break-words text-xs text-slate-400">To: {message.to}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">{message.body}</p>{message.attachments && <p className="mt-3 text-xs text-amber-700">Attachments available in Gmail.</p>}</article>)}</div>
          {status?.knowledgeReady && !thread.replyBlocked && <AutoMailKnowledgeMatches key={thread.id + ':' + thread.messages.at(-1)?.id} subject={thread.subject} message={thread.messages.at(-1)?.body || ''} disabled={!!busy || sendBlocked} onInsert={answer => { setBody(current => current.trim() ? current + '\n\n' + answer : answer); setNotice('Approved KB answer added. Review and edit the reply before sending.'); }} />}
          {status?.knowledgeReady && !thread.replyBlocked && <AutoMailAiDraft key={'ai:' + thread.id + ':' + thread.messages.at(-1)?.id} threadId={thread.id} sourceMessageId={thread.messages.at(-1)?.id || ''} connectionVersion={thread.connectionVersion} enabled={!!status.aiEnabled} setupMessage={status.aiMessage || 'AI suggestions are not enabled yet.'} disabled={!!busy || sendBlocked} onBusyChange={value => setBusy(current => value ? 'ai' : current === 'ai' ? '' : current)} onUse={(answer, id) => { setBody(current => current.trim() ? current + '\n\n' + answer : answer); setAiDraftId(id); setNotice('AI draft added. Review and edit your reply before sending.'); }} />}
          {thread.replyBlocked ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{thread.replyBlocked}</p> : <form onSubmit={event => { event.preventDefault(); void send(); }} className="space-y-3 border-t border-slate-100 pt-4"><p className="break-words text-sm text-slate-600">From: {thread.mailbox}<br />Reply to: <strong>{thread.recipient}</strong></p><label className="block text-sm font-medium text-slate-700">Your reply<textarea value={body} onChange={event => setBody(event.target.value)} disabled={!!busy || sendBlocked} maxLength={50000} rows={6} className="mt-2 block w-full rounded-lg border border-slate-300 p-3 text-sm disabled:bg-slate-50" placeholder="Write your reply..." /></label><button type="submit" disabled={!!busy || sendBlocked || !body.trim()} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"><Send className="h-4 w-4" />{busy === 'send' ? 'Sending...' : 'Send reply'}</button></form>}
          {status?.learningReady && lastDeliveryId && <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">{learningQueued ? <p className="text-xs text-emerald-800">This reply has a learning suggestion. Review it in Auto Email Config before publishing to the KB.</p> : <button type="button" className={button} disabled={!!busy} onClick={() => void proposeLearning()}>Suggest this reply for the KB</button>}{onOpenConfig && <button type="button" className={`${button} mt-2`} disabled={!!busy} onClick={() => onOpenConfig('learning')}>Open Learning review</button>}</div>}
        </>}
      </div>
    </div>}
    </div>
    <p className="text-xs text-slate-500">Automatic replies are disabled. {status?.aiEnabled ? 'AI drafts require staff review and a separate click to send.' : 'AI suggestions are not enabled.'} Reading a conversation here does not mark it read in Gmail.</p>
  </section>;
}

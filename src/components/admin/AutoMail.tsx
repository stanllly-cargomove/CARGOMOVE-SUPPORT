import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cachedMail, peekMail, writeMail, expireMail, mailIsFresh, MAIL_REFRESH_MS } from '../../services/autoMailCache';
import { startMailSend, subscribeMailSends, mailSendSnapshot, dismissMailSend, type ComposeDraft } from '../../services/autoMailSending';
import { BookOpen, ExternalLink, MoreVertical, Settings } from 'lucide-react';
import { AutoMailMailbox, type MailFolder, type MailSummary } from './AutoMailMailbox';
import { AutoMailNewMessage } from './AutoMailNewMessage';
import { AutoMailScheduled } from './AutoMailScheduled';
import { GoogleConnectionButton } from '../common/GoogleConnectionButton';
import { AutoMailKnowledgeMatches } from './AutoMailKnowledge';
import { AutoMailAiDraft } from './AutoMailAiDraft';
import { AutoMailReader, type MailMessage } from './AutoMailReader';
import { AutoMailComposer, type ReplyUpload } from './AutoMailComposer';
import { plainMailHtml } from '../../services/autoMailFormatting';
import type { AutoEmailConfigTab } from './AutoEmailConfig';

type Status = { state: string; message: string; oauthReady?: boolean; mailboxConnected: boolean; mailbox?: string; knowledgeReady?: boolean; aiEnabled?: boolean; aiMessage?: string; learningReady?: boolean; richRepliesReady?: boolean; composeReady?:boolean; schedulerReady?:boolean; canManageMail?:boolean; connectionVersion?:string };
type Summary = MailSummary;
type Thread = { id: string; subject: string; messages: MailMessage[]; recipient: string; replyBlocked: string; mailbox: string; connectionVersion: string; replyAll?: {to:string[];cc:string[]} };

async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/auto-mail/${path}`, { credentials: 'include', cache: 'no-store', signal,
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to complete the Auto Mail request.'), { canEditReply: data.canEditReply === true });
  return data;
}

export function AutoMail({ onOpenConfig, cacheScope = 'session', pollEnabled = true }: { onOpenConfig?: (tab: AutoEmailConfigTab) => void; cacheScope?:string; pollEnabled?:boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const refreshController = useRef<AbortController | null>(null);
  const listView=useRef(0);
  useEffect(() => () => refreshController.current?.abort(), []);
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  const [status, setStatus] = useState<Status | null>(()=>peekMail<Status>(cacheScope,'status')||null);
  const [permissionNeeded,setPermissionNeeded]=useState(false);
  const [recoveredDraft,setRecoveredDraft]=useState<ComposeDraft|undefined>();
  const sendTasks=useSyncExternalStore(subscribeMailSends,mailSendSnapshot).filter(task=>task.scope===cacheScope);
  const connectionKey=status?.connectionVersion||status?.mailbox||'';
  const [folder, setFolder] = useState<MailFolder>('inbox');
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState(false);
  const [composing,setComposing]=useState(false);
  const [composeDirty,setComposeDirty]=useState(false);
  const [scheduledRefresh,setScheduledRefresh]=useState(0);
  const listPath = (page?: string) => `threads?${new URLSearchParams({folder, ...(query ? {q:query} : {}), ...(page ? {pageToken:page} : {})})}`;
  const [threads, setThreads] = useState<Summary[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [bodyHtml,setBodyHtml]=useState('');
  const [recipients,setRecipients]=useState({to:'',cc:'',bcc:''});
  const [files,setFiles]=useState<ReplyUpload[]>([]);
  const appendAnswer=(answer:string)=>{setBody(current=>current.trim()?current+'\n\n'+answer:answer);setBodyHtml(current=>(current||(body.trim()?plainMailHtml(body):''))+plainMailHtml(answer));};
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
    listView.current++;
    let cancelled=false;
    const known=peekMail<Status>(cacheScope,'status');
    const saved=peekMail<{threads:Summary[];nextPageToken:string|null}>(cacheScope,listPath(),known?.connectionVersion||known?.mailbox||'');
    setBusy(saved||folder==='scheduled'&&known?'':'setup'); setError(''); setNotice(''); setThread(null); setBody(''); setBodyHtml(''); setFiles([]); setThreads(saved?.threads||[]); setNextPage(saved?.nextPageToken||null); setAiDraftId(null); setLastDeliveryId(null); setLearningQueued(false);
    void cachedMail<Status>(cacheScope,'status').then(async result => {
      if (cancelled) return;
      setStatus(result);
      if (result.mailboxConnected && result.oauthReady && folder!=='scheduled') {
        const inbox = await cachedMail<{ threads: Summary[]; nextPageToken: string | null }>(cacheScope,listPath(),{context:result.connectionVersion||result.mailbox||''});
        if (!cancelled) { setThreads(inbox.threads); setNextPage(inbox.nextPageToken); }
      }
    }).catch(reason => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setBusy(''); });
    return () => { cancelled=true; threadRequest.current++; };
  }, [attempt, folder, query, cacheScope]);

  const openThread = async (id: string, reload = false) => {
    if (thread?.id === id && !reload && (body.trim()||files.length||mailIsFresh(cacheScope,`thread?id=${encodeURIComponent(id)}`,connectionKey))) { setReading(true); return; }
    if ((body.trim() || files.length) && !window.confirm('Discard your unsent reply and load this conversation?')) return;
    setReading(true);
    const serial = ++threadRequest.current;
    setBusy('thread'); setError(''); setNotice(''); setThread(null); setBody(''); setBodyHtml(''); setFiles([]); setSendBlocked(false); setAiDraftId(null); setLastDeliveryId(null); setLearningQueued(false);
    try {
      const result = await cachedMail<Thread>(cacheScope,`thread?id=${encodeURIComponent(id)}`,{context:connectionKey,force:reload});
      if (serial === threadRequest.current) { setThread(result); setRecipients({to:result.recipient,cc:'',bcc:''}); requestId.current = crypto.randomUUID(); }
    } catch (reason) { if (serial === threadRequest.current) setError(reason instanceof Error ? reason.message : 'Unable to open conversation.'); }
    finally { if (serial === threadRequest.current) setBusy(''); }
  };
  const connect = async () => {
    setBusy('connect'); setError('');
    try { const result = await api<{ authorizationUrl: string }>('connect', {}); window.location.assign(result.authorizationUrl); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to connect Gmail.'); setBusy(''); }
  };
  const refreshMailbox = async (automatic = false) => {
    if(automatic&&!pollEnabled)return;
    if (refreshController.current || busy) return;
    const view=listView.current;
    const controller = new AbortController(); refreshController.current = controller; if(!automatic)setRefreshing(true); setError('');
    try {
      const latest = await cachedMail<Status>(cacheScope,'status',{force:true});
      if (!controller.signal.aborted) setStatus(latest);
      if (latest.mailboxConnected && latest.oauthReady && folder!=='scheduled') {
        const inbox = await cachedMail<{ threads: Summary[]; nextPageToken: string | null }>(cacheScope,listPath(),{context:latest.connectionVersion||latest.mailbox||'',force:true,conditional:automatic});
        if (!controller.signal.aborted&&view===listView.current) {
          for(const item of inbox.threads){const old=threads.find(row=>row.id===item.id);if(old&&JSON.stringify(old)!==JSON.stringify(item))expireMail(cacheScope,`thread?id=${encodeURIComponent(item.id)}`);}
          setThreads(inbox.threads); setNextPage(inbox.nextPageToken);
        }
      }
      if(folder==='scheduled'){expireMail(cacheScope,'outbox');setScheduledRefresh(value=>value+1);}
      if (thread && (!latest.mailboxConnected || latest.mailbox !== thread.mailbox)) { setSendBlocked(true); setError('The connected mailbox changed. Reload the conversation before sending.'); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to refresh mailbox.'); }
    finally { if (!controller.signal.aborted) setRefreshing(false); refreshController.current = null; }
  };
  const refreshTick=useRef(refreshMailbox);refreshTick.current=refreshMailbox;
  useEffect(()=>{const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refreshTick.current(true);},MAIL_REFRESH_MS);return()=>window.clearInterval(timer);},[]);
  const loadMore = async () => {
    if (!nextPage) return;
    setBusy('more'); setError('');
    try {
      const result = await cachedMail<{ threads: Summary[]; nextPageToken: string | null }>(cacheScope,listPath(nextPage),{context:connectionKey});
      setThreads(current => {const all=[...current,...result.threads.filter(item=>!current.some(existing=>existing.id===item.id))];writeMail(cacheScope,listPath(),{...peekMail<object>(cacheScope,listPath(),connectionKey),threads:all,nextPageToken:result.nextPageToken},connectionKey);return all;}); setNextPage(result.nextPageToken);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load mail.'); }
    finally { setBusy(''); }
  };
  const send = async () => {
    if (!thread || sending.current || sendBlocked || (!body.trim()&&!files.length)) return;
    sending.current = true; setBusy('send'); setError(''); setNotice('');
    try {
      const result = await api<{ status: string; warning?: string; deliveryId?: string; learningQueued?: boolean }>('reply', { threadId: thread.id, body, recipient: thread.recipient,
        sourceMessageId: thread.messages.at(-1)?.id, connectionVersion: thread.connectionVersion, requestId: requestId.current, aiDraftId, ...(status?.richRepliesReady?{bodyHtml,to:recipients.to,cc:recipients.cc,bcc:recipients.bcc,attachmentIds:files.map(file=>file.id)}:{}) });
      expireMail(cacheScope,'threads');expireMail(cacheScope,'thread?');
      setSendBlocked(true); setBody(''); setBodyHtml(''); setFiles([]); setLastDeliveryId(result.deliveryId || null); setLearningQueued(!!result.learningQueued);
      setNotice(result.warning || (result.learningQueued ? 'Reply sent through Gmail. Your edits were queued for KB review.' : 'Reply sent through Gmail. Reload the conversation to see the latest messages.'));
    } catch (reason) {
      // A browser/network error can hide a successful send. Require a fresh server check.
      const canEdit=!!reason && typeof reason==='object' && 'canEditReply' in reason && reason.canEditReply===true;
      setSendBlocked(!canEdit); setError(reason instanceof Error ? reason.message : 'Check Sent in Gmail before retrying.');
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
  const mayLeave=()=>!(body.trim()||files.length||composeDirty)||window.confirm('Discard your unsent message?');
  const closeCompose=()=>{if(!mayLeave())return;setComposing(false);setComposeDirty(false);setReading(false);};
  const changeFolder=(value:MailFolder)=>{if(value!==folder||composing){if(!mayLeave())return;setComposing(false);setComposeDirty(false);}setReading(false);setFolder(value);if(value!==folder)setQuery('');};
  const startCompose=()=>{
    if(composing)return;
    setRecoveredDraft(undefined);
    if(!status?.composeReady||!status.richRepliesReady||!status.connectionVersion){setError('Apply the compose/outbox migration in the separate Auto Mail database, then click the Google logo to refresh.');return;}
    if(!mayLeave())return;setBody('');setBodyHtml('');setFiles([]);setThread(null);setReading(false);setComposeDirty(false);setComposing(true);setError('');setNotice('');
  };
  const manageMail=async(ids:string[],action:'trash'|'restore')=>{
    if(busy)return;
    if(!status?.canManageMail){setPermissionNeeded(true);return;}
    if(!status.connectionVersion)return;
    if(!window.confirm(action==='trash'?`Move ${ids.length} conversation(s), including all their messages, to Gmail Trash?`:`Restore ${ids.length} conversation(s) from Gmail Trash?`))return;
    if(!mayLeave())return;setBusy('manage');setError('');setNotice('');
    try{const result=await api<{completed:string[];failed:string[]}>('mailbox-action',{ids,action,connectionVersion:status.connectionVersion});expireMail(cacheScope,'threads');expireMail(cacheScope,'thread?');setThreads(current=>current.filter(item=>!result.completed.includes(item.id)));if(thread&&result.completed.includes(thread.id)){setThread(null);setReading(false);setBody('');setBodyHtml('');setFiles([]);}setNotice(`${result.completed.length} conversation(s) ${action==='trash'?'moved to Trash':'restored'}.${result.failed.length?' Some requests could not be confirmed. Refresh Gmail before retrying.':''}`);}catch(reason){setError(reason instanceof Error?reason.message:'Unable to manage conversations.');}finally{setBusy('');}
  };
  const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50';
  return <section className="w-full min-w-0 space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Auto Mail</h2><p className="mt-1 text-sm text-slate-500">{status?.mailbox || 'Connect Gmail to read conversations and reply.'}</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800">Staff-controlled sending</span><GoogleConnectionButton email={status?.mailboxConnected ? status.mailbox || '' : ''} connecting={busy === 'connect' || refreshing} connectedAction="refresh" disabled={!!busy || status?.state !== 'READY' || !status.oauthReady} onConnect={() => void (status?.mailboxConnected ? refreshMailbox() : connect())} />
      <div ref={menuRef} className="relative"><button ref={menuButton} type="button" aria-label="Auto Mail options" aria-haspopup="menu" aria-expanded={menuOpen} disabled={!!busy} onClick={() => setMenuOpen(value => !value)} className="inline-flex h-10 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"><MoreVertical className="h-5 w-5" /></button>
      {menuOpen && <div role="menu" aria-label="Auto Mail options" onKeyDown={event => { const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')); const index = items.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null; if (next !== null) { event.preventDefault(); items[next]?.focus(); } if (event.key === 'Tab') setMenuOpen(false); }} className="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
      {onOpenConfig && <><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenConfig('knowledge'); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"><BookOpen className="h-4 w-4" />Manage knowledge</button><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenConfig('agent'); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"><Settings className="h-4 w-4" />Email config</button></>}
      {status?.mailboxConnected && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void connect(); }} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50">Reconnect Gmail</button>}
      </div>}</div></div></div>
    {busy === 'setup' && <p role="status" className="text-sm text-slate-500">Loading mailbox...</p>}
    {status && status.state !== 'READY' && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{status.message}</p>}
    {status?.state === 'READY' && !status.oauthReady && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Configure AUTO_MAIL_APP_URL, Google OAuth credentials, and GOOGLE_TOKEN_ENCRYPTION_KEY on the server, then refresh. See the Auto Mail development guide.</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {permissionNeeded&&!status?.canManageMail&&<div role="status" className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>Gmail can read Trash, but moving or restoring messages needs mailbox-management permission. Add gmail.modify in Google Console and reconnect Gmail.</p><button type="button" className={button} disabled={!!busy} onClick={()=>void connect()}>Reconnect Gmail for Trash</button></div>}
    {sendTasks.map(task=><div key={task.id} role={task.state==='ERROR'?'alert':'status'} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-100 p-3 text-sm"><span>{task.state==='SENDING'?'Sending...':task.state==='SENT'?(task.error||'Message sent through Gmail.'):task.state==='QUEUED'?(task.draft.sendAt?'Message scheduled. View or cancel it in Scheduled.':'Message queued for sending.'):task.error}</span><span>{task.draft.subject}</span>{task.state==='ERROR'&&<><button type="button" className={button} disabled={!!busy} onClick={()=>{if(!mayLeave())return;setRecoveredDraft(task.draft);setComposing(true);setComposeDirty(false);setBody('');setFiles([]);}}>{task.canEdit?'Restore draft':'View message'}</button><button type="button" className={button} onClick={()=>dismissMailSend(task.id)}>Dismiss</button></>}{(task.state==='SENT'||task.state==='QUEUED')&&<button type="button" className={button} onClick={()=>dismissMailSend(task.id)}>Dismiss</button>}</div>)}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div>
    {status?.mailboxConnected && <AutoMailMailbox folder={folder} query={query} threads={threads} nextPage={nextPage} loading={!!busy || refreshing} disabled={!!busy || refreshing} onCompose={startCompose} composeReady={!!status.composeReady} onAction={(ids,action)=>void manageMail(ids,action)} canManage={!!status.canManageMail} activeThreadId={!composing&&reading?thread?.id:undefined}
      onFolder={changeFolder}
      onSearch={value => { if (value === query) { setReading(false); return; } if ((body.trim() || files.length) && !window.confirm('Discard your unsent reply and search mail?')) return; setReading(false); setQuery(value); }}
      onMore={() => void loadMore()} reading={reading||composing||folder==='scheduled'} onBack={() => composing?closeCompose():setReading(false)} onOpen={id => void openThread(id)}>
      {composing?<AutoMailNewMessage key={recoveredDraft?.requestId||'new'} initialDraft={recoveredDraft} initialBlocked={recoveredDraft?sendTasks.some(task=>task.id===recoveredDraft.requestId&&!task.canEdit):false} onSubmit={draft=>{startMailSend(cacheScope,draft);setComposing(false);setComposeDirty(false);setRecoveredDraft(undefined);setReading(false);setNotice('');}} mailbox={status.mailbox||''} connectionVersion={status.connectionVersion||''} schedulerReady={!!status.schedulerReady} onClose={closeCompose} onDirty={setComposeDirty} onBusy={value=>setBusy(value?'compose':'')} onDone={message=>{setComposing(false);setComposeDirty(false);setReading(false);setNotice(message);setScheduledRefresh(value=>value+1);}}/>:folder==='scheduled'?<AutoMailScheduled key={scheduledRefresh} cacheScope={cacheScope} connectionVersion={status.connectionVersion||''} onBusy={value=>setBusy(value?'schedule':'')}/>:<div className="min-w-0 bg-white p-4 sm:p-5">
        {busy === 'thread' ? <p role="status" className="text-sm text-slate-500">Loading conversation...</p> : !thread ? <p className="text-sm text-slate-500">Select a conversation to read and reply.</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="break-words font-semibold text-slate-900">{thread.subject}</h3><div className="flex items-center gap-3"><button className={button} disabled={!!busy} onClick={() => void openThread(thread.id, true)}>Reload conversation</button><a href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(thread.mailbox)}#all/${encodeURIComponent(thread.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700">Gmail <ExternalLink className="h-3 w-3" /></a></div></div>
          <AutoMailReader key={thread.id} threadId={thread.id} messages={thread.messages} />
          {status?.knowledgeReady && !thread.replyBlocked && <AutoMailKnowledgeMatches key={thread.id + ':' + thread.messages.at(-1)?.id} subject={thread.subject} message={thread.messages.at(-1)?.body || ''} disabled={!!busy || sendBlocked} onInsert={answer => { appendAnswer(answer); setNotice('Approved KB answer added. Review and edit the reply before sending.'); }} />}
          {status?.knowledgeReady && !thread.replyBlocked && <AutoMailAiDraft key={'ai:' + thread.id + ':' + thread.messages.at(-1)?.id} threadId={thread.id} sourceMessageId={thread.messages.at(-1)?.id || ''} connectionVersion={thread.connectionVersion} enabled={!!status.aiEnabled} setupMessage={status.aiMessage || 'AI suggestions are not enabled yet.'} disabled={!!busy || sendBlocked} onBusyChange={value => setBusy(current => value ? 'ai' : current === 'ai' ? '' : current)} onUse={(answer, id) => { appendAnswer(answer); setAiDraftId(id); setNotice('AI draft added. Review and edit your reply before sending.'); }} />}
          {thread.replyBlocked ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{thread.replyBlocked}</p> : <AutoMailComposer body={body} html={bodyHtml} onChange={(text,html)=>{setBody(text);setBodyHtml(html);}} to={recipients.to} cc={recipients.cc} bcc={recipients.bcc} onRecipients={(field,value)=>setRecipients(current=>({...current,[field]:value}))} replyAll={thread.replyAll||{to:[thread.recipient],cc:[]}} onReplyAll={()=>setRecipients(current=>({...current,to:(thread.replyAll?.to||[thread.recipient]).join(', '),cc:(thread.replyAll?.cc||[]).join(', ')}))} mailbox={thread.mailbox} files={files} onFiles={setFiles} requestId={requestId.current} threadId={thread.id} sourceMessageId={thread.messages.at(-1)?.id||''} connectionVersion={thread.connectionVersion} richReady={!!status?.richRepliesReady} disabled={!!busy||sendBlocked} sending={busy==='send'} onSend={()=>void send()} onBusyChange={value=>setBusy(current=>value?'upload':current==='upload'?'':current)} />}
          {status?.learningReady && lastDeliveryId && <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">{learningQueued ? <p className="text-xs text-emerald-800">This reply has a learning suggestion. Review it in Auto Email Config before publishing to the KB.</p> : <button type="button" className={button} disabled={!!busy} onClick={() => void proposeLearning()}>Suggest this reply for the KB</button>}{onOpenConfig && <button type="button" className={`${button} mt-2`} disabled={!!busy} onClick={() => onOpenConfig('learning')}>Open Learning review</button>}</div>}
        </>}
      </div>}
    </AutoMailMailbox>}
    </div>
    <p className="text-xs text-slate-500">Automatic replies are disabled. {status?.aiEnabled ? 'AI drafts require staff review and a separate click to send.' : 'AI suggestions are not enabled.'} Reading a conversation here does not mark it read in Gmail.</p>
  </section>;
}

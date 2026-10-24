import { AutoMailDrafts,type SavedAiDraft } from './AutoMailDrafts';
import { saveMailDraft,removeMailDraft,blockMailDraft,type SavedMailDraft } from '../../services/autoMailDrafts';
import { AutoMailKnowledge } from './AutoMailKnowledge';
import { AutoMailLearning } from './AutoMailLearning';
import toast from 'react-hot-toast';
import { AutoMailSnackbar, AutoMailSnackbarArea } from './AutoMailSnackbar';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cachedMail, peekMail, writeMail, expireMail, mailIsFresh, mailContacts, refreshMailThreads, MAIL_REFRESH_MS } from '../../services/autoMailCache';
import { prepareMailForward } from '../../services/autoMailForward';
import { startMailSend, subscribeMailSends, mailSendSnapshot, dismissMailSend, type ComposeDraft } from '../../services/autoMailSending';
import { BookOpen, ExternalLink, MoreVertical, Settings, Reply, ReplyAll, Forward } from 'lucide-react';
import { AutoMailMailbox, type MailAction, type MailFolder, type MailSummary } from './AutoMailMailbox';
import { initializeMail, mailInitialized, initialMailProgress } from '../../services/autoMailInitialization';
import { AutoMailSignatures } from './AutoMailSignatures';
import { AutoMailInitialization } from './AutoMailInitialization';
import { AutoMailSkeleton } from './AutoMailSkeleton';
import { AutoMailNewMessage } from './AutoMailNewMessage';
import { AutoMailScheduled } from './AutoMailScheduled';
import { GoogleConnectionButton } from '../common/GoogleConnectionButton';
import { AutoMailKnowledgeMatches } from './AutoMailKnowledge';
import { AutoMailAiDraft } from './AutoMailAiDraft';
import { AutoMailReader, type MailMessage } from './AutoMailReader';
import { AutoMailComposer, type ReplyUpload } from './AutoMailComposer';
import { plainMailHtml } from '../../services/autoMailFormatting';

type Status = { state: string; message: string; oauthReady?: boolean; mailboxConnected: boolean; mailbox?: string; knowledgeReady?: boolean; aiEnabled?: boolean; aiMessage?: string; learningReady?: boolean; richRepliesReady?: boolean; composeReady?:boolean; schedulerReady?:boolean; replySchedulerReady?:boolean; canManageMail?:boolean; connectionVersion?:string };
type Summary = MailSummary;
type Thread = { id: string; subject: string; messages: MailMessage[]; recipient: string; replyBlocked: string; mailbox: string; connectionVersion: string; replyAll?: {to:string[];cc:string[]} };

async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/auto-mail/${path}`, { credentials: 'include', cache: 'no-store', signal,
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to complete the Auto Mail request.'), { canEditReply: data.canEditReply === true });
  return data;
}

export function AutoMail({ onOpenConfig, cacheScope = 'session', pollEnabled = true, onBreadcrumbChange }: { onBreadcrumbChange?:(path:string[])=>void; onOpenConfig?: () => void; cacheScope?:string; pollEnabled?:boolean }) {
  const [signaturePage,setSignaturePage]=useState(()=>window.location.hash==='#auto-mail/signatures');
  useEffect(()=>{const change=()=>setSignaturePage(window.location.hash==='#auto-mail/signatures');window.addEventListener('popstate',change);window.addEventListener('hashchange',change);return()=>{window.removeEventListener('popstate',change);window.removeEventListener('hashchange',change);};},[]);
  const openSignatures=()=>{history.pushState(null,'',window.location.pathname+window.location.search+'#auto-mail/signatures');setSignaturePage(true);};
  const closeSignatures=()=>{history.pushState(null,'',window.location.pathname+window.location.search);setSignaturePage(false);};
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
  useEffect(()=>{sendTasks.forEach(task=>toast.dismiss('mail-send-'+task.id));},[sendTasks]);
  const connectionKey=status?.connectionVersion||status?.mailbox||'';
  const [folder, setFolder] = useState<MailFolder>('inbox');
  const [knowledgeView,setKnowledgeView]=useState<'list'|'add'|'edit'>('list');
  const [learningView,setLearningView]=useState<'list'|'review'>('list');
  const [learningRevision,setLearningRevision]=useState(0);
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState(false);
  const [composing,setComposing]=useState(false);
  const [composeDirty,setComposeDirty]=useState(false);
  const [scheduledRefresh,setScheduledRefresh]=useState(0);const[workspaceDirty,setWorkspaceDirty]=useState(false);const[knowledgeRevision,setKnowledgeRevision]=useState(0);const[recoveredBlocked,setRecoveredBlocked]=useState(false);
  const mailboxFolder=['inbox','sent','trash'].includes(folder);
  const workspace=['drafts','knowledge','learning'].includes(folder);
  const listPath = (page?: string) => `threads?${new URLSearchParams({folder, ...(folder === 'sent' ? {order:'sent-time'} : {}), ...(query ? {q:query} : {}), ...(page ? {pageToken:page} : {})})}`;
  const initialList = peekMail<{threads:Summary[];nextPageToken:string|null}>(cacheScope,'threads?folder=inbox',connectionKey);
  const [threads, setThreads] = useState<Summary[]>(()=>initialList?.threads||[]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(()=>initialList?.nextPageToken||null);
  const pendingCompose = useRef(false);
  const [replySourceId,setReplySourceId] = useState('');
  const replySource = thread?.messages.find(message=>message.id===replySourceId) || thread?.messages.at(-1);
  const activeRecipient = replySource?.recipient ?? thread?.recipient ?? '';
  const activeReplyAll = replySource?.replyAll ?? thread?.replyAll;
  const activeReplyBlocked = replySource?.replyBlocked ?? thread?.replyBlocked ?? '';
  const aiUnavailable = !status?.knowledgeReady ? 'AI reply setup is not ready. Open Email config to check the configuration.'
    : replySource?.outbound ? 'AI reply generation is available for incoming customer messages. This selected message was sent by us.'
    : replySource?.id!==thread?.messages.at(-1)?.id ? 'AI reply generation requires the latest incoming message. This selected message is older than the latest message in the conversation.'
    : !status?.aiEnabled ? status?.aiMessage || 'Enable AI reply suggestions in Email config > Email agent.' : '';
  const [replyVisible,setReplyVisible]=useState(false);
  const [body, setBody] = useState('');
  const [bodyHtml,setBodyHtml]=useState('');
  const [responseMode,setResponseMode]=useState<'reply'|'reply-all'>('reply');
  const [recipients,setRecipients]=useState({to:'',cc:'',bcc:''});
  const [files,setFiles]=useState<ReplyUpload[]>([]);
  const appendAnswer=(answer:string)=>{setBody(current=>current.trim()?current+'\n\n'+answer:answer);setBodyHtml(current=>(current||(body.trim()?plainMailHtml(body):''))+plainMailHtml(answer));};
  const [initialization, setInitialization] = useState(()=>({active:!mailInitialized(cacheScope),error:'',progress:initialMailProgress()}));
  const [busy, setBusy] = useState(()=>initialList?'':'setup');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [sendBlocked, setSendBlocked] = useState(false);
  const [aiPending,setAiPending]=useState(false);
  const [aiDraftId, setAiDraftId] = useState<string | null>(null);
  const [lastDeliveryId, setLastDeliveryId] = useState<string | null>(null);
  const [learningQueued, setLearningQueued] = useState(false);
  const threadRequest = useRef(0);
  const sending = useRef(false);
  const requestId = useRef<string>(crypto.randomUUID());

  useEffect(()=>{
    if(!thread||!reading||composing||sendBlocked||!connectionKey||busy==='thread')return;
    try{if(body.trim()||files.length)saveMailDraft(cacheScope,connectionKey,{id:requestId.current,kind:'reply',threadId:thread.id,sourceMessageId:replySource?.id,aiDraftId,responseMode,draft:{requestId:requestId.current,connectionVersion:thread.connectionVersion,mailbox:thread.mailbox,subject:thread.subject,body,bodyHtml,to:recipients.to,cc:recipients.cc,bcc:recipients.bcc,attachmentIds:files.map(file=>file.id),files}});else removeMailDraft(cacheScope,connectionKey,requestId.current);}catch(reason){setError(reason instanceof Error?reason.message:'Unable to save draft.');}
  },[body,bodyHtml,recipients,files,aiDraftId,thread,reading,composing,sendBlocked,cacheScope,connectionKey,replySourceId]);
  useEffect(() => {
    listView.current++;
    let cancelled=false;
    const known=peekMail<Status>(cacheScope,'status');
    const saved=peekMail<{threads:Summary[];nextPageToken:string|null}>(cacheScope,listPath(),known?.connectionVersion||known?.mailbox||'');
    setBusy(saved||!mailboxFolder&&known?'':'setup'); setError(''); setNotice(''); setThread(null); setBody(''); setBodyHtml(''); setFiles([]); setThreads(saved?.threads||[]); setNextPage(saved?.nextPageToken||null); setAiDraftId(null); setLastDeliveryId(null); setLearningQueued(false);
    let warming = !mailInitialized(cacheScope);
    void initializeMail<Status>(cacheScope, progress => { if (!cancelled) { warming=true; setInitialization({active:true,error:'',progress}); } }).then(async ({status:result,revalidate}) => {
      if (cancelled) return;
      setStatus(result);
      setInitialization(current=>({...current,active:false,error:''}));
      if (!result.mailboxConnected || (known && (known.connectionVersion||known.mailbox) !== (result.connectionVersion||result.mailbox))) { setThreads([]); setNextPage(null); }
      if (result.mailboxConnected && result.oauthReady && mailboxFolder) {
        const context=result.connectionVersion||result.mailbox||'';
        const inbox = revalidate || !mailIsFresh(cacheScope,listPath(),context) ? await refreshMailThreads<Summary>(cacheScope,listPath(),context) : await cachedMail<{ threads: Summary[]; nextPageToken: string | null }>(cacheScope,listPath(),{context});
        if (!cancelled) { setThreads(inbox.threads); setNextPage(inbox.nextPageToken); }
      }
    }).catch(reason => { if (!cancelled) { if(warming)setInitialization(current=>({...current,active:true,error:reason.message}));else setError(reason.message); } })
      .finally(() => { if (!cancelled) setBusy(''); });
    return () => { cancelled=true; threadRequest.current++; };
  }, [attempt, folder, query, cacheScope]);

  const openThread = async (id: string) => {
    const reload = sendBlocked;
    const reuse = thread?.id === id && !reload && (body.trim() || files.length || mailIsFresh(cacheScope,`thread?id=${encodeURIComponent(id)}`,connectionKey));
    if (!reuse && (body.trim() || files.length) && !window.confirm('Discard your unsent reply and load this conversation?')) return;
    setReading(true);
    const serial = ++threadRequest.current;
    const view = listView.current;
    setBusy(reuse ? 'read' : 'thread'); setError(''); setNotice('');
    if (!reuse) { setReplyVisible(false); setResponseMode('reply'); setThread(null); setBody(''); setBodyHtml(''); setFiles([]); setSendBlocked(false); setAiDraftId(null); setLastDeliveryId(null); setLearningQueued(false); }
    try {
      const result = reuse ? thread! : await cachedMail<Thread>(cacheScope,`thread?id=${encodeURIComponent(id)}`,{context:connectionKey,force:reload});
      if (serial !== threadRequest.current) return;
      if (!reuse) { setThread(result); setReplySourceId(result.messages.at(-1)?.id || ''); setRecipients({to:result.recipient,cc:'',bcc:''}); requestId.current = crypto.randomUUID(); }
      if (threads.find(item => item.id === id)?.unread !== false) {
        if (!status?.canManageMail) { setPermissionNeeded(true); return result; }
        const changed = await api<{completed:string[];failed:string[]}>('mailbox-action',{ids:[id],action:'read',connectionVersion:result.connectionVersion});
        expireMail(cacheScope,'threads');
        if (!changed.completed.includes(id)) throw new Error('Unable to mark this conversation as read in Gmail. Open it again to retry.');
        if (serial === threadRequest.current && view === listView.current) {
          setThreads(current => { const updated = current.map(item => item.id === id ? {...item,unread:false} : item); writeMail(cacheScope,listPath(),{...peekMail<object>(cacheScope,listPath(),connectionKey),threads:updated,nextPageToken:nextPage},connectionKey); return updated; });
        }
      }
      return result;
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
    if (refreshController.current || (busy && busy !== 'thread' && busy !== 'read')) return;
    const view=listView.current;
    const controller = new AbortController(); refreshController.current = controller; if(!automatic)setRefreshing(true); setError('');
    try {
      const latest = await cachedMail<Status>(cacheScope,'status',{force:true});
      if (!controller.signal.aborted) setStatus(latest);
      if (latest.mailboxConnected && latest.oauthReady && mailboxFolder) {
        const inbox = await refreshMailThreads<Summary>(cacheScope,listPath(),latest.connectionVersion||latest.mailbox||'',{conditional:automatic});
        if (!controller.signal.aborted&&view===listView.current) {
          for(const item of inbox.threads){const old=threads.find(row=>row.id===item.id);if(old&&JSON.stringify(old)!==JSON.stringify(item))expireMail(cacheScope,`thread?id=${encodeURIComponent(item.id)}`);}
          setThreads(inbox.threads); setNextPage(inbox.nextPageToken);
        }
      }
      if(folder==='scheduled'){expireMail(cacheScope,'outbox');setScheduledRefresh(value=>value+1);}
      if (thread && (!latest.mailboxConnected || latest.mailbox !== thread.mailbox)) { setSendBlocked(true); setError('The connected mailbox changed. Go back and reopen the conversation before sending.'); }
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
  const send = async (sendAt?:string) => {
    if (!thread || sending.current || sendBlocked || aiPending || (!body.trim()&&!files.length)) return;
    sending.current = true;try{blockMailDraft(cacheScope,connectionKey,requestId.current,true);}catch{} setBusy('send'); setError(''); setNotice('');
    try {
      const result = await api<{ status: string; warning?: string; deliveryId?: string; learningQueued?: boolean }>('reply', { threadId: thread.id, body, recipient: activeRecipient,
        ...(sendAt?{sendAt}:{}), sourceMessageId: replySource?.id, connectionVersion: thread.connectionVersion, requestId: requestId.current, aiDraftId, ...(status?.richRepliesReady?{bodyHtml,to:recipients.to,cc:recipients.cc,bcc:recipients.bcc,attachmentIds:files.map(file=>file.id)}:{}) });
      if(!['SENT','QUEUED'].includes(result.status))throw new Error('This reply request is no longer available. Check Scheduled and Gmail Sent.');
      expireMail(cacheScope,'threads');expireMail(cacheScope,'thread?');
      try{removeMailDraft(cacheScope,connectionKey,requestId.current);}catch{}
      setReplyVisible(false);
      if(result.status==='QUEUED'){expireMail(cacheScope,'outbox');setScheduledRefresh(value=>value+1);setSendBlocked(true);setBody('');setBodyHtml('');setFiles([]);setNotice('Reply scheduled. View or cancel it in Scheduled.');return;}
      setSendBlocked(true); setBody(''); setBodyHtml(''); setFiles([]); setLastDeliveryId(result.deliveryId || null); setLearningQueued(!!result.learningQueued);
      setNotice(result.warning || (result.learningQueued ? 'Reply sent through Gmail. Your edits were queued for KB review.' : 'Reply sent through Gmail. Go back and reopen the conversation to see the latest messages.'));
    } catch (reason) {
      // A browser/network error can hide a successful send. Require a fresh server check.
      const canEdit=!!reason && typeof reason==='object' && 'canEditReply' in reason && reason.canEditReply===true;
      try{blockMailDraft(cacheScope,connectionKey,requestId.current,!canEdit);}catch{}
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
  const mayLeave=()=>workspaceDirty?window.confirm('Discard unsaved knowledge or learning changes?'):!(body.trim()||files.length||composeDirty)||window.confirm('Leave this message? Your saved copy remains in Drafts.');
  const closeCompose=()=>{if(!mayLeave())return;setComposing(false);setComposeDirty(false);setReading(false);};
  const changeFolder=(value:MailFolder)=>{pendingCompose.current=false;if(value==='knowledge'&&folder==='knowledge'){if(!mayLeave())return;setKnowledgeRevision(current=>current+1);setWorkspaceDirty(false);setKnowledgeView('list');}if(value==='learning'&&folder==='learning'){if(!mayLeave())return;setLearningRevision(current=>current+1);setWorkspaceDirty(false);setLearningView('list');}if(value!==folder||composing){if(!mayLeave())return;setComposing(false);setComposeDirty(false);}cancelReaderLoad();setReading(false);setFolder(value);if(value!==folder)setQuery('');};
  const startCompose=()=>{
    if(composing)return;
    if(initialization.active){pendingCompose.current=true;setNotice('Compose will open when the mailbox connection is ready.');return;}
    setRecoveredDraft(undefined);setRecoveredBlocked(false);
    if(!status?.composeReady||!status.richRepliesReady||!status.connectionVersion){setError('Apply the compose/outbox migration in the separate Auto Mail database, then click the Google logo to refresh.');return;}
    if(!mayLeave())return;cancelReaderLoad();setBody('');setBodyHtml('');setFiles([]);setThread(null);setReading(false);setComposeDirty(false);setComposing(true);setError('');setNotice('');
  };
  const selectReply=(all:boolean,message=replySource)=>{
    if(!thread || !message)return;
    if(message.id!==replySource?.id){
      if((body.trim()||files.length)&&!window.confirm('Discard your unsent reply and reply to this message?'))return;
      removeMailDraft(cacheScope,connectionKey,requestId.current);
      setBody('');setBodyHtml('');setFiles([]);setAiDraftId(null);requestId.current=crypto.randomUUID();
    }
    setReplySourceId(message.id);setReplyVisible(true);setResponseMode(all?'reply-all':'reply');
    const recipient=message.recipient ?? thread.recipient;
    const targets=message.replyAll ?? thread.replyAll;
    setRecipients({to:all?(targets?.to||[recipient]).join(', '):recipient,cc:all?(targets?.cc||[]).join(', '):'',bcc:''});
    window.requestAnimationFrame(()=>document.querySelector<HTMLElement>('[aria-label="Your reply"]')?.focus());
  };
  const startForward=async(message?:MailMessage)=>{
    if(!thread||busy)return;
    if(!status?.composeReady||!status.richRepliesReady){setError('Forwarding needs the compose/outbox migration. Refresh the Gmail connection after setup.');return;}
    if(!mayLeave())return;
    setBusy('forward');setError('');setNotice('');
    try{const result=await prepareMailForward(message?{...thread,messages:[message]}:thread);setRecoveredDraft(result.draft);setRecoveredBlocked(false);setComposing(true);setComposeDirty(false);setReading(false);setBody('');setBodyHtml('');setFiles([]);setNotice(result.warning);}
    catch(reason){setError(reason instanceof Error?reason.message:'Unable to prepare this forward.');}
    finally{setBusy('');}
  };
  const manageMail=async(ids:string[],action:MailAction)=>{
    if(busy)return;
    if(!status?.canManageMail){setPermissionNeeded(true);return;}
    if(!status.connectionVersion)return;
    const changingLabels = action === 'read' || action === 'unread';
    if(!changingLabels&&!window.confirm(action==='trash'?`Move ${ids.length} conversation(s), including all their messages, to Gmail Trash?`:`Restore ${ids.length} conversation(s) from Gmail Trash?`))return;
    if(!changingLabels&&!mayLeave())return;setBusy('manage');setError('');setNotice('');
    try{const result=await api<{completed:string[];failed:string[]}>('mailbox-action',{ids,action,connectionVersion:status.connectionVersion});expireMail(cacheScope,'threads');expireMail(cacheScope,'thread?');if(changingLabels){
      setThreads(current=>{const updated=current.map(item=>result.completed.includes(item.id)?{...item,unread:action==='unread'}:item);writeMail(cacheScope,listPath(),{...peekMail<object>(cacheScope,listPath(),connectionKey),threads:updated,nextPageToken:nextPage},connectionKey);return updated;});
      if(action==='unread'&&reading&&!composing&&thread&&result.completed.includes(thread.id))setReading(false);
    }else{setThreads(current=>current.filter(item=>!result.completed.includes(item.id)));if(thread&&result.completed.includes(thread.id)){setThread(null);setReading(false);setBody('');setBodyHtml('');setFiles([]);}}
    setNotice(`${result.completed.length} conversation(s) ${action==='trash'?'moved to Trash':action==='restore'?'restored':action==='read'?'marked as read':'marked as unread'}.${result.failed.length?' Some requests could not be confirmed. Refresh Gmail before retrying.':''}`);}catch(reason){setError(reason instanceof Error?reason.message:'Unable to manage conversations.');}finally{setBusy('');}
  };
  const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50';
  const deleteDraft=async(saved:SavedMailDraft)=>{
    if(!window.confirm('Discard this saved draft?'))return;setBusy('draft');setError('');
    try{for(const file of saved.draft.files)await api('attachment-remove',{id:file.id});removeMailDraft(cacheScope,connectionKey,saved.id);setNotice('Draft discarded.');}catch(reason){setError(reason instanceof Error?reason.message:'Unable to discard draft.');}finally{setBusy('');}
  };
  const resumeDraft=async(saved:SavedMailDraft)=>{
    if(!mayLeave())return;
    if(saved.kind==='compose'){setRecoveredDraft(saved.draft);setRecoveredBlocked(!!saved.blocked);setComposing(true);setComposeDirty(false);return;}
    const current=await openThread(saved.threadId||'');if(!current)return;
    const source=current.messages.find(message=>message.id===saved.sourceMessageId);
    if(!source||(source.replyBlocked ?? current.replyBlocked)){setError('This conversation changed. Your saved draft is preserved; review the latest message before replying.');return;}
    setReplySourceId(source.id);setResponseMode(saved.responseMode||'reply');setReplyVisible(true);setBody(saved.draft.body);setBodyHtml(saved.draft.bodyHtml);setFiles(saved.draft.files);setRecipients({to:saved.draft.to,cc:saved.draft.cc,bcc:saved.draft.bcc});setAiDraftId(saved.aiDraftId||null);setSendBlocked(!!saved.blocked);requestId.current=saved.id;
  };
  const resumeAi=async(saved:SavedAiDraft)=>{
    if(!mayLeave())return;const current=await openThread(saved.threadId);if(!current)return;
    setReplyVisible(true);setBusy('ai');setError('');
    try{const checked=await api<{draft:{body:string;id:string}}>('ai-use',{draftId:saved.id,threadId:current.id,connectionVersion:current.connectionVersion});setReplyVisible(true);setBody(checked.draft.body);setBodyHtml(plainMailHtml(checked.draft.body));setAiDraftId(checked.draft.id);setNotice('AI draft opened. Review it before sending.');}catch(reason){setError(reason instanceof Error?reason.message:'Unable to recover this AI draft.');}finally{setBusy('');}
  };
  useEffect(()=>{if(!initialization.active&&pendingCompose.current){pendingCompose.current=false;startCompose();}},[initialization.active]);
  useEffect(()=>{
    const label={inbox:'Inbox',sent:'Sent',drafts:'Drafts',scheduled:'Scheduled',trash:'Trash',knowledge:'Knowledge Base',learning:'Learning review'}[folder];
    onBreadcrumbChange?.(signaturePage?['Signatures']:[label,...(composing?['Compose']:reading?[thread?.subject||'Conversation']:folder==='knowledge'&&knowledgeView!=='list'?[knowledgeView==='add'?'Add':'Edit']:folder==='learning'&&learningView==='review'?['Review']:[])]);
  },[onBreadcrumbChange,folder,signaturePage,composing,reading,thread?.subject,knowledgeView,learningView]);
  const chromeBusy = !!busy && !['setup','thread','read','more'].includes(busy);
  const cancelReaderLoad = () => { if (busy === 'thread' || busy === 'read') { threadRequest.current++; setBusy(''); } };
  const mailboxControls = <div className="flex shrink-0 items-center gap-1 sm:gap-3">
      <div ref={menuRef} className="relative"><button ref={menuButton} type="button" aria-label="Auto Mail options" aria-haspopup="menu" aria-expanded={menuOpen} disabled={chromeBusy} onClick={() => setMenuOpen(value => !value)} className="inline-flex h-10 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-sky-100 disabled:opacity-50"><MoreVertical className="h-5 w-5" /></button>
      {menuOpen && <div role="menu" aria-label="Auto Mail options" onKeyDown={event => { const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')); const index = items.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null; if (next !== null) { event.preventDefault(); items[next]?.focus(); } if (event.key === 'Tab') setMenuOpen(false); }} className="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
      {onOpenConfig && <><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenConfig(); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"><Settings className="h-4 w-4" />Email config</button></>}
      {status?.mailboxConnected && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void connect(); }} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50">Reconnect Gmail</button>}
      </div>}</div><GoogleConnectionButton size="compact" email={status?.mailboxConnected ? status.mailbox || '' : ''} connecting={busy === 'connect' || refreshing} connectedAction="refresh" disabled={chromeBusy || (!initialization.active && (status?.state !== 'READY' || !status.oauthReady))} onConnect={() => {if(initialization.active){setAttempt(value=>value+1);return;}void (status?.mailboxConnected ? refreshMailbox() : connect());}} /></div>;

  if (initialization.active) return <AutoMailInitialization progress={initialization.progress} error={initialization.error} onRetry={()=>setAttempt(value=>value+1)} />;

  return <>{signaturePage&&<AutoMailSignatures scope={cacheScope} mailbox={status?.mailbox||''} onBack={closeSignatures}/>}<section hidden={signaturePage} style={signaturePage?{display:'none'}:undefined} aria-label="Auto Mail" className="flex h-[calc(100dvh-48px)] min-h-[400px] w-full min-w-0 flex-col gap-2 pt-2">
    {!initialization.active && status?.state!=='READY'&&!status?.mailboxConnected && busy !== 'setup' && <div className="flex justify-end">{mailboxControls}</div>}
    <AutoMailSnackbarArea>
      {status && status.state !== 'READY' && <AutoMailSnackbar key={status.message} persistent>{status.message}</AutoMailSnackbar>}
      {status?.state === 'READY' && !status.oauthReady && <AutoMailSnackbar persistent>Configure AUTO_MAIL_APP_URL, Google OAuth credentials, and GOOGLE_TOKEN_ENCRYPTION_KEY on the server, then refresh. See the Auto Mail development guide.</AutoMailSnackbar>}
      {error && <AutoMailSnackbar key={'error:'+error} alert onDismiss={()=>setError('')}>{error}</AutoMailSnackbar>}
      {permissionNeeded&&!status?.canManageMail&&<AutoMailSnackbar onDismiss={()=>setPermissionNeeded(false)}><span>Reconnect Gmail to sync read status and manage messages.</span><button type="button" disabled={!!busy} onClick={()=>void connect()}>Reconnect Gmail for mailbox management</button></AutoMailSnackbar>}
      {sendTasks.map(task=><AutoMailSnackbar key={task.id+task.state} alert={task.state==='ERROR'} persistent={task.state==='SENDING'||task.state==='ERROR'} onDismiss={task.state==='SENDING'?undefined:()=>dismissMailSend(task.id)}><span>{task.state==='SENDING'?'Sending...':task.state==='SENT'?(task.error||'Message sent through Gmail.'):task.state==='QUEUED'?(task.draft.sendAt?'Message scheduled. View or cancel it in Scheduled.':'Message queued for sending.'):task.error}</span><span>{task.draft.subject}</span>{task.state==='ERROR'&&<button type="button" disabled={!!busy} onClick={()=>{if(!mayLeave())return;setRecoveredDraft(task.draft);setRecoveredBlocked(!task.canEdit);setComposing(true);setComposeDirty(false);setBody('');setFiles([]);}}>{task.canEdit?'Restore draft':'View message'}</button>}</AutoMailSnackbar>)}
      {notice && <AutoMailSnackbar key={'notice:'+notice} onDismiss={()=>setNotice('')}>{notice}</AutoMailSnackbar>}
    </AutoMailSnackbarArea>
    <div className="min-h-0 flex-1">
    {(initialization.active || status?.state==='READY' || busy === 'setup') && <AutoMailMailbox workspaceTitle={!composing&&folder==='knowledge'?{title:'Knowledge base',description:'Manage and approve reusable answers for your email replies.'}:!composing&&folder==='learning'?{title:'Learning review',description:'Turn confirmed staff replies into reusable, reviewed knowledge.'}:undefined} showBack={reading||composing} toolbarActions={mailboxControls} folder={folder} query={query} threads={threads} nextPage={nextPage} loading={initialization.active || !!busy || refreshing} disabled={chromeBusy} onCompose={startCompose} composeReady={!!status?.composeReady} onAction={(ids,action)=>void manageMail(ids,action)} canManage={!!status?.canManageMail} activeThreadId={!composing&&reading?thread?.id:undefined}
      onFolder={changeFolder}
      onSearch={value => { pendingCompose.current=false; if (value === query) { setReading(false); return; } if ((body.trim() || files.length) && !window.confirm('Discard your unsent reply and search mail?')) return; setReading(false); setQuery(value); }}
      onMore={() => void loadMore()} reading={reading||composing||folder==='scheduled'||workspace} onBack={() => {cancelReaderLoad();if(composing)closeCompose();else setReading(false);}} onOpen={id => void openThread(id)}>
      {composing?<AutoMailNewMessage onDiscarded={id=>removeMailDraft(cacheScope,connectionKey,id)} onSnapshot={draft=>{try{if(draft.subject||draft.body.trim()||draft.to||draft.files.length)saveMailDraft(cacheScope,connectionKey,{id:draft.requestId,kind:'compose',draft,blocked:recoveredBlocked});else removeMailDraft(cacheScope,connectionKey,draft.requestId);}catch(reason){setError(reason instanceof Error?reason.message:'Unable to save draft.');}}} contacts={mailContacts(cacheScope,connectionKey)} signatureScope={cacheScope} onManageSignatures={openSignatures} key={recoveredDraft?.requestId||'new'} initialDraft={recoveredDraft} initialBlocked={recoveredBlocked||(recoveredDraft?sendTasks.some(task=>task.id===recoveredDraft.requestId&&!task.canEdit):false)} onSubmit={draft=>{startMailSend(cacheScope,draft);setComposing(false);setComposeDirty(false);setRecoveredDraft(undefined);setReading(false);setNotice('');}} mailbox={status?.mailbox||''} connectionVersion={status?.connectionVersion||''} schedulerReady={!!status?.schedulerReady} onClose={closeCompose} onDirty={setComposeDirty} onBusy={value=>setBusy(value?'compose':'')} onDone={message=>{if(message==='Draft discarded.'&&recoveredDraft)removeMailDraft(cacheScope,connectionKey,recoveredDraft.requestId);setComposing(false);setComposeDirty(false);setReading(false);setNotice(message);setScheduledRefresh(value=>value+1);}}/>:folder==='drafts'&&!reading?<AutoMailDrafts scope={cacheScope} connection={connectionKey} aiReady={!!status?.knowledgeReady} onResume={saved=>void resumeDraft(saved)} onAi={saved=>void resumeAi(saved)} onDelete={saved=>void deleteDraft(saved)} onOpenThread={id=>void openThread(id)} disabled={!!busy}/>:folder==='knowledge'?<div className="flex min-h-0 flex-1 flex-col"><AutoMailKnowledge key={knowledgeRevision} hideHeader onViewChange={setKnowledgeView} onDirtyChange={setWorkspaceDirty} ready={!!status?.knowledgeReady} refreshToken={knowledgeRevision}/></div>:folder==='learning'?<div className="flex min-h-0 flex-1 flex-col">{!status?.learningReady&&<h3 className="mb-4 font-semibold">Learning review</h3>}<AutoMailLearning key={learningRevision} hideHeader onViewChange={setLearningView} onDirtyChange={setWorkspaceDirty} ready={!!status?.learningReady} refreshToken={scheduledRefresh} onReviewed={()=>{setKnowledgeRevision(value=>value+1);expireMail(cacheScope,'thread?');}}/></div>:folder==='scheduled'?<AutoMailScheduled key={scheduledRefresh} cacheScope={cacheScope} connectionVersion={status?.connectionVersion||''} onBusy={value=>setBusy(value?'schedule':'')}/>:<div className="min-w-0 bg-white p-4 sm:p-5">
        {busy === 'thread' ? <AutoMailSkeleton reader /> : !thread ? <p className="text-sm text-slate-500">Select a conversation to read and reply.</p> : <>
          <div className="flex items-start justify-between gap-3 pl-11 sm:pl-12"><h3 className="min-w-0 flex-1 break-words font-semibold text-slate-900 [overflow-wrap:anywhere]">{thread.subject}</h3><div className="flex shrink-0 items-center gap-3 pt-0.5"><span className="whitespace-nowrap text-xs font-semibold text-slate-500">{thread.messages.length} message{thread.messages.length===1?'':'s'}</span><a href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(thread.mailbox)}#all/${encodeURIComponent(thread.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700">Gmail <ExternalLink className="h-3 w-3" /></a></div></div>
          <AutoMailReader key={thread.id} threadId={thread.id} messages={thread.messages} disabled={!!busy} forwardBlocked={!status?.composeReady} replyBlocked={sendBlocked?'Reopen the conversation before replying again.':''} onAction={(message,action)=>{
            if(action==='forward')void startForward(message);
            else if(action==='trash'||action==='unread')void manageMail([thread.id],action);
            else selectReply(action==='reply-all',message);
          }} />
          <div role="group" aria-label="Conversation actions" className="mb-2 flex flex-wrap gap-2 pl-11 sm:pl-12">
            {!thread.replyBlocked&&<><button type="button" disabled={!!busy||sendBlocked} onClick={()=>selectReply(true,thread.messages.at(-1))} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"><ReplyAll className="h-4 w-4"/>Reply all</button><button type="button" disabled={!!busy||sendBlocked} onClick={()=>selectReply(false,thread.messages.at(-1))} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Reply className="h-4 w-4"/>Reply</button></>}
            <button type="button" disabled={!!busy||!status?.composeReady} onClick={()=>void startForward()} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Forward className="h-4 w-4"/>{busy==='forward'?'Preparing forward...':'Forward'}</button>
          </div>
          {replyVisible&&!activeReplyBlocked&&replySource&&<p className="mb-2 pl-11 text-xs text-slate-500 sm:pl-12">{responseMode==='reply-all'?'Reply all':'Reply'} to message from {replySource.from} on {new Date(replySource.date).toLocaleString()}</p>}
          {activeReplyBlocked ? (!replySource?.outbound && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{activeReplyBlocked}</p>) : replyVisible ? <AutoMailComposer onAiPendingChange={setAiPending} onDiscard={()=>{removeMailDraft(cacheScope,connectionKey,requestId.current);setReplyVisible(false);setBody('');setBodyHtml('');setFiles([]);setAiDraftId(null);setRecipients({to:activeRecipient,cc:'',bcc:''});setResponseMode('reply');requestId.current=crypto.randomUUID();setNotice('Draft discarded.');}} contacts={mailContacts(cacheScope,connectionKey)} signatureScope={cacheScope} onManageSignatures={openSignatures} schedulerReady={!!status?.replySchedulerReady} onSchedule={when=>void send(when)} helpers={{knowledge:(status?.knowledgeReady && !activeReplyBlocked && replySource?.id===thread.messages.at(-1)?.id && !replySource?.outbound && <AutoMailKnowledgeMatches key={thread.id + ':' + thread.messages.at(-1)?.id} subject={thread.subject} message={thread.messages.at(-1)?.body || ''} disabled={!!busy || sendBlocked} onInsert={answer => { appendAnswer(answer); setNotice('Approved KB answer added. Review and edit the reply before sending.'); }} />),ai:(<AutoMailAiDraft key={'ai:' + thread.id + ':' + replySource?.id} threadId={thread.id} sourceMessageId={replySource?.id || ''} connectionVersion={thread.connectionVersion} enabled={!aiUnavailable} setupMessage={aiUnavailable} onOpenSettings={onOpenConfig?()=>onOpenConfig():undefined} disabled={!!busy || sendBlocked} onBusyChange={value => setBusy(current => value ? 'ai' : current === 'ai' ? '' : current)} onUse={(answer, id) => { appendAnswer(answer); setAiDraftId(id); setNotice('AI draft added. Review and edit your reply before sending.'); }} />)}} responseMode={responseMode} onReply={()=>selectReply(false)} onForward={()=>void startForward(replySource)} body={body} html={bodyHtml} onChange={(text,html)=>{setBody(text);setBodyHtml(html);}} to={recipients.to} cc={recipients.cc} bcc={recipients.bcc} onRecipients={(field,value)=>setRecipients(current=>({...current,[field]:value}))} replyAll={activeReplyAll||{to:[activeRecipient],cc:[]}} onReplyAll={()=>selectReply(true)} mailbox={thread.mailbox} files={files} onFiles={setFiles} requestId={requestId.current} threadId={thread.id} sourceMessageId={replySource?.id||''} connectionVersion={thread.connectionVersion} richReady={!!status?.richRepliesReady} disabled={!!busy||sendBlocked} sending={busy==='send'} onSend={()=>void send()} onBusyChange={value=>setBusy(current=>value?'upload':current==='upload'?'':current)} /> : null}
          {status?.learningReady && lastDeliveryId && <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">{learningQueued ? <p className="text-xs text-emerald-800">This reply has a learning suggestion. Open Learning review in Auto Mail before publishing to the KB.</p> : <button type="button" className={button} disabled={!!busy} onClick={() => void proposeLearning()}>Suggest this reply for the KB</button>}<button type="button" className={`${button} mt-2`} disabled={!!busy} onClick={() => changeFolder('learning')}>Open Learning review</button></div>}
        </>}
      </div>}
    </AutoMailMailbox>}
    </div>
    <p className="shrink-0 px-3 pb-2 text-xs text-slate-500">Automatic replies are disabled. {status?.aiEnabled ? 'AI drafts require staff review and a separate click to send.' : 'AI suggestions are not enabled.'} Opening a conversation marks it read in Gmail when mailbox-management permission is connected.</p>
  </section></>;
}

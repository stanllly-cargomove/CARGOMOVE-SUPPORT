import React,{useEffect,useState,useSyncExternalStore} from 'react';
import { FilePenLine, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { mailDraftRevision,readMailDrafts,subscribeMailDrafts,type SavedMailDraft } from '../../services/autoMailDrafts';
import { knowledgeRequest } from '../../services/autoMailKnowledge';
import { AutoMailSkeleton } from './AutoMailSkeleton';
import { AutoMailSnackbar,AutoMailSnackbarArea } from './AutoMailSnackbar';

type IncomingJob={id:string;subject:string;gmail_thread_id:string;status:string;classification:{category?:string;kb_match?:string;confidence?:number};auto_reply_state?:string;auto_reply_evaluation?:{confidence?:number;reason?:string};review_reason:string;created_at:string};
export type SavedAiDraft={id:string;threadId:string;sourceMessageId:string;status:string;body:string;reviewNotes:string;createdAt:string;model:string;scope:string;automatic?:boolean;draftKind?:string;autoReplyState?:string;sources:{id:string;title:string;version:number;content:string;port:string;cited:boolean}[]};

function draftDate(value:string|number){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return'';
  if(date.toDateString()===new Date().toDateString())return date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  return date.toLocaleDateString(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==new Date().getFullYear()?{year:'numeric' as const}:{})});
}

export function AutoMailDrafts({scope,connection,searchQuery='',aiReady,onResume,onAi,onDelete,onOpenThread,disabled}:{scope:string;connection:string;searchQuery?:string;aiReady:boolean;onResume:(draft:SavedMailDraft)=>void;onAi:(draft:SavedAiDraft)=>void;onDelete:(draft:SavedMailDraft)=>void;onOpenThread:(id:string)=>void;disabled:boolean}){
  useSyncExternalStore(subscribeMailDrafts,mailDraftRevision);
  const[tab,setTab]=useState<'user'|'ai'>('user');
  const[items,setItems]=useState<SavedAiDraft[]>([]);
  const[jobs,setJobs]=useState<IncomingJob[]>([]);
  const[next,setNext]=useState<number|null>(null);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  const[attempt,setAttempt]=useState(0);
  const[offset,setOffset]=useState(0);
  useEffect(()=>{
    if(tab!=='ai'||!aiReady)return;
    const controller=new AbortController();setBusy(true);setError('');
    void knowledgeRequest<{jobs?:IncomingJob[];drafts:SavedAiDraft[];nextOffset:number|null}>(`ai-drafts?offset=${offset}`,undefined,controller.signal)
      .then(result=>{if(!controller.signal.aborted){setItems(current=>offset?[...current,...result.drafts]:result.drafts);setNext(result.nextOffset);setJobs(result.jobs||[]);}})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason.message);})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[tab,offset,attempt,aiReady,connection]);
  const user=readMailDrafts(scope,connection);
  const search=searchQuery.trim().toLocaleLowerCase();
  const includesSearch=(values:unknown[])=>!search||values.some(value=>String(value||'').toLocaleLowerCase().includes(search));
  const visibleUser=user.filter(item=>includesSearch([item.kind,item.draft.subject,item.draft.to,item.draft.cc,item.draft.bcc,item.draft.body,...item.draft.files.map(file=>file.name)]));
  const visibleItems=items.filter(item=>includesSearch([item.status,item.body,item.reviewNotes,item.scope,item.model,...item.sources.flatMap(source=>[source.title,source.port,source.content])]));
  const visibleJobs=jobs.filter(job=>includesSearch([job.subject,job.status,job.review_reason,job.classification.category,job.classification.kb_match,job.auto_reply_state]));

  return <section aria-label="Saved drafts" className="flex min-h-0 flex-1 flex-col">
    <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
      <h3 className="flex items-center gap-2 font-semibold"><FilePenLine className="h-5 w-5"/>Drafts</h3>
      {tab==='ai'&&<button type="button" aria-label="Refresh AI drafts" disabled={busy} onClick={()=>{setOffset(0);setAttempt(value=>value+1);}} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><RefreshCw className="h-4 w-4"/></button>}
    </header>
    <div role="tablist" aria-label="Draft authors" className="flex min-h-11 items-end gap-1 border-y border-slate-200 bg-slate-50 px-4">
      {(['user','ai'] as const).map(value=><button key={value} type="button" role="tab" aria-selected={tab===value} onClick={()=>{setTab(value);setOffset(0);}} className={`relative h-11 px-4 text-sm ${tab===value?'font-semibold text-sky-700 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-sky-600':'text-slate-600 hover:bg-white hover:text-slate-900'}`}>{value==='user'?'By you':'By AI tools'}</button>)}
    </div>
    <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{tab==='user'?'Your unsent drafts are saved in this browser tab, including across refresh. Signing out clears them.':'Saved AI suggestions are checked against the latest conversation and approved sources before use.'}</p>
    {error&&<AutoMailSnackbarArea><AutoMailSnackbar key={error} alert onDismiss={()=>setError('')}>{error}</AutoMailSnackbar></AutoMailSnackbarArea>}
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 items-center border-b border-slate-200 px-4 text-xs text-slate-500"><span>{tab==='user'?'Personal drafts':'AI-generated drafts'}</span><span className="ml-auto">{tab==='user'?visibleUser.length:visibleItems.length}{search?` of ${tab==='user'?user.length:items.length}`:''} loaded</span></div>
      {tab==='user'?<div aria-label="Personal drafts" className="min-h-0 flex-1 overflow-y-auto">
        {visibleUser.map(item=><article key={item.id} className="group relative flex items-center border-b border-slate-100 bg-slate-50/70 px-4 hover:z-10 hover:bg-white hover:shadow-sm">
          <button type="button" disabled={disabled} onClick={()=>onResume(item)} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-left disabled:opacity-40 md:grid-cols-[160px_minmax(0,1fr)_auto] xl:grid-cols-[190px_minmax(0,1fr)_auto]">
            <span className="truncate text-sm text-slate-800">{item.kind==='reply'?'Reply':'New message'} · {item.draft.to||'No recipients'}</span>
            <span className="col-span-2 row-start-2 truncate text-sm md:col-span-1 md:col-start-2 md:row-start-1"><span className="font-semibold text-slate-800">{item.draft.subject||'(No subject)'}</span><span className={item.blocked?'text-amber-700':'text-slate-400'}> — {item.blocked?'Check Gmail Sent before sending again.':item.draft.body||'Attachment draft'}</span></span>
            <time className="col-start-2 row-start-1 whitespace-nowrap text-xs text-slate-500 md:col-start-3">{draftDate(item.updatedAt)}</time>
          </button>
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 rounded-full bg-white p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100"><button type="button" aria-label={`Delete draft ${item.draft.subject||'(No subject)'}`} disabled={disabled} onClick={()=>onDelete(item)} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><Trash2 className="h-4 w-4"/></button></div>
        </article>)}
        {!visibleUser.length&&<div className="flex h-full min-h-[240px] items-center justify-center px-6 text-center"><p className="text-sm text-slate-500">{search?'No drafts match this search.':'No user drafts. Start a reply or compose a message to save one.'}</p></div>}
      </div>:!aiReady?<p className="px-4 py-12 text-center text-sm text-slate-500">Apply the existing AI draft migration and refresh the Gmail connection to view AI drafts.</p>:<div aria-label="AI-generated drafts" className="min-h-0 flex-1 overflow-y-auto">
        {busy&&!items.length?<AutoMailSkeleton/>:visibleItems.map(item=>{const usable=['READY','NEEDS_REVIEW'].includes(item.status)&&!(item.autoReplyState&&item.autoReplyState!=='REVIEW');return <article key={item.id} className="group relative flex items-center border-b border-slate-100 bg-slate-50/70 px-4 hover:z-10 hover:bg-white hover:shadow-sm">
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 md:grid-cols-[160px_minmax(0,1fr)_auto] xl:grid-cols-[190px_minmax(0,1fr)_auto]">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-sm text-slate-800"><Sparkles className="h-4 w-4 shrink-0 text-violet-500"/>{item.status.replaceAll('_',' ')} · {item.scope}</span>
            <span className="col-span-2 row-start-2 truncate text-sm md:col-span-1 md:col-start-2 md:row-start-1"><span className="font-semibold text-slate-800">AI suggestion</span><span className="text-slate-400"> — {item.body||'No supported answer was generated.'}</span>{item.reviewNotes&&<span className="text-amber-700"> · {item.reviewNotes}</span>}</span>
            <time className="col-start-2 row-start-1 whitespace-nowrap text-xs text-slate-500 md:col-start-3">{draftDate(item.createdAt)}</time>
            <span className="col-span-2 row-start-3 truncate text-[11px] text-slate-500 md:col-start-2">{item.autoReplyState&&item.autoReplyState!=='REVIEW'?`Automatic delivery: ${item.autoReplyState==='SENDING'?'Sending or outcome unconfirmed':item.autoReplyState.replaceAll('_',' ')}`:`${item.sources.length} approved source${item.sources.length===1?'':'s'}`}</span>
          </div>
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 rounded-full bg-white p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100"><button type="button" disabled={disabled||!usable} onClick={()=>onAi(item)} className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs text-violet-800 disabled:opacity-40">Review in conversation</button></div>
        </article>;})}
        {!busy&&!visibleItems.length&&<div className="flex h-full min-h-[240px] items-center justify-center px-6 text-center"><p className="text-sm text-slate-500">{search?'No AI drafts match this search.':'No AI drafts yet. Generate one from a conversation.'}</p></div>}
        {next!==null&&<div className="border-t border-slate-100 px-3 py-2 text-center"><button type="button" disabled={busy} onClick={()=>setOffset(next)} className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Load more AI drafts</button></div>}
      </div>}
      {tab==='ai'&&visibleJobs.length>0&&<details className="shrink-0 border-t border-slate-200"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Classification and issues needing KB review ({visibleJobs.length})</summary><div>{visibleJobs.map(job=><article key={job.id} className="group relative flex items-center border-t border-slate-100 px-4 hover:bg-slate-50"><div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 md:grid-cols-[160px_minmax(0,1fr)_auto]"><span className="truncate text-xs font-semibold text-slate-600">{job.classification.category?.replaceAll('_',' ')||'Unclassified'} · {job.status.replaceAll('_',' ')}</span><span className="col-span-2 row-start-2 truncate text-sm md:col-span-1 md:col-start-2 md:row-start-1"><span className="font-medium text-slate-800">{job.subject}</span><span className="text-slate-400"> — {job.review_reason}</span></span><time className="col-start-2 row-start-1 whitespace-nowrap text-xs text-slate-500 md:col-start-3">{draftDate(job.created_at)}</time></div>{job.status!=='SKIPPED'&&<button type="button" disabled={disabled} onClick={()=>onOpenThread(job.gmail_thread_id)} className="ml-2 shrink-0 rounded-full border px-3 py-1 text-xs text-sky-700 disabled:opacity-40">Open for support review</button>}</article>)}</div></details>}
    </div>
  </section>;
}

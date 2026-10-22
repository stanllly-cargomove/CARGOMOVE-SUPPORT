import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ChevronDown, Eye, FileText, Image, Mail, Paperclip, Reply, X } from 'lucide-react';
import { knowledgeRequest } from '../../services/autoMailKnowledge';
import { browserMailHtml, fileSize } from '../../services/autoMailFormatting';

export type MailFile = { partId: string; name: string; type: string; size: number };
export type MailMessage = { id: string; from: string; to: string; cc?: string; bcc?: string; date: string; body: string; html?: string; outbound: boolean; attachments: boolean; files?: MailFile[] };
type Preview = { url: string; name: string; type: string; size: number; previewable: boolean; messageId: string; partId: string };

function LinkedText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g).map((part,index)=>{
    const tail=part.match(/[.,;!?]+$/)?.[0]||'';const value=tail?part.slice(0,-tail.length):part;
    const href=/^https?:\/\//i.test(value)?value:value.startsWith('www.')?`https://${value}`:/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)?`mailto:${value}`:'';
    return href?<React.Fragment key={index}><a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline decoration-sky-200 underline-offset-2 hover:text-sky-900">{value}</a>{tail}</React.Fragment>:<React.Fragment key={index}>{part}</React.Fragment>;
  })}</>;
}
function PlainBody({ text }: { text: string }) {
  const lines=text.split('\n');const first=lines.findIndex(line=>/^\s*>|^On .+wrote:|^-{3,}\s*(Original|Forwarded)/i.test(line));
  const quote=first>=0?lines.slice(first).join('\n').replace(/^\s*> ?/gm,''):'';
  const own=first>=0?lines.slice(0,first).join('\n'):text;
  return <div className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{own&&<LinkedText text={own}/>} {quote&&(own.trim()?<details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-500">Show quoted history</summary><blockquote className="mt-3 border-l-2 border-slate-200 pl-4"><LinkedText text={quote}/></blockquote></details>:<blockquote className="border-l-2 border-sky-200 pl-4"><LinkedText text={quote}/></blockquote>)}</div>;
}
function HtmlBody({ html }: { html: string }) { const safe=useMemo(()=>browserMailHtml(html,true),[html]);return <div className="auto-mail-content" dangerouslySetInnerHTML={{__html:safe}}/>; }

export function AutoMailReader({ threadId, messages }: { threadId: string; messages: MailMessage[] }) {
  const [plain,setPlain]=useState<string[]>([]);
  const [loading,setLoading]=useState('');const [error,setError]=useState('');const [preview,setPreview]=useState<Preview|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(preview&&!dialog.current?.open)dialog.current?.showModal();},[preview]);
  const attachment=async(messageId:string,partId:string,download=false)=>{
    if(loading)return;setLoading(`${messageId}:${partId}`);setError('');
    try{
      const value=await knowledgeRequest<Preview>(`attachment?${new URLSearchParams({threadId,messageId,partId,download:download?'1':'0'})}`);
      if(download||!value.previewable){const link=document.createElement('a');link.href=value.url;link.download=value.name;link.target='_blank';link.rel='noopener noreferrer';link.click();}
      else setPreview({...value,messageId,partId});
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to open attachment.');}
    finally{setLoading('');}
  };
  return <section aria-label="Conversation messages" className="my-5 space-y-4">
    <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><Mail className="h-4 w-4"/>{messages.length} message{messages.length===1?'':'s'} in this conversation</div>
    {messages.map((message,index)=><details key={message.id} open={index===messages.length-1} className="group/message min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className={`flex cursor-pointer list-none items-center gap-3 p-4 ${message.outbound?'bg-sky-50/60':'bg-slate-50/70'}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${message.outbound?'bg-sky-100 text-sky-700':'bg-indigo-100 text-indigo-700'}`}>{message.from.replace(/["<>]/g,'').slice(0,2).toUpperCase()}</span>
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-slate-800">{message.from}</p><p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">{message.outbound?<><Reply className="h-3 w-3"/>Sent reply</>:'Incoming message'}<span aria-hidden="true">/</span><time dateTime={message.date}>{new Date(message.date).toLocaleString()}</time>{message.attachments&&<Paperclip className="h-3 w-3"/>}</p></div>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open/message:rotate-180"/>
      </summary>
      <div className="min-w-0 p-4 sm:p-5"><dl className="mb-4 space-y-1 border-b border-slate-100 pb-4 text-xs leading-5"><div className="flex gap-2"><dt className="w-8 shrink-0 text-slate-400">To</dt><dd className="break-words text-slate-600"><LinkedText text={message.to}/></dd></div>{message.cc&&<div className="flex gap-2"><dt className="w-8 shrink-0 text-slate-400">CC</dt><dd className="break-words text-slate-600"><LinkedText text={message.cc}/></dd></div>}{message.bcc&&<div className="flex gap-2"><dt className="w-8 shrink-0 text-slate-400">BCC</dt><dd className="break-words text-slate-600"><LinkedText text={message.bcc}/></dd></div>}</dl>
        {message.html&&<button type="button" onClick={()=>setPlain(current=>current.includes(message.id)?current.filter(id=>id!==message.id):[...current,message.id])} className="mb-3 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500">{plain.includes(message.id)?'Formatted view':'Plain text view'}</button>}
        {message.html&&!plain.includes(message.id)?<HtmlBody html={message.html}/>:<PlainBody text={message.body}/>}
        {!!message.files?.length&&<div className="mt-5 border-t border-slate-100 pt-4"><p className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-500"><Paperclip className="h-3.5 w-3.5"/>Attachments ({message.files.length})</p><div className="grid min-w-0 gap-2 xl:grid-cols-2">{message.files.map(file=><div key={file.partId} className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">{file.type.startsWith('image/')?<Image className="h-7 w-7 shrink-0 text-sky-500"/>:<FileText className="h-7 w-7 shrink-0 text-indigo-400"/>}<div className="min-w-0 flex-1"><p className="break-all text-xs font-medium text-slate-700">{file.name}</p><p className="mt-1 text-[11px] text-slate-400">{fileSize(file.size)}</p></div><button type="button" aria-label={`Preview ${file.name}`} title="Preview attachment" disabled={!!loading} onClick={()=>void attachment(message.id,file.partId)} className="rounded-md p-1.5 text-slate-500 hover:bg-white disabled:opacity-50"><Eye className="h-4 w-4"/></button><button type="button" aria-label={`Download ${file.name}`} title="Download attachment" disabled={!!loading} onClick={()=>void attachment(message.id,file.partId,true)} className="rounded-md p-1.5 text-slate-500 hover:bg-white disabled:opacity-50"><ArrowDownToLine className="h-4 w-4"/></button></div>)}</div></div>}
        {message.attachments&&!message.files?.length&&<p className="mt-4 text-xs text-slate-500">Open this message in Gmail to view its attachments.</p>}
      </div>
    </details>)}
    {loading&&<p role="status" className="text-xs text-slate-500">Preparing attachment...</p>}{error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <dialog ref={dialog} onCancel={()=>setPreview(null)} onClose={()=>setPreview(null)} aria-label="Attachment preview" className="fixed inset-0 m-auto w-[min(95vw,1000px)] max-w-none rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/60">{preview&&<><div className="flex items-center gap-3 border-b border-slate-200 p-4"><p className="min-w-0 flex-1 break-all text-sm font-semibold">{preview.name}</p><button type="button" disabled={!!loading} onClick={()=>void attachment(preview.messageId,preview.partId,true)} className="rounded-lg border px-3 py-2 text-xs">Download</button><button type="button" autoFocus aria-label="Close attachment preview" onClick={()=>dialog.current?.close()} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5"/></button></div><div className="flex h-[70vh] items-center justify-center overflow-auto bg-slate-50 p-3">{preview.type==='application/pdf'?<iframe src={preview.url} title={preview.name} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" className="h-full w-full border-0"/>:<img src={preview.url} alt={preview.name} referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain"/>}</div></>}</dialog>
  </section>;
}

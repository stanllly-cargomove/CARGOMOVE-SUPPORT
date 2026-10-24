import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Paperclip, Reply } from 'lucide-react';
import { AutoMailMessageMenu, type MessageAction } from './AutoMailMessageMenu';
import { AutoMailHtmlBody } from './AutoMailHtmlBody';
import { AutoMailAttachments } from './AutoMailAttachments';
import { createMailAttachmentLoader, type MailFile } from '../../services/autoMailAttachments';
export type { MailFile } from '../../services/autoMailAttachments';
import { AutoMailRecipients } from './AutoMailRecipients';

export type MailMessage = { recipient?: string; replyBlocked?: string; replyAll?: {to:string[];cc:string[]}; id: string; from: string; to: string; cc?: string; bcc?: string; date: string; body: string; html?: string; outbound: boolean; attachments: boolean; files?: MailFile[]; inlineImages?: MailFile[] };

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
  return <div className="whitespace-pre-wrap break-words text-sm leading-5 text-slate-700">{own&&<LinkedText text={own}/>} {quote&&(own.trim()?<details className="mt-2 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-500">Show quoted history</summary><blockquote className="mt-2 border-l-2 border-slate-200 pl-4"><LinkedText text={quote}/></blockquote></details>:<blockquote className="border-l-2 border-sky-200 pl-4"><LinkedText text={quote}/></blockquote>)}</div>;
}

export function AutoMailReader({ threadId, messages, onAction, disabled, replyBlocked, forwardBlocked }: { threadId: string; messages: MailMessage[]; onAction?: (message: MailMessage, action: MessageAction) => void; disabled?: boolean; replyBlocked?: string; forwardBlocked?: boolean }) {
  const [plain,setPlain]=useState<string[]>([]);
  const loader=useMemo(()=>createMailAttachmentLoader(threadId),[threadId]);
  useEffect(()=>{
    // Defer disposal so React's development effect replay can reuse the reader.
    const state=loader as typeof loader & {cleanup?:ReturnType<typeof setTimeout>};
    clearTimeout(state.cleanup);
    return()=>{state.cleanup=setTimeout(()=>loader.dispose(),0);};
  },[loader]);
  return <section aria-label="Conversation messages" className="mb-3 mt-2 space-y-2">
    {messages.map((message,index)=><div key={message.id} className="relative flex min-w-0 items-start gap-2 sm:gap-3"><span aria-hidden="true" className={`mt-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${message.outbound?'bg-sky-100 text-sky-700':'bg-indigo-100 text-indigo-700'}`}>{message.from.replace(/["<>]/g,'').slice(0,2).toUpperCase()}</span><details open={index===messages.length-1} className="group/message min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className={`flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 ${message.outbound?'bg-sky-50/60':'bg-slate-50/70'}`}>
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-slate-800">{message.from}</p><p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{message.outbound?<><Reply className="h-3 w-3"/>Sent reply</>:'Incoming message'}<span aria-hidden="true">/</span><time dateTime={message.date}>{new Date(message.date).toLocaleString()}</time>{message.attachments&&<Paperclip className="h-3 w-3"/>}</p></div>
        <span className="flex shrink-0 items-center gap-1"><ChevronDown aria-label="Expand or collapse message" className="h-4 w-4 text-slate-400 transition-transform group-open/message:rotate-180"/>{(onAction||message.html)&&<AutoMailMessageMenu onTogglePlain={message.html?()=>setPlain(current=>current.includes(message.id)?current.filter(id=>id!==message.id):[...current,message.id]):undefined} plain={plain.includes(message.id)} disabled={disabled} forwardBlocked={forwardBlocked} replyBlocked={replyBlocked || message.replyBlocked} onAction={action=>onAction?.(message,action)}/>}</span>
      </summary>
      <div className="min-w-0 px-4 pb-3 pt-1.5"><AutoMailRecipients to={message.to} cc={message.cc} bcc={message.bcc}/>
        {message.html&&!plain.includes(message.id)?<AutoMailHtmlBody html={message.html} messageId={message.id} images={message.inlineImages} loader={loader}/>:<PlainBody text={message.body}/>}
        {!!message.files?.length&&<AutoMailAttachments files={message.files} messageId={message.id} loader={loader}/>}
        {message.attachments&&!message.files?.length&&<p className="mt-4 text-xs text-slate-500">Open this message in Gmail to view its attachments.</p>}
      </div>
    </details></div>)}
  </section>;
}

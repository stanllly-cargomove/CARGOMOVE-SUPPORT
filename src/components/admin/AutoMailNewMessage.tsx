import React, { useEffect, useRef, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { AutoMailComposer, type ReplyUpload } from './AutoMailComposer';
import { knowledgeRequest } from '../../services/autoMailKnowledge';

export function AutoMailNewMessage({mailbox,connectionVersion,schedulerReady,onClose,onDirty,onBusy,onDone}:{mailbox:string;connectionVersion:string;schedulerReady:boolean;onClose:()=>void;onDirty:(dirty:boolean)=>void;onBusy:(busy:boolean)=>void;onDone:(notice:string)=>void}) {
  const [subject,setSubject]=useState(''); const [body,setBody]=useState('');const [html,setHtml]=useState('');
  const [addresses,setAddresses]=useState({to:'',cc:'',bcc:''}); const [files,setFiles]=useState<ReplyUpload[]>([]);
  const [sendAt,setSendAt]=useState('');const [busy,setBusy]=useState(false);const [blocked,setBlocked]=useState(false);const [error,setError]=useState('');
  const id=useRef(crypto.randomUUID());const sending=useRef(false);
  const originalConnection=useRef({mailbox,connectionVersion});
  useEffect(()=>{if(mailbox!==originalConnection.current.mailbox||connectionVersion!==originalConnection.current.connectionVersion){setBlocked(true);setError('The Gmail connection changed. Close this composer and open a new message before sending.');}},[mailbox,connectionVersion]);
  useEffect(()=>{onDirty(!!(subject||body||addresses.to||addresses.cc||addresses.bcc||files.length));},[subject,body,addresses,files]);
  const send=async(schedule:boolean)=>{
    if(sending.current||blocked)return;
    if(!subject.trim()||!addresses.to.trim()){setError('Enter To recipients and a subject.');return;}
    const when=sendAt?new Date(sendAt):null;
    if(schedule&&(!when||!Number.isFinite(when.getTime())||when.getTime()<Date.now()+120000)){setError('Choose a send time at least 2 minutes from now.');return;}
    sending.current=true;setBusy(true);onBusy(true);setError('');
    try {
      const result=await knowledgeRequest<{status:string;warning?:string}>('compose',{requestId:id.current,connectionVersion:originalConnection.current.connectionVersion,subject,body,bodyHtml:html,...addresses,attachmentIds:files.map(file=>file.id),...(schedule?{sendAt:when!.toISOString()}:{})});
      if(result.status==='QUEUED') {onDirty(false);onDone('Message scheduled. View or cancel it in Scheduled.');}
      else if(result.status==='SENT'){onDirty(false);onDone(result.warning||'Message sent through Gmail.');}
      else {setBlocked(true);setError(result.status==='FAILED'?'Delivery stopped before sending. Check the connection and start a new message.':'This request is processing or its outcome is uncertain. Check Gmail Sent. It will not be sent again from this composer.');}
    }catch(reason){
      // Retain the request ID after every error so an ambiguous response cannot cause duplicate delivery.
      setError(reason instanceof Error?reason.message:'Unable to send. Check Gmail Sent before composing again.');
    }finally{sending.current=false;setBusy(false);onBusy(false);}
  };
  return <section aria-label="Compose email" className="p-4 sm:p-6">
    <div className="flex items-center justify-between"><h3 className="font-semibold text-slate-900">Compose email</h3><button type="button" aria-label="Close compose" disabled={busy} onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5"/></button></div>
    {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <AutoMailComposer mode="compose" subject={subject} onSubject={setSubject} body={body} html={html} onChange={(text,html)=>{setBody(text);setHtml(html);}} to={addresses.to} cc={addresses.cc} bcc={addresses.bcc} onRecipients={(field,value)=>setAddresses(current=>({...current,[field]:value}))} replyAll={{to:[],cc:[]}} onReplyAll={()=>{}} mailbox={originalConnection.current.mailbox} files={files} onFiles={setFiles} requestId={id.current} threadId="compose" sourceMessageId="compose" connectionVersion={originalConnection.current.connectionVersion} richReady disabled={busy||blocked} sending={busy} onSend={()=>void send(false)} onBusyChange={value=>{setBusy(value);onBusy(value);}}
      extraActions={<div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-100 pt-3"><label className="text-xs text-slate-500">Send later <input type="datetime-local" aria-label="Scheduled send time" value={sendAt} onChange={event=>setSendAt(event.target.value)} disabled={busy||blocked||!schedulerReady} className="ml-2 rounded-lg border border-slate-200 px-2 py-2 text-sm"/></label><button type="button" disabled={busy||blocked||!schedulerReady||!sendAt||(!body.trim()&&!files.length)} onClick={()=>void send(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 disabled:opacity-50"><Clock className="h-4 w-4"/>Schedule send</button><p className="w-full text-xs text-slate-400">{schedulerReady?`Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Delivery starts on the first worker tick after this time.`:'Scheduled sending needs the background worker setup. You can send now.'}</p></div>}/>
  </section>;
}

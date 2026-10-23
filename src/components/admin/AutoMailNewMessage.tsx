import { AutoMailSnackbar, AutoMailSnackbarArea } from './AutoMailSnackbar';
import React, { useEffect, useRef, useState } from 'react';
import type { MailRecipient } from '../../services/autoMailRecipients';
import { X } from 'lucide-react';
import { AutoMailComposer, type ReplyUpload } from './AutoMailComposer';
import { knowledgeRequest } from '../../services/autoMailKnowledge';
import type { ComposeDraft } from '../../services/autoMailSending';

export function AutoMailNewMessage({mailbox,connectionVersion,schedulerReady,onClose,onDirty,onBusy,onDone,onSubmit,onSnapshot,onDiscarded,initialDraft,initialBlocked=false,contacts=[],signatureScope,onManageSignatures}:{contacts?:MailRecipient[];signatureScope?:string;onManageSignatures?:()=>void;mailbox:string;connectionVersion:string;schedulerReady:boolean;onClose:()=>void;onDirty:(dirty:boolean)=>void;onBusy:(busy:boolean)=>void;onDone:(notice:string)=>void;onSubmit?:(draft:ComposeDraft)=>void;onSnapshot?:(draft:ComposeDraft)=>void;onDiscarded?:(id:string)=>void;initialDraft?:ComposeDraft;initialBlocked?:boolean}) {
  const [subject,setSubject]=useState(initialDraft?.subject||''); const [body,setBody]=useState(initialDraft?.body||'');const [html,setHtml]=useState(initialDraft?.bodyHtml||'');
  const [addresses,setAddresses]=useState({to:initialDraft?.to||'',cc:initialDraft?.cc||'',bcc:initialDraft?.bcc||''}); const [files,setFiles]=useState<ReplyUpload[]>(initialDraft?.files||[]);
  const [busy,setBusy]=useState(false);const [blocked,setBlocked]=useState(initialBlocked);const [error,setError]=useState(initialBlocked?'Check Gmail Sent before composing another copy. This request cannot be resent.':'');
  const id=useRef(initialDraft?.requestId||crypto.randomUUID());const sending=useRef(false);
  const originalConnection=useRef({mailbox:initialDraft?.mailbox||mailbox,connectionVersion:initialDraft?.connectionVersion||connectionVersion});
  useEffect(()=>{if(mailbox!==originalConnection.current.mailbox||connectionVersion!==originalConnection.current.connectionVersion){setBlocked(true);setError('The Gmail connection changed. Close this composer and open a new message before sending.');}},[mailbox,connectionVersion]);
  useEffect(()=>{onDirty(!!(subject||body||addresses.to||addresses.cc||addresses.bcc||files.length));},[subject,body,addresses,files]);
  useEffect(()=>{onSnapshot?.({requestId:id.current,...originalConnection.current,subject,body,bodyHtml:html,...addresses,attachmentIds:files.map(file=>file.id),files});},[subject,body,html,addresses,files]);
  const send=async(schedule:boolean,sendAt='')=>{
    if(sending.current||blocked)return;
    if(!subject.trim()||!addresses.to.trim()){setError('Enter To recipients and a subject.');return;}
    const when=sendAt?new Date(sendAt):null;
    if(schedule&&(!when||!Number.isFinite(when.getTime())||when.getTime()<Date.now()+120000)){setError('Choose a send time at least 2 minutes from now.');return;}
    if(onSubmit){sending.current=true;onDirty(false);onSubmit({requestId:id.current,...originalConnection.current,subject,body,bodyHtml:html,...addresses,attachmentIds:files.map(file=>file.id),files,...(schedule?{sendAt:when!.toISOString()}:{})});return;}
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
    {error&&<AutoMailSnackbarArea><AutoMailSnackbar key={error} alert onDismiss={()=>setError('')}>{error}</AutoMailSnackbar></AutoMailSnackbarArea>}
    <AutoMailComposer onDiscard={()=>{onDiscarded?.(id.current);onDirty(false);onDone('Draft discarded.');}} contacts={contacts} signatureScope={signatureScope} onManageSignatures={onManageSignatures} schedulerReady={schedulerReady} onSchedule={when=>void send(true,when)} mode="compose" subject={subject} onSubject={setSubject} body={body} html={html} onChange={(text,html)=>{setBody(text);setHtml(html);}} to={addresses.to} cc={addresses.cc} bcc={addresses.bcc} onRecipients={(field,value)=>setAddresses(current=>({...current,[field]:value}))} replyAll={{to:[],cc:[]}} onReplyAll={()=>{}} mailbox={originalConnection.current.mailbox} files={files} onFiles={setFiles} requestId={id.current} threadId="compose" sourceMessageId="compose" connectionVersion={originalConnection.current.connectionVersion} richReady disabled={busy||blocked} sending={busy} onSend={()=>void send(false)} onBusyChange={value=>{setBusy(value);onBusy(value);}}
/>
  </section>;
}

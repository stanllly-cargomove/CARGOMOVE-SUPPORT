import { blockMailDraft,removeMailDraft } from './autoMailDrafts';
import toast from 'react-hot-toast';
import { clearMailSession, expireMail, onMailSessionCleared } from './autoMailCache';

export type ComposeDraft={requestId:string;connectionVersion:string;mailbox:string;subject:string;body:string;bodyHtml:string;to:string;cc:string;bcc:string;attachmentIds:string[];files:{id:string;name:string;type:string;size:number}[];sendAt?:string};
export type MailSendTask={id:string;scope:string;draft:ComposeDraft;state:'SENDING'|'SENT'|'QUEUED'|'ERROR';error?:string;canEdit?:boolean};
const mailToast = {position:'bottom-left' as const, style:{background:'#323232',color:'#fff',borderRadius:'6px',padding:'12px 16px'},icon:null};
let tasks:MailSendTask[]=[];
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(fn=>fn());
export const subscribeMailSends=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const mailSendSnapshot=()=>tasks;
export function dismissMailSend(id:string) {tasks=tasks.filter(task=>task.id!==id);emit();}
onMailSessionCleared(()=>{tasks.forEach(task=>toast.dismiss('mail-send-'+task.id));tasks=[];emit();});
export function startMailSend(scope:string,draft:ComposeDraft) {
  if(tasks.some(task=>task.id===draft.requestId&&(task.state!=='ERROR'||!task.canEdit)))return;
  try{blockMailDraft(scope,draft.connectionVersion,draft.requestId,true);}catch{}
  const task:MailSendTask={id:draft.requestId,scope,draft,state:'SENDING'};
  tasks=[...tasks.filter(item=>item.id!==task.id&&item.state!=='SENT'&&item.state!=='QUEUED'),task];emit();
  const toastId='mail-send-'+task.id;toast.loading(draft.sendAt?'Scheduling message…':'Sending message…',{...mailToast,id:toastId});
  // This request is deliberately owned by the session, not the composer/component lifecycle.
  void (async()=>{
    try {
      const {files,mailbox,...payload}=draft;
      const response=await fetch('/api/auto-mail/compose',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json().catch(()=>({}));
      if(!tasks.includes(task))return;
      if(response.status===401){clearMailSession();toast.error('Your session expired. Sign in again and check Gmail Sent.',mailToast);return;}
      if(!response.ok)throw Object.assign(new Error(result.error||'Check Gmail Sent before trying again.'),{canEdit:result.canEditReply===true});
      if(!['SENT','QUEUED'].includes(result.status))throw new Error(result.status==='FAILED'?'Delivery stopped before sending. Check the connection and Gmail Sent.':'Delivery is processing or uncertain. Check Gmail Sent; do not resend.');
      try{removeMailDraft(scope,draft.connectionVersion,draft.requestId);}catch{}
      task.state=result.status;
      task.error=result.warning;
      expireMail(scope,'threads');expireMail(scope,'outbox');
      toast.success(result.warning||(result.status==='SENT'?'Message sent through Gmail.':draft.sendAt?'Message scheduled.':'Message queued for sending.'),{...mailToast,id:toastId,duration:6000});
      tasks=[...tasks];emit();
    } catch(reason) {
      if(!tasks.includes(task))return;
      task.state='ERROR';task.error=reason instanceof Error?reason.message:'Send outcome is uncertain. Check Gmail Sent.';
      task.canEdit=!!reason&&typeof reason==='object'&&'canEdit' in reason&&reason.canEdit===true;
      try{blockMailDraft(scope,draft.connectionVersion,draft.requestId,!task.canEdit);}catch{}
      toast.error(task.error,{...mailToast,id:toastId,duration:10000});tasks=[...tasks];emit();
    }
  })();
}

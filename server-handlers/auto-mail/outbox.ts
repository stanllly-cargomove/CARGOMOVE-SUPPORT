import crypto from 'node:crypto';
import { bodyOf, noStore, requireAdmin } from '../_email.js';
import { autoMailClient, autoMailConfiguration } from './configuration.js';
import { accessToken, checkOrigin, connected, googleJson, gmailGet, replyContext, SEND_SCOPE, singleAddress } from './gmail.js';
import { cleanMailHtml, mailHtmlText, replyRecipients, addressList, richRawReply } from './mail-content.js';
import { loadReplyFiles } from './file-storage.js';
import { recordAcceptedReply } from './delivery-receipt.js';
import { MailError } from './mail-error.js';

const BUCKET='auto-mail-outbox';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=(data:Buffer)=>crypto.createHash('sha256').update(data).digest('hex');
export async function workerReady(client:any) {
  if(!process.env.AUTO_MAIL_SCHEDULER_SECRET || process.env.AUTO_MAIL_SCHEDULER_SECRET.length<32)return false;
  const result=await client.from('outbox_worker_state').select('last_seen').eq('id','system').maybeSingle();
  return !result.error && Date.parse(result.data?.last_seen)>Date.now()-5*60*1000;
}

export async function deliverOutbox(client:any,job:any) {
  // Claiming is durable before any provider send; concurrent requests cannot send twice.
  let token:string, raw:string;
  try {
    const connection=await connected(client);
    if(connection.mailbox_id!==job.mailbox_id||connection.version!==job.connection_version||!connection.scopes.includes(SEND_SCOPE))throw new Error('Mailbox connection changed. Cancel and compose again.');
    const download=await client.storage.from(BUCKET).download(job.raw_path);
    if(download.error||!download.data)throw new Error('Prepared message is unavailable.');
    const bytes=Buffer.from(await download.data.arrayBuffer());
    if(hash(bytes)!==job.raw_sha256)throw new Error('Prepared message failed its integrity check.');
    raw=bytes.toString('base64url'); token=await accessToken(connection);
    if(job.reply_context){const context=job.reply_context;const current=await gmailGet(token,`threads/${encodeURIComponent(context.threadId)}?format=full`);if(replyContext(current,connection.email,context.sourceMessageId).recipient!==context.recipient)throw new Error('Reply recipient changed');if(context.aiDraftId){const checked=await client.rpc('validate_ai_draft',{p_id:context.aiDraftId,p_actor:context.actorId});if(checked.error)throw new Error('AI draft changed');}}

  }catch {
    const saved=await client.rpc('finish_outbox_message',{p_id:job.id,p_status:'FAILED',p_error:'Delivery stopped before sending. Mailbox access changed or prepared content is unavailable. Compose again after checking the connection.'});
    if(saved.error)throw new MailError(503,'Delivery stopped before sending, but its status could not be saved. Check Scheduled and Gmail Sent.');
    return {status:'FAILED',id:job.id};
  }
  let sent:any;
  try {
    sent=await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw,...(job.reply_context?{threadId:job.reply_context.threadId}:{})})});
    if(!sent.id)throw new Error('Missing receipt');
  }catch {
    await client.rpc('finish_outbox_message',{p_id:job.id,p_status:'UNCERTAIN',p_error:'Gmail may have accepted this message. Check Sent; this request will never be retried automatically.'});
    return {status:'UNCERTAIN',id:job.id};
  }
  const receipt=job.reply_context?await recordAcceptedReply(client,job.id,job.actor_id,sent.id):null;
  const saved=await client.rpc('finish_outbox_message',{p_id:job.id,p_status:'SENT',p_message_id:sent.id,p_thread_id:sent.threadId||null});
  return {status:'SENT',id:job.id,...((saved.error||receipt&&!receipt.saved)?{warning:'Gmail accepted the message, but its local receipt could not be saved. Do not resend.'}:{})};
}

export function outboxHandler(action:'compose'|'list'|'cancel') {
  return async(request:any,response:any)=>{
    noStore(response); const session=requireAdmin(request,response);if(!session)return;
    if(request.method!==(action==='list'?'GET':'POST'))return response.status(405).json({error:'Method not allowed.'});
    try {
      if(action!=='list')checkOrigin(request);
      const config=autoMailConfiguration();if(!config.ready)throw new MailError(503,config.message);
      const client=autoMailClient(config);const connection=await connected(client);
      if(action==='list') {
        const offset=Number(request.query?.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new MailError(400,'Invalid scheduled page.');
        const result=await client.from('outbox_messages').select('id,subject,to_addresses,cc_addresses,bcc_addresses,attachments,send_at,status,error,created_at,gmail_thread_id').eq('mailbox_id',connection.mailbox_id).eq('scheduled',true).order('send_at',{ascending:false}).range(offset,offset+24);
        if(result.error)throw new MailError(503,'Apply the compose/outbox migration in the separate Auto Mail database.');
        return response.json({messages:result.data,nextOffset:result.data.length===25?offset+25:null,workerReady:await workerReady(client)});
      }
      const body:any=await bodyOf(request);
      if(!uuid.test(body.requestId||body.id||''))throw new MailError(400,'Invalid compose request.');
      if(body.connectionVersion!==connection.version)throw new MailError(409,'The connected mailbox changed. Reopen Compose.');
      if(action==='cancel') {
        const result=await client.rpc('cancel_outbox_message',{p_id:body.id,p_mailbox:connection.mailbox_id});
        if(result.error)throw new MailError(409,'This message has started sending or was already cancelled. Refresh Scheduled.');
        return response.json({status:'CANCELLED'});
      }
      const id=body.requestId;
      const existing=await client.from('outbox_messages').select('id,status,actor_id,mailbox_id,scheduled').eq('id',id).maybeSingle();
      if(existing.error)throw new MailError(503,'Apply the compose/outbox migration in the separate Auto Mail database.');
      if(existing.data) {
        if(existing.data.actor_id!==session.id||existing.data.mailbox_id!==connection.mailbox_id)throw new MailError(409,'Compose request is unavailable.');
        // A retry never changes or resends a previously accepted request.
        return response.json({id,status:existing.data.status});
      }
      const primary=addressList(body.to,'To')[0];if(!primary)throw new MailError(400,'Enter at least one To recipient.');
      const recipients=replyRecipients(body,primary,connection.email);
      const subject=typeof body.subject==='string'?body.subject.trim():'';
      const html=typeof body.bodyHtml==='string'?cleanMailHtml(body.bodyHtml):'';
      const text=html?mailHtmlText(html):typeof body.body==='string'?body.body.trim():'';
      if(!subject||subject.length>998||/[\r\n]/.test(subject)||text.length>50000||(body.bodyHtml?.length||0)>200000||(!text&&!body.attachmentIds?.length))throw new MailError(400,'Enter a subject and message or attachment. Subject: up to 998 characters; message: up to 50,000.');
      if(!connection.scopes.includes(SEND_SCOPE))throw new MailError(409,'Reconnect Gmail with sending permission.');
      const scheduled=body.sendAt!=null;
      if(scheduled&&typeof body.sendAt!=='string')throw new MailError(400,'Choose a valid send time.');
      const when=scheduled?Date.parse(body.sendAt):Date.now();
      if(!Number.isFinite(when)||(scheduled&&(when<Date.now()+120000||when>Date.now()+90*86400000)))throw new MailError(400,'Choose a send time between 2 minutes and 90 days from now.');
      if(scheduled&&!await workerReady(client))throw new MailError(409,'Scheduled sending is not ready. Configure the background worker and wait for its first heartbeat.');
      const files=await loadReplyFiles(client,body.attachmentIds,{id,actor:session.id,connection,threadId:'compose',sourceMessageId:'compose'});
      const safeHtml=html||cleanMailHtml('<p>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n','<br>')+'</p>');
      const raw=Buffer.from(richRawReply(singleAddress(connection.email),{subject,messageId:'',references:'',compose:true},recipients,text,safeHtml,files,id),'base64url');
      const path=`prepared/${connection.mailbox_id}/${id}.eml`;
      const stored=await client.storage.from(BUCKET).upload(path,raw,{contentType:'application/octet-stream',upsert:false});
      if(stored.error)throw new MailError(409,'Could not prepare this message. Refresh Scheduled or Sent before trying a new compose request.');
      const inserted=await client.from('outbox_messages').insert({id,actor_id:session.id,mailbox_id:connection.mailbox_id,connection_version:connection.version,subject,to_addresses:recipients.to,cc_addresses:recipients.cc,bcc_addresses:recipients.bcc,body_text:text,attachments:files.map(({id,name,type,size})=>({id,name,type,size})),raw_path:path,raw_sha256:hash(raw),scheduled,send_at:new Date(when).toISOString()});
      if(inserted.error)throw new MailError(409,'Message preparation could not be confirmed. Check Scheduled and Sent before composing again.');
      if(scheduled)return response.json({status:'QUEUED',id});
      const claimed=await client.rpc('claim_outbox_message',{p_id:id});
      if(claimed.error||!claimed.data)throw new MailError(409,'This send request is already being processed. Check Gmail Sent.');
      return response.json(await deliverOutbox(client,claimed.data));
    }catch(error){const status=error instanceof MailError?error.status:503;return response.status(status).json({error:error instanceof MailError?error.message:'Unable to complete the compose request.',...(status===400?{canEditReply:true}:{})});}
  };
}
export const composeMessage=outboxHandler('compose');
export const listOutbox=outboxHandler('list');
export const cancelOutbox=outboxHandler('cancel');

export async function runOutbox(request:any,response:any) {
  noStore(response);
  if(!['POST','GET'].includes(request.method))return response.status(405).json({error:'Method not allowed.'});
  const secret=process.env.AUTO_MAIL_SCHEDULER_SECRET||'';
  const received=typeof request.headers?.authorization==='string'?request.headers.authorization:'';
  const expected='Bearer '+secret;
  if(secret.length<32||Buffer.byteLength(received)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return response.status(401).json({error:'Authentication required.'});
  try {
    const config=autoMailConfiguration();if(!config.ready)throw new Error('Not configured');
    const client=autoMailClient(config);
    if((await client.rpc('outbox_worker_heartbeat')).error)throw new Error('Missing migration');
    const claim=await client.rpc('claim_outbox_message');if(claim.error)throw new Error('Claim failed');
    if(!claim.data)return response.json({processed:0});
    const result=await deliverOutbox(client,claim.data);return response.json({processed:1,status:result.status});
  }catch{return response.status(503).json({error:'Scheduled worker could not complete this tick. Check configuration and migration.'});}
}

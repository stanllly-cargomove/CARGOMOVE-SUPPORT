import crypto from 'node:crypto';
import {workerReady} from './outbox.js';
import {MailError} from './mail-error.js';
export async function queueScheduledReply(client:any,connection:any,body:any,delivery:any,detail:any,raw:string){
  const when=typeof body.sendAt==='string'?Date.parse(body.sendAt):NaN;
  if(!Number.isFinite(when)||when<Date.now()+120000||when>Date.now()+90*86400000)throw new MailError(400,'Choose a send time between 2 minutes and 90 days from now.');
  if(!await workerReady(client))throw new MailError(409,'Scheduled sending is not ready. Wait for the background worker to resume.');
  const probe=await client.from('outbox_messages').select('reply_context').limit(1);
  if(probe.error)throw new MailError(503,'Apply the scheduled replies migration in the Auto Mail database, then refresh.');
  const bytes=Buffer.from(raw,'base64url');const path=`prepared/${connection.mailbox_id}/${delivery.id}.eml`;
  const stored=await client.storage.from('auto-mail-outbox').upload(path,bytes,{contentType:'application/octet-stream',upsert:false});
  if(stored.error)throw new MailError(409,'Message preparation could not be confirmed. Check Scheduled before retrying.');
  const result=await client.rpc('queue_scheduled_reply',{p_delivery:delivery,p_detail:detail,p_job:{raw_path:path,raw_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),send_at:new Date(when).toISOString(),reply_context:{threadId:delivery.gmail_thread_id,sourceMessageId:delivery.source_message_id,recipient:delivery.recipient,actorId:delivery.requested_by,aiDraftId:delivery.ai_draft_id}}});
  if(result.error)throw new MailError(409,'This reply could not be scheduled. Check Scheduled and Gmail Sent before trying again.');
  return {status:'QUEUED',id:delivery.id};
}

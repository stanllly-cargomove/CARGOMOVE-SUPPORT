import {verifiedMailFileType} from '../../shared/autoMailFiles.js';
import crypto from 'node:crypto';
import { bodyOf, noStore, requireAdmin } from '../_email.js';
import { autoMailClient, autoMailConfiguration } from './configuration.js';
import { accessToken, checkOrigin, connected, gmailGet } from './gmail.js';
import { ATTACHMENT_BUCKET, MAX_ATTACHMENT_BYTES, fileParts } from './mail-content.js';
import { uploadMetadata } from './file-storage.js';
import { MailError } from './mail-error.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const gmailId=/^[a-zA-Z0-9_-]{1,128}$/;
export function createAttachmentHandler(action:'upload'|'read'|'remove') {
  return async(request:any,response:any)=>{
    noStore(response);
    const session=requireAdmin(request,response); if(!session)return;
    if(request.method!==(action==='read'?'GET':'POST'))return response.status(405).json({error:'Method not allowed.'});
    try{
      if(action!=='read')checkOrigin(request);
      const config=autoMailConfiguration(); if(!config.ready)throw new MailError(503,config.message);
      const client=autoMailClient(config);const connection=await connected(client);
      if(action==='upload'){
        const input=await bodyOf(request);const meta=uploadMetadata(input);
        if(!uuid.test(String(input.requestId))||!gmailId.test(String(input.threadId))||!gmailId.test(String(input.sourceMessageId))||input.connectionVersion!==connection.version)throw new MailError(409,'Reload the conversation before attaching files.');
        const existing=await client.from('reply_uploads').select('size').eq('request_id',input.requestId).eq('actor_id',session.id);
        if(existing.error)throw new MailError(503,'Apply the rich replies migration in the separate Auto Mail database to enable attachments.');
        if(existing.data.length>=10||existing.data.reduce((sum:number,file:any)=>sum+file.size,0)+meta.size>MAX_ATTACHMENT_BYTES)throw new MailError(400,'Use up to 10 files and 15 MB in total. Remove unused attachments first.');
        const id=crypto.randomUUID();const path=`outgoing/${session.id}/${input.requestId}/${id}`;
        const inserted=await client.from('reply_uploads').insert({id,request_id:input.requestId,actor_id:session.id,mailbox_id:connection.mailbox_id,connection_version:connection.version,gmail_thread_id:input.threadId,source_message_id:input.sourceMessageId,path,...meta});
        if(inserted.error)throw new MailError(503,'Unable to register the attachment. Try again.');
        const signed=await client.storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(path);
        if(signed.error) { await client.from('reply_uploads').delete().eq('id',id); throw new MailError(503,'Attachment storage is unavailable. Check the rich replies migration.'); }
        return response.json({id,name:meta.name,type:meta.mime_type,size:meta.size,uploadUrl:signed.data.signedUrl});
      }
      if(action==='remove'){
        const input=await bodyOf(request);if(!uuid.test(String(input.id)))throw new MailError(400,'Invalid attachment.');
        const row=await client.from('reply_uploads').select('*').eq('id',input.id).eq('actor_id',session.id).maybeSingle();
        if(row.error||!row.data||row.data.mailbox_id!==connection.mailbox_id)throw new MailError(404,'Attachment was not found.');
        const delivery=await client.from('reply_deliveries').select('id').eq('id',row.data.request_id).maybeSingle();
        if(delivery.error||delivery.data)throw new MailError(409,'Attachments cannot be removed after a send request.');
        if(row.data.gmail_thread_id==='compose') {
          const outbox=await client.from('outbox_messages').select('id').eq('id',row.data.request_id).maybeSingle();
          if(outbox.error||outbox.data)throw new MailError(409,'Attachments cannot be removed after submitting this composed message.');
        }
        if((await client.storage.from(ATTACHMENT_BUCKET).remove([row.data.path])).error)throw new MailError(503,'Unable to remove the attachment. Try again.');
        if((await client.from('reply_uploads').delete().eq('id',row.data.id)).error)throw new MailError(503,'Unable to remove the attachment record.');
        return response.json({removed:true});
      }
      const threadId=String(request.query?.threadId||'');const messageId=String(request.query?.messageId||'');const partId=String(request.query?.partId||'');
      if(!gmailId.test(threadId)||!gmailId.test(messageId)||partId.length>200||!partId)throw new MailError(400,'Invalid message attachment.');
      const token=await accessToken(connection);const thread=await gmailGet(token,`threads/${threadId}?format=full`);
      const message=(thread.messages||[]).find((m:any)=>m.id===messageId);const file=message&&fileParts(message.payload||{}).find(f=>f.partId===partId);
      if(!file)throw new MailError(404,'This attachment does not belong to the selected conversation.');
      if(file.size>MAX_ATTACHMENT_BYTES)throw new MailError(400,'Open Gmail to download attachments larger than 15 MB.');
      const result=file.data?{data:file.data}:await gmailGet(token,`messages/${messageId}/attachments/${encodeURIComponent(file.attachmentId)}`);
      if(typeof result.data!=='string'||result.data.length>MAX_ATTACHMENT_BYTES*1.4)throw new MailError(502,'The attachment could not be loaded. Open it in Gmail.');
      const data=Buffer.from(result.data,'base64url');if(data.length>MAX_ATTACHMENT_BYTES)throw new MailError(400,'Open Gmail for this large attachment.');
      // Only a small set of verified formats can be previewed. Everything else downloads.
      const type=verifiedMailFileType(data,file.name);
      const path=`incoming/${connection.mailbox_id}/${messageId}/${crypto.createHash('sha256').update(partId).digest('hex')}`;
      const uploaded=await client.storage.from(ATTACHMENT_BUCKET).upload(path,data,{contentType:type,upsert:true});
      if(uploaded.error)throw new MailError(503,'Attachment storage is unavailable. Apply the rich replies migration, or open the attachment in Gmail.');
      const signed=await client.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path,300,{download:request.query?.download==='1'?file.name:false});
      if(signed.error)throw new MailError(503,'Unable to create an attachment link.');
      return response.json({url:signed.data.signedUrl,name:file.name,type,size:data.length,previewable:type!=='application/octet-stream'});
    }catch(error){return response.status(error instanceof MailError?error.status:503).json({error:error instanceof MailError?error.message:'Unable to complete the attachment request.'});}
  };
}
export const attachmentUpload=createAttachmentHandler('upload');
export const attachmentRead=createAttachmentHandler('read');
export const attachmentRemove=createAttachmentHandler('remove');

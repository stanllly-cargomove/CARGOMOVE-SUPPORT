import crypto from 'node:crypto';
import { ATTACHMENT_BUCKET, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, ReplyFile, safeFilename } from './mail-content.js';
import { MailError } from './mail-error.js';

const types: Record<string,string> = { pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',txt:'text/plain',csv:'text/csv',zip:'application/zip',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
export function uploadMetadata(input: any) {
  const name = typeof input.name === 'string' ? safeFilename(input.name) : '';
  const type = types[name.split('.').at(-1)?.toLowerCase() || ''];
  if (!name || !type || !Number.isSafeInteger(input.size) || input.size<1 || input.size>MAX_ATTACHMENT_BYTES) throw new MailError(400, 'Use PDF, images, Office documents, text, CSV or ZIP files, up to 15 MB in total.');
  return { name, mime_type: type, size: input.size };
}
export async function loadReplyFiles(client: any, ids: unknown, context: { id: string; actor: string; connection: any; threadId: string; sourceMessageId: string }) {
  if (ids == null) return [];
  if (!Array.isArray(ids) || ids.length>MAX_ATTACHMENTS || new Set(ids).size!==ids.length || ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))) throw new MailError(400, 'Invalid reply attachments.');
  if (!ids.length) return [];
  const result = await client.from('reply_uploads').select('*').in('id',ids).eq('actor_id',context.actor);
  if (result.error || result.data?.length!==ids.length) throw new MailError(409, 'Reply attachments are unavailable. Remove them and upload again.');
  if (result.data.reduce((sum:number,row:any)=>sum+row.size,0)>MAX_ATTACHMENT_BYTES) throw new MailError(400, 'Attachments must be 15 MB or smaller in total.');
  return Promise.all(result.data.map(async(row:any):Promise<ReplyFile & {path:string;sha256:string}>=>{
    if (row.request_id!==context.id || row.mailbox_id!==context.connection.mailbox_id || row.connection_version!==context.connection.version
      || row.gmail_thread_id!==context.threadId || row.source_message_id!==context.sourceMessageId || Date.parse(row.expires_at)<=Date.now()) throw new MailError(409, 'Attachment context changed or expired. Upload it again for this reply.');
    const downloaded = await client.storage.from(ATTACHMENT_BUCKET).download(row.path);
    if (downloaded.error || !downloaded.data || downloaded.data.size!==row.size) throw new MailError(409, 'An attachment is incomplete or changed. Remove it and upload again.');
    const data = Buffer.from(await downloaded.data.arrayBuffer());
    return {id:row.id,name:row.name,type:row.mime_type,size:data.length,path:row.path,sha256:crypto.createHash('sha256').update(data).digest('hex'),data};
  }));
}

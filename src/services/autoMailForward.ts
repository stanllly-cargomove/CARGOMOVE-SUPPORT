import { knowledgeRequest } from './autoMailKnowledge';
import { browserMailHtml, plainMailHtml } from './autoMailFormatting';
import type { ComposeDraft } from './autoMailSending';
import type { MailMessage } from '../components/admin/AutoMailReader';
import type { ReplyUpload } from '../components/admin/AutoMailComposer';

export async function prepareMailForward(thread:{id:string;subject:string;mailbox:string;connectionVersion:string;messages:MailMessage[]}) {
  const message=thread.messages.at(-1);
  if(!message)throw new Error('There is no message to forward.');
  const requestId=crypto.randomUUID();
  const headers=`---------- Forwarded message ---------\nFrom: ${message.from}\nDate: ${message.date}\nSubject: ${thread.subject}\nTo: ${message.to}${message.cc?`\nCc: ${message.cc}`:''}`;
  const files:ReplyUpload[]=[];const missing:string[]=[];
  for(const file of message.files||[]) {
    let registered:ReplyUpload&{uploadUrl:string}|undefined;
    try {
      if(files.length>=10||files.reduce((sum,item)=>sum+item.size,0)+file.size>15*1024*1024)throw new Error('Attachment limit');
      const download=await knowledgeRequest<{url:string}>(`attachment?${new URLSearchParams({threadId:thread.id,messageId:message.id,partId:file.partId,download:'1'})}`);
      const source=await fetch(download.url,{credentials:'omit'});
      if(!source.ok)throw new Error('Unable to download attachment');
      const bytes=await source.blob();
      if(bytes.size>15*1024*1024)throw new Error('Attachment limit');
      registered=await knowledgeRequest<ReplyUpload&{uploadUrl:string}>('attachment-upload',{name:file.name,size:bytes.size,requestId,threadId:'compose',sourceMessageId:'compose',connectionVersion:thread.connectionVersion});
      const uploaded=await fetch(registered.uploadUrl,{method:'PUT',headers:{'Content-Type':registered.type,'x-upsert':'false','cache-control':'max-age=0'},body:bytes,credentials:'omit'});
      if(!uploaded.ok)throw new Error('Unable to copy attachment');
      files.push({id:registered.id,name:registered.name,type:registered.type,size:registered.size});
    }catch{if(registered)await knowledgeRequest('attachment-remove',{id:registered.id}).catch(()=>{});missing.push(file.name);}
  }
  const draft:ComposeDraft={requestId,mailbox:thread.mailbox,connectionVersion:thread.connectionVersion,subject:/^fwd?:/i.test(thread.subject)?thread.subject:`Fwd: ${thread.subject}`,to:'',cc:'',bcc:'',body:`\n\n${headers}\n\n${message.body}`,bodyHtml:`<p><br></p>${plainMailHtml(headers)}<blockquote>${browserMailHtml(message.html||plainMailHtml(message.body))}</blockquote>`,files,attachmentIds:files.map(file=>file.id)};
  const warning=missing.length?`These attachments could not be copied: ${missing.join(', ')}. Attach them manually before forwarding.`:message.attachments&&!message.files?.length?'Original attachments are unavailable here. Download them from Gmail and attach them before forwarding.':'';
  return {draft,warning};
}

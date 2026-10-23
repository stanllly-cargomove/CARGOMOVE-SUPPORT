import crypto from 'node:crypto';
import sanitize from './vendor/sanitize-html.cjs';
import { convert } from 'html-to-text';
import addresses from 'email-addresses';
import { MailError } from './mail-error.js';

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const ATTACHMENT_BUCKET = 'auto-mail-attachments';
export const htmlTags = ['p','div','span','br','b','strong','i','em','u','s','strike','ul','ol','li','blockquote','h1','h2','h3','h4','hr','pre','code','a','table','thead','tbody','tfoot','tr','td','th','caption','sub','sup','font','img'];

const spacingValue='(?:0(?:cm|in)?|(?:[0-9]|[1-4][0-9])(?:\\.\\d{1,2})?(?:px|pt)|(?:[0-3](?:\\.\\d{1,2})?|\\.\\d{1,2})(?:em|rem))';
const verticalSpacing=new RegExp('^'+spacingValue+'$');
const marginSpacing=new RegExp('^'+spacingValue+'(?:\\s+'+spacingValue+'){0,3}$');
export function cleanMailHtml(value: string) {
  return sanitize(value.slice(0, 200000), {
    allowedTags: htmlTags, allowedAttributes: { '*':['style'],font:['color','face','size'], img:['data-mail-image','alt','width','height'], a: ['href','target','rel'], td: ['colspan','rowspan'], th: ['colspan','rowspan'] },
    allowedStyles: { '*': { 'margin':[marginSpacing], 'margin-top':[verticalSpacing], 'margin-bottom':[verticalSpacing], color: [/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20}|rgba?\([0-9.,% ]+\))$/], 'background-color': [/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20}|rgba?\([0-9.,% ]+\))$/], 'text-align': [/^(left|right|center|justify)$/], 'font-size': [/^(?:[1-9]|[1-6][0-9])px$|^(small|medium|large|x-large|xx-large)$/], 'font-family': [/^[a-zA-Z ,"'-]{1,80}$/] } },
    allowedSchemes: ['http','https','mailto','tel'], allowProtocolRelative: false,
    transformTags: { img:(_tag,attrs)=>{const ref=String(attrs.src||attrs['data-mail-image']||'').trim();const attribs:Record<string,string>={alt:String(attrs.alt||'Email image').slice(0,300)};if(ref&&ref.length<=2048&&!/^(?:data|javascript|file|blob):/i.test(ref)&&!ref.startsWith('//'))attribs['data-mail-image']=ref;for(const dimension of ['width','height'])if(/^\d{1,4}$/.test(attrs[dimension]||''))attribs[dimension]=String(Math.min(1200,Number(attrs[dimension])));return {tagName:'img',attribs};}, a: (_tag, attrs) => ({ tagName: 'a', attribs: { ...attrs, target: '_blank', rel: 'noopener noreferrer nofollow' } }) },
    nonTextTags: ['script','style','textarea','option','iframe','object','template','noscript'],
  });
}
export function mailHtmlText(value: string) {
  return convert(value, { wordwrap: false, selectors: [{ selector: 'a', options: { hideLinkHrefIfSameAsText: true } }, { selector: 'img', format: 'skip' }, { selector: 'h1', options: { uppercase: false } }, { selector: 'h2', options: { uppercase: false } }, { selector: 'h3', options: { uppercase: false } }] }).trim();
}
export function safeFilename(value: string) {
  const safe=value.replace(/[\x00-\x1f\x7f/\\]/g,'_').trim();const characters=Array.from(safe);
  if(characters.length<=180)return safe||'attachment';
  const extension=safe.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0]||'';
  return characters.slice(0,180-extension.length).join('')+extension;
}
export function addressList(value: unknown, label = 'recipient'): string[] {
  if (value == null || value === '') return [];
  const text = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  if (!text || text.length > 10000 || /[\r\n\x00]/.test(text)) throw new MailError(400, `Check the ${label} addresses.`);
  const parsed = addresses.parseAddressList(text);
  if (!parsed) throw new MailError(400, `Check the ${label} addresses.`);
  const result: string[] = [];
  for (const entry of parsed) {
    const values = entry.type === 'group' ? entry.addresses : [entry];
    for (const mailbox of values) {
      const email = mailbox.address.toLowerCase();
      if (email.length>254 || email.split('@')[0].length>64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) throw new MailError(400, `Check the ${label} addresses.`);
      if (!result.includes(email)) result.push(email);
    }
  }
  if (result.length > 30) throw new MailError(400, 'Use no more than 30 recipients in total.');
  return result;
}
export function replyRecipients(body: Record<string, unknown>, primary: string, _mailbox: string) {
  const to = addressList(body.to ?? primary, 'To');
  const cc = addressList(body.cc, 'CC').filter(value => !to.includes(value));
  const bcc = addressList(body.bcc, 'BCC').filter(value => !to.includes(value) && !cc.includes(value));
  if (!to.includes(primary) || to.length+cc.length+bcc.length > 30) throw new MailError(400, 'Keep the original reply recipient in To and use at most 30 recipients.');
  return { to, cc, bcc };
}
export function fileParts(part: any, path = '0'): any[] {
  const header=(name:string)=>String(part.headers?.find((item:any)=>String(item.name).toLowerCase()===name)?.value||'');
  const contentId=header('content-id').trim().replace(/^<|>$/g,'');const contentLocation=header('content-location').trim();const disposition=header('content-disposition').split(';')[0].trim().toLowerCase();
  const file = part.filename || ((part.body?.attachmentId||part.body?.data) && !['text/plain','text/html'].includes(part.mimeType)&&!String(part.mimeType).startsWith('multipart/'));
  return [...(file ? [{ partId: part.partId || path, name: safeFilename(part.filename || 'attachment'), type: part.mimeType || 'application/octet-stream', size: Number(part.body?.size || 0), contentId,contentLocation,disposition,attachmentId: part.body?.attachmentId, data: part.body?.data }] : []), ...(part.parts || []).flatMap((p: any, i: number) => fileParts(p, `${path}.${i}`))];
}
export function normalizeImageReference(value:string){try{return decodeURIComponent(value.trim().replace(/^cid:/i,'').replace(/^<|>$/g,''));}catch{return value.trim().replace(/^cid:/i,'');}}
export function embeddedImageParts(html:string,files:any[]){
  const refs=[...html.matchAll(/data-mail-image="([^"]*)"/g)].map(match=>normalizeImageReference(convert(match[1],{wordwrap:false})));
  return files.filter(file=>/^image\/(png|jpeg|gif|webp)$/i.test(file.type)&&refs.some(ref=>[file.contentId,file.contentLocation,...(file.disposition==='inline'?[file.name]:[])].filter(Boolean).some(value=>normalizeImageReference(value).toLowerCase()===ref.toLowerCase()))).slice(0,30);
}
export function messageBodies(part: any): { text: string; html: string } {
  if (part.filename) return { text: '', html: '' };
  const data = part.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8') : '';
  if (part.mimeType === 'text/plain') return { text: data, html: '' };
  if (part.mimeType === 'text/html') { const html = cleanMailHtml(data); return { text: '', html }; }
  const children = (part.parts || []).map(messageBodies);
  return { text: children.map((p: any) => p.text).filter(Boolean).join('\n'), html: children.map((p: any) => p.html).filter(Boolean).join('\n') };
}
export type ReplyFile = { id: string; name: string; type: string; size: number; data: Buffer };
const base64 = (value: string | Buffer) => Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
function mimeSubject(subject:string){
  const chunks:string[]=[];let chunk='';
  for(const character of subject){if(Buffer.byteLength(chunk+character)>42){chunks.push(chunk);chunk=character;}else chunk+=character;}
  if(chunk)chunks.push(chunk);
  return chunks.map(value=>`=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`).join('\r\n ');
}
function mimeFilename(name:string){
  const safe=safeFilename(name);const encoded=encodeURIComponent(safe).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  const tokens=encoded.match(/%[0-9A-F]{2}|./g)||[];const segments:string[]=[];let chunk='';
  for(const token of tokens){if(chunk.length+token.length>48){segments.push(chunk);chunk=token;}else chunk+=token;}if(chunk)segments.push(chunk);
  const extended=segments.length===1?`filename*=UTF-8''${segments[0]}`:segments.map((value,index)=>`filename*${index}*=${index===0?"UTF-8''":''}${value}`).join(';\r\n ');
  return `filename="${safe.replace(/[^a-zA-Z0-9._ -]/g,'_')}";\r\n ${extended}`;
}
export function richRawReply(email: string, context: { subject: string; messageId: string; references: string; compose?: boolean }, recipients: ReturnType<typeof replyRecipients>, text: string, html: string, files: ReplyFile[], id: string) {
  const alt = `auto_alt_${crypto.randomBytes(16).toString('hex')}`;
  const mixed = `auto_mix_${crypto.randomBytes(16).toString('hex')}`;
  const subject = context.compose || /^re:/i.test(context.subject) ? context.subject : `Re: ${context.subject}`;
  const parts = [`Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`, 'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',base64(text),`--${alt}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',base64(html),`--${alt}--`];
  const headers = [`From: ${email}`, `To: ${recipients.to.join(',\r\n ')}`, ...(recipients.cc.length ? [`Cc: ${recipients.cc.join(',\r\n ')}`] : []), ...(recipients.bcc.length ? [`Bcc: ${recipients.bcc.join(',\r\n ')}`] : []), `Subject: ${mimeSubject(subject)}`, ...(!context.compose ? [`In-Reply-To: ${context.messageId}`, `References: ${context.references}`] : []), `Message-ID: <auto-mail-${id}@${email.split('@')[1]}>`, 'MIME-Version: 1.0'];
  if (!files.length) return Buffer.from([...headers,...parts].join('\r\n')).toString('base64url');
  const attached = files.flatMap(file => [`--${mixed}`, `Content-Type: ${file.type}`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; ${mimeFilename(file.name)}`, '', base64(file.data)]);
  return Buffer.from([...headers,`Content-Type: multipart/mixed; boundary="${mixed}"`,'',`--${mixed}`,...parts,...attached,`--${mixed}--`].join('\r\n')).toString('base64url');
}

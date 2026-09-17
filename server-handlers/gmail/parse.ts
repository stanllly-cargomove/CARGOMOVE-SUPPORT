import { emailHtmlToText, sanitizeEmailHtml } from '../_email.js';
import { InboxError, validGmailId } from './client.js';
import type { GmailInboxMessage, GmailInboxThread } from '../../src/types/gmailInbox.js';

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailRawMessage {
  id: string;
  threadId: string;
  internalDate: string;
  labelIds?: string[];
  payload?: GmailPart;
}
export interface GmailRawThread { id: string; messages?: GmailRawMessage[] }
const MAX_BODY_BYTES = 1024 * 1024;
export function decodeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (original, charset: string, encoding: string, content: string) => {
    try {
      const bytes = encoding.toLowerCase() === 'b' ? Buffer.from(content, 'base64')
        : Buffer.from(content.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
      return new TextDecoder(charset).decode(bytes).replace(/\0/g, '');
    } catch { return original; }
  });
}
function mailbox(value: string): { email: string; name: string | null } {
  const match = value.match(/(?:^|[,;]\s*)(?:([^<>]*?)\s*)?<\s*([^<>\s]+@[^<>\s]+)\s*>/) || value.match(/^\s*([^<>\s,;]+@[^<>\s,;]+)\s*$/);
  const email = (match?.[2] || match?.[1] || '').trim().toLowerCase();
  if (!email || /[\r\n<>]/.test(email)) throw new InboxError('INVALID_GMAIL_MESSAGE', 'Email sender or recipient is invalid.');
  return { email, name: match?.[2] ? match[1]?.trim().replace(/^"|"$/g, '') || null : null };
}
export function parseMessage(message: GmailRawMessage, ownEmail: string): GmailInboxMessage {
  const id = validGmailId(message.id), threadId = validGmailId(message.threadId);
  const header = (name: string) => message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || '';
  const from = mailbox(decodeHeader(header('from')));
  const outbound = message.labelIds?.includes('SENT') || from.email === ownEmail.toLowerCase();
  // An inbound message may have reached the shared mailbox via Bcc/group routing.
  const to = outbound ? mailbox(header('to')).email : ownEmail.toLowerCase();
  const timestamp = Number(message.internalDate);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !message.internalDate || Number.isNaN(new Date(timestamp).getTime())) {
    throw new InboxError('INVALID_GMAIL_MESSAGE', 'Email timestamp is invalid.');
  }
  const plain: string[] = [], html: string[] = [];
  let bodyBytes = 0, parts = 0;
  const visit = (part: GmailPart, depth = 0) => {
    if (++parts > 500 || depth > 30) throw new InboxError('INVALID_GMAIL_MESSAGE', 'Email MIME structure exceeds supported limits.');
    // Never download attachments or feed them to AI. Inline images are excluded too.
    if (part.filename) return;
    if (part.body?.attachmentId && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
      throw new InboxError('UNSUPPORTED_GMAIL_BODY', 'Email body requires attachment retrieval, which is not supported yet.');
    }
    if ((part.mimeType === 'text/plain' || part.mimeType === 'text/html') && part.body?.data) {
      const encoded = part.body.data;
      if (!/^[A-Za-z0-9_-]*={0,2}$/.test(encoded) || encoded.length > MAX_BODY_BYTES * 2) {
        throw new InboxError('INVALID_GMAIL_MESSAGE', 'Email body encoding is invalid or too large.');
      }
      const bytes = Buffer.from(encoded, 'base64url');
      bodyBytes += bytes.length;
      if (bodyBytes > MAX_BODY_BYTES) throw new InboxError('INVALID_GMAIL_MESSAGE', 'Email body exceeds the supported size.');
      const charset = part.headers?.find(h => h.name.toLowerCase() === 'content-type')?.value.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] || 'utf-8';
      let text: string;
      try { text = new TextDecoder(charset).decode(bytes).replace(/\0/g, ''); }
      catch { throw new InboxError('INVALID_GMAIL_MESSAGE', 'Email character encoding is unsupported.'); }
      (part.mimeType === 'text/plain' ? plain : html).push(text);
    }
    for (const child of part.parts || []) visit(child, depth + 1);
  };
  if (message.payload) visit(message.payload);
  const safeHtml = html.length ? sanitizeEmailHtml(html.join('\n')) : null;
  return {
    gmail_message_id: id, gmail_thread_id: threadId, direction: outbound ? 'OUTBOUND' : 'INBOUND',
    sender_name: from.name, sender_email: from.email, recipient_email: to,
    subject: decodeHeader(header('subject')).replace(/[\r\n]/g, ' ').slice(0, 2000),
    body_text: plain.length ? plain.join('\n') : safeHtml ? emailHtmlToText(safeHtml) : '',
    body_html: safeHtml, sent_at: new Date(timestamp).toISOString(), in_inbox: message.labelIds?.includes('INBOX') || false,
  };
}
export function parseThread(thread: GmailRawThread, ownEmail: string): GmailInboxThread {
  const id = validGmailId(thread.id);
  if (!Array.isArray(thread.messages) || !thread.messages.length || thread.messages.length > 500) {
    throw new InboxError('INVALID_GMAIL_THREAD', 'Gmail conversation is empty or exceeds supported message limits.');
  }
  const messages = thread.messages.filter(m => !m.labelIds?.includes('DRAFT')).map(m => parseMessage(m, ownEmail));
  if (messages.some(m => m.gmail_thread_id !== id)) throw new InboxError('INVALID_GMAIL_THREAD', 'Gmail returned mismatched thread identifiers.');
  return { id, messages: messages.sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.gmail_message_id.localeCompare(b.gmail_message_id)) };
}

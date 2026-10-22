import crypto from 'node:crypto';
import { createPkce, noStore, requireAdmin, bodyOf } from '../_email.js';
import { decryptMailboxToken, encryptMailboxToken } from './token-encryption.js';
import { autoMailClient, autoMailConfiguration } from './configuration.js';
import { threadSignature } from './thread-signature.js';
import { recordAcceptedReply } from './delivery-receipt.js';
import { MailError } from './mail-error.js';
export { MailError } from './mail-error.js';
import { addressList, cleanMailHtml, fileParts, mailHtmlText, messageBodies, replyRecipients, richRawReply } from './mail-content.js';
import { loadReplyFiles } from './file-storage.js';

export const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/';

export function portalOrigin(env: NodeJS.ProcessEnv = process.env) {
  const appUrl = env.AUTO_MAIL_APP_URL?.replace(/\/$/, '');
  if (!appUrl) throw new MailError(503, 'Configure AUTO_MAIL_APP_URL on the server.');
  const parsed = new URL(appUrl);
  if (parsed.origin !== appUrl || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) {
    throw new MailError(503, 'AUTO_MAIL_APP_URL must be the HTTPS portal origin, or the local development origin.');
  }
  return appUrl;
}

export function oauthConfig(env: NodeJS.ProcessEnv = process.env) {
  const appUrl = portalOrigin(env);
  const clientId = env.AUTO_MAIL_GOOGLE_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.AUTO_MAIL_GOOGLE_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new MailError(503, 'Configure the Google OAuth client on the server.');
  return { appUrl, clientId, clientSecret, redirectUri: `${appUrl}/api/auto-mail/callback` };
}

export function checkOrigin(request: any) {
  if (request.headers?.origin !== portalOrigin()) throw new MailError(403, 'Open Auto Mail from its configured portal URL.');
}

async function googleJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new MailError(response.status === 401 || response.status === 403 ? 409 : 502,
    response.status === 401 || response.status === 403 ? 'Gmail access was denied. Check Gmail API access and reconnect with both read and send permissions.' : 'Gmail could not complete the request. Try again.');
  return data;
}

export async function accessToken(connection: any) {
  const config = oauthConfig();
  const tokens = await googleJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
      refresh_token: decryptMailboxToken(connection), grant_type: 'refresh_token' }),
  });
  if (!tokens.access_token) throw new MailError(409, 'Reconnect Gmail to renew access.');
  return String(tokens.access_token);
}

export const gmailGet = (token: string, path: string) => googleJson(GMAIL + path, { headers: { Authorization: `Bearer ${token}` } });
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
function dbCheck(error: any) { if (error) throw new MailError(503, 'Auto Mail database operation failed. Check the Milestone 2 migration and connection.'); }

export function header(message: any, name: string) {
  return String(message.payload?.headers?.find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value || '');
}

export function singleAddress(value: string) {
  if (/[\r\n]/.test(value)) throw new MailError(400, 'The email address is invalid.');
  const match = value.trim().match(/^(?:[^<>]*<([^<>]+)>|([^<>]+))$/);
  const address = (match?.[1] || match?.[2] || '').trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address)) throw new MailError(400, 'This message has an unsupported sender address. Reply in Gmail.');
  return address;
}

export function presentThread(thread: any, email: string) {
  const messages = [...(thread.messages || [])].sort((a: any, b: any) => Number(a.internalDate) - Number(b.internalDate));
  return { id: thread.id, subject: header(messages[0] || {}, 'Subject') || '(No subject)',
    messages: messages.map((m: any) => { const bodies=messageBodies(m.payload||{}); return ({ id: m.id, from: header(m, 'From'), to: header(m, 'To'), cc: header(m, 'Cc'), bcc: header(m, 'Bcc'),
      date: new Date(Number(m.internalDate)).toISOString(),
      outbound: (m.labelIds || []).includes('SENT') || (() => { try { return singleAddress(header(m, 'From')) === email; } catch { return false; } })(),
      body: (bodies.text || mailHtmlText(bodies.html)).slice(0,100000) || m.snippet || '(No message content.)', html: bodies.html,
      files: fileParts(m.payload||{}).map(({partId,name,type,size})=>({partId,name,type,size})),
      attachments: hasAttachments(m.payload || {}),
    }); }) };
}
function hasAttachments(part: any): boolean { return !!part.filename || (part.parts || []).some(hasAttachments); }

export function replyContext(thread: any, email: string, expectedMessage: string) {
  const messages = [...(thread.messages || [])].sort((a: any, b: any) => Number(a.internalDate) - Number(b.internalDate));
  const latest = messages.at(-1);
  if (!latest || latest.id !== expectedMessage) throw new MailError(409, 'This conversation changed. Reload it before replying.');
  if ((latest.labelIds || []).includes('SENT') || singleAddress(header(latest, 'From')) === email) throw new MailError(409, 'The latest message is already outgoing. Wait for a new incoming message or reply in Gmail.');
  const recipient = singleAddress(header(latest, 'Reply-To') || header(latest, 'From'));
  if (recipient === email) throw new MailError(400, 'Cannot reply to the connected mailbox itself.');
  const messageId = header(latest, 'Message-ID').trim();
  const subject = header(latest, 'Subject');
  if (!/^<[^<>\s]+>$/.test(messageId) || /[\r\n]/.test(subject)) throw new MailError(400, 'This message cannot be safely threaded. Reply in Gmail.');
  const references = [...header(latest, 'References').matchAll(/<[^<>\s]+>/g)].map(m => m[0]).slice(-15);
  return { recipient, messageId, subject, references: [...references, messageId].join(' ') };
}

export function rawReply(email: string, context: ReturnType<typeof replyContext>, body: string, deliveryId: string) {
  const subject = /^re:/i.test(context.subject) ? context.subject : `Re: ${context.subject}`;
  return Buffer.from([
    `From: ${singleAddress(email)}`, `To: ${singleAddress(context.recipient)}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `In-Reply-To: ${context.messageId}`, `References: ${context.references}`,
    `Message-ID: <auto-mail-${deliveryId}@${email.split('@')[1]}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(body).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '',
  ].join('\r\n')).toString('base64url');
}

export async function connected(client: any) {
  const { data, error } = await client.from('gmail_connections').select('*').eq('id', 'system').maybeSingle();
  dbCheck(error);
  if (!data) throw new MailError(409, 'Connect Gmail first.');
  return data;
}

async function persistThread(client: any, connection: any, thread: any) {
  const view = presentThread(thread, connection.email);
  const saved = await client.from('conversations').upsert({ mailbox_id: connection.mailbox_id, gmail_thread_id: thread.id, subject: view.subject }, { onConflict: 'mailbox_id,gmail_thread_id' }).select('id').single();
  dbCheck(saved.error);
  if (view.messages.length) {
    const result = await client.from('messages').upsert(view.messages.map((m: any) => ({
      conversation_id: saved.data.id, mailbox_id: connection.mailbox_id, gmail_message_id: m.id,
      direction: m.outbound ? 'OUTBOUND' : 'INBOUND', sender_email: m.from, body_text: m.body, received_at: m.date,
    })), { onConflict: 'mailbox_id,gmail_message_id' });
    dbCheck(result.error);
  }
  return view;
}

export function createAutoMailHandler(action: 'connect' | 'callback' | 'threads' | 'thread' | 'reply') {
  return async (request: any, response: any) => {
    noStore(response);
    const session = requireAdmin(request, response);
    if (!session) return;
    const method = ['connect', 'reply'].includes(action) ? 'POST' : 'GET';
    if (request.method !== method) return response.status(405).json({ error: 'Method not allowed.' });
    try {
      if (method === 'POST') checkOrigin(request);
      const config = autoMailConfiguration();
      if (!config.ready) throw new MailError(503, config.message);
      const client = autoMailClient(config);
      if (action === 'connect') {
        const oauth = oauthConfig();
        // Verify encryption configuration before asking for consent.
        encryptMailboxToken('configuration-check');
        const state = crypto.randomBytes(32).toString('base64url');
        const pkce = createPkce();
        dbCheck((await client.from('oauth_states').delete().lt('expires_at', new Date().toISOString())).error);
        dbCheck((await client.from('oauth_states').insert({ state_hash: hash(state), pkce_verifier: pkce.verifier, admin_id: session.id, expires_at: new Date(Date.now() + 600000).toISOString() })).error);
        const query = new URLSearchParams({ client_id: oauth.clientId, redirect_uri: oauth.redirectUri, response_type: 'code',
          scope: `openid email ${READ_SCOPE} ${SEND_SCOPE}`, access_type: 'offline', prompt: 'consent select_account',
          state, code_challenge: pkce.challenge, code_challenge_method: 'S256' });
        return response.json({ authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${query}` });
      }
      if (action === 'callback') {
        const oauth = oauthConfig();
        const state = typeof request.query?.state === 'string' ? request.query.state : '';
        const code = typeof request.query?.code === 'string' ? request.query.code : '';
        const saved = await client.from('oauth_states').delete().eq('state_hash', hash(state)).eq('admin_id', session.id).gt('expires_at', new Date().toISOString()).select('pkce_verifier').maybeSingle();
        if (saved.error || !saved.data || !code) throw new MailError(400, 'Gmail authorization was cancelled or expired. Return to Auto Mail and connect again.');
        const tokens = await googleJson('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: oauth.clientId, client_secret: oauth.clientSecret, redirect_uri: oauth.redirectUri,
            code, code_verifier: saved.data.pkce_verifier, grant_type: 'authorization_code' }),
        });
        const scopes = String(tokens.scope || '').split(' ');
        if (!tokens.access_token || !tokens.refresh_token || ![READ_SCOPE, SEND_SCOPE].every(s => scopes.includes(s))) throw new MailError(400, 'Approve both Gmail reading and sending permissions, then reconnect.');
        const identity = await googleJson('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        if (!identity.sub || identity.email_verified !== true) throw new MailError(400, 'Google could not verify the mailbox identity.');
        const email = singleAddress(identity.email);
        const profile = await gmailGet(tokens.access_token, 'profile');
        if (singleAddress(profile.emailAddress) !== email) throw new MailError(400, 'Gmail account identity did not match.');
        const mailbox = await client.from('mailboxes').upsert({ email, status: 'CONNECTED' }, { onConflict: 'email' }).select('id').single();
        dbCheck(mailbox.error);
        dbCheck((await client.from('gmail_connections').upsert({ id: 'system', mailbox_id: mailbox.data.id, google_subject: identity.sub,
          email, ...encryptMailboxToken(tokens.refresh_token), scopes, connected_by: session.id, connected_at: new Date().toISOString(), version: crypto.randomUUID() })).error);
        return response.redirect(302, `${oauth.appUrl}/admin?auto_mail=connected`);
      }
      const connection = await connected(client);
      if (![READ_SCOPE, SEND_SCOPE].every(s => connection.scopes.includes(s))) throw new MailError(409, 'Reconnect Gmail with read and send permissions.');
      const token = await accessToken(connection);
      if (action === 'threads') {
        const pageToken = typeof request.query?.pageToken === 'string' ? request.query.pageToken : '';
        const folder = request.query?.folder ?? 'inbox';
        const search = request.query?.q ?? '';
        if (pageToken.length > 1000 || !['inbox', 'sent'].includes(folder) || typeof search !== 'string' || search.length > 500) throw new MailError(400, 'Invalid mailbox search or page.');
        const label = folder === 'sent' ? 'SENT' : 'INBOX';
        const query = new URLSearchParams({ maxResults: '25', labelIds: label, ...(search.trim() ? { q: search.trim() } : {}), ...(pageToken ? { pageToken } : {}) });
        const list = await gmailGet(token, `threads?${query}`);
        const threads = await Promise.all((list.threads || []).map(async (t: any) => {
          const thread = await gmailGet(token, `threads/${encodeURIComponent(t.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`);
          const messages = thread.messages || [];
          const latest = messages.filter((m: any) => m.labelIds?.includes(label)).at(-1) || messages.at(-1) || {};
          return { id: t.id, subject: header(messages[0] || {}, 'Subject') || '(No subject)', from: header(latest, 'From'), to: header(latest, 'To'), date: header(latest, 'Date'), timestamp: Number(latest.internalDate) || null, messageCount: messages.length, snippet: latest.snippet || t.snippet || '', unread: messages.some((m: any) => m.labelIds?.includes('UNREAD')) };
        }));
        return response.json({ threads, nextPageToken: list.nextPageToken || null, resultSizeEstimate: list.resultSizeEstimate ?? null, folder, mailbox: connection.email });
      }
      const body = action === 'reply' ? await bodyOf(request) : {};
      const threadId = String(action === 'reply' ? body.threadId || '' : request.query?.id || '');
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(threadId)) throw new MailError(400, 'Invalid conversation.');
      const thread = await gmailGet(token, `threads/${encodeURIComponent(threadId)}?format=full`);
      if (action === 'thread') {
        const view = await persistThread(client, connection, thread);
        let recipient = '';
        let replyBlocked = '';
        const latestId = view.messages.at(-1)?.id || '';
        try { recipient = replyContext(thread, connection.email, latestId).recipient; } catch (e) { replyBlocked = e instanceof MailError ? e.message : 'Reply in Gmail.'; }
        const deliveries = await client.from('reply_deliveries').select('status').eq('mailbox_id', connection.mailbox_id).eq('source_message_id', latestId).maybeSingle();
        dbCheck(deliveries.error);
        if (deliveries.data) replyBlocked = deliveries.data.status === 'SENT' ? 'A reply was already sent. Refresh this conversation.' : 'A send is pending or its outcome is uncertain. Check Sent in Gmail before taking further action.';
        const latest=(thread.messages||[]).find((m:any)=>m.id===latestId);
        const readAddresses=(name:string)=>{try{return addressList(header(latest||{},name)).filter(value=>value!==connection.email&&value!==recipient);}catch{return [];}};
        return response.json({ ...view, recipient, replyBlocked, replyAll: {to:[recipient,...readAddresses('To')].filter(Boolean),cc:readAddresses('Cc')}, mailbox: connection.email, connectionVersion: connection.version });
      }
      if (body.connectionVersion !== connection.version) throw new MailError(409, 'The connected mailbox changed. Reload Auto Mail.');
      const html=typeof body.bodyHtml==='string'?cleanMailHtml(body.bodyHtml):'';
      const message=html?mailHtmlText(html):typeof body.body==='string'?body.body.trim():'';
      if ((!message && !(Array.isArray(body.attachmentIds)&&body.attachmentIds.length)) || message.length>50000 || (typeof body.bodyHtml==='string'&&body.bodyHtml.length>200000)) throw new MailError(400,'Enter a reply of up to 50,000 characters or attach a file.');
      const context = replyContext(thread, connection.email, String(body.sourceMessageId || ''));
      if (body.recipient !== context.recipient) throw new MailError(409, 'The reply recipient changed. Reload the conversation.');
      const id = String(body.requestId || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new MailError(400, 'Invalid send request.');
      const recipients=replyRecipients(body,context.recipient,connection.email);
      const files=await loadReplyFiles(client,body.attachmentIds,{id,actor:session.id,connection,threadId,sourceMessageId:String(body.sourceMessageId||'')});
      const rich=!!html||files.length>0||recipients.to.length>1||recipients.cc.length>0||recipients.bcc.length>0;
      const raw=rich?richRawReply(singleAddress(connection.email),context,recipients,message,html||cleanMailHtml('<p>'+message.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n','<br>')+'</p>'),files,id):rawReply(connection.email,context,message,id);
      const aiDraftId = body.aiDraftId == null ? null : String(body.aiDraftId);
      if (aiDraftId && !/^[0-9a-f-]{36}$/i.test(aiDraftId)) throw new MailError(400, 'Invalid AI draft reference.');
      const delivery = { id, mailbox_id: connection.mailbox_id, connection_version: connection.version,
        gmail_thread_id: threadId, source_message_id: body.sourceMessageId, recipient: context.recipient, body_text: message, requested_by: session.id,
        ai_draft_id: aiDraftId, conversation_hash: aiDraftId ? threadSignature(presentThread(thread, connection.email)) : null,
        subject: context.subject, customer_question: presentThread(thread, connection.email).messages.at(-1)?.body || '' };
      const claim = await client.rpc(rich?'claim_rich_reply':'claim_manual_reply', rich?{p_delivery:delivery,p_detail:{to:recipients.to,cc:recipients.cc,bcc:recipients.bcc,html,attachments:files.map(({data,...meta})=>meta)}}:{p_delivery:delivery});
      if(claim.error && ['PGRST202','42P01','42883'].includes(claim.error.code))throw new MailError(503,'Apply the rich replies migration in the separate Auto Mail database to send formatted replies, CC/BCC or attachments.');
      if (claim.error) throw new MailError(409, aiDraftId ? 'The AI draft or its KB sources changed, or this conversation already has a reply request. Reload the conversation and check Gmail before trying again.' : 'This message already has a reply request, or the mailbox changed. Refresh the conversation and check Sent in Gmail.');
      // Never retry a Gmail send. Network failures may occur after Gmail accepts it.
      try {
        const sent = await googleJson(GMAIL + 'messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw, threadId }) });
        if (!sent.id) throw new Error('Missing send receipt');
        const finished = await recordAcceptedReply(client, id, session.id, sent.id);
        if (!finished.saved) return response.json({ status: 'SENT', warning: 'Gmail accepted the reply, but the local receipt could not be saved. Check Gmail; do not resend.' });
        return response.json({ status: 'SENT', deliveryId: id, learningQueued: finished.learningQueued });
      } catch {
        await client.from('reply_deliveries').update({ status: 'UNKNOWN', finished_at: new Date().toISOString() }).eq('id', id);
        throw new MailError(409, 'The send outcome is uncertain. Check Sent in Gmail. Auto Mail will not resend this request.');
      }
    } catch (error) {
      const status = error instanceof MailError ? error.status : 503;
      const message = error instanceof MailError ? error.message : 'Auto Mail could not complete the request. Check the connection and try again.';
      if (action === 'callback') return response.status(status).send(message);
      return response.status(status).json({ error: message, ...(action==='reply'&&status===400?{canEditReply:true}:{}) });
    }
  };
}

export const gmailConnect = createAutoMailHandler('connect');
export const gmailCallback = createAutoMailHandler('callback');
export const gmailThreads = createAutoMailHandler('threads');
export const gmailThread = createAutoMailHandler('thread');
export const gmailReply = createAutoMailHandler('reply');

import crypto from 'node:crypto';
import { adminClient, readSession, requestBody } from '../api/_runtime.js';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const WELCOME_TEMPLATE_ID = 'cargomove-welcome';
export const EMAIL_ATTACHMENT_BUCKET = 'email-attachments';
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);

export type EmailAttachment = {
  path: string;
  name: string;
  content_type: string;
  size: number;
};

export type AdminSession = { id: string; email: string; type: string; exp: number };

export type EmailTemplate = {
  id: string;
  name: string;
  trigger_status: 'DONE';
  recipient_template: string;
  subject_template: string;
  body_template: string;
  attachments: EmailAttachment[];
  active: boolean;
  version: number;
  updated_at?: string;
};

export type ExternalEmailUser = {
  id: string;
  email: string;
  username: string;
  password: string;
  status: 'PENDING' | 'DONE' | 'REJECTED';
  email_status: 'NOT_READY' | 'READY' | 'SENDING' | 'SENT' | 'FAILED';
};

export function requireAdmin(request: any, response: any): AdminSession | null {
  const session = readSession(request) as AdminSession | null;
  if (!session || session.type !== 'ADMIN') {
    response.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  return session;
}

export function noStore(response: any) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Pragma', 'no-cache');
}

export async function bodyOf(request: any) {
  return requestBody(request) as Promise<Record<string, unknown>>;
}

export function configuredClient(response: any) {
  const client = adminClient();
  if (!client) response.status(503).json({ error: 'Supabase server access is not configured.' });
  return client;
}

export function renderWelcomeTemplate(template: EmailTemplate, user: ExternalEmailUser) {
  const values: Record<string, string> = {
    'user.email': user.email,
    'user.username': user.username,
    'user.password': user.password,
  };
  const render = (source: string) => source.replace(/{{\s*([a-z.]+)\s*}}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`Unsupported template variable: {{${key}}}`);
    return values[key];
  });
  return {
    recipient: render(template.recipient_template),
    subject: render(template.subject_template),
    body: render(template.body_template),
  };
}

export function validateTemplateAttachments(value: unknown): EmailAttachment[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error('A template can have up to 5 attachments.');
  const attachments = value.map((item) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const attachment: EmailAttachment = {
      path: String(record.path || ''),
      name: String(record.name || '').trim(),
      content_type: String(record.content_type || '').toLowerCase(),
      size: Number(record.size || 0),
    };
    if (!/^cargomove-welcome\/[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?$/.test(attachment.path)) {
      throw new Error('Invalid template attachment path.');
    }
    if (!attachment.name || attachment.name.length > 255 || /[\r\n]/.test(attachment.name)) {
      throw new Error('Invalid template attachment name.');
    }
    if (!ALLOWED_ATTACHMENT_TYPES.has(attachment.content_type)) throw new Error(`Unsupported attachment type: ${attachment.name}`);
    if (!Number.isSafeInteger(attachment.size) || attachment.size < 1 || attachment.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error(`Invalid attachment size: ${attachment.name}`);
    }
    return attachment;
  });
  if (attachments.reduce((total, item) => total + item.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error('Attachments must be 15 MB or smaller in total.');
  }
  return attachments;
}

function signingKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is missing.');
  return secret;
}

export function createPreviewToken(session: AdminSession, user: ExternalEmailUser, template: EmailTemplate) {
  const payload = Buffer.from(JSON.stringify({
    adminId: session.id,
    userId: user.id,
    templateId: template.id,
    templateVersion: template.version,
    exp: Date.now() + 15 * 60 * 1000,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyPreviewToken(token: string, session: AdminSession) {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      adminId: string; userId: string; templateId: string; templateVersion: number; exp: number;
    };
    return parsed.adminId === session.id && parsed.exp > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

function encryptionKey() {
  const configured = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!configured) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY is missing.');
  const decoded = Buffer.from(configured, 'base64');
  if (decoded.length !== 32) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return decoded;
}

export function encryptRefreshToken(token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    refresh_token_ciphertext: encrypted.toString('base64'),
    token_iv: iv.toString('base64'),
    token_auth_tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptRefreshToken(connection: any) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(connection.token_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(connection.token_auth_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(connection.refresh_token_ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function createPkce() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const appUrl = process.env.APP_URL?.replace(/\/$/, '');
  if (!clientId || !clientSecret || !appUrl) {
    throw new Error('Google OAuth requires GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and APP_URL.');
  }
  return { clientId, clientSecret, appUrl, redirectUri: `${appUrl}/api/gmail/callback` };
}

export async function exchangeRefreshToken(refreshToken: string) {
  const { clientId, clientSecret } = googleOAuthConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error(String(result.error || 'gmail_token_refresh_failed'));
  return String(result.access_token);
}

function safeHeader(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || /[\r\n]/.test(normalized)) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function mimeSubject(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function createRawMessage(from: string, to: string, subject: string, body: string, attachments: Array<EmailAttachment & { data: Buffer }> = []) {
  const encodedBody = Buffer.from(body, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
  const commonHeaders = [
    `From: ${safeHeader(from, 'sender')}`,
    `To: ${safeHeader(to, 'recipient')}`,
    `Subject: ${mimeSubject(safeHeader(subject, 'subject'))}`,
    'MIME-Version: 1.0',
  ];
  let mime: string;
  if (attachments.length === 0) {
    mime = [...commonHeaders, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedBody].join('\r\n');
  } else {
    const boundary = `cargomove_${crypto.randomBytes(18).toString('hex')}`;
    const parts = [
      ...commonHeaders,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodedBody,
    ];
    for (const attachment of attachments) {
      const name = safeHeader(attachment.name, 'attachment name');
      const fallbackName = name.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/["\\]/g, '_') || 'attachment';
      const encodedName = encodeURIComponent(name).replace(/'/g, '%27');
      parts.push(
        `--${boundary}`,
        `Content-Type: ${safeHeader(attachment.content_type, 'attachment content type')}; name="${fallbackName}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
        '',
        attachment.data.toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd(),
      );
    }
    parts.push(`--${boundary}--`, '');
    mime = parts.join('\r\n');
  }
  return Buffer.from(mime, 'utf8').toString('base64url');
}

export function publicError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : 'Unknown email error.';
}

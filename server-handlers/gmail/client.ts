import { decryptRefreshToken, exchangeRefreshToken, GMAIL_SEND_SCOPE } from '../_email.js';
import type { adminClient } from '../../api/_runtime.js';

export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export type ServerClient = NonNullable<ReturnType<typeof adminClient>>;
export class InboxError extends Error {
  constructor(readonly code: string, message: string, readonly status = 502) { super(message); }
}
export class GmailError extends InboxError {
  constructor(readonly gmailStatus: number, reason?: string) {
    const limited = gmailStatus === 429 || ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'].includes(reason || '');
    const reconsent = gmailStatus === 403 && reason === 'insufficientPermissions';
    super(gmailStatus === 404 ? 'GMAIL_NOT_FOUND' : limited ? 'GMAIL_RATE_LIMITED' : reconsent ? 'GMAIL_RECONSENT_REQUIRED' : gmailStatus === 401 ? 'GMAIL_AUTH_EXPIRED' : 'GMAIL_REQUEST_FAILED',
      gmailStatus === 404 ? 'The Gmail message or conversation no longer exists.' : limited ? 'Gmail is rate limited. Retry later.' : reconsent ? 'Reconnect Gmail and grant inbox read permission.' : gmailStatus === 401 ? 'Reconnect Gmail to renew authorization.' : 'Unable to retrieve Gmail data.',
      gmailStatus === 404 ? 404 : limited ? 429 : reconsent ? 409 : gmailStatus === 401 ? 409 : 502);
  }
}
export interface GmailConnection {
  email: string;
  google_subject: string;
  connected_at: string;
  scopes: string[];
  refresh_token_ciphertext: string;
  token_iv: string;
  token_auth_tag: string;
}
export async function inboxConnection(client: ServerClient): Promise<GmailConnection> {
  const { data, error } = await client.from('gmail_connections').select('*').eq('id', 'system').eq('status', 'ACTIVE').timeout(8000).maybeSingle();
  if (error) throw new InboxError('DATABASE_UNAVAILABLE', 'Unable to read the Gmail connection.');
  if (!data) throw new InboxError('GMAIL_DISCONNECTED', 'Connect Gmail before reading the support inbox.', 409);
  if (!Array.isArray(data.scopes) || !data.scopes.includes(GMAIL_READ_SCOPE) || !data.scopes.includes(GMAIL_SEND_SCOPE)) {
    throw new InboxError('GMAIL_RECONSENT_REQUIRED', 'Reconnect Gmail and grant inbox read permission.', 409);
  }
  return data as GmailConnection;
}
export async function inboxAccessToken(connection: GmailConnection): Promise<string> {
  try { return await exchangeRefreshToken(decryptRefreshToken(connection), 10000); }
  catch { throw new InboxError('GMAIL_AUTH_UNAVAILABLE', 'Unable to authorize Gmail. Check the connection and server configuration.', 409); }
}
export interface GmailReader { get<T>(path: string, query?: URLSearchParams): Promise<T> }
export function gmailReader(accessToken: string): GmailReader {
  return {
    async get<T>(path: string, query = new URLSearchParams()): Promise<T> {
      let response: Response;
      try {
        response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}?${query}`, {
          headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000),
        });
      } catch { throw new InboxError('GMAIL_UNAVAILABLE', 'Gmail did not respond. Retry later.'); }
      if (!response.ok) {
        const provider = await response.json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null;
        throw new GmailError(response.status, provider?.error?.errors?.[0]?.reason);
      }
      try { return await response.json() as T; }
      catch { throw new InboxError('GMAIL_INVALID_RESPONSE', 'Gmail returned an invalid response.'); }
    },
  };
}
export function validGmailId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new InboxError('INVALID_GMAIL_ID', 'A valid Gmail identifier is required.', 400);
  }
  return value;
}

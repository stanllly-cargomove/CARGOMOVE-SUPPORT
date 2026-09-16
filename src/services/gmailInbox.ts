import type { GmailInboxMessage, GmailInboxThread, GmailMessagePage, GmailSyncResult } from '../types/gmailInbox';

async function inboxRequest<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const response = await fetch(`/api/gmail/${path}`, { method, credentials: 'include', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to access the support inbox.');
  return body as T;
}
export function listGmailInbox(pageToken?: string): Promise<GmailMessagePage> {
  return inboxRequest(`messages${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`);
}
export async function getGmailMessage(id: string): Promise<GmailInboxMessage> {
  return (await inboxRequest<{ message: GmailInboxMessage }>(`message?id=${encodeURIComponent(id)}`)).message;
}
export async function getGmailThread(id: string): Promise<GmailInboxThread> {
  return (await inboxRequest<{ thread: GmailInboxThread }>(`thread?id=${encodeURIComponent(id)}`)).thread;
}
/** One resumable batch only. Caller may request another batch when has_more is true. */
export function synchronizeGmailInbox(): Promise<GmailSyncResult> { return inboxRequest('sync', 'POST'); }

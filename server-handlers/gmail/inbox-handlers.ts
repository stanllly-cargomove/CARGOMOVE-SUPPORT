import type { Request, Response } from 'express';
import { configuredClient, noStore, requireAdmin } from '../_email.js';
import { gmailReader, inboxAccessToken, inboxConnection, InboxError } from './client.js';
import type { GmailConnection, GmailReader, ServerClient } from './client.js';

export interface InboxContext { client: ServerClient; connection: GmailConnection; gmail: GmailReader }
export async function withInbox(request: Request, response: Response, method: 'GET' | 'POST', work: (context: InboxContext) => Promise<unknown>) {
  noStore(response);
  if (request.method !== method) return response.status(405).json({ error: 'Method not allowed.' });
  if (!requireAdmin(request, response)) return;
  const client = configuredClient(response);
  if (!client) return;
  try {
    const connection = await inboxConnection(client);
    const gmail = gmailReader(await inboxAccessToken(connection));
    return response.json(await work({ client, connection, gmail }));
  } catch (error) {
    if (error instanceof InboxError) {
      if (error.status === 429) response.setHeader('Retry-After', '60');
      return response.status(error.status).json({ error: error.message, code: error.code });
    }
    // Do not log customer messages, Gmail tokens, or raw provider responses.
    return response.status(502).json({ error: 'Support inbox operation failed. Retry later.', code: 'INBOX_UNAVAILABLE' });
  }
}

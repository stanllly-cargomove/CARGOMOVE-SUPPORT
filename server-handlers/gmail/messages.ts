import type { Request, Response } from 'express';
import { withInbox } from './inbox-handlers.js';
import { InboxError, validGmailId } from './client.js';
import type { GmailMessageReference } from '../../src/types/gmailInbox.js';

export default async function messages(request: Request, response: Response) {
  return withInbox(request, response, 'GET', async ({ gmail }) => {
    const query = new URLSearchParams({ labelIds: 'INBOX', maxResults: '20' });
    const token = request.query.pageToken;
    if (token !== undefined) {
      if (typeof token !== 'string' || token.length > 2048) throw new InboxError('INVALID_PAGE_TOKEN', 'Invalid Gmail page token.', 400);
      query.set('pageToken', token);
    }
    const page = await gmail.get<{ messages?: GmailMessageReference[]; nextPageToken?: string }>('messages', query);
    return { messages: (page.messages || []).map(m => ({ id: validGmailId(m.id), threadId: validGmailId(m.threadId) })), nextPageToken: page.nextPageToken || null };
  });
}

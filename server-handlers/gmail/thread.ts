import type { Request, Response } from 'express';
import { withInbox } from './inbox-handlers.js';
import { validGmailId } from './client.js';
import { parseThread } from './parse.js';
import type { GmailRawThread } from './parse.js';

export default async function thread(request: Request, response: Response) {
  return withInbox(request, response, 'GET', async ({ gmail, connection }) => {
    const id = validGmailId(request.query.id);
    return { thread: parseThread(await gmail.get<GmailRawThread>(`threads/${id}`, new URLSearchParams({ format: 'full' })), connection.email) };
  });
}

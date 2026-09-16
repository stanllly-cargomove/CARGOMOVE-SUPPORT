import type { Request, Response } from 'express';
import { withInbox } from './inbox-handlers.js';
import { validGmailId } from './client.js';
import { parseMessage } from './parse.js';
import type { GmailRawMessage } from './parse.js';

export default async function message(request: Request, response: Response) {
  return withInbox(request, response, 'GET', async ({ gmail, connection }) => {
    const id = validGmailId(request.query.id);
    const raw = await gmail.get<GmailRawMessage>(`messages/${id}`, new URLSearchParams({ format: 'full' }));
    return { message: parseMessage(raw, connection.email) };
  });
}

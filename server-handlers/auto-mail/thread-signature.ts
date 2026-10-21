import crypto from 'node:crypto';

// Gmail read/unread labels do not invalidate a draft; message content does.
export function threadSignature(thread: { id: string; subject: string; messages: any[] }) {
  return crypto.createHash('sha256').update(JSON.stringify({ id: thread.id, subject: thread.subject,
    messages: thread.messages.map(m => ({ id: m.id, from: m.from, to: m.to, body: m.body, date: m.date, outbound: m.outbound, attachments: m.attachments })),
  })).digest('hex');
}

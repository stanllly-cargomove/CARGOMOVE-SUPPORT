import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { withInbox } from './inbox-handlers.js';
import { InboxError } from './client.js';
import { runSync } from './sync-engine.js';
import type { SyncState } from './sync-engine.js';

export default async function sync(request: Request, response: Response) {
  const deadline = Date.now() + 50000;
  return withInbox(request, response, 'POST', async ({ client, connection, gmail }) => {
    const token = crypto.randomUUID();
    const { data: state, error } = await client.rpc<SyncState>('acquire_gmail_sync', {
      p_subject: connection.google_subject, p_version: connection.connected_at, p_token: token,
    });
    if (error || !state) {
      const busy = error?.message.includes('GMAIL_SYNC_BUSY');
      const changed = error?.message.includes('GMAIL_MAILBOX_CHANGED') || error?.message.includes('GMAIL_CONNECTION_CHANGED');
      throw new InboxError(busy ? 'GMAIL_SYNC_BUSY' : changed ? 'GMAIL_CONNECTION_CHANGED' : 'SYNC_DATABASE_UNAVAILABLE',
        busy ? 'Gmail sync is already running. Retry shortly.' : changed ? 'The connected Gmail mailbox changed. Reconnect the original mailbox.' : 'Unable to start sync. Check that support migrations have been applied.', busy || changed ? 409 : 503);
    }
    const checkpoint = async (next: SyncState, release = false) => {
      const { error } = await client.rpc('checkpoint_gmail_sync', { p_token: token, p_state: next, p_release: release });
      if (error) throw new InboxError('SYNC_CHECKPOINT_FAILED', 'Unable to save synchronization progress. Retry later.');
    };
    try {
      return await runSync(gmail, {
        checkpoint,
        async listTracked(after) {
          const { data, error } = await client.rpc<Array<{ id: string; gmail_thread_id: string }>>('tracked_gmail_threads', { p_after: after });
          if (error || !data) throw new InboxError('SYNC_STORAGE_FAILED', 'Unable to retrieve conversations for recovery.');
          return data;
        },
        async isTracked(id) {
          const { data, error } = await client.from('support_cases').select('id').eq('gmail_thread_id', id).timeout(8000).maybeSingle();
          if (error) throw new InboxError('SYNC_STORAGE_FAILED', 'Unable to find the stored conversation. Retry later.');
          return Boolean(data);
        },
        async persist(thread) {
          const { data, error } = await client.rpc<number>('persist_gmail_thread', { p_token: token, p_thread_id: thread.id, p_messages: thread.messages });
          if (error || data === null) throw new InboxError('SYNC_STORAGE_FAILED', 'Unable to save this conversation. Progress is retained for retry.');
          return data;
        },
      }, state, connection.email, deadline);
    } catch (error) {
      // State may have changed in memory before a failed write. Never save it
      // on failure; release only the lease, leaving durable progress untouched.
      await client.rpc('release_gmail_sync', { p_token: token });
      throw error;
    }
  });
}

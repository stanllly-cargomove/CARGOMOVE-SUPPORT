import { GmailError, InboxError, validGmailId } from './client.js';
import type { GmailReader } from './client.js';
import { parseThread } from './parse.js';
import type { GmailRawThread } from './parse.js';
import type { GmailInboxThread, GmailMessageReference, GmailSyncResult } from '../../src/types/gmailInbox.js';

export interface SyncState {
  mode: 'BOOTSTRAP' | 'HISTORY';
  history_id: string | null;
  bootstrap_history_id: string | null;
  bootstrap_after: number;
  recovery_pending: boolean;
  recovery_cursor: string | null;
  pending_recovery_cursor: string | null;
  page_token: string | null;
  page_staged: boolean;
  pending_threads: string[];
  pending_page_token: string | null;
  pending_history_id: string | null;
  last_synced_at: string | null;
}
export interface SyncStore {
  checkpoint(state: SyncState, release?: boolean): Promise<void>;
  persist(thread: GmailInboxThread): Promise<number>;
  isTracked(threadId: string): Promise<boolean>;
  listTracked(after: string | null): Promise<Array<{ id: string; gmail_thread_id: string }>>;
}
interface ListPage { messages?: GmailMessageReference[]; nextPageToken?: string }
interface HistoryPage {
  historyId: string;
  nextPageToken?: string;
  history?: Array<{
    messagesAdded?: Array<{ message: GmailMessageReference }>;
    labelsAdded?: Array<{ message: GmailMessageReference; labelIds?: string[] }>;
  }>;
}
function historyId(value: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new InboxError('INVALID_HISTORY_ID', 'Gmail returned an invalid history identifier.');
  return value; // Never convert Google's 64-bit IDs to JavaScript numbers.
}
export async function runSync(gmail: GmailReader, store: SyncStore, state: SyncState, ownEmail: string, deadline = Date.now() + 50000): Promise<GmailSyncResult> {
  let processed = 0, inserted = 0;
  if (!state.page_staged) {
    if (state.mode === 'HISTORY') {
      if (!state.history_id) throw new InboxError('INVALID_SYNC_STATE', 'Gmail sync state has no history checkpoint.');
      const query = new URLSearchParams({ startHistoryId: state.history_id, maxResults: '10' });
      if (state.page_token) query.set('pageToken', state.page_token);
      let page: HistoryPage | null = null;
      try { page = await gmail.get<HistoryPage>('history', query); }
      catch (error) {
        if (!(error instanceof GmailError) || error.gmailStatus !== 404) throw error;
        // An expired cursor requires a one-time bounded inbox recovery, not
        // repeated mailbox scans. Never discard stored case/message history.
        state.recovery_pending = true; state.recovery_cursor = null; state.pending_recovery_cursor = null;
        state.mode = 'BOOTSTRAP'; state.history_id = null; state.bootstrap_history_id = null; state.page_token = null;
        if (state.last_synced_at) state.bootstrap_after = Math.floor(Date.parse(state.last_synced_at) / 1000) - 86400;
        await store.checkpoint(state, true);
        return { mode: 'BOOTSTRAP', processed_threads: 0, inserted_messages: 0, has_more: true, history_id: null };
      }
      if (page) {
        state.pending_threads = [...new Set((page.history || []).flatMap(h => [
          ...(h.messagesAdded || []).map(a => validGmailId(a.message.threadId)),
          ...(h.labelsAdded || []).filter(a => a.labelIds?.includes('INBOX')).map(a => validGmailId(a.message.threadId)),
        ]))];
        state.pending_page_token = page.nextPageToken || null;
        state.pending_history_id = historyId(page.historyId);
        state.page_staged = true;
        await store.checkpoint(state);
      }
    }
    if (state.mode === 'BOOTSTRAP') {
      if (!state.bootstrap_history_id) {
        const profile = await gmail.get<{ historyId: string }>('profile');
        state.bootstrap_history_id = historyId(profile.historyId);
        await store.checkpoint(state); // Save the baseline before listing any mail.
      }
      if (state.recovery_pending) {
        const tracked = await store.listTracked(state.recovery_cursor);
        state.pending_threads = tracked.map(t => validGmailId(t.gmail_thread_id));
        state.pending_recovery_cursor = tracked.length === 10 ? tracked[tracked.length - 1].id : null;
        state.pending_page_token = null;
        state.pending_history_id = state.bootstrap_history_id;
        state.page_staged = true;
        await store.checkpoint(state);
      } else {
        const query = new URLSearchParams({ labelIds: 'INBOX', q: `after:${state.bootstrap_after}`, maxResults: '10' });
        if (state.page_token) query.set('pageToken', state.page_token);
        const page = await gmail.get<ListPage>('messages', query);
        state.pending_threads = [...new Set((page.messages || []).map(m => validGmailId(m.threadId)))];
        state.pending_page_token = page.nextPageToken || null;
        state.pending_history_id = state.bootstrap_history_id;
        state.page_staged = true;
        await store.checkpoint(state);
      }
    }
  }
  // Durable queue allows a large history page to span serverless invocations.
  // Checkpoint after each thread; retries are idempotent even if that save fails.
  while (state.pending_threads.length && processed < 3 && Date.now() < deadline - 30000) {
    const id = validGmailId(state.pending_threads[0]);
    let thread: GmailRawThread | null = null;
    try { thread = await gmail.get<GmailRawThread>(`threads/${id}`, new URLSearchParams({ format: 'full' })); }
    catch (error) { if (!(error instanceof GmailError) || error.gmailStatus !== 404) throw error; }
    if (thread) {
      if (thread.id !== id) throw new InboxError('INVALID_GMAIL_THREAD', 'Gmail returned the wrong conversation.');
      // Skip unrelated archived/sent/spam conversations before parsing content.
      if (thread.messages?.some(m => m.labelIds?.includes('INBOX')) || await store.isTracked(id)) {
        inserted += await store.persist(parseThread(thread, ownEmail));
      }
    }
    state.pending_threads.shift(); processed++;
    await store.checkpoint(state);
  }
  let hasMore = true;
  if (!state.pending_threads.length) {
    if (state.recovery_pending) {
      state.recovery_cursor = state.pending_recovery_cursor;
      if (!state.recovery_cursor) state.recovery_pending = false;
      state.pending_recovery_cursor = null;
    } else {
      state.page_token = state.pending_page_token;
      if (!state.page_token) {
        state.history_id = state.pending_history_id;
        if (state.mode === 'HISTORY') state.last_synced_at = new Date().toISOString();
        else state.mode = 'HISTORY'; // Immediately catch up from the bootstrap baseline.
        hasMore = state.last_synced_at === null || state.bootstrap_history_id !== null;
        state.bootstrap_history_id = null;
      }
    }
    state.page_staged = false; state.pending_page_token = null; state.pending_history_id = null;
  }
  await store.checkpoint(state, true);
  return { mode: state.mode, processed_threads: processed, inserted_messages: inserted, has_more: hasMore, history_id: state.history_id };
}

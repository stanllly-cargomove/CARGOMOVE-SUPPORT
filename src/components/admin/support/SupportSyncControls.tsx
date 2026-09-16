import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { connectGmail, getGmailStatus } from '../../../services/email';
import { synchronizeGmailInbox } from '../../../services/gmailInbox';
export function SupportSyncControls({ onRefresh }: { onRefresh: () => void }) {
  const [connection, setConnection] = useState<Awaited<
    ReturnType<typeof getGmailStatus>
  > | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [more, setMore] = useState(false);
  const lock = useRef(false);
  const [check, setCheck] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    setFeedback('');
    setMore(false);
    void getGmailStatus()
      .then((data) => {
        if (active) setConnection(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [check]);
  async function act(reconnect = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      if (reconnect) {
        await connectGmail();
        return;
      }
      const result = await synchronizeGmailInbox();
      setMore(result.has_more);
      setFeedback(
        `${result.inserted_messages} messages imported.${result.has_more ? ' More work remains; continue sync.' : ' Inbox is up to date.'}`,
      );
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to synchronize Gmail.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-700">
            {connection
              ? connection.connected
                ? `Gmail: ${connection.connection?.email || 'Connected'}`
                : 'Gmail is not connected.'
              : 'Checking Gmail connection…'}
          </p>
          {connection?.connected && !connection.inboxPermissionGranted && (
            <p className="mt-1 text-xs text-amber-700">
              Grant inbox read access to import support conversations.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              onRefresh();
              setCheck((v) => v + 1);
            }}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50"
          >
            Refresh cases
          </button>
          {connection && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  !connection.connected || !connection.inboxPermissionGranted,
                )
              }
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`}
              />
              {busy
                ? 'Processing…'
                : !connection.connected
                  ? 'Connect Gmail'
                  : !connection.inboxPermissionGranted
                    ? 'Grant inbox access'
                    : more
                      ? 'Continue sync'
                      : 'Sync Gmail'}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-3 text-xs text-rose-700" role="alert">
          {error}
        </p>
      )}
      {feedback && (
        <p className="mt-3 text-xs text-slate-600" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}

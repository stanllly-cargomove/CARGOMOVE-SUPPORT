import { AIAnalysisPanel } from './AIAnalysisPanel';
import React, { useEffect, useState } from 'react';
import { getSupportCase } from '../../../services/support';
import { useSupportResource } from '../../../hooks/support/useSupportResource';
import { supportLabel, supportTime } from '../../../utils/support/status';
import { SupportStatusBadge } from './SupportStatusBadge';
export function SupportCaseDetail({
  caseId,
  revision,
  onBack,
  onAnalyzed,
}: {
  caseId: string;
  revision: number;
  onBack: () => void;
  onAnalyzed: () => void;
}) {
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [caseId]);
  const resource = useSupportResource(
    `${caseId}:${offset}:${revision}`,
    (signal) => getSupportCase(caseId, offset, signal),
  );
  if (resource.loading)
    return (
      <div className="p-8 text-sm text-slate-500" role="status">
        Loading conversation…
      </div>
    );
  if (resource.error)
    return (
      <div className="p-6 text-sm text-rose-700" role="alert">
        {resource.error}
        <button
          type="button"
          onClick={onBack}
          className="mt-3 block text-blue-600 underline"
        >
          Return to inbox
        </button>
      </div>
    );
  const detail = resource.data;
  if (!detail) return null;
  const item = detail.supportCase;
  return (
    <div className="space-y-5 p-5">
      <button
        type="button"
        onClick={onBack}
        className="text-xs font-semibold text-blue-600"
      >
        ← Inbox
      </button>
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SupportStatusBadge status={item.status} />
          <span className="text-xs text-slate-500">
            {supportLabel(item.category)} · {supportLabel(item.port)} ·{' '}
            {supportLabel(item.urgency)} urgency
          </span>
        </div>
        <h2 className="break-words text-lg font-bold text-slate-900">
          {item.subject || '(No subject)'}
        </h2>
        <p className="mt-1 break-words text-sm text-slate-600">
          {item.customer_name || 'Customer'} · {item.customer_email}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Assigned:{' '}
          {item.assigned_to
            ? item.assigned_name || 'Assigned staff member'
            : 'Unassigned'}{' '}
          · Created {supportTime(item.created_at)}
        </p>
        {item.resolved_at && (
          <p className="mt-1 text-xs text-emerald-700">
            Resolved {supportTime(item.resolved_at)}
          </p>
        )}
      </div>
      <AIAnalysisPanel
        key={caseId}
        caseId={caseId}
        resolved={item.status === 'RESOLVED'}
        onAnalyzed={onAnalyzed}
      />
      <div className="border-t border-slate-200 pt-4">
        <h3 className="text-sm font-bold text-slate-900">
          Conversation{' '}
          <span className="font-normal text-slate-500">
            ({detail.message_total} messages)
          </span>
        </h3>
        {detail.messages.length ? (
          <div className="mt-4 space-y-4">
            {detail.messages.map((m) => (
              <article
                key={m.id}
                className={`rounded-xl border p-4 ${m.direction === 'INBOUND' ? 'border-slate-200 bg-slate-50' : 'border-blue-100 bg-blue-50'}`}
              >
                <div className="flex flex-wrap justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-700">
                    {m.direction === 'INBOUND'
                      ? 'Customer message'
                      : 'CargoMove response'}
                  </span>
                  <time className="text-slate-500">
                    {supportTime(m.sent_at)}
                  </time>
                </div>
                <p className="mt-1 break-words text-[11px] text-slate-500">
                  From {m.sender_name || m.sender_email} · To{' '}
                  {m.recipient_email}
                </p>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                  {m.body_text || 'No supported text body is available.'}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            No messages have been stored for this case.
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
            className="rounded-lg border border-slate-300 px-3 py-2 font-semibold disabled:opacity-40"
          >
            Newer messages
          </button>
          <span className="text-slate-500">
            {detail.message_total
              ? `${offset + 1}–${Math.min(offset + 50, detail.message_total)} of ${detail.message_total}`
              : '0 messages'}
          </span>
          <button
            type="button"
            disabled={offset + 50 >= detail.message_total}
            onClick={() => setOffset(offset + 50)}
            className="rounded-lg border border-slate-300 px-3 py-2 font-semibold disabled:opacity-40"
          >
            Older messages
          </button>
        </div>
      </div>
    </div>
  );
}

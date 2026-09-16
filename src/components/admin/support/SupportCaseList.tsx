import React from 'react';
import type { SupportCaseRow } from '../../../types/support';
import { supportLabel, supportTime } from '../../../utils/support/status';
import { SupportStatusBadge } from './SupportStatusBadge';
export function SupportCaseList({
  cases,
  selectedId,
  onSelect,
}: {
  cases: SupportCaseRow[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  if (!cases.length)
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        No support cases match your search.
      </div>
    );
  return (
    <ul className="divide-y divide-slate-200">
      {cases.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={selectedId === item.id ? 'page' : undefined}
            className={`w-full p-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-blue-600 ${selectedId === item.id ? 'border-l-4 border-blue-600 bg-blue-50' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="truncate text-sm font-bold text-slate-900">
                {item.customer_name || item.customer_email}
              </span>
              <SupportStatusBadge status={item.status} />
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-slate-700">
              {item.subject || '(No subject)'}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-slate-500">
              {item.preview || 'No message preview available.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-slate-500">
              <span>{supportLabel(item.category)}</span>
              <span>·</span>
              <span>{supportLabel(item.port)}</span>
              {item.ai_confidence !== null && (
                <span>{Math.round(item.ai_confidence * 100)}% confidence</span>
              )}
            </div>
            <time className="mt-2 block text-[10px] text-slate-400">
              {supportTime(item.last_message_at || item.created_at)}
            </time>
          </button>
        </li>
      ))}
    </ul>
  );
}

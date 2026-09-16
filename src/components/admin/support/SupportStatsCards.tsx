import React from 'react';
import type { SupportStats } from '../../../types/support';
export function SupportStatsCards({ stats }: { stats: SupportStats | null }) {
  const cards = [
    ['New cases', 'new_cases'],
    ['Open cases', 'open_cases'],
    ['Need review', 'need_review'],
    ['AI drafts', 'ai_drafts'],
    ['Resolved today (UTC)', 'resolved_today'],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {cards.map(([label, key]) => (
        <div
          key={key}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {stats ? stats[key].toLocaleString() : '—'}
          </p>
        </div>
      ))}
    </div>
  );
}

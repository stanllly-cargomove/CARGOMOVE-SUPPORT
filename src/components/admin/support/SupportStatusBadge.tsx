import React from 'react';
import type { SupportStatus } from '../../../types/support';
import { SUPPORT_STATUS_LABELS } from '../../../utils/support/status';
const colors: Record<SupportStatus, string> = {
  NEW: 'bg-blue-50 text-blue-700 border-blue-200',
  ANALYZING: 'bg-violet-50 text-violet-700 border-violet-200',
  DRAFTED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
  WAITING_CUSTOMER: 'bg-slate-100 text-slate-700 border-slate-200',
  ESCALATED: 'bg-rose-50 text-rose-700 border-rose-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
export function SupportStatusBadge({ status }: { status: SupportStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${colors[status]}`}
    >
      {SUPPORT_STATUS_LABELS[status]}
    </span>
  );
}

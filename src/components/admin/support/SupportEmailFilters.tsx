import React from 'react';
import { Search } from 'lucide-react';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PORTS,
  SUPPORT_STATUSES,
} from '../../../types/support';
import type {
  SupportCaseFilters,
  SupportCasePage,
} from '../../../types/support';
import {
  supportLabel,
  SUPPORT_STATUS_LABELS,
} from '../../../utils/support/status';
const field =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700';
export function SupportEmailFilters({
  filters,
  onChange,
  assignees,
}: {
  filters: SupportCaseFilters;
  onChange: (filters: SupportCaseFilters) => void;
  assignees: SupportCasePage['assignees'];
}) {
  const set = (key: keyof SupportCaseFilters, value: string) =>
    onChange({ ...filters, [key]: value, offset: 0 });
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <label className="relative block">
        <span className="sr-only">
          Search customer, subject, message, or reference
        </span>
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          value={filters.q || ''}
          onChange={(e) => set('q', e.target.value)}
          maxLength={200}
          placeholder="Search customer, message, or reference…"
          className={`${field} pl-9`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <label className="text-[11px] font-semibold text-slate-500">
          Status
          <select
            className={`${field} mt-1`}
            value={filters.status || ''}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="">All statuses</option>
            {SUPPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SUPPORT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Category
          <select
            className={`${field} mt-1`}
            value={filters.category || ''}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">All categories</option>
            {SUPPORT_CATEGORIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Port
          <select
            className={`${field} mt-1`}
            value={filters.port || ''}
            onChange={(e) => set('port', e.target.value)}
          >
            <option value="">All ports</option>
            {SUPPORT_PORTS.map((s) => (
              <option key={s} value={s}>
                {supportLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Assigned staff
          <select
            className={`${field} mt-1`}
            value={filters.assigned_to || ''}
            onChange={(e) => set('assigned_to', e.target.value)}
          >
            <option value="">All staff</option>
            <option value="UNASSIGNED">Unassigned</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.email}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Confidence
          <select
            className={`${field} mt-1`}
            value={filters.confidence || ''}
            onChange={(e) => set('confidence', e.target.value)}
          >
            <option value="">All confidence</option>
            <option value="HIGH">90% or higher</option>
            <option value="MEDIUM">70–89%</option>
            <option value="LOW">Below 70%</option>
            <option value="NONE">Not analyzed</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => onChange({ offset: 0 })}
          className="self-end rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Clear filters
        </button>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-[11px] font-semibold text-slate-500">
          Created from
          <input
            type="date"
            value={filters.from || ''}
            onChange={(e) => set('from', e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Created through
          <input
            type="date"
            value={filters.to || ''}
            onChange={(e) => set('to', e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
      </div>
    </div>
  );
}

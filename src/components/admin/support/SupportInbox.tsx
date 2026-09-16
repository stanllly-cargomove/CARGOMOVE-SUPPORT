import React, { useEffect, useState } from 'react';
import { getSupportCases, getSupportStats } from '../../../services/support';
import type {
  SupportCaseFilters,
  SupportCasePage,
} from '../../../types/support';
import { useSupportResource } from '../../../hooks/support/useSupportResource';
import { SupportStatsCards } from './SupportStatsCards';
import { SupportEmailFilters } from './SupportEmailFilters';
import { SupportCaseList } from './SupportCaseList';
import { SupportCaseDetail } from './SupportCaseDetail';
import { SupportSyncControls } from './SupportSyncControls';
export function SupportInbox({
  caseId,
  onNavigate,
}: {
  caseId?: string;
  onNavigate: (path: string) => void;
}) {
  const [filters, setFilters] = useState<SupportCaseFilters>({ offset: 0 }),
    [query, setQuery] = useState(filters),
    [revision, setRevision] = useState(0);
  const [assignees, setAssignees] = useState<SupportCasePage['assignees']>([]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(filters), 300);
    return () => clearTimeout(timer);
  }, [filters]);
  const cases = useSupportResource(
    `cases:${JSON.stringify(query)}:${revision}`,
    (signal) => getSupportCases(query, signal),
  );
  const stats = useSupportResource(`stats:${revision}`, getSupportStats);
  useEffect(() => {
    if (cases.data) setAssignees(cases.data.assignees);
  }, [cases.data]);
  useEffect(() => {
    if (
      cases.data &&
      cases.data.total > 0 &&
      (query.offset || 0) >= cases.data.total
    ) {
      setFilters((previous) => ({
        ...previous,
        offset: Math.floor((cases.data.total - 1) / 20) * 20,
      }));
    }
  }, [cases.data, query.offset]);
  const offset = query.offset || 0,
    total = cases.data?.total || 0;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          AI Email Assistant
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          AI-assisted CargoMove customer support
        </p>
      </div>
      <SupportSyncControls onRefresh={() => setRevision((v) => v + 1)} />
      {stats.error && (
        <p role="alert" className="text-sm text-rose-700">
          {stats.error}
        </p>
      )}
      <SupportStatsCards stats={stats.data} />
      <SupportEmailFilters
        filters={filters}
        onChange={setFilters}
        assignees={assignees}
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,1fr)_minmax(0,1.7fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-4 text-xs font-semibold text-slate-500">
            {cases.loading
              ? 'Loading cases…'
              : cases.data
                ? `${total.toLocaleString()} matching cases`
                : 'Support cases'}
          </div>
          {cases.loading ? (
            <p className="p-8 text-sm text-slate-500" role="status">
              Loading inbox…
            </p>
          ) : cases.error ? (
            <p className="p-6 text-sm text-rose-700" role="alert">
              {cases.error}
            </p>
          ) : (
            <SupportCaseList
              cases={cases.data?.cases || []}
              selectedId={caseId}
              onSelect={(id) => onNavigate(`/admin/support/case/${id}`)}
            />
          )}
          <div className="flex items-center justify-between border-t border-slate-200 p-3 text-xs">
            <button
              type="button"
              disabled={cases.loading || offset === 0}
              onClick={() =>
                setFilters({ ...filters, offset: Math.max(0, offset - 20) })
              }
              className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-slate-500">
              {cases.data
                ? total
                  ? `${offset + 1}–${Math.min(offset + 20, total)} of ${total}`
                  : '0 cases'
                : '—'}
            </span>
            <button
              type="button"
              disabled={cases.loading || offset + 20 >= total}
              onClick={() => setFilters({ ...filters, offset: offset + 20 })}
              className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </section>
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {caseId ? (
            <SupportCaseDetail
              key={caseId}
              caseId={caseId}
              revision={revision}
              onAnalyzed={() => setRevision((v) => v + 1)}
              onBack={() => onNavigate('/admin/support/inbox')}
            />
          ) : (
            <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center">
              <h3 className="text-sm font-bold text-slate-700">
                Select a conversation
              </h3>
              <p className="mt-2 max-w-xs text-sm text-slate-500">
                Open a case to read customer messages and CargoMove responses.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

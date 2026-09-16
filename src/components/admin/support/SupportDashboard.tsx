import React, { useState } from 'react';
import { Inbox } from 'lucide-react';
import { getSupportCases, getSupportStats } from '../../../services/support';
import { useSupportResource } from '../../../hooks/support/useSupportResource';
import { supportLabel } from '../../../utils/support/status';
import { SupportStatsCards } from './SupportStatsCards';
import { SupportCaseList } from './SupportCaseList';
import { SupportSyncControls } from './SupportSyncControls';
export function SupportDashboard({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const stats = useSupportResource(`stats:${revision}`, getSupportStats);
  const cases = useSupportResource(`recent:${revision}`, (signal) =>
    getSupportCases({}, signal),
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            AI Support Dashboard
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            CargoMove customer support operations
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/admin/support/inbox')}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white"
        >
          <Inbox className="h-4 w-4" />
          Open support inbox
        </button>
      </div>
      <SupportSyncControls onRefresh={() => setRevision((v) => v + 1)} />
      {stats.error && (
        <p role="alert" className="text-sm text-rose-700">
          {stats.error}
        </p>
      )}
      <SupportStatsCards stats={stats.data} />
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h3 className="border-b border-slate-200 p-4 text-sm font-bold text-slate-900">
            Recent cases
          </h3>
          {cases.loading ? (
            <p className="p-6 text-sm text-slate-500" role="status">
              Loading recent cases…
            </p>
          ) : cases.error ? (
            <p className="p-6 text-sm text-rose-700" role="alert">
              {cases.error}
            </p>
          ) : (
            <SupportCaseList
              cases={cases.data?.cases.slice(0, 5) || []}
              onSelect={(id) => onNavigate(`/admin/support/case/${id}`)}
            />
          )}
        </section>
        <div className="space-y-5">
          {[
            ['Top issue categories', stats.data?.categories],
            ['Port distribution', stats.data?.ports],
          ].map(([title, values]) => (
            <section
              key={String(title)}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-bold text-slate-900">
                {String(title)}
              </h3>
              {Array.isArray(values) && values.length ? (
                <ul className="mt-4 space-y-3">
                  {values.map((v) => (
                    <li key={v.name}>
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>{supportLabel(v.name)}</span>
                        <span>{v.count}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{
                            width: `${stats.data?.total_cases ? (v.count / stats.data.total_cases) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-xs text-slate-500">
                  {stats.loading
                    ? 'Loading…'
                    : stats.error
                      ? 'Statistics unavailable.'
                      : 'No support cases yet.'}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

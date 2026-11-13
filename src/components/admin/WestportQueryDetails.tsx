import { ChevronUp, Clock3, Package, Ship } from 'lucide-react';
import { isWestportCategory, westportCategory, westportColumnLabel, westportDisplayValue } from '../../services/westportPresentation';
import { NpCategoryBadge } from './NpQueryRecord';

export function WestportQueryDetails({ columns, values, sourceIndex, onClose }: {
  columns: string[]; values: string[]; sourceIndex: number; onClose: () => void;
}) {
  const categoryIndex = columns.findIndex(isWestportCategory);
  const category = categoryIndex < 0 ? null : westportCategory(values[categoryIndex]);
  const containerIndex = columns.findIndex(column => /^container (?:no|number)$/i.test(column));
  const groups = [
    { title: 'Common Details', icon: Package, matches: (column: string) => !['VESSEL NAME', 'SCN', 'EXPORT SCN', 'STACKED TIME', 'SEQUENCE'].includes(column.toUpperCase()) },
    { title: 'Vessel / Voyage', icon: Ship, matches: (column: string) => ['VESSEL NAME', 'SCN', 'EXPORT SCN'].includes(column.toUpperCase()) },
    { title: 'Movement Details', icon: Clock3, matches: (column: string) => ['STACKED TIME', 'SEQUENCE'].includes(column.toUpperCase()) },
  ];
  return <section aria-labelledby="westport-details-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} className="np-query-summary np-detail-panel">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-4 sm:px-5">
      <div><div className="flex flex-wrap items-center gap-2"><h3 id="westport-details-title" className="text-sm font-bold text-slate-900">Container Details</h3>{containerIndex >= 0 && <span className="text-xs font-semibold text-blue-600">{values[containerIndex]}</span>}<NpCategoryBadge category={category} /></div><p className="mt-1 text-[11px] text-slate-500">Westport movement · Source record {sourceIndex + 1}</p></div>
      <button type="button" aria-label="Collapse movement details" onClick={onClose} className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronUp aria-hidden="true" className="h-4 w-4" />Collapse</button>
    </div>
    <div className="grid min-w-0 gap-4 px-4 pb-6 sm:px-5 xl:grid-cols-[1.3fr_1fr_1fr]">{groups.map(({ title, icon: Icon, matches }) => <section key={title} aria-label={title} className="np-info-card min-w-0">
      <div className="np-info-header"><Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><h4 className="text-[13px] font-semibold">{title}</h4></div>
      <dl>{columns.map((column, index) => matches(column) && <div key={index} className="np-field-row"><dt className="min-w-0 text-[11px] leading-4 text-slate-600">{westportColumnLabel(column)}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-xs font-medium leading-4 text-slate-900">{isWestportCategory(column) ? <NpCategoryBadge category={category} /> : westportDisplayValue(column, values[index]) || '—'}</dd></div>)}</dl>
    </section>)}</div>
  </section>;
}

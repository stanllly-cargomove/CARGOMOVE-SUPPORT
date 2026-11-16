import { ChevronUp, Clock3, FileCheck2, Globe2, Loader2, Package, Ship, Truck } from 'lucide-react';
import type { WestportDetailSection } from '../../../shared/westport-query';
import { isWestportCategory, westportCategory, westportColumnLabel, westportDisplayValue } from '../../services/westportPresentation';
import { NpCategoryBadge } from './NpQueryRecord';
import { QueryHoldsPopover } from './NpQueryPermissions';

const sectionGroups = [['Common Details'], ['Vessel/Voyage', 'Gate'], ['Timeline', 'eDO', 'Port']];
const icons = { 'Common Details': Package, 'Vessel/Voyage': Ship, Gate: Truck, Timeline: Clock3, eDO: FileCheck2, Port: Globe2 };

function DetailTable({ section }: { section: WestportDetailSection }) {
  const title = section.title === 'Vessel/Voyage' ? 'Vessel / Voyage' : section.title;
  return <div className="westport-detail-body overflow-x-auto">
      <table aria-label={`${title} details`} className="westport-detail-table w-full table-fixed border-collapse text-left text-xs">
        <thead className="bg-slate-50 text-slate-600"><tr>{section.columns.map((column, index) => <th key={index} scope="col" className={`border-b border-r border-slate-200 px-3 py-2 text-[10px] font-semibold last:border-r-0 ${index === 0 && section.columns.length === 3 ? 'w-[42%]' : ''}`}>{column || (index === 0 ? 'Item' : 'Details')}</th>)}</tr></thead>
        <tbody>{section.rows.map((row, rowIndex) => <tr key={rowIndex} className="even:bg-blue-50/60">{row.map((value, index) => index === 0
          ? <th key={index} scope="row" className="whitespace-pre-wrap break-words border-b border-r border-slate-100 px-3 py-2 text-[11px] font-normal leading-4 text-slate-600">{value || '—'}</th>
          : <td key={index} className="whitespace-pre-wrap break-words border-b border-r border-slate-100 px-3 py-2 font-medium leading-4 text-slate-900 last:border-r-0">{value || '—'}</td>)}</tr>)}{!section.rows.length && <tr><td colSpan={section.columns.length} className="px-3 py-3 text-slate-500">No holds reported by Westports.</td></tr>}</tbody>
      </table>
    </div>;
}

function DetailCard({ section }: { section: WestportDetailSection }) {
  const Icon = icons[section.title as keyof typeof icons] || Package;
  const title = section.title === 'Vessel/Voyage' ? 'Vessel / Voyage' : section.title;
  return <section aria-label={title} className="np-info-card min-w-0">
    <div className="np-info-header"><Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><h4 className="text-[13px] font-semibold">{title}</h4></div>
    <DetailTable section={section} />
  </section>;
}

export function WestportQueryDetails({ columns, values, sourceIndex, sections, loading, error, available, onRetry, onClose }: {
  columns: string[]; values: string[]; sourceIndex: number; sections?: WestportDetailSection[]; loading: boolean; error?: string; available: boolean; onRetry: () => void; onClose: () => void;
}) {
  const categoryIndex = columns.findIndex(isWestportCategory);
  const category = categoryIndex < 0 ? null : westportCategory(values[categoryIndex]);
  const containerIndex = columns.findIndex(column => /^container (?:no|number)$/i.test(column));
  const holds = sections?.find(section => section.title === 'Holds');
  return <section aria-labelledby="westport-details-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} className="np-query-summary np-detail-panel">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-4 sm:px-5">
      <div><div className="flex flex-wrap items-center gap-2"><h3 id="westport-details-title" className="text-sm font-bold text-slate-900">Container Details</h3>{containerIndex >= 0 && <span className="text-xs font-semibold text-blue-600">{values[containerIndex]}</span>}<NpCategoryBadge category={category} /></div><p className="mt-1 text-[11px] text-slate-500">Westport movement · Source record {sourceIndex + 1}</p></div>
      <div className="relative ml-auto flex items-center gap-2">
        {holds && <QueryHoldsPopover key={sourceIndex} label="Holds"><DetailTable section={holds} /></QueryHoldsPopover>}
        <button type="button" aria-label="Collapse movement details" onClick={onClose} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronUp aria-hidden="true" className="h-4 w-4" />Collapse</button>
      </div>
    </div>
    <div className="space-y-4 px-4 pb-6 sm:px-5">
      {loading && <p role="status" className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-700"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading full details from Westports…</p>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}<button type="button" onClick={onRetry} disabled={loading} className="ml-3 min-h-9 rounded-md border border-red-200 px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50">Retry details</button></div>}
      {!available && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Full ETP details are unavailable for this response. Movement table fields are shown below.</p>}
      {sections && <div className="np-record-grid westport-record-grid">{sectionGroups.map((titles, index) => <div key={index} className="np-record-column">{titles.map(title => { const section = sections.find(section => section.title === title); return section ? <DetailCard key={title} section={section} /> : null; })}</div>)}</div>}
      <section aria-label="Movement table fields" className="rounded-lg border border-slate-200 bg-white">
        <h4 className="px-3 py-3 text-xs font-semibold text-slate-600">Movement table fields</h4>
        <dl className="grid gap-x-6 px-3 pb-3 sm:grid-cols-2 xl:grid-cols-3">{columns.map((column, index) => <div key={index} className="np-field-row"><dt className="min-w-0 text-[11px] leading-4 text-slate-600">{westportColumnLabel(column)}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-xs font-medium leading-4 text-slate-900">{isWestportCategory(column) ? <NpCategoryBadge category={category} /> : westportDisplayValue(column, values[index]) || '—'}</dd></div>)}</dl>
      </section>
    </div>
  </section>;
}

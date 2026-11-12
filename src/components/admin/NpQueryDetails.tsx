import { ChevronUp } from 'lucide-react';
import { latestNpEvent, npDateKey, npShipping, type NpMovement } from '../../../shared/np-query';
import { NpCategoryBadge, NpRecordSections } from './NpQueryRecord';
import { NpQueryPermissions } from './NpQueryPermissions';
export function NpQueryDetails({ record, onClose }: { record: NpMovement; onClose: () => void }) {
  const evidence = latestNpEvent(record) ? 'Recorded Movement' : npDateKey(npShipping(record).eta) ? 'Upcoming/Scheduled Movement' : 'Source Movement';
  return <section aria-labelledby="np-details-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} className="np-query-summary np-detail-panel">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-4 sm:px-5">
      <div><div className="flex flex-wrap items-center gap-2"><h3 id="np-details-title" className="text-sm font-bold text-slate-900">Container Details</h3><span className="text-xs font-semibold text-blue-600">{record.containerNumber}</span><NpCategoryBadge category={record.category} /><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">Stage: {record.stage ?? '—'}</span></div><p className="mt-1 text-[11px] text-slate-500">{evidence} · Source record {record.sourceIndex + 1}</p></div>
      <div className="relative ml-auto flex items-center gap-2">
        <NpQueryPermissions key={record.sourceIndex} record={record} />
        <button type="button" aria-label="Collapse movement details" onClick={onClose} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronUp aria-hidden="true" className="h-4 w-4" />Collapse</button>
      </div>
    </div>
    <div className="space-y-4 px-4 pb-6 sm:px-5 sm:pb-7">
      <NpRecordSections record={record} />
    </div>
  </section>;
}

import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, CheckCircle2, Clock3, Info, Route, Ship, Truck } from 'lucide-react';
import { NP_FIELDS, formatNpDate, formatNpWeight, latestNpEvent, type NpField, type NpMovement } from '../../../shared/np-query';

const commonFields: NpField[] = ['containerNumber', 'category', 'fullEmpty', 'stage', 'operator', 'terminal', 'sizeType', 'grossWeight', 'vgm', 'agentSeal', 'agentName'];
const portFields: NpField[] = ['origin', 'pol', 'pod', 'destination'];
const yardFields: NpField[] = ['yardPosition', 'examineStack', 'modeIn', 'modeOut', 'haulageReceive', 'haulageDelivery'];
const timelineFields = ['timeIn', 'timeStack', 'timeRequestDelivery', 'timeLoadDelivery', 'timeOut'] as const;
const labels: Partial<Record<NpField, string>> = {
  operator: 'Line / Operator', sizeType: 'ISO / Size & Type', agentSeal: 'Agent Seal',
  grossWeight: 'Gross Weight (kg)', vgm: 'VGM (kg)', exportBookingNumber: 'Export Booking Number',
  haulageReceive: 'Haulage Receive', haulageDelivery: 'Haulage Delivery',
};

export function npFieldValue(record: NpMovement, field: NpField) {
  if (field === 'fullEmpty') return record.fullEmpty === 'F' ? 'Full (F)' : record.fullEmpty === 'E' ? 'Empty (E)' : '—';
  if (field.startsWith('time') || field.startsWith('eta')) return formatNpDate(record[field]);
  if (field === 'grossWeight' || field === 'vgm') return formatNpWeight(record[field]);
  return record[field] ?? '—';
}

export function NpCategoryBadge({ category }: { category: string | null }) {
  const color = category?.toLowerCase() === 'import' ? 'border-emerald-600 bg-emerald-600 text-white'
    : category?.toLowerCase() === 'export' ? 'border-red-500 bg-red-500 text-white'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return <span className={`inline-flex min-w-16 items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${color}`}>{category ?? '—'}</span>;
}

function RecordCard({ title, icon, children, description }: { title: string; icon: ReactNode; children: ReactNode; description?: string }) {
  return <section aria-label={title} className="np-info-card">
    <div className="np-info-header">
      <span aria-hidden="true" className="shrink-0">{icon}</span>
      <div className="min-w-0"><h4 className="text-[13px] font-semibold">{title}</h4>{description && <p className="text-[10px] leading-3.5 text-white/90">{description}</p>}</div>
    </div>
    {children}
  </section>;
}

function FieldRows({ record, fields }: { record: NpMovement; fields: NpField[] }) {
  return <dl>{fields.map(field => <div key={field} data-np-field={field} className="np-field-row">
    <dt className="min-w-0 text-[11px] leading-4 text-slate-600">{labels[field] ?? NP_FIELDS[field]}</dt>
    <dd className={`min-w-0 whitespace-pre-wrap break-words text-xs leading-4 ${record[field] === null ? 'text-slate-400' : 'font-medium text-slate-900'}`}>
      {field === 'category' ? <NpCategoryBadge category={record.category} /> : npFieldValue(record, field)}
    </dd>
  </div>)}</dl>;
}

function VesselCard({ record }: { record: NpMovement }) {
  const category = record.category?.toLowerCase();
  const rows: [string, NpField, NpField][] = [['Vessel Name', 'vesselImport', 'vesselExport'], ['SCN', 'scnImport', 'scnExport'], ['Vessel ETA', 'etaImport', 'etaExport']];
  return <RecordCard title="Vessel / Voyage" icon={<Ship className="h-4 w-4" />}>
    <div className="np-vessel-body"><table aria-label="Vessel information" className="np-vessel-table w-full table-fixed text-left text-xs">
      <thead><tr className="border-b border-slate-200 bg-slate-50 text-[10px] text-slate-500">
        <th scope="col" className="w-[26%] px-3 py-2 font-medium">Details</th>
        {(['import', 'export'] as const).map(direction => <th key={direction} scope="col" className={`w-[37%] px-3 py-2 font-semibold ${direction === 'import' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
          <span className="flex items-center gap-1 whitespace-nowrap">{direction === 'import' ? <ArrowDownToLine aria-hidden="true" className="h-3 w-3 shrink-0" /> : <ArrowUpFromLine aria-hidden="true" className="h-3 w-3 shrink-0" />}{direction === 'import' ? 'IN (IMPORT)' : 'OUT (EXPORT)'}</span>
        </th>)}
      </tr></thead>
      <tbody>{rows.map(([label, inbound, outbound]) => <tr key={label} className="border-b border-slate-100 last:border-0">
        <th scope="row" className="px-3 py-2.5 align-top text-[11px] font-normal text-slate-600">{label}</th>
        {[inbound, outbound].map(field => { const direction = field.endsWith('Import') ? 'import' : 'export'; return <td key={field} data-np-field={field} className={`break-words px-3 py-2.5 align-top text-xs leading-4 ${direction === 'import' ? 'bg-emerald-50' : 'bg-red-50'} ${category === direction ? 'font-medium text-slate-900' : 'text-slate-500'}`}>{npFieldValue(record, field)}</td>; })}
      </tr>)}</tbody>
    </table></div>
  </RecordCard>;
}

function TimelineCard({ record }: { record: NpMovement }) {
  const latest = latestNpEvent(record);
  return <RecordCard title="Timeline" icon={<Clock3 className="h-4 w-4" />} description="Actual operational timestamps">
    <ol className="np-timeline">{timelineFields.map(field => <li key={field} data-np-field={field} className={`np-timeline-item ${latest?.field === field ? 'bg-blue-50/70' : ''}`}>
      <span aria-hidden="true" className={`np-timeline-marker ${record[field] ? 'np-timeline-marker--recorded' : ''}`}>{record[field] && (latest?.field === field ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : <Check className="h-3 w-3" />)}</span>
      <div className="np-timeline-value-row"><span className={`np-timeline-label ${record[field] ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{NP_FIELDS[field]}{latest?.field === field && <span className="sr-only"> (Latest event)</span>}</span>
        <time className={`np-timeline-timestamp tabular-nums ${record[field] ? 'text-slate-800' : 'text-slate-400'}`}>{npFieldValue(record, field)}</time>
      </div>
    </li>)}</ol>
  </RecordCard>;
}

export function NpPermissionsContent({ record }: { record: NpMovement }) {
  return <dl className="np-holds-list">{([
      ['holdPermissions', 'Active Hold/Permissions'], ['grantedPermissions', 'Granted / Cleared Permissions'],
    ] as const).map(([field, label]) => <div key={field} data-np-field={field} className={`relative rounded-lg border px-3 py-2.5 ${record[field] ? field === 'holdPermissions' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-blue-50/50'}`}>
      <dt className="flex items-center gap-2 text-[10px] font-semibold text-slate-800">{field === 'grantedPermissions' && record[field] && <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-4 text-slate-800">{record[field] ?? '—'}</dd>
    </div>)}</dl>;
}

// Fixed field sets: every slot is rendered even when this movement has no value.
// Both IN and OUT values always come from this record, never another movement.
export function NpRecordSections({ record }: { record: NpMovement }) {
  const bookingFields: NpField[] = record.category?.toLowerCase() === 'export' ? ['exportBookingNumber', 'blNumber'] : ['blNumber', 'exportBookingNumber'];
  return <div className="np-record-layout"><div className="np-record-grid">
    <div className="np-record-column">
      <RecordCard title="Common Details" icon={<Info className="h-4 w-4" />}><FieldRows record={record} fields={[...bookingFields, ...commonFields]} /></RecordCard>
    </div>
    <div className="np-record-column">
      <RecordCard title="Yard & Haulage" icon={<Truck className="h-4 w-4" />}><FieldRows record={record} fields={yardFields} /></RecordCard>
      <VesselCard record={record} />
    </div>
    <div className="np-record-column">
      <TimelineCard record={record} />
      <RecordCard title="Port Routing" icon={<Route className="h-4 w-4" />}><FieldRows record={record} fields={portFields} /></RecordCard>
    </div>
  </div></div>;
}

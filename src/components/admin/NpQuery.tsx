import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { formatNpDate, formatNpWeight, normalizeContainerNumber, npShipping, validContainerNumber, type NpMovement, type NpQueryResult } from '../../../shared/np-query';
import { exportNpMovements } from '../../services/npQuery';
import { NpQueryDetails } from './NpQueryDetails';
import { NpExportIcon } from './NpExportIcon';
import { NpCategoryBadge as CategoryBadge } from './NpQueryRecord';
import northportLogo from '../../assets/ports/northport-n4.svg';
import westportLogo from '../../assets/ports/westport-transparent.png';
import kuantanLogo from '../../assets/ports/kuantan.png';
import penangLogo from '../../assets/ports/penang.png';
import kuantanIcon from '../../assets/ports/kuantan-icon.png';
import penangIcon from '../../assets/ports/penang-icon.png';

const ports = [
  { id: 'northport', name: 'Northport', logo: northportLogo, icon: northportLogo },
  { id: 'westport', name: 'Westport', logo: westportLogo, icon: westportLogo },
  { id: 'kuantan', name: 'Kuantan Port', logo: kuantanLogo, icon: kuantanIcon },
  { id: 'penang', name: 'Penang Port', logo: penangLogo, icon: penangIcon },
] as const;
type PortId = typeof ports[number]['id'];

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50';
const exportButton = 'inline-flex h-10 w-12 shrink-0 items-center justify-center rounded-lg transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const inputClass = 'min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60';
type SortColumn = 'category' | 'fullEmpty' | 'stage' | 'vessel' | 'scn' | 'eta' | 'yardPosition' | 'grossWeight' | 'vgm';
const columns: [SortColumn, string][] = [['category', 'Category'], ['fullEmpty', 'F/E'], ['stage', 'Stage'], ['vessel', 'Vessel Name'], ['scn', 'SCN'], ['eta', 'Vessel ETA'], ['yardPosition', 'Yard Position'], ['grossWeight', 'Gross Weight (kg)'], ['vgm', 'VGM (kg)']];
const centeredColumns = new Set<SortColumn>(['category', 'fullEmpty', 'stage', 'scn', 'yardPosition', 'grossWeight', 'vgm']);
function columnValue(record: NpMovement, column: SortColumn): string | null {
  return column === 'vessel' || column === 'scn' || column === 'eta' ? npShipping(record)[column] : record[column];
}
function compareDecimal(a: string, b: string) {
  const [ai, af = ''] = a.split('.'), [bi, bf = ''] = b.split('.');
  const ia = ai.replace(/^0+(?=\d)/, ''), ib = bi.replace(/^0+(?=\d)/, '');
  return ia.length - ib.length || ia.localeCompare(ib) || af.padEnd(Math.max(af.length, bf.length), '0').localeCompare(bf.padEnd(Math.max(af.length, bf.length), '0'));
}
export function NpQuery() {
  const [portId, setPortId] = useState<PortId>('northport');
  const port = ports.find(option => option.id === portId)!;
  const available = portId === 'northport';
  const [containerNumber, setContainerNumber] = useState('');
  const [result, setResult] = useState<NpQueryResult | null>(null);
  const [expandedSourceIndex, setExpandedSourceIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [filter, setFilter] = useState(''), [category, setCategory] = useState('All');
  const [sort, setSort] = useState<{ column: SortColumn; direction: 1 | -1 } | null>(null);
  const [pageSize, setPageSize] = useState(10), [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  async function search(value: string) {
    if (request.current || !available) return;
    const normalized = normalizeContainerNumber(value); setContainerNumber(normalized); setError('');
    if (!validContainerNumber(normalized)) { setError('Enter four letters (ending U, J or Z) followed by seven digits, e.g. SYLU5004458.'); return; }
    if (result?.containerNumber !== normalized) setResult(null);
    const controller = new AbortController(); request.current = controller; setLoading(true);
    const timer = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch('/api/dev-tools/np-query', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-cargomove-confirm': 'np-query' }, body: JSON.stringify({ containerNumber: normalized }) });
      const body = await response.json().catch(() => null);
      if (response.status === 404 && body?.error === 'No Northport records were found for this container.') {
        if (request.current !== controller) return;
        setResult({ success: true, containerNumber: normalized, queriedAt: new Date().toISOString(), totalMovements: 0, latestRecordedMovementIndex: null, movements: [] });
        setExpandedSourceIndex(null); setFilter(''); setCategory('All'); setSort(null); setPage(1);
        return;
      }
      if (!response.ok || body?.success !== true || !Array.isArray(body.movements)) throw new Error(body?.error || 'Northport returned an invalid response. Please try again.');
      if (request.current !== controller) return;
      setResult(body); setExpandedSourceIndex(null); setFilter(''); setCategory('All'); setSort(null); setPage(1);
    } catch (error) {
      if (request.current === controller) setError(controller.signal.aborted ? 'The query timed out. Please try again.' : error instanceof Error ? error.message : 'Unable to query Northport. Please try again.');
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const records = (result?.movements || []).filter(record => (category === 'All' || record.category?.toLowerCase() === category.toLowerCase()) && (!term || [...Object.values(record.rawFields), record.fullEmpty === 'F' ? 'Full' : record.fullEmpty === 'E' ? 'Empty' : null].some(value => value?.toLowerCase().includes(term))));
    if (sort) records.sort((a, b) => {
      const av = columnValue(a, sort.column), bv = columnValue(b, sort.column);
      if (av === null || bv === null) return av === bv ? a.sourceIndex - b.sourceIndex : av === null ? 1 : -1;
      const compared = sort.column === 'grossWeight' || sort.column === 'vgm' ? compareDecimal(av, bv) : av.localeCompare(bv, undefined, { numeric: true });
      return compared * sort.direction || a.sourceIndex - b.sourceIndex;
    });
    return records;
  }, [result, filter, category, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages);
  const visibleRecords = filtered.slice((current - 1) * pageSize, current * pageSize);
  const expandedRecord = visibleRecords.find(record => record.sourceIndex === expandedSourceIndex);
  function toggleMovement(sourceIndex: number) {
    const opening = sourceIndex !== expandedSourceIndex;
    setExpandedSourceIndex(opening ? sourceIndex : null);
    if (opening) requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  }
  function collapseDetails() {
    const trigger = document.getElementById(`np-movement-toggle-${expandedSourceIndex}`);
    setExpandedSourceIndex(null);
    trigger?.focus();
  }
  function changePage(next: number) { setPage(next); setExpandedSourceIndex(null); }

  async function download(format: 'csv' | 'xlsx' | 'pdf') {
    if (!available || !result || exporting) return;
    setExporting(true);
    try { await exportNpMovements(filtered, result.containerNumber, format); }
    catch { setError('Unable to export movements. Please try again.'); }
    finally { setExporting(false); }
  }
  function reset(focusInput = true) { setContainerNumber(''); setResult(null); setExpandedSourceIndex(null); setError(''); setFilter(''); setCategory('All'); setSort(null); setPage(1); if (focusInput) document.getElementById('np-container-number')?.focus(); }
  return <div className="w-full min-w-0 space-y-4 pb-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 basis-[240px] flex-1"><h2 className="text-xl font-bold tracking-tight text-slate-900">Container Query</h2><p className="mt-1 text-xs text-slate-500">Search container records and view Import/Export movement history by port.</p></div>
      <div className="flex shrink-0 items-center gap-3">
        <div><label htmlFor="container-query-port" className="sr-only">Port</label><select id="container-query-port" value={portId} disabled={loading || exporting} onChange={event => { reset(false); setPortId(event.target.value as PortId); }} className={inputClass}>{ports.map(option => <option key={option.id} value={option.id}>{option.name}{option.id !== 'northport' ? ' — Coming soon' : ''}</option>)}</select></div>
        <div role="img" aria-label={`${port.name}: ${available ? 'Queries available' : 'Coming soon'}`} title={`${port.name} · ${available ? 'Queries available' : 'Coming soon'}`} className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition-transform hover:-translate-y-0.5">
          <img src={port.icon} alt="" className="h-9 w-9 object-contain" />
          <span aria-hidden="true" className={`pointer-events-none absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-white shadow-sm ${available ? 'bg-emerald-500' : 'bg-amber-400'}`} />
        </div>
      </div>
    </div>
    <section aria-label="Container search">
      <form onSubmit={event => { event.preventDefault(); void search(containerNumber); }} className="flex flex-wrap items-center gap-2">
        <div className="flex h-11 min-w-0 basis-[240px] flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white pl-3 pr-[5px] shadow-sm focus-within:ring-2 focus-within:ring-sky-300">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-700" />
          <label htmlFor="np-container-number" className="sr-only">Container Number</label>
          <input id="np-container-number" type="search" value={containerNumber} onChange={event => setContainerNumber(event.target.value)} onBlur={() => setContainerNumber(normalizeContainerNumber(containerNumber))} placeholder="Search container number" disabled={loading || !available} maxLength={64} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-invalid={!!error && !validContainerNumber(normalizeContainerNumber(containerNumber))} aria-describedby={error ? 'np-query-error' : undefined} className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-search-cancel-button]:appearance-none" />
          {(containerNumber || result || error) && <button type="button" aria-label="Clear / Reset" title="Clear / Reset" disabled={loading || !available} onClick={() => reset()} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 transition-colors hover:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>}
          <button type="submit" disabled={loading || !available} aria-busy={loading} className="relative inline-flex h-8 w-24 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"><Loader2 aria-hidden="true" className={`absolute left-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : 'invisible'}`} />Search</button>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {([{ format: 'csv', label: 'CSV', color: '#00b9bd' }, { format: 'xlsx', label: 'Excel', color: '#1fbd3a' }, { format: 'pdf', label: 'PDF', color: '#ec008c' }] as const).map(({ format, label, color }) =>
            <button key={format} type="button" aria-label={label} title={`Download ${label}`} disabled={!available || loading || !filtered.length || exporting} onClick={() => void download(format)} className={exportButton} style={{ backgroundColor: color, color }}><NpExportIcon format={format} /></button>)}
        </div>
      </form>
      {loading && <span role="status" className="sr-only">Retrieving records from Northport…</span>}
      {error && <p id="np-query-error" role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}{result ? ' Showing the last successful query below.' : ''}</p>}
    </section>
    {!result && !loading && <section aria-label={available ? 'Container query prompt' : `${port.name} coming soon`} className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center"><img src={port.logo} alt={`${port.name} logo`} className="h-14 w-44 object-contain" /><h3 className="mt-4 text-sm font-semibold text-slate-700">{available ? 'Search a container to view its movements' : `${port.name} queries are coming soon`}</h3>{available && <p className="mt-1 text-xs text-slate-500">Read-only enquiry using Northport’s public records.</p>}</section>}
    {available && result && <>
      <section aria-labelledby="np-movement-title" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-3 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="np-movement-title" className="text-sm font-bold text-slate-900">Container Movement <span className="ml-1 text-xs font-normal text-slate-500">({result.totalMovements})</span></h3><p className="mt-1 text-[11px] text-slate-500">{result.containerNumber} {'\u00b7'} <span data-np-query-updated>Updated {new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(result.queriedAt))} MYT</span></p></div></div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><input aria-label="Filter movements" placeholder="Filter movement records…" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); setExpandedSourceIndex(null); }} className={inputClass + ' min-w-0 flex-1'} /><select aria-label="Category filter" value={category} onChange={event => { setCategory(event.target.value); setPage(1); setExpandedSourceIndex(null); }} className={inputClass}>{['All', 'Import', 'Export'].map(value => <option key={value} value={value}>{value === 'All' ? 'All categories' : value}</option>)}</select></div>
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable container movements">
          <table aria-label="Container Movement" className="w-full min-w-[1100px] text-left text-xs">
            <thead className="bg-[#08245b] text-white"><tr>
              {columns.map(([column, label]) => <th key={column} scope="col" title={column === 'fullEmpty' ? 'F = Full, E = Empty. Only shown when supplied by Northport.' : undefined} aria-sort={sort?.column === column ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'} className={`whitespace-nowrap border-r border-white/30 px-3 py-3 text-[10px] last:border-r-0 ${centeredColumns.has(column) ? 'text-center' : ''} ${column === 'category' ? 'min-w-[112px]' : ''}`}>
                <button type="button" onClick={() => { setSort(sort?.column !== column ? { column, direction: 1 } : sort.direction === 1 ? { column, direction: -1 } : null); setPage(1); setExpandedSourceIndex(null); }} className={`inline-flex items-center gap-1 uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${centeredColumns.has(column) ? 'w-full justify-center' : ''}`}>{label}{sort?.column === column && (sort.direction === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</button>
              </th>)}
            </tr></thead>
            <tbody>{visibleRecords.map(record => <tr key={record.sourceIndex} onClick={() => toggleMovement(record.sourceIndex)} className={`cursor-pointer border-b border-slate-100 transition-colors ${expandedSourceIndex === record.sourceIndex ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'even:bg-slate-50 hover:bg-blue-50/70'}`}>
              {columns.map(([column]) => <td key={column} className={`relative whitespace-nowrap px-3 py-3 text-slate-600 ${centeredColumns.has(column) ? 'text-center' : ''}`}>
                {column === 'category' ? <><button id={`np-movement-toggle-${record.sourceIndex}`} type="button" aria-label={`${expandedSourceIndex === record.sourceIndex ? 'Collapse' : 'Expand'} ${record.category ?? ''} movement, source record ${record.sourceIndex + 1}`} aria-expanded={expandedSourceIndex === record.sourceIndex} aria-controls="np-movement-details" onClick={event => { event.stopPropagation(); toggleMovement(record.sourceIndex); }} className="absolute left-1 top-1/2 inline-flex min-h-9 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${expandedSourceIndex === record.sourceIndex ? 'rotate-90 text-blue-600' : ''}`} /></button><CategoryBadge category={record.category} /></>
                  : column === 'fullEmpty' ? <span title={record.fullEmpty === 'F' ? 'Full' : record.fullEmpty === 'E' ? 'Empty' : 'Not provided by Northport'} className="font-medium">{record.fullEmpty ?? '\u2014'}</span>
                  : column === 'stage' ? <span className={record.stage?.toLowerCase() === 'departed' ? 'rounded-full bg-slate-100 px-2 py-1 text-slate-600' : ''}>{record.stage ?? '\u2014'}</span>
                  : column === 'grossWeight' || column === 'vgm' ? formatNpWeight(record[column])
                  : column === 'eta' ? formatNpDate(columnValue(record, column))
                  : columnValue(record, column) ?? '\u2014'}
              </td>)}
            </tr>)}{visibleRecords.length === 1 && <tr aria-hidden="true" className="h-[54px] border-b border-slate-100 bg-slate-50">{columns.map(([column]) => <td key={column} />)}</tr>}{!filtered.length && <tr><td colSpan={columns.length} className="h-[108px] p-6 text-center text-slate-500">No data available in table</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-slate-500"><span role="status">{filtered.length ? `${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, filtered.length)} of ${filtered.length} movements` : '0 of 0 movements'}</span><div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2">Rows per page<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); setExpandedSourceIndex(null); }} className={inputClass}>{[10, 20, 50].map(size => <option key={size}>{size}</option>)}</select></label><button type="button" aria-label="Previous movement page" disabled={current <= 1} onClick={() => changePage(current - 1)} className={button + ' !px-2'}><ChevronLeft className="h-4 w-4" /></button><span>{current} / {pages}</span><button type="button" aria-label="Next movement page" disabled={current >= pages} onClick={() => changePage(current + 1)} className={button + ' !px-2'}><ChevronRight className="h-4 w-4" /></button></div></div>
      </section>
      <div id="np-movement-details" ref={detailsRef} hidden={!expandedRecord} className="scroll-mt-16">{expandedRecord && <NpQueryDetails record={expandedRecord} onClose={collapseDetails} />}</div>
    </>}
  </div>;
}

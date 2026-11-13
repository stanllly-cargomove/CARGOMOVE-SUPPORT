import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { normalizeContainerNumber, validContainerNumber } from '../../../shared/np-query';
import type { WestportQueryResult } from '../../../shared/westport-query';
import { exportWestportMovements } from '../../services/westportQuery';
import { isWestportCategory, isWestportStackedTime, westportCategory, westportColumnLabel, westportDisplayValue, westportStackedTimeKey } from '../../services/westportPresentation';
import westportLogo from '../../assets/ports/westport-transparent.png';
import { NpExportIcon } from './NpExportIcon';
import { NpCategoryBadge } from './NpQueryRecord';
import { WestportQueryDetails } from './WestportQueryDetails';

const inputClass = 'min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60';
const buttonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50';

export function WestportQuery({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [containerNumber, setContainerNumber] = useState('');
  const [result, setResult] = useState<WestportQueryResult | null>(null);
  const [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState('');
  const [filter, setFilter] = useState(''), [pageSize, setPageSize] = useState(2), [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const busy = loading || exporting;
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { request.current?.abort(); request.current = null; onBusyChange(false); }, [onBusyChange]);

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const rows = (result?.movements || []).map((values, sourceIndex) => ({ values, sourceIndex })).filter(({ values }) => !term || values.some((value, index) => value.toLowerCase().includes(term) || westportDisplayValue(result.columns[index], value).toLowerCase().includes(term)));
    if (sort) rows.sort((a, b) => {
      const column = result.columns[sort.column];
      const av = isWestportStackedTime(column) ? westportStackedTimeKey(a.values[sort.column]) || a.values[sort.column] : westportDisplayValue(column, a.values[sort.column]);
      const bv = isWestportStackedTime(column) ? westportStackedTimeKey(b.values[sort.column]) || b.values[sort.column] : westportDisplayValue(column, b.values[sort.column]);
      return av.localeCompare(bv, undefined, { numeric: true }) * sort.direction || a.sourceIndex - b.sourceIndex;
    });
    return rows;
  }, [result, filter, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);
  const selectedRecord = visible.find(record => record.sourceIndex === selectedIndex);
  function toggleMovement(sourceIndex: number) {
    const opening = selectedIndex !== sourceIndex;
    setSelectedIndex(opening ? sourceIndex : null);
    if (opening) requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  }
  function collapseDetails() {
    const trigger = document.getElementById(`westport-movement-toggle-${selectedIndex}`);
    setSelectedIndex(null); trigger?.focus();
  }
  function changePage(next: number) { setPage(next); setSelectedIndex(null); }

  async function search() {
    if (request.current || exporting) return;
    const normalized = normalizeContainerNumber(containerNumber);
    setContainerNumber(normalized); setError('');
    if (!validContainerNumber(normalized)) { setError('Enter four letters (ending U, J or Z) followed by seven digits, e.g. ABCU1234567.'); return; }
    if (result?.containerNumber !== normalized) setResult(null);
    const controller = new AbortController(); request.current = controller; setLoading(true);
    const timer = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch('/api/dev-tools/np-query', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-cargomove-confirm': 'np-query' }, body: JSON.stringify({ port: 'westport', containerNumber: normalized }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) throw new Error(body?.error || 'Westport returned an invalid response. Please try again.');
      if (body.port !== 'westport' || body.containerNumber !== normalized || !Array.isArray(body.columns) || !body.columns.length || !body.columns.every((column: unknown) => typeof column === 'string') || !Array.isArray(body.movements) || !body.movements.every((row: unknown) => Array.isArray(row) && row.length === body.columns.length && row.every(value => typeof value === 'string')) || !Number.isFinite(Date.parse(body.queriedAt))) {
        throw new Error('Westport returned an invalid movement response. Please try again.');
      }
      if (request.current !== controller) return;
      setResult(body); setFilter(''); setSort(null); setPage(1); setSelectedIndex(null);
    } catch (failure) {
      if (request.current === controller) setError(controller.signal.aborted ? 'The query timed out. Please try again.' : failure instanceof Error ? failure.message : 'Unable to query Westport. Please try again.');
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  function reset() {
    setContainerNumber(''); setResult(null); setError(''); setFilter(''); setSort(null); setPage(1); setSelectedIndex(null);
    document.getElementById('westport-container-number')?.focus();
  }
  async function download(format: 'csv' | 'xlsx' | 'pdf') {
    if (!result || busy || !filtered.length) return;
    setExporting(true);
    try { await exportWestportMovements({ columns: result.columns, movements: filtered.map(record => record.values) }, result.containerNumber, format); }
    catch { setError('Unable to export movements. Please try again.'); }
    finally { setExporting(false); }
  }

  return <div className="min-w-0 space-y-4">
    <section aria-label="Container search">
      <form onSubmit={event => { event.preventDefault(); void search(); }} className="flex flex-wrap items-center gap-2">
        <div className="flex h-11 min-w-0 basis-[240px] flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white pl-3 pr-[5px] shadow-sm focus-within:ring-2 focus-within:ring-sky-300">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-700" />
          <label htmlFor="westport-container-number" className="sr-only">Container Number</label>
          <input id="westport-container-number" type="search" value={containerNumber} onChange={event => setContainerNumber(event.target.value)} onBlur={() => setContainerNumber(normalizeContainerNumber(containerNumber))} placeholder="Search container number" disabled={busy} maxLength={64} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-invalid={!!error && !validContainerNumber(normalizeContainerNumber(containerNumber))} aria-describedby={error ? 'westport-query-error' : undefined} className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none disabled:opacity-60 [&::-webkit-search-cancel-button]:appearance-none" />
          {(containerNumber || result || error) && <button type="button" aria-label="Clear / Reset" title="Clear / Reset" disabled={busy} onClick={reset} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>}
          <button type="submit" disabled={busy} aria-busy={loading} className="relative inline-flex h-8 w-24 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"><Loader2 aria-hidden="true" className={`absolute left-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : 'invisible'}`} />Search</button>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {([{ format: 'csv', label: 'CSV', color: '#00b9bd' }, { format: 'xlsx', label: 'Excel', color: '#1fbd3a' }, { format: 'pdf', label: 'PDF', color: '#ec008c' }] as const).map(({ format, label, color }) => <button key={format} type="button" aria-label={label} title={`Download ${label}`} disabled={busy || !filtered.length} onClick={() => void download(format)} style={{ backgroundColor: color, color }} className="inline-flex h-10 w-12 shrink-0 items-center justify-center rounded-lg transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"><NpExportIcon format={format} /></button>)}
        </div>
      </form>
      {loading && <span role="status" className="sr-only">Retrieving records from Westport…</span>}
      {error && <p id="westport-query-error" role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}{result ? ' Showing the last successful query below.' : ''}</p>}
    </section>
    {!result && !loading && <section aria-label="Container query prompt" className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center"><img src={westportLogo} alt="Westport logo" className="h-14 w-44 object-contain" /><h3 className="mt-4 text-sm font-semibold text-slate-700">Search a container to view its movements</h3><p className="mt-1 text-xs text-slate-500">Read-only enquiry using the company’s Westports account.</p></section>}
    {result && <section aria-labelledby="westport-movement-title" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-3 p-4 sm:p-5"><div><h3 id="westport-movement-title" className="text-sm font-bold text-slate-900">Container Movement <span className="ml-1 text-xs font-normal text-slate-500">({result.totalMovements})</span></h3><p className="mt-1 text-[11px] text-slate-500">{result.containerNumber} · Updated {new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(result.queriedAt))} MYT</p><p className="mt-1 text-[11px] text-slate-500">Westports source order.</p></div>
        <input aria-label="Filter movements" placeholder="Filter movement records…" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); setSelectedIndex(null); }} className={inputClass + ' w-full'} />
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable container movements">
        <table aria-label="Container Movement" className="w-full min-w-[1100px] text-left text-xs"><thead className="bg-[#08245b] text-white"><tr>{result.columns.map((column, index) => <th key={index} scope="col" aria-sort={sort?.column === index ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'} className={`whitespace-nowrap border-r border-white/30 px-3 py-3 text-[10px] last:border-r-0 ${isWestportCategory(column) ? 'min-w-[112px] text-center' : ''}`}><button type="button" onClick={() => { setSort(sort?.column !== index ? { column: index, direction: 1 } : sort.direction === 1 ? { column: index, direction: -1 } : null); setPage(1); setSelectedIndex(null); }} className={`inline-flex items-center gap-1 uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${isWestportCategory(column) ? 'w-full justify-center' : ''}`}>{westportColumnLabel(column)}{sort?.column === index && (sort.direction === 1 ? <ArrowUp aria-hidden="true" className="h-3 w-3" /> : <ArrowDown aria-hidden="true" className="h-3 w-3" />)}</button></th>)}</tr></thead>
          <tbody>{visible.map(({ values, sourceIndex }) => <tr key={sourceIndex} onClick={() => toggleMovement(sourceIndex)} className={`cursor-pointer border-b border-slate-100 transition-colors ${selectedIndex === sourceIndex ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'even:bg-slate-50 hover:bg-blue-50/70'}`}>{values.map((value, index) => <td key={index} className={`relative whitespace-nowrap px-3 py-3 text-slate-600 ${isWestportCategory(result.columns[index]) ? 'text-center' : ''}`}>{isWestportCategory(result.columns[index]) ? <><button id={`westport-movement-toggle-${sourceIndex}`} type="button" aria-label={`${selectedIndex === sourceIndex ? 'Collapse' : 'Expand'} ${westportCategory(value) || ''} movement, source record ${sourceIndex + 1}`} aria-expanded={selectedIndex === sourceIndex} aria-controls="westport-movement-details" onClick={event => { event.stopPropagation(); toggleMovement(sourceIndex); }} className="absolute left-1 top-1/2 inline-flex min-h-9 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${selectedIndex === sourceIndex ? 'rotate-90 text-blue-600' : ''}`} /></button><NpCategoryBadge category={westportCategory(value)} /></> : westportDisplayValue(result.columns[index], value) || '—'}</td>)}</tr>)}{!filtered.length && <tr><td colSpan={result.columns.length} className="h-[108px] p-6 text-center text-slate-500">No data available in table</td></tr>}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-slate-500"><span role="status">{filtered.length ? `${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, filtered.length)} of ${filtered.length} movements` : '0 of 0 movements'}</span><div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2">Rows per page<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); setSelectedIndex(null); }} className={inputClass}>{[2, 10, 20, 50].map(size => <option key={size}>{size}</option>)}</select></label><button type="button" aria-label="Previous movement page" disabled={current <= 1} onClick={() => changePage(current - 1)} className={buttonClass}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button><span>{current} / {pages}</span><button type="button" aria-label="Next movement page" disabled={current >= pages} onClick={() => changePage(current + 1)} className={buttonClass}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button></div></div>
    </section>}
    <div id="westport-movement-details" ref={detailsRef} hidden={!selectedRecord} className="scroll-mt-16">{selectedRecord && <WestportQueryDetails columns={result.columns} values={selectedRecord.values} sourceIndex={selectedRecord.sourceIndex} onClose={collapseDetails} />}</div>
  </div>;
}

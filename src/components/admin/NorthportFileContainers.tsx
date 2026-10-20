import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';

export type ContainerFileSource = { filename: string; token: string; kind: 'file' | 'record' };
type ContainerRecord = { container: string; record: number; number: string; fullEmpty: string };

function fullEmptyLabel(value: string) {
  const code = value?.trim().toUpperCase();
  return code === 'F' || code === 'FULL' ? 'FULL' : code === 'E' || code === 'EMPTY' ? 'EMPTY' : '—';
}

export function NorthportFileContainers({ source, onClose }: { source: ContainerFileSource; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [containers, setContainers] = useState<ContainerRecord[]>([]);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { dialog?.close(); document.body.style.overflow = previous; if (trigger?.isConnected) trigger.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError('');
      try {
        // Browsing shares the recovery API rate limit. Wait once if a search
        // just finished; closing the dialog cancels both the wait and request.
        let response: Response;
        for (let retry = 0; ; retry++) {
          response = await fetch('/api/dev-tools/northport-recovery', {
            method: 'POST', credentials: 'same-origin', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'northport-recovery' },
            body: JSON.stringify({ action: 'list-containers', token: source.token, kind: source.kind }),
          });
          if (response.status !== 429 || retry > 0) break;
          await new Promise<void>((resolve, reject) => {
            const abort = () => { window.clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
            const timer = window.setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 5100);
            controller.signal.addEventListener('abort', abort, { once: true });
          });
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load containers in this file.');
        if (!Array.isArray(data.containers)) throw new Error('The file returned an unexpected response.');
        if (!controller.signal.aborted) setContainers(data.containers);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load containers in this file.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [source.token, source.kind, attempt]);
  const filtered = containers.filter(row => row.container.toUpperCase().includes(query.trim().toUpperCase()));
  return <dialog ref={dialogRef} aria-labelledby="northport-containers-title" onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50">
    <div className="flex h-[544px] max-h-[calc(90dvh-2px)] flex-col">
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-2">
      <div className="min-w-0"><h3 id="northport-containers-title" className="text-sm font-bold">Containers in source file</h3><p title={source.filename} className="truncate text-xs text-slate-500">{source.filename}</p></div>
      <button type="button" aria-label="Close container list" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X aria-hidden="true" className="h-5 w-5"/></button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="shrink-0">
      <label htmlFor="northport-file-container-search" className="mb-2 block text-xs font-medium">Search container number</label>
      <div className="relative"><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-slate-400"/><input id="northport-file-container-search" type="search" placeholder="Enter all or part of a container number" value={query} onChange={event => { setQuery(event.target.value); setLimit(100); }} className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"/></div>
      </div>
      {loading ? <p role="status" className="mt-4 flex items-center gap-2 text-xs text-blue-700"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin"/>Loading containers...</p> : error ? <div role="alert" className="mt-4 text-xs text-red-700"><p>{error}</p><button type="button" className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-slate-700" onClick={() => setAttempt(value => value+1)}>Try again</button></div> : <>
        <p role="status" className="my-3 shrink-0 text-xs text-slate-500">{filtered.length} {filtered.length === 1 ? 'container' : 'containers'} found {query.trim() ? 'matching your search' : 'in this file'}</p>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-300 shadow-sm">
          <table className="w-full text-left text-xs leading-4"><thead className="sticky top-0 bg-slate-200 text-slate-700"><tr className="h-8"><th scope="col" className="whitespace-nowrap border-r border-slate-300 px-3 py-1.5">Container No.</th><th scope="col" className="whitespace-nowrap border-r border-slate-300 px-3 py-1.5 text-center">{/_GP\.csv$/i.test(source.filename) ? 'GP Number' : 'EXP Number'}</th><th scope="col" className="whitespace-nowrap px-3 py-1.5 text-center">F/E</th></tr></thead><tbody>{filtered.slice(0,limit).map(row => <tr key={row.record} className="h-8 border-t border-slate-200 even:bg-slate-50"><td className="whitespace-nowrap border-r border-slate-200 px-3 py-1.5 font-medium">{row.container}</td><td className="whitespace-nowrap border-r border-slate-200 px-3 py-1.5 text-center text-slate-600">{row.number || '—'}</td><td className="whitespace-nowrap px-3 py-1.5 text-center font-medium text-slate-700">{fullEmptyLabel(row.fullEmpty)}</td></tr>)}</tbody></table>
          {!filtered.length && <p className="p-4 text-xs text-slate-500">{containers.length ? 'No containers match your search.' : 'This file contains no container records.'}</p>}
          {filtered.length > limit && <button type="button" className="w-full p-3 text-xs font-medium text-blue-700 hover:bg-blue-50" onClick={() => setLimit(value => value+100)}>Show more containers</button>}
        </div>
      </>}
    </div>
    </div>
  </dialog>;
}

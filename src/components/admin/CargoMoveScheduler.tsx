import React, { useEffect, useRef, useState } from 'react';
import { Clock, Loader2, Play, Plus, X } from 'lucide-react';
import { notifyError, notifySuccess } from '../common/notifications';
import type { SavedScheduler } from '../../types/scheduler';

type Result = { status: string; message: string; timestamp: string; lastRunVerification?: { status: 'ADVANCED' | 'UNCHANGED' | 'UNAVAILABLE'; before: string | null; after: string | null; observedAt: string } };

export function CargoMoveScheduler() {
  const [schedulers, setSchedulers] = useState<SavedScheduler[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SavedScheduler | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState({ displayName: '', origin: '', url: '', description: '' });
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const pending = useRef(false);
  const savePending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const response = await fetch('/api/dev-tools/schedulers', { credentials: 'same-origin', signal: controller.signal });
        const data = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(data?.schedulers)) throw new Error(data?.error || 'Unable to load scheduler gallery. Check that the API is running and the gallery migration is applied.');
        if (!controller.signal.aborted) setSchedulers(data.schedulers);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Unable to load scheduler gallery.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [refresh]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch('/api/dev-tools/schedulers', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'manage-schedulers' },
        body: JSON.stringify(draft),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.scheduler?.id) throw new Error(data?.error || 'Unable to save the scheduler. Check the API and gallery migration.');
      setSchedulers(previous => [...previous, data.scheduler]);
      setDraft({ displayName: '', origin: '', url: '', description: '' });
      setShowForm(false);
      notifySuccess('Scheduler saved to the gallery.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the scheduler.';
      setFormError(message);
      notifyError(message);
    } finally { setSaving(false); savePending.current = false; }
  };

  const update = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || savePending.current) return;
    savePending.current = true; setSaving(true); setFormError('');
    try {
      const response = await fetch('/api/dev-tools/schedulers', { method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'manage-schedulers' },
        body: JSON.stringify({ id: editing.id, ...draft }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.scheduler?.id) throw new Error(data?.error || 'Unable to update the scheduler.');
      setSchedulers(previous => previous.map(item => item.id === editing.id ? data.scheduler : item));
      setEditing(null); setDraft({ displayName: '', origin: '', url: '', description: '' });
      notifySuccess('Scheduler updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update the scheduler.';
      setFormError(message); notifyError(message);
    } finally { setSaving(false); savePending.current = false; }
  };

  const run = async (scheduler: SavedScheduler) => {
    if (pending.current || !scheduler.enabled || !window.confirm(`Trigger ${scheduler.displayName} (${scheduler.workerName}) on the production CargoMove system?`)) return;
    pending.current = true;
    setRunningId(scheduler.id);
    setResults(previous => { const next = { ...previous }; delete next[scheduler.id]; return next; });
    try {
      const response = await fetch('/api/dev-tools/run-scheduler', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'run-scheduler' },
        body: JSON.stringify({ schedulerId: scheduler.id }),
      });
      let data = await response.json().catch(() => null);
      if (!data?.status || !data?.message) {
        const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const detail = response.status === 404 ? 'Scheduler API was not found. Deploy the updated backend route.'
          : local && response.status >= 500 ? 'Local scheduler API is unavailable. Start npm run dev:api and check its terminal output.'
          : response.status === 504 ? 'The scheduler API timed out.' : 'The scheduler API did not return a valid result. Check the Vercel function logs.';
        data = { status: 'unknown', timestamp: new Date().toISOString(), message: `${detail} (HTTP ${response.status}). Check CargoMove Scheduled Tasks before attempting another run.` };
      }
      setResults(previous => ({ ...previous, [scheduler.id]: data }));
      if (response.ok && data.status === 'trigger_requested') notifySuccess(data.message);
      else notifyError(data.message);
    } catch {
      const message = 'Unable to confirm the result. Check CargoMove Scheduled Tasks before attempting another run.';
      setResults(previous => ({ ...previous, [scheduler.id]: { status: 'unknown', message, timestamp: new Date().toISOString() } }));
      notifyError(message);
    } finally { pending.current = false; setRunningId(null); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Clock className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">CargoMove Scheduler</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">Save and run CargoMove schedulers from one place.</p>
          </div>
        </div>
        <button type="button" disabled={loading || Boolean(loadError)} onClick={() => { setShowForm(true); setFormError(''); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Plus className="h-4 w-4" />Add Scheduler</button>
      </div>

      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setShowForm(false); }}>
        <form role="dialog" aria-modal="true" aria-labelledby="add-scheduler-title" onSubmit={event => void save(event)} className="w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-2"><h4 id="add-scheduler-title" className="text-sm font-bold text-slate-900">Add Scheduler</h4><button type="button" aria-label="Close scheduler form" disabled={saving} onClick={() => setShowForm(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
          <label className="block text-xs font-semibold text-slate-700">Name<input required maxLength={100} value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" placeholder="Northport Containers" /></label>
          <label className="block text-xs font-semibold text-slate-700">System origin<input required maxLength={100} value={draft.origin} onChange={event => setDraft({ ...draft, origin: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" placeholder="CargoMove" /></label>
          <label className="block text-xs font-semibold text-slate-700">Scheduler link<input type="url" required maxLength={1000} value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" placeholder="https://www.cargomove.my/administration/run_scheduled_task?id=...&name=..." /></label>
          <p className="text-[11px] leading-4 text-slate-500">Saving does not run the scheduler. Running currently uses the CargoMove scheduler service.</p>
          <label className="block text-xs font-semibold text-slate-700">Description (optional)<textarea maxLength={500} rows={2} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" /></label>
          {formError && <p role="alert" className="text-xs text-rose-700">{formError}</p>}
          <div className="flex items-center gap-2 pt-1"><button type="button" disabled={saving} onClick={() => setShowForm(false)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Saving...' : 'Save Scheduler'}</button></div>
        </form>
      </div>}

      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setEditing(null); }}>
        <form role="dialog" aria-modal="true" aria-labelledby="edit-scheduler-title" onSubmit={event => void update(event)} className="w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-2xl">
          <div className="flex items-center justify-between"><h4 id="edit-scheduler-title" className="text-sm font-bold text-slate-900">Edit scheduler</h4><button type="button" aria-label="Close scheduler editor" disabled={saving} onClick={() => setEditing(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
          <label className="block text-xs font-semibold text-slate-700">Name<input required maxLength={100} value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" /></label>
          <label className="block text-xs font-semibold text-slate-700">System origin<input required maxLength={100} value={draft.origin} onChange={event => setDraft({ ...draft, origin: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" /></label>
          <label className="block text-xs font-semibold text-slate-700">Scheduler link<input type="url" required maxLength={1000} value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" /></label>
          <label className="block text-xs font-semibold text-slate-700">Description (optional)<textarea maxLength={500} rows={3} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" /></label>
          {formError && <p role="alert" className="text-xs text-rose-700">{formError}</p>}
          <div className="flex items-center gap-2"><button type="button" disabled={saving} onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Saving…' : 'Save changes'}</button></div>
        </form>
      </div>}

      {loading && <p role="status" className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading schedulers...</p>}
      {loadError && <div role="alert" className="mt-4 text-xs text-rose-700"><p>{loadError}</p><button type="button" onClick={() => setRefresh(value => value + 1)} className="mt-2 font-bold underline">Reload gallery</button></div>}
      {!loading && !loadError && schedulers.length === 0 && <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-500">No saved schedulers yet. Add one to get started.</p>}
      {!loading && !loadError && schedulers.length > 0 && <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] table-fixed text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><tr><th scope="col" className="w-[22%] px-3 py-2">Scheduler</th><th scope="col" className="w-[16%] px-3 py-2">System origin</th><th scope="col" className="w-[26%] px-3 py-2">Description</th><th scope="col" className="w-[22%] px-3 py-2 text-center">Status / latest request</th><th scope="col" className="w-[14%] px-3 py-2 text-center">Action</th></tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
        {schedulers.map(scheduler => {
          const running = runningId === scheduler.id;
          const result = results[scheduler.id];
          const status = !scheduler.enabled ? 'Disabled' : running ? 'Running' : result?.status === 'trigger_requested' ? 'Request sent' : result?.status === 'unknown' ? 'Check CargoMove' : result ? 'Failed' : 'Ready';
          const tone = !scheduler.enabled ? 'bg-slate-100 text-slate-600' : running ? 'bg-blue-50 text-blue-700' : result?.status === 'trigger_requested' || !result ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700';
          return <tr key={scheduler.id} className="h-12">
            <td className="px-3 py-2"><button type="button" onClick={() => { setFormError(''); setDraft({ displayName: scheduler.displayName, origin: scheduler.origin || '', url: scheduler.url, description: scheduler.description || '' }); setEditing(scheduler); }} className="max-w-full truncate text-left font-semibold text-blue-700 hover:text-blue-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" title="Edit scheduler">{scheduler.displayName}</button><p className="truncate font-mono text-[10px] text-slate-400">{scheduler.workerName}</p></td>
            <td className="truncate px-3 py-2 text-slate-600" title={scheduler.origin}>{scheduler.origin || <span className="text-slate-400">—</span>}</td>
            <td className="truncate px-3 py-2 text-slate-600" title={scheduler.description}>{scheduler.description || <span className="text-slate-400">—</span>}</td>
            <td aria-live="polite" className="px-3 py-2 text-center"><span className={'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold '+tone}>{status}</span>{result && <p className="mt-0.5 truncate text-[10px] text-slate-500" title={result.message}>{new Date(result.timestamp).toLocaleString()} · {result.message}</p>}</td>
            <td className="px-3 py-2 text-center"><button type="button" disabled={Boolean(runningId) || !scheduler.enabled} onClick={() => void run(scheduler)} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{running ? 'Running…' : 'Run now'}</button></td>
          </tr>;
        })}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

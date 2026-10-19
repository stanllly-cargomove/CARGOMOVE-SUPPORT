import React, { useEffect, useState } from 'react';
import { Layers3, Search } from 'lucide-react';
import { GENERAL_VERSION, SYSTEM_VERSIONS } from '../../constants/versions';

const dateLabel = (date: string) => new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(date));
const historyDate = (date: string) => new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(date));
const historyTime = (date: string) => new Intl.DateTimeFormat('en-MY', { timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(date));
const versionBadge = (version: string) => <span className="inline-flex rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-4 text-sky-700">{version}</span>;

export function SystemVersion() {
  const [query, setQuery] = useState('');
  const [historyPage, setHistoryPage] = useState(0);
  const [activeTab, setActiveTab] = useState<'page' | 'tool'>('page');
  const [releases, setReleases] = useState(SYSTEM_VERSIONS.history);
  const [saveStatus, setSaveStatus] = useState('Saving version history…');
  const [saveError, setSaveError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSaveError(false);
    setSaveStatus('Saving version history…');
    void (async () => {
      try {
        const response = await fetch('/api/dev-tools/system-versions', {
          method: 'POST', credentials: 'include', signal: controller.signal,
          headers: { 'x-cargomove-confirm': 'record-system-versions' },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to save version history.');
        setReleases(data.history);
        setHistoryPage(0);
        setSaveStatus('Version history saved to the database.');
      } catch (error) {
        if (controller.signal.aborted) return;
        setSaveError(true);
        setSaveStatus(`${error instanceof Error ? error.message : 'Unable to save version history.'} Showing history from this release.`);
      }
    })();
    return () => controller.abort();
  }, [retry]);
  const entries = SYSTEM_VERSIONS.entries
    .filter(entry => `${entry.name} ${entry.area}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.area.localeCompare(b.area, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const history = releases.slice(historyPage * 10, (historyPage + 1) * 10);

  const table = (kind: 'page' | 'tool') => (
    <section aria-label={kind === 'page' ? 'Page Version' : 'Tool Version'} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:rounded-tl-none sm:border-t-0">
      <div className="border-b border-slate-200 px-3 py-2 sm:hidden"><h3 className="text-sm font-semibold text-slate-900">{kind === 'page' ? 'Page Version' : 'Tool Version'}</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead><tr className="admin-registration-table-header whitespace-nowrap border border-slate-400 bg-[#CBD5E1] text-[10px] font-bold uppercase tracking-wide text-slate-700"><th scope="col" className="px-3 py-2 font-bold">{kind === 'page' ? 'Page' : 'Tool'}</th><th scope="col" className="px-3 py-2 font-bold">Area</th><th scope="col" className="px-3 py-2 font-bold">Current version</th><th scope="col" className="px-3 py-2 font-bold">Last updated (MYT)</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{entries.filter(entry => entry.kind === kind).map(entry => <tr key={entry.id} className="hover:bg-slate-50/70"><th scope="row" className="px-3 py-1 font-medium text-slate-800">{entry.name}</th><td className="px-3 py-1 text-slate-500">{entry.area}</td><td className="px-3 py-1">{versionBadge(entry.version)}</td><td className="whitespace-nowrap px-3 py-1 text-slate-500">{dateLabel(entry.updatedAt)}</td></tr>)}
            {!entries.some(entry => entry.kind === kind) && <tr><td colSpan={4} className="p-5 text-center text-slate-500">No matching {kind === 'page' ? 'pages' : 'tools'}.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="w-full space-y-6">
      <div><h2 className="text-xl font-bold tracking-tight text-slate-900">System Version</h2><p className="mt-1 text-xs text-slate-500">See the current system version and what has changed.</p></div>
      <section aria-label="General Version" className="flex items-center justify-between gap-4 rounded-xl border border-sky-200 bg-white p-5 shadow-sm sm:gap-8">
        <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3"><span className="rounded-lg bg-sky-50 p-2.5 text-sky-700"><Layers3 className="h-5 w-5" aria-hidden="true" /></span><div><h3 className="text-sm font-semibold text-slate-900">General Version</h3><p className="mt-1 text-xs text-slate-500">The current release of the CargoMove support portal.</p></div></div>
        <p className="mt-3 text-xs leading-5 text-slate-500">This version updates automatically when the portal changes. View individual page and tool versions below, or check the history to see what changed.</p>
        <p className="mt-2 text-xs text-slate-400">Last updated: {dateLabel(SYSTEM_VERSIONS.updatedAt)} MYT</p>
        </div>
        <p className="ml-auto shrink-0 self-center text-right font-mono text-4xl font-bold leading-none tracking-tight text-sky-700 sm:text-6xl lg:text-7xl" aria-label={`System version ${GENERAL_VERSION}`}>{GENERAL_VERSION}</p>
      </section>
      <label className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:max-w-sm"><Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /><span className="sr-only">Search pages and tools</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search pages and tools…" className="min-w-0 w-full bg-transparent text-xs text-slate-700 outline-none" /></label>
      <div className="space-y-4 sm:space-y-0">
      <div className="ml-[0.5px] hidden w-fit max-w-full items-end sm:flex" role="tablist" aria-label="Version category">
        {(['page', 'tool'] as const).map(kind => <button key={kind} type="button" role="tab" id={'version-tab-' + kind} aria-selected={activeTab === kind} aria-controls={'version-panel-' + kind} tabIndex={activeTab === kind ? 0 : -1}
          onClick={() => setActiveTab(kind)} onKeyDown={event => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next = event.key === 'Home' ? 'page' : event.key === 'End' ? 'tool' : activeTab === 'page' ? 'tool' : 'page';
              setActiveTab(next);
              document.getElementById('version-tab-' + next)?.focus();
            }
          }} className={'admin-registration-tab relative -mr-px flex h-10 min-w-[120px] items-center justify-center rounded-t-lg border px-3 text-xs font-bold uppercase tracking-wider transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 ' + (activeTab === kind ? 'z-10 border-slate-400 border-b-transparent bg-[#CBD5E1] text-slate-900' : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900')}>
          {kind === 'page' ? 'Page Version' : 'Tool Version'}
        </button>)}
      </div>
      {(['page', 'tool'] as const).map(kind => <React.Fragment key={kind}>
        <div id={'version-panel-' + kind} role="tabpanel" aria-labelledby={'version-tab-' + kind} tabIndex={0} className={'hidden ' + (activeTab === kind ? 'sm:block' : '')}>{table(kind)}</div>
        <div className="sm:hidden">{table(kind)}</div>
      </React.Fragment>)}
      </div>

      <section aria-label="Version changes" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4"><h3 className="text-sm font-semibold text-slate-900">Version changes</h3><p className="mt-1 text-xs text-slate-500">Latest updates first. Select a change for more details.</p></div>
        <div role="status" className={'px-4 py-3 text-xs ' + (saveError ? 'bg-amber-50 text-amber-800' : 'text-slate-500')}>{saveStatus}{saveError && <button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 font-semibold underline">Try again</button>}</div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th scope="col" className="px-3 py-2 font-medium">Date</th><th scope="col" className="px-3 py-2 font-medium">Time (MYT)</th><th scope="col" className="px-3 py-2 font-medium">Changes</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Old version</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">New version</th></tr></thead><tbody className="divide-y divide-slate-100">
          {history.map(release => <tr key={release.version}>
            <td className="whitespace-nowrap px-3 py-1 align-top text-slate-500">{historyDate(release.date)}</td>
            <td className="whitespace-nowrap px-3 py-1 align-top text-slate-500">{historyTime(release.date)}</td>
            <td className="min-w-64 px-3 py-1 text-slate-600"><details><summary className="cursor-pointer font-medium text-slate-800">{release.summary}</summary>
              <ul className="mt-3 space-y-2">{release.changes.map(change => <li key={change.id}><span className="capitalize">{change.action}</span> {change.kind}: {change.name} <span className="font-mono text-[11px]">({change.from || 'New'} &rarr; {change.to || 'Removed'})</span></li>)}</ul>
              <details className="mt-3"><summary className="cursor-pointer text-slate-500">{release.files.length} changed files</summary><ul className="mt-2 space-y-1 break-all font-mono text-[10px]">{release.files.map(file => <li key={file}>{file}</li>)}</ul></details>
            </details></td>
            <td className="px-3 py-1 align-top">{release.previousVersion ? versionBadge(release.previousVersion) : <span className="text-slate-400">&mdash;</span>}</td>
            <td className="px-3 py-1 align-top">{versionBadge(release.version)}</td>
          </tr>)}
        </tbody></table></div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-4 text-xs text-slate-500"><span>{releases.length} recorded releases</span><div className="flex items-center gap-3"><button type="button" disabled={historyPage === 0} onClick={() => setHistoryPage(page => page - 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Newer</button><span>{historyPage + 1} / {Math.ceil(releases.length / 10)}</span><button type="button" disabled={(historyPage + 1) * 10 >= releases.length} onClick={() => setHistoryPage(page => page + 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Older</button></div></div>
      </section>
    </div>
  );
}

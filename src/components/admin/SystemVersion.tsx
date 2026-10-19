import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Layers3, Search } from 'lucide-react';
import { GENERAL_VERSION, SYSTEM_VERSIONS } from '../../constants/versions';

const dateLabel = (date: string) => new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(date));
const historyDate = (date: string) => new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(date));
const historyTime = (date: string) => new Intl.DateTimeFormat('en-MY', { timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(date));
const versionBadge = (version: string) => <span className="inline-flex rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-4 text-sky-700">{version}</span>;

export function SystemVersion() {
  const reducedMotion = useReducedMotion();
  const [githubDetailsOpen, setGithubDetailsOpen] = useState(false);
  const [githubDetailsPinned, setGithubDetailsPinned] = useState(false);
  const githubDetailsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!githubDetailsOpen) return;
    const close = () => { setGithubDetailsOpen(false); setGithubDetailsPinned(false); };
    const outside = (event: PointerEvent) => {
      if (!githubDetailsRef.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        githubDetailsRef.current?.querySelector('button')?.focus();
        close();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [githubDetailsOpen]);
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
  const entryHistory = [...new Map([...SYSTEM_VERSIONS.history, ...releases].map(release => [release.version, release])).values()]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const lastAuthors = new Map(entries.map(entry => {
    const release = entryHistory.find(release => Date.parse(release.date) <= Date.parse(entry.updatedAt)
      && (release.date === entry.updatedAt || release.changes.some(change => change.id === entry.id && change.action !== 'removed')));
    return [entry.id, release?.authors?.join(', ') || 'Stanlly'];
  }));

  const table = (kind: 'page' | 'tool') => (
    <section aria-label={kind === 'page' ? 'Page Version' : 'Tool Version'} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:rounded-tl-none sm:border-t-0">
      <div className="border-b border-slate-200 px-3 py-2 sm:hidden"><h3 className="text-sm font-semibold text-slate-900">{kind === 'page' ? 'Page Version' : 'Tool Version'}</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead><tr className="admin-registration-table-header whitespace-nowrap border border-slate-400 bg-[#CBD5E1] text-[10px] font-bold uppercase tracking-wide text-slate-700"><th scope="col" className="px-3 py-2 font-bold">{kind === 'page' ? 'Page' : 'Tool'}</th><th scope="col" className="px-3 py-2 text-center font-bold">Area</th><th scope="col" className="px-3 py-2 text-center font-bold">Current version</th><th scope="col" className="px-3 py-2 font-bold">Last updated (MYT)</th><th scope="col" className="px-3 py-2 text-center font-bold">Last author</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{entries.filter(entry => entry.kind === kind).map(entry => <tr key={entry.id} className="hover:bg-slate-50/70"><th scope="row" className="px-3 py-1 font-medium text-slate-800">{entry.name}</th><td className="px-3 py-1 text-center text-slate-500">{entry.area}</td><td className="px-3 py-1 text-center">{versionBadge(entry.version)}</td><td className="whitespace-nowrap px-3 py-1 text-slate-500">{dateLabel(entry.updatedAt)}</td><td className="px-3 py-1 text-center text-slate-500" title="Authors recorded for this entry's latest release">{lastAuthors.get(entry.id)}</td></tr>)}
            {!entries.some(entry => entry.kind === kind) && <tr><td colSpan={5} className="p-5 text-center text-slate-500">No matching {kind === 'page' ? 'pages' : 'tools'}.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><h2 className="text-xl font-bold tracking-tight text-slate-900">System Information</h2><p className="mt-1 text-xs text-slate-500">View the latest release, check page and tool versions, and see what changed and who made the updates.</p></div>
        <div ref={githubDetailsRef} className="relative shrink-0" onMouseEnter={() => setGithubDetailsOpen(true)} onMouseLeave={() => { if (!githubDetailsPinned) setGithubDetailsOpen(false); }}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setGithubDetailsOpen(false); setGithubDetailsPinned(false); } }}>
        <motion.button type="button" aria-label="GitHub version tracking details" aria-expanded={githubDetailsOpen} aria-controls="github-version-details"
          onFocus={() => setGithubDetailsOpen(true)} onClick={() => { setGithubDetailsPinned(!githubDetailsPinned); setGithubDetailsOpen(!githubDetailsPinned); }}
          whileHover={reducedMotion ? undefined : { y: -2, rotate: [0, -7, 7, 0], scale: 1.08 }} whileTap={reducedMotion ? undefined : { scale: 0.94 }} transition={{ duration: 0.35 }}
          className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-900 shadow-sm outline-none transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500">
          <svg viewBox="0 0 24 24" className="h-9 w-9" fill="currentColor" aria-hidden="true"><path d="M12 .297a12 12 0 0 0-3.793 23.385c.6.111.82-.261.82-.577v-2.234c-3.338.726-4.043-1.416-4.043-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.835 2.807 1.305 3.492.998.108-.776.418-1.305.762-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 6.006 0c2.291-1.552 3.297-1.23 3.297-1.23.653 1.652.242 2.873.119 3.176.769.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.216.694.825.576A12.001 12.001 0 0 0 12 .297Z" /></svg>
          <span aria-hidden="true" className="pointer-events-none absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 shadow-sm" />
        </motion.button>
        {githubDetailsOpen && <div id="github-version-details" role="region" aria-label="GitHub version tracking" className="absolute right-0 top-full z-30 pt-2 sm:right-full sm:top-0 sm:pr-2 sm:pt-0">
          <div className="w-[min(86vw,20rem)] rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-xl">
            <p className="font-semibold text-slate-900">GitHub version tracking</p>
            <p className="mt-1 leading-relaxed text-slate-500">Versions are recorded when changes are pushed to main.</p>
            <dl className="mt-3 space-y-2 text-slate-600">
              <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Repository</dt><dd className="mt-0.5 break-all">stanllly-cargomove/CARGOMOVE-SUPPORT</dd></div>
              <div className="flex justify-between gap-3"><dt>Branch</dt><dd className="font-mono">main</dd></div>
              <div className="flex justify-between gap-3"><dt>Current version</dt><dd>{versionBadge(GENERAL_VERSION)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Latest author</dt><dd className="text-right">{SYSTEM_VERSIONS.history[0]?.authors?.join(', ') || 'Not recorded'}</dd></div>
            </dl>
            <a href="https://github.com/stanllly-cargomove/CARGOMOVE-SUPPORT" target="_blank" rel="noopener noreferrer" className="mt-4 flex min-h-9 items-center justify-center rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Open repository</a>
          </div>
        </div>}
        </div>
      </div>
      <section aria-label="General Version" className="flex items-center justify-between gap-4 rounded-xl border border-sky-200 bg-white p-5 shadow-sm sm:gap-8">
        <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3"><span className="rounded-lg bg-sky-50 p-2.5 text-sky-700"><Layers3 className="h-5 w-5" aria-hidden="true" /></span><div><h3 className="text-sm font-semibold text-slate-900">General Version</h3><p className="mt-1 text-xs text-slate-500">The current release of the CargoMove support portal.</p></div></div>
        <p className="mt-3 text-xs leading-5 text-slate-500">This version updates when changes are pushed to main. View individual page and tool versions below, or check the history to see what changed.</p>
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
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th scope="col" className="px-3 py-2 font-medium">Date</th><th scope="col" className="px-3 py-2 font-medium">Time (MYT)</th><th scope="col" className="px-3 py-2 font-medium">Author</th><th scope="col" className="px-3 py-2 font-medium">Changes</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Old version</th><th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">New version</th></tr></thead><tbody className="divide-y divide-slate-100">
          {history.map(release => <tr key={release.version}>
            <td className="whitespace-nowrap px-3 py-1 align-top text-slate-500">{historyDate(release.date)}</td>
            <td className="whitespace-nowrap px-3 py-1 align-top text-slate-500">{historyTime(release.date)}</td>
            <td className="px-3 py-1 align-top text-slate-600">{release.authors?.join(", ") || "Not recorded"}{release.pushedBy && <span className="mt-1 block text-[10px] text-slate-400">Pushed by {release.pushedBy}</span>}</td>
            <td className="min-w-64 px-3 py-1 text-slate-600"><details><summary className="cursor-pointer font-medium text-slate-800">{release.summary}</summary>
              <ul className="mt-3 space-y-2">{release.changes.map(change => <li key={change.id}><span className="capitalize">{change.action}</span> {change.kind}: {change.name} <span className="font-mono text-[11px]">({change.from || 'New'} &rarr; {change.to || 'Removed'})</span></li>)}</ul>
              {!!release.commits?.length && <details className="mt-3"><summary className="cursor-pointer text-slate-500">Commits</summary><ul className="mt-2 space-y-1">{release.commits.map(commit => <li key={commit.sha}><code>{commit.sha.slice(0, 7)}</code> {commit.subject} <span className="text-slate-400">({commit.author})</span></li>)}</ul></details>}
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

import React, { useState } from 'react';
import { Layers3, Search } from 'lucide-react';
import { GENERAL_VERSION, SYSTEM_VERSIONS } from '../../constants/versions';

const dateLabel = (date: string) => new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(date));
const versionBadge = (version: string) => <span className="inline-flex rounded-md bg-sky-50 px-2 py-1 font-mono text-xs font-semibold text-sky-700">{version}</span>;

export function SystemVersion() {
  const [query, setQuery] = useState('');
  const [historyPage, setHistoryPage] = useState(0);
  const entries = SYSTEM_VERSIONS.entries.filter(entry => `${entry.name} ${entry.area}`.toLowerCase().includes(query.toLowerCase()));
  const history = SYSTEM_VERSIONS.history.slice(historyPage * 10, (historyPage + 1) * 10);

  const table = (kind: 'page' | 'tool') => (
    <section aria-label={kind === 'page' ? 'Page Version' : 'Tool Version'} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4"><h3 className="text-sm font-semibold text-slate-900">{kind === 'page' ? 'Page Version' : 'Tool Version'}</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500"><tr><th scope="col" className="px-4 py-3 font-medium">{kind === 'page' ? 'Page' : 'Tool'}</th><th scope="col" className="px-4 py-3 font-medium">Area</th><th scope="col" className="px-4 py-3 font-medium">Current version</th><th scope="col" className="px-4 py-3 font-medium">Last updated (MYT)</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{entries.filter(entry => entry.kind === kind).map(entry => <tr key={entry.id}><th scope="row" className="px-4 py-3 font-medium text-slate-800">{entry.name}</th><td className="px-4 py-3 text-slate-500">{entry.area}</td><td className="px-4 py-3">{versionBadge(entry.version)}</td><td className="whitespace-nowrap px-4 py-3 text-slate-500">{dateLabel(entry.updatedAt)}</td></tr>)}
            {!entries.some(entry => entry.kind === kind) && <tr><td colSpan={4} className="p-5 text-center text-slate-500">No matching {kind === 'page' ? 'pages' : 'tools'}.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="w-full space-y-6">
      <div><h2 className="text-xl font-bold tracking-tight text-slate-900">System Version</h2><p className="mt-1 text-xs text-slate-500">General version, page and tool versions, and recorded version changes.</p></div>
      <section aria-label="General Version" className="rounded-xl border border-sky-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-lg bg-sky-50 p-2.5 text-sky-700"><Layers3 className="h-5 w-5" aria-hidden="true" /></span><div><h3 className="text-sm font-semibold text-slate-900">General Version</h3><p className="mt-1 text-xs text-slate-500">System version used by Home and all customer pages.</p></div></div><p className="font-mono text-3xl font-bold text-sky-700" aria-label={`System version ${GENERAL_VERSION}`}>{GENERAL_VERSION}</p></div>
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500 sm:grid-cols-2"><p>Existing page or tool updated: <span className="font-mono text-slate-700">1.2.5 → 1.2.6</span></p><p>New page or tool added: <span className="font-mono text-slate-700">1.2.5 → 1.3.0</span></p></div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Changes are recorded automatically during development and builds. Each recorded set of changes updates the general version once. Page and tool versions start at 1.0.0 when tracking begins and increase when their code or dependencies change.</p>
        <p className="mt-2 text-xs text-slate-400">Last updated: {dateLabel(SYSTEM_VERSIONS.updatedAt)} MYT</p>
      </section>
      <label className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:max-w-sm"><Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /><span className="sr-only">Search pages and tools</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search pages and tools…" className="min-w-0 w-full bg-transparent text-xs text-slate-700 outline-none" /></label>
      {table('page')}
      {table('tool')}
      <section aria-label="Version changes" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4"><h3 className="text-sm font-semibold text-slate-900">Version changes</h3><p className="mt-1 text-xs text-slate-500">Newest first. Expand a change to see affected pages, tools and files.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th scope="col" className="px-4 py-3 font-medium">Version</th><th scope="col" className="px-4 py-3 font-medium">Date (MYT)</th><th scope="col" className="px-4 py-3 font-medium">Changes</th></tr></thead><tbody className="divide-y divide-slate-100">
          {history.map(release => <tr key={release.version}><td className="px-4 py-3 align-top">{versionBadge(release.version)}{release.previousVersion && <p className="mt-1 whitespace-nowrap text-[10px] text-slate-400">from {release.previousVersion}</p>}</td><td className="whitespace-nowrap px-4 py-3 align-top text-slate-500">{dateLabel(release.date)}</td><td className="min-w-64 px-4 py-3 text-slate-600"><details><summary className="cursor-pointer font-medium text-slate-800">{release.summary}</summary><ul className="mt-3 space-y-2">{release.changes.map(change => <li key={change.id}><span className="capitalize">{change.action}</span> {change.kind}: {change.name} <span className="font-mono text-[11px]">({change.from || 'new'} → {change.to || 'removed'})</span></li>)}</ul><details className="mt-3"><summary className="cursor-pointer text-slate-500">{release.files.length} changed files</summary><ul className="mt-2 space-y-1 break-all font-mono text-[10px]">{release.files.map(file => <li key={file}>{file}</li>)}</ul></details></details></td></tr>)}
        </tbody></table></div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-4 text-xs text-slate-500"><span>{SYSTEM_VERSIONS.history.length} recorded releases</span><div className="flex items-center gap-3"><button type="button" disabled={historyPage === 0} onClick={() => setHistoryPage(page => page - 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Newer</button><span>{historyPage + 1} / {Math.ceil(SYSTEM_VERSIONS.history.length / 10)}</span><button type="button" disabled={(historyPage + 1) * 10 >= SYSTEM_VERSIONS.history.length} onClick={() => setHistoryPage(page => page + 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Older</button></div></div>
      </section>
    </div>
  );
}

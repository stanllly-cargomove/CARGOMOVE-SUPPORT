import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Inbox, Search, Send, X, MailOpen, Loader2, Trash2, Clock, SquarePen, Undo2 } from 'lucide-react';

export type MailFolder = 'inbox' | 'sent' | 'trash' | 'scheduled';
export type MailSummary = { id: string; subject: string; from: string; to?: string; snippet: string; unread: boolean; timestamp?: number; date?: string; messageCount?: number };

function correspondent(value: string) {
  return value.replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || value;
}
function mailDate(item: MailSummary) {
  const date = new Date(item.timestamp || item.date || '');
  if (!Number.isFinite(date.getTime())) return '';
  if (date.toDateString() === new Date().toDateString()) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) });
}

const folderName = (folder:MailFolder)=>({inbox:'Inbox',sent:'Sent',trash:'Trash',scheduled:'Scheduled'})[folder];
export function AutoMailMailbox({ onCompose, composeReady, onAction, canManage, activeThreadId, folder, onFolder, query, onSearch, threads, nextPage, onMore, loading, disabled, reading, onBack, onOpen, children }: {
  onCompose?:()=>void; composeReady?:boolean; onAction?:(ids:string[],action:'trash'|'restore')=>void; canManage?:boolean; activeThreadId?:string;
  folder: MailFolder; onFolder: (folder: MailFolder) => void; query: string; onSearch: (query: string) => void;
  threads: MailSummary[]; nextPage: string | null; onMore: () => void; loading: boolean; disabled: boolean;
  reading: boolean; onBack: () => void; onOpen: (id: string) => void; children: React.ReactNode;
}) {
  const [search, setSearch] = useState(query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedOnly, setSelectedOnly] = useState(false);
  const allBox = useRef<HTMLInputElement>(null);
  useEffect(() => { setSearch(query); setSelected(new Set()); setSelectedOnly(false); }, [folder, query]);
  useEffect(() => { setSelected(current => new Set([...current].filter(id => threads.some(item => item.id === id)))); }, [threads]);
  const allSelected = !!threads.length && threads.every(item => selected.has(item.id));
  useEffect(() => { if (allBox.current) allBox.current.indeterminate = selected.size > 0 && !allSelected; }, [selected, allSelected]);
  const rows = selectedOnly ? threads.filter(item => selected.has(item.id)) : threads;
  return <div className="h-[calc(100dvh-170px)] min-h-[520px] w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav aria-label="Mail folders" className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/70 p-3 md:w-44 md:flex-col md:border-b-0 md:border-r md:py-5">
        {onCompose&&<button type="button" disabled={disabled} onClick={onCompose} title={composeReady?'New message':'Apply the compose/outbox migration'} className="mr-2 flex shrink-0 items-center gap-2 rounded-xl bg-sky-100 px-4 py-3 text-sm font-semibold text-sky-900 hover:bg-sky-200 disabled:opacity-50 md:mb-4 md:mr-0"><SquarePen className="h-4 w-4"/>Compose</button>}
        {(['inbox', 'sent', 'scheduled', 'trash'] as const).map(value => { const Icon = value === 'inbox' ? Inbox : value === 'sent' ? Send : value === 'trash' ? Trash2 : Clock; return <button key={value} type="button" disabled={disabled} aria-current={folder === value ? 'page' : undefined} onClick={() => onFolder(value)} className={`flex shrink-0 items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-colors disabled:opacity-50 ${folder === value ? 'bg-sky-100 font-semibold text-sky-900' : 'text-slate-600 hover:bg-slate-200/60'}`}><Icon className="h-4 w-4" />{folderName(value)}</button>; })}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!reading&&folder!=='scheduled'&&<form role="search" aria-label="Search mail" onSubmit={event => { event.preventDefault(); onSearch(search.trim()); }} className="flex shrink-0 items-center gap-2 border-b border-slate-100 p-3 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-slate-100 px-3 focus-within:ring-2 focus-within:ring-sky-300">
            <Search className="h-4 w-4 shrink-0 text-slate-500" /><input type="search" aria-label="Search emails" placeholder={`Search ${folderName(folder)} — sender, subject, or keyword`} value={search} onChange={event => setSearch(event.target.value)} disabled={disabled} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" />
            {(search || query) && <button type="button" aria-label="Clear email search" disabled={disabled} onClick={() => { setSearch(''); onSearch(''); }} className="rounded-full p-1 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>}
          </div><button type="submit" disabled={disabled} className="rounded-lg px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50">Search</button>
        </form>}
        {reading ? <>{folder!=='scheduled'&&<div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2"><button type="button" disabled={disabled} onClick={onBack} className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"><ArrowLeft className="h-4 w-4" />Back to {folderName(folder)}</button>{activeThreadId&&onAction&&<button type="button" disabled={disabled} title={canManage?undefined:'Reconnect Gmail to approve mailbox management'} onClick={()=>onAction([activeThreadId],folder==='trash'?'restore':'trash')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={folder==='trash'?'Restore conversation':'Move conversation to Trash'}>{folder==='trash'?<Undo2 className="h-4 w-4"/>:<Trash2 className="h-4 w-4"/>}</button>}</div>}<div className="min-h-0 flex-1 overflow-y-auto">{children}</div></> : <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-14 flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
            <input ref={allBox} type="checkbox" aria-label="Select all loaded conversations" checked={allSelected} disabled={disabled || !threads.length} onChange={() => setSelected(allSelected ? new Set() : new Set(threads.map(item => item.id)))} className="h-4 w-4 accent-sky-600" />
            {selected.size ? <><span>{selected.size} selected</span>{onAction&&<button type="button" disabled={disabled} title={canManage?undefined:'Reconnect Gmail to approve mailbox management'} onClick={()=>onAction([...selected],folder==='trash'?'restore':'trash')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40">{folder==='trash'?<Undo2 className="h-4 w-4"/>:<Trash2 className="h-4 w-4"/>}{folder==='trash'?'Restore selected':'Move to Trash'}</button>}<button type="button" disabled={disabled} onClick={() => setSelectedOnly(value => !value)} className="rounded-md px-2 py-1 text-sky-700 hover:bg-sky-50">{selectedOnly ? 'Show all' : 'Show selected'}</button><button type="button" disabled={disabled} onClick={() => onOpen(rows.find(item => selected.has(item.id))?.id || [...selected][0])} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sky-700 hover:bg-sky-50"><MailOpen className="h-4 w-4" />Open selected</button><button type="button" onClick={() => { setSelected(new Set()); setSelectedOnly(false); }} className="rounded-md px-2 py-1 hover:bg-slate-100">Clear selection</button></> : <span>{folderName(folder)}{query ? ` · Results for “${query}”` : ''}</span>}
            <span className="ml-auto">{loading ? <Loader2 aria-label="Loading emails" className="h-4 w-4 animate-spin" /> : `${threads.length} loaded`}</span>
          </div>
          <div aria-label={`${folderName(folder)} conversations`} className="min-h-0 flex-1 overflow-y-auto">
            {rows.map(item => <div key={item.id} className={`group flex items-center gap-3 border-b border-slate-100 px-4 hover:relative hover:z-10 hover:shadow-sm ${selected.has(item.id) ? 'bg-sky-50' : item.unread && folder === 'inbox' ? 'bg-white' : 'bg-slate-50/70'}`}>
              <input type="checkbox" aria-label={`Select ${item.subject}`} checked={selected.has(item.id)} disabled={disabled} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className="h-4 w-4 shrink-0 accent-sky-600" />
              <button type="button" disabled={disabled} onClick={() => onOpen(item.id)} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-left disabled:opacity-50 md:grid-cols-[160px_minmax(0,1fr)_auto] xl:grid-cols-[190px_minmax(0,1fr)_auto]">
                <span className={`truncate text-sm text-slate-800 ${item.unread && folder === 'inbox' ? 'font-semibold' : ''}`}>{folder === 'sent' ? 'To: ' : ''}{correspondent(folder === 'sent' ? item.to || item.from : item.from)}{(item.messageCount || 0) > 1 && <span className="ml-1 text-xs font-normal text-slate-400">({item.messageCount})</span>}</span>
                <span className="col-span-2 row-start-2 truncate text-sm md:col-span-1 md:col-start-2 md:row-start-1"><span className={item.unread && folder === 'inbox' ? 'font-semibold text-slate-900' : 'text-slate-700'}>{item.subject}</span><span className="text-slate-400"> — {item.snippet}</span></span>
                <time dateTime={item.timestamp ? new Date(item.timestamp).toISOString() : undefined} className="col-start-2 row-start-1 whitespace-nowrap text-xs text-slate-500 md:col-start-3">{mailDate(item)}</time>
              </button>
            </div>)}
            {!rows.length && !loading && <div className="flex flex-col items-center gap-3 px-6 py-20 text-center text-slate-500"><Inbox className="h-10 w-10 text-slate-300" /><p className="text-sm">{selectedOnly ? 'No selected conversations.' : query ? 'No conversations match this search.' : `No conversations in ${folderName(folder)}.`}</p></div>}
          </div>
          {nextPage && !selectedOnly && <div className="border-t border-slate-100 p-3 text-center"><button type="button" disabled={disabled} onClick={onMore} className="rounded-lg border border-slate-200 px-5 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">Load more</button></div>}
        </div>}
      </div>
    </div>
  </div>;
}

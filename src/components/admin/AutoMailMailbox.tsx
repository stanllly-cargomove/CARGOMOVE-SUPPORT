import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, GraduationCap, FilePenLine, Mail, ArrowLeft, Inbox, Search, Send, X, MailOpen, ChevronDown, ChevronRight, Trash2, Clock, SquarePen, Undo2 } from 'lucide-react';

import { AutoMailSkeleton } from './AutoMailSkeleton';

export type MailAction = 'trash' | 'restore' | 'read' | 'unread';
export type MailFolder = 'inbox' | 'sent' | 'trash' | 'scheduled' | 'drafts' | 'knowledge' | 'learning';
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

const folderName = (folder:MailFolder)=>({inbox:'Inbox',sent:'Sent',trash:'Trash',scheduled:'Scheduled',drafts:'Drafts',knowledge:'Knowledge Base',learning:'Learning review'})[folder];
export function AutoMailMailbox({ content, onCompose, composeReady, onAction, canManage, activeThreadId, folder, onFolder, query, onSearch, threads, nextPage, onMore, loading, disabled, reading, onBack, onOpen, children, toolbarActions,workspaceTitle,showBack=reading }: {
  content?: React.ReactNode;
  toolbarActions?: React.ReactNode;workspaceTitle?:{title:string;description:string};showBack?:boolean;
  onCompose?:()=>void; composeReady?:boolean; onAction?:(ids:string[],action:MailAction)=>void; canManage?:boolean; activeThreadId?:string;
  folder: MailFolder; onFolder: (folder: MailFolder) => void; query: string; onSearch: (query: string) => void;
  threads: MailSummary[]; nextPage: string | null; onMore: () => void; loading: boolean; disabled: boolean;
  reading: boolean; onBack: () => void; onOpen: (id: string) => void; children: React.ReactNode;
}) {
  const [search, setSearch] = useState(query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [expanded, setExpanded] = useState({ unread: true, read: true });
  const allBox = useRef<HTMLInputElement>(null);
  useEffect(() => { setSearch(query); setSelected(new Set()); setSelectedOnly(false); }, [folder, query]);
  useEffect(() => { setSelected(current => new Set([...current].filter(id => threads.some(item => item.id === id)))); }, [threads]);
  const allSelected = !!threads.length && threads.every(item => selected.has(item.id));
  useEffect(() => { if (allBox.current) allBox.current.indeterminate = selected.size > 0 && !allSelected; }, [selected, allSelected]);
  const orderedThreads = folder === 'sent' ? [...threads].sort((a, b) =>
    (b.timestamp || Date.parse(b.date || '') || 0) - (a.timestamp || Date.parse(a.date || '') || 0)) : threads;
  const rows = selectedOnly ? orderedThreads.filter(item => selected.has(item.id)) : orderedThreads;
  const renderRow = (item: MailSummary) => <div key={item.id} className={`group relative flex items-center gap-3 border-b border-slate-100 px-4 hover:relative hover:z-10 hover:shadow-sm ${selected.has(item.id) ? 'bg-sky-50' : item.unread && folder === 'inbox' ? 'bg-white' : 'bg-slate-50/70'}`}>
              <input type="checkbox" aria-label={`Select ${item.subject}`} checked={selected.has(item.id)} disabled={disabled} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className="h-4 w-4 shrink-0 accent-sky-600" />
              <button type="button" disabled={disabled} onClick={() => onOpen(item.id)} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-left disabled:opacity-50 md:grid-cols-[160px_minmax(0,1fr)_auto] xl:grid-cols-[190px_minmax(0,1fr)_auto]">
                <span className={`truncate text-sm text-slate-800 ${item.unread && folder === 'inbox' ? 'font-semibold' : ''}`}>{folder === 'sent' ? 'To: ' : ''}{correspondent(folder === 'sent' ? item.to || item.from : item.from)}{(item.messageCount || 0) > 1 && <span className="ml-1 text-xs font-normal text-slate-400">({item.messageCount})</span>}</span>
                <span className="col-span-2 row-start-2 truncate text-sm md:col-span-1 md:col-start-2 md:row-start-1"><span className={item.unread && folder === 'inbox' ? 'font-semibold text-slate-900' : 'text-slate-700'}>{item.subject}</span><span className="text-slate-400"> — {item.snippet}</span></span>
                <time dateTime={item.timestamp ? new Date(item.timestamp).toISOString() : undefined} className="col-start-2 row-start-1 whitespace-nowrap text-xs text-slate-500 md:col-start-3">{mailDate(item)}</time>
              </button>
              {onAction&&<div role="group" aria-label={`Actions for ${item.subject}`} className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full bg-white p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
                <button type="button" aria-label={folder==='trash'?'Restore conversation':'Delete conversation'} title={folder==='trash'?'Restore conversation':'Move conversation to Trash'} disabled={disabled} onClick={()=>onAction([item.id],folder==='trash'?'restore':'trash')} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40">{folder==='trash'?<Undo2 className="h-4 w-4"/>:<Trash2 className="h-4 w-4"/>}</button>
                <button type="button" aria-label={`Mark as ${item.unread?'read':'unread'}`} title={`Mark as ${item.unread?'read':'unread'}`} disabled={disabled} onClick={()=>onAction([item.id],item.unread?'read':'unread')} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40">{item.unread?<MailOpen className="h-4 w-4"/>:<Mail className="h-4 w-4"/>}</button>
              </div>}
            </div>;

  return <div className="h-full min-h-0 w-full overflow-hidden bg-[#f6f8fb]">
    <div className="flex h-full min-h-0 flex-col md:flex-row md:pl-2">
      <nav aria-label="Mail folders" className="flex shrink-0 gap-0 overflow-x-auto p-2 md:w-38 md:flex-col md:py-3">
        {onCompose&&<button type="button" disabled={disabled} onClick={onCompose} title={composeReady?'New message':'Apply the compose/outbox migration'} className="mr-2 flex shrink-0 items-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50 md:mb-2 md:mr-0"><SquarePen className="h-4 w-4"/>Compose</button>}
        {(['inbox', 'sent', 'drafts', 'scheduled', 'trash'] as const).map(value => { const Icon = value === 'inbox' ? Inbox : value === 'sent' ? Send : value === 'trash' ? Trash2 : value==='drafts'?FilePenLine:Clock; return <button key={value} type="button" disabled={disabled} aria-current={folder === value ? 'page' : undefined} onClick={() => onFolder(value)} className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${folder === value ? 'bg-sky-600 font-semibold text-white' : 'text-slate-800 hover:bg-sky-100'}`}><Icon className="h-4 w-4" />{folderName(value)}</button>; })}
        <div className="ml-3 flex shrink-0 border-l border-slate-200 pl-3 md:ml-0 md:mt-6 md:flex-col md:border-l-0 md:border-t md:pl-0 md:pt-3">{(['knowledge','learning'] as const).map(value=>{const Icon=value==='knowledge'?BookOpen:GraduationCap;return <button key={value} type="button" disabled={disabled} aria-current={folder===value?'page':undefined} onClick={()=>onFolder(value)} className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-2 py-2 text-left text-xs disabled:opacity-40 ${folder===value?'bg-sky-600 font-semibold text-white':'text-slate-800 hover:bg-sky-100'}`}><Icon className="h-4 w-4 shrink-0"/>{folderName(value)}</button>;})}</div>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2 pb-2 md:pl-2 md:pr-3">
        <header aria-label="Mail search and tools" className="flex shrink-0 items-center gap-2 py-2 sm:gap-3">
        {workspaceTitle&&<div className="min-w-0 flex-1 py-1"><h3 className="font-semibold text-slate-900">{workspaceTitle.title}</h3><p className="mt-1 text-xs text-slate-500">{workspaceTitle.description}</p></div>}
        {!reading&&['inbox','sent','trash'].includes(folder)&&<form role="search" aria-label="Search mail" onSubmit={event => { event.preventDefault(); onSearch(search.trim()); }} className="min-w-0 flex-1">
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white pl-3 pr-[5px] shadow-sm focus-within:ring-2 focus-within:ring-sky-300">
            <Search className="h-4 w-4 shrink-0 text-sky-700" /><input type="search" aria-label="Search emails" placeholder={`Search ${folderName(folder)} — sender, subject, or keyword`} value={search} onChange={event => setSearch(event.target.value)} disabled={disabled} className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-600 outline-none" />
            {(search || query) && <button type="button" aria-label="Clear email search" disabled={disabled} onClick={() => { setSearch(''); onSearch(''); }} className="rounded-full p-1 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>}
            <button type="submit" disabled={disabled} className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">Search</button>
          </div>
        </form>}
        {reading && showBack && folder !== 'scheduled' && <div className="flex shrink-0 items-center gap-0">
          <button type="button" aria-label={`Back to ${folderName(folder)}`} title={`Back to ${folderName(folder)}`} disabled={disabled} onClick={onBack} className="mr-5 inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 sm:mr-7"><ArrowLeft className="h-5 w-5" /></button>
          {activeThreadId && onAction && <>
            <button type="button" aria-label="Mark as unread" title="Mark as unread" disabled={disabled} onClick={()=>onAction([activeThreadId],'unread')} className="inline-flex h-10 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40"><span className="relative"><svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 11v8H4V5h10M4 6l8 6 5-3"/><circle cx="20" cy="5" r="3" fill="currentColor" stroke="none"/></svg></span></button>
            <button type="button" disabled={disabled} title={canManage ? (folder === 'trash' ? 'Restore conversation' : 'Move conversation to Trash') : 'Reconnect Gmail to approve mailbox management'} onClick={()=>onAction([activeThreadId],folder==='trash'?'restore':'trash')} className="inline-flex h-10 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={folder==='trash'?'Restore conversation':'Move conversation to Trash'}>{folder==='trash'?<Undo2 className="h-5 w-5"/>:<Trash2 className="h-5 w-5"/>}</button>
          </>}
        </div>}
        <div className="ml-auto flex shrink-0 items-center">{toolbarActions}</div>
        </header>
        <section aria-label="Mail content" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white">
        {content !== undefined ? content : reading ? <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div> : <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-9 flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-1 text-xs text-slate-500">
            <input ref={allBox} type="checkbox" aria-label="Select all loaded conversations" checked={allSelected} disabled={disabled || !threads.length} onChange={() => setSelected(allSelected ? new Set() : new Set(threads.map(item => item.id)))} className="h-4 w-4 accent-sky-600" />
            {selected.size ? <><span>{selected.size} selected</span>{onAction&&<button type="button" disabled={disabled} title={canManage?undefined:'Reconnect Gmail to approve mailbox management'} onClick={()=>onAction([...selected],folder==='trash'?'restore':'trash')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40">{folder==='trash'?<Undo2 className="h-4 w-4"/>:<Trash2 className="h-4 w-4"/>}{folder==='trash'?'Restore selected':'Move to Trash'}</button>}<button type="button" disabled={disabled} onClick={() => setSelectedOnly(value => !value)} className="rounded-md px-2 py-1 text-sky-700 hover:bg-sky-50">{selectedOnly ? 'Show all' : 'Show selected'}</button><button type="button" disabled={disabled} onClick={() => onOpen(rows.find(item => selected.has(item.id))?.id || [...selected][0])} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sky-700 hover:bg-sky-50"><MailOpen className="h-4 w-4" />Open selected</button><button type="button" onClick={() => { setSelected(new Set()); setSelectedOnly(false); }} className="rounded-md px-2 py-1 hover:bg-slate-100">Clear selection</button></> : <span>{folderName(folder)}{query ? ` · Results for “${query}”` : ''}</span>}
            <span className="ml-auto">{loading && !threads.length ? <span aria-hidden="true" className="block h-3 w-14 rounded bg-slate-200 motion-safe:animate-pulse" /> : `${threads.length} loaded`}</span>
          </div>
          <div aria-label={`${folderName(folder)} conversations`} className="min-h-0 flex-1 overflow-y-auto">
            {loading && !rows.length ? <AutoMailSkeleton /> : folder === 'inbox' && !selectedOnly ? (['unread', 'read'] as const).map(group => {
              const items = rows.filter(item => item.unread === (group === 'unread'));
              const title = group === 'unread' ? 'Unread' : 'Everything else';
              const Icon = expanded[group] ? ChevronDown : ChevronRight;
              return <section key={group} aria-label={title}>
                <button type="button" aria-expanded={expanded[group]} onClick={() => setExpanded(current => ({ ...current, [group]: !current[group] }))} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-50">
                  <Icon className="h-4 w-4 text-slate-500" />{title}<span className="ml-auto text-xs font-bold text-slate-700">{items.length}</span>
                </button>
                {expanded[group] && items.map(renderRow)}
              </section>;
            }) : rows.map(renderRow)}
            {!rows.length && !loading && <div className="flex flex-col items-center gap-3 px-6 py-20 text-center text-slate-500"><Inbox className="h-10 w-10 text-slate-300" /><p className="text-sm">{selectedOnly ? 'No selected conversations.' : query ? 'No conversations match this search.' : `No conversations in ${folderName(folder)}.`}</p></div>}
          </div>
          {nextPage && !selectedOnly && <div className="border-t border-slate-100 px-3 py-1 text-center"><button type="button" disabled={disabled} onClick={onMore} className="rounded-lg border border-slate-200 px-4 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">Load more</button></div>}
        </div>}
        </section>
      </div>
    </div>
  </div>;
}

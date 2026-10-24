import { AutoMailListTools } from './AutoMailListTools';
import { AutoMailRelatedKnowledge } from './AutoMailRelatedKnowledge';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { KnowledgeArticle, knowledgeRequest } from '../../services/autoMailKnowledge';

type Suggestion = {
  id: string; version: number; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string;
  proposed_title: string; proposed_content: string; proposed_summary: string; proposed_category: string; proposed_port: string; proposed_keywords: string[];
  review_note: string; created_at: string; reviewed_article?: KnowledgeArticle;
  evidence?: { mailbox?: string; question?: string; sent_reply?: string; ai_original?: string; ai_sources?: { id: string; title: string; version: number; content: string }[] };
};
type Event = { id: string; action: string; created_at: string };
type Form = { title: string; content: string; summary: string; category: string; port: string; keywords: string; note: string };
const button = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50';
const input = 'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50';

export function AutoMailLearning({ ready, refreshToken, onReviewed,onDirtyChange,onViewChange,hideHeader=false }: { hideHeader?:boolean; onViewChange?:(view:'list'|'review')=>void; ready: boolean; refreshToken: number; onReviewed: () => void;onDirtyChange?:(dirty:boolean)=>void }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ q:'', status: '', offset: 0, pageSize:20 });
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Suggestion | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  useEffect(()=>{onViewChange?.(selected?'review':'list');},[selected?.id,onViewChange]);
  const closeReview=()=>{
    if(dirty&&!window.confirm('Discard unsaved review changes?'))return;
    setSelected(null);setForm(null);setDirty(false);setTarget(null);setTargets([]);setTargetQuery('');setEvents([]);setError('');setNotice('');
  };
  const [mode, setMode] = useState<'NEW' | 'UPDATE'>('NEW');
  const [targetQuery, setTargetQuery] = useState('');
  const [targets, setTargets] = useState<KnowledgeArticle[]>([]);
  const [target, setTarget] = useState<KnowledgeArticle | null>(null);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError('');
    const query = new URLSearchParams({ q:filter.q,status: filter.status, offset: String(filter.offset),pageSize:String(filter.pageSize) });
    void knowledgeRequest<{ suggestions: Suggestion[]; total: number }>(`learning?${query}`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setItems(result.suggestions); setTotal(result.total); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, filter, attempt, refreshToken]);

  const open = async (id: string) => {
    if (dirty && !window.confirm('Discard unsaved review changes and reload the saved suggestion?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await knowledgeRequest<{ suggestion: Suggestion; events: Event[] }>(`learning-suggestion?id=${encodeURIComponent(id)}`);
      const s = result.suggestion; setSelected(s); setEvents(result.events); setDirty(false); setMode('NEW'); setTarget(null); setTargets([]); setTargetQuery('');
      setForm({ title: s.proposed_title, content: s.proposed_content, summary: s.proposed_summary, category: s.proposed_category, port: s.proposed_port, keywords: s.proposed_keywords.join(', '), note: '' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open suggestion.'); }
    finally { setBusy(false); }
  };
  const searchTargets = async () => {
    setBusy(true); setError('');
    try { const result = await knowledgeRequest<{ articles: KnowledgeArticle[] }>(`knowledge?q=${encodeURIComponent(targetQuery)}&status=&offset=0`); setTargets(result.articles); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to find KB articles.'); }
    finally { setBusy(false); }
  };
  const chooseTarget = async (id: string) => {
    setBusy(true); setError('');
    try { const result = await knowledgeRequest<{ article: KnowledgeArticle }>(`knowledge-article?id=${encodeURIComponent(id)}`); setTarget(result.article); setMode('UPDATE'); setDirty(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load target article.'); }
    finally { setBusy(false); }
  };
  const review = async (action: 'APPROVE' | 'REJECT') => {
    if (!selected || !form || (action === 'APPROVE' && mode === 'UPDATE' && !target)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await knowledgeRequest<{ suggestion: Suggestion }>('learning-review', { ...form, id: selected.id, version: selected.version, action,
        keywords: form.keywords.split(',').map(tag => tag.trim()).filter(Boolean), targetId: mode === 'UPDATE' ? target?.id : null, targetVersion: mode === 'UPDATE' ? target?.version : null });
      setSelected(result.suggestion); setDirty(false); setEvents([]); setAttempt(value => value + 1); onReviewed();
      setNotice(action === 'APPROVE' ? 'Learning approved and published to the KB. Future drafts can use the reviewed answer.' : 'Suggestion rejected. The KB was not changed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to review suggestion.'); }
    finally { setBusy(false); }
  };
  const field = (name: keyof Form, value: string) => { setForm(current => current ? { ...current, [name]: value } : current); setDirty(true); };

  if (!ready) return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Apply the Milestone 4 learning migration to the Auto Mail database, then refresh. Existing inbox, KB and draft features remain available.</p>;
  return <section aria-label="Learning review queue" className="flex min-h-[360px] min-w-0 flex-1 flex-col">
    {!hideHeader&&<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"><div><h3 className="font-semibold text-slate-900">Learning review</h3><p className="mt-1 text-xs text-slate-500">Turn confirmed staff replies into reusable, reviewed knowledge.</p></div></div>}
    {error && <p role="alert" className="mx-4 mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mx-4 mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!selected&&<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        <AutoMailListTools label="suggestions" query={filter.q} onSearch={q=>setFilter(current=>({...current,q,offset:0}))} status={filter.status} onStatus={status=>setFilter(current=>({...current,status,offset:0}))} pageSize={filter.pageSize} onPageSize={pageSize=>setFilter(current=>({...current,pageSize,offset:0}))} disabled={busy} statuses={[{value:'',label:'All statuses'},{value:'PENDING',label:'Pending review'},{value:'APPROVED',label:'Approved'},{value:'REJECTED',label:'Rejected'}]}><button type="button" aria-label="Refresh queue" title="Refresh queue" disabled={busy || dirty || loading} onClick={()=>setAttempt(value=>value+1)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw aria-hidden="true" className="h-4 w-4"/></button></AutoMailListTools>
        <p role="status" className="px-4 pb-2 text-xs text-slate-500">{loading?'Loading suggestions...':`${total} suggestion${total===1?'':'s'}`}</p>
        <div className="min-h-0 max-w-full flex-1 overflow-auto border-y border-slate-200"><table aria-label="Learning review suggestions" aria-busy={loading} className="w-full min-w-[760px] border-collapse text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-600"><tr>{['Suggestion','Category','Scope','Source','Status','Created','Action'].map(label=><th key={label} scope="col" className="px-4 py-2">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{items.map(item=><tr key={item.id} className="hover:bg-sky-50/50">
            <td className="w-[30%] min-w-[220px] max-w-sm px-4 py-2"><button type="button" disabled={busy} onClick={()=>void open(item.id)} className="text-left font-semibold text-sky-800 hover:underline disabled:opacity-50">{item.proposed_title}</button>{item.proposed_summary&&<p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{item.proposed_summary}</p>}</td>
            <td className="px-4 py-2 text-slate-600">{item.proposed_category}</td><td className="px-4 py-2 text-slate-600">{item.proposed_port}</td><td className="px-4 py-2 text-slate-600">{item.reason==='AI_CORRECTION'?'Edited AI reply':'Staff reply'}</td>
            <td className="px-4 py-2"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${item.status==='APPROVED'?'bg-emerald-50 text-emerald-800':item.status==='REJECTED'?'bg-slate-100 text-slate-600':'bg-amber-50 text-amber-800'}`}>{item.status==='APPROVED'?'Approved':item.status==='REJECTED'?'Rejected':'Pending review'}</span></td><td className="whitespace-nowrap px-4 py-2 text-[11px] text-slate-500">{item.created_at&&Number.isFinite(Date.parse(item.created_at))?new Date(item.created_at).toLocaleDateString():'-'}</td>
            <td className="px-4 py-2"><button type="button" aria-label={`Review ${item.proposed_title}`} disabled={busy} onClick={()=>void open(item.id)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">Review</button></td>
          </tr>)}</tbody></table>
          {!loading&&!items.length&&<p className="p-8 text-center text-xs text-slate-500">No suggestions in this queue. Edited AI replies are added after a confirmed send; manual replies can be nominated after sending.</p>}
        </div>
        <div className="mt-auto flex justify-between gap-2 border-t border-slate-200 px-4 py-3"><button className={button} disabled={busy||loading||filter.offset===0} onClick={()=>setFilter(current=>({...current,offset:Math.max(0,current.offset-current.pageSize)}))}>Previous</button><button className={button} disabled={busy||loading||filter.offset+filter.pageSize>=total} onClick={()=>setFilter(current=>({...current,offset:current.offset+current.pageSize}))}>Next</button></div>
      </div>}
      {selected&&form&&<div className="min-w-0 border-t border-slate-200 bg-white p-4 sm:p-5">
        <button type="button" disabled={busy} onClick={closeReview} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-sky-700 hover:underline disabled:opacity-50"><ArrowLeft className="h-4 w-4"/>Back to Learning review</button>
        <>
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Review suggestion</h4><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{selected.status} · v{selected.version}</span><button className={button} disabled={busy} onClick={() => void open(selected.id)}>Reload review history</button></div>
          <details className="my-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Source evidence{selected.evidence?.mailbox ? ` · ${selected.evidence.mailbox}` : ''}</summary><div className="mt-3 space-y-3"><div><h5 className="text-xs font-semibold">Customer question</h5><p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">{selected.evidence?.question || 'No question snapshot was recorded for this reply.'}</p></div>{selected.evidence?.ai_original && <div><h5 className="text-xs font-semibold">Original AI draft</h5><p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">{selected.evidence.ai_original}</p></div>}<div><h5 className="text-xs font-semibold">Reply actually sent</h5><p className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">{selected.evidence?.sent_reply || selected.proposed_content}</p></div>{selected.evidence?.ai_sources?.map(source => <details key={source.id} className="rounded border border-slate-100 p-2"><summary className="cursor-pointer text-xs">Source snapshot: {source.title} · v{source.version}</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">{source.content}</p></details>)}</div></details>
          {selected.status !== 'PENDING' ? <div className="space-y-3"><p className="text-sm text-slate-600">Review note: {selected.review_note || 'No additional note.'}</p>{selected.reviewed_article && <><h5 className="text-sm font-semibold">Published: {selected.reviewed_article.title} · v{selected.reviewed_article.version}</h5><p className="whitespace-pre-wrap break-words text-sm text-slate-700">{selected.reviewed_article.content}</p></>}</div> : <form onSubmit={event => { event.preventDefault(); void review('APPROVE'); }} className="space-y-3">
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Generalize names, email addresses, reference numbers and one-off details before approval. Confirm that the procedure applies to the selected port or scope.</p>
            <label className="block text-xs font-medium">Article title<input required maxLength={160} disabled={busy} className={input} value={form.title} onChange={event => field('title', event.target.value)} /></label>
            <label className="block text-xs font-medium">Summary<textarea rows={2} maxLength={400} disabled={busy} className={input} value={form.summary} onChange={event => field('summary', event.target.value)} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">Category<input required maxLength={80} disabled={busy} className={input} value={form.category} onChange={event => field('category', event.target.value)} /></label><label className="block text-xs font-medium">Port / scope<input required maxLength={80} disabled={busy} className={input} value={form.port} onChange={event => field('port', event.target.value)} /></label></div>
            <label className="block text-xs font-medium">Keywords (comma separated)<input disabled={busy} className={input} value={form.keywords} onChange={event => field('keywords', event.target.value)} /></label>
            <label className="block text-xs font-medium">Reusable answer<textarea required rows={9} maxLength={30000} disabled={busy} className={input} value={form.content} onChange={event => field('content', event.target.value)} /></label>
            <AutoMailRelatedKnowledge key={selected.id} query={[form.title, form.summary, form.keywords].join('\n')} disabled={busy} onSelect={id => void chooseTarget(id)} />
            <label className="block text-xs font-medium">Publish as<select disabled={busy} className={input} value={mode} onChange={event => { setMode(event.target.value as 'NEW' | 'UPDATE'); setDirty(true); }}><option value="NEW">New KB article</option><option value="UPDATE">Update an existing KB article</option></select></label>
            {mode === 'UPDATE' && <div className="space-y-2 rounded-lg border border-sky-100 bg-sky-50/40 p-3"><label className="block text-xs font-medium">Find existing KB article<input maxLength={200} disabled={busy} className={input} value={targetQuery} onChange={event => setTargetQuery(event.target.value)} /></label><button type="button" className={button} disabled={busy} onClick={() => void searchTargets()}>Search KB targets</button><div className="space-y-1">{targets.map(item => <button type="button" className={`${button} block w-full text-left`} disabled={busy} key={item.id} onClick={() => void chooseTarget(item.id)}>Use {item.title} · {item.port} · v{item.version}</button>)}</div>{target && <div><p className="text-xs font-semibold">Selected target: {target.title} · v{target.version}</p><div className="my-3 grid min-w-0 gap-3 lg:grid-cols-2"><section aria-label="Current KB answer" className="min-w-0 rounded-lg border border-slate-200 bg-white p-3"><h5 className="text-xs font-semibold">Current KB answer</h5><p className="my-1 text-xs text-slate-500">{target.status} &middot; {target.category} &middot; {target.port}</p><p className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">{target.content}</p></section><section aria-label="Proposed KB answer" className="min-w-0 rounded-lg border border-sky-200 bg-white p-3"><h5 className="text-xs font-semibold">Proposed KB answer</h5><p className="my-1 text-xs text-slate-500">{form.category} &middot; {form.port}</p><p className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">{form.content}</p></section></div><button type="button" className={button} disabled={busy} onClick={() => void chooseTarget(target.id)}>Refresh target version</button></div>}</div>}
            <label className="block text-xs font-medium">Review note / rejection reason<textarea rows={2} maxLength={2000} disabled={busy} className={input} value={form.note} onChange={event => field('note', event.target.value)} /></label>
            <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !form.title.trim() || !form.content.trim() || (mode === 'UPDATE' && !target)} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Approve and publish KB</button><button type="button" className={button} disabled={busy || !form.note.trim()} onClick={() => void review('REJECT')}>Reject suggestion</button><button type="button" className={button} disabled={busy} onClick={closeReview}>Close review</button></div>
          </form>}
          {events.length > 0 && <div className="mt-5 border-t border-slate-100 pt-3"><h5 className="text-xs font-semibold">Review history</h5>{events.map(event => <p key={event.id} className="mt-1 text-xs text-slate-500">{event.action} · {new Date(event.created_at).toLocaleString()}</p>)}</div>}
        </>
      </div>}
    </div>
  </section>;
}

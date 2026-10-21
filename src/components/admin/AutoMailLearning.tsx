import React, { useEffect, useState } from 'react';
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

export function AutoMailLearning({ ready, refreshToken, onReviewed }: { ready: boolean; refreshToken: number; onReviewed: () => void }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ status: 'PENDING', offset: 0 });
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Suggestion | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'NEW' | 'UPDATE'>('NEW');
  const [targetQuery, setTargetQuery] = useState('');
  const [targets, setTargets] = useState<KnowledgeArticle[]>([]);
  const [target, setTarget] = useState<KnowledgeArticle | null>(null);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError('');
    const query = new URLSearchParams({ status: filter.status, offset: String(filter.offset) });
    void knowledgeRequest<{ suggestions: Suggestion[]; total: number }>(`learning?${query}`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setItems(result.suggestions); setTotal(result.total); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, filter, attempt, refreshToken]);

  const open = async (id: string) => {
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
    try { const result = await knowledgeRequest<{ article: KnowledgeArticle }>(`knowledge-article?id=${encodeURIComponent(id)}`); setTarget(result.article); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load target article.'); }
    finally { setBusy(false); }
  };
  const review = async (action: 'APPROVE' | 'REJECT') => {
    if (!selected || !form || (action === 'APPROVE' && mode === 'UPDATE' && !target)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await knowledgeRequest<{ suggestion: Suggestion }>('learning-review', { ...form, id: selected.id, version: selected.version, action,
        keywords: form.keywords.split(',').map(tag => tag.trim()).filter(Boolean), targetId: mode === 'UPDATE' ? target?.id : null, targetVersion: mode === 'UPDATE' ? target?.version : null });
      setSelected(result.suggestion); setDirty(false); setEvents([]); onReviewed();
      setNotice(action === 'APPROVE' ? 'Learning approved and published to the KB. Future drafts can use the reviewed answer.' : 'Suggestion rejected. The KB was not changed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to review suggestion.'); }
    finally { setBusy(false); }
  };
  const field = (name: keyof Form, value: string) => { setForm(current => current ? { ...current, [name]: value } : current); setDirty(true); };

  if (!ready) return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Apply the Milestone 4 learning migration to the Auto Mail database, then refresh. Existing inbox, KB and draft features remain available.</p>;
  return <section aria-label="Learning review queue" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Learning review</h3><p className="mt-1 text-xs text-slate-500">Turn confirmed staff replies into reusable, reviewed knowledge.</p></div><button className={button} disabled={busy || dirty || loading} onClick={() => setAttempt(value => value + 1)}>Refresh queue</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"><label className="text-xs font-medium text-slate-600">Review status<select aria-label="Learning status" disabled={busy || dirty} value={filter.status} onChange={event => setFilter({ status: event.target.value, offset: 0 })} className={input}><option value="PENDING">Pending review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="">All statuses</option></select></label><p role="status" className="my-3 text-xs text-slate-500">{loading ? 'Loading suggestions...' : `${total} suggestion${total === 1 ? '' : 's'}`}</p><div className="max-h-[600px] space-y-2 overflow-y-auto">{items.map(item => <button type="button" key={item.id} disabled={busy || dirty} onClick={() => void open(item.id)} aria-pressed={selected?.id === item.id} className={`w-full rounded-lg border p-3 text-left disabled:opacity-50 ${selected?.id === item.id ? 'border-sky-300 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}><p className="break-words text-sm font-semibold">{item.proposed_title}</p><p className="mt-1 text-xs text-slate-500">{item.reason === 'AI_CORRECTION' ? 'Edited AI reply' : 'Staff reply'} · {item.status}</p></button>)}</div>{!loading && !items.length && <p className="py-6 text-sm text-slate-500">No suggestions in this queue. Edited AI replies are added after a confirmed send; manual replies can be nominated after sending.</p>}<div className="mt-4 flex justify-between gap-2"><button className={button} disabled={busy || dirty || loading || filter.offset === 0} onClick={() => setFilter(current => ({ ...current, offset: Math.max(0, current.offset - 25) }))}>Previous</button><button className={button} disabled={busy || dirty || loading || filter.offset + 25 >= total} onClick={() => setFilter(current => ({ ...current, offset: current.offset + 25 }))}>Next</button></div></aside>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        {!selected || !form ? <p className="py-8 text-sm text-slate-500">Select a suggestion to compare the evidence and review the reusable answer.</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Review suggestion</h4><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{selected.status} · v{selected.version}</span><button className={button} disabled={busy || dirty} onClick={() => void open(selected.id)}>Reload review history</button></div>
          <details className="my-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Source evidence{selected.evidence?.mailbox ? ` · ${selected.evidence.mailbox}` : ''}</summary><div className="mt-3 space-y-3"><div><h5 className="text-xs font-semibold">Customer question</h5><p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">{selected.evidence?.question || 'No question snapshot was recorded for this reply.'}</p></div>{selected.evidence?.ai_original && <div><h5 className="text-xs font-semibold">Original AI draft</h5><p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">{selected.evidence.ai_original}</p></div>}<div><h5 className="text-xs font-semibold">Reply actually sent</h5><p className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">{selected.evidence?.sent_reply || selected.proposed_content}</p></div>{selected.evidence?.ai_sources?.map(source => <details key={source.id} className="rounded border border-slate-100 p-2"><summary className="cursor-pointer text-xs">Source snapshot: {source.title} · v{source.version}</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600">{source.content}</p></details>)}</div></details>
          {selected.status !== 'PENDING' ? <div className="space-y-3"><p className="text-sm text-slate-600">Review note: {selected.review_note || 'No additional note.'}</p>{selected.reviewed_article && <><h5 className="text-sm font-semibold">Published: {selected.reviewed_article.title} · v{selected.reviewed_article.version}</h5><p className="whitespace-pre-wrap break-words text-sm text-slate-700">{selected.reviewed_article.content}</p></>}</div> : <form onSubmit={event => { event.preventDefault(); void review('APPROVE'); }} className="space-y-3">
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Generalize names, email addresses, reference numbers and one-off details before approval. Confirm that the procedure applies to the selected port or scope.</p>
            <label className="block text-xs font-medium">Article title<input required maxLength={160} disabled={busy} className={input} value={form.title} onChange={event => field('title', event.target.value)} /></label>
            <label className="block text-xs font-medium">Summary<textarea rows={2} maxLength={400} disabled={busy} className={input} value={form.summary} onChange={event => field('summary', event.target.value)} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">Category<input required maxLength={80} disabled={busy} className={input} value={form.category} onChange={event => field('category', event.target.value)} /></label><label className="block text-xs font-medium">Port / scope<input required maxLength={80} disabled={busy} className={input} value={form.port} onChange={event => field('port', event.target.value)} /></label></div>
            <label className="block text-xs font-medium">Keywords (comma separated)<input disabled={busy} className={input} value={form.keywords} onChange={event => field('keywords', event.target.value)} /></label>
            <label className="block text-xs font-medium">Reusable answer<textarea required rows={9} maxLength={30000} disabled={busy} className={input} value={form.content} onChange={event => field('content', event.target.value)} /></label>
            <label className="block text-xs font-medium">Publish as<select disabled={busy} className={input} value={mode} onChange={event => { setMode(event.target.value as 'NEW' | 'UPDATE'); setDirty(true); }}><option value="NEW">New KB article</option><option value="UPDATE">Update an existing KB article</option></select></label>
            {mode === 'UPDATE' && <div className="space-y-2 rounded-lg border border-sky-100 bg-sky-50/40 p-3"><label className="block text-xs font-medium">Find existing KB article<input maxLength={200} disabled={busy} className={input} value={targetQuery} onChange={event => setTargetQuery(event.target.value)} /></label><button type="button" className={button} disabled={busy} onClick={() => void searchTargets()}>Search KB targets</button><div className="space-y-1">{targets.map(item => <button type="button" className={`${button} block w-full text-left`} disabled={busy} key={item.id} onClick={() => void chooseTarget(item.id)}>Use {item.title} · {item.port} · v{item.version}</button>)}</div>{target && <div><p className="text-xs font-semibold">Selected target: {target.title} · v{target.version}</p><details className="my-2"><summary className="cursor-pointer text-xs">Current KB answer</summary><p className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">{target.content}</p></details><button type="button" className={button} disabled={busy} onClick={() => void chooseTarget(target.id)}>Refresh target version</button></div>}</div>}
            <label className="block text-xs font-medium">Review note / rejection reason<textarea rows={2} maxLength={2000} disabled={busy} className={input} value={form.note} onChange={event => field('note', event.target.value)} /></label>
            <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !form.title.trim() || !form.content.trim() || (mode === 'UPDATE' && !target)} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Approve and publish KB</button><button type="button" className={button} disabled={busy || !form.note.trim()} onClick={() => void review('REJECT')}>Reject suggestion</button><button type="button" className={button} disabled={busy} onClick={() => { setSelected(null); setForm(null); setDirty(false); }}>Close review</button></div>
          </form>}
          {events.length > 0 && <div className="mt-5 border-t border-slate-100 pt-3"><h5 className="text-xs font-semibold">Review history</h5>{events.map(event => <p key={event.id} className="mt-1 text-xs text-slate-500">{event.action} · {new Date(event.created_at).toLocaleString()}</p>)}</div>}
        </>}
      </div>
    </div>
  </section>;
}

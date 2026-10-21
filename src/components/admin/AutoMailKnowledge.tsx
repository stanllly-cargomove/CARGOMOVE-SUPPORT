import React, { useEffect, useState } from 'react';
import { BookOpen, Plus, Search } from 'lucide-react';
import { KnowledgeArticle, KnowledgeRevision, knowledgeRequest } from '../../services/autoMailKnowledge';

type Form = { title: string; summary: string; content: string; category: string; port: string; keywords: string };
const blank = (): Form => ({ title: '', summary: '', content: '', category: 'General', port: 'ALL', keywords: '' });
const button = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50';
const input = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50';

export function AutoMailKnowledge({ ready, refreshToken = 0 }: { ready: boolean; refreshToken?: number }) {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({ q: '', status: '', offset: 0 });
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<KnowledgeArticle | null>(null);
  const [revisions, setRevisions] = useState<KnowledgeRevision[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState<Form>(blank);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ q: filter.q, status: filter.status, offset: String(filter.offset) });
    void knowledgeRequest<{ articles: KnowledgeArticle[]; total: number }>(`knowledge?${query}`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setArticles(result.articles); setTotal(result.total); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, filter, attempt, refreshToken]);

  const applyArticle = (article: KnowledgeArticle) => {
    setSelected(article); setForm({ title: article.title, summary: article.summary, content: article.content, category: article.category, port: article.port, keywords: article.keywords.join(', ') });
    setEditorOpen(true); setDirty(false);
  };
  const open = async (id: string) => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await knowledgeRequest<{ article: KnowledgeArticle; revisions: KnowledgeRevision[] }>(`knowledge-article?id=${encodeURIComponent(id)}`); applyArticle(result.article); setRevisions(result.revisions); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open article.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await knowledgeRequest<{ article: KnowledgeArticle }>('knowledge', { ...form, keywords: form.keywords.split(',').map(tag => tag.trim()).filter(Boolean),
        ...(selected ? { id: selected.id, version: selected.version } : {}) });
      applyArticle(result.article); setRevisions([]); setAttempt(value => value + 1);
      setNotice('Draft saved. Review and approve it before using it in email searches.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save article.'); }
    finally { setBusy(false); }
  };
  const review = async (action: string) => {
    if (!selected || dirty) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await knowledgeRequest<{ article: KnowledgeArticle }>('knowledge-review', { id: selected.id, version: selected.version, action });
      applyArticle(result.article); setRevisions([]); setAttempt(value => value + 1);
      setNotice(action === 'APPROVE' ? 'Article approved. It is now available in email searches.' : action === 'ARCHIVE' ? 'Article archived and excluded from email searches.' : 'Article returned to draft and excluded from email searches.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update article status.'); }
    finally { setBusy(false); }
  };
  const field = (name: keyof Form, value: string) => { setForm(current => ({ ...current, [name]: value })); setDirty(true); setNotice(''); };

  if (!ready) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Knowledge base setup is pending. Apply the Milestone 3 KB migration to the Auto Mail database, then refresh Auto Mail. Gmail and manual replies are still available.</div>;
  return <section className="space-y-4" aria-label="Knowledge base management">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Knowledge base</h3><p className="mt-1 text-xs text-slate-500">Build and approve reusable answers. AI configuration can come later.</p></div><button className={button} disabled={busy || dirty} onClick={() => { setSelected(null); setForm(blank()); setRevisions([]); setEditorOpen(true); setNotice(''); setError(''); }}><Plus className="mr-1 inline h-4 w-4" />New article</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
        <form onSubmit={event => { event.preventDefault(); setFilter(current => ({ ...current, q: search, offset: 0 })); }} className="space-y-3">
          <label className="block text-xs font-medium text-slate-600">Search articles<input className={input} value={search} onChange={event => setSearch(event.target.value)} maxLength={200} placeholder="Title, answer, keyword..." /></label>
          <div className="flex gap-2"><select aria-label="Article status" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-xs" value={filter.status} onChange={event => setFilter(current => ({ ...current, status: event.target.value, offset: 0 }))}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="ARCHIVED">Archived</option></select><button className={button} disabled={loading}><Search className="mr-1 inline h-3 w-3" />Search</button></div>
        </form>
        <p role="status" className="my-3 text-xs text-slate-500">{loading ? 'Loading articles...' : `${total} article${total === 1 ? '' : 's'}`}</p>
        <div className="max-h-[600px] space-y-2 overflow-y-auto">{articles.map(article => <button type="button" key={article.id} disabled={busy || dirty} onClick={() => void open(article.id)} aria-pressed={selected?.id === article.id} className={`w-full rounded-lg border p-3 text-left disabled:opacity-60 ${selected?.id === article.id ? 'border-sky-300 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}><p className="break-words text-sm font-semibold text-slate-800">{article.title}</p><p className="mt-1 text-xs text-slate-500">{article.status} · v{article.version} · {article.port}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{article.summary || article.category}</p></button>)}</div>
        {!loading && !articles.length && <p className="py-6 text-center text-sm text-slate-500">No articles found. Add your first reusable answer.</p>}
        <div className="mt-3 flex justify-between gap-2"><button className={button} disabled={loading || filter.offset === 0} onClick={() => setFilter(current => ({ ...current, offset: Math.max(0, current.offset - 25) }))}>Previous</button><button className={button} disabled={loading || filter.offset + 25 >= total} onClick={() => setFilter(current => ({ ...current, offset: current.offset + 25 }))}>Next</button></div>
      </div>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        {!editorOpen ? <div className="py-12 text-center text-slate-500"><BookOpen aria-hidden="true" className="mx-auto mb-3 h-7 w-7" /><p className="text-sm">Select an article or create a new answer.</p></div> : <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{selected ? `Edit article · v${selected.version}` : 'New article'}</h4><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{selected?.status || 'DRAFT'}</span></div>
          <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
            <label className="block text-xs font-medium text-slate-700">Article title<input required maxLength={160} value={form.title} onChange={event => field('title', event.target.value)} className={input} disabled={busy} /></label>
            <label className="block text-xs font-medium text-slate-700">Short summary<textarea maxLength={400} rows={2} value={form.summary} onChange={event => field('summary', event.target.value)} className={input} disabled={busy} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium text-slate-700">Category<input required maxLength={80} value={form.category} onChange={event => field('category', event.target.value)} className={input} disabled={busy} /></label><label className="block text-xs font-medium text-slate-700">Port or scope<input required maxLength={80} value={form.port} onChange={event => field('port', event.target.value)} className={input} placeholder="ALL, NORTHPORT, WESTPORT..." disabled={busy} /></label></div>
            <label className="block text-xs font-medium text-slate-700">Keywords (comma separated)<input value={form.keywords} onChange={event => field('keywords', event.target.value)} className={input} disabled={busy} placeholder="registration, required documents" /></label>
            <label className="block text-xs font-medium text-slate-700">Answer / procedure<textarea required maxLength={30000} rows={12} value={form.content} onChange={event => field('content', event.target.value)} className={input} disabled={busy} /></label>
            {selected?.status === 'APPROVED' && <p className="text-xs text-amber-700">Saving changes returns this article to draft. Approve the revised version before using it again.</p>}
            <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !form.title.trim() || !form.content.trim() || (!!selected && !dirty)} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? 'Working...' : 'Save draft'}</button><button type="button" className={button} disabled={busy} onClick={() => { setEditorOpen(false); setSelected(null); setDirty(false); setRevisions([]); setNotice(''); }}>Cancel edits</button>{selected && <button type="button" className={button} disabled={busy || dirty} onClick={() => void open(selected.id)}>Reload & history</button>}</div>
          </form>
          {selected && <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">{selected.status === 'DRAFT' && <button className={button} disabled={busy || dirty} onClick={() => void review('APPROVE')}>Approve article</button>}{selected.status !== 'ARCHIVED' && <button className={button} disabled={busy || dirty} onClick={() => void review('ARCHIVE')}>Archive article</button>}{selected.status !== 'DRAFT' && <button className={button} disabled={busy || dirty} onClick={() => void review('DRAFT')}>Return to draft</button>}{dirty && <p className="w-full text-xs text-amber-700">Save or cancel edits before reviewing or switching articles.</p>}</div>}
          {revisions.length > 0 && <div className="mt-5 border-t border-slate-100 pt-4"><h4 className="mb-2 text-sm font-semibold">Revision history (latest 20)</h4>{revisions.map(revision => <details key={revision.id} className="border-b border-slate-100 py-2"><summary className="cursor-pointer text-xs text-slate-600">v{revision.version} · {revision.action.replaceAll('_', ' ')} · {new Date(revision.created_at).toLocaleString()}</summary><p className="mt-2 break-words text-sm font-medium">{revision.snapshot.title}</p><p className="my-1 text-xs text-slate-500">{revision.snapshot.status} · {revision.snapshot.port}</p><p className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-700">{revision.snapshot.content}</p></details>)}</div>}
        </>}
      </div>
    </div>
  </section>;
}

export function AutoMailKnowledgeMatches({ subject, message, disabled, onInsert }: { subject: string; message: string; disabled: boolean; onInsert: (answer: string) => void }) {
  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const search = async () => {
    setBusy(true); setError('');
    try {
      const result = await knowledgeRequest<{ articles: KnowledgeArticle[] }>('knowledge-matches', { query: (query.trim() || `${subject}\n${message}`).slice(0, 4000) });
      setArticles(result.articles); setSearched(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to find approved articles.'); }
    finally { setBusy(false); }
  };
  const insert = async (source: KnowledgeArticle) => {
    setBusy(true); setError('');
    try {
      const result = await knowledgeRequest<{ article: KnowledgeArticle }>(`knowledge-article?id=${encodeURIComponent(source.id)}`);
      if (result.article.status !== 'APPROVED' || result.article.version !== source.version) throw new Error('This article changed or is no longer approved. Search again before using it.');
      onInsert(result.article.content);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to insert answer.'); }
    finally { setBusy(false); }
  };
  return <aside className="my-4 space-y-3 rounded-lg border border-sky-100 bg-sky-50/40 p-3" aria-label="Approved knowledge search">
    <h4 className="text-sm font-semibold text-slate-800">Find an approved answer</h4>
    <p className="text-xs text-slate-500">Search the KB using this email or your own keywords. Review the scope before adding an answer to your reply.</p>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void search(); }}><input aria-label="Knowledge search keywords" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="Leave blank to search from this email" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs" disabled={busy || disabled} /><button className={button} disabled={busy || disabled}>{busy ? 'Working...' : 'Find KB articles'}</button></form>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {searched && !articles.length && <p role="status" className="text-xs text-slate-600">No approved articles matched. Try different keywords or add and approve a KB article.</p>}
    {articles.map(article => <details key={article.id} className="rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer break-words text-sm font-medium text-slate-800">{article.title}<span className="ml-2 text-xs font-normal text-slate-500">{article.port} · v{article.version}</span></summary><p className="mt-2 text-xs text-slate-500">{article.summary}</p><p className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-700">{article.content}</p><button className={button} disabled={busy || disabled} onClick={() => void insert(article)}>Add answer to reply</button></details>)}
  </aside>;
}

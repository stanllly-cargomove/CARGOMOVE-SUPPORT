import { AutoMailListTools } from './AutoMailListTools';
import { AutoMailRelatedKnowledge } from './AutoMailRelatedKnowledge';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, MoreVertical, Plus } from 'lucide-react';
import { KnowledgeArticle, KnowledgeRevision, knowledgeRequest } from '../../services/autoMailKnowledge';

type Form = { title: string; summary: string; content: string; category: string; port: string; keywords: string };
const blank = (): Form => ({ title: '', summary: '', content: '', category: 'General', port: 'ALL', keywords: '' });
const jsonTemplate = JSON.stringify({
  title: 'Customer question or issue',
  summary: 'Brief description of this article',
  category: 'General',
  port: 'ALL',
  keywords: ['keyword', 'search phrase'],
  content: 'Write the answer or procedure here.\n1. First step\n2. Next step',
}, null, 2);

function readArticleJson(text: string): Form {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('Invalid JSON. Use double quotes and remove trailing commas.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Paste one JSON article object.');
  const article = value as Record<string, unknown>;
  const result = blank();
  for (const [name, limit] of [['title', 160], ['summary', 400], ['category', 80], ['port', 80], ['content', 30000]] as const) {
    if (article[name] === undefined && name !== 'title' && name !== 'content') continue;
    if (typeof article[name] !== 'string') throw new Error(`The "${name}" field must be text.`);
    const field = (article[name] as string).trim();
    if ((!field && name !== 'summary') || field.length > limit) throw new Error(`The "${name}" field ${!field ? 'is required' : `must be at most ${limit.toLocaleString()} characters`}.`);
    result[name] = name === 'port' ? field.toUpperCase() : field;
  }
  const keywords = article.keywords ?? [];
  if (!Array.isArray(keywords) || keywords.some(tag => typeof tag !== 'string')) throw new Error('The "keywords" field must be an array of strings.');
  const tags = [...new Set((keywords as string[]).flatMap(tag => tag.split(',')).map(tag => tag.trim()).filter(Boolean))];
  if (tags.length > 20 || tags.some(tag => tag.length > 60)) throw new Error('Use up to 20 keywords, with at most 60 characters each.');
  result.keywords = tags.join(', ');
  return result;
}
const button = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50';
const input = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50';

export function AutoMailKnowledge({ ready, refreshToken = 0,onDirtyChange,onViewChange,hideHeader=false }: { hideHeader?:boolean; ready: boolean; refreshToken?: number;onDirtyChange?:(dirty:boolean)=>void;onViewChange?:(view:'list'|'add'|'edit')=>void }) {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ q: '', status: '', offset: 0, pageSize:20 });
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
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [optionsOpen,setOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  useEffect(()=>{onViewChange?.(editorOpen ? selected ? 'edit' : 'add' : 'list');},[editorOpen,selected?.id,onViewChange]);
  useEffect(()=>{
    if(!optionsOpen)return;
    optionsRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside=(event:PointerEvent)=>{if(!optionsRef.current?.contains(event.target as Node))setOptionsOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOptionsOpen(false);optionsButton.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[optionsOpen]);
  const closeEditor=()=>{
    if((dirty||jsonText.trim())&&!window.confirm('Discard unsaved article changes?'))return;
    setEditorOpen(false);setSelected(null);setDirty(false);setRevisions([]);setNotice('');setJsonOpen(false);setJsonText('');setJsonError('');setOptionsOpen(false);
  };
  useEffect(()=>{onDirtyChange?.(dirty || !!jsonText.trim());return()=>onDirtyChange?.(false);},[dirty,jsonText,onDirtyChange]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ q: filter.q, status: filter.status, offset: String(filter.offset),pageSize:String(filter.pageSize) });
    void knowledgeRequest<{ articles: KnowledgeArticle[]; total: number }>(`knowledge?${query}`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setArticles(result.articles); setTotal(result.total); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, filter, attempt, refreshToken]);

  const applyArticle = (article: KnowledgeArticle) => {
    setJsonOpen(false); setJsonText(''); setJsonError('');
    setSelected(article); setForm({ title: article.title, summary: article.summary, content: article.content, category: article.category, port: article.port, keywords: article.keywords.join(', ') });
    setEditorOpen(true); setDirty(false);
  };
  const open = async (id: string) => {
    if ((dirty || jsonText.trim()) && !window.confirm('Discard unsaved article changes and reload the saved article?')) return;
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
  const fillFromJson = (text: string) => {
    setJsonText(text); setJsonError(''); setNotice('');
    try {
      const imported = readArticleJson(text);
      setForm(imported); setDirty(true); setJsonText(''); setError('');
      setNotice('JSON loaded into the article fields. Review the details, then save the draft.');
    } catch (reason) { setJsonError(reason instanceof Error ? reason.message : 'Unable to read JSON.'); }
  };
  const copyJsonTemplate = async () => {
    try {
      await navigator.clipboard.writeText(jsonTemplate);
      setNotice('JSON template copied. Fill it in, then paste it into the JSON input.');
    } catch {
      setJsonOpen(true); setJsonText(jsonTemplate); setJsonError('');
      setNotice('Clipboard is unavailable. Select and copy the template from the JSON input.');
    }
  };

  if (!ready) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Knowledge base setup is pending. Apply the Milestone 3 KB migration to the Auto Mail database, then refresh Auto Mail. Gmail and manual replies are still available.</div>;
  return <section className="flex min-h-[360px] min-w-0 flex-1 flex-col" aria-label="Knowledge base management">
    {!hideHeader&&<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"><div><h3 className="font-semibold text-slate-900">Knowledge base</h3><p className="mt-1 text-xs text-slate-500">Manage and approve reusable answers for your email replies.</p></div></div>}
    {error && <p role="alert" className="mx-4 mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mx-4 mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!editorOpen && <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        <AutoMailListTools label="articles" query={filter.q} onSearch={q=>setFilter(current=>({...current,q,offset:0}))} status={filter.status} onStatus={status=>setFilter(current=>({...current,status,offset:0}))} pageSize={filter.pageSize} onPageSize={pageSize=>setFilter(current=>({...current,pageSize,offset:0}))} disabled={busy} statuses={[{value:'',label:'All statuses'},{value:'DRAFT',label:'Draft'},{value:'APPROVED',label:'Approved'},{value:'ARCHIVED',label:'Archived'}]}><button className="rounded-lg bg-sky-600 h-9 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50" disabled={busy || dirty} onClick={() => { setSelected(null); setForm(blank()); setRevisions([]); setEditorOpen(true); setNotice(''); setError(''); setJsonOpen(false); setJsonText(''); setJsonError(''); }}><Plus className="mr-1 inline h-4 w-4" />New article</button></AutoMailListTools>
        <p role="status" className="px-4 pb-2 text-xs text-slate-500">{loading?'Loading articles...':`${total} article${total===1?'':'s'}`}</p>
        <div className="min-h-0 max-w-full flex-1 overflow-auto border-y border-slate-200">
          <table aria-label="Knowledge base articles" aria-busy={loading} className="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-600"><tr>{['Article','Category','Scope','Status','Version','Updated','Action'].map(label=><th key={label} scope="col" className="px-4 py-2">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{articles.map(article=><tr key={article.id} className="hover:bg-sky-50/50">
              <td className="w-[30%] min-w-[220px] max-w-sm px-4 py-2"><button type="button" disabled={busy} onClick={()=>void open(article.id)} className="text-left font-semibold text-sky-800 hover:underline disabled:opacity-50">{article.title}</button>{article.summary&&<p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{article.summary}</p>}</td>
              <td className="px-4 py-2 text-slate-600">{article.category}</td><td className="px-4 py-2 text-slate-600">{article.port}</td>
              <td className="px-4 py-2"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${article.status==='APPROVED'?'bg-emerald-50 text-emerald-800':article.status==='ARCHIVED'?'bg-slate-100 text-slate-600':'bg-amber-50 text-amber-800'}`}>{article.status==='APPROVED'?'Approved':article.status==='ARCHIVED'?'Archived':'Draft'}</span></td>
              <td className="px-4 py-2 text-slate-600">v{article.version}</td><td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">{article.updated_at&&Number.isFinite(Date.parse(article.updated_at))?new Date(article.updated_at).toLocaleDateString():'-'}</td>
              <td className="px-4 py-2"><button type="button" aria-label={`Edit ${article.title}`} disabled={busy} onClick={()=>void open(article.id)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">Edit</button></td>
            </tr>)}</tbody>
          </table>
          {!loading&&!articles.length&&<p className="p-8 text-center text-sm text-slate-500">No articles found. Add your first reusable answer.</p>}
        </div>
        <div className="mt-auto flex justify-between gap-2 border-t border-slate-200 px-4 py-3"><button className={button} disabled={loading || filter.offset === 0} onClick={() => setFilter(current => ({ ...current, offset: Math.max(0, current.offset - current.pageSize) }))}>Previous</button><button className={button} disabled={loading || filter.offset + filter.pageSize >= total} onClick={() => setFilter(current => ({ ...current, offset: current.offset + current.pageSize }))}>Next</button></div>
      </div>}
      {editorOpen && <div className="min-w-0 border-t border-slate-200 bg-white p-4 sm:p-5">
        <button type="button" disabled={busy} onClick={closeEditor} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-sky-700 hover:underline disabled:opacity-50"><ArrowLeft className="h-4 w-4"/>Back to Knowledge Base</button>
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{selected ? `Edit article · v${selected.version}` : 'New article'}</h4><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{selected?.status || 'DRAFT'}</span><div ref={optionsRef} className="relative"><button ref={optionsButton} type="button" aria-label="Article options" aria-haspopup="menu" aria-expanded={optionsOpen} disabled={busy} onClick={()=>setOptionsOpen(value=>!value)} className="rounded-full p-2 text-slate-700 hover:bg-slate-100"><MoreVertical className="h-5 w-5"/></button>
          {optionsOpen&&<div role="menu" aria-label="Article options" onKeyDown={event=>{const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));const index=items.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null;if(next!==null){event.preventDefault();items[next]?.focus();}if(event.key==='Tab')setOptionsOpen(false);}} className="absolute right-0 top-full z-30 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100" onClick={()=>{setOptionsOpen(false);setJsonOpen(value=>!value);optionsButton.current?.focus();}}>Paste JSON</button>
            <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100" onClick={()=>{setOptionsOpen(false);void copyJsonTemplate();optionsButton.current?.focus();}}>Copy JSON template</button>
          </div>}</div></div></div>
          <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
            {jsonOpen && <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">Paste one article to fill all fields below. Omitted optional fields use defaults. This replaces the current field values; review them before saving.</p>
                <label className="block text-xs font-medium text-slate-700">Article JSON<textarea value={jsonText} disabled={busy} rows={9} spellCheck={false} className={`${input} font-mono`} placeholder={jsonTemplate} aria-invalid={!!jsonError} aria-describedby={jsonError ? 'knowledge-json-error' : undefined} onChange={event => { setJsonText(event.target.value); setJsonError(''); }} onPaste={event => { event.preventDefault(); fillFromJson(event.clipboardData.getData('text')); }} /></label>
                {jsonError && <p id="knowledge-json-error" role="alert" className="text-xs text-red-700">{jsonError}</p>}
                <button type="button" className={button} disabled={busy || !jsonText.trim()} onClick={() => fillFromJson(jsonText)}>Fill fields from JSON</button>
            </div>}
            <label className="block text-xs font-medium text-slate-700">Article title<input required maxLength={160} value={form.title} onChange={event => field('title', event.target.value)} className={input} disabled={busy} /></label>
            <label className="block text-xs font-medium text-slate-700">Short summary<textarea maxLength={400} rows={2} value={form.summary} onChange={event => field('summary', event.target.value)} className={input} disabled={busy} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium text-slate-700">Category<input required maxLength={80} value={form.category} onChange={event => field('category', event.target.value)} className={input} disabled={busy} /></label><label className="block text-xs font-medium text-slate-700">Port or scope<input required maxLength={80} value={form.port} onChange={event => field('port', event.target.value)} className={input} placeholder="ALL, NORTHPORT, WESTPORT..." disabled={busy} /></label></div>
            <label className="block text-xs font-medium text-slate-700">Keywords (comma separated)<input value={form.keywords} onChange={event => field('keywords', event.target.value)} className={input} disabled={busy} placeholder="registration, required documents" /></label>
            <label className="block text-xs font-medium text-slate-700">Answer / procedure<textarea required maxLength={30000} rows={12} value={form.content} onChange={event => field('content', event.target.value)} className={input} disabled={busy} /></label>
            <AutoMailRelatedKnowledge key={selected?.id || 'new'} query={[form.title, form.summary, form.keywords].join('\n')} excludeId={selected?.id} disabled={busy} />
            {selected?.status === 'APPROVED' && <p className="text-xs text-amber-700">Saving changes returns this article to draft. Approve the revised version before using it again.</p>}
            <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !form.title.trim() || !form.content.trim() || (!!selected && !dirty)} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? 'Working...' : 'Save draft'}</button><button type="button" className={button} disabled={busy} onClick={closeEditor}>Cancel edits</button>{selected && <button type="button" className={button} disabled={busy} onClick={() => void open(selected.id)}>Reload & history</button>}</div>
          </form>
          {selected && <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">{selected.status === 'DRAFT' && <button className={button} disabled={busy || dirty} onClick={() => void review('APPROVE')}>Approve article</button>}{selected.status !== 'ARCHIVED' && <button className={button} disabled={busy || dirty} onClick={() => void review('ARCHIVE')}>Archive article</button>}{selected.status !== 'DRAFT' && <button className={button} disabled={busy || dirty} onClick={() => void review('DRAFT')}>Return to draft</button>}{dirty && <p className="w-full text-xs text-amber-700">Save or cancel edits before reviewing or switching articles.</p>}</div>}
          {revisions.length > 0 && <div className="mt-5 border-t border-slate-100 pt-4"><h4 className="mb-2 text-sm font-semibold">Revision history (latest 20)</h4>{revisions.map(revision => <details key={revision.id} className="border-b border-slate-100 py-2"><summary className="cursor-pointer text-xs text-slate-600">v{revision.version} · {revision.action.replaceAll('_', ' ')} · {new Date(revision.created_at).toLocaleString()}</summary><p className="mt-2 break-words text-sm font-medium">{revision.snapshot.title}</p><p className="my-1 text-xs text-slate-500">{revision.snapshot.status} · {revision.snapshot.port}</p><p className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-700">{revision.snapshot.content}</p></details>)}</div>}
        </>
      </div>}
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

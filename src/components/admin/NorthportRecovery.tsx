import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Search, ShieldCheck } from 'lucide-react';
import { NORTHPORT_COLUMNS, type Match, type Recovery } from '../../types/northport';
import { reprocessApprovedRecovery, type ReprocessSubmission } from '../../services/northportReprocess';

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const buttonClass = 'rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const secondaryClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50';
const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
const displayTime = (value: string) => value?.replace('T',' ') + ' MYT';
async function recoveryResponse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(response.status === 404
      ? 'Northport recovery API was not found. Restart the local API with npm run dev:api, or redeploy the backend if this is a hosted portal.'
      : `Northport recovery API returned an unexpected response (HTTP ${response.status}). Check that the API server is running and the backend deployment is current.`);
  }
  return data;
}
function batchPause(ms:number,signal:AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('Search cancelled','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
function rangeTime(value: string, minutes: number) {
  const ms = Date.parse(value + '+08:00') + minutes * 60000;
  return Number.isFinite(ms) ? displayTime(new Date(ms+8*3600000).toISOString().slice(0,19)) : 'Enter a timestamp';
}
export function NorthportRecovery({ onBack }: { onBack: () => void }) {
  const [form,setForm] = useState({unit:'',timestamp:'',type:'ALL',before:5,after:30,sourceFilename:''});
  const [showExactFilename,setShowExactFilename] = useState(false);
  const [results,setResults] = useState<Match[]>([]);
  const [searchSummary,setSearchSummary] = useState<any>(null);
  const [selected,setSelected] = useState<Match | null>(null);
  const [values,setValues] = useState<string[]>([]);
  const [editing,setEditing] = useState(false);
  const [review,setReview] = useState(false);
  const [identityConfirmed,setIdentityConfirmed] = useState(false);
  const [approved,setApproved] = useState<{id:string;preview:string}|null>(null);
  const [history,setHistory] = useState<Recovery[]>([]);
  const [enabled,setEnabled] = useState(false);
  const [gates,setGates] = useState<string[]>([]);
  const [historyError,setHistoryError] = useState('');
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState('');
  const pending = useRef(false);
  const searchController = useRef<AbortController|null>(null);
  async function loadHistory(signal?:AbortSignal) {
    try {
      const response = await fetch('/api/dev-tools/northport-recovery',{credentials:'same-origin',signal});
      const data = await recoveryResponse(response);
      if (!response.ok) throw new Error(data.error || 'Unable to load recovery history.');
      setHistory(data.history);setEnabled(data.uploadsEnabled);setGates(data.missingGates);setHistoryError('');
    } catch(e) { if (!signal?.aborted) setHistoryError((e as Error).message); }
  }
  useEffect(()=> { const controller = new AbortController();void loadHistory(controller.signal);return ()=>{controller.abort();searchController.current?.abort();}; },[]);
  async function action(name:string,payload:any={}) {
    if(pending.current) return;
    pending.current=true;setBusy(name);setError('');setMessage('');
    const controller = new AbortController();if(name==='search') searchController.current=controller;
    try {
      if(name==='reprocess') {
        if(!enabled)throw new Error('Reprocess is disabled until production upload compatibility is verified.');
        setApproved(null);setBusy('reprocess-upload');
        const result=await reprocessApprovedRecovery(payload as ReprocessSubmission,{
          post:async(operation,body)=>{
            const response=await fetch('/api/dev-tools/northport-recovery',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CargoMove-Confirm':'northport-recovery'},body:JSON.stringify({action:operation,...body}),signal:controller.signal});
            const data=await recoveryResponse(response);
            if(!response.ok)throw new Error(data.error||data.message||'Recovery operation was not confirmed.');
            return data;
          },
          onUploaded:()=>{setSelected(null);setBusy('reprocess-wait');setMessage('Recovery File Uploaded. Preparing to run the existing Northport Containers scheduler.');void loadHistory();},
          onScheduler:()=>{setBusy('reprocess-scheduler');setMessage('Recovery File Uploaded. Requesting the existing Northport Containers scheduler.');},
        });
        setMessage(`Recovery File Uploaded. Northport scheduler triggered. ${result.message||''} Import verification: ${result.processingResult||'Verification Unavailable'}. Execution: ${result.executionId||'see scheduler audit'}.`);
        return;
      }
      if(name==='search') {
        let cursor:string|null=null;const matches:Match[]=[];const errors:any[]=[];let listed=0;let candidates=0;
        do {
          const response=await fetch('/api/dev-tools/northport-recovery',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CargoMove-Confirm':'northport-recovery'},body:JSON.stringify({action:name,...payload,...(cursor?{cursor}:{})}),signal:controller.signal});
          const data=await recoveryResponse(response);
          if(!response.ok)throw new Error(data.error||'Search stopped before completion. Results already returned may be incomplete.');
          if(!Array.isArray(data.matches)||!Array.isArray(data.errors))throw new Error('The search returned an unexpected response.');
          matches.push(...data.matches);errors.push(...data.errors);listed+=data.listed||0;candidates+=data.candidates||0;
          cursor=data.nextCursor||null;
          setResults([...matches]);setSearchSummary({...data,matches:[...matches],errors:[...errors],listed,candidates,complete:!cursor&&data.complete&&errors.length===0,scanning:!!cursor});
          if(cursor)await batchPause(5100,controller.signal);
        }while(cursor&&!controller.signal.aborted);
        return;
      }
      const response=await fetch('/api/dev-tools/northport-recovery',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CargoMove-Confirm':'northport-recovery'},body:JSON.stringify({action:name,...payload}),signal:controller.signal});
      const data=await recoveryResponse(response);
      if(!response.ok) throw new Error(data.error || data.message || 'Recovery operation failed. Check history before retrying.');
      if(name==='check') setMessage(`${data.message} Account root: ${data.root}; incoming: ${data.incoming}; processed: ${data.success}; TLS: ${data.secure || 'disabled'}.${data.coverageWarning?' '+data.coverageWarning:''}`);
      if(name==='approve') {setApproved({id:data.recovery.id,preview:data.preview});setMessage('Approved. Recovery CSV generated for review.');}
      if(name==='upload') {setMessage(data.message);setApproved(null);setSelected(null);}
      if(name==='scheduler') setMessage(`${data.status}: ${data.message} Import verification: ${data.processingResult}. Execution: ${data.executionId || 'see scheduler audit'}.`);
    } catch(e) {
      if(controller.signal.aborted) setMessage('Search cancelled.'); else setError((e as Error).message);
    } finally {if(name==='search')setSearchSummary(previous=>previous?.scanning?{...previous,scanning:false,complete:false,interrupted:true}:previous);pending.current=false;setBusy('');searchController.current=null;void loadHistory();}
  }
  const changed = selected ? NORTHPORT_COLUMNS.filter((_,i)=>values[i]!==selected.values[i]) : [];
  const identityChanged=changed.some(c=>['UNIT','GPNO','EXPNO','BLNO'].includes(c));
  const approvePayload={token:selected?.token,values,approved:true,identityConfirmed};
  const choose=(match:Match,edit:boolean)=>{setSelected(match);setValues([...match.values]);setEditing(edit);setReview(false);setApproved(null);setIdentityConfirmed(false);};
  return <div className="max-w-6xl space-y-5">
    <div><button className="mb-3 flex items-center gap-1 text-xs text-sky-700" onClick={onBack}><ArrowLeft className="h-3 w-3"/>Test Tools</button><h2 className="text-xl font-bold text-slate-900">Northport Container Recovery</h2><p className="mt-1 text-xs text-slate-500">Search → Select → Review/Edit → Approve → Upload → Run Scheduler → Verify</p></div>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><ShieldCheck className="mr-2 inline h-4 w-4"/>{enabled?'Production uploads enabled. Each upload requires approval.':'Read-only FTP mode. CSV approval and preview are available; production uploads are disabled.'}<p className="mt-1">Original SUCCESS files remain unchanged. All timestamps use Asia/Kuala_Lumpur (UTC+08:00).</p>{!enabled&&gates.length>0&&<p className="mt-1">Pending verification: {gates.map(g=>g.toLowerCase().replaceAll('_',' ')).join(', ')}.</p>}</div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-800">{message}</p>}
    <section className={cardClass}><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Search Container</h3><button disabled={!!busy} className={secondaryClass} onClick={()=>void action('check')}>Check read-only connection</button></div>
      <form onSubmit={e=>{e.preventDefault();if(pending.current)return;setResults([]);setSearchSummary(null);setSelected(null);setApproved(null);void action('search',{...form,sourceFilename:showExactFilename?form.sourceFilename:''});}} className="space-y-4">
        <fieldset disabled={busy==='search'} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-medium">Container Number<input required maxLength={32} pattern="[A-Z0-9]+" placeholder="MSBU4179350" className={inputClass+' mt-1'} value={form.unit} onChange={e=>setForm({...form,unit:e.target.value.trim().toUpperCase()})}/></label>
          <label className="text-xs font-medium lg:col-span-2">Port Generated Timestamp (Malaysia)<input required type="datetime-local" step="1" className={inputClass+' mt-1'} value={form.timestamp} onChange={e=>setForm({...form,timestamp:e.target.value.length===16?e.target.value+':00':e.target.value})}/></label>
          <label className="text-xs font-medium">Container Type<select className={inputClass+' mt-1'} value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="ALL">All</option><option value="GP">Import (GP)</option><option value="EX">Export (EX)</option></select></label>
          <div className="grid grid-cols-2 gap-2">{(['before','after'] as const).map(key=><label key={key} className="text-xs font-medium">Minutes {key}<input type="number" min="0" max="1440" step="1" required className={inputClass+' mt-1'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.valueAsNumber})}/></label>)}</div>
        </div>
        <button type="button" aria-expanded={showExactFilename} aria-controls="northport-exact-search" className="text-xs text-sky-700" onClick={()=>{setShowExactFilename(v=>!v);setForm(v=>({...v,sourceFilename:''}));}}>{showExactFilename?'Search by time range':'Use exact filename (advanced)'}</button>
        {showExactFilename&&<div id="northport-exact-search" className="max-w-xl"><label htmlFor="northport-source-filename" className="block text-xs font-medium">Exact Source Filename (optional)</label><input id="northport-source-filename" aria-describedby="northport-source-hint" maxLength={64} placeholder="CM_CONTAINER_20261017012016_GP.csv" className={inputClass+' mt-1'} value={form.sourceFilename} onChange={e=>setForm({...form,sourceFilename:e.target.value.trim()})}/><p id="northport-source-hint" className="mt-1 text-xs text-slate-500">Search only this file. Its filename must match the selected time window and GP/EX filter. Leave blank to scan the entire time range.</p></div>}
        </fieldset>
        <p className="text-xs text-slate-600">Search range: <strong>{rangeTime(form.timestamp,-form.before)}</strong> to <strong>{rangeTime(form.timestamp,form.after)}</strong></p>
        <div className="flex items-center gap-3"><button disabled={!!busy} className={buttonClass} type="submit">{busy==='search'?<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>:<Search className="mr-2 inline h-4 w-4"/>}Search FTP</button>{busy==='search'&&<button type="button" className={secondaryClass} onClick={()=>searchController.current?.abort()}>Cancel Search</button>}</div>
        <p className="text-xs text-slate-500">Leave the filename blank to find all CSVs in the time range and scan every container record. Timestamp checks run in bounded batches with progress; wider ranges take longer. Maximum 40 files / 16 MiB per search. No files are changed.</p>
      </form>
    </section>
    {busy&&<p role="status" className="text-sm text-sky-700">{busy==='search'?'Checking timestamp filenames and scanning container records…':busy==='reprocess-upload'?'Uploading the approved recovery CSV…':busy==='reprocess-wait'?'Recovery File Uploaded. Preparing the Northport scheduler…':busy==='reprocess-scheduler'?'Running the existing Northport Containers scheduler…':`${busy==='upload'?'Uploading':busy==='scheduler'?'Requesting existing scheduler':busy==='approve'?'Saving approval':'Checking FTP'}…`}</p>}
    {searchSummary&&<section className={cardClass}><h3 className="mb-2 text-sm font-bold">Search Results</h3><p className="mb-3 text-xs text-slate-500">{searchSummary.listingMode==='timestamp-scan'?`${searchSummary.progress?.files||0} files scanned · ${searchSummary.progress?.records||0} container records read`:`${searchSummary.listed} entries listed · ${searchSummary.candidates} candidate files`} · {results.length} matching records · Record numbers exclude the header and blank lines.</p>
      {searchSummary.progress&&<div className="mb-3 text-xs text-sky-800"><p>{searchSummary.scanning?'Searching':'Checked'} {searchSummary.progress.checked.toLocaleString()} / {searchSummary.progress.total.toLocaleString()} timestamp filenames · {searchSummary.progress.files} files scanned · {searchSummary.progress.records} records read</p><progress className="mt-2 h-2 w-full" aria-label="Filename scan progress" max={searchSummary.progress.total||1} value={searchSummary.progress.checked}/></div>}
      {searchSummary.interrupted&&<p role="alert" className="mb-3 text-sm text-amber-900">Search stopped before completion. Results shown are incomplete; start a new search to check the entire range.</p>}
      {searchSummary.scope==='file'&&<p className="mb-3 text-xs text-sky-800">Searched only {searchSummary.sourceFilename}. Other files in the time window were not searched.</p>}
      {searchSummary.coverageWarning&&<p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Search incomplete: {searchSummary.coverageWarning}</p>}
      {searchSummary.errors?.map((e:any)=><p role="alert" key={e.filename} className="mb-2 text-xs text-red-700">{e.filename}: {e.message} Recovery from this file is blocked. Search results are incomplete.</p>)}
      {!results.length&&<p className="text-sm">{searchSummary.scanning?'The search is still running. Every discovered CSV is scanned; no matching record has been found yet.':searchSummary.interrupted?'No matches were found in the completed batches. The rest of the time range was not checked.':searchSummary.coverageWarning?'No matching record was returned by this incomplete search. The container may exist in files omitted by the server.':searchSummary.complete?(searchSummary.scope==='file'?'No matching container record was found in the selected source file.':'No matching container record was found within the selected timestamp range.'):'No matches in valid files; malformed candidate files could not be searched.'} {!searchSummary.scanning&&!searchSummary.interrupted&&<>{searchSummary.candidates===0&&' No candidate files were found in the checked scope.'} {searchSummary.scope==='file'?'Check the source filename or clear it to discover other files.':'Increase the search window or switch the GP/EX filter, then search again.'}</>}</p>}
      {!!results.length&&<><p className="mb-3 text-xs text-slate-500">Reprocess opens the selected record for review. Approval is required before upload and scheduler execution.</p><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Container Number','Type','Source Filename','File Timestamp','Record Number','Match Status','Actions'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{results.map((m,i)=><tr key={m.filename+':'+m.record} className="border-t border-slate-100"><td className="p-2 font-semibold">{m.values[0]}</td><td className="p-2">{m.type==='GP'?'Import (GP)':'Export (EX)'}</td><td className="p-2">{m.filename}</td><td className="p-2">{displayTime(m.timestamp)}</td><td className="p-2">{m.record}</td><td className="p-2 text-emerald-700">Exact UNIT match</td><td className="p-2"><div className="flex flex-wrap gap-3"><button disabled={!!busy} className="text-sky-700" onClick={()=>choose(results[i],false)}>View Details</button><button disabled={!!busy} className="text-sky-700" onClick={()=>choose(results[i],true)}>Edit Record</button><button disabled={!!busy} className="font-semibold text-sky-700" onClick={()=>{choose(results[i],false);setReview(true);}}>Reprocess</button></div></td></tr>)}</tbody></table></div></>}
    </section>}
    {selected&&<section className={cardClass}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold">{review?'Review & Approval':editing?'Edit Record':'Record Details'} — {selected.values[0]}</h3><p className="mt-1 text-xs text-slate-500">{selected.type} · {selected.filename} · {displayTime(selected.timestamp)} · Record {selected.record}</p></div><button disabled={!!busy||!!approved} className={secondaryClass} onClick={()=>{setValues([...selected.values]);setReview(false);setIdentityConfirmed(false);}}>Reset Changes</button></div>
      {!review?<><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{NORTHPORT_COLUMNS.map((column,i)=><label key={column} className={'rounded-lg border p-2 text-xs '+(values[i]!==selected.values[i]?'border-amber-300 bg-amber-50':'border-slate-100')}><span className="font-semibold">{column}</span><input aria-label={column} readOnly={!editing} maxLength={1000} className={inputClass+' mt-1'} value={values[i]} onChange={e=>setValues(v=>v.map((x,n)=>n===i?(i===0?e.target.value.trim().toUpperCase():e.target.value):x))}/>{values[i]!==selected.values[i]&&<span className="mt-1 block break-all text-amber-800">Original: {selected.values[i]||'(blank)'}</span>}</label>)}</div><p className="my-3 text-xs text-slate-500">Blank values and leading zeros are preserved. Business rules require worker-owner confirmation.</p><button disabled={!!busy} className={buttonClass} onClick={()=>{setEditing(true);setReview(true);}}>Review Record</button></>:<>
        <div className="my-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Field</th><th className="p-2">Original</th><th className="p-2">New Value</th></tr></thead><tbody>{NORTHPORT_COLUMNS.map((column,i)=><tr key={column} className={values[i]!==selected.values[i]?'bg-amber-50':'border-t border-slate-100'}><td className="p-2 font-semibold">{column}</td><td className="max-w-xs break-all p-2 whitespace-pre-wrap">{selected.values[i]||'(blank)'}</td><td className="max-w-xs break-all p-2 whitespace-pre-wrap">{values[i]||'(blank)'}</td></tr>)}</tbody></table></div>
        {identityChanged&&<label className="mb-4 flex gap-2 text-sm"><input type="checkbox" disabled={!!approved} checked={identityConfirmed} onChange={e=>setIdentityConfirmed(e.target.checked)}/>I confirm changes to UNIT, GPNO, EXPNO or BLNO and have checked the record identity.</label>}
        {!approved?<div className="flex gap-2"><button disabled={!!busy} className={secondaryClass} onClick={()=>setReview(false)}>Back to Editor</button><button disabled={!!busy||(identityChanged&&!identityConfirmed)} className={buttonClass} onClick={()=>{if(window.confirm(`Approve this ${selected.type} record for ${values[0]}? ${changed.length} changed fields. The original file will remain unchanged.`))void action('approve',approvePayload);}}>Approve & Generate Recovery CSV</button></div>:<div className="space-y-3"><p className="text-sm font-semibold text-emerald-700">Approved · CSV Preview</p><pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">{approved.preview}</pre><p className="text-xs text-slate-500">Reprocess uploads this single-container CSV to CONTAINERS and then runs the existing Northport Containers scheduler. The original SUCCESS file remains unchanged. Scheduler dispatch does not confirm container import.</p><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={!enabled||!!busy} onClick={()=>{if(window.confirm(`Reprocess ${values[0]}? Upload the approved single-container CSV to the production CONTAINERS folder and run the existing Northport Containers scheduler. The original SUCCESS file will remain unchanged. Do not retry if the outcome is uncertain.`))void action('reprocess',{...approvePayload,id:approved.id});}}>Reprocess & Run Scheduler</button><button className={secondaryClass} disabled={!enabled||!!busy} onClick={()=>{if(window.confirm('Upload the approved recovery to the production incoming folder? Do not retry if the outcome is uncertain.'))void action('upload',{...approvePayload,id:approved.id});}}>Upload Recovery CSV</button></div><p className="text-xs text-slate-500">The final Northport filename is allocated at upload. The plain-text preview preserves worker data without evaluating spreadsheet formulas.</p>{!enabled&&<p className="text-xs text-amber-800">Reprocess and upload are disabled pending preproduction verification.</p>}</div>}
      </>}
    </section>}
    <section className={cardClass}><div className="mb-3 flex justify-between"><h3 className="text-sm font-bold">Recovery History</h3><button className="text-xs text-sky-700" disabled={!!busy} onClick={()=>void loadHistory()}>Refresh History</button></div>{historyError&&<p role="alert" className="mb-2 text-sm text-red-700">{historyError}</p>}
      <p className="mb-3 text-xs text-slate-500">Latest 50 approvals. A scheduler response does not prove import. No container import verification API is configured.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Container / Type','Source → Recovery','Submitted By / Time','Changed Fields','Status / Processing','Scheduler / Actions'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{history.map(row=><tr key={row.id} className="border-t border-slate-100"><td className="p-2 font-semibold">{row.container} / {row.container_type}</td><td className="p-2">{row.source_filename}<br/>{row.recovery_filename||'Filename allocated on upload'}</td><td className="p-2">{row.submitted_by}<br/>{new Date(row.created_at).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})} MYT</td><td className="p-2">{row.changed_fields.join(', ')||'None'}</td><td className="p-2">{row.status}<br/>{row.processing_result||'Not submitted'}{row.status==='Uploading'&&<p className="text-amber-800">If interrupted, check FTP before resolving. Do not retry.</p>}</td><td className="p-2">{row.scheduler_status||'Not requested'}{row.scheduler_run_id&&<p>Execution: {row.scheduler_run_id}</p>}{row.status==='Uploaded'&&!row.scheduler_status&&<div className="mt-2 flex flex-wrap gap-2"><button className={buttonClass} disabled={!!busy} onClick={()=>{if(window.confirm('Run the existing Northport scheduler on CargoMove?'))void action('scheduler',{id:row.id});}}>Run Scheduler Now</button><button className={secondaryClass} disabled={!!busy} onClick={()=>setMessage('Process Later selected. The existing production scheduler may process the uploaded file on its normal schedule. Import verification is unavailable.')}>Process Later</button></div>}</td></tr>)}</tbody></table>{!history.length&&!historyError&&<p className="py-3 text-sm text-slate-500">No recovery approvals yet.</p>}</div>
    </section>
  </div>;
}

import { Toaster } from 'react-hot-toast';
import { notifyError, notifySuccess } from '../common/notifications';
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Check, CheckCircle2, ChevronDown, Clock3, Container, Download, FileClock, FileSearch, History, Info, ListFilter, Loader2, MoreVertical, PlugZap, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { NORTHPORT_COLUMNS, type Match, type Recovery } from '../../types/northport';
import { reprocessApprovedRecovery, type ReprocessSubmission } from '../../services/northportReprocess';

const notificationOptions = { toasterId: 'northport' };
const northportToaster = <Toaster toasterId="northport" position="top-center" containerStyle={{top:16}} toastOptions={{duration:6000}}/>;
const inputClass = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#0095e8] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0078c8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const cardClass = 'min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm';
const tableHeadingClass = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600';
function RecordActions({ disabled, onChoose }: { disabled: boolean; onChoose: (action: 'edit' | 'reprocess') => void }) {
  const menuRef=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false);
  useEffect(()=>{if(disabled)menuRef.current?.hidePopover();},[disabled]);
  return <>
    <button type="button" disabled={disabled} aria-label="Record actions" aria-haspopup="dialog" aria-expanded={open} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" onClick={event=>{
      const menu=menuRef.current;if(!menu)return;
      if(menu.matches(':popover-open')){menu.hidePopover();return;}
      const rect=event.currentTarget.getBoundingClientRect();
      menu.style.left=Math.max(8,Math.min(rect.right-184,window.innerWidth-192))+'px';
      menu.style.top=Math.max(8,rect.bottom+148>window.innerHeight?rect.top-144:rect.bottom+4)+'px';
      menu.showPopover();menu.querySelector<HTMLButtonElement>('button')?.focus();
    }}><MoreVertical aria-hidden="true" className="h-4 w-4"/></button>
    <div ref={menuRef} popover="auto" role="dialog" aria-label="Record actions" onToggle={()=>setOpen(menuRef.current?.matches(':popover-open')??false)} style={{position:'fixed',margin:0}} className="w-[184px] rounded-xl border border-slate-200 bg-white p-1.5 text-xs text-slate-700 shadow-xl">
      {([['edit','View/Edit File'],['reprocess','Reprocess']] as const).map(([action,label])=><button key={action} type="button" disabled={disabled} className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-slate-100 focus-visible:bg-blue-50 focus-visible:outline-none disabled:opacity-50" onClick={()=>{menuRef.current?.hidePopover();onChoose(action);}}>{label}</button>)}
    </div>
  </>;
}
function FileEditorDialog({ children, busy, onClose, label = 'Container file editor', header, compact = false }: { children: React.ReactNode; busy: boolean; onClose: () => void; label?: string; header?: React.ReactNode; compact?: boolean }) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;const previous=document.body.style.overflow;document.body.style.overflow='hidden';dialog?.showModal();return()=>{dialog?.close();document.body.style.overflow=previous;};},[]);
  return <dialog ref={ref} aria-label={label} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} className={`m-auto max-h-[92dvh] w-[96vw] ${compact?'max-w-2xl':'max-w-[1800px]'} overflow-auto rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 sm:p-5 shadow-2xl backdrop:bg-slate-950/50`}>
    <div className="mb-3 flex items-start justify-between gap-2">{header&&<div className="min-w-0 flex-1">{header}</div>}<button type="button" aria-label={label==='Recovery details'?'Close recovery details':'Close file editor'} disabled={busy} onClick={onClose} className="ml-auto shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5"/></button></div>
    {children}
    {northportToaster}
  </dialog>;
}
function recordCsv(values: string[]) {
  const escape=(value:string)=>/[",\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
  return NORTHPORT_COLUMNS.join(',')+'\r\n'+values.map(escape).join(',')+'\r\n';
}
function FileZillaIcon() {
  return <svg viewBox="0 0 100 100" aria-hidden="true" className="h-7 w-7"><circle cx="50" cy="50" r="49" fill="#d40000"/><path fill="white" d="M35 24h37l-3 9H42l-3 13h23l-3 9H36l-6 23H19z"/><path fill="white" d="M46 43h31l-3 9-26 24h21l-3 10H31l3-10 27-24H43z"/></svg>;
}
function SectionHeading({ step, title, description, action, icon, green = false }: {
  step?: number; title: string; description: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode; green?: boolean;
}) {
  return <div className={`${title === 'Search Container' || title === 'Search Results' ? 'mb-4' : 'mb-1'} flex flex-wrap items-start justify-between gap-1`}>
    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
      {(icon || step != null)&&<span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center text-sm font-semibold sm:h-10 sm:w-10 sm:text-base ${icon ? 'rounded-xl bg-violet-50 text-violet-600' : `rounded-full text-white ${green ? 'bg-emerald-500' : 'bg-blue-600'}`}`}>{icon || step}</span>}
      <div className="min-w-0 pt-0.5"><h3 className="text-sm font-bold text-slate-900">{title}</h3><p className="mt-0 text-xs leading-4 text-slate-500">{description}</p></div>
    </div>
    {action && <div className="mt-2 w-full max-w-full shrink-0 sm:ml-auto sm:mt-0 sm:w-auto">{action}</div>}
  </div>;
}
const displayTime = (value: string) => value?.replace('T',' ') + ' MYT';
function SearchText({ mobile, children }: { mobile: string; children: React.ReactNode }) {
  return <><span className="sm:hidden">{mobile}</span><span className="hidden sm:inline">{children}</span></>;
}
function historyStatusLabel(recovery: Recovery) {
  if (recovery.scheduler_status === 'trigger_requested' || recovery.status === 'Scheduler Triggered') return 'DONE';
  if (['Approved','Uploaded','Verification Unavailable'].includes(recovery.status)) return 'PROCESSED';
  return recovery.status.toUpperCase();
}
function HistoryStatus({ recovery }: { recovery: Recovery }) {
  const label = historyStatusLabel(recovery);
  const color = label === 'FAILED' ? 'bg-red-50 text-red-700' : label === 'UPLOADING' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700';
  return <span className={`inline-flex h-5 w-20 items-center justify-center rounded-md text-[10px] font-medium ${color}`}>{label}</span>;
}
function RecoveryDetailsContent({ recovery }: { recovery: Recovery }) {
  const fields: { label: string; value: React.ReactNode; wide?: boolean }[] = [
    { label: 'Source file', value: recovery.source_filename, wide: true },
    { label: 'Recovery file', value: recovery.recovery_filename || 'Not uploaded yet', wide: true },
    { label: 'Submitted by', value: recovery.submitted_by, wide: true },
    { label: 'Submitted at', value: `${new Date(recovery.created_at).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})} MYT`, wide: true },
    { label: 'Modification', value: recovery.changed_fields.join(', ') || 'None' },
    { label: 'Status', value: <HistoryStatus recovery={recovery}/> },
  ];
  if (recovery.processing_result && recovery.processing_result !== 'Verification Unavailable') fields.push({ label: 'Processing', value: recovery.processing_result, wide: true });
  if (recovery.scheduler_status && recovery.scheduler_status !== 'Verification Unavailable') fields.push({ label: 'Scheduler', value: recovery.scheduler_status === 'trigger_requested' ? 'Triggered' : recovery.scheduler_status, wide: true });
  if (recovery.scheduler_run_id) fields.push({ label: 'Scheduler execution ID', value: recovery.scheduler_run_id, wide: true });
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-3">{fields.map(field=><div key={field.label} className={`min-w-0 ${field.wide?'col-span-2':''}`}><dt className="text-[11px] font-medium text-slate-500">{field.label}</dt><dd className="mt-1 text-xs leading-5 text-slate-900 [overflow-wrap:anywhere]">{field.value}</dd></div>)}</dl>;
}
function exportApprovedCsv(preview: string, type: 'GP' | 'EX') {
  const timestamp = new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace(/[-:T]/g,'');
  const url = URL.createObjectURL(new Blob([preview],{type:'text/csv;charset=utf-8',endings:'transparent'}));
  const link = document.createElement('a');
  link.href=url;link.download=`CM_CONTAINER_${timestamp}_${type}.csv`;link.hidden=true;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
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
  const [form,setForm] = useState({unit:'',timestamp:'',type:'GP',before:5,after:30,sourceFilename:''});
  const [showExactFilename,setShowExactFilename] = useState(false);
  const [connectionOptions,setConnectionOptions] = useState(false);
  const [filenameOptions,setFilenameOptions] = useState(false);
  const [infoOpen,setInfoOpen] = useState(false);
  const [infoPinned,setInfoPinned] = useState(false);
  const connectionOptionsRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const filenameOptionsRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [results,setResults] = useState<Match[]>([]);
  const [searchSummary,setSearchSummary] = useState<any>(null);
  const [displayProgress,setDisplayProgress] = useState(0);
  const [selected,setSelected] = useState<Match | null>(null);
  const [values,setValues] = useState<string[]>([]);
  const [drafts,setDrafts] = useState<Record<string,string[]>>({});
  const setDraftMessage=(text:string)=>{if(text)notifySuccess(text,notificationOptions);};
  const [recoveryUploaded,setRecoveryUploaded] = useState(false);
  const [reprocessStarted,setReprocessStarted] = useState(false);
  const [review,setReview] = useState(false);
  const [identityConfirmed,setIdentityConfirmed] = useState(false);
  const [approved,setApproved] = useState<{id:string;preview:string}|null>(null);
  const [history,setHistory] = useState<Recovery[]>([]);
  const [historyDetail,setHistoryDetail] = useState<Recovery|null>(null);
  const [enabled,setEnabled] = useState(false);
  const [gates,setGates] = useState<string[]>([]);
  const [historyError,setHistoryError] = useState('');
  const setError=(text:string)=>{if(text)notifyError(text,notificationOptions);};
  const setMessage=(text:string)=>{if(text)notifySuccess(text,notificationOptions);};
  const [busy,setBusy] = useState('');
  const pending = useRef(false);
  const searchController = useRef<AbortController|null>(null);
  async function loadHistory(signal?:AbortSignal) {
    try {
      const response = await fetch('/api/dev-tools/northport-recovery',{credentials:'same-origin',cache:'no-store',signal});
      const data = await recoveryResponse(response);
      if (!response.ok) throw new Error(data.error || 'Unable to load recovery history.');
      setHistory(data.history);setEnabled(data.uploadsEnabled);setGates(data.missingGates);setHistoryError('');
    } catch(e) { if (!signal?.aborted) {setHistoryError((e as Error).message);if(!historyError)notifyError((e as Error).message,notificationOptions);} }
  }
  useEffect(()=> { const controller = new AbortController();void loadHistory(controller.signal);return ()=>{controller.abort();searchController.current?.abort();}; },[]);
  useEffect(()=>{
    const dismiss=(event:PointerEvent)=>{
      if(!connectionOptionsRef.current?.contains(event.target as Node))setConnectionOptions(false);
      if(!infoRef.current?.contains(event.target as Node)){setInfoOpen(false);setInfoPinned(false);}
      if(!filenameOptionsRef.current?.contains(event.target as Node))setFilenameOptions(false);
    };
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      setInfoOpen(false);setInfoPinned(false);
      if(infoRef.current?.contains(document.activeElement))infoRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      if(connectionOptionsRef.current?.contains(document.activeElement)){setConnectionOptions(false);connectionOptionsRef.current?.querySelector<HTMLButtonElement>('button')?.focus();}
      if(filenameOptionsRef.current?.contains(document.activeElement)){setFilenameOptions(false);filenameOptionsRef.current?.querySelector<HTMLButtonElement>('button')?.focus();}
    };
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};
  },[]);
  async function action(name:string,payload:any={}) {
    if(pending.current) return;
    pending.current=true;setBusy(name);setError('');setMessage('');
    const controller = new AbortController();if(name==='search') searchController.current=controller;
    try {
      if(name==='reprocess') {
        if(!enabled)throw new Error('Reprocess is disabled until production upload compatibility is verified.');
        setReprocessStarted(true);setBusy('reprocess-upload');
        const result=await reprocessApprovedRecovery(payload as ReprocessSubmission,{
          post:async(operation,body)=>{
            const response=await fetch('/api/dev-tools/northport-recovery',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CargoMove-Confirm':'northport-recovery'},body:JSON.stringify({action:operation,...body}),signal:controller.signal});
            const data=await recoveryResponse(response);
            if(!response.ok)throw new Error(data.error||data.message||'Recovery operation was not confirmed.');
            return data;
          },
          onUploaded:()=>{setRecoveryUploaded(true);setBusy('reprocess-wait');setMessage('Recovery File Uploaded. Preparing to run the existing Northport Containers scheduler.');void loadHistory();},
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
      if(name==='check') setMessage(`Northport is connected and ready. Container files can be searched safely.${data.coverageWarning?' '+data.coverageWarning:''}`);
      if(name==='approve') {setApproved({id:data.recovery.id,preview:data.preview});if(typeof data.uploadsEnabled==='boolean'){setEnabled(data.uploadsEnabled);if(data.uploadsEnabled)setGates([]);}setMessage('Approved. Recovery CSV generated for review.');}
      if(name==='upload') {setMessage(data.message);setApproved(null);setSelected(null);}
      if(name==='scheduler') setMessage(`${data.status}: ${data.message} Import verification: ${data.processingResult}. Execution: ${data.executionId || 'see scheduler audit'}.`);
    } catch(e) {
      if(name==='search')setSearchSummary(previous=>({listed:0,candidates:0,...previous,scanning:false,complete:false,interrupted:true}));
      if(controller.signal.aborted) setMessage('Search cancelled.'); else setError((e as Error).message);
    } finally {if(name==='search')setSearchSummary(previous=>previous?.scanning?{...previous,scanning:false,complete:false,interrupted:true}:previous);pending.current=false;setBusy('');searchController.current=null;void loadHistory();}
  }
  const changed = selected ? NORTHPORT_COLUMNS.filter((_,i)=>values[i]!==selected.values[i]) : [];
  const showSearchPercentage=busy==='search'||!!searchSummary;
  const checkedPercentage=searchSummary?.progress?.total>0?Math.min(100,Math.max(0,searchSummary.progress.checked/searchSummary.progress.total*100)):0;
  useEffect(()=>{
    if(searchSummary?.interrupted)return;
    if(busy!=='search') {
      setDisplayProgress(searchSummary?(searchSummary.complete?100:checkedPercentage):0);
      return;
    }
    // Smooth batch updates and simulate activity between responses, reserving 100% for completion.
    const ceiling=Math.min(99,checkedPercentage+8);
    const timer=window.setInterval(()=>setDisplayProgress(previous=>previous>=ceiling?previous:Math.min(ceiling,previous+Math.max(0.05,(ceiling-previous)*0.06))),100);
    return ()=>window.clearInterval(timer);
  },[busy,checkedPercentage,searchSummary?.complete,searchSummary?.interrupted]);
  const searchPercentage=Math.floor(displayProgress);
  const searchDetails=<div className={`mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-relaxed ${results.length?'justify-between text-left':'justify-center text-center'} text-slate-500`} aria-live="polite">
    {form.timestamp&&<p className="text-xs leading-relaxed text-slate-500"><span className="hidden sm:inline">Search range: </span><span className="whitespace-nowrap font-medium text-slate-700"><SearchText mobile={rangeTime(form.timestamp,-form.before).replace(' MYT','')}>{rangeTime(form.timestamp,-form.before)}</SearchText></span> to <span className="whitespace-nowrap font-medium text-slate-700"><SearchText mobile={rangeTime(form.timestamp,form.after).replace(' MYT','')}>{rangeTime(form.timestamp,form.after)}</SearchText></span></p>}
    {searchSummary?.progress&&!searchSummary.complete&&<p className="w-full sm:w-auto">{searchSummary.scanning?'Searching':'Checked'} <span className="font-medium text-slate-700">{searchSummary.progress.checked.toLocaleString()} / {searchSummary.progress.total.toLocaleString()}</span><span className="hidden sm:inline"> timestamp filenames</span></p>}
  </div>;
  const identityChanged=changed.some(c=>['UNIT','GPNO','EXPNO','BLNO'].includes(c));
  const approvePayload={token:selected?.token,values,approved:true,identityConfirmed};
  const choose=(match:Match)=>{setReprocessStarted(false);setRecoveryUploaded(false);setSelected(match);setValues([...(drafts[match.filename+':'+match.record]??match.values)]);setDraftMessage('');setError('');setMessage('');setReview(false);setApproved(null);setIdentityConfirmed(false);};
  return <div className="w-full min-w-0 space-y-5 text-slate-900">
    {!selected&&northportToaster}
    <div className="northport-header flex flex-wrap items-center justify-between gap-4 py-1">
      <div className="min-w-0"><div className="flex items-center gap-2"><h2 className="text-xl font-bold tracking-tight text-slate-900">Northport Container Recovery</h2><div ref={infoRef} className="relative" onMouseEnter={()=>setInfoOpen(true)} onMouseLeave={()=>{if(!infoPinned)setInfoOpen(false)}}><button type="button" aria-label="How it works" title="How it works" aria-expanded={infoOpen} onClick={()=>{setInfoPinned(value=>!value);setInfoOpen(true)}} className="flex h-6 w-6 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Info aria-hidden="true" className="h-3.5 w-3.5"/></button>{infoOpen&&<div className="fixed inset-x-4 top-24 z-40 max-h-[70dvh] overflow-y-auto sm:absolute sm:inset-x-auto sm:left-8 sm:top-0 sm:w-[26rem] rounded-xl border border-slate-200 bg-white p-5 text-xs shadow-xl" onMouseEnter={()=>setInfoOpen(true)}><p className="font-semibold text-slate-900">How to recover a container</p><ol className="mt-3 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-slate-600"><li>Enter the container number, EIR time, type, and search window.</li><li>Start the FTP search and select the matching container record.</li><li>Review or edit the CSV fields, then save any changes for this session.</li><li>Review the record and approve it to generate a recovery CSV.</li><li>If enabled, reprocess the approved CSV and run the Northport scheduler.</li></ol><p className="mt-4 text-xs leading-relaxed text-slate-500">The original SUCCESS file is kept unchanged. A scheduler response does not confirm container import.</p>{!enabled&&gates.length>0&&<p className="mt-3 text-xs leading-relaxed text-amber-800">Pending verification: {gates.map(g=>g.toLowerCase().replaceAll('_',' ')).join(', ')}.</p>}</div>}</div></div><p className="mt-1 max-w-3xl text-xs text-slate-500">Search and recover containers from Northport FTP files using EIR times.</p></div>
      <div className="relative ml-auto flex shrink-0 items-center gap-3">
      <div ref={connectionOptionsRef}>
        <motion.button type="button" aria-label="Northport FTP connection options" aria-expanded={connectionOptions} aria-controls="northport-connection-options" title="Northport FTP connection options" disabled={!!busy} onClick={()=>setConnectionOptions(value=>!value)} whileHover={reducedMotion?undefined:{y:-2,rotate:[0,-7,7,0],scale:1.08}} whileTap={reducedMotion?undefined:{scale:0.94}} transition={{duration:0.35}} className="relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm outline-none transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-60">{busy==='check'?<Loader2 aria-hidden="true" className="h-7 w-7 animate-spin text-slate-500"/>:<FileZillaIcon/>}<span aria-hidden="true" className="pointer-events-none absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 shadow-sm"/></motion.button>
        {connectionOptions&&<div id="northport-connection-options" role="region" aria-label="Northport FTP connection" className="absolute right-0 top-full z-30 mt-2 w-[min(86vw,19rem)] sm:right-full sm:top-0 sm:mr-2 sm:mt-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"><p className="text-xs font-semibold text-slate-900">Northport FTP</p><p className="mt-1 text-xs leading-relaxed text-slate-500">Check the server connection and folder access. No files are changed.</p><button type="button" disabled={!!busy} className={secondaryClass+' mt-3 w-full text-xs'} onClick={()=>{setConnectionOptions(false);void action('check');}}><PlugZap aria-hidden="true" className="h-3.5 w-3.5"/>Check read-only connection</button></div>}
      </div>
      </div>
    </div>


    <section className={cardClass+' northport-search-card'}>
      <SectionHeading step={1} title="Search Container" description="Enter container details and a time range to search in FTP files."/>
      <form onSubmit={e=>{e.preventDefault();if(pending.current)return;setFilenameOptions(false);setConnectionOptions(false);setResults([]);setSearchSummary(null);setDisplayProgress(0);setSelected(null);setApproved(null);void action('search',{...form,sourceFilename:showExactFilename?form.sourceFilename:''});}} className="space-y-3">
        <div className="northport-search-fields">
          <div className="min-w-0">
            <label htmlFor="northport-container" className="mb-2 block text-xs font-medium text-slate-700">Container No.</label>
            <div className="relative" ref={filenameOptionsRef}>
              <Container aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400"/>
              <input id="northport-container" disabled={busy==='search'} required maxLength={32} pattern="[A-Z0-9]+" placeholder="e.g. MSBU4179350" className={inputClass+' pl-10 pr-10'} value={form.unit} onChange={e=>setForm({...form,unit:e.target.value.trim().toUpperCase()})}/>
              <button type="button" disabled={busy==='search'} aria-label="Container search options" aria-expanded={filenameOptions} aria-controls="northport-filename-options" title={showExactFilename?'Filename search options':'Search by time range or filename'} onClick={()=>setFilenameOptions(value=>!value)} className={'absolute right-1 top-1 inline-flex h-9 w-8 items-center justify-center rounded-md outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 '+(showExactFilename?'bg-blue-50 text-blue-700':'text-slate-500')}><MoreVertical aria-hidden="true" className="h-4 w-4"/></button>
              {filenameOptions&&<div id="northport-filename-options" role="region" aria-label="Container search options" className="absolute left-0 top-full z-30 mt-2 w-[min(82vw,24rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Search mode</p>
                <button type="button" className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-slate-700 hover:bg-slate-50" onClick={()=>{setShowExactFilename(false);setForm(value=>({...value,sourceFilename:''}));setFilenameOptions(false);}}><span className="flex items-center gap-2"><Clock3 aria-hidden="true" className="h-4 w-4 text-slate-400"/>Search by time range</span>{!showExactFilename&&<Check aria-hidden="true" className="h-4 w-4 text-blue-600"/>}</button>
                <button type="button" className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-slate-700 hover:bg-slate-50" onClick={()=>{if(!showExactFilename)setForm(value=>({...value,sourceFilename:''}));setShowExactFilename(true);}}><span className="flex items-center gap-2"><FileSearch aria-hidden="true" className="h-4 w-4 text-slate-400"/>Use exact filename (advanced)</span>{showExactFilename&&<Check aria-hidden="true" className="h-4 w-4 text-blue-600"/>}</button>
                {showExactFilename&&<div id="northport-exact-search" className="mt-2 border-t border-slate-100 p-3"><label htmlFor="northport-source-filename" className="block text-xs font-medium text-slate-700">Exact Source Filename (optional)</label><input id="northport-source-filename" disabled={busy==='search'} aria-describedby="northport-source-hint" maxLength={64} placeholder="CM_CONTAINER_20261017012016_GP.csv" className={inputClass+' mt-2 text-xs'} value={form.sourceFilename} onChange={e=>setForm({...form,sourceFilename:e.target.value.trim()})}/><p id="northport-source-hint" className="mt-2 text-xs leading-relaxed text-slate-500">Search only this file. It must match the selected time window and GP/EX filter. Leave blank to scan the entire time range.</p><button type="button" className={secondaryClass+' mt-3 w-full text-xs'} onClick={()=>{setFilenameOptions(false);filenameOptionsRef.current?.querySelector<HTMLButtonElement>('button')?.focus();}}>Done</button></div>}
              </div>}
            </div>
          </div>
          <label className="min-w-0 text-xs font-medium text-slate-700">EIR time
            <span className="relative mt-2 block h-11 min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-100 sm:h-auto sm:overflow-visible sm:border-0 sm:shadow-none">
              <span aria-hidden="true" className="flex h-full flex-wrap content-center items-center gap-x-1 px-2 text-[11px] leading-[14px] sm:hidden">{form.timestamp?<><span className="whitespace-nowrap font-medium text-slate-900">{form.timestamp.slice(0,10).split('-').reverse().join('/')}</span><span className="whitespace-nowrap text-slate-500">{form.timestamp.slice(11)}</span></>:<span className="font-normal text-slate-400">Select date &amp; time</span>}</span>
              <input aria-label="EIR time (Malaysia)" disabled={busy==='search'} required type="datetime-local" step="1" className={inputClass+' cursor-pointer'} value={form.timestamp} onClick={event=>{try{event.currentTarget.showPicker?.();}catch{event.currentTarget.focus();}}} onChange={e=>setForm({...form,timestamp:e.target.value.length===16?e.target.value+':00':e.target.value})}/>
            </span>
          </label>
          <label className="min-w-0 text-xs font-medium text-slate-700">Container Type
            <span className="relative mt-2 block"><ListFilter aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500"/><select disabled={busy==='search'} className={inputClass+' appearance-none pl-10 pr-8'} value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="ALL">All</option><option value="GP">Import (GP)</option><option value="EX">Export (EX)</option></select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-500"/></span>
          </label>
          <div className="min-w-0"><div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">Time Range (min)<span title="Search this many minutes before and after the EIR time."><Info aria-hidden="true" className="h-3.5 w-3.5 text-blue-600"/></span></div><div className="grid grid-cols-2 gap-2">
            {(['before','after'] as const).map(key=><label key={key} className="relative min-w-0"><span className="sr-only">Minutes {key}</span><input disabled={busy==='search'} type="number" min="0" max="1440" step="1" required className={inputClass+' pr-12 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.valueAsNumber})}/><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-500">{key}</span></label>)}
          </div></div>
          <div className="northport-search-actions flex items-center gap-2">
            <button disabled={!!busy} className={buttonClass+' min-h-11 whitespace-nowrap'} type="submit">{busy==='search'?<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin"/>:<Search aria-hidden="true" className="h-4 w-4"/>}Search FTP</button>
            {busy==='search'?<button type="button" aria-label="Cancel Search" title="Cancel Search" className="inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={()=>searchController.current?.abort()}><X aria-hidden="true" className="h-4 w-4"/></button>:<button type="button" aria-label="Clear" title="Clear search" className="inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" disabled={!!busy} onClick={()=>{if(pending.current)return;setForm({unit:'',timestamp:'',type:'GP',before:5,after:30,sourceFilename:''});setShowExactFilename(false);setFilenameOptions(false);setResults([]);setSearchSummary(null);setDisplayProgress(0);setSelected(null);setApproved(null);setError('');setMessage('');}}><RefreshCw aria-hidden="true" className="h-4 w-4"/></button>}
          </div>
        </div>
      </form>
    </section>

    {busy&&busy!=='search'&&!selected&&<p role="status" className="flex items-center gap-2 text-xs text-blue-700"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin"/>{busy==='reprocess-upload'?'Uploading the approved recovery CSV…':busy==='reprocess-wait'?'Recovery File Uploaded. Preparing the Northport scheduler…':busy==='reprocess-scheduler'?'Running the existing Northport Containers scheduler…':`${busy==='upload'?'Uploading':busy==='scheduler'?'Requesting existing scheduler':busy==='approve'?'Saving approval':'Checking FTP'}…`}</p>}

    <section className={cardClass} aria-label="File search progress">
      <SectionHeading step={2} green title="Search Results" description={<SearchText mobile={busy==='search'?'Searching container files.':searchSummary?.interrupted?'Search stopped.':searchSummary?.complete?'Search complete.':searchSummary?'Review search results.':'Find matching container records.'}>{busy==='search'?'Scanning timestamp filenames and container records.':searchSummary?.complete?'All files in the selected search scope have been scanned.':searchSummary?'Review the scan status and any warnings below.':'Search progress will appear here when you start a search.'}</SearchText>} action={<p className="flex w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] leading-4 text-slate-500" aria-live="polite"><span>{searchSummary?.progress?.files??searchSummary?.candidates??0} files scanned</span><span aria-hidden="true" className="text-slate-300">&middot;</span><span>{searchSummary?.progress?.records??0} records read</span><span aria-hidden="true" className="text-slate-300">&middot;</span><span className="font-medium text-emerald-700">{results.length} {results.length===1?'match':'matches'}</span></p>}/>
      <div className="mb-4">
        <div className="flex items-center">
          <motion.div layout={!reducedMotion} transition={{duration:reducedMotion?0:0.3,ease:'easeOut'}} className="min-w-0 flex-1">
            <div className="relative overflow-hidden rounded-full">
              {showSearchPercentage?<div role="progressbar" aria-label="Filename scan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={searchPercentage} aria-valuetext={`${searchPercentage}%${busy==='search'?' (estimated)':''}`} className="h-3 bg-slate-100"><motion.div initial={false} animate={{width:`${displayProgress}%`,backgroundColor:searchSummary?.interrupted?'#ef4444':searchSummary?.complete&&!results.length?'#f59e0b':'#10b981'}} transition={{duration:reducedMotion?0:0.45,ease:'easeOut'}} className="h-full rounded-full"/></div>:<div aria-hidden="true" className="h-3 bg-slate-100"/>}
              {busy==='search'&&!reducedMotion&&<motion.span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-emerald-300/50 to-transparent" initial={{left:'-35%'}} animate={{left:'100%'}} transition={{duration:1.3,repeat:Infinity,ease:'linear'}}/>}
            </div>
          </motion.div>
          <AnimatePresence initial={false}>
            {showSearchPercentage&&<motion.div key="search-percentage" initial={{width:0,opacity:0}} animate={{width:48,opacity:1}} exit={{width:0,opacity:0}} transition={{duration:reducedMotion?0:0.3,ease:'easeOut'}} className="shrink-0 overflow-hidden text-right">
              <motion.span initial={reducedMotion?false:{scale:0.6,y:5}} animate={{scale:1,y:0}} transition={{duration:reducedMotion?0:0.25,delay:reducedMotion?0:0.1}} className="inline-block text-[11px] font-medium tabular-nums text-slate-700" aria-label="Search progress percentage">{searchPercentage}%</motion.span>
            </motion.div>}
          </AnimatePresence>
        </div>
      </div>
      {searchSummary?.scope==='file'&&<p className="mb-3 text-xs leading-relaxed text-blue-700">Searched only {searchSummary.sourceFilename}. Other files in the time window were not searched.</p>}
      {searchSummary?.coverageWarning&&<p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><SearchText mobile="Some files could not be checked.">Search incomplete: {searchSummary.coverageWarning}</SearchText></p>}
      {searchSummary?.errors?.map((e:any)=><p role="alert" key={e.filename} className="mb-2 text-xs text-red-700">{e.filename}: {e.message} Recovery from this file is blocked. Search results are incomplete.</p>)}
      {!results.length?<div className="flex flex-col items-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-4 text-center">
        <FileSearch aria-hidden="true" className={'mb-2.5 h-9 w-9 '+(searchSummary?.interrupted?'text-red-500':'text-slate-400')}/>
        <p className="text-xs font-medium text-slate-700"><SearchText mobile={searchSummary?.interrupted?'Search stopped':busy==='search'?(searchSummary?.progress?'Searching for container':'Connecting to FTP'):!searchSummary?'No results yet':searchSummary.complete?'No matches found':'Search incomplete'}>{searchSummary?.interrupted?'Search stopped before completion':busy==='search'?'Connecting to FTP and checking the selected time range…':!searchSummary?'No results yet':searchSummary.complete?'No matching records found':'Search incomplete'}</SearchText></p>
        <p className="mt-2 hidden max-w-3xl text-xs leading-relaxed text-slate-500 sm:block">{!searchSummary?(busy==='search'?'The search is still running. Every discovered CSV is scanned; no matching record has been found yet.':'Enter a container number and EIR time above, then select Search FTP.'):searchSummary.scanning?'The search is still running. Every discovered CSV is scanned; no matching record has been found yet.':searchSummary.interrupted?'Results shown are incomplete; start a new search to check the entire range.':searchSummary.coverageWarning?'No matching record was returned by this incomplete search. The container may exist in files omitted by the server.':searchSummary.complete?(searchSummary.scope==='file'?'No matching container record was found in the selected source file.':'Increase the search window or switch the GP/EX filter, then search again.'):'No matches in valid files; malformed candidate files could not be searched.'} {searchSummary&&!searchSummary.scanning&&!searchSummary.interrupted&&<> {searchSummary.scope==='file'?'Check the source filename or clear it to discover other files.':''}</>}</p>
        {busy!=='search'&&!searchSummary?.scanning&&<p className="mt-2 text-xs leading-relaxed text-slate-500 sm:hidden">{!searchSummary?'Enter a container number and EIR time.':searchSummary.interrupted?'Results incomplete. Search again.':searchSummary.complete?'Check the EIR time or container type and try again.':'Some files could not be checked. Try again.'}</p>}
        {searchDetails}
      </div>:<>
        <div className="mb-3">{searchSummary?.interrupted&&<p className="flex items-center gap-2 text-xs font-medium text-red-600"><FileSearch aria-hidden="true" className="h-4 w-4"/><SearchText mobile="Search stopped">Search stopped before completion</SearchText></p>}{searchDetails}</div>
        <div className="space-y-3 md:hidden">{results.map(match=><article key={match.filename+':'+match.record} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-900">{match.values[0]}</p><span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">MATCH · {match.type}</span></div>
          <p className="mt-2 break-all text-xs leading-5 text-slate-600">{match.filename}</p><p className="mt-1 text-[11px] text-slate-500">{displayTime(match.timestamp)} · Record {match.record}</p>
          <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={!!busy} className={secondaryClass+' px-2'} onClick={()=>choose(match)}>View / Edit</button><button type="button" disabled={!!busy} className={buttonClass+' px-2'} onClick={()=>{choose(match);setReview(true);}}>Reprocess</button></div>
        </article>)}</div>
        <div className="hidden overflow-x-auto rounded-lg md:block border border-slate-100"><table className="w-full min-w-[900px] text-left text-xs"><thead className="border-b border-slate-300 bg-slate-200 text-slate-800"><tr>{['Container No.','Type','Source Filename','File Timestamp','Record No.','Match Status','Actions'].map(h=><th scope="col" className={tableHeadingClass} key={h}>{h}</th>)}</tr></thead><tbody>{results.map((m,i)=><tr key={m.filename+':'+m.record} className={'border-b border-slate-100 last:border-0 '+(selected?.filename===m.filename&&selected.record===m.record?'bg-blue-50':'hover:bg-slate-50')}><td className="px-4 py-4 font-semibold text-slate-900">{m.values[0]}</td><td className="whitespace-nowrap px-4 py-4"><span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-600">{m.type==='GP'?'Import (GP)':'Export (EX)'}</span></td><td className="px-4 py-4 text-slate-600">{m.filename}</td><td className="whitespace-nowrap px-4 py-4 text-slate-600">{displayTime(m.timestamp)}</td><td className="px-4 py-4 text-center">{m.record}</td><td className="whitespace-nowrap px-4 py-4 text-emerald-700"><span className="inline-flex items-center gap-1"><CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5"/>MATCH</span></td><td className="px-4 py-3"><RecordActions disabled={!!busy} onChoose={action=>{choose(results[i]);if(action==='reprocess')setReview(true);}}/></td></tr>)}</tbody></table></div>
      </>}
    </section>

    {selected&&<FileEditorDialog busy={!!busy} onClose={()=>setSelected(null)} header={<><h3 className="text-sm font-bold text-slate-900">{review?'Review & Approval':'View/Edit File'} — {selected.values[0]}</h3><p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-slate-500"><span className="shrink-0">{selected.type} ·</span><span className="min-w-0 truncate" title={selected.filename}>{selected.filename}</span></p></>}>
      <button disabled={!!busy||!!approved} className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50" onClick={()=>{setValues([...selected.values]);setDraftMessage('');setReview(false);setIdentityConfirmed(false);}}><RefreshCw aria-hidden="true" className="h-3 w-3"/>Reset Changes</button>
      {busy&&<p role="status" className="mb-3 flex items-center gap-2 text-xs text-blue-700"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin"/>Processing recovery, please wait...</p>}
      {!review?<>
        <div className="overflow-x-auto pb-2"><div className="grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-5 xl:grid-cols-10">{NORTHPORT_COLUMNS.map((column,i)=><label key={column} className="min-w-0 text-xs"><span className="font-semibold text-slate-600">{column}</span>{values[i]!==selected.values[i]&&<span className="float-right text-[10px] font-medium text-amber-800">Modified</span>}<input aria-label={column} disabled={!!busy} maxLength={1000} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60" value={values[i]} onChange={e=>{setDraftMessage('');setValues(v=>v.map((x,n)=>n===i?(i===0?e.target.value.trim().toUpperCase():e.target.value):x));}}/>{values[i]!==selected.values[i]&&<span className="mt-2 block break-all text-amber-800">Original: {selected.values[i]||'(blank)'}</span>}</label>)}</div></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Changes are saved as a draft for this session. Original FTP files remain unchanged.</p><div className="northport-dialog-actions flex w-full flex-nowrap gap-2 sm:w-auto">
          <button type="button" disabled={!!busy} className={secondaryClass} onClick={()=>exportApprovedCsv(recordCsv(values),selected.type)}><Download aria-hidden="true" className="h-4 w-4"/>Download CSV</button>
          <button type="button" disabled={!!busy} className={secondaryClass} onClick={()=>{if(!/^[A-Z0-9]+$/.test(values[0])){setError('Enter a valid container number before saving.');return;}setDrafts(previous=>({...previous,[selected.filename+':'+selected.record]:[...values]}));setError('');setDraftMessage('Changes saved for this session.');}}>Save Changes</button>
          <button type="button" disabled={!!busy} className={buttonClass} onClick={()=>{setDraftMessage('');setReview(true);}}>Review Record</button>
        </div></div>
      </>:<>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600"><p>Review all 20 fields before approving this recovery.</p><span className="font-semibold">{changed.length} {changed.length===1?'field':'fields'} changed</span></div>
        <div className="my-4 overflow-x-auto pb-2"><div className="grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-5 xl:grid-cols-10">{NORTHPORT_COLUMNS.map((column,i)=><div key={column} className="min-w-0 text-xs"><p className="font-semibold text-slate-600">{column}</p><p className="mt-1 min-h-9 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 break-all whitespace-pre-wrap text-slate-900">{values[i]||'(blank)'}</p>{values[i]!==selected.values[i]&&<p className="mt-2 break-all text-amber-800">Original: {selected.values[i]||'(blank)'}</p>}</div>)}</div></div>
        {identityChanged&&<label className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" disabled={!!approved} checked={identityConfirmed} onChange={e=>setIdentityConfirmed(e.target.checked)}/>I confirm changes to UNIT, GPNO, EXPNO or BLNO and have checked the record identity.</label>}
        {!approved?<div className="northport-dialog-actions flex flex-nowrap justify-end gap-2"><button disabled={!!busy} className={secondaryClass} onClick={()=>setReview(false)}><span className="sm:hidden">Back</span><span className="hidden sm:inline">Back to Editor</span></button><button disabled={!!busy||(identityChanged&&!identityConfirmed)} className={buttonClass} onClick={()=>{if(window.confirm(`Approve this ${selected.type} record for ${values[0]}? ${changed.length} changed fields. The original file will remain unchanged.`))void action('approve',approvePayload);}}><ShieldCheck aria-hidden="true" className="h-4 w-4"/><span className="sm:hidden">Approve CSV</span><span className="hidden sm:inline">Approve &amp; Generate Recovery CSV</span></button></div>:<div className="space-y-3 rounded-lg border border-emerald-100 p-4"><p className="flex items-center gap-2 text-xs font-semibold text-emerald-700"><CheckCircle2 aria-hidden="true" className="h-4 w-4"/>Approved · CSV Preview</p><pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{approved.preview}</pre><p className="text-xs leading-relaxed text-slate-500">Reprocess uploads this single-container CSV to CONTAINERS and then runs the existing Northport Containers scheduler. The original SUCCESS file remains unchanged. Scheduler dispatch does not confirm container import.</p><div className="northport-dialog-actions flex flex-nowrap gap-2"><button className={buttonClass} disabled={!enabled||!!busy||recoveryUploaded||reprocessStarted} onClick={()=>{if(window.confirm(`Reprocess ${values[0]}? Upload the approved single-container CSV to the production CONTAINERS folder and run the existing Northport Containers scheduler. The original SUCCESS file will remain unchanged. Do not retry if the outcome is uncertain.`))void action('reprocess',{...approvePayload,id:approved.id});}}><span className="sm:hidden">Reprocess</span><span className="hidden sm:inline">Reprocess &amp; Run Scheduler</span></button><button className={secondaryClass} disabled={!!busy} onClick={()=>exportApprovedCsv(approved.preview,selected.type)}><Download aria-hidden="true" className="h-4 w-4"/>Export CSV</button></div><p className="text-xs leading-relaxed text-slate-500">Export CSV downloads the approved single-container record without uploading or running the scheduler. A collision-safe production filename is allocated separately at upload.</p>{!enabled&&<p className="text-xs text-amber-800">Reprocess and upload are disabled pending preproduction verification.</p>}</div>}
      </>}
    </FileEditorDialog>}

    <section className="flex flex-col gap-4 pt-5 pb-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"><h3 className="text-sm font-bold text-slate-900">Recovery History</h3><button className="col-start-2 row-span-2 row-start-1 inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" disabled={!!busy} onClick={()=>void loadHistory()}><RefreshCw aria-hidden="true" className="h-2.5 w-2.5"/>Refresh History</button><p className="col-start-1 text-xs leading-4 text-slate-500">Latest 50 approvals. A scheduler response does not prove import. No container import verification API is configured.</p></div>
      <div className="northport-history-container min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="northport-history-cards divide-y divide-slate-100 md:hidden">{history.map(row=><article key={row.id} className="min-w-0 px-3 py-2">
        <button type="button" aria-label={`View recovery details for ${row.container}`} onClick={()=>setHistoryDetail(row)} className="block w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-blue-700">{row.container}<span className="ml-2 text-[10px] font-medium text-slate-500">{row.container_type}</span></span><HistoryStatus recovery={row}/></div>
          <p className="truncate text-xs text-slate-600" title={row.source_filename}>{row.source_filename}</p>
          <time className="mt-1 block text-[11px] text-slate-500" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})} MYT</time>
        </button>
        {row.status==='Uploaded'&&!row.scheduler_status&&<button type="button" disabled={!!busy} className={secondaryClass+' mt-3 w-full'} onClick={()=>{if(window.confirm('Run the existing Northport scheduler on CargoMove?'))void action('scheduler',{id:row.id});}}>Run scheduler</button>}
      </article>)}</div>
      <div className="northport-history-table-wrap hidden min-w-0 md:block"><table className="northport-history-table text-left text-xs"><thead className="border-y border-slate-100 bg-slate-50"><tr>{['Container','Type','Source file','Submitted by','Time','Modification','Status'].map(h=><th scope="col" key={h} className={tableHeadingClass+' whitespace-nowrap '+(['Type','Submitted by','Time','Modification','Status'].includes(h)?'text-center':'')}>{h}</th>)}</tr></thead><tbody>{history.map(row=><tr key={row.id} className="border-b border-slate-100 last:border-0"><td className="px-4 py-2 align-middle"><button type="button" className="font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={()=>setHistoryDetail(row)}>{row.container}</button></td><td className="px-2 py-2 align-middle text-center text-slate-600">{row.container_type}</td><td className="px-4 py-2 align-middle text-slate-600" title={row.source_filename}><span className="block">{row.source_filename}</span></td><td className="px-2 py-2 align-middle text-center text-slate-600">{row.submitted_by.split('@')[0]}</td><td className="whitespace-nowrap px-2 py-2 align-middle text-center text-slate-600"><time dateTime={row.created_at}><span className="inline-block whitespace-nowrap">{new Date(row.created_at).toLocaleDateString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})}</span>{' '}<span className="inline-block whitespace-nowrap">{new Date(row.created_at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})} MYT</span></time></td><td className="px-2 py-2 align-middle text-center text-slate-600">{row.changed_fields.join(', ')||'None'}</td><td className="px-2 py-2 align-middle text-center"><HistoryStatus recovery={row}/>{row.status==='Uploaded'&&!row.scheduler_status&&<div className="mt-1 flex flex-col items-center gap-0.5"><button className="text-[10px] text-blue-700 hover:underline" disabled={!!busy} onClick={()=>{if(window.confirm('Run the existing Northport scheduler on CargoMove?'))void action('scheduler',{id:row.id});}}>Run scheduler</button><button className="text-[10px] text-slate-500 hover:underline" disabled={!!busy} onClick={()=>setMessage('Process Later selected. The existing production scheduler may process the uploaded file on its normal schedule. Import verification is unavailable.')}>Process later</button></div>}</td></tr>)}</tbody></table></div>
      {!history.length&&!historyError&&<div className="flex flex-col items-center gap-2 py-3 text-center text-xs text-slate-500"><span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400"><FileClock className="h-5 w-5"/></span><p>No recovery approvals yet.</p></div>}
      </div>
    </section>
    {historyDetail&&<FileEditorDialog label="Recovery details" compact busy={false} onClose={()=>setHistoryDetail(null)} header={<><h3 className="text-sm font-bold text-slate-900">Recovery details</h3><p className="mt-1 text-xs text-slate-500">{historyDetail.container} · {historyDetail.container_type==='GP'?'Import (GP)':'Export (EX)'}</p></>}><RecoveryDetailsContent recovery={historyDetail}/></FileEditorDialog>}
  </div>;
}

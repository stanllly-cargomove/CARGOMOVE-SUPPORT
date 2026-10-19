import { Toaster } from 'react-hot-toast';
import { notifyError, notifySuccess } from '../common/notifications';
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Check, CheckCircle2, ChevronDown, Clock3, Container, Download, FileClock, FileSearch, History, Info, ListFilter, Loader2, MoreVertical, PlugZap, RefreshCw, Search, ShieldCheck, X, Zap } from 'lucide-react';
import { NORTHPORT_COLUMNS, NORTHPORT_SEARCH_MODES, type Match, type Recovery, type ScannedFile, type SearchMode } from '../../types/northport';
import { ReprocessError, reprocessApprovedRecovery, type ReprocessSubmission } from '../../services/northportReprocess';
import { NorthportScannedFiles } from './NorthportScannedFiles';

const notificationOptions = { toasterId: 'northport' };
const northportToaster = <Toaster toasterId="northport" position="top-center" containerStyle={{top:16}} toastOptions={{duration:6000}}/>;
const inputClass = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#0095e8] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0078c8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const reprocessButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const cancelButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-red-600 bg-red-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const cardClass = 'min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm';
const tableHeadingClass = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600';
function SearchModeIcon({ mode, className }: { mode: SearchMode; className: string }) {
  if (mode === 'standard') return <Zap aria-hidden="true" className={className}/>;
  if (mode === 'files') return <FileSearch aria-hidden="true" className={className}/>;
  return <Search aria-hidden="true" className={className}/>;
}
function SearchModeButton({ mode, disabled, onChange }: { mode: SearchMode; disabled: boolean; onChange: (mode: SearchMode) => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const option = NORTHPORT_SEARCH_MODES.find(item => item.value === mode)!;
  useEffect(() => { if (disabled) menuRef.current?.hidePopover(); }, [disabled]);
  return <>
    <button ref={buttonRef} type="button" disabled={disabled} aria-label={`Search mode: ${option.label}`} aria-haspopup="dialog" aria-expanded={open} className={secondaryClass+' min-h-9 w-[240px] max-w-full justify-between gap-2 px-3 py-1.5'} onClick={() => {
      const menu = menuRef.current; const button = buttonRef.current; if (!menu || !button) return;
      if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
      const rect = button.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(rect.right-320, window.innerWidth-328))+'px';
      menu.style.top = Math.max(8, rect.bottom+280>window.innerHeight ? rect.top-280 : rect.bottom+6)+'px';
      menu.showPopover(); menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    }}><span className="flex min-w-0 items-center gap-2"><SearchModeIcon mode={mode} className="h-3.5 w-3.5 shrink-0 text-blue-600"/><span className="truncate">{option.label}</span></span><ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0"/></button>
    <div ref={menuRef} popover="auto" role="dialog" aria-label="Search mode options" onToggle={() => setOpen(menuRef.current?.matches(':popover-open')??false)} style={{position:'fixed',margin:0}} className="w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-700 shadow-xl">
      <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Search mode</p>
      <div role="radiogroup" aria-label="Choose search mode" onKeyDown={event=>{
        const index=NORTHPORT_SEARCH_MODES.findIndex(item=>item.value===mode);
        const next=event.key==='Home'?0:event.key==='End'?2:['ArrowDown','ArrowRight'].includes(event.key)?(index+1)%3:['ArrowUp','ArrowLeft'].includes(event.key)?(index+2)%3:null;
        if(next===null)return;event.preventDefault();onChange(NORTHPORT_SEARCH_MODES[next].value);event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
      }}>{NORTHPORT_SEARCH_MODES.map(item => <button key={item.value} type="button" role="radio" tabIndex={mode===item.value?0:-1} aria-checked={mode===item.value} className={'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 '+(mode===item.value?'bg-blue-50':'')} onClick={() => { onChange(item.value); menuRef.current?.hidePopover(); buttonRef.current?.focus(); }}>
        <span className={'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg '+(mode===item.value?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-500')}><SearchModeIcon mode={item.value} className="h-4 w-4"/></span><span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{item.label}</span><span className="mt-1 block text-[11px] leading-4 text-slate-500">{item.description}</span></span>{mode===item.value&&<Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600"/>}
      </button>)}</div>
    </div>
  </>;
}
function RecordActions({ disabled, onChoose }: { disabled: boolean; onChoose: (action: 'edit' | 'reprocess' | 'download') => void }) {
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
      {([['edit','View/Edit File'],['download','Download whole file'],['reprocess','Reprocess']] as const).map(([action,label])=><button key={action} type="button" disabled={disabled} className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-slate-100 focus-visible:bg-blue-50 focus-visible:outline-none disabled:opacity-50" onClick={()=>{menuRef.current?.hidePopover();onChoose(action);}}>{label}</button>)}
    </div>
  </>;
}
function FileEditorDialog({ children, busy, onClose, label = 'Container file editor', header, compact = false, hideClose = false }: { children: React.ReactNode; busy: boolean; onClose: () => void; label?: string; header?: React.ReactNode; compact?: boolean; hideClose?: boolean }) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;const previous=document.body.style.overflow;document.body.style.overflow='hidden';dialog?.showModal();return()=>{dialog?.close();document.body.style.overflow=previous;};},[]);
  return <dialog ref={ref} aria-label={label} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} className={`northport-file-dialog m-auto max-h-[92dvh] w-[96vw] ${compact?'max-w-2xl':'northport-standard-dialog max-w-[1800px]'} overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50`}>
    <div className="flex shrink-0 items-start justify-between gap-2 px-3 pt-3 sm:px-5 sm:pt-5">{header&&<div className="min-w-0 flex-1">{header}</div>}{!hideClose&&<button type="button" aria-label={label==='Recovery details'?'Close recovery details':'Close file editor'} disabled={busy} onClick={onClose} className="ml-auto shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5"/></button>}</div>
    <div className="northport-dialog-body min-h-0 min-w-0 overflow-y-auto overscroll-contain p-3 sm:p-5">{children}</div>
    {northportToaster}
  </dialog>;
}
type RecoveryConfirmation = { action: 'approve'|'reprocess'|'scheduler'; container: string; records?: number; payload: Record<string,unknown> };
function RecoveryConfirmationDialog({ confirmation, onCancel, onConfirm }: { confirmation: RecoveryConfirmation; onCancel: () => void; onConfirm: () => void }) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  const approving=confirmation.action==='approve';
  return <dialog ref={ref} role="alertdialog" aria-labelledby="northport-confirm-title" aria-describedby="northport-confirm-description" onCancel={event=>{event.preventDefault();onCancel();}} className="northport-confirm-dialog m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl backdrop:bg-slate-950/50">
    <h3 id="northport-confirm-title" className="text-base font-bold text-slate-900">{approving?'Approve container?':'Reprocess container?'}</h3>
    <p id="northport-confirm-description" className="mt-2 text-sm leading-6 text-slate-600">{approving?`Approve the full file with the reviewed edits for ${confirmation.container}?`:`Send the full file for ${confirmation.container} to Northport for processing?`} {confirmation.records!==undefined?`All ${confirmation.records} records are included. `:'All source records are included. '}Edits apply only to the selected record.</p>
    <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" autoFocus className={cancelButtonClass} onClick={onCancel}>Cancel</button><button type="button" className={reprocessButtonClass} onClick={onConfirm}>{approving?'Approve':'Reprocess'}</button></div>
  </dialog>;
}
function FileZillaIcon() {
  return <svg viewBox="0 0 100 100" aria-hidden="true" className="h-9 w-9"><circle cx="50" cy="50" r="49" fill="#d40000"/><path fill="white" d="M35 24h37l-3 9H42l-3 13h23l-3 9H36l-6 23H19z"/><path fill="white" d="M46 43h31l-3 9-26 24h21l-3 10H31l3-10 27-24H43z"/></svg>;
}
function SectionHeading({ step, title, description, action, icon, green = false }: {
  step?: number; title: string; description: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode; green?: boolean;
}) {
  return <div className={`${title === 'Search Container' || title === 'Search Results' ? 'mb-4' : 'mb-1'} flex flex-wrap items-start justify-between gap-1`}>
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      {(icon || step != null)&&<span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center text-sm font-semibold sm:h-9 sm:w-9 sm:text-base ${icon ? 'rounded-xl bg-violet-50 text-violet-600' : `rounded-full text-white ${green ? 'bg-emerald-500' : 'bg-blue-600'}`}`}>{icon || step}</span>}
      <div className="min-w-0 pt-0.5"><h3 className="text-sm font-bold text-slate-900">{title}</h3><p className="mt-0 text-xs leading-4 text-slate-500">{description}</p></div>
    </div>
    {action && <div className="mt-2 w-full max-w-full shrink-0 sm:ml-auto sm:mt-0 sm:w-auto">{action}</div>}
  </div>;
}
const displayTime = (value: string) => value?.replace('T',' ') + ' MYT';
function SearchText({ mobile, children }: { mobile: string; children: React.ReactNode }) {
  return <><span className="sm:hidden">{mobile}</span><span className="hidden sm:inline">{children}</span></>;
}
function parameterColumns(values: string[], count: number) {
  return Array.from({length:count},(_,column)=>{
    const lengths=NORTHPORT_COLUMNS.flatMap((name,index)=>index%count===column?[name.length,(values[index]||'(blank)').length]:[]);
    return `minmax(0, ${Math.max(6,Math.min(40,Math.max(...lengths)+3))}fr)`;
  }).join(' ');
}
function historyStatusLabel(recovery: Recovery) {
  if (recovery.scheduler_status === 'trigger_requested' || recovery.status === 'Scheduler Triggered') return 'SCHEDULER REQUESTED';
  if (recovery.status === 'Approved') return 'APPROVED · NOT UPLOADED';
  if (recovery.status === 'Uploaded') return 'UPLOADED · NOT VERIFIED';
  if (recovery.status === 'Verification Unavailable') return 'STATUS UNVERIFIED';
  return recovery.status.toUpperCase();
}
function HistoryStatus({ recovery }: { recovery: Recovery }) {
  const label = historyStatusLabel(recovery);
  const color = label === 'FAILED' ? 'bg-red-50 text-red-700' : ['UPLOADING','APPROVED · NOT UPLOADED','UPLOADED · NOT VERIFIED','STATUS UNVERIFIED'].includes(label) ? 'bg-amber-50 text-amber-800' : label === 'SCHEDULER REQUESTED' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700';
  return <span className={`inline-flex min-h-5 max-w-[220px] items-center justify-center rounded-md px-2 py-1 text-center text-[9px] font-semibold leading-tight ${color}`}>{label}</span>;
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
  if (recovery.status === 'Approved') fields.push({ label: 'Next step', value: 'Approved only. The recovery CSV has not been uploaded yet.', wide: true });
  if (recovery.status === 'Uploaded') fields.push({ label: 'Next step', value: 'Recovery CSV uploaded. Scheduler request and container import are not confirmed.', wide: true });
  if (recovery.status === 'Scheduler Triggered') fields.push({ label: 'Import status', value: 'Scheduler request was accepted. Container import is not verified.', wide: true });
  if (recovery.processing_result && recovery.processing_result !== 'Verification Unavailable') fields.push({ label: 'Processing', value: recovery.processing_result, wide: true });
  if (recovery.scheduler_status && recovery.scheduler_status !== 'Verification Unavailable') fields.push({ label: 'Scheduler', value: recovery.scheduler_status === 'trigger_requested' ? 'Triggered' : recovery.scheduler_status, wide: true });
  if (recovery.scheduler_run_id) fields.push({ label: 'Scheduler execution ID', value: recovery.scheduler_run_id, wide: true });
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-3">{fields.map(field=><div key={field.label} className={`min-w-0 ${field.wide?'col-span-2':''}`}><dt className="text-[11px] font-medium text-slate-500">{field.label}</dt><dd className="mt-1 text-xs leading-5 text-slate-900 [overflow-wrap:anywhere]">{field.value}</dd></div>)}</dl>;
}
function exportApprovedCsv(preview: string, filename: string) {
  const url = URL.createObjectURL(new Blob([preview],{type:'text/csv;charset=utf-8',endings:'transparent'}));
  const link = document.createElement('a');
  link.href=url;link.download=filename;link.hidden=true;
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
  const [form,setForm] = useState({unit:'',timestamp:'',type:'GP',before:5,after:30,sourceFilename:'',mode:'standard' as SearchMode});
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
  const [approved,setApproved] = useState<{id:string;preview:string;filename:string;records?:number}|null>(null);
  const [reprocessAvailableAt,setReprocessAvailableAt] = useState(0);
  const [cooldownClock,setCooldownClock] = useState(Date.now());
  const [processingDots,setProcessingDots] = useState(1);
  const [history,setHistory] = useState<Recovery[]>([]);
  const [historyDetail,setHistoryDetail] = useState<Recovery|null>(null);
  const [confirmation,setConfirmation] = useState<RecoveryConfirmation|null>(null);
  const [enabled,setEnabled] = useState(false);
  const [gates,setGates] = useState<string[]>([]);
  const [historyError,setHistoryError] = useState('');
  const reprocessCooldownSeconds = Math.max(0,Math.ceil((reprocessAvailableAt-cooldownClock)/1000));
  const setError=(text:string)=>{if(text)notifyError(text,notificationOptions);};
  const setMessage=(text:string)=>{if(text)notifySuccess(text,notificationOptions);};
  const [busy,setBusy] = useState('');
  const isReprocessing = busy.startsWith('reprocess-');
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
    if(!reprocessAvailableAt||reprocessCooldownSeconds===0)return;
    const timer=window.setInterval(()=>setCooldownClock(Date.now()),200);
    return ()=>window.clearInterval(timer);
  },[reprocessAvailableAt,reprocessCooldownSeconds]);
  useEffect(()=>{
    if(!isReprocessing)return;
    setProcessingDots(1);
    const timer=window.setInterval(()=>setProcessingDots(current=>current%3+1),450);
    return ()=>window.clearInterval(timer);
  },[isReprocessing]);
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
      if(['download-source','download-file','download-all','download-reprocess'].includes(name)) {
        const request = name==='download-all'?{files:payload.files}:name==='download-reprocess'?{token:payload.token,values:payload.values}:{token:payload.token};
        const response=await fetch('/api/dev-tools/northport-recovery',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CargoMove-Confirm':'northport-recovery'},body:JSON.stringify({action:name,...request}),signal:controller.signal});
        if(!response.ok) {
          const data=await recoveryResponse(response);
          throw new Error(data.error||'Unable to download the source file.');
        }
        const url=URL.createObjectURL(await response.blob());
        const link=document.createElement('a');
        link.href=url;link.download=payload.filename;link.hidden=true;
        document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        return;
      }
      if(name==='reprocess') {
        if(!enabled)throw new Error('Reprocess is disabled until production upload compatibility is verified.');
        setReprocessStarted(true);setBusy('reprocess-upload');
        await reprocessApprovedRecovery(payload as ReprocessSubmission,{
          post:async(operation,body)=>{
            const response=await fetch('/api/dev-tools/northport-recovery',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CargoMove-Confirm':'northport-recovery'},body:JSON.stringify({action:operation,...body}),signal:controller.signal});
            const data=await recoveryResponse(response);
            if(!response.ok)throw new Error(data.error||data.message||'Recovery operation was not confirmed.');
            return data;
          },
          onUploaded:()=>{setRecoveryUploaded(true);setBusy('reprocess-wait');void loadHistory();},
          onScheduler:()=>{setBusy('reprocess-scheduler');},
        });
        setMessage('Recovery file uploaded. Northport processing requested successfully.');
        setSelected(null);setApproved(null);setReview(false);
        return;
      }
      if(name==='search') {
        let cursor:string|null=null;const matches:Match[]=[];const scannedFiles:ScannedFile[]=[];const errors:any[]=[];let listed=0;let candidates=0;
        do {
          const response=await fetch('/api/dev-tools/northport-recovery',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CargoMove-Confirm':'northport-recovery'},body:JSON.stringify({action:name,...payload,...(cursor?{cursor}:{})}),signal:controller.signal});
          const data=await recoveryResponse(response);
          if(!response.ok)throw new Error(data.error||'Search stopped before completion. Results already returned may be incomplete.');
          if(!Array.isArray(data.matches)||!Array.isArray(data.errors))throw new Error('The search returned an unexpected response.');
          matches.push(...data.matches);scannedFiles.push(...(data.scannedFiles||[]));errors.push(...data.errors);listed+=data.listed||0;candidates+=data.candidates||0;
          cursor=data.nextCursor||null;
          setResults([...matches]);setSearchSummary({...data,mode:payload.mode,matches:[...matches],scannedFiles:[...scannedFiles],errors:[...errors],listed,candidates,complete:!cursor&&data.complete&&errors.length===0,scanning:!!cursor});
          if(cursor)await batchPause(5100,controller.signal);
        }while(cursor&&!controller.signal.aborted);
        return;
      }
      const response=await fetch('/api/dev-tools/northport-recovery',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CargoMove-Confirm':'northport-recovery'},body:JSON.stringify({action:name,...payload}),signal:controller.signal});
      const data=await recoveryResponse(response);
      if(!response.ok) throw new Error(data.error || data.message || 'Recovery operation failed. Check history before retrying.');
      if(name==='check') setMessage(`Northport is connected and ready. Container files can be searched safely.${data.coverageWarning?' '+data.coverageWarning:''}`);
      if(name==='approve') {setApproved({id:data.recovery.id,preview:data.preview,filename:data.filename||`REPROCESS_${payload.values[0]}.csv`,records:data.records??selected?.totalRecords});setReprocessAvailableAt(Date.now()+5200);setCooldownClock(Date.now());if(typeof data.uploadsEnabled==='boolean'){setEnabled(data.uploadsEnabled);if(data.uploadsEnabled)setGates([]);}setMessage('File approved. Reprocess will be available in a few seconds.');}
      if(name==='upload') {setMessage(data.message);setApproved(null);setSelected(null);}
      if(name==='scheduler') setMessage('Northport processing requested successfully.');
    } catch(e) {
      if(name==='search')setSearchSummary(previous=>({listed:0,candidates:0,...previous,scanning:false,complete:false,interrupted:true}));
      if(controller.signal.aborted) setMessage('Search cancelled.'); else {
        if(name==='reprocess'&&e instanceof ReprocessError&&!e.uploaded){setReprocessStarted(false);if(e.message.includes('Please wait a few seconds')){setReprocessAvailableAt(Date.now()+5200);setCooldownClock(Date.now());}}
        setError((e as Error).message);
      }
    } finally {if(name==='search')setSearchSummary(previous=>previous?.scanning?{...previous,scanning:false,complete:false,interrupted:true}:previous);pending.current=false;setBusy('');searchController.current=null;void loadHistory();}
  }
  const changed = selected ? NORTHPORT_COLUMNS.filter((_,i)=>values[i]!==selected.values[i]) : [];
  const parameterGridStyle = {'--parameter-columns-5':parameterColumns(values,5),'--parameter-columns-10':parameterColumns(values,10)} as React.CSSProperties;
  const resetChangesButton = selected&&<button type="button" disabled={!!busy||!!approved||changed.length===0} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-50 disabled:shadow-none" onClick={()=>{setValues([...selected.values]);setDraftMessage('');setIdentityConfirmed(false);}}><RefreshCw aria-hidden="true" className="h-3 w-3"/>Reset Changes</button>;
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
  const scannedFiles:ScannedFile[] = searchSummary?.scannedFiles||[];
  const contentHits = scannedFiles.filter(file=>file.status==='content-match').length;
  const bulkFiles = new Map(scannedFiles.map(file=>[file.filename,{kind:'file',token:file.token}]));
  for(const match of results)if(!bulkFiles.has(match.filename))bulkFiles.set(match.filename,{kind:match.fileToken?'file':'record',token:match.fileToken||match.token});
  const searchDetails=<div className="northport-search-details mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-left text-xs leading-relaxed text-slate-500" aria-live="polite">
    {form.timestamp&&<p className="text-xs leading-relaxed text-slate-500"><span className="hidden sm:inline">Search range: </span><span className="whitespace-nowrap font-medium text-slate-700"><SearchText mobile={rangeTime(form.timestamp,-form.before).replace(' MYT','')}>{rangeTime(form.timestamp,-form.before)}</SearchText></span> to <span className="whitespace-nowrap font-medium text-slate-700"><SearchText mobile={rangeTime(form.timestamp,form.after).replace(' MYT','')}>{rangeTime(form.timestamp,form.after)}</SearchText></span></p>}
    {searchSummary?.progress&&!searchSummary.complete&&<p className="w-full sm:w-auto">{searchSummary.scanning?'Searching':'Checked'} <span className="font-medium text-slate-700">{searchSummary.progress.checked.toLocaleString()} / {searchSummary.progress.total.toLocaleString()}</span><span className="hidden sm:inline"> timestamp filenames</span></p>}
  </div>;
  const identityChanged=changed.some(c=>['UNIT','GPNO','EXPNO','BLNO'].includes(c));
  const approvePayload={token:selected?.token,values,approved:true,identityConfirmed};
  const choose=(match:Match)=>{setReprocessStarted(false);setRecoveryUploaded(false);setSelected(match);setValues([...(drafts[match.filename+':'+match.record]??match.values)]);setDraftMessage('');setError('');setMessage('');setReview(false);setApproved(null);setReprocessAvailableAt(0);setIdentityConfirmed(false);};
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
      <SectionHeading step={1} title="Search Container" description="Enter container details and a time range to search in SUCCESS." action={<SearchModeButton mode={form.mode} disabled={!!busy} onChange={mode=>setForm(current=>({...current,mode}))}/>}/>
      <form onSubmit={e=>{e.preventDefault();if(pending.current)return;setFilenameOptions(false);setConnectionOptions(false);setResults([]);setSearchSummary(null);setDisplayProgress(0);setSelected(null);setApproved(null);void action('search',{...form,sourceFilename:showExactFilename?form.sourceFilename:''});}} className="space-y-3">
        <div className="northport-search-fields">
          <div className="min-w-0">
            <label htmlFor="northport-container" className="mb-2 block text-xs font-medium text-slate-700">Container No.</label>
            <div className="relative" ref={filenameOptionsRef}>
              <Container aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400"/>
              <input id="northport-container" disabled={busy==='search'} required maxLength={32} pattern="[A-Z0-9]+" placeholder="e.g. MSBU4179350" className={inputClass+' pl-10 pr-10'} value={form.unit} onChange={e=>setForm({...form,unit:e.target.value.trim().toUpperCase()})}/>
              <button type="button" disabled={busy==='search'} aria-label="Container search options" aria-expanded={filenameOptions} aria-controls="northport-filename-options" title={showExactFilename?'Filename search options':'Search by time range or filename'} onClick={()=>setFilenameOptions(value=>!value)} className={'absolute right-1 top-1 inline-flex h-9 w-8 items-center justify-center rounded-md outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 '+(showExactFilename?'bg-blue-50 text-blue-700':'text-slate-500')}><MoreVertical aria-hidden="true" className="h-4 w-4"/></button>
              {filenameOptions&&<div id="northport-filename-options" role="region" aria-label="Container search options" className="absolute left-0 top-full z-30 mt-2 w-[min(82vw,24rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Search scope</p>
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
            {busy==='search'?<button type="button" aria-label="Cancel Search" title="Cancel Search" className="inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={()=>searchController.current?.abort()}><X aria-hidden="true" className="h-4 w-4"/></button>:<button type="button" aria-label="Clear" title="Clear search" className="inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" disabled={!!busy} onClick={()=>{if(pending.current)return;setForm({unit:'',timestamp:'',type:'GP',before:5,after:30,sourceFilename:'',mode:'standard'});setShowExactFilename(false);setFilenameOptions(false);setResults([]);setSearchSummary(null);setDisplayProgress(0);setSelected(null);setApproved(null);setError('');setMessage('');}}><RefreshCw aria-hidden="true" className="h-4 w-4"/></button>}
          </div>
        </div>
      </form>
    </section>

    {busy&&busy!=='search'&&!selected&&<p role="status" className="flex items-center gap-2 text-xs text-blue-700"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin"/>{busy==='reprocess-upload'?'Uploading the approved recovery CSVâ€¦':busy==='reprocess-wait'?'Recovery File Uploaded. Preparing the Northport schedulerâ€¦':busy==='reprocess-scheduler'?'Running the existing Northport Containers schedulerâ€¦':`${busy==='upload'?'Uploading':busy==='scheduler'?'Requesting existing scheduler':busy==='approve'?'Saving approval':'Checking FTP'}â€¦`}</p>}

    <section className={cardClass+' northport-results-container'} aria-label="File search progress">
      <SectionHeading step={2} title="Search Results" description={<SearchText mobile={busy==='search'?'Searching container files.':searchSummary?.interrupted?'Search stopped.':searchSummary?.complete?'Search complete.':searchSummary?'Review search results.':'Find matching container records.'}>{busy==='search'?'Scanning timestamp filenames and container records.':searchSummary?.complete?'All files in the selected search scope have been scanned.':searchSummary?'Review the scan status and any warnings below.':'Search progress will appear here when you start a search.'}</SearchText>} action={<p className="flex w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] leading-4 text-slate-500" aria-live="polite"><span>{searchSummary?.progress?.files??searchSummary?.candidates??0} files scanned</span><span aria-hidden="true" className="text-slate-300">&middot;</span><span>{searchSummary?.progress?.records??0} records read</span><span aria-hidden="true" className="text-slate-300">&middot;</span><span className="font-medium text-emerald-700">{results.length} {results.length===1?'match':'matches'}</span></p>}/>
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
      {form.timestamp&&<div className="mb-3">{searchDetails}</div>}
      {searchSummary?.scope==='file'&&<p className="mb-3 text-xs leading-relaxed text-blue-700">Searched only {searchSummary.sourceFilename}. Other files in the time window were not searched.</p>}
      {searchSummary?.coverageWarning&&<p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><SearchText mobile="Some files could not be checked.">Search incomplete: {searchSummary.coverageWarning}</SearchText></p>}
      {searchSummary?.errors?.map((e:any)=><p role="alert" key={e.filename} className="mb-2 text-xs text-red-700">{e.filename}: {e.message} Recovery from this file is blocked. Search results are incomplete.</p>)}
      {contentHits>0&&<p role="status" className="mb-3 text-xs leading-5 text-amber-800">Container text found in {contentHits} {contentHits===1?'file':'files'} without a validated matching UNIT record. Download these files to inspect.</p>}
      {(results.length>0||scannedFiles.length>0)&&<NorthportScannedFiles files={scannedFiles} matches={results} busy={!!busy} downloadingAll={busy==='download-all'} showDownloadAll={form.mode!=='standard'} onDownloadAll={()=>void action('download-all',{files:[...bulkFiles.values()],filename:'NORTHPORT_SCANNED_FILES.zip'})} onDownloadFile={file=>void action('download-file',file)} recordActions={match=><RecordActions disabled={!!busy} onChoose={choice=>{if(choice==='download')void action('download-source',match);else{choose(match);if(choice==='reprocess')setReview(true);}}}/>}/>}
      {!results.length&&!scannedFiles.length&&<div className="northport-results-empty flex flex-col items-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-4 text-center">
        <FileSearch aria-hidden="true" className={'mb-2.5 h-9 w-9 '+(searchSummary?.interrupted?'text-red-500':'text-slate-400')}/>
        <p className="text-xs font-medium text-slate-700"><SearchText mobile={searchSummary?.interrupted?'Search stopped':busy==='search'?(searchSummary?.progress?'Searching for container':'Connecting to FTP'):!searchSummary?'No results yet':searchSummary.complete?'No matches found':'Search incomplete'}>{searchSummary?.interrupted?'Search stopped before completion':busy==='search'?'Connecting to FTP and checking the selected time rangeâ€¦':!searchSummary?'No results yet':searchSummary.complete?'No matching records found':'Search incomplete'}</SearchText></p>
        <p className="mt-2 hidden max-w-3xl text-xs leading-relaxed text-slate-500 sm:block">{!searchSummary?(busy==='search'?'The search is still running. Every discovered CSV is scanned; no matching record has been found yet.':'Enter a container number and EIR time above, then select Search FTP.'):searchSummary.scanning?'The search is still running. Every discovered CSV is scanned; no matching record has been found yet.':searchSummary.interrupted?'Results shown are incomplete; start a new search to check the entire range.':searchSummary.coverageWarning?'No matching record was returned by this incomplete search. The container may exist in files omitted by the server.':searchSummary.complete?(searchSummary.scope==='file'?'No matching container record was found in the selected source file.':'Increase the search window or switch the GP/EX filter, then search again.'):'No matches in valid files; malformed candidate files could not be searched.'} {searchSummary&&!searchSummary.scanning&&!searchSummary.interrupted&&<> {searchSummary.scope==='file'?'Check the source filename or clear it to discover other files.':''}</>}</p>
        {busy!=='search'&&!searchSummary?.scanning&&<p className="mt-2 text-xs leading-relaxed text-slate-500 sm:hidden">{!searchSummary?'Enter a container number and EIR time.':searchSummary.interrupted?'Results incomplete. Search again.':searchSummary.complete?'Check the EIR time or container type and try again.':'Some files could not be checked. Try again.'}</p>}
      </div>}
    </section>

    {selected&&<FileEditorDialog hideClose busy={!!busy} onClose={()=>setSelected(null)} header={<><h3 className="truncate text-sm font-bold text-slate-900" title={`${approved?'Reprocess File':review?'Review & Approval':'View/Edit File'} — ${selected.values[0]}`}>{approved?'Reprocess File':review?'Review & Approval':'View/Edit File'} — {selected.values[0]}</h3><p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-slate-500"><span className="shrink-0">{selected.type} ·</span><span className="min-w-0 truncate" title={selected.filename}>{selected.filename}</span></p></>}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><p>{selected.totalRecords!==undefined?`All ${selected.totalRecords} records in this file will be included.`:"All source records will be included."} Edits apply only to this record.</p><div className="flex items-center gap-3"><span className="font-semibold">{changed.length} {changed.length===1?'field':'fields'} changed</span>{resetChangesButton}</div></div>
      <div className="overflow-x-auto pb-2"><div className="northport-parameter-grid grid grid-cols-2 gap-x-2 gap-y-3" style={parameterGridStyle}>{NORTHPORT_COLUMNS.map((column,i)=>!review?<label key={column} className="min-w-0 text-xs"><span className="font-semibold text-slate-600">{column}</span>{values[i]!==selected.values[i]&&<span className="float-right text-[10px] font-medium text-amber-800">Modified</span>}<input aria-label={column} disabled={!!busy} maxLength={1000} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60" value={values[i]} onChange={e=>{setDraftMessage('');setValues(v=>v.map((x,n)=>n===i?(i===0?e.target.value.trim().toUpperCase():e.target.value):x));}}/>{values[i]!==selected.values[i]&&<span className="mt-2 block break-all text-amber-800">Original: {selected.values[i]||'(blank)'}</span>}</label>:<div key={column} className="min-w-0 text-xs"><p className="font-semibold text-slate-600">{column}</p><p className="mt-1 flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-slate-900"><span className="block min-w-0 truncate" title={values[i]||'(blank)'}>{values[i]||'(blank)'}</span></p>{values[i]!==selected.values[i]&&<p className="mt-2 break-all text-amber-800">Original: {selected.values[i]||'(blank)'}</p>}</div>)}</div></div>
      {identityChanged&&<label aria-hidden={!review} className={`mt-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 ${!review?'invisible':''}`}><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" disabled={!!approved||!review} checked={identityConfirmed} onChange={e=>setIdentityConfirmed(e.target.checked)}/>I confirm changes to UNIT, GPNO, EXPNO or BLNO and have checked the record identity.</label>}
      <div className={`northport-stage-note mt-3 flex items-center gap-2 rounded-xl border px-3 text-xs leading-5 ${approved?'border-emerald-100 bg-emerald-50/40 text-emerald-700':'border-transparent text-slate-500'}`}>
        {busy?<p role="status" className="flex items-center gap-2 text-blue-700"><Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin"/>{busy==='reprocess-upload'?'Uploading recovery file…':busy==='reprocess-wait'?'File uploaded. Preparing reprocess…':busy==='reprocess-scheduler'?'Starting Northport processing…':busy==='reprocess-cooldown'?'Waiting for the recovery safety interval…':busy==='approve'?'Approving container…':'Please wait…'}</p>:approved?<div><p className="flex items-center gap-2 font-semibold"><CheckCircle2 aria-hidden="true" className="h-4 w-4"/>{reprocessCooldownSeconds>0?`Approved · Ready in ${reprocessCooldownSeconds}s`:'Approved · Ready to reprocess'}</p>{!enabled&&<p className="text-[11px] text-amber-800">Reprocessing is not available yet. You can export the file instead.</p>}</div>:<p>{review?'Your details are ready for approval.':'Changes are saved for this session. Original files stay unchanged.'}</p>}
      </div>
      <div className="northport-dialog-actions northport-dialog-footer mt-4 flex w-full flex-nowrap gap-2 border-t border-slate-200 pt-4">
        <button type="button" disabled={!!busy} className={cancelButtonClass} onClick={()=>{setSelected(null);setApproved(null);setReview(false);}}>Cancel</button>
        {!review?<>
          <button type="button" disabled={!!busy} className={secondaryClass} onClick={()=>void action('download-reprocess',{token:selected.token,values,filename:`REPROCESS_${values[0]}.csv`})}><Download aria-hidden="true" className="h-4 w-4"/><span className="sm:hidden">Download</span><span className="hidden sm:inline">Download CSV</span></button>
          <button type="button" disabled={!!busy} className={secondaryClass} onClick={()=>{if(!/^[A-Z0-9]+$/.test(values[0])){setError('Enter a valid container number before saving.');return;}setDrafts(previous=>({...previous,[selected.filename+':'+selected.record]:[...values]}));setError('');setDraftMessage('Changes saved for this session.');}}><span className="sm:hidden">Save</span><span className="hidden sm:inline">Save Changes</span></button>
          <button type="button" disabled={!!busy} className={buttonClass} onClick={()=>{setDraftMessage('');setReview(true);}}><span className="sm:hidden">Review</span><span className="hidden sm:inline">Review Record</span></button>
        </>:!approved?<>
          <button type="button" disabled={!!busy} className={secondaryClass} onClick={()=>setReview(false)}><span className="sm:hidden">Back</span><span className="hidden sm:inline">Back to Editor</span></button>
          <button type="button" disabled={!!busy||(identityChanged&&!identityConfirmed)} className={reprocessButtonClass} onClick={()=>setConfirmation({action:'approve',container:values[0],records:selected.totalRecords,payload:approvePayload})}><ShieldCheck aria-hidden="true" className="h-4 w-4"/><span className="sm:hidden">Approve CSV</span><span className="hidden sm:inline">Approve Reprocess File</span></button>
        </>:<>
          <button type="button" className={secondaryClass} disabled={!!busy} onClick={()=>exportApprovedCsv(approved.preview,approved.filename)}><Download aria-hidden="true" className="h-4 w-4"/>Export CSV</button>
          <button type="button" className={reprocessButtonClass} disabled={!enabled||!!busy||recoveryUploaded||reprocessStarted||reprocessCooldownSeconds>0} aria-label={isReprocessing?`PROCESSING ${'.'.repeat(processingDots)}`:undefined} title={reprocessCooldownSeconds>0?`Available in ${reprocessCooldownSeconds} seconds`:undefined} onClick={()=>setConfirmation({action:'reprocess',container:values[0],records:approved.records??selected.totalRecords,payload:{...approvePayload,id:approved.id}})}>{isReprocessing?<span aria-hidden="true">PROCESSING {'.'.repeat(processingDots)}</span>:<><span className="sm:hidden">{reprocessCooldownSeconds>0?`Reprocess (${reprocessCooldownSeconds}s)`:'Reprocess'}</span><span className="hidden sm:inline">{reprocessCooldownSeconds>0?`Reprocess & Run Scheduler (${reprocessCooldownSeconds}s)`:'Reprocess & Run Scheduler'}</span></>}</button>
        </>}
      </div>
    </FileEditorDialog>}

    {confirmation&&<RecoveryConfirmationDialog confirmation={confirmation} onCancel={()=>setConfirmation(null)} onConfirm={()=>{const request=confirmation;setConfirmation(null);void action(request.action,request.payload);}}/>}
    <section className="flex flex-col gap-4 pt-5 pb-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"><h3 className="text-sm font-bold text-slate-900">Recovery History</h3><button className="col-start-2 row-span-2 row-start-1 inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" disabled={!!busy} onClick={()=>void loadHistory()}><RefreshCw aria-hidden="true" className="h-2.5 w-2.5"/>Refresh History</button><p className="col-start-1 text-xs leading-4 text-slate-500">Latest 50 approvals. History shows approval, upload, and scheduler states separately; container import is not verified.</p></div>
      <div className="northport-history-container min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="northport-history-cards divide-y divide-slate-100 md:hidden">{history.map(row=><article key={row.id} className="min-w-0 px-3 py-2">
        <button type="button" aria-label={`View recovery details for ${row.container}`} onClick={()=>setHistoryDetail(row)} className="block w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-blue-700">{row.container}<span className="ml-2 text-[10px] font-medium text-slate-500">{row.container_type}</span></span><HistoryStatus recovery={row}/></div>
          <p className="truncate text-xs text-slate-600" title={row.source_filename}>{row.source_filename}</p>
          <time className="mt-1 block text-[11px] text-slate-500" dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})} MYT</time>
        </button>
        {row.status==='Uploaded'&&!row.scheduler_status&&<button type="button" disabled={!!busy} className={secondaryClass+' mt-3 w-full'} onClick={()=>{setConfirmation({action:'scheduler',container:row.container,payload:{id:row.id}});}}>Run scheduler</button>}
      </article>)}</div>
      <div className="northport-history-table-wrap hidden min-w-0 md:block"><table className="northport-history-table text-left text-xs"><thead className="border-y border-slate-100 bg-slate-50"><tr>{['Container','Type','Source file','Submitted by','Time','Modification','Status'].map(h=><th scope="col" key={h} className={tableHeadingClass+' whitespace-nowrap '+(['Type','Submitted by','Time','Modification','Status'].includes(h)?'text-center':'')}>{h}</th>)}</tr></thead><tbody>{history.map(row=><tr key={row.id} className="border-b border-slate-100 last:border-0"><td className="px-4 py-2 align-middle"><button type="button" className="font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={()=>setHistoryDetail(row)}>{row.container}</button></td><td className="px-2 py-2 align-middle text-center text-slate-600">{row.container_type}</td><td className="px-4 py-2 align-middle text-slate-600" title={row.source_filename}><span className="block">{row.source_filename}</span></td><td className="px-2 py-2 align-middle text-center text-slate-600">{row.submitted_by.split('@')[0]}</td><td className="whitespace-nowrap px-2 py-2 align-middle text-center text-slate-600"><time dateTime={row.created_at}><span className="inline-block whitespace-nowrap">{new Date(row.created_at).toLocaleDateString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})}</span>{' '}<span className="inline-block whitespace-nowrap">{new Date(row.created_at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})} MYT</span></time></td><td className="px-2 py-2 align-middle text-center text-slate-600">{row.changed_fields.join(', ')||'None'}</td><td className="px-2 py-2 align-middle text-center"><HistoryStatus recovery={row}/>{row.status==='Uploaded'&&!row.scheduler_status&&<div className="mt-1 flex flex-col items-center gap-0.5"><button className="text-[10px] text-blue-700 hover:underline" disabled={!!busy} onClick={()=>{setConfirmation({action:'scheduler',container:row.container,payload:{id:row.id}});}}>Run scheduler</button><button className="text-[10px] text-slate-500 hover:underline" disabled={!!busy} onClick={()=>setMessage('Process Later selected. The existing production scheduler may process the uploaded file on its normal schedule. Import verification is unavailable.')}>Process later</button></div>}</td></tr>)}</tbody></table></div>
      {!history.length&&!historyError&&<div className="flex flex-col items-center gap-2 py-3 text-center text-xs text-slate-500"><span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400"><FileClock className="h-5 w-5"/></span><p>No recovery approvals yet.</p></div>}
      </div>
    </section>
    {historyDetail&&<FileEditorDialog label="Recovery details" compact busy={false} onClose={()=>setHistoryDetail(null)} header={<><h3 className="text-sm font-bold text-slate-900">Recovery details</h3><p className="mt-1 text-xs text-slate-500">{historyDetail.container} · {historyDetail.container_type==='GP'?'Import (GP)':'Export (EX)'}</p></>}><RecoveryDetailsContent recovery={historyDetail}/></FileEditorDialog>}
  </div>;
}

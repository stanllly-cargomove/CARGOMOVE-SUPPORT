import React, { useEffect, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { knowledgeRequest } from '../../services/autoMailKnowledge';

type Job={id:string;subject:string;to_addresses:string[];cc_addresses:string[];bcc_addresses:string[];attachments:{name:string}[];send_at:string;status:string;error:string;gmail_thread_id?:string};
export function AutoMailScheduled({connectionVersion,onBusy}:{connectionVersion:string;onBusy:(busy:boolean)=>void}) {
  const [jobs,setJobs]=useState<Job[]>([]);const [next,setNext]=useState<number|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [ready,setReady]=useState(false);
  const load=async(offset=0)=>{setBusy(true);setError('');try{const result=await knowledgeRequest<{messages:Job[];nextOffset:number|null;workerReady:boolean}>(`outbox?offset=${offset}`);setJobs(current=>offset?[...current,...result.messages]:result.messages);setNext(result.nextOffset);setReady(result.workerReady);}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load Scheduled.');}finally{setBusy(false);}};
  useEffect(()=>{void load();},[]);
  const cancel=async(id:string)=>{if(!window.confirm('Cancel this scheduled message?'))return;setBusy(true);onBusy(true);setError('');try{await knowledgeRequest('outbox-cancel',{id,connectionVersion});await load();}catch(reason){setError(reason instanceof Error?reason.message:'Unable to cancel.');}finally{setBusy(false);onBusy(false);}};
  return <section aria-label="Scheduled messages" className="p-4 sm:p-6">
    <div className="mb-4 flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><Clock className="h-5 w-5"/>Scheduled</h3><button type="button" disabled={busy} onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"><RefreshCw className="h-4 w-4"/>Refresh scheduled</button></div>
    {error&&<p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!ready&&!busy&&<p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">The background worker has no recent heartbeat. Queued messages will wait until it resumes. You can cancel messages that have not started sending.</p>}
    {busy&&<p role="status" className="py-4 text-sm text-slate-500">Loading scheduled messages...</p>}
    {!busy&&!jobs.length&&!error&&<p className="py-16 text-center text-sm text-slate-500">No scheduled messages yet. Use Compose and choose Send later.</p>}
    <div className="divide-y divide-slate-100">{jobs.map(job=><article key={job.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words text-sm font-semibold">{job.subject}</h4><p className="mt-1 break-all text-xs text-slate-500">To: {job.to_addresses.join(', ')}</p>{!!job.cc_addresses.length&&<p className="break-all text-xs text-slate-500">CC: {job.cc_addresses.join(', ')}</p>}{!!job.bcc_addresses.length&&<p className="break-all text-xs text-slate-500">BCC: {job.bcc_addresses.join(', ')}</p>}<p className="mt-2 text-xs text-slate-500"><time dateTime={job.send_at}>{new Date(job.send_at).toLocaleString(undefined,{timeZoneName:'short'})}</time> · {job.status}</p>{!!job.attachments.length&&<p className="mt-1 break-words text-xs text-slate-500">Attachments: {job.attachments.map(file=>file.name).join(', ')}</p>}{job.error&&<p className="mt-2 text-xs text-amber-800">{job.error}</p>}</div>{job.status==='QUEUED'&&<button type="button" disabled={busy} onClick={()=>void cancel(job.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-red-700">Cancel scheduled message</button>}</div></article>)}</div>
    {next!==null&&<button type="button" disabled={busy} onClick={()=>void load(next)} className="mt-4 rounded-lg border px-4 py-2 text-xs">Load more scheduled</button>}
  </section>;
}

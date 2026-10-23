import React, { useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { parseMailRecipients } from '../../services/autoMailRecipients';

export function AutoMailRecipients({to,cc='',bcc='',buttonOnly=false}: {to:string;cc?:string;bcc?:string;buttonOnly?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false);
  const groups=[['To',to],['CC',cc],['BCC',bcc]].filter(([,value])=>value.trim());
  return <div className={buttonOnly ? 'shrink-0' : 'mb-2 flex min-w-0 items-start gap-2'}>
    {!buttonOnly && <dl className="min-w-0 flex-1 space-y-0.5 text-xs leading-4">{groups.map(([label,value])=><div key={label} className="flex min-w-0 gap-2"><dt className="w-7 shrink-0 text-slate-400">{label}:</dt><dd className="min-w-0 flex-1 truncate text-slate-600" title={value}>{value}</dd></div>)}</dl>}
    <button type="button" aria-label="Show all recipients" title="Show all recipients" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setOpen(true);dialog.current?.showModal();}} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><ChevronDown className="h-4 w-4"/></button>
    <dialog ref={dialog} onClose={()=>setOpen(false)} aria-label="All recipients" className="fixed inset-0 m-auto max-h-[80dvh] w-[min(92vw,560px)] max-w-none overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl backdrop:bg-slate-950/30">
      <div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-semibold text-slate-800">Recipients</h3><button type="button" autoFocus aria-label="Close recipients" onClick={()=>dialog.current?.close()} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4"/></button></div>
      {groups.map(([label,value])=><section key={label} aria-label={`${label} recipients`} className="mb-4 last:mb-0"><h4 className="mb-2 text-xs font-semibold text-slate-500">{label}:</h4><ul className="space-y-2 text-sm text-slate-700">{parseMailRecipients(value).map((recipient,index)=><li key={index} className="break-words">{recipient.name && <>{recipient.name} - </>}<span className="break-all">{recipient.email}</span></li>)}</ul></section>)}
    </dialog>
  </div>;
}

import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

export function AutoMailListTools({label,query,onSearch,status,onStatus,statuses,pageSize,onPageSize,disabled,children}:{
  label:string;query:string;onSearch:(query:string)=>void;status:string;onStatus:(status:string)=>void;
  statuses:{value:string;label:string}[];pageSize:number;onPageSize:(size:number)=>void;disabled:boolean;children:React.ReactNode;
}){
  const [search,setSearch]=useState(query);
  useEffect(()=>setSearch(query),[query]);
  return <div className="flex flex-wrap items-center gap-3 px-4 py-3">
    <form role="search" aria-label={`Search ${label}`} className="min-w-40 flex-1" onSubmit={event=>{event.preventDefault();onSearch(search.trim());}}>
      <div className="flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white pl-2.5 pr-[3px] focus-within:ring-2 focus-within:ring-sky-300">
        <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-500"/>
        <input type="search" aria-label={`Search ${label}`} placeholder={`Search ${label}`} maxLength={200} disabled={disabled} value={search} onChange={event=>setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 outline-none"/>
        {search&&<button type="button" aria-label={`Clear ${label} search`} onClick={()=>{setSearch('');onSearch('');}} disabled={disabled} className="rounded-full p-1 text-slate-500"><X className="h-3 w-3"/></button>}
        <button type="submit" disabled={disabled} className="rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">Search</button>
      </div>
    </form>
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      <select aria-label={label==='articles'?'Article status':'Learning status'} disabled={disabled} value={status} onChange={event=>onStatus(event.target.value)} className="h-9 w-[106px] rounded-lg border border-slate-300 bg-white px-2 text-xs">{statuses.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <select aria-label={label==='articles'?'Articles per page':'Suggestions per page'} disabled={disabled} value={pageSize} onChange={event=>onPageSize(Number(event.target.value))} className="h-9 w-20 rounded-lg border border-slate-300 bg-white px-1.5 text-xs">{[20,30,50].map(size=><option key={size} value={size}>{size} rows</option>)}</select>
      {children}
    </div>
  </div>;
}

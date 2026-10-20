import type { ReactNode } from 'react';
import { CheckCircle2, Download, FileSearch } from 'lucide-react';
import type { Match, ScannedFile } from '../../types/northport';

export function NorthportScannedFiles({ files, matches, busy, downloadingAll, showDownloadAll, onDownloadAll, onDownloadFile, onViewFile, recordActions }: {
  files: ScannedFile[];
  matches: Match[];
  busy: boolean;
  downloadingAll: boolean;
  showDownloadAll: boolean;
  onDownloadAll: () => void;
  onDownloadFile: (file: ScannedFile) => void;
  onViewFile: (source: { filename: string; token: string; kind: 'file' | 'record' }) => void;
  recordActions: (match: Match) => ReactNode;
}) {
  const fileMap = new Map(files.map(file => [file.filename,file]));
  const matchedNames = new Set(matches.map(match => match.filename));
  const priority = {'match':0,'content-match':1,'invalid':2,'no-match':3};
  const rows: {match?:Match;file?:ScannedFile;filename:string;timestamp:string;type:string}[] = [
    ...[...matches].sort((a,b) => a.timestamp.localeCompare(b.timestamp)||a.record-b.record).map(match => ({...match,match,file:fileMap.get(match.filename)})),
    ...files.filter(file => !matchedNames.has(file.filename)).sort((a,b) => priority[a.status]-priority[b.status]||a.timestamp.localeCompare(b.timestamp)).map(file => ({...file,file})),
  ];
  const count = new Set(rows.map(row=>row.filename)).size;
  return <section aria-label="Scanned File" className="min-w-0">
    <div className="mb-1.5 flex items-center justify-between gap-3">
      <h4 className="text-xs font-semibold text-slate-900">Scanned File <span className="ml-1 font-normal text-slate-500">({count})</span></h4>
      {showDownloadAll&&<button type="button" disabled={busy||!count} onClick={onDownloadAll} className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" title="Download the original files in one ZIP"><Download aria-hidden="true" className="h-3 w-3"/>{downloadingAll?'Downloading…':'Download all'}</button>}
    </div>
    <div className="northport-scanned-table-wrap min-w-0 overflow-x-auto rounded-lg border border-slate-300 shadow-sm">
      <table aria-label="Scanned File" className="northport-results-table northport-scanned-table text-left text-xs">
        <thead className="border-b border-slate-300 bg-slate-200 text-slate-800"><tr>{['Container No.','Type','Source Filename','File Timestamp','No. of Record','Match Status','Actions'].map(label=><th key={label} scope="col" className="border-r border-slate-300 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-700 last:border-r-0">{label}</th>)}</tr></thead>
        <tbody>{rows.map(({match,file,filename,timestamp,type}) => {
          const status = match?'match':file!.status;
          const records = match?.totalRecords??file?.records;
          const label = status==='match'?'MATCH':status==='content-match'?'TEXT FOUND':status==='invalid'?'INVALID CSV':'NO MATCH';
          return <tr key={filename+':'+(match?.record??'file')} className={'border-b border-slate-200 last:border-b-0 [&>td]:border-r [&>td]:border-slate-200 [&>td:last-child]:border-r-0 '+(status==='match'?'bg-emerald-50/60':status==='content-match'?'bg-amber-50/60':'even:bg-slate-50 hover:bg-slate-100')}>
            <td className={'px-4 py-2.5 font-semibold text-slate-900 '+(!match?'text-center':'')}>{match?.values[0]??<span className="font-normal text-slate-400">—</span>}</td>
            <td className="px-4 py-2.5"><span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-600">{type==='GP'?'Import (GP)':'Export (EX)'}</span></td>
            <td className="px-4 py-2.5 text-slate-600"><button type="button" disabled={busy} aria-haspopup="dialog" title="View containers in this file" className="text-left font-medium text-blue-700 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" onClick={()=>onViewFile({filename,token:file?.token??match?.fileToken??match!.token,kind:file||match?.fileToken?'file':'record'})}>{filename}</button>{file?.error&&<p className="mt-1 text-[10px] leading-4 text-red-700">{file.error} Recovery blocked.</p>}</td>
            <td className="px-4 py-2.5 text-slate-600"><span className="inline-block whitespace-nowrap">{timestamp.slice(0,10)}</span>{' '}<span className="inline-block whitespace-nowrap">{timestamp.slice(11)} MYT</span></td>
            <td className="px-4 py-2.5 text-center font-semibold text-slate-800">{file?.error?'—':records??'—'}</td>
            <td className={'px-4 py-2.5 text-[11px] '+(status==='match'?'text-emerald-700':status==='content-match'?'text-amber-800':status==='invalid'?'text-red-700':'text-slate-400')}><span className="inline-flex items-center gap-1 whitespace-nowrap">{status==='match'?<CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5"/>:status==='content-match'?<FileSearch aria-hidden="true" className="h-3.5 w-3.5"/>:null}{label}</span>{status==='content-match'&&<span className="mt-1 block text-[10px]">Unverified</span>}</td>
            <td className="px-4 py-2">{match?recordActions(match):<button type="button" disabled={busy} aria-label={`Download ${filename}`} title="Download original file" onClick={()=>onDownloadFile(file!)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"><Download aria-hidden="true" className="h-4 w-4"/></button>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

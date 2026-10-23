import React,{useEffect,useRef,useState} from 'react';
import {ArrowDownToLine,ChevronLeft,ChevronRight,FileText,Paperclip,X} from 'lucide-react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {mailFileKind,type MailFileKind} from '../../../shared/autoMailFiles';
import {fileSize} from '../../services/autoMailFormatting';
import type {MailAsset,MailAttachmentLoader,MailFile} from '../../services/autoMailAttachments';
import {mailSpreadsheet,mailWordDocument,openMailPdf,type MailSheet} from '../../services/autoMailDocumentPreview';
import {useMailVisible} from './AutoMailHtmlBody';
import {AutoMailSnackbar,AutoMailSnackbarArea} from './AutoMailSnackbar';

const badges:Record<MailFileKind,{label:string;color:string}>={pdf:{label:'PDF',color:'#ea4335'},excel:{label:'X',color:'#188038'},word:{label:'W',color:'#1967d2'},powerpoint:{label:'P',color:'#d24726'},image:{label:'IMG',color:'#9334e6'},text:{label:'TXT',color:'#64748b'},archive:{label:'ZIP',color:'#b06000'},file:{label:'FILE',color:'#64748b'}};
function FileBadge({kind,large=false}:{kind:MailFileKind;large?:boolean}){
 const badge=badges[kind];return <svg aria-label={`${badge.label} file`} width={large?58:26} height={large?72:32} viewBox="0 0 32 40" className="shrink-0"><path fill={badge.color} d="M3 0h18l11 11v26a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Z"/><path fill="#fff" opacity=".5" d="M21 0v11h11Z"/><text x="16" y="28" textAnchor="middle" fill="white" fontFamily="Arial,sans-serif" fontWeight="bold" fontSize={badge.label.length>2?9:18}>{badge.label}</text></svg>;
}
function PdfPage({document,page,thumbnail}:{document:PDFDocumentProxy;page:number;thumbnail:boolean}){
 const ref=useRef<HTMLCanvasElement>(null);const[error,setError]=useState('');
 useEffect(()=>{let live=true;let render:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;setError('');
  void document.getPage(page).then(async pdfPage=>{if(!live||!ref.current)return;const base=pdfPage.getViewport({scale:1});const viewport=pdfPage.getViewport({scale:(thumbnail?260:1000)/base.width});const canvas=ref.current;canvas.width=viewport.width;canvas.height=viewport.height;render=pdfPage.render({canvas,viewport});await render.promise;}).catch(error=>{if(live)setError(error instanceof Error?error.message:'Unable to render this page.');});
  return()=>{live=false;render?.cancel();};
 },[document,page,thumbnail]);
 return error?<p className="p-3 text-xs text-slate-500">Preview unavailable. Download to open.</p>:<canvas ref={ref} aria-label={`PDF page ${page}`} className={thumbnail?'w-full bg-white':'mx-auto h-auto max-w-full bg-white shadow'}/>;
}
function SheetTable({sheet,thumbnail=false}:{sheet:MailSheet;thumbnail?:boolean}){
 return <table className={`w-full border-collapse bg-white text-left ${thumbnail?'text-[9px]':'text-xs'}`}><tbody>{sheet.rows.slice(0,thumbnail?7:200).map((row,index)=><tr key={index}>{row.slice(0,thumbnail?5:30).map((value,column)=><td key={column} className="max-w-64 truncate border border-slate-200 px-2 py-1.5">{value||'\u00a0'}</td>)}</tr>)}</tbody></table>;
}
function DocumentContent({file,asset,loader,messageId,thumbnail=false}:{file:MailFile;asset:MailAsset;loader:MailAttachmentLoader;messageId:string;thumbnail?:boolean}){
 const kind=mailFileKind(file.name,asset.type);const[pdf,setPdf]=useState<PDFDocumentProxy|null>(null);const[sheets,setSheets]=useState<MailSheet[]>([]);const[word,setWord]=useState('');const[text,setText]=useState('');const[page,setPage]=useState(1);const[sheet,setSheet]=useState(0);const[error,setError]=useState('');const[ready,setReady]=useState(false);
 const supported=asset.previewable&&(kind==='pdf'||kind==='excel'||kind==='text'||(kind==='word'&&asset.type.includes('wordprocessing')));
 useEffect(()=>{if(!supported)return;let live=true;let document:PDFDocumentProxy|undefined;setReady(false);setError('');
  void loader.data(messageId,file).then(async bytes=>{
   if(!live)return;
   if(kind==='pdf'){document=await openMailPdf(bytes);if(live)setPdf(document);else void document.loadingTask.destroy();}
   else if(kind==='excel'){const value=await mailSpreadsheet(bytes);if(live)setSheets(value);}
   else if(kind==='word'){const value=await mailWordDocument(bytes);if(live)setWord(value);}
   else if(kind==='text'&&live)setText(new TextDecoder().decode(bytes));
   if(live)setReady(true);
  }).catch(reason=>{if(live){setError(reason instanceof Error?reason.message:'Preview unavailable.');setReady(true);}});
  return()=>{live=false;if(document)void document.loadingTask.destroy();};
 },[loader,messageId,file,supported,kind]);
 if(asset.previewable&&kind==='image'&&/^image\/(png|jpeg|gif|webp)$/.test(asset.type))return <img src={asset.url} alt={file.name} referrerPolicy="no-referrer" className={thumbnail?'h-full w-full object-cover object-top':'mx-auto max-h-[65vh] max-w-full object-contain'}/>;
 if(!supported||error)return <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 p-4 text-center"><FileBadge kind={kind} large/>{!thumbnail&&<p className="max-w-lg text-sm text-slate-500">{error||'Preview unavailable for this format. Download the file to open it in its application.'}</p>}</div>;
 if(!ready)return <div role="status" className="h-full min-h-32 animate-pulse bg-slate-100"><span className="sr-only">Loading document preview</span></div>;
 if(pdf)return <div>{!thumbnail&&<div className="sticky top-0 z-10 mb-3 flex items-center justify-center gap-3 bg-slate-100 p-2"><button type="button" aria-label="Previous PDF page" disabled={page===1} onClick={()=>setPage(value=>value-1)} className="rounded-full p-1 disabled:opacity-30"><ChevronLeft size={20}/></button><span className="text-xs">Page {page} of {pdf.numPages}</span><button type="button" aria-label="Next PDF page" disabled={page===pdf.numPages} onClick={()=>setPage(value=>value+1)} className="rounded-full p-1 disabled:opacity-30"><ChevronRight size={20}/></button></div>}<PdfPage document={pdf} page={page} thumbnail={thumbnail}/></div>;
 if(sheets.length)return <div>{!thumbnail&&<div className="mb-3 flex items-center gap-3"><label className="text-xs">Sheet <select aria-label="Spreadsheet sheet" value={sheet} onChange={event=>setSheet(Number(event.target.value))} className="ml-2 rounded-lg border p-2">{sheets.map((value,index)=><option key={value.name} value={index}>{value.name}</option>)}</select></label><span className="text-xs text-slate-500">Preview: up to 200 rows and 30 columns per sheet</span></div>}<SheetTable sheet={sheets[sheet]||sheets[0]} thumbnail={thumbnail}/></div>;
 if(word)return <iframe title={`${file.name}${thumbnail?' thumbnail':''}`} sandbox="" tabIndex={thumbnail?-1:0} srcDoc={word} className={thumbnail?'pointer-events-none h-[600px] w-[720px] origin-top-left scale-[0.34] border-0 bg-white':'h-[65vh] w-full border-0 bg-white'}/>;
 return <pre className={`whitespace-pre-wrap break-words bg-white p-3 ${thumbnail?'text-[9px]':'text-sm'}`}>{text.slice(0,thumbnail?2000:200000)}</pre>;
}
function AttachmentTile({file,messageId,loader,onPreview,onError}:{file:MailFile;messageId:string;loader:MailAttachmentLoader;onPreview:(file:MailFile,asset:MailAsset)=>void;onError:(message:string)=>void}){
 const{ref,visible}=useMailVisible();const[asset,setAsset]=useState<MailAsset|null>(null);const[failed,setFailed]=useState(false);const[busy,setBusy]=useState(false);
 useEffect(()=>{if(!visible)return;let live=true;void loader.get(messageId,file).then(value=>{if(live)setAsset(value);}).catch(()=>{if(live)setFailed(true);});return()=>{live=false;};},[file,messageId,loader,visible]);
 const preview=async()=>{setBusy(true);try{onPreview(file,asset||await loader.get(messageId,file));}catch(reason){onError(reason instanceof Error?reason.message:'Unable to preview attachment.');}finally{setBusy(false);}};
 return <div ref={ref} className="group/attachment relative min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white hover:shadow-md"><button type="button" disabled={busy} aria-label={`Preview ${file.name}`} onClick={()=>void preview()} className="block w-full text-left"><div className="h-32 overflow-hidden bg-slate-50" aria-hidden="true">{asset?<DocumentContent file={file} asset={asset} loader={loader} messageId={messageId} thumbnail/>:failed?<div className="flex h-full items-center justify-center"><FileBadge kind={mailFileKind(file.name,file.type)} large/></div>:<div className="h-full animate-pulse bg-slate-100"/>}</div><div className="flex h-14 items-center gap-2 border-t border-slate-200 bg-slate-50 px-3"><FileBadge kind={mailFileKind(file.name,asset?.type||file.type)}/><span className="min-w-0"><span title={file.name} className="block truncate text-xs font-semibold text-slate-700">{file.name}</span><span className="block text-[10px] text-slate-400">{fileSize(file.size)}</span></span></div></button><button type="button" aria-label={`Download ${file.name}`} title="Download attachment" onClick={()=>void loader.download(messageId,file).catch(reason=>onError(reason instanceof Error?reason.message:'Unable to download attachment.'))} className="absolute right-2 top-2 rounded-full bg-white/95 p-2 text-slate-600 shadow hover:bg-slate-100 sm:opacity-0 sm:group-hover/attachment:opacity-100 sm:group-focus-within/attachment:opacity-100"><ArrowDownToLine size={17}/></button></div>;
}
export function AutoMailAttachments({files,messageId,loader}:{files:MailFile[];messageId:string;loader:MailAttachmentLoader}){
 const[preview,setPreview]=useState<{file:MailFile;asset:MailAsset}|null>(null);const[error,setError]=useState('');const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(preview&&!dialog.current?.open)dialog.current?.showModal();},[preview]);
 return <div className="mt-3 border-t border-slate-100 pt-3"><p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-600"><Paperclip size={15}/>Attachments ({files.length})</p><div className="grid min-w-0 gap-4" style={{gridTemplateColumns:'repeat(auto-fill,minmax(min(100%,200px),240px))'}}>{files.map(file=><AttachmentTile key={file.partId} file={file} messageId={messageId} loader={loader} onPreview={(file,asset)=>setPreview({file,asset})} onError={setError}/>)}</div>{error&&<AutoMailSnackbarArea><AutoMailSnackbar key={error} alert onDismiss={()=>setError('')}>{error}</AutoMailSnackbar></AutoMailSnackbarArea>}<dialog ref={dialog} onCancel={()=>setPreview(null)} onClose={()=>setPreview(null)} aria-label="Attachment preview" className="fixed inset-0 m-auto w-[min(95vw,1100px)] max-w-none rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/60">{preview&&<><div className="flex items-center gap-3 border-b border-slate-200 p-3"><FileText size={18}/><p className="min-w-0 flex-1 truncate text-sm font-semibold">{preview.file.name}</p><button type="button" onClick={()=>void loader.download(messageId,preview.file).catch(reason=>setError(reason instanceof Error?reason.message:'Unable to download.'))} className="rounded-full border px-3 py-2 text-xs">Download</button><button type="button" autoFocus aria-label="Close attachment preview" onClick={()=>dialog.current?.close()} className="rounded-full p-2 hover:bg-slate-100"><X size={20}/></button></div><div className="h-[72vh] overflow-auto bg-slate-100 p-3"><DocumentContent file={preview.file} asset={preview.asset} loader={loader} messageId={messageId}/></div></>}</dialog></div>;
}

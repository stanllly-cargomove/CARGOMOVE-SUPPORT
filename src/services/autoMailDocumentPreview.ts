import DOMPurify from 'dompurify';
import {officeEntries} from '../../shared/autoMailFiles';
import type {PDFDocumentProxy} from 'pdfjs-dist';

export async function openMailPdf(bytes:ArrayBuffer):Promise<PDFDocumentProxy>{
 const path='/auto-mail-preview/pdf.mjs';
 const pdf=await import(/* @vite-ignore */ path);
 pdf.GlobalWorkerOptions.workerSrc='/auto-mail-preview/pdf.worker.mjs';
 const task=pdf.getDocument({data:new Uint8Array(bytes.slice(0)),isEvalSupported:false,cMapUrl:'/auto-mail-preview/cmaps/',cMapPacked:true,standardFontDataUrl:'/auto-mail-preview/standard_fonts/',wasmUrl:'/auto-mail-preview/wasm/'});
 try{return await task.promise;}catch(error){await task.destroy();throw error;}
}
export type MailSheet={name:string;rows:string[][]};
export async function mailSpreadsheet(bytes:ArrayBuffer):Promise<MailSheet[]>{
 const array=new Uint8Array(bytes);if(array[0]===80&&array[1]===75)officeEntries(array,()=>false);
 const xlsx=await import('xlsx');
 const book=xlsx.read(bytes,{type:'array',sheetRows:201,cellFormula:false,bookVBA:false,cellHTML:false});
 return book.SheetNames.slice(0,20).map(name=>{
  const sheet=book.Sheets[name],range=xlsx.utils.decode_range(sheet['!ref']||'A1');range.e.r=Math.min(range.e.r,range.s.r+199);range.e.c=Math.min(range.e.c,range.s.c+29);
  const rows=xlsx.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:false,range,defval:''});
  return {name,rows:rows.map(row=>row.map(value=>String(value??'').slice(0,2000)))};
 });
}
export async function mailWordDocument(bytes:ArrayBuffer){
 officeEntries(new Uint8Array(bytes),()=>false);
 const mammoth=await import('mammoth/mammoth.browser');
 const result=await mammoth.default.convertToHtml({arrayBuffer:bytes.slice(0)},{externalFileAccess:false,convertImage:mammoth.default.images.imgElement(async image=>{
  if(!/^image\/(png|jpeg|gif|webp)$/.test(image.contentType))return {src:''};
  const value=await image.read('base64');return {src:value.length<=4*1024*1024?`data:${image.contentType};base64,${value}`:''};
 })});
 const html=DOMPurify.sanitize(result.value,{ALLOWED_TAGS:['p','br','h1','h2','h3','h4','strong','b','em','i','u','s','ul','ol','li','table','thead','tbody','tr','th','td','img','blockquote','sup','sub'],ALLOWED_ATTR:['src','alt','colspan','rowspan'],ALLOW_DATA_ATTR:false});
 return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:15px/1.5 Arial,sans-serif;color:#263238;margin:28px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:6px}p{margin:0 0 12px}</style></head><body>${html}</body></html>`;
}

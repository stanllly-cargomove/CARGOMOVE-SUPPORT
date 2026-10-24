import React,{useEffect,useMemo,useRef,useState} from 'react';
import {browserMailHtml} from '../../services/autoMailFormatting';
import type {MailAttachmentLoader,MailFile} from '../../services/autoMailAttachments';
export function useMailVisible(){
 const ref=useRef<HTMLDivElement>(null);const[visible,setVisible]=useState(false);
 useEffect(()=>{if(!ref.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'120px'});observer.observe(ref.current);return()=>observer.disconnect();},[]);
 return {ref,visible};
}
const normal=(value:string)=>{try{return decodeURIComponent(value.trim().replace(/^cid:/i,'').replace(/^<|>$/g,'')).toLowerCase();}catch{return value.toLowerCase();}};
export function AutoMailHtmlBody({html,messageId,images=[],loader}:{html:string;messageId:string;images?:MailFile[];loader:MailAttachmentLoader}){
 const{ref,visible}=useMailVisible();const[resolved,setResolved]=useState<Record<string,string>>({});const[attempt,setAttempt]=useState(0);const[failed,setFailed]=useState(false);
 useEffect(()=>{if(!visible||!images.length)return;let live=true;setFailed(false);void Promise.allSettled(images.map(async file=>{const value=await loader.get(messageId,file);if(!/^image\/(png|jpeg|gif|webp)$/.test(value.type))throw new Error('Not a supported image');if(live)setResolved(current=>({...current,[file.partId]:value.url}));})).then(results=>{if(live)setFailed(results.some(result=>result.status==='rejected'));});return()=>{live=false;};},[visible,images,messageId,loader,attempt]);
 const content=useMemo(()=>{
  const template=document.createElement('template');template.innerHTML=browserMailHtml(html,true);
  template.content.querySelectorAll('img').forEach(image=>{
   const reference=image.getAttribute('data-mail-image')||'';const file=images.find(file=>[file.contentId,file.contentLocation,...(file.disposition==='inline'?[file.name]:[])].filter(Boolean).some(value=>normal(value!)===normal(reference)));
   const url=file?resolved[file.partId]:/^https?:\/\//i.test(reference)?reference:'';
   if(Number(image.getAttribute('width'))<=2&&Number(image.getAttribute('height'))<=2&&image.hasAttribute('width')&&image.hasAttribute('height')){image.remove();return;}
   if(url){image.src=url;image.referrerPolicy='no-referrer';image.loading='lazy';image.decoding='async';image.style.maxWidth='100%';image.style.height='auto';if(file)image.crossOrigin='anonymous';}
   else{const placeholder=document.createElement('span');placeholder.className='inline-block rounded bg-slate-100 px-1 text-xs text-slate-400';placeholder.textContent=file?(failed?'Image unavailable':'Loading image…'):'External image';image.replaceWith(placeholder);}
  });return {html:template.innerHTML};
 },[html,images,resolved,failed]);
 return <div ref={ref}>{failed&&<button type="button" onClick={()=>setAttempt(value=>value+1)} className="mb-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-sky-700">Retry embedded images</button>}<div className="auto-mail-content" dangerouslySetInnerHTML={{__html:content.html}}/></div>;
}

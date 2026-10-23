import {knowledgeRequest} from './autoMailKnowledge';
export type MailFile={partId:string;name:string;type:string;size:number;contentId?:string;contentLocation?:string;disposition?:string};
export type MailAsset={url:string;name:string;type:string;size:number;previewable:boolean};
export function createMailAttachmentLoader(threadId:string){
 const links=new Map<string,{at:number;promise:Promise<MailAsset>}>(),bytes=new Map<string,Promise<ArrayBuffer>>(),sizes=new Map<string,number>();const abort=new AbortController();
 let active=0;const waiting:(()=>void)[]=[];
 const limited=async<T>(work:()=>Promise<T>)=>{if(active>=3)await new Promise<void>(resolve=>waiting.push(resolve));active++;try{if(abort.signal.aborted)throw new Error('Reader closed.');return await work();}finally{active--;waiting.shift()?.();}};
 const get=(messageId:string,file:MailFile)=>{
  const key=messageId+':'+file.partId,old=links.get(key);if(old&&Date.now()-old.at<240000)return old.promise;
  const promise=limited(()=>knowledgeRequest<MailAsset>(`attachment?${new URLSearchParams({threadId,messageId,partId:file.partId,download:'0'})}`,undefined,abort.signal)).catch(error=>{links.delete(key);throw error;});links.set(key,{at:Date.now(),promise});return promise;
 };
 const data=async(messageId:string,file:MailFile)=>{
  const key=messageId+':'+file.partId;if(bytes.has(key))return bytes.get(key)!;
  const promise=get(messageId,file).then(asset=>limited(async()=>{const response=await fetch(asset.url,{credentials:'omit',signal:abort.signal,referrerPolicy:'no-referrer'});if(!response.ok)throw new Error('File preview expired. Close and reopen the conversation.');if(Number(response.headers.get('content-length'))>15*1024*1024)throw new Error('Download this file to open it.');const value=await response.arrayBuffer();if(value.byteLength>15*1024*1024)throw new Error('Download this file to open it.');return value;})).catch(error=>{bytes.delete(key);throw error;});
  bytes.set(key,promise);void promise.then(value=>{sizes.set(key,value.byteLength);let total=[...sizes.values()].reduce((sum,size)=>sum+size,0);for(const [old,size] of sizes){if(total<=48*1024*1024)break;if(old===key)continue;sizes.delete(old);bytes.delete(old);total-=size;}},()=>{});return promise;
 };
 return {get,data,download:async(messageId:string,file:MailFile)=>{const asset=await knowledgeRequest<MailAsset>(`attachment?${new URLSearchParams({threadId,messageId,partId:file.partId,download:'1'})}`,undefined,abort.signal);const link=document.createElement('a');link.href=asset.url;link.download=file.name;link.target='_blank';link.rel='noopener noreferrer';link.click();},dispose:()=>{abort.abort();links.clear();bytes.clear();sizes.clear();while(waiting.length)waiting.shift()?.();}};
}
export type MailAttachmentLoader=ReturnType<typeof createMailAttachmentLoader>;

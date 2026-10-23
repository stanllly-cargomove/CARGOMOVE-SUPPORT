import type { ComposeDraft } from './autoMailSending';
import { onMailSessionCleared } from './autoMailCache';

export type SavedMailDraft = { id:string; kind:'compose'|'reply'; draft:ComposeDraft; threadId?:string; sourceMessageId?:string; aiDraftId?:string|null; responseMode?:'reply'|'reply-all'; blocked?:boolean; updatedAt:string };
const prefix='cargomove.mail-drafts.';
const memory=new Map<string,SavedMailDraft[]>();
const listeners=new Set<()=>void>();let revision=0;
export const subscribeMailDrafts=(callback:()=>void)=>{listeners.add(callback);return()=>{listeners.delete(callback);};};
export const mailDraftRevision=()=>revision;
const notify=()=>{revision++;listeners.forEach(callback=>callback());};
const key=(scope:string,connection:string)=>prefix+JSON.stringify([scope,connection]);
export function readMailDrafts(scope:string,connection:string):SavedMailDraft[]{
  const id=key(scope,connection);if(memory.has(id))return memory.get(id)!;
  try{const saved=JSON.parse(sessionStorage.getItem(id)||'[]');if(Array.isArray(saved)){const items=saved.filter(item=>typeof item?.id==='string'&&item.id===item.draft?.requestId&&['reply','compose'].includes(item.kind)&&item.draft.connectionVersion===connection&&['subject','body','bodyHtml','to','cc','bcc','mailbox'].every(field=>typeof item.draft[field]==='string')&&Array.isArray(item.draft.files)&&item.draft.files.length<=10&&item.draft.files.every((file:any)=>typeof file?.id==='string'&&typeof file.name==='string'));memory.set(id,items);return items;}}catch{}
  return [];
}
function write(scope:string,connection:string,items:SavedMailDraft[]){
  const id=key(scope,connection);memory.set(id,items);notify();
  const value=JSON.stringify(items);if(value.length>2_000_000)throw new Error('Draft storage is full. Remove older drafts to keep saving.');
  try{sessionStorage.setItem(id,value);}catch{throw new Error('Drafts are kept in memory, but this browser could not save them for refresh.');}
}
export function saveMailDraft(scope:string,connection:string,value:Omit<SavedMailDraft,'updatedAt'>){
  if(!connection)return;
  const items=readMailDrafts(scope,connection);const old=items.find(item=>item.id===value.id);
  if(old&&JSON.stringify({...old,updatedAt:undefined})===JSON.stringify({...value,updatedAt:undefined}))return;
  write(scope,connection,[{...value,updatedAt:new Date().toISOString()},...items.filter(item=>item.id!==value.id)]);
}
export function removeMailDraft(scope:string,connection:string,id:string){const items=readMailDrafts(scope,connection);if(items.some(item=>item.id===id))write(scope,connection,items.filter(item=>item.id!==id));}
export function blockMailDraft(scope:string,connection:string,id:string,blocked:boolean){const item=readMailDrafts(scope,connection).find(item=>item.id===id);if(item)saveMailDraft(scope,connection,{...item,blocked});}
onMailSessionCleared(()=>{memory.clear();try{for(const id of Object.keys(sessionStorage))if(id.startsWith(prefix))sessionStorage.removeItem(id);}catch{}notify();});

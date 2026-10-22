// Session memory only: no mailbox content is persisted in local/session storage.
export const MAIL_REFRESH_MS = 120_000;
type Entry = { value: unknown; at: number };
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
let generation = 0;
const clearListeners = new Set<()=>void>();
const key = (scope:string,path:string,context='')=>JSON.stringify([scope,context,path]);
export function peekMail<T>(scope:string,path:string,context=''):T|undefined { return entries.get(key(scope,path,context))?.value as T|undefined; }
export function mailIsFresh(scope:string,path:string,context='') {const entry=entries.get(key(scope,path,context));return !!entry&&Date.now()-entry.at<MAIL_REFRESH_MS;}
export function writeMail(scope:string,path:string,value:unknown,context='') {
  const id=key(scope,path,context); entries.delete(id); entries.set(id,{value,at:Date.now()});
  while(entries.size>80)entries.delete(entries.keys().next().value!);
}
export function expireMail(scope:string,prefix='',context?:string) {
  for(const [id,entry] of entries){const [owner,connection,path]=JSON.parse(id);if(owner===scope&&path.startsWith(prefix)&&(context===undefined||context===connection))entry.at=0;}
}
export function expireMailStatus() {for(const [id,entry] of entries)if(JSON.parse(id)[2]==='status')entry.at=0;}
export function clearMailSession() {generation++;entries.clear();pending.clear();clearListeners.forEach(fn=>fn());}
export function onMailSessionCleared(fn:()=>void) {clearListeners.add(fn);return()=>clearListeners.delete(fn);}
export async function cachedMail<T>(scope:string,path:string,options:{context?:string;force?:boolean;conditional?:boolean}={}):Promise<T> {
  const id=key(scope,path,options.context); const current=entries.get(id);
  if(!options.force&&current&&Date.now()-current.at<MAIL_REFRESH_MS)return current.value as T;
  if(pending.has(id))return pending.get(id) as Promise<T>;
  const started=generation;
  const task=(async()=>{
    const old=current?.value as {historyId?:string}|undefined;
    const conditional=(!options.force||options.conditional)&&path.startsWith('threads?')&&!path.includes('pageToken=')&&old?.historyId;
    const url=path+(conditional?`&historyId=${encodeURIComponent(old.historyId!)}`:'');
    const response=await fetch(`/api/auto-mail/${url}`,{credentials:'include',cache:'no-store'});
    let result=await response.json().catch(()=>({}));
    if(response.status===401){clearMailSession();throw new Error('Your session expired. Sign in again.');}
    if(!response.ok)throw new Error(result.error||'Unable to refresh Auto Mail.');
    if(result.notModified&&current)result=current.value;
    if(started===generation)writeMail(scope,path,result,options.context);
    return result as T;
  })();
  pending.set(id,task);
  try{return await task;}finally{if(pending.get(id)===task)pending.delete(id);}
}

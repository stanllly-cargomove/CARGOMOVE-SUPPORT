import { parseMailRecipients, type MailRecipient } from './autoMailRecipients';

// Per-tab snapshots survive reloads and are cleared with the authenticated session.
export const MAIL_REFRESH_MS = 120_000;
const SNAPSHOT_KEY = 'cargomove.auto-mail.v1';
const SNAPSHOT_MAX_AGE = 8 * 60 * 60 * 1000;
const SNAPSHOT_MAX_SIZE = 2_000_000;
type Entry = { value: unknown; at: number; savedAt: number };
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
const restoredScopes = new Set<string>();
let restored = false;
let generation = 0;
const clearListeners = new Set<()=>void>();
const key = (scope:string,path:string,context='')=>JSON.stringify([scope,context,path]);
const isReadiness = (id:string) => ['status','initialized'].includes(JSON.parse(id)[2]);
const persistentPath = (path:string) => path === 'status' || path === 'initialized' || path.startsWith('threads?') || path.startsWith('thread?') || path.startsWith('outbox?');
function validSnapshot(path:string, value:any) {
  if (!value || typeof value !== 'object') return false;
  if (path === 'status') return typeof value.state === 'string' && typeof value.mailboxConnected === 'boolean';
  if (path === 'initialized') return value.ready === true;
  if (path.startsWith('threads?')) return Array.isArray(value.threads) && value.threads.every((row:any) => row && ['id','subject','from','snippet'].every(field => typeof row[field] === 'string') && typeof row.unread === 'boolean');
  if (path.startsWith('thread?')) return ['id','subject','recipient','mailbox','connectionVersion'].every(field => typeof value[field] === 'string') && Array.isArray(value.messages) && value.messages.every((message:any) => message && ['id','from','to','date','body'].every(field => typeof message[field] === 'string'));
  if (path.startsWith('outbox?')) return Array.isArray(value.messages) && value.messages.every((job:any) => job && typeof job.id === 'string' && typeof job.subject === 'string' && ['to_addresses','cc_addresses','bcc_addresses','attachments'].every(field => Array.isArray(job[field])));
  return false;
}
function restoreSnapshot() {
  if (restored) return;
  restored = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY) || 'null');
    if (saved?.version !== 1 || !Array.isArray(saved.entries)) return;
    for (const item of saved.entries.slice(-80)) {
      try {
        const [id, entry] = item;
        const parts = JSON.parse(id);
        if (!Array.isArray(parts) || parts.length !== 3 || !parts.every(part => typeof part === 'string')) continue;
        const [scope, , path] = parts;
        if (!Number.isFinite(entry.at) || !Number.isFinite(entry.savedAt) || entry.savedAt > Date.now() || Date.now() - entry.savedAt > SNAPSHOT_MAX_AGE || !validSnapshot(path, entry.value)) continue;
        entries.set(id, entry);
        restoredScopes.add(scope);
      } catch { /* Ignore incomplete snapshot entries. */ }
    }
  } catch { /* Storage may be unavailable; the memory cache still works. */ }
}
function persistSnapshot() {
  try {
    const saved = [...entries].filter(([id, entry]) => persistentPath(JSON.parse(id)[2]) && Date.now() - entry.savedAt <= SNAPSHOT_MAX_AGE);
    let serialized = JSON.stringify({version:1,entries:saved});
    while (serialized.length > SNAPSHOT_MAX_SIZE && saved.length) { const index=saved.findIndex(([id])=>!isReadiness(id)); saved.splice(index<0?0:index,1); serialized = JSON.stringify({version:1,entries:saved}); }
    sessionStorage.setItem(SNAPSHOT_KEY, serialized);
  } catch { /* Storage quota/private browsing must not prevent loading mail. */ }
}
export function takeMailRevalidation(scope:string) { restoreSnapshot(); return restoredScopes.delete(scope); }
export function peekMail<T>(scope:string,path:string,context=''):T|undefined { restoreSnapshot(); return entries.get(key(scope,path,context))?.value as T|undefined; }
export function mailIsFresh(scope:string,path:string,context='') {restoreSnapshot();const entry=entries.get(key(scope,path,context));return !!entry&&entry.at>0&&Date.now()-entry.at<MAIL_REFRESH_MS;}
export function writeMail(scope:string,path:string,value:unknown,context='') {
  restoreSnapshot();
  const id=key(scope,path,context); entries.delete(id); entries.set(id,{value,at:Date.now(),savedAt:Date.now()});
  while(entries.size>80)entries.delete([...entries.keys()].find(id=>!isReadiness(id)) || entries.keys().next().value!);
  persistSnapshot();
}
export function expireMail(scope:string,prefix='',context?:string) {
  restoreSnapshot();
  for(const [id,entry] of entries){const [owner,connection,path]=JSON.parse(id);if(owner===scope&&path.startsWith(prefix)&&(context===undefined||context===connection))entry.at=0;}
  persistSnapshot();
}
export function expireMailStatus() {restoreSnapshot();for(const [id,entry] of entries)if(JSON.parse(id)[2]==='status')entry.at=0;persistSnapshot();}
export function clearMailSession() {generation++;restored=true;restoredScopes.clear();entries.clear();pending.clear();try{sessionStorage.removeItem(SNAPSHOT_KEY);}catch{}clearListeners.forEach(fn=>fn());}
export function onMailSessionCleared(fn:()=>void) {clearListeners.add(fn);return()=>clearListeners.delete(fn);}
export async function cachedMail<T>(scope:string,path:string,options:{context?:string;force?:boolean;conditional?:boolean}={}):Promise<T> {
  restoreSnapshot();
  const id=key(scope,path,options.context); const current=entries.get(id);
  if(pending.has(id))return pending.get(id) as Promise<T>;
  if(!options.force&&current&&current.at>0&&Date.now()-current.at<MAIL_REFRESH_MS)return current.value as T;
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

// Revalidate every already-loaded page so a reload does not collapse a long list to page one.
export async function refreshMailThreads<T extends {id:string}>(scope:string, path:string, context:string, options:{conditional?:boolean}={}) {
  type Page = {threads:T[];nextPageToken:string|null;historyId?:string};
  const started = generation;
  const loaded = peekMail<Page>(scope,path,context)?.threads.length || 0;
  const first = await cachedMail<Page>(scope,path,{context,force:true,conditional:options.conditional??true});
  if (started !== generation) throw new Error('Your session ended. Sign in again.');
  const threads = [...first.threads];
  const ids = new Set(threads.map(item=>item.id));
  const pages = new Set<string>();
  let nextPageToken = first.nextPageToken;
  while (threads.length < loaded && nextPageToken && !pages.has(nextPageToken) && pages.size < 80) {
    pages.add(nextPageToken);
    const page = await cachedMail<Page>(scope,`${path}&pageToken=${encodeURIComponent(nextPageToken)}`,{context,force:true});
    if (started !== generation) throw new Error('Your session ended. Sign in again.');
    for (const item of page.threads) if (!ids.has(item.id)) { ids.add(item.id); threads.push(item); }
    nextPageToken = page.nextPageToken;
  }
  const result = {...first,threads,nextPageToken};
  writeMail(scope,path,result,context);
  return result;
}

export function mailContacts(scope:string,context:string):MailRecipient[] {
  restoreSnapshot();const contacts=new Map<string,MailRecipient>();
  const add=(value:unknown)=>{if(typeof value!=='string')return;for(const person of parseMailRecipients(value)){if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(person.email))continue;const id=person.email.toLowerCase();const old=contacts.get(id);if(!old||(!old.name&&person.name))contacts.set(id,person);}};
  for(const [id,entry] of entries){const [owner,connection,path]=JSON.parse(id);if(owner!==scope||connection!==context)continue;const value=entry.value as any;
    if(path.startsWith('threads?'))for(const row of value.threads||[]){add(row.from);add(row.to);}
    if(path.startsWith('thread?'))for(const row of value.messages||[]){add(row.from);add(row.to);add(row.cc);}
  }
  return [...contacts.values()];
}

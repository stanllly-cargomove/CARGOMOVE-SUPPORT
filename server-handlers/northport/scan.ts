import crypto from 'node:crypto';
import type { Client } from 'basic-ftp';
import { localTime, RecoveryError, type searchInput } from './format.js';

type Filter = ReturnType<typeof searchInput>;
export const MAX_SCAN_CHECKS = 36000;
export type ScanState = { actor:string; filter:Filter; offset:number; files:number; bytes:number; records:number; matches:number; resultBytes:number; errors:number; expires:number };
function signature(data:string) { return crypto.createHmac('sha256',process.env.SESSION_SECRET!).update('northport-scan:'+data).digest('base64url'); }
export function scanPlan(filter:Filter) {
  const types = filter.type === 'ALL' ? ['GP','EX'] : [filter.type];
  const first = Math.ceil(filter.start/1000); const last = Math.floor(filter.end/1000);
  const total = Math.max(0,last-first+1)*types.length;
  if (total>MAX_SCAN_CHECKS) throw new RecoveryError('This range needs more than 36,000 filename checks. Narrow the time window or select GP/EX.');
  return {types,first,total};
}
export function readScanCursor(token:unknown,actor:string,filter:Filter):ScanState {
  const total=scanPlan(filter).total;
  if (token === undefined || token === null) return {actor,filter,offset:0,files:0,bytes:0,records:0,matches:0,resultBytes:0,errors:0,expires:Date.now()+30*60000};
  if (typeof token!=='string'||token.length>4000) throw new RecoveryError('Invalid search continuation. Start a new search.');
  const [data,sig,extra]=token.split('.');const expected=signature(data);
  if(extra||!sig||sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) throw new RecoveryError('Invalid search continuation. Start a new search.');
  let state:ScanState;
  try {state=JSON.parse(Buffer.from(data,'base64url').toString());} catch {throw new RecoveryError('Invalid search continuation.');}
  if(state.actor!==actor||JSON.stringify(state.filter)!==JSON.stringify(filter)||!Number.isFinite(state.expires)||state.expires<Date.now()) throw new RecoveryError('Search continuation expired or does not match this search. Start again.');
  if(![state.offset,state.files,state.bytes,state.records,state.matches,state.resultBytes,state.errors].every(n=>Number.isSafeInteger(n)&&n>=0)||state.offset>total) throw new RecoveryError('Invalid search progress.');
  return state;
}
export function signScanCursor(state:ScanState) {const data=Buffer.from(JSON.stringify(state)).toString('base64url');return data+'.'+signature(data);}
export function isMissingFile(error:unknown) {
  const e=error as {code?:unknown;message?:unknown};
  return e?.code===550&&typeof e.message==='string'&&/no such file|file not found|cannot find the file|file does not exist/i.test(e.message);
}
export async function probeFilenameBatch(ftp:Pick<Client,'size'>,filter:Filter,offset:number,signal?:AbortSignal,options={maxChecks:600,budgetMs:15000}) {
  const plan=scanPlan(filter);const started=Date.now();const files:{name:string;size:number;isFile:boolean}[]=[];const initial=offset;
  while(offset<plan.total&&offset-initial<options.maxChecks&&(offset===initial||Date.now()-started<options.budgetMs)) {
    if(signal?.aborted) throw new RecoveryError('Search cancelled.',499);
    const second=plan.first+Math.floor(offset/plan.types.length);const type=plan.types[offset%plan.types.length];
    const stamp=localTime(second*1000).replace(/[-:T]/g,'');const name=`CM_CONTAINER_${stamp}_${type}.csv`;
    try {
      const size=await ftp.size(name);
      if(!Number.isSafeInteger(size)||size<0) throw new RecoveryError('FTP returned invalid file metadata.',502);
      files.push({name,size,isFile:true});
    } catch(error) {if(!isMissingFile(error))throw error;}
    offset++;
  }
  return {files,scope:'window' as const,listingMode:'timestamp-scan' as const,coverageWarning:null as string|null,scan:{nextOffset:offset,total:plan.total,checked:offset-initial}};
}

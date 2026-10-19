import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NORTHPORT_COLUMNS } from '../src/types/northport.js';
import { filenameInfo, malaysiaTime, localTime, searchInput, parseCsv, generateCsv, validateValues, MAX_FILE, RecoveryError } from '../server-handlers/northport/format.js';
import { ftpConfig, withFtp, safeUpload, download } from '../server-handlers/northport/ftp.js';
import { createNorthportHandler } from '../server-handlers/northport/handler.js';
import { searchFiles, PARTIAL_LISTING_WARNING } from '../server-handlers/northport/listing.js';

const gpName='CM_CONTAINER_20261017012016_GP.csv';
const exName='CM_CONTAINER_20261017012014_EX.csv';
const gp=readFileSync(new URL('./fixtures/northport/'+gpName,import.meta.url));
const ex=readFileSync(new URL('./fixtures/northport/'+exName,import.meta.url));
const search={unit:' msbu4179350 ',timestamp:'2026-10-17T01:20:00',type:'ALL',before:5,after:30};
test('GP and EX timestamps are strict Malaysia times; case-insensitive names',()=>{
  assert.equal(filenameInfo(gpName)?.type,'GP');assert.equal(filenameInfo(exName)?.type,'EX');
  assert.equal(filenameInfo(gpName.toLowerCase())?.time,Date.parse('2026-10-16T17:20:16Z'));
  for(const name of ['../'+gpName,'CM_CONTAINER_20260230012000_GP.csv','CM_CONTAINER_20261301012000_EX.csv','CM_CONTAINER_20261017242000_GP.csv','CM_CONTAINER_20261017016000_GP.csv','CM_CONTAINER_20261017012060_GP.csv','CM_CONTAINER_20261017012000_XX.csv',gpName+'.bak']) assert.equal(filenameInfo(name),null,name);
});
test('time windows cross midnight and dates, inclusive boundaries, leap dates',()=>{
  const f=searchInput({...search,timestamp:'2026-01-01T00:02:00'});
  assert.equal(localTime(f.start),'2025-12-31T23:57:00');assert.equal(localTime(f.end),'2026-01-01T00:32:00');
  assert.doesNotThrow(()=>malaysiaTime('2028-02-29T23:59:59'));
  for(const time of ['2026-02-29T01:00:00','2026-10-17T01:20','2026-10-17T01:20:00Z']) assert.throws(()=>malaysiaTime(time));
  for(const change of [{unit:'../ABC'},{before:-1},{after:1441},{before:0.5},{type:'BAD'}]) assert.throws(()=>searchInput({...search,...change}));
});
test('both supplied fixtures preserve twenty string columns, empty lines and blanks',()=>{
  for(const bytes of [gp,ex]) {
    const csv=parseCsv(bytes);assert.equal(csv.format.newline,'\r\r\n');assert.equal(csv.format.bom,false);assert.equal(csv.rows.length,bytes===gp?3:4);
    for(const row of csv.rows) {assert.equal(row.length,20);assert.ok(row.every(v=>typeof v==='string'));assert.ok(row.includes(''));}
  }
  assert.equal(parseCsv(gp).rows[0][0],'MSBU4179350');assert.equal(parseCsv(ex).rows[0][2],'HLLBKI26-001876');
});
test('generation round-trips quoting, commas, leading zeros, blanks and formula-looking values unchanged',()=>{
  const values=parseCsv(gp).rows[0];values[1]='0000123';values[3]='A,"B"';values[4]='=SOURCE';
  for(const format of [{bom:false,newline:'\r\n',quoteAll:false},{bom:true,newline:'\n',quoteAll:true}]) {
    const bytes=generateCsv(values,format);const parsed=parseCsv(bytes);
    assert.deepEqual(parsed.rows,[values]);assert.deepEqual(parsed.format,format);
    assert.equal(parsed.rows[0][14],'');
  }
});
test('schema mismatches, unknown data, encoding, malformed quotes and unsafe structures fail closed',()=>{
  const header=NORTHPORT_COLUMNS.join(',');
  for(const text of [header+',UNKNOWN\r\n'+Array(21).fill('x').join(','),header.replace('GPNO','WRONG'),header+'\r\nA,B',header+'\r\n"unterminated',header+'\r\n'+Array(21).fill('a').join(','),header+'\r\n\n']) assert.throws(()=>parseCsv(Buffer.from(text)));
  assert.throws(()=>parseCsv(Buffer.from([0xff,0xfe])));assert.throws(()=>parseCsv(Buffer.alloc(MAX_FILE+1)));
  assert.throws(()=>validateValues([...parseCsv(gp).rows[0].slice(0,19)]));
  const values=parseCsv(gp).rows[0];values[3]='bad\nvalue';assert.throws(()=>validateValues(values));
});

function harness() {
  process.env.NORTHPORT_FTP_LISTING_MODE='full';
  process.env.SESSION_SECRET='northport-tests-only';process.env.SCHEDULER_PORTAL_URL='https://portal.example.test';process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='false';
  let session:any={id:'admin',email:'admin@example.test',type:'ADMIN'};let profile:any={id:'profile'};
  let entries=[{name:gpName,isFile:true,size:gp.length},{name:exName,isFile:true,size:ex.length},{name:'CM_CONTAINER_20261015012016_GP.csv',isFile:true,size:999999}];
  const downloads:string[]=[];const updates:any[]=[];let approve:any=null;let claim:any=null;let schedulerClaim=true;let rate=true;let ftpError=false;let source=gp;let schedulerFailure=false;let schedulerCalls=0;let uploaded=false;
  const listingRequests:(string|undefined)[]=[];
  let sizeLookup=async(_name:string)=>1;
  const ftp={pwd:async()=>'/account',cd:async()=>{},list:async(pattern?:string)=>{listingRequests.push(pattern);return entries;},downloadTo:async(stream:any,name:string)=>{downloads.push(name);stream.end(name===exName?ex:source);},uploadFrom:async()=>{uploaded=true;},size:async(name:string)=>sizeLookup(name),rename:async()=>{}};
  const client={from(){const query:any={select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},timeout(){return this;},update(value:any){updates.push(value);return this;},async maybeSingle(){return {data:profile,error:null};},then(resolve:any){return Promise.resolve({data:[],error:null}).then(resolve);}};return query;},async rpc(name:string){return {error:null,data:name==='northport_admit_request'?rate:name==='northport_approve'?approve:name==='northport_claim_upload'?claim:name==='northport_claim_scheduler'?schedulerClaim:null};}};
  const handler=createNorthportHandler({adminClient:()=>client as any,readSession:()=>session,withFtp:async(operation:any)=>{if(ftpError)throw new RecoveryError('FTP operation failed',502);return operation(ftp,{base:'/incoming',success:'/incoming/SUCCESS',access:{secure:true}});},runScheduler:async(_req:any,res:any)=>{schedulerCalls++;res.status(schedulerFailure?502:200).json({status:schedulerFailure?'failed':'trigger_requested',message:'Test result',executionId:'run-test'});}} as any);
  const call=async(payload:any,overrides:any={})=>{const response:any={code:200,body:null,headers:{} as Record<string,string>,setHeader(name:string,value:string){this.headers[name]=value;},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;},send(body:any){this.body=body;return this;}};await handler({method:'POST',headers:{origin:'https://portal.example.test','x-cargomove-confirm':'northport-recovery'},body:payload,...overrides},response);return response;};
  return {call,downloads,updates,listingRequests,setSize:(fn:typeof sizeLookup)=>sizeLookup=fn,get uploaded(){return uploaded;},get schedulerCalls(){return schedulerCalls;},setSession:(v:any)=>session=v,setProfile:(v:any)=>profile=v,setEntries:(v:any)=>entries=v,setRate:(v:boolean)=>rate=v,setFtpError:()=>ftpError=true,setSource:(v:Buffer)=>source=v,setApprove:(v:any)=>approve=v,setClaim:(v:any)=>claim=v,setSchedulerFailure:()=>schedulerFailure=true,setSchedulerClaim:(v:boolean)=>schedulerClaim=v};
}
test('time-window scan discovers a file omitted from listings and matches its second container row without a filename',async()=>{
  const h=harness();process.env.NORTHPORT_FTP_LISTING_MODE='timestamp-scan';h.setEntries([]);
  h.setSize(async name=>{if(name===gpName)return gp.length;throw Object.assign(new Error('550 No such file or directory'),{code:550});});
  try {
    const input={action:'search',...search,unit:'TXGU4841312',timestamp:'2026-10-17T01:15:00',type:'GP',before:0,after:10};
    const first=await h.call(input);assert.equal(first.code,200);assert.equal(first.body.complete,false);assert.ok(first.body.nextCursor);assert.equal(first.body.matches.length,1);assert.equal(first.body.matches[0].record,2);assert.equal(first.body.matches[0].filename,gpName);assert.equal(first.body.progress.records,3);
    const last=await h.call({...input,cursor:first.body.nextCursor});assert.equal(last.code,200);assert.equal(last.body.complete,true);assert.equal(last.body.nextCursor,null);assert.equal(last.body.progress.checked,601);assert.equal(last.body.progress.files,1);assert.equal(last.body.progress.records,3);assert.equal(h.listingRequests.length,0);assert.deepEqual(h.downloads,[gpName]);
    assert.equal((await h.call({...input,cursor:first.body.nextCursor,unit:'OTHER123'})).code,400);
  }finally{process.env.NORTHPORT_FTP_LISTING_MODE='full';}
});
test('malformed-file errors persist through the final scan batch; permission failures never mean missing',async()=>{
  const h=harness();process.env.NORTHPORT_FTP_LISTING_MODE='timestamp-scan';
  h.setSize(async name=>{if(name===gpName)return gp.length;throw Object.assign(new Error('550 No such file or directory'),{code:550});});
  h.setSource(Buffer.from('UNIT,WRONG\r\nX,Y'));
  try{
    const input={action:'search',...search,timestamp:'2026-10-17T01:15:00',type:'GP',before:0,after:10};
    const first=await h.call(input);assert.equal(first.body.errors.length,1);
    const last=await h.call({...input,cursor:first.body.nextCursor});assert.equal(last.body.complete,false);assert.equal(last.body.nextCursor,null);
    h.setSize(async()=>{throw Object.assign(new Error('550 Permission denied'),{code:550});});
    assert.equal((await h.call(input)).code,503);
  }finally{process.env.NORTHPORT_FTP_LISTING_MODE='full';}
});
test('exact source filename bypasses incomplete listings and is scoped to that file',async()=>{
  const h=harness();h.setEntries([]);
  const res=await h.call({action:'search',...search,sourceFilename:gpName});
  assert.equal(res.code,200);assert.equal(res.body.scope,'file');assert.equal(res.body.listingMode,'exact');assert.equal(res.body.matches.length,1);assert.equal(res.body.complete,true);assert.equal(res.body.listed,0);assert.equal(h.listingRequests.length,0);assert.deepEqual(h.downloads,[gpName]);
  assert.equal((await h.call({action:'search',...search,sourceFilename:gpName,type:'EX'})).code,400);
  assert.equal((await h.call({action:'search',...search,sourceFilename:gpName,timestamp:'2026-10-18T01:20:00'})).code,400);
  for(const name of ['../'+gpName,'*20261017*',gpName+'\r\nQUIT']) assert.equal((await h.call({action:'search',...search,sourceFilename:name})).code,400);
  assert.equal(h.downloads.length,1);
});
test('date-pattern discovery is always incomplete, even when it finds matches or no files',async()=>{
  const h=harness();process.env.NORTHPORT_FTP_LISTING_MODE='date-pattern';
  try {
    const res=await h.call({action:'search',...search});assert.equal(res.code,200);assert.equal(res.body.complete,false);assert.equal(res.body.coverageWarning,PARTIAL_LISTING_WARNING);assert.deepEqual(h.listingRequests,['*20261017*']);
    h.setEntries([]);const empty=await h.call({action:'search',...search});assert.equal(empty.body.complete,false);assert.equal(empty.body.matches.length,0);assert.ok(empty.body.coverageWarning);
  } finally {process.env.NORTHPORT_FTP_LISTING_MODE='full';}
});
test('date discovery covers Malaysia midnight and up to three dates, deduplicates metadata, and never falls back to full listing',async()=>{
  process.env.NORTHPORT_FTP_LISTING_MODE='date-pattern';
  const requests:string[]=[];const ftp:any={list:async(pattern:string)=>{requests.push(pattern);return [{name:gpName,isFile:true,size:gp.length}];}};
  try {
    const result=await searchFiles(ftp,searchInput({...search,timestamp:'2026-10-17T00:02:00'}));assert.deepEqual(requests,['*20261016*','*20261017*']);assert.equal(result.files.length,1);
    requests.length=0;await searchFiles(ftp,searchInput({...search,before:1440,after:1440}));assert.deepEqual(requests,['*20261016*','*20261017*','*20261018*']);
    ftp.list=async()=>{throw new Error('Listing failed');};await assert.rejects(()=>searchFiles(ftp,searchInput(search)),/Listing failed/);
    process.env.NORTHPORT_FTP_LISTING_MODE='unrecognized';await assert.rejects(()=>searchFiles(ftp,searchInput(search)),/listing mode/);
  } finally {process.env.NORTHPORT_FTP_LISTING_MODE='full';}
});
test('search downloads only timestamp candidates, filters GP/EX and matches UNIT exactly',async()=>{
  const h=harness();const res=await h.call({action:'search',...search});assert.equal(res.code,200);assert.equal(res.body.matches.length,1);assert.equal(res.body.matches[0].record,1);assert.equal(res.body.candidates,2);assert.ok(!h.downloads.some(n=>n.includes('20261015')));
  const filtered=await h.call({action:'search',...search,type:'EX'});assert.deepEqual(filtered.body.matches,[]);
  assert.equal((await h.call({action:'search',...search,unit:'MSBU417935'})).body.matches.length,0);
  const boundary=await h.call({action:'search',...search,timestamp:'2026-10-17T01:20:16',before:0,after:0});assert.equal(boundary.body.matches.length,1);
});
test('whole-file download returns the exact original CSV and rejects changed or unauthorized sources',async()=>{
  const h=harness();const found=await h.call({action:'search',...search});const token=found.body.matches[0].token;
  const result=await h.call({action:'download-source',token});
  assert.equal(result.code,200);assert.deepEqual(result.body,gp);
  assert.equal(result.headers['Content-Type'],'text/csv; charset=utf-8');
  assert.equal(result.headers['Content-Disposition'],`attachment; filename="${gpName}"`);
  assert.equal(parseCsv(result.body).rows.length,3);
  h.setSource(ex);assert.equal((await h.call({action:'download-source',token})).code,409);
  h.setSession({id:'other',email:'other@example.test',type:'ADMIN'});
  assert.equal((await h.call({action:'download-source',token})).code,400);
  assert.equal((await h.call({action:'download-source',token:token+'x'})).code,400);
});
test('multiple exact matches are all returned, malformed source blocks recovery for that file',async()=>{
  const h=harness();const csv=parseCsv(gp);h.setSource(Buffer.from(NORTHPORT_COLUMNS.join(',')+'\r\n'+csv.rows[0].join(',')+'\r\n'+csv.rows[0].join(',')+'\r\n'));
  assert.equal((await h.call({action:'search',...search})).body.matches.length,2);
  h.setSource(Buffer.from('UNIT,UNKNOWN\r\nA,B'));const res=await h.call({action:'search',...search});assert.equal(res.body.matches.length,0);assert.equal(res.body.complete,false);assert.equal(res.body.errors.length,1);
});
test('candidate limits reject before downloading; connection errors are surfaced',async()=>{
  const h=harness();h.setEntries(Array(41).fill({name:gpName,isFile:true,size:1}));assert.equal((await h.call({action:'search',...search})).code,400);assert.equal(h.downloads.length,0);
  h.setFtpError();assert.equal((await h.call({action:'search',...search})).code,502);
});
test('backend checks authentication, role revocation, CSRF, size limits, and shared rate limit before FTP',async()=>{
  const h=harness();h.setSession(null);assert.equal((await h.call({action:'check'})).code,401);
  h.setSession({id:'x',email:'x',type:'COMPANY_ADMIN'});assert.equal((await h.call({action:'check'})).code,401);
  h.setSession({id:'admin',email:'x',type:'ADMIN'});h.setProfile(null);assert.equal((await h.call({action:'check'})).code,403);h.setProfile({id:'a'});
  assert.equal((await h.call({action:'check'},{headers:{origin:'https://evil.test'}})).code,403);
  assert.equal((await h.call({action:'check',huge:'x'.repeat(64001)})).code,413);
  h.setRate(false);assert.equal((await h.call({action:'check'})).code,429);assert.equal(h.downloads.length,0);
});
async function approval(h:ReturnType<typeof harness>) {
  const searchResult=await h.call({action:'search',...search});const match=searchResult.body.matches[0];
  return {token:match.token,values:match.values,approved:true,identityConfirmed:false};
}
test('signed source, explicit approval, identity confirmation, and duplicate approval protection',async()=>{
  const h=harness();const p=await approval(h);
  assert.equal((await h.call({action:'approve',...p,token:p.token+'x'})).code,400);
  assert.equal((await h.call({action:'approve',...p,approved:false})).code,400);
  const edited=[...p.values];edited[0]='OTHER123';assert.equal((await h.call({action:'approve',...p,values:edited})).code,400);
  h.setApprove({id:'approval',status:'Approved'});const res=await h.call({action:'approve',...p});assert.equal(res.code,200);assert.equal(parseCsv(Buffer.from(res.body.preview)).rows.length,1);assert.equal(h.uploaded,false);
  h.setApprove(null);assert.equal((await h.call({action:'approve',...p})).code,409);
  h.setSession({id:'other',email:'other',type:'ADMIN'});assert.equal((await h.call({action:'approve',...p})).code,400);
});
test('production uploads disabled, even after approval; no FTP write attempted',async()=>{
  const h=harness();const p=await approval(h);const res=await h.call({action:'upload',...p,id:'00000000-0000-4000-8000-000000000001'});assert.equal(res.code,403);assert.equal(h.uploaded,false);
});
test('source mutation, duplicate claims and interrupted upload never yield success or retry',async()=>{
  const h=harness();const p=await approval(h);
  const gates=['READONLY_VERIFIED','SINGLE_RECORD_VERIFIED','FILENAME_VERIFIED','SERIALIZATION_VERIFIED','NON_NORTHPORT_VERIFIED','DUPLICATES_VERIFIED','RENAME_NO_REPLACE_VERIFIED','TIMEZONE_VERIFIED'];
  process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='true';for(const gate of gates)process.env['NORTHPORT_'+gate]='true';
  try {
    const req={action:'upload',...p,id:'00000000-0000-4000-8000-000000000001'};
    h.setSource(ex);assert.equal((await h.call(req)).code,409);assert.equal(h.uploaded,false);
    h.setSource(gp);assert.equal((await h.call(req)).code,409);
    h.setClaim({recovery_filename:'CM_CONTAINER_20261017012100_GP.csv'});
    const failed=await h.call(req);assert.equal(failed.code,502);assert.equal(h.updates.at(-1).status,'Failed');
  } finally {process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='false';for(const gate of gates)delete process.env['NORTHPORT_'+gate];}
});
test('scheduler uses existing integration and records trigger separately from import; failures do not claim import',async()=>{
  const h=harness();const res=await h.call({action:'scheduler',id:'id'});assert.equal(res.body.status,'Scheduler Triggered');assert.equal(res.body.processingResult,'Verification Unavailable');assert.equal(h.schedulerCalls,1);
  h.setSchedulerFailure();assert.equal((await h.call({action:'scheduler',id:'other'})).code,502);assert.equal(h.updates.at(-1).scheduler_status,'failed');
  h.setSchedulerClaim(false);assert.equal((await h.call({action:'scheduler',id:'id'})).code,409);assert.equal(h.schedulerCalls,2);
});
test('safe upload uses temporary transfer, size check, collision check and final rename only',async()=>{
  const events:string[]=[];const bytes=Buffer.from('approved');let collision=false;
  const ftp:any={list:async()=>collision?[{name:gpName}]:[],uploadFrom:async(_stream:any,name:string)=>events.push(name),size:async()=>bytes.length,rename:async(from:string,to:string)=>events.push(from+' -> '+to)};
  const id='00000000-0000-4000-8000-000000000001';await safeUpload(ftp,gpName,id,bytes);assert.deepEqual(events,[`.northport-${id}.part`,`.northport-${id}.part -> ${gpName}`]);
  collision=true;await assert.rejects(()=>safeUpload(ftp,gpName,id,bytes),/collision/);assert.equal(events.length,2);
  collision=false;ftp.rename=async()=>{throw new Error('rename refused');};await assert.rejects(()=>safeUpload(ftp,gpName,id,bytes),/rename refused/);
  await assert.rejects(()=>safeUpload(ftp,'../x.csv',id,bytes));
});
test('FTP configuration never downgrades TLS and connection errors always close',async()=>{
  process.env.NORTHPORT_FTP_PASSWORD='test-only';process.env.NORTHPORT_FTP_SECURE='true';
  let closed=0;const ftp:any={access:async(options:any)=>{assert.equal(options.secure,true);throw {code:530};},close:()=>closed++};
  try {
    await assert.rejects(()=>withFtp(async()=>null,undefined,()=>ftp),/login failed/);assert.equal(closed,1);
    process.env.NORTHPORT_FTP_SECURE='false';process.env.NORTHPORT_FTP_ALLOW_PLAINTEXT='false';assert.throws(()=>ftpConfig(),/Plain FTP/);
    process.env.NORTHPORT_FTP_SECURE='bad';assert.throws(()=>ftpConfig(),/TLS/);
  } finally {delete process.env.NORTHPORT_FTP_PASSWORD;delete process.env.NORTHPORT_FTP_SECURE;delete process.env.NORTHPORT_FTP_ALLOW_PLAINTEXT;}
});
test('download stops at the file memory limit',async()=>{
  const ftp:any={downloadTo:async(stream:any)=>{await new Promise((resolve,reject)=>{stream.on('error',reject);stream.end(Buffer.alloc(MAX_FILE+1),resolve);});}};
  await assert.rejects(()=>download(ftp,gpName),/limit/);
});

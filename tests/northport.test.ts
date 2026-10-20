import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { NORTHPORT_COLUMNS } from '../src/types/northport.js';
import { filenameInfo, malaysiaTime, localTime, searchInput, parseCsv, generateCsv, prepareReprocessFile, validateValues, MAX_FILE, RecoveryError } from '../server-handlers/northport/format.js';
import { ftpConfig, withFtp, safeUpload, download } from '../server-handlers/northport/ftp.js';
import { createNorthportHandler } from '../server-handlers/northport/handler.js';
import { recoveryFlow } from '../src/services/northportRecoveryStatus.js';
import type { Recovery } from '../src/types/northport.js';
import { searchFiles, PARTIAL_LISTING_WARNING } from '../server-handlers/northport/listing.js';
import { containsContainerText, signFileSource, signEditorSource, verifyEditorSource } from '../server-handlers/northport/inspection.js';

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
  const directories:string[]=[];const downloads:string[]=[];const updates:any[]=[];const rpcCalls:{name:string;args:any}[]=[];let approve:any=null;let claim:any=null;let claimError=false;let uploadFailure=false;let uploadedBytes:Buffer|null=null;let uploadedName='';let schedulerClaim=true;let rate=true;let ftpError=false;let source=gp;let schedulerFailure=false;let schedulerCalls=0;let uploaded=false;
  const listingRequests:(string|undefined)[]=[];
  let sizeLookup=async(_name:string)=>1;
  const ftp={pwd:async()=>'/account',cd:async(path:string)=>{directories.push(path);},list:async(pattern?:string)=>{listingRequests.push(pattern);return entries;},downloadTo:async(stream:any,name:string)=>{downloads.push(name);stream.end(name===exName?ex:source);},uploadFrom:async(stream:any)=>{uploaded=true;if(uploadFailure)throw new RecoveryError('Transfer interrupted',502);const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));uploadedBytes=Buffer.concat(chunks);},size:async(name:string)=>name.endsWith('.part')&&uploadedBytes?uploadedBytes.length:sizeLookup(name),rename:async(_from:string,to:string)=>{uploadedName=to;}};
  const client={from(){const query:any={select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},timeout(){return this;},update(value:any){updates.push(value);return this;},async maybeSingle(){return {data:profile,error:null};},then(resolve:any){return Promise.resolve({data:[],error:null}).then(resolve);}};return query;},async rpc(name:string,args:any){rpcCalls.push({name,args});return {error:name==='northport_claim_file_upload'&&claimError?{message:'Missing function'}:null,data:name==='northport_admit_request'?rate:name==='northport_approve'?approve:name==='northport_claim_file_upload'?claim:name==='northport_claim_scheduler'||name==='northport_cancel_approved'?schedulerClaim:name==='northport_record_cancelled'?{id:'cancelled-attempt',status:'Cancelled'}:null};}};
  const handler=createNorthportHandler({adminClient:()=>client as any,readSession:()=>session,withFtp:async(operation:any)=>{if(ftpError)throw new RecoveryError('FTP operation failed',502);return operation(ftp,{base:'/incoming',success:'/incoming/SUCCESS',access:{secure:true}});},runScheduler:async(_req:any,res:any)=>{schedulerCalls++;res.status(schedulerFailure?502:200).json({status:schedulerFailure?'failed':'trigger_requested',message:'Test result',executionId:'run-test'});}} as any);
  const call=async(payload:any,overrides:any={})=>{const response:any={code:200,body:null,headers:{} as Record<string,string>,setHeader(name:string,value:string){this.headers[name]=value;},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;},send(body:any){this.body=body;return this;}};await handler({method:'POST',headers:{origin:'https://portal.example.test','x-cargomove-confirm':'northport-recovery'},body:payload,...overrides},response);return response;};
  return {call,directories,downloads,updates,rpcCalls,listingRequests,setSize:(fn:typeof sizeLookup)=>sizeLookup=fn,get uploaded(){return uploaded;},get uploadedBytes(){return uploadedBytes;},get uploadedName(){return uploadedName;},get schedulerCalls(){return schedulerCalls;},setSession:(v:any)=>session=v,setProfile:(v:any)=>profile=v,setEntries:(v:any)=>entries=v,setRate:(v:boolean)=>rate=v,setFtpError:()=>ftpError=true,setSource:(v:Buffer)=>source=v,setApprove:(v:any)=>approve=v,setClaim:(v:any)=>claim=v,setClaimError:()=>claimError=true,setUploadFailure:()=>uploadFailure=true,setSchedulerFailure:()=>schedulerFailure=true,setSchedulerClaim:(v:boolean)=>schedulerClaim=v};
}

test('search modes default to Basic Scan and never search incoming or silently change type and time',async()=>{
  assert.equal(searchInput(search).mode,'standard');
  for(const mode of [null,'deep',{},1]) assert.throws(()=>searchInput({...search,mode}),/search mode/);
  for(const mode of ['standard','files','content']) {
    const h=harness();const result=await h.call({action:'search',...search,type:'GP',sourceFilename:gpName,mode});
    assert.equal(result.code,200);assert.equal(result.body.mode,mode);assert.equal(result.body.start,'2026-10-17T01:15:00');assert.equal(result.body.end,'2026-10-17T01:50:00');
    assert.deepEqual(h.directories,['/incoming/SUCCESS']);assert.deepEqual(h.downloads,[gpName]);
    assert.equal(result.body.scannedFiles.length,mode==='standard'?0:1);
    assert.equal(h.uploaded,false);assert.equal(h.schedulerCalls,0);
  }
});

test('Advanced Scan lists matches and nonmatches and bypasses incomplete listings across batches',async()=>{
  const h=harness();process.env.NORTHPORT_FTP_LISTING_MODE='date-pattern';
  const lastName='CM_CONTAINER_20261017012500_GP.csv';
  h.setSize(async name=>{if([gpName,lastName].includes(name))return gp.length;throw Object.assign(new Error('550 No such file or directory'),{code:550});});
  const input={action:'search',...search,type:'GP',timestamp:'2026-10-17T01:15:00',before:0,after:10,mode:'files'};
  try {
    const first=await h.call(input);assert.equal(first.code,200);assert.ok(first.body.nextCursor);assert.equal(first.body.scannedFiles[0].status,'match');assert.equal(first.body.scannedFiles[0].matches,1);
    assert.equal((await h.call({...input,mode:'content',cursor:first.body.nextCursor})).code,400);
    const last=await h.call({...input,cursor:first.body.nextCursor});assert.equal(last.body.complete,true);assert.equal(last.body.nextCursor,null);assert.equal(last.body.scannedFiles[0].filename,lastName);assert.equal(last.body.progress.files,2);
    assert.deepEqual(h.listingRequests,[]);assert.deepEqual(h.directories,['/incoming/SUCCESS','/incoming/SUCCESS']);
    const noMatch=await h.call({...input,sourceFilename:gpName,unit:'OTHER123'});assert.equal(noMatch.body.scannedFiles[0].status,'no-match');assert.equal(noMatch.body.scannedFiles[0].records,3);
  } finally {process.env.NORTHPORT_FTP_LISTING_MODE='full';}
});

test('Deep Scan finds invalid-file text and non-UNIT occurrences without issuing recovery tokens',async()=>{
  const h=harness();const input={action:'search',...search,type:'GP',sourceFilename:gpName};
  const invalid=Buffer.from('UNIT,WRONG\r\nmsbu4179350,"broken');h.setSource(invalid);
  const deep=await h.call({...input,mode:'files'});assert.equal(deep.body.scannedFiles[0].status,'invalid');
  const ultra=await h.call({...input,mode:'content'});assert.equal(ultra.body.complete,false);assert.equal(ultra.body.errors.length,1);assert.deepEqual(ultra.body.matches,[]);assert.equal(ultra.body.scannedFiles[0].status,'content-match');
  const token=ultra.body.scannedFiles[0].token;
  const downloaded=await h.call({action:'download-file',token});assert.equal(downloaded.code,200);assert.deepEqual(downloaded.body,invalid);assert.equal(downloaded.headers['Content-Type'],'application/octet-stream');
  assert.equal((await h.call({action:'approve',token,values:parseCsv(gp).rows[0],approved:true})).code,400);
  assert.equal((await h.call({action:'download-source',token})).code,400);
  assert.equal((await h.call({action:'download-file',token:token+'x'})).code,400);
  h.setSession({id:'other',email:'other@example.test',type:'ADMIN'});assert.equal((await h.call({action:'download-file',token})).code,400);
  h.setSession({id:'admin',email:'admin@example.test',type:'ADMIN'});h.setSource(gp);assert.equal((await h.call({action:'download-file',token})).code,409);
  const values=parseCsv(gp).rows[0];values[0]='OTHER123';values[3]='MSBU4179350';h.setSource(generateCsv(values,{bom:false,newline:'\r\n',quoteAll:false}));
  const contentOnly=await h.call({...input,mode:'content'});assert.equal(contentOnly.body.complete,true);assert.deepEqual(contentOnly.body.matches,[]);assert.equal(contentOnly.body.scannedFiles[0].status,'content-match');assert.equal(contentOnly.body.scannedFiles[0].error,undefined);
  assert.equal(h.uploaded,false);assert.equal(h.schedulerCalls,0);
});

test('raw text checks respect container boundaries, case and BOM-marked UTF-16',()=>{
  for(const bytes of [Buffer.from('"msbu4179350",data'),Buffer.from('\ufeffUNIT\r\nMSBU4179350','utf16le')])assert.equal(containsContainerText(bytes,'MSBU4179350'),true);
  const be=Buffer.from('\ufeffUNIT\r\nMSBU4179350','utf16le');be.swap16();assert.equal(containsContainerText(be,'MSBU4179350'),true);
  for(const text of ['MSBU41793500','XMSBU4179350','MSBU417935','MSBU 4179350'])assert.equal(containsContainerText(Buffer.from(text),'MSBU4179350'),false);
});
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
test('container browsing lists every source record and enforces source integrity and ownership',async()=>{
  const h=harness();
  const found=await h.call({action:'search',...search});
  const match=found.body.matches[0];
  const expected=parseCsv(gp).rows.map((row,index)=>({container:row[0],record:index+1,number:row[1],fullEmpty:row[7]}));
  for(const [kind,token] of [['record',match.token],['file',match.fileToken]]) {
    const result=await h.call({action:'list-containers',kind,token});
    assert.equal(result.code,200);assert.deepEqual(result.body,{filename:gpName,containers:expected});
    assert.equal((await h.call({action:'list-containers',kind,token:token+'x'})).code,400);
  }
  const exportResult=await h.call({action:'search',...search,type:'EX',sourceFilename:exName,unit:parseCsv(ex).rows[0][0]});
  const exportContainers=await h.call({action:'list-containers',kind:'file',token:exportResult.body.matches[0].fileToken});
  assert.equal(exportContainers.code,200);
  assert.deepEqual(exportContainers.body.containers,parseCsv(ex).rows.map((row,index)=>({container:row[0],record:index+1,number:row[2],fullEmpty:row[7]})));
  h.setRate(false);assert.equal((await h.call({action:'list-containers',kind:'record',token:match.token})).code,429);h.setRate(true);
  h.setSource(ex);assert.equal((await h.call({action:'list-containers',kind:'record',token:match.token})).code,409);
  h.setSession({id:'other',email:'other@example.test',type:'ADMIN'});
  assert.equal((await h.call({action:'list-containers',kind:'file',token:match.fileToken})).code,400);
  h.setSession({id:'admin',email:'admin@example.test',type:'ADMIN'});
  h.setSource(Buffer.from('invalid csv'));
  const invalid=await h.call({action:'search',...search,type:'GP',sourceFilename:gpName,mode:'files'});
  assert.equal((await h.call({action:'list-containers',kind:'file',token:invalid.body.scannedFiles[0].token})).code,400);
  assert.equal(h.uploaded,false);assert.equal(h.schedulerCalls,0);assert.equal(h.updates.length,0);
});

test('editor pagination exposes validated rows and binds exports and approvals to the selected source record',async()=>{
  const h=harness();
  const found=await h.call({action:'search',...search,unit:'TXGU4841312'});
  const match=found.body.matches[0];
  const original=parseCsv(gp).rows;
  const loaded=await h.call({action:'editor-records',kind:'record',token:match.token});
  assert.equal(loaded.code,200);assert.deepEqual(loaded.body.rows,original);
  assert.equal((await h.call({action:'editor-records',kind:'file',token:match.fileToken})).code,200);
  const token=loaded.body.editorToken;
  const values=[...original[2]];values[4]='EDITED';
  const payload={sourceKind:'editor',record:3,token,values,approved:true,identityConfirmed:false};
  const exported=await h.call({action:'download-reprocess',...payload});
  assert.equal(exported.code,200);
  assert.deepEqual(parseCsv(exported.body).rows,[original[0],original[1],values]);
  assert.equal(exported.headers['Content-Disposition'],`attachment; filename="REPROCESS_${values[0]}.csv"`);
  h.setApprove({id:'approval',status:'Approved'});
  assert.equal((await h.call({action:'approve',...payload})).code,200);
  const saved=h.rpcCalls.find(call=>call.name==='northport_approve')!;
  assert.equal(saved.args.p_record,3);assert.equal(saved.args.p_container,values[0]);assert.deepEqual(saved.args.p_changed,['SRV']);
  const identity=[...values];identity[1]='CHANGED';
  assert.equal((await h.call({action:'approve',...payload,values:identity})).code,400,'Other identity changes still require confirmation');
  for(const record of [0,-1,1.5,4,'1'])assert.equal((await h.call({action:'download-reprocess',...payload,record})).code,400);
  assert.equal((await h.call({action:'download-reprocess',...payload,token:match.fileToken})).code,400,'Inspection tokens cannot authorize editing');
  assert.equal((await h.call({action:'download-reprocess',...payload,token:token+'x'})).code,400);
  const expired=signEditorSource({...verifyEditorSource(token,'admin'),expires:Date.now()-1});
  assert.equal((await h.call({action:'download-reprocess',...payload,token:expired})).code,400);
  h.setSession({id:'other',email:'other@example.test',type:'ADMIN'});
  assert.equal((await h.call({action:'download-reprocess',...payload})).code,400);
  h.setSession({id:'admin',email:'admin@example.test',type:'ADMIN'});
  h.setSource(ex);assert.equal((await h.call({action:'download-reprocess',...payload})).code,409);
  assert.equal(h.uploaded,false);assert.equal(h.schedulerCalls,0);
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
test('cancellation records the signed source without approval, upload or scheduler dispatch',async()=>{
  const h=harness();const source=await approval(h);
  const changed=[...source.values];changed[0]='UNTRUSTED123';
  const result=await h.call({action:'cancel',...source,values:changed,approved:false});
  assert.equal(result.body.status,'Cancelled');
  assert.equal(h.rpcCalls.find(call=>call.name==='northport_record_cancelled')?.args.p_container,source.values[0]);
  assert.equal(h.uploaded,false);assert.equal(h.schedulerCalls,0);
  assert.equal(h.rpcCalls.some(call=>call.name==='northport_approve'||call.name==='northport_claim_file_upload'),false);
  assert.equal((await h.call({action:'cancel',...source,token:source.token+'x'})).code,400);
  const id='10000000-0000-4000-8000-000000000001';
  assert.equal((await h.call({action:'cancel-approved',id})).body.status,'Cancelled');
  h.setSchedulerClaim(false);
  assert.equal((await h.call({action:'cancel-approved',id})).code,409);
});
test('signed source, explicit approval, identity confirmation, and duplicate approval protection',async()=>{
  const h=harness();const p=await approval(h);
  assert.equal((await h.call({action:'approve',...p,token:p.token+'x'})).code,400);
  assert.equal((await h.call({action:'approve',...p,approved:false})).code,400);
  const edited=[...p.values];edited[0]='OTHER123';assert.equal((await h.call({action:'approve',...p,values:edited})).code,400);
  h.setApprove({id:'approval',status:'Approved'});const res=await h.call({action:'approve',...p});assert.equal(res.code,200);assert.equal(parseCsv(Buffer.from(res.body.preview)).rows.length,3);assert.equal(h.uploaded,false);
  h.setApprove(null);assert.equal((await h.call({action:'approve',...p})).code,409);
  h.setSession({id:'other',email:'other',type:'ADMIN'});assert.equal((await h.call({action:'approve',...p})).code,400);
});

test('approval retains validated original search settings with the selected recovery type and container',async()=>{
  const h=harness();const source=await approval(h);h.setApprove({id:'approval',status:'Approved'});
  const setup={unit:'OTHER123',timestamp:search.timestamp,type:'ALL',before:5,after:30,sourceFilename:'',mode:'standard'};
  assert.equal((await h.call({action:'approve',...source,searchSetup:setup})).code,200);
  assert.deepEqual(h.updates.at(-1).search_setup,{...setup,unit:source.values[0],type:'GP'});
  const before=h.rpcCalls.filter(call=>call.name==='northport_approve').length;
  assert.equal((await h.call({action:'approve',...source,searchSetup:{...setup,before:-1}})).code,400);
  assert.equal(h.rpcCalls.filter(call=>call.name==='northport_approve').length,before,'Invalid settings cannot create an approval');
});
test('production uploads disabled, even after approval; no FTP write attempted',async()=>{
  const h=harness();const p=await approval(h);const res=await h.call({action:'upload',...p,id:'00000000-0000-4000-8000-000000000001'});assert.equal(res.code,403);assert.equal(h.uploaded,false);
});

test('whole-file export and upload retain every other record and apply only selected-row edits',async()=>{
  const h=harness();
  const found=await h.call({action:'search',...search,unit:'TXGU4841312'});const match=found.body.matches[0];
  assert.equal(match.record,2);assert.equal(match.totalRecords,3);
  const values=[...match.values];values[3]='REVIEWED,"BL"';
  const payload={token:match.token,values,approved:true,identityConfirmed:true};
  const exported=await h.call({action:'download-reprocess',...payload});assert.equal(exported.code,200);assert.equal(exported.headers['Content-Disposition'],'attachment; filename="REPROCESS_TXGU4841312.csv"');
  const expected=parseCsv(gp).rows;expected[1]=values;assert.deepEqual(parseCsv(exported.body).rows,expected);
  const before=gp.toString('utf8').split('\r\r\n');const after=exported.body.toString('utf8').split('\r\r\n');
  assert.equal(after[0],before[0]);assert.equal(after[1],before[1]);assert.equal(after[3],before[3]);
  assert.equal(h.rpcCalls.filter(call=>call.name!=='northport_admit_request').length,0,'Export must not create approvals or claims');
  const id='00000000-0000-4000-8000-000000000001';h.setApprove({id,status:'Approved'});
  const approved=await h.call({action:'approve',...payload});assert.equal(approved.code,200);assert.equal(approved.body.records,3);assert.equal(approved.body.filename,'REPROCESS_TXGU4841312.csv');assert.equal(approved.body.preview,exported.body.toString('utf8'));
  const approvalCall=h.rpcCalls.find(call=>call.name==='northport_approve')!;
  const sibling=await approval(h);await h.call({action:'approve',...sibling});
  const siblingCall=h.rpcCalls.filter(call=>call.name==='northport_approve').at(-1)!;
  assert.equal(approvalCall.args.p_source_key,siblingCall.args.p_source_key,'All selected records in one source share a whole-file deduplication key');
  const gates=['READONLY_VERIFIED','SINGLE_RECORD_VERIFIED','FILENAME_VERIFIED','SERIALIZATION_VERIFIED','NON_NORTHPORT_VERIFIED','DUPLICATES_VERIFIED','RENAME_NO_REPLACE_VERIFIED','TIMEZONE_VERIFIED'];
  process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='true';for(const gate of gates)process.env['NORTHPORT_'+gate]='true';
  try {
    h.setClaim({recovery_filename:approved.body.filename});
    const uploaded=await h.call({action:'upload',...payload,id});assert.equal(uploaded.code,200);assert.deepEqual(h.uploadedBytes,exported.body);assert.equal(h.uploadedName,'REPROCESS_TXGU4841312.csv');
    const claimed=h.rpcCalls.find(call=>call.name==='northport_claim_file_upload')!;assert.equal(claimed.args.p_hash,approvalCall.args.p_hash);assert.equal(claimed.args.p_source_key,approvalCall.args.p_source_key);
    assert.equal(h.schedulerCalls,0,'Upload alone does not dispatch a scheduler');
    const missing=harness();const source=await approval(missing);missing.setClaimError();process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='true';
    const unavailable=await missing.call({action:'upload',...source,id});assert.equal(unavailable.code,503);assert.match(unavailable.body.error,/migration/);assert.equal(missing.uploaded,false);
  } finally {process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='false';for(const gate of gates)delete process.env['NORTHPORT_'+gate];}
});

test('whole-file editing preserves source bytes without changes and sibling quoting, BOM and blank lines with edits',()=>{
  for(const format of [{bom:false,newline:'\r\n',quoteAll:false},{bom:true,newline:'\n',quoteAll:true},{bom:false,newline:'\r\r\n',quoteAll:false}]) {
    const original=parseCsv(gp).rows;const header=generateCsv(original[0],format).toString('utf8').split(format.newline)[0];
    const row=(values:string[])=>generateCsv(values,{...format,bom:false}).toString('utf8').split(format.newline)[1];
    const bytes=Buffer.from([header,'',...original.map(row),'',''].join(format.newline));
    assert.deepEqual(prepareReprocessFile(bytes,2,original[1],original[1]).bytes,bytes);
    const edited=[...original[1]];edited[3]='comma,"quote"';const result=prepareReprocessFile(bytes,2,original[1],edited);
    const lines=bytes.toString('utf8').split(format.newline);lines[3]=row(edited);assert.deepEqual(result.bytes,Buffer.from(lines.join(format.newline)));assert.equal(result.records,3);
    assert.throws(()=>prepareReprocessFile(bytes,1,original[1],edited),/changed/);assert.throws(()=>prepareReprocessFile(bytes,0,original[0],edited),/changed/);
  }
});

test('Download all returns exact original files once, and rejects expired, changed or unauthorized selections',async()=>{
  const h=harness();const found=await h.call({action:'search',...search});const match=found.body.matches[0];
  const fileSearch=await h.call({action:'search',...search,sourceFilename:exName,mode:'files'});
  const files=[{kind:'record',token:match.token},{kind:'file',token:match.fileToken},{kind:'file',token:fileSearch.body.scannedFiles[0].token}];
  const archived=await h.call({action:'download-all',files});assert.equal(archived.code,200);assert.equal(archived.headers['Content-Type'],'application/zip');
  const extracted=unzipSync(archived.body);assert.deepEqual(Object.keys(extracted),[gpName,exName]);assert.deepEqual(Buffer.from(extracted[gpName]),gp);assert.deepEqual(Buffer.from(extracted[exName]),ex);
  assert.deepEqual(h.downloads.slice(-2),[gpName,exName]);
  const count=h.downloads.length;
  const expired=signFileSource({actor:'admin',filename:gpName,digest:'a'.repeat(64),expires:1});
  for(const selection of [[],Array(41).fill(files[0]),[{kind:'file',token:'tampered'}],[{kind:'file',token:expired}],[files[0],{kind:'unknown',token:match.token}]])assert.equal((await h.call({action:'download-all',files:selection})).code,400);
  h.setSession({id:'other',email:'other@example.test',type:'ADMIN'});assert.equal((await h.call({action:'download-all',files})).code,400);assert.equal(h.downloads.length,count);
  h.setSession({id:'admin',email:'admin@example.test',type:'ADMIN'});h.setSource(ex);assert.equal((await h.call({action:'download-all',files})).code,409);assert.equal(h.uploaded,false);assert.equal(h.schedulerCalls,0);
});
test('source mutation, duplicate claims and interrupted upload never yield success or retry',async()=>{
  const h=harness();const p=await approval(h);
  const gates=['READONLY_VERIFIED','SINGLE_RECORD_VERIFIED','FILENAME_VERIFIED','SERIALIZATION_VERIFIED','NON_NORTHPORT_VERIFIED','DUPLICATES_VERIFIED','RENAME_NO_REPLACE_VERIFIED','TIMEZONE_VERIFIED'];
  process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='true';for(const gate of gates)process.env['NORTHPORT_'+gate]='true';
  try {
    const req={action:'upload',...p,id:'00000000-0000-4000-8000-000000000001'};
    h.setSource(ex);assert.equal((await h.call(req)).code,409);assert.equal(h.uploaded,false);
    h.setSource(gp);assert.equal((await h.call(req)).code,409);
    h.setClaim({recovery_filename:'REPROCESS_MSBU4179350.csv'});h.setUploadFailure();
    const failed=await h.call(req);assert.equal(failed.code,502);assert.equal(h.updates.at(-1).status,'Failed');
  } finally {process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='false';for(const gate of gates)delete process.env['NORTHPORT_'+gate];}
});
test('scheduler uses existing integration and records trigger separately from import; failures do not claim import',async()=>{
  const h=harness();const res=await h.call({action:'scheduler',id:'id'});assert.equal(res.body.status,'Scheduler Triggered');assert.equal(res.body.processingResult,'Verification Unavailable');assert.equal(h.schedulerCalls,1);
  h.setSchedulerFailure();assert.equal((await h.call({action:'scheduler',id:'other'})).code,502);assert.equal(h.updates.at(-1).scheduler_status,'failed');
  h.setSchedulerClaim(false);assert.equal((await h.call({action:'scheduler',id:'id'})).code,409);assert.equal(h.schedulerCalls,2);
});
test('resume restores approved edits, verifies the original whole file, and never uploads during preparation',async()=>{
  const h=harness();
  const payload=await approval(h);
  payload.values[3]='APPROVED-EDIT';
  payload.identityConfirmed=true;
  const id='00000000-0000-4000-8000-000000000001';
  h.setApprove({id,status:'Approved'});
  assert.equal((await h.call({action:'approve',...payload})).code,200);
  assert.deepEqual(h.updates.at(-1).approved_values,payload.values);
  const audit=h.rpcCalls.find(call=>call.name==='northport_approve')!.args;
  const recovery={id,actor:'admin',status:'Approved',source_filename:gpName,source_record:audit.p_record,source_key:audit.p_source_key,approved_hash:audit.p_hash,changed_fields:['BLNO'],approved_values:payload.values};
  h.setProfile(recovery);
  const gates=['READONLY_VERIFIED','SINGLE_RECORD_VERIFIED','FILENAME_VERIFIED','SERIALIZATION_VERIFIED','NON_NORTHPORT_VERIFIED','DUPLICATES_VERIFIED','RENAME_NO_REPLACE_VERIFIED','TIMEZONE_VERIFIED'];
  assert.equal((await h.call({action:'resume-approved',id})).code,403);
  process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='true';for(const gate of gates)process.env['NORTHPORT_'+gate]='true';
  try {
    const resumed=await h.call({action:'resume-approved',id});assert.equal(resumed.code,200);assert.deepEqual(resumed.body.values,payload.values);assert.equal(resumed.body.id,id);assert.equal(resumed.body.approved,true);
    h.setClaim({recovery_filename:'REPROCESS_MSBU4179350.csv'});
    const uploaded=await h.call({action:'upload',...resumed.body});assert.equal(uploaded.code,200);
    assert.equal(parseCsv(h.uploadedBytes!).rows[0][3],'APPROVED-EDIT');assert.equal(h.schedulerCalls,0);
    for(const state of ['Uploading','Uploaded','Failed','Scheduler Triggered']) {h.setProfile({...recovery,status:state});assert.equal((await h.call({action:'resume-approved',id})).code,409);}
    h.setProfile({...recovery,actor:'other'});assert.equal((await h.call({action:'resume-approved',id})).code,409);
    h.setProfile({...recovery,approved_values:null});assert.equal((await h.call({action:'resume-approved',id})).code,409);
    h.setProfile({...recovery,approved_hash:'tampered'});assert.equal((await h.call({action:'resume-approved',id})).code,409);
    h.setProfile(recovery);h.setSource(ex);assert.equal((await h.call({action:'resume-approved',id})).code,409);
    assert.equal(h.schedulerCalls,0);
  } finally {process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED='false';for(const gate of gates)delete process.env['NORTHPORT_'+gate];}
});
test('recovery flow distinguishes upload, request acceptance and uncertain outcomes without claiming import',()=>{
  const base={status:'Approved'} as Recovery;
  assert.equal(recoveryFlow(base).step,1);
  assert.equal(recoveryFlow({...base,status:'Uploaded'}).step,2);
  const requested=recoveryFlow({...base,status:'Scheduler Triggered',scheduler_status:'trigger_requested'});
  assert.equal(requested.step,3);assert.equal(requested.tone,'blue');assert.match(requested.description,/not verified yet/);
  assert.equal(recoveryFlow({...base,status:'Failed'}).tone,'red');
  assert.equal(recoveryFlow({...base,status:'Verification Unavailable',scheduler_status:'failed'}).step,2);
  assert.equal(recoveryFlow({...base,status:'unexpected'}).step,0);
});

test('history labels distinguish GP results, EX scheduler evidence, active requests and cancellation',()=>{
  const base={status:'Uploaded',container_type:'GP'} as Recovery;
  const evidence={status:'VERIFIED',gatepass:'GP123',container:'MSBU4179350',updatedAt:null,updatedWithinTolerance:null,observedAt:new Date().toISOString(),toleranceSeconds:120} as const;
  assert.equal(recoveryFlow({...base,gp_verification:evidence}).label,'SUCCESS');
  assert.equal(recoveryFlow({...base,gp_verification:{...evidence,status:'NOT_FOUND'}}).label,'FAIL');
  assert.equal(recoveryFlow({...base,gp_verification:{...evidence,status:'UNAVAILABLE'}}).label,'PROCESSING');
  assert.equal(recoveryFlow({...base,status:'Cancelled'}).label,'CANCELLED');
  assert.equal(recoveryFlow({...base,status:'Approved'}).label,'CANCELLED');
  assert.equal(recoveryFlow({...base,status:'Approved',in_progress:true}).label,'PROCESSING');
  const manual={id:'review-id',outcome:'SUCCESS',note:'Checked the exact pair in CargoMove.',reviewedBy:'admin@example.test',reviewedAt:new Date().toISOString()} as const;
  assert.equal(recoveryFlow({...base,manual_review:manual,gp_verification:{...evidence,status:'NOT_FOUND'}}).label,'SUCCESS','Manual verification does not lose precedence to automatic evidence');
  assert.equal(recoveryFlow({...base,manual_review:{...manual,outcome:'FAIL'}}).label,'FAIL');
  assert.equal(recoveryFlow({...base,status:'Verification Unavailable',scheduler_status:'failed'}).label,'FAIL');
  assert.equal(recoveryFlow({...base,container_type:'EX',scheduler_status:'trigger_requested'}).label,'FAIL','An accepted request alone is not a latest scheduler time');
  assert.equal(recoveryFlow({...base,container_type:'EX',processing_result:'Scheduler run observed — container import not verified'}).label,'SUCCESS','Existing scheduler observations remain usable');
  const scheduler={before:'Yesterday at 11:59 PM',after:'Today at 12:00 AM',observedAt:new Date().toISOString()};
  for(const status of ['ADVANCED','UNCHANGED','UNAVAILABLE'] as const) {
    assert.equal(recoveryFlow({...base,container_type:'EX',scheduler_run:{last_run_verification:{...scheduler,status}}}).label,status==='ADVANCED'?'SUCCESS':'FAIL');
    assert.equal(recoveryFlow({...base,scheduler_run:{last_run_verification:{...scheduler,status}}}).label,'PROCESSING','GP cannot be SUCCESS from scheduler evidence alone');
  }
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

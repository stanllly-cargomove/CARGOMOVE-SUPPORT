import test from 'node:test';
import assert from 'node:assert/strict';
import { searchInput } from '../server-handlers/northport/format.js';
import { probeFilenameBatch, readScanCursor, signScanCursor, scanPlan, isMissingFile } from '../server-handlers/northport/scan.js';
const input={unit:'TXGU4841312',timestamp:'2026-10-17T01:20:00',before:0,after:1,type:'ALL'};
const missing=()=>Object.assign(new Error('550 No such file or directory'),{code:550});
test('filename checks cover every inclusive second and both GP/EX types across batches',async()=>{
  const names:string[]=[];const ftp:any={size:async(name:string)=>{names.push(name);if(name==='CM_CONTAINER_20261017012016_GP.csv')return 472;throw missing();}};
  const filter=searchInput(input);let offset=0;const files:any[]=[];
  while(offset<scanPlan(filter).total){const batch=await probeFilenameBatch(ftp,filter,offset,undefined,{maxChecks:10,budgetMs:1000});offset=batch.scan.nextOffset;files.push(...batch.files);}
  assert.equal(names.length,122);assert.equal(new Set(names).size,122);assert.equal(names[0],'CM_CONTAINER_20261017012000_GP.csv');assert.equal(names.at(-1),'CM_CONTAINER_20261017012100_EX.csv');assert.deepEqual(files,[{name:'CM_CONTAINER_20261017012016_GP.csv',size:472,isFile:true}]);
});
test('Malaysia midnight transitions and type filtering generate only requested canonical filenames',async()=>{
  const names:string[]=[];const ftp:any={size:async(name:string)=>{names.push(name);throw missing();}};
  await probeFilenameBatch(ftp,searchInput({...input,timestamp:'2026-01-01T00:00:00',before:1,after:0,type:'GP'}),59);
  assert.deepEqual(names,['CM_CONTAINER_20251231235959_GP.csv','CM_CONTAINER_20260101000000_GP.csv']);
  assert.throws(()=>scanPlan(searchInput({...input,before:1440,after:1440})),/36,000/);
});
test('only explicit missing-file errors are skipped; permission, network, invalid sizes and cancellation stop scanning',async()=>{
  assert.equal(isMissingFile(missing()),true);assert.equal(isMissingFile(Object.assign(new Error('Permission denied'),{code:550})),false);
  for(const error of [Object.assign(new Error('Access denied'),{code:550}),Object.assign(new Error('Login failed'),{code:530}),new Error('Connection reset')])await assert.rejects(()=>probeFilenameBatch({size:async()=>{throw error;}} as any,searchInput(input),0),error);
  await assert.rejects(()=>probeFilenameBatch({size:async()=>NaN} as any,searchInput(input),0),/invalid file metadata/);
  const controller=new AbortController();controller.abort();await assert.rejects(()=>probeFilenameBatch({size:async()=>0} as any,searchInput(input),0,controller.signal),/cancelled/);
});
test('continuations bind progress, filters, actor and expiry using a separate signed purpose',()=>{
  process.env.SESSION_SECRET='scan-tests-only';const filter=searchInput(input);
  const state=readScanCursor(undefined,'admin',filter);state.offset=10;state.files=1;state.bytes=472;state.records=3;
  const token=signScanCursor(state);assert.deepEqual(readScanCursor(token,'admin',filter),state);
  assert.throws(()=>readScanCursor(token+'x','admin',filter),/Invalid/);assert.throws(()=>readScanCursor(token,'other',filter),/does not match/);
  assert.throws(()=>readScanCursor(token,'admin',searchInput({...input,type:'GP'})),/does not match/);
  assert.throws(()=>readScanCursor(signScanCursor({...state,expires:1}),'admin',filter),/expired/);
});

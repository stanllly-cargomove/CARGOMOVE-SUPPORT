import test from 'node:test';
import assert from 'node:assert/strict';
import { FileInfo, FileType } from 'basic-ftp';
import { searchInput } from '../server-handlers/northport/format.js';
import { searchSourceFiles } from '../server-handlers/northport/listing.js';
import { withFtp } from '../server-handlers/northport/ftp.js';

const config={success:'/containers/SUCCESS',archives:'/containers/SUCCESS_ARCHIVES'};
const names=['CM_CONTAINER_20261105010000_GP.csv','CM_CONTAINER_20261105010001_GP.csv'];
const filter=searchInput({unit:'MSBU4179350',timestamp:'2026-11-05T01:00:00',before:0,after:0,type:'GP'});
const missing=()=>Object.assign(new Error('550 File not found'),{code:550});

test('two connections overlap folder checks, prefer SUCCESS duplicates and preserve scan continuation', {timeout:5000}, async()=>{
  const saved=process.env.NORTHPORT_FTP_LISTING_MODE;
  try {
    for(const mode of ['full','date-pattern','timestamp-scan','exact']) {
      process.env.NORTHPORT_FTP_LISTING_MODE=mode==='exact'?'full':mode;
      const waiting=new Map<string,()=>void>();
      let overlaps=0;
      const meet=(key:string)=>new Promise<void>(resolve=>{
        const release=waiting.get(key);
        if(release){waiting.delete(key);overlaps++;release();resolve();}
        else waiting.set(key,resolve);
      });
      const makeClient=(directory:string)=>{
        let busy=false;
        const run=async<T>(key:string,operation:()=>T)=>{
          assert.equal(busy,false,'Commands must never overlap on one FTP connection');busy=true;
          try {await meet(key);return operation();} finally {busy=false;}
        };
        return {cd:async(path:string)=>{assert.equal(path,directory);return {code:250,message:'Directory changed'};},
          list:async(pattern?:string)=>run('list:'+pattern,()=>names.map(name=>Object.assign(new FileInfo(name),{type:FileType.File,size:directory===config.success?100:200}))),
          size:async(name:string)=>run('size:'+name,()=>{
            if(name===names[0])return directory===config.success?100:200;
            if(name===names[1]&&directory===config.archives)return 200;
            throw missing();
          })};
      };
      const primary=makeClient(config.success);const archiveFtp=makeClient(config.archives);
      const input={...filter,end:filter.start+600000,sourceFilename:mode==='exact'?names[0]:''};
      const first=await searchSourceFiles(primary,config,input,{archiveFtp});
      assert.equal(first.files.find(file=>file.name===names[0])?.size,100,mode);
      if(mode==='timestamp-scan') {
        assert.equal(first.files.find(file=>file.name===names[1])?.size,200);
        assert.equal(first.scan?.nextOffset,600);
        const last=await searchSourceFiles(primary,config,input,{archiveFtp,offset:first.scan!.nextOffset});
        assert.equal(last.scan?.nextOffset,601);assert.deepEqual(last.files,[]);
        assert.equal(overlaps,601);
      } else assert.equal(overlaps,1,mode);
      assert.equal(waiting.size,0);
    }
  } finally {if(saved===undefined)delete process.env.NORTHPORT_FTP_LISTING_MODE;else process.env.NORTHPORT_FTP_LISTING_MODE=saved;}
});

test('parallel discovery preserves archive-only matches and surfaces directory, connection and cancellation failures',async()=>{
  const primary:any={cd:async()=>{},size:async()=>{throw missing();}};
  const archiveFtp:any={cd:async()=>{},size:async()=>200};
  const exact={...filter,sourceFilename:names[0]};
  assert.equal((await searchSourceFiles(primary,config,exact,{archiveFtp})).files[0].size,200);
  archiveFtp.size=async()=>{throw missing();};
  await assert.rejects(()=>searchSourceFiles(primary,config,exact,{archiveFtp}),/File not found/);
  primary.size=async()=>100;
  for(const error of [Object.assign(new Error('550 Permission denied'),{code:550}),new Error('Connection reset')]) {
    archiveFtp.size=async()=>{throw error;};
    await assert.rejects(()=>searchSourceFiles(primary,config,exact,{archiveFtp}),error);
  }
  archiveFtp.cd=async()=>{throw missing();};
  await assert.rejects(()=>searchSourceFiles(primary,config,exact,{archiveFtp}),/directory is not accessible/);
  await assert.rejects(()=>searchSourceFiles(primary,config,{...filter,mode:'files'},{archiveFtp}),/directory is not accessible/);
  const controller=new AbortController();archiveFtp.cd=async()=>{};
  archiveFtp.size=async()=>{controller.abort();return 200;};
  await assert.rejects(()=>searchSourceFiles(primary,config,exact,{archiveFtp,signal:controller.signal}),/cancelled/);
  await assert.rejects(()=>searchSourceFiles(primary,config,exact,{archiveFtp:primary}),/separate FTP connections/);
});

test('search peers reuse one extra connection and both connections close on success, abort and login failure',async()=>{
  const keys=['NORTHPORT_FTP_PASSWORD','NORTHPORT_FTP_SECURE'];const saved=keys.map(key=>process.env[key]);
  process.env.NORTHPORT_FTP_PASSWORD='offline-test';process.env.NORTHPORT_FTP_SECURE='true';
  try {
    for(const outcome of ['success','abort','login-failure']) {
      let created=0;const closed=new Set<number>();const controller=new AbortController();
      const factory=()=>{
        const id=created++;
        return {access:async(options:any)=>{assert.equal(options.secure,true);if(id===1&&outcome==='login-failure')throw {code:530};},close:()=>closed.add(id)} as any;
      };
      const operation=withFtp(async(_client,_config,openSearchPeer)=>{
        const [a,b]=await Promise.all([openSearchPeer(),openSearchPeer()]);assert.equal(a,b);
        if(outcome==='abort'){controller.abort();await openSearchPeer();}
        return 'done';
      },controller.signal,factory);
      if(outcome==='login-failure')await assert.rejects(operation,/login failed/);
      else if(outcome==='abort')await assert.rejects(operation,/cancelled/);
      else assert.equal(await operation,'done');
      assert.equal(created,2);assert.deepEqual([...closed].sort(),[0,1]);
    }
    let created=0;
    await withFtp(async()=>{},undefined,()=>{created++;return {access:async()=>{},close:()=>{}} as any;});
    assert.equal(created,1,'Other FTP operations keep a single connection');
  } finally {keys.forEach((key,index)=>{if(saved[index]===undefined)delete process.env[key];else process.env[key]=saved[index];});}
});

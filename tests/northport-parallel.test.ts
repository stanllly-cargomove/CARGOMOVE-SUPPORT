import test from 'node:test';
import assert from 'node:assert/strict';
import { FileInfo, FileType } from 'basic-ftp';
import { searchInput } from '../server-handlers/northport/format.js';
import { searchSourceFiles } from '../server-handlers/northport/listing.js';
import { withFtp, enterArchiveDirectory, isMissingDirectory } from '../server-handlers/northport/ftp.js';

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
  assert.equal((await searchSourceFiles(primary,config,exact,{archiveFtp})).files[0].size,100);
  assert.equal((await searchSourceFiles(primary,config,{...filter,mode:'files'},{archiveFtp})).files[0].size,100);
  archiveFtp.cd=async()=>{throw Object.assign(new Error('550 Permission denied'),{code:550});};
  await assert.rejects(()=>searchSourceFiles(primary,config,exact,{archiveFtp}),/directory is not accessible/);
  const controller=new AbortController();archiveFtp.cd=async()=>{};
  archiveFtp.size=async()=>{controller.abort();return 200;};
  await assert.rejects(()=>searchSourceFiles(primary,config,exact,{archiveFtp,signal:controller.signal}),/cancelled/);
  await assert.rejects(()=>searchSourceFiles(primary,config,exact,{archiveFtp:primary}),/separate FTP connections/);
});

test('clearance can remove the archive and a later search automatically finds the recreated folder in every mode',async()=>{
  const saved=process.env.NORTHPORT_FTP_LISTING_MODE;
  try {
    for(const parallel of [false,true]) for(const mode of ['full','date-pattern','timestamp-scan','exact']) {
      process.env.NORTHPORT_FTP_LISTING_MODE=mode==='exact'?'timestamp-scan':mode;
      let archivePresent=false;
      const missingDirectory=()=>Object.assign(new Error('550 No such directory'),{code:550});
      const makeClient=()=>{
        let directory='';
        return {
          cd:async(path:string)=>{if(path===config.archives&&!archivePresent)throw missingDirectory();directory=path;return {code:250,message:'Directory changed'};},
          size:async(path:string)=>{
            const slash=path.lastIndexOf('/');const folder=slash<0?directory:path.slice(0,slash);const name=path.slice(slash+1);
            if(folder===config.archives&&!archivePresent)throw missingDirectory();
            if(folder===config.success&&name===names[0])return 100;
            if(folder===config.archives&&name===names[1])return 200;
            throw missing();
          },
          list:async()=>[new FileInfo(directory===config.success?names[0]:names[1])].map(file=>Object.assign(file,{type:FileType.File,size:directory===config.success?100:200})),
        };
      };
      const primary=makeClient();const archiveFtp=parallel?makeClient():undefined;
      const input={...filter,end:filter.start+1000,sourceFilename:mode==='exact'?names[0]:''};
      const first=await searchSourceFiles(primary,config,input,{archiveFtp});
      assert.deepEqual(first.files.map(file=>file.name),[names[0]],`${mode}, parallel=${parallel}`);
      if(mode==='timestamp-scan')assert.equal(first.scan?.nextOffset,2);
      archivePresent=true;
      const restored=await searchSourceFiles(primary,config,{...input,sourceFilename:mode==='exact'?names[1]:''},{archiveFtp});
      assert.deepEqual(restored.files.map(file=>file.name).sort(),mode==='exact'?[names[1]]:names,`${mode}, parallel=${parallel}`);
      primary.cd=async()=>{throw missingDirectory();};
      await assert.rejects(()=>searchSourceFiles(primary,config,input,{archiveFtp}),/directory is not accessible/);
    }
  } finally {if(saved===undefined)delete process.env.NORTHPORT_FTP_LISTING_MODE;else process.env.NORTHPORT_FTP_LISTING_MODE=saved;}
});

test('optional archive checks skip only explicit absence, never denied access, login, ambiguous or network errors',async()=>{
  for(const message of ['550 No such file or directory','550 Directory not found','550 No such directory']) {
    const error=Object.assign(new Error(message),{code:550});
    assert.equal(isMissingDirectory(error),true);
    assert.equal(await enterArchiveDirectory({cd:async()=>{throw error;}} as any,config.archives),false);
  }
  for(const error of [Object.assign(new Error('550 Permission denied'),{code:550}),Object.assign(new Error('550 File not found or permission denied'),{code:550}),Object.assign(new Error('550 File unavailable'),{code:550}),Object.assign(new Error('530 Login failed'),{code:530}),new Error('Connection reset')]) {
    assert.equal(isMissingDirectory(error),false);
    await assert.rejects(()=>enterArchiveDirectory({cd:async()=>{throw error;}} as any,config.archives),error);
  }
});

test('archive removal after directory selection does not discard SUCCESS matches',async()=>{
  const saved=process.env.NORTHPORT_FTP_LISTING_MODE;
  try {
    for(const parallel of [false,true]) for(const mode of ['full','date-pattern','timestamp-scan']) {
      process.env.NORTHPORT_FTP_LISTING_MODE=mode;
      const makeClient=()=>{
        let directory='';
        return {
          cd:async(path:string)=>{directory=path;return {code:250,message:'Changed'};},
          size:async(path:string)=>{
            if(directory===config.archives||path.startsWith(config.archives+'/'))throw Object.assign(new Error('550 No such directory'),{code:550});
            if(path===names[0])return 100;throw missing();
          },
          list:async()=>{if(directory===config.archives)throw Object.assign(new Error('550 No such directory'),{code:550});return [Object.assign(new FileInfo(names[0]),{type:FileType.File,size:100})];},
        };
      };
      const result=await searchSourceFiles(makeClient(),config,{...filter,end:filter.start+1000},{archiveFtp:parallel?makeClient():undefined});
      assert.deepEqual(result.files.map(file=>file.name),[names[0]],`${mode}, parallel=${parallel}`);
    }
  } finally {if(saved===undefined)delete process.env.NORTHPORT_FTP_LISTING_MODE;else process.env.NORTHPORT_FTP_LISTING_MODE=saved;}
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

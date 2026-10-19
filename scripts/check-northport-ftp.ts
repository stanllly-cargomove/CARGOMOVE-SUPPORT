// Read-only diagnostics. No upload, rename, delete, or scheduler commands.
import '../api/_runtime.js';
import { Client, FileInfo } from 'basic-ftp';
import { withFtp, download } from '../server-handlers/northport/ftp.js';
import { filenameInfo, parseCsv, searchInput, MAX_FILE } from '../server-handlers/northport/format.js';
import { searchFiles, listingMode } from '../server-handlers/northport/listing.js';
const arg = (name: string) => process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
if (process.argv.includes('--probe-tls')) {
  const client = new Client(10000);
  let phase = 'connection';
  const timeout = setTimeout(()=>client.close(),20000);
  try {
    await client.connect(process.env.NORTHPORT_FTP_HOST || 'ftp.cargomove.my',Number(process.env.NORTHPORT_FTP_PORT || 21));
    phase = 'TLS negotiation';
    await client.useTLS();
    console.log('Explicit AUTH TLS succeeded with certificate verification. No login was attempted. Set NORTHPORT_FTP_SECURE=true and run an authenticated read-only check.');
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    const safeCode = typeof code === 'number' || (typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)) ? ` (${code})` : '';
    console.error(`TLS probe failed during ${phase}${safeCode}. TLS support is unverified; no plaintext fallback or login was attempted.`);
    process.exitCode=1;
  }
  finally {clearTimeout(timeout);client.close();}
} else if(arg('search-unit')) {
  try {
    const filter=searchInput({unit:arg('search-unit'),timestamp:arg('timestamp'),type:arg('type')||'ALL',before:Number(arg('before')??5),after:Number(arg('after')??30),sourceFilename:arg('source-filename')});
    let offset=0;let candidateFiles=0;let parsedRecords=0;let downloadedBytes=0;let scope='window';let mode='';let warning:string|null=null;
    const matches:{filename:string;record:number}[]=[];
    let more=false;
    do {
      await withFtp(async(client,config)=>{
        await client.cd(config.success);
        const discovery=await searchFiles(client,filter,{offset});scope=discovery.scope;mode=discovery.listingMode;warning=discovery.coverageWarning;
        const candidates=discovery.files.filter(file=>{const info=filenameInfo(file.name);return file.isFile&&info&&info.time>=filter.start&&info.time<=filter.end&&(filter.type==='ALL'||info.type===filter.type);});
        if(candidateFiles+candidates.length>40||candidates.some(file=>file.size>MAX_FILE))throw new Error('Diagnostic candidate limits exceeded. Narrow the window.');
        for(const file of candidates) {
          const bytes=await download(client,file.name);downloadedBytes+=bytes.length;
          if(downloadedBytes>16*1024*1024)throw new Error('Diagnostic download budget exceeded.');
          const csv=parseCsv(bytes);parsedRecords+=csv.rows.length;candidateFiles++;
          csv.rows.forEach((row,i)=>{if(row[0].trim().toUpperCase()===filter.unit)matches.push({filename:file.name,record:i+1});});
        }
        offset=discovery.scan?.nextOffset||0;more=Boolean(discovery.scan&&offset<discovery.scan.total);
        if(discovery.scan)console.log(JSON.stringify({phase:more?'scanning':'scanned',checked:offset,total:discovery.scan.total,candidateFiles,parsedRecords,readOnly:true}));
      });
    }while(more);
    console.log(JSON.stringify({scope,listingMode:mode,complete:!warning,coverageWarning:warning,candidateFiles,parsedRecords,matchedRecords:matches.length,matches,downloadedBytes,readOnly:true}));
  }catch(e){console.error((e as Error).message);process.exitCode=1;}
} else {
  try {
    await withFtp(async(client,config)=>{
      console.log('FTP login succeeded. Checking account-root paths.');
      const root=await client.pwd();await client.cd(config.base);const incoming=await client.pwd();
      console.log('Incoming directory is accessible. Checking SUCCESS.');
      await client.cd(config.success);const success=await client.pwd();
      if (arg('probe-minute')) {
        const minute=arg('probe-minute')!;
        if (!/^\d{12}$/.test(minute) || !filenameInfo(`CM_CONTAINER_${minute}00_GP.csv`)) throw new Error('Probe minute must be YYYYMMDDHHMM.');
        const started=Date.now();let checked=0;let missing=0;const found:string[]=[];let missingResponse:string|undefined;
        for (let second=0;second<60;second++) for (const type of ['GP','EX']) {
          const name=`CM_CONTAINER_${minute}${String(second).padStart(2,'0')}_${type}.csv`;
          try {await client.size(name);found.push(name);} catch(e) {if((e as any).code!==550)throw e;missingResponse??=(e as Error).message;missing++;}
          checked++;
        }
        console.log(JSON.stringify({checked,missing,missingResponse,found,elapsedMs:Date.now()-started,readOnly:true}));return;
      }
      if (process.argv.includes('--inspect-listing')) {
        const gp='CM_CONTAINER_20261017012016_GP.csv';
        const ex='CM_CONTAINER_20261017012014_EX.csv';
        console.log(JSON.stringify({gpSize:await client.size(gp),exSize:await client.size(ex),readOnly:true}));
        const parseList=client.parseList;
        for (const command of ['LIST','NLST']) {
          client.parseList=command==='NLST' ? raw=>raw.split(/\r?\n/).filter(Boolean).map(name=>new FileInfo(name)) : parseList;
          for (const pattern of [gp,'CM_CONTAINER_20261017012016*','CM_CONTAINER_202610170120*_GP.csv','CM_CONTAINER_2026101701*','CM_CONTAINER_20261017*']) {
            client.availableListCommands=[command];
            const entries=await client.list(pattern);
            console.log(JSON.stringify({command,pattern,entries:entries.length,gpPresent:entries.some(e=>e.name===gp),exPresent:entries.some(e=>e.name===ex),readOnly:true}));
          }
        }
        return;
      }
      const sample = process.argv.find(arg=>arg.startsWith('--sample-file='))?.slice('--sample-file='.length);
      if (sample) {
        if (!filenameInfo(sample)) throw new Error('Sample must be a valid Northport filename without a directory.');
        console.log('SUCCESS directory is accessible. Testing a bounded, read-only sample download without listing.');
        const bytes=await download(client,sample);const csv=parseCsv(bytes);
        console.log(JSON.stringify({root,incoming,success,sample,bytes:bytes.length,records:csv.rows.length,columns:20,secure:config.access.secure,readOnly:true,directoryListingVerified:false}));
        return;
      }
      const listingDate = process.argv.find(arg=>arg.startsWith('--list-date='))?.slice('--list-date='.length);
      if (listingDate) {
        if (!/^\d{8}$/.test(listingDate) || !filenameInfo(`CM_CONTAINER_${listingDate}000000_GP.csv`)) throw new Error('Listing date must be a valid YYYYMMDD date.');
        console.log('Testing server-side date-prefixed LIST support; this is a read-only capability check.');
        const started=Date.now();
        const entries=await client.list(`*${listingDate}*`);
        if (process.argv.includes('--show-filenames')) console.log(JSON.stringify({filenames:entries.map(entry=>entry.name)}));
        console.log(JSON.stringify({entries:entries.length,elapsedMs:Date.now()-started,dateFilterHonored:entries.length>0&&entries.every(entry=>entry.name.includes(listingDate)),knownGpPresent:entries.some(entry=>entry.name==='CM_CONTAINER_20261017012016_GP.csv'),knownExPresent:entries.some(entry=>entry.name==='CM_CONTAINER_20261017012014_EX.csv'),readOnly:true,directoryListingVerified:false}));
        return;
      }
      console.log(`SUCCESS directory is accessible. Testing ${listingMode()} listing (45-second total session limit).`);
      const discovery=await searchFiles(client,{unit:'',start:Date.now(),end:Date.now(),type:'GP',sourceFilename:'',mode:'standard'});
      console.log(JSON.stringify({root,incoming,success,entries:discovery.files.length,listingMode:discovery.listingMode,coverageWarning:discovery.coverageWarning,secure:config.access.secure,readOnly:true}));
    });
  } catch(e) {console.error((e as Error).message);process.exitCode=1;}
}

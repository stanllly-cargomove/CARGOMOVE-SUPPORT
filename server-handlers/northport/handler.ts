import crypto from 'node:crypto';
import { adminClient, readSession } from '../../api/_runtime.js';
import { schedulerAdmin, allowedOrigin } from '../scheduler/access.js';
import runScheduler from '../scheduler/handler.js';
import { withFtp, download, safeUpload } from './ftp.js';
import { RecoveryError, searchInput, filenameInfo, parseCsv, generateCsv, validateValues, localTime, MAX_FILE } from './format.js';
import { NORTHPORT_COLUMNS, type Match } from '../../src/types/northport.js';
import { searchFiles, listingMode } from './listing.js';
import { readScanCursor, signScanCursor } from './scan.js';
import { NORTHPORT_UPLOAD_GATES as GATES, uploadsEnabled } from './configuration.js';
export { uploadsEnabled } from './configuration.js';

const hash = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex');
type Source = Omit<Match,'token'> & { actor: string; digest: string; expires: number; format: ReturnType<typeof parseCsv>['format'] };
function sign(source: Source) {
  const encoded = Buffer.from(JSON.stringify(source)).toString('base64url');
  return encoded + '.' + crypto.createHmac('sha256', process.env.SESSION_SECRET!).update('northport:' + encoded).digest('base64url');
}
function verify(token: unknown, actor: string): Source {
  if (typeof token !== 'string' || token.length > 40000) throw new RecoveryError('Select a search result again.');
  const [data, signature, extra] = token.split('.');
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET!).update('northport:' + data).digest('base64url');
  if (extra || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw new RecoveryError('Invalid source approval token.');
  const source = JSON.parse(Buffer.from(data,'base64url').toString()) as Source;
  if (source.actor !== actor || source.expires < Date.now() || !filenameInfo(source.filename)) throw new RecoveryError('Search result expired. Search again before approval or upload.');
  validateValues(source.values); return source;
}
async function body(request: any) {
  if (Number(request.headers['content-length']) > 64000) throw new RecoveryError('Request exceeds 64 KiB.',413);
  if (request.body !== undefined) {
    const serialized = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    if (Buffer.byteLength(serialized) > 64000) throw new RecoveryError('Request exceeds 64 KiB.',413);
    try { return JSON.parse(serialized); } catch { throw new RecoveryError('Invalid JSON request.'); }
  }
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > 64000) throw new RecoveryError('Request exceeds 64 KiB.',413); chunks.push(Buffer.from(chunk)); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new RecoveryError('Invalid JSON request.'); }
}
const fields = 'id,container,container_type,source_filename,recovery_filename,submitted_by,created_at,changed_fields,status,scheduler_run_id,scheduler_status,processing_result';
export function createNorthportHandler(deps = { adminClient, readSession, withFtp, runScheduler }) {
  return async (request: any, response: any) => {
    response.setHeader('Cache-Control','no-store');
    const fail = (code: number, error: string) => response.status(code).json({ error });
    if (!['GET','POST'].includes(request.method)) return fail(405,'Method not allowed.');
    const access = await schedulerAdmin(request,deps);
    if ('code' in access) return fail(access.code, access.message);
    const { client, session } = access;
    try {
      if (request.method === 'GET') {
        const history = await client.from('northport_recoveries').select(fields).order('created_at',{ascending:false}).limit(50).timeout(8000);
        if (history.error) throw new RecoveryError('Recovery history unavailable. Apply the Northport migration.',503);
        return response.json({ history: history.data || [], uploadsEnabled: uploadsEnabled(), missingGates: GATES.filter(g => process.env[`NORTHPORT_${g}`] !== 'true') });
      }
      if (!allowedOrigin(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site' || request.headers['x-cargomove-confirm'] !== 'northport-recovery') return fail(403,'Invalid request origin or confirmation.');
      const input = await body(request);
      if (!input || Array.isArray(input)) throw new RecoveryError('Invalid request.');
      const rate = await client.rpc<boolean>('northport_admit_request',{p_actor:session.id});
      if (rate.error) throw new RecoveryError('Recovery request protection unavailable. Apply the Northport migration.',503);
      if (rate.data !== true) {
        response.setHeader('Retry-After','5');
        throw new RecoveryError('Please wait a few seconds before another recovery operation.',429);
      }
      if (input.action === 'search' || input.action === 'check') {
        const filter = input.action === 'search' ? searchInput(input) : null;
        const scanState=filter&&!filter.sourceFilename&&listingMode()==='timestamp-scan' ? readScanCursor(input.cursor,session.id,filter) : null;
        if(input.cursor&&!scanState) throw new RecoveryError('Search mode changed. Start a new search.');
        const controller = new AbortController();
        const cancel = () => controller.abort();
        request.once?.('aborted',cancel);
        const disconnected = () => { if (!response.writableEnded) cancel(); };
        response.once?.('close', disconnected);
        try {
          const result = await deps.withFtp(async (ftp, config) => {
            const root = await ftp.pwd();
            await ftp.cd(config.base); const incoming = await ftp.pwd();
            await ftp.cd(config.success); const success = await ftp.pwd();
            const now=Math.floor(Date.now()/1000)*1000;
            const discovery = await searchFiles(ftp,filter || {unit:'',start:now,end:now,type:'ALL',sourceFilename:''},{offset:scanState?.offset,signal:controller.signal});
            const { files } = discovery;
            if (!filter) return { checked: true, root, incoming, success, listed: files.length, secure: config.access.secure, listingMode:discovery.listingMode, coverageWarning:discovery.coverageWarning, message: discovery.scan ? 'Login, paths and timestamp filename checks succeeded. Container searches download discovered CSVs.' : discovery.coverageWarning ? 'Login, paths and a bounded date listing succeeded. Directory completeness is not verified.' : 'Read-only login, paths and passive listing succeeded. Verify Malaysia filename timestamps against the port separately.' };
            const candidates = files.flatMap(file => {
              const info = filenameInfo(file.name);
              return file.isFile && info && info.time >= filter.start && info.time <= filter.end && (filter.type === 'ALL' || info.type === filter.type) ? [{file,info}] : [];
            });
            if (candidates.length+(scanState?.files||0) > 40) throw new RecoveryError('More than 40 candidate files. Narrow the search window.');
            if (candidates.some(c => c.file.size > MAX_FILE) || candidates.reduce((sum,c)=>sum+c.file.size,scanState?.bytes||0) > 16*1024*1024) throw new RecoveryError('Candidate files exceed the search memory budget. Narrow the window.');
            const matches: Match[] = []; const errors: { filename: string; message: string }[] = []; let downloaded = 0; let responseBytes = 0; let parsedRecords=0;
            for (const {file,info} of candidates) {
              if (controller.signal.aborted) throw new RecoveryError('Search cancelled.',499);
              const bytes = await download(ftp,file.name); downloaded += bytes.length;
              if (downloaded+(scanState?.bytes||0) > 16*1024*1024) throw new RecoveryError('Search exceeded the 16 MiB download budget.');
              let csv: ReturnType<typeof parseCsv>;
              try { csv = parseCsv(bytes); } catch (e) { errors.push({filename:file.name,message:(e as Error).message}); continue; }
              parsedRecords+=csv.rows.length;
              csv.rows.forEach((values,i) => {
                if (values[0].trim().toUpperCase() !== filter.unit) return;
                if (matches.length+(scanState?.matches||0) >= 100) throw new RecoveryError('More than 100 matches. Narrow the search window.');
                const source: Source = { filename:file.name, timestamp:info.timestamp,type:info.type,record:i+1,values,actor:session.id,digest:hash(bytes),expires:Date.now()+30*60000,format:csv.format };
                const match = {filename:source.filename,timestamp:source.timestamp,type:source.type,record:source.record,values,token:sign(source)};
                responseBytes += Buffer.byteLength(JSON.stringify(match));
                if (responseBytes+(scanState?.resultBytes||0) > 1024*1024) throw new RecoveryError('Matching records exceed the response budget. Narrow the search window.');
                matches.push(match);
              });
            }
            const next=scanState&&discovery.scan ? {...scanState,offset:discovery.scan.nextOffset,files:scanState.files+candidates.length,bytes:scanState.bytes+downloaded,records:scanState.records+parsedRecords,matches:scanState.matches+matches.length,resultBytes:scanState.resultBytes+responseBytes,errors:scanState.errors+errors.length} : null;
            const more=Boolean(next&&discovery.scan&&next.offset<discovery.scan.total);
            return { matches, errors, listed:discovery.scan||discovery.listingMode==='exact'?0:files.length, candidates:candidates.length, complete:!more&&(next?.errors??errors.length)===0&&!discovery.coverageWarning, scope:discovery.scope, listingMode:discovery.listingMode, sourceFilename:filter.sourceFilename||null, coverageWarning:discovery.coverageWarning, nextCursor:more?signScanCursor(next!):null, progress:next&&discovery.scan?{checked:next.offset,total:discovery.scan.total,files:next.files,bytes:next.bytes,records:next.records}:null, start:localTime(filter.start),end:localTime(filter.end) };
          },controller.signal);
          return response.json(result);
        } finally { request.removeListener?.('aborted',cancel); response.removeListener?.('close',disconnected); }
      }
      if (input.action === 'approve' || input.action === 'upload') {
        const source = verify(input.token,session.id); validateValues(input.values);
        const values = input.values as string[];
        const changed = NORTHPORT_COLUMNS.filter((_,i)=>values[i]!==source.values[i]);
        if (input.approved !== true || (changed.some(c=>['UNIT','GPNO','EXPNO','BLNO'].includes(c)) && input.identityConfirmed !== true)) throw new RecoveryError('Explicit approval and confirmation of identifying-field changes are required.');
        // Formula-looking values are preserved for the worker and rendered as plain React text, never opened as a spreadsheet.
        const bytes = generateCsv(values,source.format);
        const sourceKey = hash(source.filename + ':' + source.record);
        const approvedHash = hash(source.digest + ':' + hash(bytes));
        if (input.action === 'approve') {
          const saved = await client.rpc<any>('northport_approve',{p_actor:session.id,p_email:session.email,p_container:values[0],p_type:source.type,p_source:source.filename,p_record:source.record,p_source_key:sourceKey,p_hash:approvedHash,p_changed:changed});
          if (saved.error || !saved.data) throw new RecoveryError('This source record or container already has a recovery, or approval audit is unavailable. Review history before proceeding.',409);
          return response.json({ recovery:saved.data, preview:bytes.toString('utf8'), uploadsEnabled:uploadsEnabled() });
        }
        if (!uploadsEnabled()) throw new RecoveryError('Production uploads are disabled until all preproduction verification gates are confirmed.',403);
        if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.id)) throw new RecoveryError('Invalid recovery ID.');
        // Read-only revalidation finishes BEFORE the upload is claimed or any FTP write happens.
        await deps.withFtp(async (ftp,config)=>{
          await ftp.cd(config.success);
          if (hash(await download(ftp,source.filename)) !== source.digest) throw new RecoveryError('Source file changed. Recovery stopped; operator review required.',409);
        });
        const claimed = await client.rpc<any>('northport_claim_upload',{p_actor:session.id,p_id:input.id,p_hash:approvedHash,p_source_key:sourceKey});
        if (claimed.error || !claimed.data) throw new RecoveryError('Recovery is already submitted, does not match approval, or is owned by another administrator.',409);
        try {
          await deps.withFtp(async (ftp,config)=>{ await ftp.cd(config.base); await safeUpload(ftp,claimed.data.recovery_filename,input.id,bytes); });
          const saved = await client.from('northport_recoveries').update({status:'Uploaded',processing_result:'Verification Unavailable'}).eq('id',input.id).timeout(8000);
          if (saved.error) throw new RecoveryError('File may be uploaded but audit update failed. Check FTP and history; do not retry.',502);
          return response.json({status:'Uploaded',message:'Recovery File Uploaded. Container import verification is unavailable.'});
        } catch (e) {
          await client.from('northport_recoveries').update({status:'Failed',processing_result:'Upload outcome requires operator review. Do not resubmit automatically.'}).eq('id',input.id).timeout(8000);
          throw e;
        }
      }
      if (input.action === 'scheduler') {
        const claim = await client.rpc<any>('northport_claim_scheduler',{p_id:input.id,p_actor:session.id});
        if (claim.error || !claim.data) throw new RecoveryError('Scheduler has already been requested or the recovery is not uploaded.',409);
        let result: any; let code = 503;
        const relay = { setHeader() {}, status(value:number) {code=value;return this;}, json(value:any) {result=value;return this;} };
        try {
          await deps.runScheduler({method:'POST',headers:{...request.headers,'x-cargomove-confirm':'run-northport-containers'},body:{}},relay);
        } catch { result = {status:'unknown',message:'Scheduler outcome uncertain. Check existing scheduler audit.'}; }
        const success = result?.status === 'trigger_requested';
        const saved = await client.from('northport_recoveries').update({status:success?'Scheduler Triggered':'Verification Unavailable',scheduler_status:result?.status || 'unknown',scheduler_run_id:result?.executionId || null,processing_result:'Verification Unavailable'}).eq('id',input.id).timeout(8000);
        if (saved.error) throw new RecoveryError('Scheduler outcome audit unavailable. Check scheduler history before another run.',502);
        return response.status(code).json({ ...result, status:success?'Scheduler Triggered':'Verification Unavailable',processingResult:'Verification Unavailable' });
      }
      throw new RecoveryError('Unknown recovery operation.');
    } catch (e) { return fail(e instanceof RecoveryError ? e.code : 503,e instanceof RecoveryError ? e.message : 'Northport recovery is temporarily unavailable. Check the migration and configuration.'); }
  };
}
export default createNorthportHandler();

import crypto from 'node:crypto';
import { zipSync } from 'fflate';
import { adminClient, readSession } from '../../api/_runtime.js';
import { schedulerAdmin, allowedOrigin } from '../scheduler/access.js';
import runScheduler from '../scheduler/handler.js';
import { withFtp, download, safeUpload } from './ftp.js';
import { RecoveryError, searchInput, filenameInfo, parseCsv, prepareReprocessFile, reprocessFilename, validateValues, localTime, MAX_FILE } from './format.js';
import { NORTHPORT_COLUMNS, type Match, type ScannedFile } from '../../src/types/northport.js';
import { containsContainerText, signFileSource, verifyFileSource, signEditorSource, verifyEditorSource } from './inspection.js';
import { searchFiles, usesTimestampScan } from './listing.js';
import { readScanCursor, signScanCursor } from './scan.js';
import { NORTHPORT_UPLOAD_GATES as GATES, uploadsEnabled } from './configuration.js';
import { verifyGatepass } from './gatepass-verification.js';
import { verifySchedulerRun } from './scheduler-verification.js';
import { recoveryFlow } from '../../src/services/northportRecoveryStatus.js';
export { uploadsEnabled } from './configuration.js';

const hash = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex');
type Source = Omit<Match,'token'|'fileToken'> & { actor: string; digest: string; expires: number; format: ReturnType<typeof parseCsv>['format'] };
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
const fields = 'id,container,container_type,source_filename,recovery_filename,submitted_by,created_at,changed_fields,status,scheduler_run_id,scheduler_status,processing_result,gp_verification';
export function createNorthportHandler(deps = { adminClient, readSession, withFtp, runScheduler, verifyGatepass, verifySchedulerRun }) {
  return async (request: any, response: any) => {
    response.setHeader('Cache-Control','no-store');
    const fail = (code: number, error: string) => response.status(code).json({ error });
    if (!['GET','POST'].includes(request.method)) return fail(405,'Method not allowed.');
    const access = await schedulerAdmin(request,deps);
    if ('code' in access) return fail(access.code, access.message);
    const { client, session } = access;
    try {
      if (request.method === 'GET') {
        const readHistory = (columns:string) => client.from('northport_recoveries').select(columns).order('created_at',{ascending:false}).limit(50).timeout(8000);
        let columns=fields+',manual_review,search_setup,scheduler_run:cargomove_scheduler_runs(last_run_verification)';
        let history = await readHistory(columns);
        const missingMigrations:string[]=[];
        let manualReviewEnabled=true;
        for(let attempt=0;attempt<3&&history.error?.code==='42703';attempt++) {
          if (/last_run_verification/.test(history.error.message || '')) {
            columns=columns.replace(',scheduler_run:cargomove_scheduler_runs(last_run_verification)','');
            missingMigrations.push('20261021000000_scheduler_verification_30_seconds.sql');
          } else if (/manual_review/.test(history.error.message || '')) {
            columns=columns.replace(',manual_review','');manualReviewEnabled=false;
            missingMigrations.push('20261021030000_northport_manual_reviews.sql');
          } else if (/search_setup/.test(history.error.message || '')) {
            columns=columns.replace(',search_setup','');
            missingMigrations.push('20261021040000_northport_retry_search_setup.sql');
          } else break;
          history=await readHistory(columns);
        }
        const historyWarning=missingMigrations.length?`Some recovery verification features are not configured. Apply ${missingMigrations.join(' and ')} and refresh.`:undefined;
        if (history.error) throw new RecoveryError(/gp_verification/.test(history.error.message || '')
          ? 'Recovery history requires 20261021010000_northport_gp_verification.sql. Apply it and refresh.'
          : 'Recovery history could not be loaded. Check the database connection and Northport schema.',503);
        return response.json({ history: history.data || [], manualReviewEnabled, ...(historyWarning?{historyWarning}:{}), uploadsEnabled: uploadsEnabled(), missingGates: GATES.filter(g => process.env[`NORTHPORT_${g}`] !== 'true') });
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
        const scanState=filter&&usesTimestampScan(filter) ? readScanCursor(input.cursor,session.id,filter) : null;
        if(input.cursor&&!scanState) throw new RecoveryError('Search mode changed. Start a new search.');
        const controller = new AbortController();
        const cancel = () => controller.abort();
        request.once?.('aborted',cancel);
        const disconnected = () => { if (!response.writableEnded) cancel(); };
        response.once?.('close', disconnected);
        try {
          const result = await deps.withFtp(async (ftp, config) => {
            const root = await ftp.pwd();
            let incoming: string | undefined;
            if (!filter) { await ftp.cd(config.base); incoming = await ftp.pwd(); }
            await ftp.cd(config.success); const success = await ftp.pwd();
            const now=Math.floor(Date.now()/1000)*1000;
            const discovery = await searchFiles(ftp,filter || {unit:'',start:now,end:now,type:'GP',sourceFilename:'',mode:'standard'},{offset:scanState?.offset,signal:controller.signal});
            const { files } = discovery;
            if (!filter) return { checked: true, root, incoming, success, listed: files.length, secure: config.access.secure, listingMode:discovery.listingMode, coverageWarning:discovery.coverageWarning, message: discovery.scan ? 'Login, paths and timestamp filename checks succeeded. Container searches download discovered CSVs.' : discovery.coverageWarning ? 'Login, paths and a bounded date listing succeeded. Directory completeness is not verified.' : 'Read-only login, paths and passive listing succeeded. Verify Malaysia filename timestamps against the port separately.' };
            const candidates = files.flatMap(file => {
              const info = filenameInfo(file.name);
              return file.isFile && info && info.time >= filter.start && info.time <= filter.end && (filter.type === 'ALL' || info.type === filter.type) ? [{file,info}] : [];
            });
            if (candidates.length+(scanState?.files||0) > 40) throw new RecoveryError('More than 40 candidate files. Narrow the search window.');
            if (candidates.some(c => c.file.size > MAX_FILE) || candidates.reduce((sum,c)=>sum+c.file.size,scanState?.bytes||0) > 16*1024*1024) throw new RecoveryError('Candidate files exceed the search memory budget. Narrow the window.');
            const matches: Match[] = []; const scannedFiles: ScannedFile[] = []; const errors: { filename: string; message: string }[] = []; let downloaded = 0; let responseBytes = 0; let parsedRecords=0;
            for (const {file,info} of candidates) {
              if (controller.signal.aborted) throw new RecoveryError('Search cancelled.',499);
              const bytes = await download(ftp,file.name); downloaded += bytes.length;
              if (downloaded+(scanState?.bytes||0) > 16*1024*1024) throw new RecoveryError('Search exceeded the 16 MiB download budget.');
              const fileToken = signFileSource({actor:session.id,filename:file.name,digest:hash(bytes),expires:Date.now()+30*60000});
              const inspection: ScannedFile | null = filter.mode === 'standard' ? null : {filename:file.name,timestamp:info.timestamp,type:info.type,bytes:bytes.length,records:0,matches:0,status:'no-match',token:fileToken};
              const textFound = filter.mode === 'content' && containsContainerText(bytes,filter.unit);
              const saveInspection = () => {
                if (!inspection) return;
                scannedFiles.push(inspection); responseBytes += Buffer.byteLength(JSON.stringify(inspection));
                if (responseBytes+(scanState?.resultBytes||0) > 1024*1024) throw new RecoveryError('File scan results exceed the response budget. Narrow the search window.');
              };
              let csv: ReturnType<typeof parseCsv>;
              try { csv = parseCsv(bytes); } catch (e) {
                const message = (e as Error).message; errors.push({filename:file.name,message});
                if (inspection) { inspection.status = textFound ? 'content-match' : 'invalid'; inspection.error = message; }
                saveInspection(); continue;
              }
              parsedRecords+=csv.rows.length;
              csv.rows.forEach((values,i) => {
                if (values[0].trim().toUpperCase() !== filter.unit) return;
                if (matches.length+(scanState?.matches||0) >= 100) throw new RecoveryError('More than 100 matches. Narrow the search window.');
                const source: Source = { filename:file.name, timestamp:info.timestamp,type:info.type,record:i+1,totalRecords:csv.rows.length,values,actor:session.id,digest:hash(bytes),expires:Date.now()+30*60000,format:csv.format };
                const match = {filename:source.filename,timestamp:source.timestamp,type:source.type,record:source.record,totalRecords:source.totalRecords,fileToken,values,token:sign(source)};
                responseBytes += Buffer.byteLength(JSON.stringify(match));
                if (responseBytes+(scanState?.resultBytes||0) > 1024*1024) throw new RecoveryError('Matching records exceed the response budget. Narrow the search window.');
                matches.push(match);
                if (inspection) inspection.matches++;
              });
              if (inspection) { inspection.records = csv.rows.length; inspection.status = inspection.matches ? 'match' : textFound ? 'content-match' : 'no-match'; }
              saveInspection();
            }
            const next=scanState&&discovery.scan ? {...scanState,offset:discovery.scan.nextOffset,files:scanState.files+candidates.length,bytes:scanState.bytes+downloaded,records:scanState.records+parsedRecords,matches:scanState.matches+matches.length,resultBytes:scanState.resultBytes+responseBytes,errors:scanState.errors+errors.length} : null;
            const more=Boolean(next&&discovery.scan&&next.offset<discovery.scan.total);
            return { matches, scannedFiles, mode:filter.mode, errors, listed:discovery.scan||discovery.listingMode==='exact'?0:files.length, candidates:candidates.length, complete:!more&&(next?.errors??errors.length)===0&&!discovery.coverageWarning, scope:discovery.scope, listingMode:discovery.listingMode, sourceFilename:filter.sourceFilename||null, coverageWarning:discovery.coverageWarning, nextCursor:more?signScanCursor(next!):null, progress:next&&discovery.scan?{checked:next.offset,total:discovery.scan.total,files:next.files,bytes:next.bytes,records:next.records}:null, start:localTime(filter.start),end:localTime(filter.end) };
          },controller.signal);
          return response.json(result);
        } finally { request.removeListener?.('aborted',cancel); response.removeListener?.('close',disconnected); }
      }
      if (input.action === 'download-all') {
        if (!Array.isArray(input.files) || !input.files.length || input.files.length > 40) throw new RecoveryError('Select between 1 and 40 scanned files.');
        // Verify every actor-bound token before opening FTP. Multiple matched rows
        // in a source file must still produce only one archive entry.
        const sources = new Map<string,{filename:string;digest:string}>();
        for (const file of input.files) {
          const source = file?.kind === 'record' ? verify(file.token,session.id) : file?.kind === 'file' ? verifyFileSource(file.token,session.id) : null;
          if (!source) throw new RecoveryError('Invalid scanned file selection.');
          const existing = sources.get(source.filename);
          if (existing && existing.digest !== source.digest) throw new RecoveryError('Conflicting versions of a source file. Search again.',409);
          sources.set(source.filename,source);
        }
        const files:Record<string,Uint8Array> = {}; let total=0;
        await deps.withFtp(async (ftp,config) => {
          await ftp.cd(config.success);
          for (const source of sources.values()) {
            const bytes = await download(ftp,source.filename); total+=bytes.length;
            if (total>16*1024*1024) throw new RecoveryError('Archive exceeds the 16 MiB download budget.');
            if (hash(bytes)!==source.digest) throw new RecoveryError('A source file changed since the search. Search again before downloading.',409);
            files[source.filename]=bytes;
          }
        });
        const archive = Buffer.from(zipSync(files,{level:6}));
        if (archive.length>4*1024*1024) throw new RecoveryError('ZIP exceeds the 4 MiB archive limit. Download the files individually.');
        response.setHeader('Content-Type','application/zip');
        response.setHeader('Content-Disposition','attachment; filename="NORTHPORT_SCANNED_FILES.zip"');
        return response.send(archive);
      }
      if (input.action === 'download-source' || input.action === 'download-file' || input.action === 'list-containers' || input.action === 'editor-records') {
        const source = input.action === 'download-file' || (['list-containers','editor-records'].includes(input.action) && input.kind === 'file') ? verifyFileSource(input.token,session.id) : verify(input.token,session.id);
        const bytes = await deps.withFtp(async (ftp,config) => {
          await ftp.cd(config.success);
          return download(ftp,source.filename);
        });
        if (hash(bytes) !== source.digest) throw new RecoveryError('Source file changed since the search. Search again before viewing or downloading.',409);
        if (input.action === 'editor-records') {
          const csv = parseCsv(bytes);
          const editorToken = signEditorSource({actor:session.id,filename:source.filename,digest:source.digest,expires:source.expires});
          return response.json({filename:source.filename,rows:csv.rows,editorToken});
        }
        if (input.action === 'list-containers') {
          const csv = parseCsv(bytes);
          const numberColumn = filenameInfo(source.filename)!.type === 'GP' ? 1 : 2;
          return response.json({ filename: source.filename, containers: csv.rows.map((row,index) => ({ container: row[0], record: index+1, number: row[numberColumn], fullEmpty: row[7] })) });
        }
        response.setHeader('Content-Type',input.action === 'download-file' ? 'application/octet-stream' : 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition',`attachment; filename="${source.filename}"`);
        return response.send(bytes);
      }
      if (input.action === 'resume-approved') {
        if (!uploadsEnabled()) throw new RecoveryError('Production uploads are disabled until all preproduction verification gates are confirmed.',403);
        if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.id)) throw new RecoveryError('Invalid recovery ID.');
        const saved = await client.from('northport_recoveries').select('*').eq('id',input.id).eq('actor',session.id).eq('status','Approved').timeout(8000).maybeSingle();
        if (saved.error) throw new RecoveryError('Unable to load the approved recovery.',503);
        const recovery = saved.data;
        if (!recovery || recovery.actor !== session.id || recovery.status !== 'Approved') throw new RecoveryError('Only your approved, not-yet-uploaded recovery can be resumed. Refresh history before continuing.',409);
        const info = filenameInfo(recovery.source_filename);
        if (!info) throw new RecoveryError('The approved source filename is invalid.',409);
        const original = await deps.withFtp(async (ftp,config) => { await ftp.cd(config.success); return download(ftp,recovery.source_filename); });
        const digest = hash(original);
        if (hash('northport-file:' + recovery.source_filename + ':' + digest) !== recovery.source_key) throw new RecoveryError('Source file changed since approval. This recovery cannot be resumed.',409);
        const csv = parseCsv(original);
        const row = csv.rows[recovery.source_record-1];
        if (!row) throw new RecoveryError('The approved source record no longer exists.',409);
        if (!recovery.approved_values && recovery.changed_fields?.length) throw new RecoveryError('This older modified recovery has no saved approved values. Operator review is required; no file was uploaded.',409);
        const values = recovery.approved_values || row;
        validateValues(values);
        const filename = reprocessFilename(values[0]);
        const prepared = prepareReprocessFile(original,recovery.source_record,row,values);
        if (hash('northport-whole-file:' + digest + ':' + filename + ':' + hash(prepared.bytes)) !== recovery.approved_hash) throw new RecoveryError('Saved file does not match the approved recovery. No upload was started.',409);
        const source: Source = {actor:session.id,filename:recovery.source_filename,digest,expires:Date.now()+30*60000,...info,record:recovery.source_record,totalRecords:csv.rows.length,values:row,format:csv.format};
        return response.json({id:recovery.id,token:sign(source),values,containerType:recovery.container_type,approved:true,identityConfirmed:true});
      }
      if (input.action === 'manual-review') {
        if (typeof input.id!=='string'||!/^[a-f0-9-]{36}$/i.test(input.id)||!['SUCCESS','FAIL'].includes(input.outcome)||typeof input.note!=='string'||input.note.trim().length<5||input.note.trim().length>1000
          ||(input.expectedReviewId!=null&&(typeof input.expectedReviewId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.expectedReviewId)))) throw new RecoveryError('Choose SUCCESS or FAIL and enter a verification note (5–1000 characters).');
        const loaded=await client.from('northport_recoveries').select(fields+',manual_review').eq('id',input.id).timeout(8000).maybeSingle();
        if(loaded.error)throw new RecoveryError('Manual status updates require 20261021030000_northport_manual_reviews.sql.',503);
        if(!loaded.data||(!loaded.data.manual_review&&recoveryFlow(loaded.data).label!=='PROCESSING'))throw new RecoveryError('Only a processing recovery or an existing manual decision can be updated here. Refresh history.',409);
        const reviewed=await client.rpc<any>('northport_review_recovery',{p_actor:session.id,p_id:input.id,p_outcome:input.outcome,p_note:input.note.trim(),p_expected_review_id:input.expectedReviewId??null});
        if(reviewed.error||!reviewed.data)throw new RecoveryError('Manual verification could not be saved. Check the manual review migration and refresh history.',503);
        if(reviewed.data.reason)throw new RecoveryError(reviewed.data.reason==='changed'?'Another administrator changed this review. Refresh before saving.':'The recovery is not ready for manual verification. Wait until upload and scheduler dispatch have finished.',409);
        return response.json({status:reviewed.data.outcome,manualReview:reviewed.data,message:`Recovery marked ${reviewed.data.outcome}. Your verification note was saved.`});
      }
      if (input.action === 'cancel-approved') {
        if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.id)) throw new RecoveryError('Invalid recovery ID.');
        const cancelled = await client.rpc<boolean>('northport_cancel_approved',{p_actor:session.id,p_id:input.id});
        if (cancelled.error) throw new RecoveryError('Cancellation unavailable. Apply the recovery cancellation migration.',503);
        if (cancelled.data !== true) throw new RecoveryError('Only your recovery that has not started uploading can be cancelled. Refresh history.',409);
        return response.json({status:'Cancelled',message:'Container recovery cancelled. No file was uploaded.'});
      }
      if (input.action === 'approve' || input.action === 'upload' || input.action === 'download-reprocess' || input.action === 'cancel') {
        validateValues(input.values);
        let originalBytes: Buffer | undefined;
        let source: Source;
        if (input.sourceKind === 'editor') {
          const file = verifyEditorSource(input.token,session.id);
          if (!Number.isSafeInteger(input.record) || input.record < 1) throw new RecoveryError('Select a valid container page.');
          originalBytes = await deps.withFtp(async (ftp,config) => { await ftp.cd(config.success); return download(ftp,file.filename); });
          if (hash(originalBytes) !== file.digest) throw new RecoveryError('Source file changed. Search again before reprocessing.',409);
          const csv = parseCsv(originalBytes);
          const row = csv.rows[input.record-1];
          if (!row) throw new RecoveryError('Container page is outside this source file.');
          source = {...file,...filenameInfo(file.filename)!,record:input.record,totalRecords:csv.rows.length,values:row,format:csv.format};
        } else source = verify(input.token,session.id);
        if (input.action === 'cancel') {
          const cancelled = await client.rpc<any>('northport_record_cancelled',{p_actor:session.id,p_email:session.email,p_container:source.values[0],p_type:source.type,p_source:source.filename,p_record:source.record,p_source_key:hash('northport-file:' + source.filename + ':' + source.digest)});
          if (cancelled.error || !cancelled.data) throw new RecoveryError('Cancellation could not be saved. Apply the recovery cancellation migration. No file was uploaded.',503);
          return response.json({status:'Cancelled',recovery:cancelled.data,message:'Container recovery cancelled. No file was uploaded.'});
        }
        const values = input.values as string[];
        const changed = NORTHPORT_COLUMNS.filter((_,i)=>values[i]!==source.values[i]);
        if (input.action !== 'download-reprocess' && (input.approved !== true || (changed.some(c=>['UNIT','GPNO','EXPNO','BLNO'].includes(c)) && input.identityConfirmed !== true))) throw new RecoveryError('Explicit approval and confirmation of identifying-field changes are required.');
        if (input.action === 'upload') {
          if (!uploadsEnabled()) throw new RecoveryError('Production uploads are disabled until all preproduction verification gates are confirmed.',403);
          if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.id)) throw new RecoveryError('Invalid recovery ID.');
        }
        const filename = reprocessFilename(values[0]);
        // Rebuild from a fresh, hash-verified original for download, approval AND
        // upload. The browser submits only the selected row, never sibling rows.
        const prepared = originalBytes ? prepareReprocessFile(originalBytes,source.record,source.values,values) : await deps.withFtp(async (ftp,config) => {
          await ftp.cd(config.success);
          const original = await download(ftp,source.filename);
          if (hash(original) !== source.digest) throw new RecoveryError('Source file changed. Search again before reprocessing.',409);
          return prepareReprocessFile(original,source.record,source.values,values);
        });
        const {bytes,records} = prepared;
        if (input.action === 'download-reprocess') {
          response.setHeader('Content-Type','text/csv; charset=utf-8');
          response.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
          return response.send(bytes);
        }
        const sourceKey = hash('northport-file:' + source.filename + ':' + source.digest);
        const approvedHash = hash('northport-whole-file:' + source.digest + ':' + filename + ':' + hash(bytes));
        if (input.action === 'approve') {
          let searchSetup;
          if(input.searchSetup!=null) {
            const setup=input.searchSetup;
            const validated=searchInput({...setup,unit:values[0],type:source.type});
            searchSetup={unit:validated.unit,timestamp:setup.timestamp,type:source.type,before:setup.before,after:setup.after,sourceFilename:validated.sourceFilename,mode:validated.mode};
          }
          const saved = await client.rpc<any>('northport_approve',{p_actor:session.id,p_email:session.email,p_container:values[0],p_type:source.type,p_source:source.filename,p_record:source.record,p_source_key:sourceKey,p_hash:approvedHash,p_changed:changed});
          if (saved.error || !saved.data) throw new RecoveryError('This source record or container already has a recovery, or approval audit is unavailable. Review history before proceeding.',409);
          const retained = await client.from('northport_recoveries').update({approved_values:values,...(searchSetup?{search_setup:searchSetup}:{})}).eq('id',saved.data.id).eq('actor',session.id).eq('status','Approved').timeout(8000);
          if (retained.error) throw new RecoveryError(searchSetup?'Approval was recorded, but search settings could not be saved. Apply 20261021040000_northport_retry_search_setup.sql before continuing. No file was uploaded.':'Approval was recorded, but approved values could not be saved. Apply the Northport resume migration before continuing. No file was uploaded.',503);
          return response.json({ recovery:saved.data, preview:bytes.toString('utf8'), filename, records, uploadsEnabled:uploadsEnabled() });
        }
        const claimed = await client.rpc<any>('northport_claim_file_upload',{p_actor:session.id,p_id:input.id,p_hash:approvedHash,p_source_key:sourceKey});
        if (claimed.error) throw new RecoveryError('Whole-file recovery is unavailable. Apply the Northport whole-file recovery migration.',503);
        if (!claimed.data) throw new RecoveryError('Recovery is already submitted, does not match approval, or is owned by another administrator.',409);
        try {
          if (claimed.data.recovery_filename !== filename) throw new RecoveryError('Unexpected reprocess filename. Check the whole-file recovery migration.',503);
          await deps.withFtp(async (ftp,config)=>{ await ftp.cd(config.base); await safeUpload(ftp,claimed.data.recovery_filename,input.id,bytes); });
          const saved = await client.from('northport_recoveries').update({status:'Uploaded',processing_result:'Verification Unavailable'}).eq('id',input.id).timeout(8000);
          if (saved.error) throw new RecoveryError('File may be uploaded but audit update failed. Check FTP and history; do not retry.',502);
          return response.json({status:'Uploaded',message:'Recovery File Uploaded. Container import verification is unavailable.'});
        } catch (e) {
          await client.from('northport_recoveries').update({status:'Failed',processing_result:'Upload outcome requires operator review. Do not resubmit automatically.'}).eq('id',input.id).timeout(8000);
          throw e;
        }
      }
      if (input.action === 'verify-gp'||input.action==='verify-result') {
        if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.id)) throw new RecoveryError('Invalid recovery ID.');
        const loaded = await client.from('northport_recoveries').select('container,container_type,status,approved_values,scheduler_run_id,gp_verification').eq('id',input.id).timeout(8000).maybeSingle();
        if (loaded.error || !loaded.data) throw new RecoveryError('Recovery verification unavailable. Apply the GP verification migration.',503);
        const recovery = loaded.data;
        if (!['Uploaded','Scheduler Triggered','Processing','Verification Unavailable','Import Verified'].includes(recovery.status)) throw new RecoveryError('Upload must be confirmed before checking CargoMove.',409);
        if(recovery.container_type==='EX'&&input.action==='verify-result') {
          if(!recovery.scheduler_run_id)throw new RecoveryError('No associated scheduler request is recorded. Check CargoMove manually before updating the result.',409);
          const run=await client.from('cargomove_scheduler_runs').select('dispatch_at,last_run_verification,task_id,scheduler').eq('id',recovery.scheduler_run_id).timeout(8000).maybeSingle();
          if(run.error||!run.data?.dispatch_at)throw new RecoveryError('Scheduler verification details are unavailable. Check the scheduler audit and verification migration.',503);
          const evidence=await deps.verifySchedulerRun({taskId:run.data.task_id,workerName:run.data.scheduler,before:run.data.last_run_verification?.before||null,dispatchAt:Date.parse(run.data.dispatch_at)});
          const saved=await client.from('cargomove_scheduler_runs').update({last_run_verification:evidence}).eq('id',recovery.scheduler_run_id).timeout(8000);
          if(saved.error)throw new RecoveryError('Scheduler was checked but its observation could not be saved.',503);
          return response.json({status:evidence.status==='ADVANCED'?'Import Verified':evidence.status==='UNCHANGED'?'Verification Failed':'Pending Verification',lastRunVerification:evidence,message:evidence.status==='ADVANCED'?'Export recovery verified: CargoMove recorded a newer scheduler run.':evidence.status==='UNCHANGED'?'Export verification failed: no newer scheduler run was observed.':'Scheduler verification is unavailable. Check CargoMove manually.'});
        }
        if (recovery.container_type !== 'GP') return response.json({status:'Not Applicable',message:'Gatepass verification applies only to GP recoveries.'});
        if (recovery.gp_verification?.status === 'VERIFIED') return response.json({status:'Import Verified',message:'Verified — GP found in CargoMove.',gpVerification:recovery.gp_verification});
        if (!Array.isArray(recovery.approved_values)) throw new RecoveryError('This older recovery has no saved approved gatepass. Operator verification is required.',409);
        validateValues(recovery.approved_values);
        const gatepass = recovery.approved_values[1].trim();
        const container = recovery.approved_values[0].trim();
        if (!gatepass || container.toUpperCase() !== recovery.container.trim().toUpperCase()) throw new RecoveryError('Approved gatepass and container identity are unavailable.',409);
        let dispatchAt:number|null = null;
        if (recovery.scheduler_run_id) {
          const run = await client.from('cargomove_scheduler_runs').select('dispatch_at').eq('id',recovery.scheduler_run_id).timeout(8000).maybeSingle();
          const parsed = run.data?.dispatch_at ? Date.parse(run.data.dispatch_at) : NaN;
          if (!run.error && Number.isFinite(parsed)) dispatchAt=parsed;
        }
        const evidence = await deps.verifyGatepass({gatepass,container,dispatchAt});
        const verified = evidence.status === 'VERIFIED';
        const message = verified ? 'Verified — GP found in CargoMove.' : evidence.status === 'NOT_FOUND' ? 'GP verification failed — the exact gatepass and container pair was not found after processing. Check GP again later; do not upload or run the scheduler again.' : 'GP verification unavailable. Check again later; do not upload or run the scheduler again.';
        let update = client.from('northport_recoveries').update({gp_verification:evidence,...(verified?{status:'Import Verified',processing_result:'Verified — GP found in CargoMove'}:{})}).eq('id',input.id);
        if (!verified) update=update.neq('status','Import Verified'); // Preserve a concurrent positive observation.
        const saved = await update.timeout(8000);
        if (saved.error) throw new RecoveryError('GP lookup completed but evidence could not be saved. Apply the GP verification migration; do not reprocess the file.',503);
        return response.json({status:verified?'Import Verified':evidence.status==='NOT_FOUND'?'Verification Failed':'Pending Verification',message,gpVerification:evidence});
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
        const processingResult=result?.lastRunVerification?.status==='ADVANCED'?'Scheduler run observed — container import not verified':'Verification Unavailable';
        const saved = await client.from('northport_recoveries').update({status:success?'Scheduler Triggered':'Verification Unavailable',scheduler_status:result?.status || 'unknown',scheduler_run_id:result?.executionId || null,processing_result:processingResult}).eq('id',input.id).timeout(8000);
        if (saved.error) throw new RecoveryError('Scheduler outcome audit unavailable. Check scheduler history before another run.',502);
        return response.status(code).json({ ...result, status:success?'Scheduler Triggered':'Verification Unavailable',processingResult });
      }
      throw new RecoveryError('Unknown recovery operation.');
    } catch (e) { return fail(e instanceof RecoveryError ? e.code : 503,e instanceof RecoveryError ? e.message : 'Northport recovery is temporarily unavailable. Check the migration and configuration.'); }
  };
}
export default createNorthportHandler();

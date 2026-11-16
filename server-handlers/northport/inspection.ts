import crypto from 'node:crypto';
import { containerNumber, gatepassNumber, filenameInfo, RecoveryError } from './format.js';
import { parse } from 'csv-parse/sync';
import type { SourceFolder, ContainerType } from '../../src/types/northport.js';

type FileSource = { actor: string; filename: string; digest: string; expires: number; sourceFolder?: SourceFolder };
function signature(data: string, purpose = 'northport-file:') {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET!).update(purpose + data).digest('base64url');
}
// Inspection downloads cannot authorize recovery of an unvalidated record.
export function signFileSource(source: FileSource) {
  const data = Buffer.from(JSON.stringify(source)).toString('base64url');
  return data + '.' + signature(data);
}
function verifySource(token: unknown, actor: string, purpose: string): FileSource {
  if (typeof token !== 'string' || token.length > 4000) throw new RecoveryError('Select a scanned file again.');
  const [data, sig, extra] = token.split('.'); const expected = signature(data,purpose);
  if (extra || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new RecoveryError('Invalid file inspection token.');
  let source: FileSource;
  try { source = JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { throw new RecoveryError('Invalid file inspection token.'); }
  if (!source || source.actor !== actor || !Number.isFinite(source.expires) || source.expires < Date.now() || typeof source.filename !== 'string' || !filenameInfo(source.filename) || typeof source.digest !== 'string' || !/^[a-f0-9]{64}$/.test(source.digest)) throw new RecoveryError('File inspection expired or does not match this search. Search again.');
  return source;
}
export function verifyFileSource(token: unknown, actor: string) {
  return verifySource(token,actor,'northport-file:');
}
// Issued only after strict CSV validation, separately from inspection tokens.
export function signEditorSource(source: FileSource) {
  const data = Buffer.from(JSON.stringify(source)).toString('base64url');
  return data + '.' + signature(data,'northport-editor:');
}
export function verifyEditorSource(token: unknown, actor: string) {
  return verifySource(token,actor,'northport-editor:');
}
export function containsContainerText(bytes: Buffer, unit: string) {
  const normalized = containerNumber(unit);
  // BOM-marked UTF-16 is inspected without changing the strict recovery parser.
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const text = new TextDecoder(encoding).decode(bytes).toUpperCase();
  return new RegExp('(?:^|[^A-Z0-9])' + normalized + '(?=$|[^A-Z0-9])').test(text);
}

// Deep inspection stays scoped to the correct named column for GP/EXP search.
// A text-only match never authorizes recovery of an invalid CSV record.
export function containsGatepassText(bytes: Buffer, number: string, type: ContainerType) {
  const normalized = gatepassNumber(number);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  try {
    const rows: string[][] = parse(new TextDecoder(encoding).decode(bytes), {bom:true,skip_empty_lines:true,relax_column_count:true,relax_quotes:true,max_record_size:24000});
    const column = rows[0]?.findIndex(value => value.trim().toUpperCase() === (type === 'GP' ? 'GPNO' : 'EXPNO')) ?? -1;
    return column >= 0 && rows.slice(1).some(row => row[column]?.trim().toUpperCase() === normalized);
  } catch { return false; }
}

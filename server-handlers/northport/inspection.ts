import crypto from 'node:crypto';
import { containerNumber, filenameInfo, RecoveryError } from './format.js';

type FileSource = { actor: string; filename: string; digest: string; expires: number };
function signature(data: string) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET!).update('northport-file:' + data).digest('base64url');
}
// Inspection downloads cannot authorize recovery of an unvalidated record.
export function signFileSource(source: FileSource) {
  const data = Buffer.from(JSON.stringify(source)).toString('base64url');
  return data + '.' + signature(data);
}
export function verifyFileSource(token: unknown, actor: string): FileSource {
  if (typeof token !== 'string' || token.length > 4000) throw new RecoveryError('Select a scanned file again.');
  const [data, sig, extra] = token.split('.'); const expected = signature(data);
  if (extra || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new RecoveryError('Invalid file inspection token.');
  let source: FileSource;
  try { source = JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { throw new RecoveryError('Invalid file inspection token.'); }
  if (!source || source.actor !== actor || !Number.isFinite(source.expires) || source.expires < Date.now() || typeof source.filename !== 'string' || !filenameInfo(source.filename) || typeof source.digest !== 'string' || !/^[a-f0-9]{64}$/.test(source.digest)) throw new RecoveryError('File inspection expired or does not match this search. Search again.');
  return source;
}
export function containsContainerText(bytes: Buffer, unit: string) {
  const normalized = containerNumber(unit);
  // BOM-marked UTF-16 is inspected without changing the strict recovery parser.
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const text = new TextDecoder(encoding).decode(bytes).toUpperCase();
  return new RegExp('(?:^|[^A-Z0-9])' + normalized + '(?=$|[^A-Z0-9])').test(text);
}

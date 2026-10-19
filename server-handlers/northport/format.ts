import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { NORTHPORT_COLUMNS, NORTHPORT_SEARCH_MODES, type SearchMode } from '../../src/types/northport.js';
export class RecoveryError extends Error { constructor(message: string, public code = 400) { super(message); } }
export const MAX_FILE = 2 * 1024 * 1024;
export function malaysiaTime(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) throw new RecoveryError('Enter a valid Malaysia timestamp including seconds.');
  const date = new Date(value + 'Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,19) !== value || +value.slice(0,4) < 2000) throw new RecoveryError('Invalid calendar date or time.');
  return date.getTime() - 8 * 3600000;
}
export function localTime(ms: number) { return new Date(ms + 8 * 3600000).toISOString().slice(0,19); }
export function filenameInfo(name: string) {
  const m = /^CM_CONTAINER_(\d{14})_(GP|EX)\.csv$/i.exec(name);
  if (!m) return null;
  const s = m[1]; const timestamp = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}`;
  try { return { timestamp, time: malaysiaTime(timestamp), type: m[2].toUpperCase() as 'GP'|'EX' }; } catch { return null; }
}
export function containerNumber(value: unknown) {
  const unit = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{1,32}$/.test(unit)) throw new RecoveryError('Enter a container number using letters and digits only (up to 32 characters).');
  return unit;
}
export function searchInput(body: any) {
  const unit = containerNumber(body.unit); const time = malaysiaTime(body.timestamp);
  const mode: SearchMode = body.mode === undefined ? 'standard' : body.mode;
  if (!NORTHPORT_SEARCH_MODES.some(option => option.value === mode)) throw new RecoveryError('Select a valid search mode.');
  if (!['ALL','GP','EX'].includes(body.type)) throw new RecoveryError('Select All, GP or EX.');
  for (const n of [body.before, body.after]) if (!Number.isInteger(n) || n < 0 || n > 1440) throw new RecoveryError('Search windows must be whole minutes between 0 and 1440.');
  const start = time - body.before * 60000; const end = time + body.after * 60000;
  if (body.sourceFilename !== undefined && typeof body.sourceFilename !== 'string') throw new RecoveryError('Enter a source filename as text.');
  const sourceFilename = body.sourceFilename?.trim() || '';
  if (sourceFilename) {
    const info = filenameInfo(sourceFilename);
    if (!info) throw new RecoveryError('Enter an exact Northport CSV filename without a directory or wildcard.');
    if (info.time < start || info.time > end) throw new RecoveryError('The source filename timestamp is outside the selected search window.');
    if (body.type !== 'ALL' && body.type !== info.type) throw new RecoveryError('The source filename does not match the selected GP/EX filter.');
  }
  return { unit, start, end, type: body.type, sourceFilename, mode };
}
export function validateValues(values: unknown): asserts values is string[] {
  if (!Array.isArray(values) || values.length !== 20 || values.some(v => typeof v !== 'string' || v.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\r\n]/.test(v))) throw new RecoveryError('The record must contain exactly 20 text fields without control characters; each field is limited to 1000 characters.');
  if (containerNumber(values[0]) !== values[0]) throw new RecoveryError('UNIT must be trimmed uppercase letters and digits.');
}
export function parseCsv(bytes: Buffer) {
  if (bytes.length > MAX_FILE) throw new RecoveryError('CSV exceeds the 2 MiB file limit.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new RecoveryError('Unsupported CSV encoding. Confirm worker encoding before recovery.'); }
  const bom = bytes.subarray(0,3).equals(Buffer.from([239,187,191]));
  const endings = text.match(/\r\r\n|\r\n|\r|\n/g) || [];
  const newline = endings[0] || '\r\n';
  if (endings.some(e => e !== newline) || newline === '\r') throw new RecoveryError('CSV has unsupported or mixed line endings.');
  let rows: string[][];
  try { rows = parse(text, { bom: true, record_delimiter: newline, skip_empty_lines: true, relax_column_count: false, max_record_size: 24000 }); } catch { throw new RecoveryError('Malformed CSV: quoting or record column counts are invalid.'); }
  if (!rows.length || JSON.stringify(rows[0]) !== JSON.stringify(NORTHPORT_COLUMNS)) throw new RecoveryError('Unexpected CSV headers. Expected the exact Northport 20-column schema.');
  for (const row of rows.slice(1)) validateValues(row);
  return { rows: rows.slice(1), format: { bom, newline, quoteAll: /^"UNIT"/.test(text.replace(/^\uFEFF/,'')) } };
}
export function generateCsv(values: string[], format: ReturnType<typeof parseCsv>['format']) {
  validateValues(values);
  return Buffer.from(stringify([NORTHPORT_COLUMNS, values], { bom: format.bom, record_delimiter: format.newline, quoted: format.quoteAll }));
}
export function reprocessFilename(unit: string) {
  return `REPROCESS_${containerNumber(unit)}.csv`;
}
export function prepareReprocessFile(bytes: Buffer, record: number, original: string[], edited: string[]) {
  validateValues(edited);
  const csv = parseCsv(bytes);
  if (!Number.isSafeInteger(record) || record < 1 || record > csv.rows.length || JSON.stringify(csv.rows[record-1]) !== JSON.stringify(original)) throw new RecoveryError('The selected source record changed. Search again.',409);
  if (JSON.stringify(original) === JSON.stringify(edited)) return {bytes,records:csv.rows.length};
  // Accepted Northport values cannot contain newlines. Replace just this physical
  // record, preserving every other byte, including quoting, BOM and empty lines.
  const lines = bytes.toString('utf8').split(csv.format.newline);
  const indexes = lines.flatMap((line,index) => line.length ? [index] : []);
  lines[indexes[record]] = stringify([edited], {record_delimiter:csv.format.newline,quoted:csv.format.quoteAll}).slice(0,-csv.format.newline.length);
  const result = Buffer.from(lines.join(csv.format.newline));
  if (result.length > MAX_FILE) throw new RecoveryError('Edited CSV exceeds the 2 MiB file limit.');
  return {bytes:result,records:csv.rows.length};
}

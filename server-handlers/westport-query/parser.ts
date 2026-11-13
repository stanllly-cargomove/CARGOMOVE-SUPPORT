import { parseDocument, DomUtils, ElementType } from 'htmlparser2';
import { normalizeContainerNumber } from '../../shared/np-query.js';
import type { WestportTable } from '../../shared/westport-query.js';
import { NpQueryError } from '../np-query/parser.js';

export class WestportSessionExpired extends NpQueryError {
  constructor() { super('Westports requires a new login session. Please try again.', 503); }
}

export function isWestportLogin(html: string): boolean {
  const document = parseDocument(html);
  return DomUtils.findAll(node => node.name === 'form' && node.attribs.id === 'signin-form', document.children).length > 0;
}

const key = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
type Element = ReturnType<typeof DomUtils.findAll>[number];
const isTag = (node: Element['children'][number]): node is Element => node.type === ElementType.Tag || node.type === ElementType.Script || node.type === ElementType.Style;
const readText = (node: Element['children'][number]): string => {
  if (!isTag(node)) return DomUtils.innerText(node);
  return node.name === 'br' ? ' ' : node.children.map(readText).join('');
};
const text = (node: Element) => readText(node).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const cells = (row: Element) => row.children.filter(isTag).filter(node => node.name === 'th' || node.name === 'td');

// Confirmed from an authorized ETP lookup. Deliberately omit action HTML in
// hdl_ref/container_no_href and the nested row_data payload from portal output.
const jsonColumns = [
  ['hdl_status', 'HDL TYPE'], ['order_type', 'ORDER TYPE'], ['container_no', 'CONTAINER NO'],
  ['stacked_time', 'STACKED TIME'], ['container_ref_no', 'CONTAINER REF NO'],
  ['carrier', 'CARRIER'], ['line', 'LINE'], ['container_type', 'CONTAINER TYPE'],
  ['fe', 'F/E'], ['status', 'STATUS'], ['vessel_name', 'VESSEL NAME'],
  ['scn', 'SCN'], ['expScn', 'EXPORT SCN'], ['sequence', 'SEQUENCE'],
] as const;

/** ETP sends DataTables JSON with a text/html Content-Type. Parse the body,
 * validate completeness and container identity, then expose only display data.
 */
export function parseWestportResponse(body: string, containerNumber: string): WestportTable {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return parseWestportHtml(body, containerNumber);
  let data: any;
  try { data = JSON.parse(trimmed); }
  catch { throw new NpQueryError('Westports returned invalid movement JSON.'); }
  if (!data || Array.isArray(data) || !Array.isArray(data.aaData) || !Number.isSafeInteger(data.iTotalRecords) || !Number.isSafeInteger(data.iTotalDisplayRecords) || data.iTotalRecords !== data.aaData.length || data.iTotalDisplayRecords !== data.aaData.length || data.aaData.length > 500) {
    throw new NpQueryError('Westports returned incomplete or unrecognized movement data.');
  }
  const movements = data.aaData.map((row: any) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.container_no !== 'string' || normalizeContainerNumber(row.container_no) !== containerNumber || typeof row.hdl_status !== 'string' || !row.hdl_status.trim() || typeof row.order_type !== 'string' || !row.order_type.trim()) {
      throw new NpQueryError('Westports returned incomplete or mismatched container data.');
    }
    return jsonColumns.map(([field]) => {
      const value = row[field];
      if (value === null || value === undefined) return '';
      if (typeof value !== 'string' || value.length > 4000) throw new NpQueryError('Westports returned unsupported movement fields.');
      return value.trim();
    });
  });
  return { columns: jsonColumns.map(([, label]) => label), movements };
}

/** Strict fallback for an HTML movement table; never return source markup. */
export function parseWestportHtml(html: string, containerNumber: string): WestportTable {
  if (isWestportLogin(html)) throw new WestportSessionExpired();
  const document = parseDocument(html, { decodeEntities: true });
  for (const node of DomUtils.findAll(node => ['script', 'style', 'noscript'].includes(node.name), document.children)) DomUtils.removeElement(node);
  const candidates = DomUtils.findAll(node => node.name === 'table', document.children).map(table => {
    const rows = DomUtils.findAll(node => node.name === 'tr', table.children).filter(row => {
      let parent = row.parent;
      while (parent && parent !== table) { if (isTag(parent) && parent.name === 'table') return false; parent = parent.parent; }
      return true;
    });
    const headerIndex = rows.findIndex(row => {
      const names = cells(row).map(cell => key(text(cell)));
      return names.some(name => ['containerno', 'containernumber'].includes(name)) && names.includes('hdltype') && names.includes('ordertype');
    });
    return { rows, headerIndex };
  }).filter(candidate => candidate.headerIndex >= 0);
  if (candidates.length !== 1) throw new NpQueryError('Westports returned an unrecognized movement response. An administrator needs to verify the Westports response format.');
  const { rows, headerIndex } = candidates[0];
  const headerCells = cells(rows[headerIndex]);
  const columns = headerCells.map(text);
  if (columns.length > 80 || columns.some(column => !column || column.length > 160) || new Set(columns.map(key)).size !== columns.length || headerCells.some(cell => Number(cell.attribs.colspan || 1) !== 1)) {
    throw new NpQueryError('Westports returned unsupported movement columns.');
  }
  const containerColumn = columns.findIndex(column => ['containerno', 'containernumber'].includes(key(column)));
  const movements: string[][] = [];
  let empty = false;
  for (const row of rows.slice(headerIndex + 1)) {
    // DataTables may repeat the headings in a footer.
    if (cells(row).length && cells(row).every(cell => cell.name === 'th')) continue;
    const values = cells(row).map(text);
    if (values.length === 1 && /^(?:no data available in table|no (?:matching )?records? found)[.!]?$/i.test(values[0])) {
      if (movements.length || empty) throw new NpQueryError('Westports returned conflicting movement data.');
      empty = true;
      continue;
    }
    if (empty || values.length !== columns.length || cells(row).some(cell => Number(cell.attribs.colspan || 1) !== 1) || values.some(value => value.length > 4000) || normalizeContainerNumber(values[containerColumn]) !== containerNumber) {
      throw new NpQueryError('Westports returned incomplete or mismatched container data.');
    }
    movements.push(values);
    if (movements.length > 500) throw new NpQueryError('Westports returned too many movements.');
  }
  if (!movements.length && !empty) throw new NpQueryError('Westports returned a movement table without records or an explicit no-results message.');
  return { columns, movements };
}

import { parseDocument, DomUtils, ElementType } from 'htmlparser2';
import type { WestportDetailSection } from '../../shared/westport-query.js';
import { NpQueryError } from '../np-query/parser.js';
import { isWestportLogin, WestportSessionExpired } from './parser.js';

const titles = ['Common Details', 'Holds', 'Vessel/Voyage', 'Gate', 'Timeline', 'eDO', 'Port'];
type Element = ReturnType<typeof DomUtils.findAll>[number];
const hasClass = (node: Element, name: string) => (node.attribs.class || '').split(/\s+/).includes(name);
// Preserve separated seal, hold and OOG values without returning markup.
const readText = (node: Element['children'][number]): string => {
  if (node.type === ElementType.Text) return node.data;
  if (node.type !== ElementType.Tag) return '';
  return node.name === 'br' ? '\n' : node.children.map(readText).join('');
};
const cellText = (node: Element) => readText(node).replace(/\u00a0/g, ' ').replace(/[\t\r ]+/g, ' ').trim();

/** Read only the seven ETP detail cards. Scripts, action buttons, modals and
 * charges are excluded; no upstream markup is sent to the browser.
 */
export function parseWestportDetails(html: string, containerNumber: string): WestportDetailSection[] {
  if (isWestportLogin(html)) throw new WestportSessionExpired();
  const document = parseDocument(html, { decodeEntities: true });
  for (const node of DomUtils.findAll(node => ['script', 'style', 'noscript', 'button', 'input', 'select'].includes(node.name), document.children)) DomUtils.removeElement(node);
  // The detail header must identify the queried container, outside charge modals.
  const detailRoots = DomUtils.findAll(node => hasClass(node, 'view_enquiry_detail'), document.children);
  if (detailRoots.length !== 1 || !new RegExp(`\\b${containerNumber}\\b`, 'i').test(DomUtils.textContent(detailRoots[0]))) throw new NpQueryError('Westports returned mismatched container details.');
  const cards = DomUtils.findAll(node => hasClass(node, 'tb-section'), detailRoots[0].children);
  const sections: WestportDetailSection[] = cards.map(card => {
    const headers = DomUtils.findAll(node => hasClass(node, 'tb-section-header'), card.children);
    const tables = DomUtils.findAll(node => node.name === 'table' && hasClass(node, 'tb-section-body'), card.children);
    const title = headers.length === 1 ? cellText(headers[0]) : '';
    if (!titles.includes(title) || tables.length !== 1) throw new NpQueryError('Westports returned unsupported detail sections.');
    const rows = DomUtils.findAll(node => node.name === 'tr', tables[0].children).map(row => row.children.filter((node): node is Element => node.type === ElementType.Tag && ['td', 'th'].includes(node.name)).map(cell => {
      if (Number(cell.attribs.colspan || 1) !== 1 || Number(cell.attribs.rowspan || 1) !== 1) throw new NpQueryError('Westports returned unsupported detail cells.');
      const value = cellText(cell);
      if (value.length > 4000) throw new NpQueryError('Westports returned oversized detail fields.');
      return value;
    }));
    const width = title === 'Holds' ? 4 : ['Vessel/Voyage', 'Timeline', 'Port'].includes(title) ? 3 : 2;
    if (!rows.length || rows.length > 100 || rows.some(row => row.length !== width)) throw new NpQueryError('Westports returned incomplete detail tables.');
    const hasHeader = ['Common Details', 'Holds', 'Vessel/Voyage', 'Timeline', 'Port'].includes(title);
    const columns = hasHeader ? rows.shift()! : ['Item', 'Details'];
    if (width === 3 && (columns[1] !== 'IN' || columns[2] !== 'OUT')) throw new NpQueryError('Westports returned unsupported detail directions.');
    return { title, columns, rows };
  });
  if (sections.length !== titles.length || new Set(sections.map(section => section.title)).size !== titles.length) throw new NpQueryError('Westports returned incomplete container details.');
  return sections;
}

/** Match jQuery's nested table_data form encoding, including blank nulls. */
export function westportDetailForm(row: Record<string, unknown>): Record<string, string> {
  const form: Record<string, string> = { node_ajax_id: '2609', action: 'view_container' };
  function append(prefix: string, value: unknown, depth: number) {
    if (depth > 8) throw new NpQueryError('Westports returned unsupported detail data.');
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) append(`${prefix}[${key}]`, child, depth + 1);
    } else form[prefix] = value == null ? '' : String(value);
  }
  append('table_data', { ...row, data_type: row.hdl_status }, 0);
  return form;
}

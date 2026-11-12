import { parseDocument, DomUtils, ElementType } from 'htmlparser2';
import { NP_FIELDS, normalizeContainerNumber, normalizeNpDate, normalizeNpFullEmpty, type NpField, type NpMovement } from '../../shared/np-query.js';

export class NpQueryError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}
const labelKey = (value: string) => value.replace(/\s+/g, '').toLowerCase();
const fieldMap = new Map(Object.entries(NP_FIELDS).map(([field, label]) => [labelKey(label), field as NpField]));
for (const label of ['Full/Empty', 'Full Empty', 'Full or Empty']) fieldMap.set(labelKey(label), 'fullEmpty');
const clean = (value: string): string | null => {
  const text = value.replace(/\u00a0/g, ' ').trim();
  return !text || /^(?:null|n\/a|—|-)$/i.test(text) ? null : text;
};

export function parseNpHtml(html: string, containerNumber: string): NpMovement[] {
  const document = parseDocument(html, { decodeEntities: true });
  const blocks = DomUtils.findAll(node => node.name === 'div' && (node.attribs.class || '').split(/\s+/).includes('div_query_output'), document.children);
  if (!blocks.length) {
    const text = DomUtils.textContent(document).replace(/\s+/g, ' ').trim();
    if (/\bno (?:record|records|result|results|data)(?:\s+(?:was|were|is))?\s*(?:found|available)\b|^no (?:records?|results?|data)[.!]?$|\bcontainer\b.{0,60}\bnot found\b/i.test(text)) {
      throw new NpQueryError('No Northport records were found for this container.', 404);
    }
    throw new NpQueryError('Northport returned an empty or unrecognized response. Please try again later.');
  }
  return blocks.map((block, sourceIndex) => {
    const record = Object.fromEntries(Object.keys(NP_FIELDS).map(field => [field, null])) as Record<NpField, string | null>;
    const rawFields: Record<string, string | null> = {};
    for (const row of DomUtils.findAll(node => node.name === 'p' || node.name === 'tr', block.children)) {
      if (row.name === 'tr' && DomUtils.findAll(node => node.name === 'p', row.children).length) continue;
      // The label is outside the span; values may contain nested markup and colons.
      const spans = DomUtils.findAll(node => node.name === 'span', row.children);
      let label = '', value = '';
      if (spans.length) {
        for (const child of row.children) {
          if (child.type === ElementType.Tag && child.name === 'span') break;
          label += DomUtils.textContent(child);
        }
        value = spans.filter(span => { for (let parent = span.parent; parent && parent !== row; parent = parent.parent) if (parent.type === ElementType.Tag && parent.name === 'span') return false; return true; })
          .map(span => DomUtils.innerText(span)).join('\n');
      } else {
        const cells = DomUtils.findAll(node => node.name === 'td' || node.name === 'th', row.children);
        if (cells.length < 2) continue;
        label = DomUtils.textContent(cells[0]); value = cells.slice(1).map(cell => DomUtils.innerText(cell)).join('\n');
      }
      label = label.replace(/\s*:\s*$/, '').trim();
      if (!label) continue;
      const text = clean(value);
      rawFields[label] = text;
      const field = fieldMap.get(labelKey(label));
      if (!field) continue;
      const parsedValue = field === 'fullEmpty' ? normalizeNpFullEmpty(text) : text;
      // Repeated labels must not silently overwrite conflicting values.
      if (record[field] !== null && record[field] !== parsedValue) throw new NpQueryError('Northport returned conflicting movement fields. Please try again later.');
      record[field] = parsedValue;
    }
    if (!record.containerNumber || normalizeContainerNumber(record.containerNumber) !== containerNumber || !record.category || Object.values(record).filter(v => v !== null).length < 3) {
      throw new NpQueryError('Northport returned incomplete or mismatched container data. Please try again later.');
    }
    record.containerNumber = normalizeContainerNumber(record.containerNumber);
    for (const field of ['grossWeight', 'vgm'] as const) {
      const value = record[field]?.replace(/\s*kg\s*$/i, '').trim() ?? null;
      if (value !== null && !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) throw new NpQueryError('Northport returned an invalid container weight. Please try again later.');
      record[field] = value?.replace(/,/g, '') ?? null;
    }
    for (const field of ['etaImport', 'etaExport', 'timeIn', 'timeStack', 'timeRequestDelivery', 'timeLoadDelivery', 'timeOut'] as const) record[field] = normalizeNpDate(record[field]);
    return { ...record, sourceIndex, rawFields };
  });
}

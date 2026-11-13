import { formatNpDate, normalizeNpDate } from '../../shared/np-query';

const columnKey = (column: string) => column.replace(/[^a-z0-9]/gi, '').toLowerCase();
export const isWestportCategory = (column: string) => columnKey(column) === 'hdltype';
export const isWestportStackedTime = (column: string) => columnKey(column) === 'stackedtime';
export const westportColumnLabel = (column: string) => isWestportCategory(column) ? 'Category' : column;

// Operator-defined presentation only. Do not apply this mapping to ETP records.
export function westportCategory(value: string): string | null {
  const handling = value.trim().toUpperCase();
  return handling === 'IN' ? 'Export' : handling === 'OUT' ? 'Import' : value.trim() || null;
}

export function westportStackedTimeKey(value: string): string | null {
  const raw = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(raw);
  if (compact) return normalizeNpDate(`${compact[1]}-${compact[2]}-${compact[3]} ${compact[4]}:${compact[5]}:${compact[6] || '00'}`);
  const local = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (local) return normalizeNpDate(`${local[3]}-${local[2]}-${local[1]} ${local[4]}:${local[5]}:${local[6] || '00'}`);
  return normalizeNpDate(raw);
}

export function formatWestportStackedTime(value: string): string {
  if (!value.trim()) return '';
  const date = westportStackedTimeKey(value);
  // Local wall-clock display, with no timezone conversion or guessed dates.
  return date ? formatNpDate(date).slice(0, 16) : value;
}

export function westportDisplayValue(column: string, value: string): string {
  return isWestportCategory(column) ? westportCategory(value) || '' : isWestportStackedTime(column) ? formatWestportStackedTime(value) : value;
}

// Northport timestamps are local wall-clock values, with no inferred UTC offset.
export const NP_FIELDS = {
  containerNumber: 'Container Number', blNumber: 'BL Number', exportBookingNumber: 'EXP Booking Number',
  operator: 'Operator', terminal: 'Terminal', category: 'Category', fullEmpty: 'F/E', stage: 'Stage', yardPosition: 'Yard Position',
  examineStack: 'Examine Stack', vesselImport: 'VESSEL (IMPORT)', scnImport: 'SCN (IMPORT)', etaImport: 'ETA (IMPORT)',
  vesselExport: 'VESSEL (EXPORT)', scnExport: 'SCN (EXPORT)', etaExport: 'ETA (EXPORT)', sizeType: 'Size/Type',
  grossWeight: 'Gross Weight', vgm: 'VGM', agentSeal: 'Agent Seal', origin: 'Origin', pol: 'POL', pod: 'POD',
  destination: 'Destination', modeIn: 'Mode In', modeOut: 'Mode Out', haulageReceive: 'Haulage(Recv)',
  haulageDelivery: 'Haulage(Delv)', timeIn: 'Time In', timeStack: 'Time Stack', timeRequestDelivery: 'Time Request(Delv)',
  timeLoadDelivery: 'Time Load(Delv)', timeOut: 'Time Out', agentName: 'Agent Name', holdPermissions: 'Hold/Permissions',
  grantedPermissions: 'Granted/Clear Hold/Permissions',
} as const;
export type NpField = keyof typeof NP_FIELDS;
// Decimal strings intentionally retain precision (including 30000.0) across JSON and exports.
export type NpMovement = Record<NpField, string | null> & {
  sourceIndex: number;
  rawFields: Record<string, string | null>;
};
export type NpQueryResult = {
  success: true; containerNumber: string; queriedAt: string; totalMovements: number;
  latestRecordedMovementIndex: number | null; movements: NpMovement[];
};
export const NP_OPERATIONAL_FIELDS = ['timeOut', 'timeLoadDelivery', 'timeRequestDelivery', 'timeStack', 'timeIn'] as const;
export const normalizeContainerNumber = (value: string) => value.trim().toUpperCase();
export const validContainerNumber = (value: string) => /^[A-Z]{3}[UJZ]\d{7}$/.test(value);

export function normalizeNpFullEmpty(value: string | null): 'F' | 'E' | null {
  const normalized = value?.trim().toUpperCase();
  return normalized === 'F' || normalized === 'FULL' ? 'F' : normalized === 'E' || normalized === 'EMPTY' ? 'E' : null;
}

export function normalizeNpDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min, s, fraction = ''] = match;
  const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > days || Number(h) > 23 || Number(min) > 59 || Number(s) > 59) return null;
  return `${y}-${m}-${d} ${h}:${min}:${s}${fraction}`;
}
export function npDateKey(value: string | null): string | null {
  const date = normalizeNpDate(value);
  return date ? date.slice(0, 19) + '.' + (date.split('.')[1] || '').padEnd(9, '0') : null;
}
export function latestNpEvent(record: NpMovement) {
  let latest: { field: typeof NP_OPERATIONAL_FIELDS[number]; timestamp: string; key: string } | null = null;
  for (const field of NP_OPERATIONAL_FIELDS) {
    const key = npDateKey(record[field]);
    if (key && (!latest || key > latest.key)) latest = { field, timestamp: record[field]!, key };
  }
  return latest;
}
export function npShipping(record: NpMovement) {
  if (record.category?.toLowerCase() === 'import') return { vessel: record.vesselImport, scn: record.scnImport, eta: record.etaImport };
  if (record.category?.toLowerCase() === 'export') return { vessel: record.vesselExport, scn: record.scnExport, eta: record.etaExport };
  return { vessel: null, scn: null, eta: null };
}
// Provisional CargoMove display rule; ETA never outranks an actual event.
export function sortNpMovements(records: NpMovement[]): NpMovement[] {
  return [...records].sort((a, b) => {
    const actualA = latestNpEvent(a)?.key, actualB = latestNpEvent(b)?.key;
    const etaA = npDateKey(npShipping(a).eta), etaB = npDateKey(npShipping(b).eta);
    const rankA = actualA ? 2 : etaA ? 1 : 0, rankB = actualB ? 2 : etaB ? 1 : 0;
    return rankB - rankA || (actualB || etaB || '').localeCompare(actualA || etaA || '') || a.sourceIndex - b.sourceIndex;
  });
}
export function formatNpDate(value: string | null): string {
  const normalized = normalizeNpDate(value);
  if (!normalized) return '—';
  return `${normalized.slice(8, 10)}/${normalized.slice(5, 7)}/${normalized.slice(0, 4)} ${normalized.slice(11, 19)}`;
}
export function formatNpWeight(value: string | null): string {
  if (value === null) return '—';
  const [integer, fraction] = value.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
}

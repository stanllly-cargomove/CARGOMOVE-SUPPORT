import { NP_FIELDS, formatNpDate, latestNpEvent, type NpField, type NpMovement } from '../../shared/np-query';

const dateFields = new Set<NpField>(['etaImport', 'etaExport', 'timeIn', 'timeStack', 'timeRequestDelivery', 'timeLoadDelivery', 'timeOut']);
export function npExportRows(records: NpMovement[]) {
  return [
    ['Source Record', 'Movement Evidence', ...Object.values(NP_FIELDS)],
    ...records.map(record => [String(record.sourceIndex + 1), latestNpEvent(record) ? 'Recorded operational event' : 'No recorded operational event',
      ...Object.keys(NP_FIELDS).map((field: NpField) => dateFields.has(field) ? (record[field] ? formatNpDate(record[field]) : '') : record[field] ?? '')]),
  ];
}
export function npCsv(records: NpMovement[]): string {
  return '\ufeff' + npExportRows(records).map(row => row.map(value => {
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}
export async function exportNpMovements(records: NpMovement[], containerNumber: string, format: 'csv' | 'xlsx' | 'pdf') {
  const filename = `NP_Query_${containerNumber}.${format}`;
  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.aoa_to_sheet(npExportRows(records));
    worksheet['!cols'] = Array.from({ length: Object.keys(NP_FIELDS).length + 2 }, () => ({ wch: 24 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Container Movement');
    XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
  } else {
    const blob = format === 'pdf'
      ? new Blob([await (await import('./npQueryPdf')).createNpPdf(npExportRows(records), containerNumber)], { type: 'application/pdf' })
      : new Blob([npCsv(records)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

import type { WestportDetailSection, WestportTable } from '../../shared/westport-query';

export async function fetchWestportDetails(containerNumber: string, sourceIndex: number, movementKey: string, signal: AbortSignal): Promise<WestportDetailSection[]> {
  const response = await fetch('/api/dev-tools/np-query', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'x-cargomove-confirm': 'np-query' },
    body: JSON.stringify({ port: 'westport', action: 'details', containerNumber, sourceIndex, movementKey }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) throw new Error(body?.error || 'Unable to load Westport details. Please try again.');
  if (body.port !== 'westport' || body.containerNumber !== containerNumber || body.movementKeys?.[sourceIndex] !== movementKey || !Array.isArray(body.detail) || body.detail.length !== 7 || !body.detail.every((section: any) => section && typeof section.title === 'string' && Array.isArray(section.columns) && section.columns.length >= 2 && section.columns.length <= 4 && section.columns.every((value: unknown) => typeof value === 'string') && Array.isArray(section.rows) && section.rows.length <= 100 && section.rows.every((row: unknown) => Array.isArray(row) && row.length === section.columns.length && row.every(value => typeof value === 'string' && value.length <= 4000)))) throw new Error('Westport returned invalid container details. Please search again.');
  return body.detail;
}

export function westportExportRows(table: WestportTable) {
  return [table.columns, ...table.movements];
}
export function westportCsv(table: WestportTable) {
  return '\ufeff' + westportExportRows(table).map(row => row.map(value => {
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}
export async function exportWestportMovements(table: WestportTable, containerNumber: string, format: 'csv' | 'xlsx' | 'pdf') {
  const filename = `Westport_Query_${containerNumber}.${format}`;
  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.aoa_to_sheet(westportExportRows(table));
    worksheet['!cols'] = table.columns.map(() => ({ wch: 24 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Container Movement');
    XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
    return;
  }
  const rows = [['Source Record', 'Movement Evidence', ...table.columns], ...table.movements.map((row, index) => [String(index + 1), 'Westports source order; timestamps as supplied', ...row])];
  const blob = format === 'pdf'
    ? new Blob([await (await import('./npQueryPdf')).createNpPdf(rows, containerNumber, 'Westport')], { type: 'application/pdf' })
    : new Blob([westportCsv(table)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

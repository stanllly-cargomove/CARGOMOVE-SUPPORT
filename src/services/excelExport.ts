import * as XLSX from 'xlsx';
import type { RegistrationSubmission } from '../types';
import { getCompanies, getPorts, getDepots, markSubmissionsExported } from './storage';
import { buildExcelRowData as buildRows, validateSubmissionsForExport as validateRows } from '../../shared/registration-excel';
export { EXCEL_TEMPLATES, resolveSubmissionPorts } from '../../shared/registration-excel';
export type { ExportValidationResult } from '../../shared/registration-excel';

const context = () => ({ companies: getCompanies(), ports: getPorts(), depots: getDepots() });
export const buildExcelRowData = (submissions: RegistrationSubmission[]) => buildRows(submissions, context());
export const validateSubmissionsForExport = (submissions: RegistrationSubmission[]) => validateRows(submissions, context());

/**
 * Main export function:
 * Validates, formats, writes .xlsx buffer, prompts download, and updates submission export status.
 */
export function exportSubmissionsToExcel(
  submissions: RegistrationSubmission[],
  options?: { customFilename?: string; bypassValidation?: boolean }
): { success: boolean; filename: string; count?: number; error?: string } {
  if (submissions.length === 0) {
    return { success: false, filename: '', count: 0, error: 'No registrations selected.' };
  }

  if (!options?.bypassValidation) {
    const validation = validateSubmissionsForExport(submissions);
    if (!validation.valid) {
      return {
        success: false,
        filename: '',
        count: 0,
        error: validation.errors.join(' | '),
      };
    }
  }

  const { headers, rows, type } = buildExcelRowData(submissions);

  // Registration references remain visible in every generated workbook filename.
  const filename = options?.customFilename || `${submissions.map(submission => submission.reference_no).join('_')}_${type}.xlsx`;

  // Convert to SheetJS WorkBook
  // Construct sheet with exact ordered headers
  const worksheetData = [
    [...headers], // Row 1: Header names
    ...rows.map((row) => headers.map((h) => row[h] ?? '')),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Set nice column widths for enterprise legibility
  worksheet['!cols'] = headers.map(() => ({ wch: 22 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

  // Trigger browser download of .xlsx binary
  XLSX.writeFile(workbook, filename, { bookType: 'xlsx', type: 'binary' });

  // Update submission record export statuses
  markSubmissionsExported(
    submissions.map((s) => s.id),
    filename
  );

  return { success: true, filename, count: rows.length };
}

/** Downloads a draft export without changing any registration/export status. */
export function exportSubmissionPreview(submission: RegistrationSubmission): string {
  const { headers, rows, type } = buildExcelRowData([submission]);
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...headers],
    ...rows.map((row) => headers.map((header) => row[header] ?? '')),
  ]);
  worksheet['!cols'] = headers.map(() => ({ wch: 22 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const filename = `DRAFT_${submission.reference_no}_${type}.xlsx`;
  XLSX.writeFile(workbook, filename, { bookType: 'xlsx', type: 'binary' });
  return filename;
}

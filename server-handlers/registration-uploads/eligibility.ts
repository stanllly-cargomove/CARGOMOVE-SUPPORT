import type { RegistrationSubmission } from '../../src/types/index.js';
import { buildExcelRowData, validateSubmissionsForExport, type ExcelContext } from '../../shared/registration-excel.js';

export async function registrationUploadBlockReason(
  client: any,
  submission: RegistrationSubmission,
  ports: ExcelContext['ports'],
): Promise<string | null> {
  const approval = await client.rpc('registration_upload_company_block_reason', { p_company_id: submission.company_id });
  const company = await client.from('companies').select('*').eq('id', submission.company_id).timeout(8000).maybeSingle();
  if (approval.error || company.error) return 'Company registration could not be verified.';
  if (approval.data) return approval.data;

  const context: ExcelContext = { companies: company.data ? [company.data] : [], ports, depots: [] };
  const validation = validateSubmissionsForExport([submission], context);
  const { rows } = buildExcelRowData([submission], context);
  const required = submission.registration_type === 'DRIVER' ? ['DRIVINGLICENSE', 'MOBILENO', 'NAME'] : ['REGISTRATION', 'WEIGHT'];
  if (!validation.valid || !rows.length || rows.some(row => required.some(key => !String(row[key] ?? '').trim())
    || submission.registration_type !== 'DRIVER' && (!Number.isFinite(Number(row.WEIGHT)) || Number(row.WEIGHT) < 0)
    || row.PORTS.split(',').filter(Boolean).some(portId => !/^[a-f0-9]{24}$/i.test(portId)))) {
    return 'Check CargoMove IDs, required fields, weights and port configuration.';
  }
  return null;
}

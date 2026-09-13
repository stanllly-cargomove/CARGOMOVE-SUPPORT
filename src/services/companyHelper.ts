import { Company, CompanyCategory, ExternalIdResolution } from '../types';

export type CompanyType = 'HAULAGE' | 'FORWARDER' | 'TRANSPORT';

/** Normalize legacy and user-entered values to the three supported company types. */
export function normalizeCompanyType(typeStr: string = ''): CompanyType {
  const normalized = typeStr.trim().toUpperCase();

  if (normalized.includes('HAUL')) return 'HAULAGE';
  if (normalized.includes('TRANSPORT')) return 'TRANSPORT';
  return 'FORWARDER';
}

/** Backend Excel TYPE/COMPANYTYPE value: only HAULAGE is exported distinctly. */
export function getExportCompanyType(typeStr: string = ''): 'HAULAGE' | 'FORWARDER' {
  return normalizeCompanyType(typeStr) === 'HAULAGE' ? 'HAULAGE' : 'FORWARDER';
}

/**
 * Normalizes user-entered or legacy company types into standardized categories:
 * - HAULIER: Haulage, Haulier, Trucking
 * - FORWARDING: Transporter, Forwarder, Forwarding, Forwarding Agent, Freight
 */
export function normalizeCompanyCategory(typeStr: string = ''): CompanyCategory {
  return normalizeCompanyType(typeStr) === 'HAULAGE' ? 'HAULIER' : 'FORWARDING';
}

/**
 * Clean & normalize registration numbers for comparison and duplicate prevention.
 * Strips whitespace, forces uppercase.
 */
export function normalizeRegNo(regNo: string = ''): string {
  return regNo.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Centralized business logic function required by Section 19:
 * getCompanyExternalId(company)
 *
 * If company category is HAULIER:
 *   return HAULIERID = company.haulier_id, FORWARDING_AGENT_ID = ''
 * If company category is FORWARDING:
 *   return HAULIERID = '', FORWARDING_AGENT_ID = company.forwarding_agent_id
 *
 * The EXACT same logic is used for:
 * - Company exports
 * - Driver exports
 * - Trailer exports
 * - Vehicle exports
 */
export function getCompanyExternalId(
  company: Partial<Company> | { company_type?: string; haulier_id?: string; forwarding_agent_id?: string }
): ExternalIdResolution {
  const rawType = company.company_type || '';
  const category = normalizeCompanyCategory(rawType);
  const rawHaulierId = (company.haulier_id || '').trim();
  const rawForwardingId = (company.forwarding_agent_id || '').trim();

  if (category === 'HAULIER') {
    const hasId = rawHaulierId.length > 0;
    return {
      category: 'HAULIER',
      haulier_id: rawHaulierId,
      forwarding_agent_id: '',
      required_id_type: 'HAULIERID',
      has_required_id: hasId,
      active_id_value: rawHaulierId,
    };
  } else {
    const hasId = rawForwardingId.length > 0;
    return {
      category: 'FORWARDING',
      haulier_id: '',
      forwarding_agent_id: rawForwardingId,
      required_id_type: 'FORWARDING_AGENT_ID',
      has_required_id: hasId,
      active_id_value: rawForwardingId,
    };
  }
}

/**
 * Generates an Excel-safe filename according to Requirement 14:
 * <COMPANY_NAME>_<TYPE>_<DATE>.xlsx
 * Example: LUMORA_TECH_DRIVER_20260912.xlsx
 */
export function generateExcelFilename(
  companyName: string,
  registrationType: string,
  date: Date = new Date()
): string {
  // Clean company name: alphanumeric & underscores only
  const cleanName = companyName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'COMPANY';

  const cleanType = registrationType.trim().toUpperCase();

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  return `${cleanName}_${cleanType}_${dateStr}.xlsx`;
}

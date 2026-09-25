import * as XLSX from 'xlsx';
import {
  Company,
  PortConfig,
  RegistrationSubmission,
  RegistrationType,
} from '../types';
import {
  getCompanyExternalId,
  getExportCompanyType,
  generateExcelFilename,
} from './companyHelper';
import {
  getCompanyById,
  getPorts,
  getDepots,
  markSubmissionsExported,
} from './storage';

// EXACT Column header definitions matching Sections 6, 7, 8, 9, 20
export const EXCEL_TEMPLATES = {
  COMPANY: [
    'HAULIERID',
    'FORWARDING_AGENT_ID',
    'NAME',
    'SHORTNAME',
    'TYPE',
    'REGISTRATION',
    'REGISTRATION_NEW',
    'PORTS',
    'DEPOTS',
    'BLOCK',
    'ADDRESS1',
    'ADDRESS2',
    'CITY',
    'STATE',
    'POSTCODE',
    'COUNTRY',
    'CONTACTNAME',
    'CONTACTEMAIL',
    'CONTACTDESGN',
    'CONTACTMOBILE',
    'OFFICE',
    'FAX',
  ] as const,

  DRIVER: [
    'DRIVINGLICENSE',
    'HAULIERID',
    'FORWARDING_AGENT_ID',
    'COMPANYTYPE',
    'MOBILENO',
    'NAME',
    'PORTS',
  ] as const,

  TRAILER: [
    'REGISTRATION',
    'HAULIERID',
    'FORWARDING_AGENT_ID',
    'COMPANYTYPE',
    'WEIGHT',
    'TYPE',
    'BDM_WEIGHT',
    'PORTS',
  ] as const,

  VEHICLE: [
    'REGISTRATION',
    'HAULIERID',
    'FORWARDING_AGENT_ID',
    'COMPANYTYPE',
    'WEIGHT',
    'BGK_WEIGHT',
    'HEAD',
    'PORTS',
  ] as const,
};

export interface ExportValidationResult {
  valid: boolean;
  errors: string[];
  missingCompanyIds: {
    submissionId: string;
    companyName: string;
    regNo: string;
    requiredType: 'HAULIERID' | 'FORWARDING_AGENT_ID';
  }[];
}

/**
 * Validates a batch of submissions before exporting to ensure none are missing mandatory IDs.
 * Requirement 10 & 12: Do NOT silently export an invalid Excel file.
 */
export function validateSubmissionsForExport(
  submissions: RegistrationSubmission[]
): ExportValidationResult {
  const errors: string[] = [];
  const missingCompanyIds: ExportValidationResult['missingCompanyIds'] = [];

  if (submissions.length === 0) {
    return { valid: false, errors: ['No registrations selected for export.'], missingCompanyIds: [] };
  }

  // Check type consistency if multiple
  const primaryType = submissions[0].registration_type;
  const hasMixedTypes = submissions.some((s) => s.registration_type !== primaryType);
  if (hasMixedTypes) {
    errors.push('Cannot mix different registration types in a single Excel template export.');
  }

  submissions.forEach((sub) => {
    let company: Company | undefined;
    if (sub.company_id) {
      company = getCompanyById(sub.company_id);
    }

    // For company registrations that may not yet be in company master
    const compType = company?.company_type || sub.company_type || sub.data.company?.company_type || '';
    const haulierId = company?.haulier_id || sub.data.company?.haulier_id || '';
    const forwardingId = company?.forwarding_agent_id || sub.data.company?.forwarding_agent_id || '';

    const idResolution = getCompanyExternalId({
      company_type: compType,
      haulier_id: haulierId,
      forwarding_agent_id: forwardingId,
    });

    if (!idResolution.has_required_id) {
      errors.push(
        `Company "${sub.company_name}" (${sub.company_reg_no}) is missing required ${idResolution.required_id_type}.`
      );
      missingCompanyIds.push({
        submissionId: sub.id,
        companyName: sub.company_name,
        regNo: sub.company_reg_no,
        requiredType: idResolution.required_id_type,
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    missingCompanyIds,
  };
}

/**
 * Resolves configured backend port or depot ID from the Admin configuration.
 * For PORT_KLANG, auto-assigns WESTPORT and NORTHPORT comma-separated.
 */
export function resolveSubmissionPorts(
  sub: RegistrationSubmission,
  ports: PortConfig[]
): string {
  if (sub.port_location === 'PORT_KLANG') {
    const wp = ports.find((p) => p.code === 'WESTPORT' || p.id === 'pk-westport');
    const np = ports.find((p) => p.code === 'NORTHPORT' || p.id === 'pk-northport');
    const wpId = wp?.backend_port_id || '5ad78eeb458efa4c5a1fc007';
    const npId = np?.backend_port_id || '5adc9dd77753d26fb07d6f26';
    return `${wpId},${npId}`;
  }

  const rawPort = sub.port_id || sub.data.company?.port_id || '';
  if (rawPort) {
    if (rawPort.includes(',')) {
      return rawPort
        .split(',')
        .map((p) => {
          const found = ports.find(
            (item) => item.id === p.trim() || item.code === p.trim() || item.display_name === p.trim()
          );
          return found?.backend_port_id || p.trim();
        })
        .filter(Boolean)
        .join(',');
    }
    const found = ports.find(
      (p) => p.id === rawPort || p.code === rawPort || p.display_name === rawPort
    );
    if (found?.backend_port_id) return found.backend_port_id;
  }

  const jhPorts = ports.filter((p) => p.location === 'JOHOR');
  if (jhPorts.length > 0) {
    return jhPorts.map((p) => p.backend_port_id).filter(Boolean).join(',');
  }

  return rawPort;
}

function resolveBackendDepotId(depotIdOrCode?: string): string {
  if (!depotIdOrCode) return '';
  const depots = getDepots();
  const found = depots.find((d) => d.id === depotIdOrCode || d.display_name === depotIdOrCode);
  return found?.backend_depot_id || depotIdOrCode || '';
}

function resolveAssignedPortIds(portIds: string[], ports: PortConfig[]): string {
  return portIds
    .map((portId) => {
      const port = ports.find((item) => item.id === portId || item.code === portId || item.display_name === portId);
      return port?.backend_port_id || portId;
    })
    .filter(Boolean)
    .join(',');
}

function resolveAssignedDepotIds(depotIds: string[]): string {
  return depotIds.map((depotId) => resolveBackendDepotId(depotId)).filter(Boolean).join(',');
}

/**
 * Generates rows for Excel matching EXACT columns
 */
export function buildExcelRowData(
  submissions: RegistrationSubmission[]
): {
  type: RegistrationType;
  headers: readonly string[];
  rows: Record<string, string>[];
} {
  const ports = getPorts();
  const type = submissions[0].registration_type;

  switch (type) {
    case 'COMPANY': {
      const headers = EXCEL_TEMPLATES.COMPANY;
      const rows = submissions.map((sub) => {
        const comp = sub.company_id ? getCompanyById(sub.company_id) : undefined;
        const compData = sub.data.company || {};

        const compType = comp?.company_type || sub.company_type || compData.company_type || '';
        const idRes = getCompanyExternalId({
          company_type: compType,
          haulier_id: comp?.haulier_id || compData.haulier_id,
          forwarding_agent_id: comp?.forwarding_agent_id || compData.forwarding_agent_id,
        });

        const assignedPortIds = comp?.assigned_port_ids?.length
          ? comp.assigned_port_ids
          : compData.assigned_port_ids?.length ? compData.assigned_port_ids : [];
        const assignedDepotIds = comp?.assigned_depot_ids?.length
          ? comp.assigned_depot_ids
          : compData.assigned_depot_ids?.length ? compData.assigned_depot_ids : [];
        const portVal = assignedPortIds.length
          ? resolveAssignedPortIds(assignedPortIds, ports)
          : resolveSubmissionPorts(sub, ports);
        const depotVal = assignedDepotIds.length
          ? resolveAssignedDepotIds(assignedDepotIds)
          : resolveBackendDepotId(comp?.depot_id || sub.depot_id || compData.depot_id);

        return {
          HAULIERID: idRes.haulier_id || '',
          FORWARDING_AGENT_ID: idRes.forwarding_agent_id || '',
          NAME: comp?.name || sub.company_name || compData.name || '',
          SHORTNAME: comp?.short_name || compData.short_name || '',
          TYPE: getExportCompanyType(compType),
          REGISTRATION: comp?.registration_number_old || comp?.registration_number || compData.registration_number_old || sub.company_reg_no || '',
          REGISTRATION_NEW: comp?.registration_number_new || compData.registration_number_new || '',
          PORTS: portVal,
          DEPOTS: depotVal,
          BLOCK: comp?.block || compData.block || '',
          ADDRESS1: comp?.address1 || compData.address1 || '',
          ADDRESS2: comp?.address2 || compData.address2 || '',
          CITY: comp?.city || compData.city || '',
          STATE: comp?.state || compData.state || '',
          POSTCODE: comp?.postcode || compData.postcode || '',
          COUNTRY: comp?.country || compData.country || 'Malaysia',
          CONTACTNAME: comp?.contact_name || compData.contact_name || sub.submitted_by_name || '',
          CONTACTEMAIL: comp?.contact_email || compData.contact_email || sub.submitted_by_email || '',
          CONTACTDESGN: comp?.contact_designation || compData.contact_designation || '',
          CONTACTMOBILE: comp?.contact_mobile || compData.contact_mobile || sub.submitted_by_mobile || '',
          OFFICE: comp?.office_phone || compData.office_phone || '',
          FAX: comp?.fax || compData.fax || '',
        };
      });
      return { type, headers, rows };
    }

    case 'DRIVER': {
      const headers = EXCEL_TEMPLATES.DRIVER;
      const rows: Record<string, string>[] = [];
      submissions.forEach((sub) => {
        const comp = getCompanyById(sub.company_id);
        const compType = comp?.company_type || sub.company_type || 'Forwarder';
        const idRes = getCompanyExternalId(comp || { company_type: compType });
        const portVal = resolveSubmissionPorts(sub, ports);

        const driverList = sub.data.drivers && sub.data.drivers.length > 0
          ? sub.data.drivers
          : sub.data.driver ? [sub.data.driver] : [];

        driverList.forEach((driver) => {
          rows.push({
            DRIVINGLICENSE: driver?.driving_license || '',
            HAULIERID: idRes.haulier_id || '',
            FORWARDING_AGENT_ID: idRes.forwarding_agent_id || '',
            COMPANYTYPE: getExportCompanyType(compType),
            MOBILENO: driver?.mobile_no || '',
            NAME: driver?.name || '',
            PORTS: portVal,
          });
        });
      });
      return { type, headers, rows };
    }

    case 'TRAILER': {
      const headers = EXCEL_TEMPLATES.TRAILER;
      const rows: Record<string, string>[] = [];
      submissions.forEach((sub) => {
        const comp = getCompanyById(sub.company_id);
        const compType = comp?.company_type || sub.company_type || 'Forwarder';
        const idRes = getCompanyExternalId(comp || { company_type: compType });
        const portVal = resolveSubmissionPorts(sub, ports);

        const trailerList = sub.data.trailers && sub.data.trailers.length > 0
          ? sub.data.trailers
          : sub.data.trailer ? [sub.data.trailer] : [];

        trailerList.forEach((trailer) => {
          rows.push({
            REGISTRATION: trailer?.registration_number || '',
            HAULIERID: idRes.haulier_id || '',
            FORWARDING_AGENT_ID: idRes.forwarding_agent_id || '',
            COMPANYTYPE: getExportCompanyType(compType),
            WEIGHT: trailer?.weight || '',
            TYPE: trailer?.trailer_type || '',
            BDM_WEIGHT: trailer?.bdm_weight || '',
            PORTS: portVal,
          });
        });
      });
      return { type, headers, rows };
    }

    case 'VEHICLE': {
      const headers = EXCEL_TEMPLATES.VEHICLE;
      const rows: Record<string, string>[] = [];
      submissions.forEach((sub) => {
        const comp = getCompanyById(sub.company_id);
        const compType = comp?.company_type || sub.company_type || 'Forwarder';
        const idRes = getCompanyExternalId(comp || { company_type: compType });
        const portVal = resolveSubmissionPorts(sub, ports);

        const vehicleList = sub.data.vehicles && sub.data.vehicles.length > 0
          ? sub.data.vehicles
          : sub.data.vehicle ? [sub.data.vehicle] : [];

        vehicleList.forEach((vehicle) => {
          rows.push({
            REGISTRATION: vehicle?.registration_number || '',
            HAULIERID: idRes.haulier_id || '',
            FORWARDING_AGENT_ID: idRes.forwarding_agent_id || '',
            COMPANYTYPE: getExportCompanyType(compType),
            WEIGHT: vehicle?.weight || '',
            BGK_WEIGHT: vehicle?.bgk_weight || '',
            HEAD: vehicle?.head || '',
            PORTS: portVal,
          });
        });
      });
      return { type, headers, rows };
    }
  }
}

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

  // Derive standard filename
  const companyName = submissions.length === 1
    ? submissions[0].company_name
    : submissions.every((s) => s.company_name === submissions[0].company_name)
    ? submissions[0].company_name
    : 'BATCH_REGISTRATIONS';

  const filename = options?.customFilename || generateExcelFilename(companyName, type);

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

import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { PortLocation, CompanyFormData } from '../../../types';
import { getAutoAssignedPorts } from '../../../services/storage';
import { CompanyType, normalizeCompanyType } from '../../../services/companyHelper';
import { notifyError, notifySuccess, notifyWarning } from '../../common/notifications';
import { ArrowLeft, ArrowRight, Building2, Phone, CheckCircle2, Download, EllipsisVertical, LoaderCircle, Upload } from 'lucide-react';

interface CompanyFormProps {
  initialLocation: PortLocation;
  initialPortId?: string;
  initialData?: CompanyFormData;
  initialPage?: number;
  onSubmit: (data: CompanyFormData) => void;
  onBack: () => void;
}

const statesByCountry: Record<string, string[]> = {
  Malaysia: [
    'Johor',
    'Kedah',
    'Kelantan',
    'Melaka',
    'Negeri Sembilan',
    'Pahang',
    'Penang',
    'Perak',
    'Perlis',
    'Sabah',
    'Sarawak',
    'Selangor',
    'Terengganu',
    'Kuala Lumpur',
    'Labuan',
    'Putrajaya',
  ],
  Singapore: ['Central Region', 'East Region', 'North Region', 'North-East Region', 'West Region'],
};

const companyExcelHeaders: Record<string, keyof CompanyFormData> = {
  NAME: 'name',
  COMPANYNAME: 'name',
  COMPANYFULLLEGALNAME: 'name',
  SHORTNAME: 'short_name',
  COMPANYSHORTNAME: 'short_name',
  COMPANYSHORTNAMETRADENAME: 'short_name',
  TRADENAME: 'short_name',
  TYPE: 'company_type',
  COMPANYTYPE: 'company_type',
  COMPANYCATEGORY: 'company_type',
  COMPANYCATEGORYTYPE: 'company_type',
  REGISTRATION: 'registration_number_old',
  REGISTRATIONOLD: 'registration_number_old',
  OLDREGISTRATIONNUMBER: 'registration_number_old',
  OLDCOMPANYREGNUMBER: 'registration_number_old',
  COMPANYREGISTRATIONNUMBER: 'registration_number_old',
  REGISTRATIONNEW: 'registration_number_new',
  NEWREGISTRATIONNUMBER: 'registration_number_new',
  NEWCOMPANYREGNUMBER: 'registration_number_new',
  NEWCOMPANYREGNUMBERSSM12DIGIT: 'registration_number_new',
  SSMNUMBER: 'registration_number_new',
  HAULIERID: 'haulier_id',
  FORWARDINGAGENTID: 'forwarding_agent_id',
  PORT: 'port_id',
  PORTS: 'port_id',
  PORTID: 'port_id',
  DEPOT: 'depot_id',
  DEPOTS: 'depot_id',
  DEPOTID: 'depot_id',
  BLOCK: 'block',
  BUILDINGBLOCKFLOORLOT: 'block',
  ADDRESS1: 'address1',
  ADDRESSLINE1: 'address1',
  ADDRESS2: 'address2',
  ADDRESSLINE2: 'address2',
  CITY: 'city',
  CITYTOWN: 'city',
  STATE: 'state',
  STATEREGION: 'state',
  POSTCODE: 'postcode',
  POSTALCODE: 'postcode',
  COUNTRY: 'country',
  CONTACTNAME: 'contact_name',
  CONTACTPERSON: 'contact_name',
  CONTACTPERSONNAME: 'contact_name',
  CONTACTEMAIL: 'contact_email',
  EMAIL: 'contact_email',
  EMAILADDRESS: 'contact_email',
  CONTACTDESGN: 'contact_designation',
  CONTACTDESIGNATION: 'contact_designation',
  DESIGNATION: 'contact_designation',
  JOBDESIGNATION: 'contact_designation',
  CONTACTMOBILE: 'contact_mobile',
  MOBILENUMBER: 'contact_mobile',
  MOBILE: 'contact_mobile',
  OFFICE: 'office_phone',
  OFFICEPHONE: 'office_phone',
  FAX: 'fax',
  FAXNUMBER: 'fax',
};

function normalizeExcelHeader(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function excelCellValue(value: unknown): string {
  return String(value ?? '').trim();
}

function FieldError({ message }: { message?: string }) {
  return (
    <p aria-live="polite" className="min-h-[12px] text-[10px] text-rose-600 mt-0.5">
      {message || ''}
    </p>
  );
}

export function CompanyForm({
  initialLocation,
  initialData,
  initialPage = 1,
  onSubmit,
  onBack,
}: CompanyFormProps) {
  const autoPorts = getAutoAssignedPorts(initialLocation);
  const facilityLabel = initialLocation === 'PORT_KLANG'
    ? 'Port Klang'
    : initialLocation === 'JOHOR'
      ? 'Johor Depot'
      : 'Other Facility';
  const companyTypeOptions: Array<{ value: CompanyType; label: string }> = initialLocation === 'PORT_KLANG'
    ? [
        { value: 'TRANSPORT', label: 'TRANSPORTER' },
        { value: 'FORWARDER', label: 'FORWARDER' },
      ]
    : [
        { value: 'TRANSPORT', label: 'TRANSPORTER' },
        { value: 'FORWARDER', label: 'FORWARDER' },
        { value: 'HAULAGE', label: 'HAULAGE' },
      ];
  const importedOrSavedCompanyType = normalizeCompanyType(initialData?.company_type);
  const initialCompanyType = companyTypeOptions.some(({ value }) => value === importedOrSavedCompanyType)
    ? importedOrSavedCompanyType
    : companyTypeOptions[0].value;

  const [formData, setFormData] = useState<CompanyFormData>(initialData ? {
    ...initialData,
    company_type: initialCompanyType,
  } : {
    name: '',
    short_name: '',
    company_type: initialCompanyType,
    registration_number: '',
    registration_number_old: '',
    registration_number_new: '',
    port_id: autoPorts.backendIdsString,
    depot_id: '',
    block: '',
    address1: '',
    address2: '',
    city: initialLocation === 'PORT_KLANG' ? 'Pelabuhan Klang' : 'Pasir Gudang',
    state: initialLocation === 'PORT_KLANG' ? 'Selangor' : 'Johor',
    postcode: '',
    country: 'Malaysia',
    contact_name: '',
    contact_email: '',
    contact_designation: 'Operations Manager',
    contact_mobile: '',
    office_phone: '',
    fax: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [transitionDirection, setTransitionDirection] = useState<'forward' | 'backward'>('forward');
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [isExcelMenuOpen, setIsExcelMenuOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const excelMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isExcelMenuOpen) return;

    const closeMenu = (event: MouseEvent) => {
      if (!excelMenuRef.current?.contains(event.target as Node)) setIsExcelMenuOpen(false);
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsExcelMenuOpen(false);
    };

    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [isExcelMenuOpen]);

  const downloadCompanyTemplate = () => {
    const headers = [
      'COMPANY FULL LEGAL NAME',
      'COMPANY SHORT NAME (TRADE NAME)',
      'COMPANY CATEGORY / TYPE',
      'OLD COMPANY REG. NUMBER',
      'NEW COMPANY REG. NUMBER (SSM 12-DIGIT)',
      'BUILDING / BLOCK / FLOOR / LOT',
      'ADDRESS LINE 1',
      'ADDRESS LINE 2',
      'CITY / TOWN',
      'STATE / REGION',
      'POSTCODE',
      'COUNTRY',
      'CONTACT PERSON NAME',
      'EMAIL ADDRESS',
      'DESIGNATION',
      'MOBILE NUMBER',
      'OFFICE PHONE',
      'FAX NUMBER',
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, Array(headers.length).fill('')]);
    worksheet['!cols'] = headers.map((header) => ({ wch: Math.max(16, Math.min(header.length + 3, 34)) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Company Registration');
    XLSX.writeFile(workbook, 'CargoMove_Company_Registration_Template.xlsx');
    setIsExcelMenuOpen(false);
    notifySuccess('Company registration template downloaded.');
  };

  const handleChange = (field: keyof CompanyFormData, val: string) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: val };
      if (field === 'registration_number_old') {
        next.registration_number = val.toUpperCase().trim();
      }
      return next;
    });

    if (errors[field]) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy[field];
        return copy;
      });
    }
  };

  const handleCountryChange = (country: string) => {
    setFormData((prev) => ({
      ...prev,
      country,
      state: statesByCountry[country][0],
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.state;
      delete next.country;
      return next;
    });
  };

  function getValidationErrors(data: CompanyFormData): Record<string, string> {
    const validationErrors: Record<string, string> = {};
    if (!data.name.trim()) validationErrors.name = 'Company Name is required.';
    if (!data.short_name.trim()) validationErrors.short_name = 'Company Short Name is required.';
    if (!companyTypeOptions.some(({ value }) => value === data.company_type)) {
      validationErrors.company_type = `Select a company category available for ${facilityLabel}.`;
    }
    if (!data.registration_number_old?.trim()) validationErrors.registration_number_old = 'Old Registration Number is required.';
    if (data.registration_number_new?.trim() && !/^\d{12}$/.test(data.registration_number_new.trim())) {
      validationErrors.registration_number_new = 'New SSM registration number must contain exactly 12 digits.';
    }
    if (!data.address1?.trim()) validationErrors.address1 = 'Address Line 1 is required.';
    if (!data.country?.trim() || !statesByCountry[data.country]) validationErrors.country = 'Select a supported country.';
    if (!data.state?.trim() || !statesByCountry[data.country || '']?.includes(data.state)) {
      validationErrors.state = 'Select a valid state or region for the selected country.';
    }
    if (!data.city?.trim()) validationErrors.city = 'City is required.';
    if (!data.postcode?.trim()) validationErrors.postcode = 'Postcode is required.';
    if (!data.contact_name?.trim()) validationErrors.contact_name = 'Contact Person Name is required.';
    if (!data.contact_email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact_email.trim())) {
      validationErrors.contact_email = 'A valid email is required.';
    }
    if (!data.contact_mobile?.trim()) validationErrors.contact_mobile = 'Mobile Number is required.';
    return validationErrors;
  }

  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsImportingExcel(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error('The Excel workbook does not contain a worksheet.');

      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
        header: 1,
        raw: false,
        defval: '',
      });

      let headerRowIndex = -1;
      let mappedColumns: Array<{ columnIndex: number; field: keyof CompanyFormData }> = [];
      rows.slice(0, 20).forEach((row, rowIndex) => {
        const candidate = row
          .map((header, columnIndex) => ({
            columnIndex,
            field: companyExcelHeaders[normalizeExcelHeader(header)],
          }))
          .filter((column): column is { columnIndex: number; field: keyof CompanyFormData } => Boolean(column.field));
        if (candidate.length > mappedColumns.length) {
          headerRowIndex = rowIndex;
          mappedColumns = candidate;
        }
      });

      if (headerRowIndex < 0 || mappedColumns.length === 0) {
        throw new Error('No recognized company headers were found in the first worksheet.');
      }

      const populatedDataRows = rows
        .slice(headerRowIndex + 1)
        .filter((row) => mappedColumns.some(({ columnIndex }) => excelCellValue(row[columnIndex])));
      const dataRow = populatedDataRows[0];
      if (!dataRow) throw new Error('No company data row was found below the Excel headers.');

      const imported: Partial<Record<keyof CompanyFormData, string>> = {};
      const importWarnings: string[] = [];
      mappedColumns.forEach(({ columnIndex, field }) => {
        const value = excelCellValue(dataRow[columnIndex]);
        imported[field] = value;
      });

      if (imported.company_type) {
        const normalizedCompanyType = normalizeCompanyType(imported.company_type);
        if (companyTypeOptions.some(({ value }) => value === normalizedCompanyType)) {
          imported.company_type = normalizedCompanyType;
        } else {
          importWarnings.push(`${normalizedCompanyType} is not available for ${facilityLabel}.`);
          imported.company_type = '';
        }
      }
      if (imported.country) {
        const supportedCountry = Object.keys(statesByCountry).find(
          (country) => country.toLowerCase() === imported.country?.toLowerCase()
        );
        if (supportedCountry) {
          imported.country = supportedCountry;
        } else {
          importWarnings.push(`Country "${imported.country}" is not supported.`);
          imported.country = '';
        }
      }
      if (imported.state) {
        const country = imported.country || formData.country;
        const supportedState = statesByCountry[country]?.find(
          (state) => state.toLowerCase() === imported.state?.toLowerCase()
        );
        if (supportedState) {
          imported.state = supportedState;
        } else {
          importWarnings.push(`State or region "${imported.state}" is not valid for ${country || 'the selected country'}.`);
          imported.state = '';
        }
      }
      if (imported.registration_number_old) {
        imported.registration_number_old = imported.registration_number_old.toUpperCase();
        imported.registration_number = imported.registration_number_old;
      }

      const nextFormData = { ...formData, ...imported } as CompanyFormData;
      const validationErrors = getValidationErrors(nextFormData);
      const importedFieldCount = Object.values(imported).filter((value) => value?.trim()).length;
      setFormData(nextFormData);
      setErrors(validationErrors);

      const invalidFields = Object.keys(validationErrors);
      if (invalidFields.length === 0) {
        notifySuccess(`${importedFieldCount} fields filled from ${file.name}. All required details passed validation.`);
      } else {
        const pageOneFields = ['name', 'short_name', 'company_type', 'registration_number_old', 'registration_number_new'];
        const pageTwoFields = ['address1', 'country', 'state', 'city', 'postcode'];
        setCurrentPage(invalidFields.some((field) => pageOneFields.includes(field)) ? 1 : invalidFields.some((field) => pageTwoFields.includes(field)) ? 2 : 3);
        importWarnings.push(`${invalidFields.length} required or invalid field${invalidFields.length === 1 ? '' : 's'} must be corrected before continuing.`);
      }
      if (populatedDataRows.length > 1) {
        importWarnings.push('Only the first populated company row was imported.');
      }
      if (importWarnings.length > 0) notifyWarning(importWarnings.join(' '));
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to read the Excel file.');
    } finally {
      setIsImportingExcel(false);
    }
  };

  const validate = () => {
    const errs = getValidationErrors(formData);
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validatePage = (page: number) => {
    const pageFields: Record<number, (keyof CompanyFormData)[]> = {
      1: ['name', 'short_name', 'company_type', 'registration_number_old', 'registration_number_new'],
      2: ['address1', 'country', 'city', 'state', 'postcode'],
      3: ['contact_name', 'contact_email', 'contact_mobile'],
    };
    const formErrors = getValidationErrors(formData);
    const allErrors = Object.fromEntries(
      Object.entries(formErrors).filter(([field]) => pageFields[page].includes(field as keyof CompanyFormData))
    );

    setErrors(allErrors);
    return Object.keys(allErrors).length === 0;
  };

  const handleNext = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    if (validatePage(currentPage)) {
      setTransitionDirection('forward');
      setCurrentPage((page) => Math.min(page + 1, 3));
    }
  };

  const handleBack = () => {
    setTransitionDirection('backward');
    if (currentPage === 1) {
      onBack();
    } else {
      setCurrentPage((page) => page - 1);
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLFormElement>) => {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLFormElement>) => {
    if (touchStartX.current === null) return;
    const swipeDistance = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(swipeDistance) < 50) return;
    if (swipeDistance < 0 && currentPage < 3) handleNext();
    if (swipeDistance > 0 && currentPage > 1) {
      setTransitionDirection('backward');
      setCurrentPage((page) => page - 1);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="customer-form max-w-3xl mx-auto min-h-[calc(100vh-270px)] flex flex-col gap-3 touch-pan-y"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight">
            Company Registration Form - {facilityLabel}
          </h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Fill in legal company profile and primary operational contact details.
          </p>
        </div>

        <input
          ref={excelInputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm"
          onChange={handleExcelUpload}
          className="hidden"
          aria-label="Upload company details Excel file"
        />
        <div ref={excelMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setIsExcelMenuOpen((open) => !open)}
            disabled={isImportingExcel}
            aria-label="Company form options"
            aria-haspopup="menu"
            aria-expanded={isExcelMenuOpen}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-wait disabled:opacity-60"
          >
            {isImportingExcel
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <EllipsisVertical className="h-4 w-4" />}
          </button>

          {isExcelMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={downloadCompanyTemplate}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Download className="h-4 w-4 text-[#0090e7]" />
                Download Form Template
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsExcelMenuOpen(false);
                  excelInputRef.current?.click();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Upload className="h-4 w-4 text-emerald-600" />
                Upload Filled Form
              </button>
            </div>
          )}
        </div>

      </div>

      <div className="flex items-center justify-center gap-2 text-[10px] font-semibold text-slate-500">
        {['Company Details', 'Address', 'PIC Information'].map((label, index) => (
          <React.Fragment key={label}>
            <span className={currentPage === index + 1 ? 'text-[#0090e7]' : ''}>{index + 1}. {label}</span>
            {index < 2 && <span className="text-slate-300">/</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Section 1: Corporate Registration Details */}
      <div key={currentPage} className={`flex-1 min-h-[330px] page-slide-${transitionDirection}`}>
      {currentPage === 1 && <div className="h-full bg-white rounded-lg border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-xs uppercase tracking-wider pb-2">
          <Building2 className="w-4 h-4 text-[#0090e7]" />
          Corporate & Registration Details
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Company Full Legal Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="LUMORA TECH SDN BHD"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs font-medium focus:ring-1 focus:ring-sky-500 focus:outline-none uppercase"
            />
            <FieldError message={errors.name} />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Company Short Name (Trade Name) <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={formData.short_name}
              onChange={(e) => handleChange('short_name', e.target.value)}
              placeholder="LUMORA TECH"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none uppercase"
            />
            <FieldError message={errors.short_name} />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Company Category / Type <span className="text-rose-500">*</span>
            </label>
            <div>
              <select
                value={formData.company_type}
                onChange={(e) => handleChange('company_type', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white font-medium text-slate-800"
              >
                <option value="" disabled>Select company category</option>
                {companyTypeOptions.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <FieldError message={errors.company_type} />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Old Company Reg. Number <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={formData.registration_number_old}
              onChange={(e) => handleChange('registration_number_old', e.target.value)}
              placeholder="AAAAAA-2"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none uppercase font-mono"
            />
            <FieldError message={errors.registration_number_old} />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              New Company Reg. Number (SSM 12-digit)
            </label>
            <input
              type="text"
              value={formData.registration_number_new}
              onChange={(e) => handleChange('registration_number_new', e.target.value)}
              placeholder="201901004521"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none font-mono"
            />
            <FieldError message={errors.registration_number_new} />
          </div>
        </div>
      </div>}

      {/* Section 2: Registered Business Address */}
      {currentPage === 2 && <div className="h-full bg-white rounded-lg border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-xs uppercase tracking-wider pb-2">
          <Building2 className="w-4 h-4 text-[#0090e7]" />
          Registered Business Address
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Building / Block / Floor / Lot
            </label>
            <input
              type="text"
              value={formData.block}
              onChange={(e) => handleChange('block', e.target.value)}
              placeholder="Wisma Logistik, Level 3"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Address Line 1 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={formData.address1}
              onChange={(e) => handleChange('address1', e.target.value)}
              placeholder="No. 12, Jalan Perindustrian 4"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
            <FieldError message={errors.address1} />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Address Line 2
            </label>
            <input
              type="text"
              value={formData.address2}
              onChange={(e) => handleChange('address2', e.target.value)}
              placeholder="Kawasan Perindustrian Pelabuhan"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Country <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.country}
                onChange={(e) => handleCountryChange(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white text-slate-800"
              >
                <option value="" disabled>Select country</option>
                <option value="Malaysia">Malaysia</option>
                <option value="Singapore">Singapore</option>
              </select>
              <FieldError message={errors.country} />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                State / Region <span className="text-rose-500">*</span>
              </label>
              <select
                value={formData.state}
                onChange={(e) => handleChange('state', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white text-slate-800"
              >
                {statesByCountry[formData.country]?.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
              <FieldError message={errors.state} />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                City <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                placeholder="Pasir Gudang"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
              />
              <FieldError message={errors.city} />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Postcode <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={formData.postcode}
                onChange={(e) => handleChange('postcode', e.target.value)}
                placeholder="81700"
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
              />
              <FieldError message={errors.postcode} />
            </div>
          </div>
        </div>
      </div>}

      {/* Section 3: Primary Operational Contact */}
      {currentPage === 3 && <div className="h-full bg-white rounded-lg border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-xs uppercase tracking-wider pb-2">
          <Phone className="w-4 h-4 text-[#0090e7]" />
          Person-Incharge Information
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Contact Person Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={formData.contact_name}
              onChange={(e) => handleChange('contact_name', e.target.value)}
              placeholder="Kevin Tan"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
            <FieldError message={errors.contact_name} />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Designation / Title
            </label>
            <input
              type="text"
              value={formData.contact_designation}
              onChange={(e) => handleChange('contact_designation', e.target.value)}
              placeholder="Logistics Manager"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Contact Email Address <span className="text-rose-500">*</span>
            </label>
            <input
              type="email"
              value={formData.contact_email}
              onChange={(e) => handleChange('contact_email', e.target.value)}
              placeholder="kevin@company.com"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
            <FieldError message={errors.contact_email} />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Mobile Contact Number <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={formData.contact_mobile}
              onChange={(e) => handleChange('contact_mobile', e.target.value)}
              placeholder="+60123456789"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
            <FieldError message={errors.contact_mobile} />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Office Landline
            </label>
            <input
              type="text"
              value={formData.office_phone}
              onChange={(e) => handleChange('office_phone', e.target.value)}
              placeholder="+6072518899"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Fax Number
            </label>
            <input
              type="text"
              value={formData.fax}
              onChange={(e) => handleChange('fax', e.target.value)}
              placeholder="+6072518898"
              className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
          </div>
        </div>
      </div>}

      </div>

      {/* Action Buttons */}
      <div className="h-9 shrink-0 flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-9 items-center gap-1.5 px-3.5 py-0 rounded text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>

        {currentPage < 3 ? (
          <button
            type="button"
            onClick={(event) => handleNext(event)}
            className="inline-flex h-9 items-center gap-1.5 px-5 py-0 rounded text-xs font-bold text-white bg-[#0095e8] hover:bg-[#0078c8] transition-colors shadow-xs"
          >
            Next
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-1.5 px-5 py-0 rounded text-xs font-bold text-white bg-[#0095e8] hover:bg-[#0078c8] transition-colors shadow-xs"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            Next: Login Account
          </button>
        )}
      </div>
    </form>
  );
}

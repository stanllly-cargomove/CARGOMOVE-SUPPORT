import React, { useEffect, useRef, useState } from 'react';
import { Company, DriverData, PortConfig } from '../../../types';
import { getAutoAssignedPorts } from '../../../services/storage';
import { CheckCircle2, Plus, Trash2, IdCard, User, ChevronDown } from 'lucide-react';
import { CompanyContextCard } from '../CompanyContextCard';

const COUNTRY_OPTIONS = [
  { code: '+60', country: 'Malaysia' },
  { code: '+62', country: 'Indonesia' },
  { code: '+65', country: 'Singapore' },
] as const;
type CountryCode = (typeof COUNTRY_OPTIONS)[number]['code'];

// Malaysia is stored locally; Indonesia and Singapore retain their international country code.
const toStoredMobileNumber = (value: string, countryCode: CountryCode) => {
  const digits = value.replace(/^0+/, '');
  if (!digits) return countryCode === '+60' ? '0' : countryCode;
  return countryCode === '+60' ? `0${digits}` : `${countryCode}${digits}`;
};

interface DriverFormProps {
  company: Company;
  port: PortConfig;
  onSubmit: (data: DriverData[]) => void;
  onBack: () => void;
}

export function DriverForm({ company, onSubmit, onBack }: DriverFormProps) {
  const autoPorts = getAutoAssignedPorts('JOHOR');

  const [drivers, setDrivers] = useState<DriverData[]>([
    { driving_license: '', name: '', mobile_no: '' },
  ]);
  const [mobileCountryCodes, setMobileCountryCodes] = useState<CountryCode[]>(['+60']);
  const [openCountryIndex, setOpenCountryIndex] = useState<number | null>(null);
  const countryDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openCountryIndex === null) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (!countryDropdownRef.current?.contains(event.target as Node)) {
        setOpenCountryIndex(null);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [openCountryIndex]);

  const [errors, setErrors] = useState<{ [index: number]: Partial<Record<keyof DriverData, string>> }>({});

  const handleAddRow = () => {
    setDrivers((prev) => [...prev, { driving_license: '', name: '', mobile_no: '' }]);
    setMobileCountryCodes((prev) => [...prev, '+60']);
  };

  const handleRemoveRow = (index: number) => {
    if (drivers.length <= 1) return;
    setDrivers((prev) => prev.filter((_, i) => i !== index));
    setMobileCountryCodes((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleFieldChange = (index: number, field: keyof DriverData, value: string) => {
    setDrivers((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });

    if (errors[index]?.[field]) {
      setErrors((prev) => ({
        ...prev,
        [index]: { ...prev[index], [field]: undefined },
      }));
    }
  };

  const validate = () => {
    const errMap: { [index: number]: Partial<Record<keyof DriverData, string>> } = {};
    let isValid = true;

    drivers.forEach((driver, idx) => {
      const rowErrs: Partial<Record<keyof DriverData, string>> = {};
      if (!driver.driving_license.trim()) {
        rowErrs.driving_license = 'NRIC or passport number is required.';
        isValid = false;
      } else if (!/^\d+$/.test(driver.driving_license)) {
        rowErrs.driving_license = 'Use numbers only, without spaces or dashes.';
        isValid = false;
      }
      if (!driver.name.trim()) {
        rowErrs.name = 'Driver name is required.';
        isValid = false;
      }
      if (!driver.mobile_no.trim()) {
        rowErrs.mobile_no = 'Mobile is required.';
        isValid = false;
      } else if (!/^\d+$/.test(driver.mobile_no)) {
        rowErrs.mobile_no = 'Use numbers only, without spaces or dashes.';
        isValid = false;
      }
      if (Object.keys(rowErrs).length > 0) {
        errMap[idx] = rowErrs;
      }
    });

    setErrors(errMap);
    return isValid;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(drivers.map((driver, index) => ({
        ...driver,
        mobile_no: toStoredMobileNumber(driver.mobile_no, mobileCountryCodes[index]),
      })));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="customer-form max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Driver Registration</h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-[#0090e7]">
              {drivers.length} {drivers.length === 1 ? 'Driver' : 'Drivers'}
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-0.5">
            Register single or multiple commercial drivers simultaneously under your company.
          </p>
        </div>

      </div>

      <CompanyContextCard company={company} assignedFacilities={autoPorts.portNames} />

      {/* Multi-Row Driver Entries */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-visible">
        <div className="px-4 py-2.5 bg-slate-50 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Driver List ({drivers.length})
          </span>
          <span className="text-[11px] text-slate-500">
            Each row represents one authorized driver record
          </span>
        </div>

        <div className="p-3 space-y-3">
          {drivers.map((driver, index) => (
            <div
              key={index}
              className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold">
                    {index + 1}
                  </span>
                  <span className="text-xs font-bold text-slate-700">Driver #{index + 1}</span>
                </div>

                {drivers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(index)}
                    className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2 py-0.5 rounded transition-colors"
                    title="Remove this driver row"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove Row
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                {/* Driving Licence / NRIC */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    NRIC / Passport <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={driver.driving_license}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      onChange={(e) => {
                        if (/^\d*$/.test(e.target.value)) {
                          handleFieldChange(index, 'driving_license', e.target.value);
                        }
                      }}
                      placeholder="e.g. 000000000000"
                      className="w-full px-2 py-1.5 pl-7 rounded border border-slate-300 text-xs font-mono uppercase focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white"
                    />
                    <IdCard className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  </div>
                  {errors[index]?.driving_license && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.driving_license}</p>
                  )}
                </div>

                {/* Driver Full Name */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Driver Full Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={driver.name}
                      onChange={(e) => handleFieldChange(index, 'name', e.target.value.toUpperCase())}
                      placeholder="MOHD RAZALI BIN HASSAN"
                      className="w-full px-2 py-1.5 pl-7 rounded border border-slate-300 text-xs font-medium uppercase focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white"
                    />
                    <User className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  </div>
                  {errors[index]?.name && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.name}</p>
                  )}
                </div>

                {/* Mobile Phone */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Mobile Phone Number <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="flex">
                      <div ref={index === openCountryIndex ? countryDropdownRef : undefined} className="relative shrink-0">
                        <button
                          type="button"
                          aria-label="Country code"
                          aria-expanded={openCountryIndex === index}
                          onClick={() => setOpenCountryIndex(openCountryIndex === index ? null : index)}
                          className="flex h-full items-center gap-1 rounded-l border border-slate-300 border-r-0 bg-slate-50 px-1.5 py-1.5 text-xs font-medium text-slate-700 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                        >
                          <span>{mobileCountryCodes[index]}</span>
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {openCountryIndex === index && (
                          <div className="absolute left-0 top-full z-20 mt-1 min-w-[11rem] overflow-hidden rounded border border-slate-300 bg-white shadow-lg">
                            {COUNTRY_OPTIONS.map(({ code, country }) => (
                              <button
                                key={code}
                                type="button"
                                onClick={() => {
                                  setMobileCountryCodes((prev) => {
                                    const next = [...prev];
                                    next[index] = code;
                                    return next;
                                  });
                                  setOpenCountryIndex(null);
                                }}
                                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-sky-50"
                              >
                                <span>{code} {country}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={driver.mobile_no}
                        onChange={(e) => {
                          if (/^\d*$/.test(e.target.value)) {
                            handleFieldChange(index, 'mobile_no', e.target.value);
                          }
                        }}
                        placeholder="e.g. 0000000000"
                        className="min-w-0 flex-1 rounded-r border border-slate-300 px-2 py-1.5 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white"
                      />
                    </div>
                  </div>
                  {errors[index]?.mobile_no && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.mobile_no}</p>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Add Another Driver Button */}
          <button
            type="button"
            onClick={handleAddRow}
            className="w-full py-2 border-2 border-dashed border-sky-300 hover:border-sky-400 bg-sky-50/50 hover:bg-sky-50 text-[#0090e7] rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Another Driver Row
          </button>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="px-3.5 py-1.5 rounded text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
        >
          &larr; Back
        </button>

        <button
          type="submit"
          className="px-5 py-2 rounded text-xs font-bold text-white bg-[#ea7a24] hover:bg-[#d96c1a] transition-colors shadow-xs flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Review {drivers.length} {drivers.length === 1 ? 'Driver' : 'Drivers'} &rarr;
        </button>
      </div>
    </form>
  );
}

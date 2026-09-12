import React, { useState } from 'react';
import { Company, TrailerData, PortConfig } from '../../../types';
import { getAutoAssignedPorts } from '../../../services/storage';
import { Building2, Sparkles, CheckCircle2, Plus, Trash2, Container, Scale } from 'lucide-react';

interface TrailerFormProps {
  company: Company;
  port: PortConfig;
  onSubmit: (data: TrailerData[]) => void;
  onBack: () => void;
}

export function TrailerForm({ company, onSubmit, onBack }: TrailerFormProps) {
  const autoPorts = getAutoAssignedPorts('JOHOR');

  const [trailers, setTrailers] = useState<TrailerData[]>([
    {
      registration_number: '',
      weight: '',
      trailer_type: 'FL',
      bdm_weight: '',
    },
  ]);

  const [errors, setErrors] = useState<{ [index: number]: Partial<Record<keyof TrailerData, string>> }>({});

  const handleAddRow = () => {
    setTrailers((prev) => [
      ...prev,
      {
        registration_number: '',
        weight: '',
        trailer_type: 'FL',
        bdm_weight: '',
      },
    ]);
  };

  const handleRemoveRow = (index: number) => {
    if (trailers.length <= 1) return;
    setTrailers((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleFieldChange = (index: number, field: keyof TrailerData, value: string) => {
    setTrailers((prev) => {
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

  const handleFillDemo = () => {
    setTrailers([
      {
        registration_number: 'JTE 8832',
        weight: '6400',
        trailer_type: 'FL',
        bdm_weight: '38000',
      },
      {
        registration_number: 'JTE 8833',
        weight: '6800',
        trailer_type: 'SL',
        bdm_weight: '40000',
      },
    ]);
    setErrors({});
  };

  const validate = () => {
    const errMap: { [index: number]: Partial<Record<keyof TrailerData, string>> } = {};
    let isValid = true;

    trailers.forEach((trailer, idx) => {
      const rowErrs: Partial<Record<keyof TrailerData, string>> = {};
      if (!trailer.registration_number.trim()) {
        rowErrs.registration_number = 'Plate number is required.';
        isValid = false;
      }
      if (!trailer.weight.trim()) {
        rowErrs.weight = 'Weight is required.';
        isValid = false;
      }
      if (!trailer.bdm_weight.trim()) {
        rowErrs.bdm_weight = 'BDM is required.';
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
      onSubmit(trailers);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="customer-form max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Trailer Registration</h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-[#0090e7]">
              {trailers.length} {trailers.length === 1 ? 'Trailer' : 'Trailers'}
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-0.5">
            Register single or multiple commercial trailers. Trailer types are restricted to FL (Front Load) and SL (Side Load).
          </p>
        </div>

        <button
          type="button"
          onClick={handleFillDemo}
          className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 transition-colors"
        >
          <Sparkles className="w-3 h-3 mr-1 text-sky-600" />
          Auto-fill Sample
        </button>
      </div>

      {/* Verified Company & Auto Port Context Box */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-sky-100 text-[#0090e7] flex items-center justify-center font-bold">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase font-bold">Registered Company</div>
            <div className="text-xs font-bold text-slate-900">{company.name}</div>
            <div className="text-[11px] text-slate-500">
              Reg: <span className="font-mono">{company.registration_number}</span> &bull; Type: {company.company_type}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] text-slate-400 uppercase font-bold">Assigned Facilities</div>
          <div className="text-xs font-bold text-sky-700">{autoPorts.portNames.join(', ')}</div>
          <div className="text-[10px] text-slate-500 font-medium">Johor Operations</div>
        </div>
      </div>

      {/* Multi-Row Trailer Entries */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Trailer List ({trailers.length})
          </span>
          <span className="text-[11px] text-slate-500">
            Allowed Trailer Types: FL (Front Load) &bull; SL (Side Load)
          </span>
        </div>

        <div className="p-3 space-y-3">
          {trailers.map((trailer, index) => (
            <div
              key={index}
              className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold">
                    {index + 1}
                  </span>
                  <span className="text-xs font-bold text-slate-700">Trailer #{index + 1}</span>
                </div>

                {trailers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(index)}
                    className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2 py-0.5 rounded transition-colors"
                    title="Remove this trailer row"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove Row
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-xs">
                {/* Trailer Registration / Plate */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Registration No <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={trailer.registration_number}
                      onChange={(e) => handleFieldChange(index, 'registration_number', e.target.value.toUpperCase())}
                      placeholder="JTE 8832"
                      className="w-full px-2 py-1.5 pl-7 rounded border border-slate-300 text-xs font-mono uppercase focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white"
                    />
                    <Container className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  </div>
                  {errors[index]?.registration_number && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.registration_number}</p>
                  )}
                </div>

                {/* Trailer Type (FL and SL only) */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Trailer Type <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={trailer.trailer_type}
                    onChange={(e) => handleFieldChange(index, 'trailer_type', e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs font-semibold focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white"
                  >
                    <option value="FL">FL (Front Load)</option>
                    <option value="SL">SL (Side Load)</option>
                  </select>
                </div>

                {/* Unladen Weight */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Unladen Weight (KG) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={trailer.weight}
                      onChange={(e) => handleFieldChange(index, 'weight', e.target.value)}
                      placeholder="6400"
                      className="w-full px-2 py-1.5 pl-7 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none font-mono bg-white"
                    />
                    <Scale className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  </div>
                  {errors[index]?.weight && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.weight}</p>
                  )}
                </div>

                {/* BDM Gross Weight */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    BDM Weight (KG) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={trailer.bdm_weight}
                      onChange={(e) => handleFieldChange(index, 'bdm_weight', e.target.value)}
                      placeholder="38000"
                      className="w-full px-2 py-1.5 pl-7 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none font-mono bg-white"
                    />
                    <Scale className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  </div>
                  {errors[index]?.bdm_weight && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.bdm_weight}</p>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Add Another Trailer Button */}
          <button
            type="button"
            onClick={handleAddRow}
            className="w-full py-2 border-2 border-dashed border-sky-300 hover:border-sky-400 bg-sky-50/50 hover:bg-sky-50 text-[#0090e7] rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Another Trailer Row
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
          Review {trailers.length} {trailers.length === 1 ? 'Trailer' : 'Trailers'} &rarr;
        </button>
      </div>
    </form>
  );
}

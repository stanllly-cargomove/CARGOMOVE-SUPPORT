import React, { useState } from 'react';
import { Company, VehicleData, PortConfig } from '../../../types';
import { getAutoAssignedPorts } from '../../../services/storage';
import { Building2, CheckCircle2, Plus, Trash2, Truck, Scale, Hash } from 'lucide-react';

interface VehicleFormProps {
  company: Company;
  port: PortConfig;
  onSubmit: (data: VehicleData[]) => void;
  onBack: () => void;
}

export function VehicleForm({ company, onSubmit, onBack }: VehicleFormProps) {
  const autoPorts = getAutoAssignedPorts('JOHOR');

  const [vehicles, setVehicles] = useState<VehicleData[]>([
    {
      registration_number: '',
      head: '',
      weight: '',
      bgk_weight: '',
    },
  ]);

  const [errors, setErrors] = useState<{ [index: number]: Partial<Record<keyof VehicleData, string>> }>({});

  const handleAddRow = () => {
    setVehicles((prev) => [
      ...prev,
      {
        registration_number: '',
        head: '',
        weight: '',
        bgk_weight: '',
      },
    ]);
  };

  const handleRemoveRow = (index: number) => {
    if (vehicles.length <= 1) return;
    setVehicles((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleFieldChange = (index: number, field: keyof VehicleData, value: string) => {
    setVehicles((prev) => {
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
    const errMap: { [index: number]: Partial<Record<keyof VehicleData, string>> } = {};
    let isValid = true;

    vehicles.forEach((vehicle, idx) => {
      const rowErrs: Partial<Record<keyof VehicleData, string>> = {};
      if (!vehicle.registration_number.trim()) {
        rowErrs.registration_number = 'Registration number is required.';
        isValid = false;
      }
      if (!vehicle.head.trim()) {
        rowErrs.head = 'Head number is required.';
        isValid = false;
      }
      if (!vehicle.weight.trim()) {
        rowErrs.weight = 'Weight is required.';
        isValid = false;
      }
      if (!vehicle.bgk_weight.trim()) {
        rowErrs.bgk_weight = 'BGK weight is required.';
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
      onSubmit(vehicles);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="customer-form max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Prime Mover / Vehicle Registration</h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-[#0090e7]">
              {vehicles.length} {vehicles.length === 1 ? 'Vehicle' : 'Vehicles'}
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-0.5">
            Register single or multiple prime mover vehicles. Head Number is arranged adjacent to Registration Number.
          </p>
        </div>

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

      {/* Multi-Row Vehicle Entries */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Vehicle List ({vehicles.length})
          </span>
          <span className="text-[11px] text-slate-500">
            Head Number maps directly to HEAD in backend Excel export
          </span>
        </div>

        <div className="p-3 space-y-3">
          {vehicles.map((vehicle, index) => (
            <div
              key={index}
              className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold">
                    {index + 1}
                  </span>
                  <span className="text-xs font-bold text-slate-700">Vehicle #{index + 1}</span>
                </div>

                {vehicles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(index)}
                    className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2 py-0.5 rounded transition-colors"
                    title="Remove this vehicle row"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove Row
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-xs">
                {/* 1. Vehicle Registration Number */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Registration No <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={vehicle.registration_number}
                      onChange={(e) => handleFieldChange(index, 'registration_number', e.target.value.toUpperCase())}
                      placeholder="JVF 4920"
                      className="w-full px-2 py-1.5 pl-7 rounded border border-slate-300 text-xs font-mono uppercase focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white"
                    />
                    <Truck className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  </div>
                  {errors[index]?.registration_number && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.registration_number}</p>
                  )}
                </div>

                {/* 2. Head Number (Arranged NEXT to Registration Number) */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Head Number <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={vehicle.head}
                      onChange={(e) => handleFieldChange(index, 'head', e.target.value.toUpperCase())}
                      placeholder="HD-801"
                      className="w-full px-2 py-1.5 pl-7 rounded border border-slate-300 text-xs font-mono uppercase focus:ring-1 focus:ring-sky-500 focus:outline-none bg-white"
                    />
                    <Hash className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  </div>
                  {errors[index]?.head && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.head}</p>
                  )}
                </div>

                {/* 3. Unladen Kerb Weight */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Unladen Weight (KG) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={vehicle.weight}
                      onChange={(e) => handleFieldChange(index, 'weight', e.target.value)}
                      placeholder="8400"
                      className="w-full px-2 py-1.5 pl-7 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none font-mono bg-white"
                    />
                    <Scale className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  </div>
                  {errors[index]?.weight && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.weight}</p>
                  )}
                </div>

                {/* 4. BGK Combined Weight */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    BGK Weight (KG) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={vehicle.bgk_weight}
                      onChange={(e) => handleFieldChange(index, 'bgk_weight', e.target.value)}
                      placeholder="44000"
                      className="w-full px-2 py-1.5 pl-7 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none font-mono bg-white"
                    />
                    <Scale className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  </div>
                  {errors[index]?.bgk_weight && (
                    <p className="text-[10px] text-rose-600 mt-0.5">{errors[index]?.bgk_weight}</p>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Add Another Vehicle Button */}
          <button
            type="button"
            onClick={handleAddRow}
            className="w-full py-2 border-2 border-dashed border-sky-300 hover:border-sky-400 bg-sky-50/50 hover:bg-sky-50 text-[#0090e7] rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Another Vehicle Row
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
          Review {vehicles.length} {vehicles.length === 1 ? 'Vehicle' : 'Vehicles'} &rarr;
        </button>
      </div>
    </form>
  );
}

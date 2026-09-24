import React from 'react';
import { PortLocation, RegistrationType } from '../../types';
import { Building2, User, Caravan, Truck, CheckCircle2, ArrowLeft, ArrowRight, AlertCircle } from 'lucide-react';

interface TypeSelectionProps {
  location: PortLocation;
  selectedType: RegistrationType | null;
  onSelectType: (type: RegistrationType) => void;
  onBack: () => void;
  onNext: () => void;
}

export function TypeSelection({
  location,
  selectedType,
  onSelectType,
  onBack,
  onNext,
}: TypeSelectionProps) {
  const isPortKlang = location === 'PORT_KLANG';

  const typesConfig: {
    type: RegistrationType;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    allowed: boolean;
  }[] = [
    {
      type: 'COMPANY',
      title: 'Company Registration',
      description: 'Register a new Forwarder, Haulier, or Transporter entity with port authorities.',
      icon: Building2,
      allowed: true,
    },
    {
      type: 'DRIVER',
      title: 'Driver Registration',
      description: 'Register commercial haulage drivers and operators for depot access gates.',
      icon: User,
      allowed: !isPortKlang,
    },
    {
      type: 'TRAILER',
      title: 'Trailer Registration',
      description: 'Register non-powered flatbed and skeletal trailers with permitted BDM weights.',
      icon: Caravan,
      allowed: !isPortKlang,
    },
    {
      type: 'VEHICLE',
      title: 'Vehicle Registration',
      description: 'Register prime movers, lorries, unladen weights, and BGK capacity.',
      icon: Truck,
      allowed: !isPortKlang,
    },
  ];

  const availableTypes = isPortKlang ? typesConfig.filter((t) => t.type === 'COMPANY') : typesConfig;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="mb-4 text-center">
        <div className="mb-2 inline-flex items-center rounded bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700">
          Port: <span className="ml-1 font-bold text-indigo-700">{location === 'PORT_KLANG' ? 'Port Klang' : 'Johor (Pasir Gudang)'}</span>
        </div>
        <h2 className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl">Select Registration Category</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {isPortKlang
            ? 'For Port Klang, company registration is required to establish EDI gate credentials.'
            : 'Select the operational asset or company entity you need to register for Johor port clearance.'}
        </p>
      </div>

      {isPortKlang && (
        <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#0090e7]" />
          <div className="text-xs leading-5 text-sky-900">
            <strong className="font-semibold">Port Klang Protocol:</strong> Under Port Klang terminal gate rules, Driver, Trailer, and Vehicle credentials are managed via direct port haulier passes. Only <strong>Company Registration</strong> is required through this portal.
          </div>
        </div>
      )}

      <div className={`grid gap-3 ${isPortKlang ? 'mx-auto max-w-2xl grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {availableTypes.map((item) => {
          const Icon = item.icon;
          const isSelected = selectedType === item.type;

          return (
            <div
              key={item.type}
              onClick={() => onSelectType(item.type)}
              className={`relative min-h-[112px] cursor-pointer rounded-lg border bg-white p-4 transition-all sm:p-5 ${
                isSelected
                  ? 'border-[#0090e7] shadow-xs ring-2 ring-sky-100'
                  : 'border-slate-200 hover:border-slate-300 hover:shadow-xs'
              }`}
            >
              {isSelected && (
                <div className="absolute right-4 top-4 text-[#0090e7]">
                  <CheckCircle2 className="h-4 w-4 fill-[#0090e7] text-white" />
                </div>
              )}

              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-[#0090e7]">
                  <Icon className="h-6 w-6" />
                </div>
                <div className="min-w-0 pr-3">
                  <h3 className="mb-1 text-sm font-bold leading-5 text-slate-900">{item.title}</h3>
                  <p className="text-[11px] leading-4 text-slate-500">{item.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center rounded px-4 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Port
        </button>

        <button
          type="button"
          disabled={!selectedType}
          onClick={onNext}
          className="inline-flex h-10 items-center rounded bg-[#ea7a24] px-5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#d96c1a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue to Form
          <ArrowRight className="ml-2 h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Company } from '../../types';
import { lookupRegisteredCompany } from '../../services/registration';
import { Search, CheckCircle2, AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';

interface CompanyLookupProps {
  selectedCompany: Company | null;
  onSelectCompany: (company: Company | null) => void;
  onBack: () => void;
  onNext: () => void;
  onRegisterNewCompany: () => void;
}

export function CompanyLookup({
  selectedCompany,
  onSelectCompany,
  onBack,
  onNext,
  onRegisterNewCompany,
}: CompanyLookupProps) {
  const [query, setQuery] = useState(selectedCompany?.registration_number || '');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async () => {
    const term = query.trim();
    if (!term) {
      setErrorMsg('Please enter a Company Registration Number to search.');
      return;
    }

    setErrorMsg('');
    setIsSearching(true);
    onSelectCompany(null);
    try {
      const found = await lookupRegisteredCompany(term);
      if (found) {
        if (found.status === 'INACTIVE') {
          setErrorMsg(`Company "${found.name}" is currently inactive in the port master. Please contact port support.`);
          return;
        }
        onSelectCompany(found);
      } else {
        setErrorMsg(`No master company record found matching "${term}". Please ensure you entered the exact registration number or register your company first.`);
      }
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Unable to verify the company right now.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="customer-form max-w-2xl mx-auto space-y-4">
      <div className="text-center mb-4">
        <h2 className="text-base font-bold text-slate-900 tracking-tight">Company Identification</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          Driver, Trailer, and Vehicle assets must be linked to a verified registered company in the port master database.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-4 mb-4">
        <label className="block text-xs font-bold text-slate-900 mb-1">
          Company Registration Number
        </label>
        <p className="text-[11px] text-slate-500 mb-2">
          Enter official company registration number (Old format <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-mono">AAAAAA-2</code> or SSM number).
        </p>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setErrorMsg('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch();
              }}
              placeholder="Enter the registered company number"
              className="w-full px-2.5 py-1.5 pl-8 rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-medium tracking-wide uppercase font-mono"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          </div>

          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={isSearching}
            className="px-3.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60"
          >
            {isSearching ? 'Verifying...' : 'Verify Company'}
          </button>
        </div>
      </div>

      {/* Error State */}
      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{errorMsg}</p>
            <div className="mt-2">
              <button
                type="button"
                onClick={onRegisterNewCompany}
                className="inline-flex items-center text-xs font-bold text-rose-900 underline hover:text-rose-950"
              >
                &rarr; Register this company now as a new entity
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Verified Company Card */}
      {selectedCompany && (
        <div className="bg-white rounded-lg border-2 border-emerald-500/70 p-4 shadow-xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-emerald-700">Verified Master Record Found</div>
                <h3 className="text-sm font-bold text-slate-900">{selectedCompany.name}</h3>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  Reg: {selectedCompany.registration_number} {selectedCompany.registration_number_new ? `(${selectedCompany.registration_number_new})` : ''}
                </div>
              </div>
            </div>

            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase">
              {selectedCompany.company_type}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 block font-semibold">Registered Port Corridor</span>
              <span className="font-medium text-slate-800">Johor Port</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-semibold">Pre-Configured Backend ID</span>
              <span className="font-mono font-bold text-slate-800">
                {selectedCompany.haulier_id || selectedCompany.forwarding_agent_id || 'Will be auto-assigned on approval'}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="pt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center px-3 py-1.5 rounded text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft className="mr-1.5 w-3.5 h-3.5" />
          Back
        </button>

        <button
          type="button"
          disabled={!selectedCompany}
          onClick={onNext}
          className="inline-flex items-center px-4 py-2 rounded text-xs font-bold text-white bg-[#ea7a24] hover:bg-[#d96c1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs"
        >
          Proceed to Asset Form
          <ArrowRight className="ml-1.5 w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

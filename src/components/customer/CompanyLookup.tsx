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
          setErrorMsg(`Company "${found.name}" is currently inactive. Please contact port support.`);
          return;
        }
        onSelectCompany(found);
      } else {
        const compact = term.replace(/[\s-]+/g, '').toUpperCase();
        const oldFormatSuggestion = /[A-Z]/.test(compact) && compact.length > 1
          ? `${compact.slice(0, -1)}-${compact.slice(-1)}`
          : '';
        setErrorMsg(`No company record found matching "${term}".${oldFormatSuggestion && oldFormatSuggestion !== term.toUpperCase() ? ` Do you mean "${oldFormatSuggestion}" instead?` : ''} Please ensure you entered the correct registration number or register your company first.`);
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
          Driver, Trailer, and Vehicle assets must be linked to a verified registered company.
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
                setQuery(e.target.value.replace(/\s+/g, ''));
                setErrorMsg('');
              }}
              onKeyDown={(e) => {
                if (e.key === ' ') {
                  e.preventDefault();
                  return;
                }
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
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Verified company</div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-800 shadow-sm">
                  {selectedCompany.company_type}
                </span>
              </div>
              <h3 className="mt-1 text-base font-bold leading-tight text-slate-900">{selectedCompany.name}</h3>
              <p className="mt-1 text-[11px] text-slate-500">This company is registered with CargoMove.</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 border-t border-emerald-200/70 pt-3 text-xs sm:grid-cols-2">
            <div className="rounded-lg bg-white/80 px-3 py-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Registration number</span>
              <span className="mt-1 block font-mono font-bold text-slate-800">
                {selectedCompany.registration_number}
              </span>
            </div>
            {selectedCompany.registration_number_new && (
              <div className="rounded-lg bg-white/80 px-3 py-2">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">SSM registration</span>
                <span className="mt-1 block font-mono font-bold text-slate-800">{selectedCompany.registration_number_new}</span>
              </div>
            )}
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

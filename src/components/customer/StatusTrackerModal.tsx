import React, { useState } from 'react';
import { getSubmissions } from '../../services/storage';
import { RegistrationSubmission } from '../../types';
import { StatusBadge, TypeBadge } from '../common/Badge';
import { Search, X, CheckCircle, Clock, FileSpreadsheet, AlertCircle } from 'lucide-react';

interface StatusTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialRef?: string;
}

export function StatusTrackerModal({
  isOpen,
  onClose,
  initialRef = '',
}: StatusTrackerModalProps) {
  const [query, setQuery] = useState(initialRef);
  const [foundSub, setFoundSub] = useState<RegistrationSubmission | null>(null);
  const [searched, setSearched] = useState(false);

  if (!isOpen) return null;

  const handleSearch = (term?: string) => {
    const q = (term ?? query).trim().toUpperCase();
    if (!q) return;
    const all = getSubmissions();
    const match = all.find((s) => s.reference_no.toUpperCase() === q);
    setFoundSub(match || null);
    setSearched(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="customer-form bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-100">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">Track Registration Status</h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Enter Reference Number
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearched(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="REG-20260910-0101"
              className="flex-1 px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 font-mono uppercase"
            />
            <button
              type="button"
              onClick={() => handleSearch()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </div>

        {searched && !foundSub && (
          <div className="mt-4 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              No submission found for reference <span className="font-mono font-bold">{query}</span>.
              Please check your reference number and try again.
            </div>
          </div>
        )}

        {foundSub && (
          <div className="mt-5 border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Reference</span>
                <div className="text-sm font-bold font-mono text-slate-900">{foundSub.reference_no}</div>
              </div>
              <StatusBadge status={foundSub.status} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-200/60">
              <div>
                <span className="text-slate-500 block">Asset / Category:</span>
                <span className="font-semibold text-slate-800">{foundSub.registration_type}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Company:</span>
                <span className="font-semibold text-slate-800">{foundSub.company_name}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Facility:</span>
                <span className="font-semibold text-slate-800">{foundSub.port_location === 'PORT_KLANG' ? 'Port Klang' : 'Johor'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Submitted At:</span>
                <span className="font-semibold text-slate-800">{new Date(foundSub.submitted_at).toLocaleDateString()}</span>
              </div>
            </div>

            {foundSub.status === 'DONE' && (
              <div className="mt-2 p-2 rounded bg-emerald-100/60 text-[11px] text-emerald-800 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Backend Excel generated & uploaded to Port Operating System.</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { RegistrationTracking, trackRegistration } from '../../services/registration';
import { StatusBadge } from '../common/Badge';
import { Search, X, CheckCircle, Clock, AlertCircle } from 'lucide-react';

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
  const [tracking, setTracking] = useState<RegistrationTracking | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSearch = async (term?: string) => {
    const q = (term ?? query).trim().toUpperCase();
    if (!q) return;
    setLoading(true);
    setError('');
    setTracking(null);
    try {
      setTracking(await trackRegistration(q));
      setSearched(true);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'Unable to check the registration status.');
      setSearched(false);
    } finally {
      setLoading(false);
    }
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
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
              placeholder="REG-20260914-A1B2C3D4E5F6"
              className="flex-1 px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 font-mono uppercase"
            />
            <button
              type="button"
              onClick={() => void handleSearch()}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              {loading ? <Clock className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {searched && !tracking && (
          <div className="mt-4 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              No submission found for reference <span className="font-mono font-bold">{query}</span>.
              Please check your reference number and try again.
            </div>
          </div>
        )}

        {tracking && (
          <div className="mt-5 border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Reference</span>
                <div className="text-sm font-bold font-mono text-slate-900">{tracking.reference_no}</div>
              </div>
              <StatusBadge status={tracking.status} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-200/60">
              <div>
                <span className="text-slate-500 block">Asset / Category:</span>
                <span className="font-semibold text-slate-800">{tracking.registration_type}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Company:</span>
                <span className="font-semibold text-slate-800">{tracking.company_name}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Facility:</span>
                <span className="font-semibold text-slate-800">{tracking.port_location === 'PORT_KLANG' ? 'Port Klang' : tracking.port_location === 'JOHOR' ? 'Johor' : 'Other'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Submitted At:</span>
                <span className="font-semibold text-slate-800">{new Date(tracking.submitted_at).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Tracking step</th>
                    <th className="px-3 py-2 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="px-3 py-2 text-slate-700">Application review</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">
                      {tracking.submission_status === 'DONE' ? 'Done' : tracking.submission_status === 'REJECTED' ? 'Rejected' : 'Pending'}
                    </td>
                  </tr>
                  {tracking.registration_type === 'COMPANY' && (
                    <tr>
                      <td className="px-3 py-2 text-slate-700">
                        {tracking.status === 'REJECTED' ? 'Rejection notification email' : 'Welcome email'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {tracking.user_email_sent ? 'Sent' : 'Pending'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {tracking.status === 'PENDING' && (
              <div className="mt-2 p-2 rounded bg-amber-100/60 text-[11px] text-amber-800 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Your application is being processed. Company registrations are successful only after approval and the welcome email is sent.</span>
              </div>
            )}

            {tracking.status === 'SUCCESS' && (
              <div className="mt-2 p-2 rounded bg-emerald-100/60 text-[11px] text-emerald-800 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Your registration is successful{tracking.registration_type === 'COMPANY' ? ' and the welcome email has been sent.' : '.'}</span>
              </div>
            )}

            {tracking.status === 'REJECTED' && (
              <div className="mt-2 p-2 rounded bg-rose-100/60 text-[11px] text-rose-800 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
                <span>This registration was rejected. Please contact CargoMove Support if you need more information.</span>
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

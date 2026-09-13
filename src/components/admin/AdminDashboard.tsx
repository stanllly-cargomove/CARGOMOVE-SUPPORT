import React, { useEffect, useState } from 'react';
import {
  getCompanies,
  getSubmissions,
  getCompanyById,
  subscribeToStorage,
} from '../../services/storage';
import { getCompanyExternalId } from '../../services/companyHelper';
import { Company, RegistrationSubmission, RegistrationType } from '../../types';
import { StatusBadge } from '../common/Badge';
import { AssignIdModal } from './AssignIdModal';
import { SubmissionDetailModal } from './SubmissionDetailModal';
import {
  Building2,
  FileSpreadsheet,
  Users,
  Container,
  Truck,
  ArrowUpRight,
  ShieldCheck,
} from 'lucide-react';

interface AdminDashboardProps {
  onNavigate: (tab: string) => void;
}

export function AdminDashboard({ onNavigate }: AdminDashboardProps) {
  const [companies, setCompanies] = useState(getCompanies());
  const [submissions, setSubmissions] = useState(getSubmissions());

  // Modals
  const [selectedCompanyForId, setSelectedCompanyForId] = useState<Company | null>(null);
  const [activeSubmission, setActiveSubmission] = useState<RegistrationSubmission | null>(null);

  const refresh = () => {
    setCompanies(getCompanies());
    setSubmissions(getSubmissions());
  };

  useEffect(() => subscribeToStorage(refresh), []);

  const pendingByType = (type: RegistrationType) =>
    submissions.filter((s) => s.registration_type === type && s.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Admin Operations Center</h2>
          <p className="text-xs text-slate-500 mt-1">
            Real-time monitoring of port registrations, master ID resolution, and EDI exports.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('export')}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4 mr-1.5" />
            Go to Excel Export
          </button>
        </div>
      </div>

      {/* Pending registration counts by type */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { type: 'COMPANY' as RegistrationType, label: 'Company', icon: Building2, iconClass: 'bg-blue-100 text-blue-700' },
          { type: 'DRIVER' as RegistrationType, label: 'Driver', icon: Users, iconClass: 'bg-emerald-100 text-emerald-700' },
          { type: 'TRAILER' as RegistrationType, label: 'Trailer', icon: Container, iconClass: 'bg-indigo-100 text-indigo-700' },
          { type: 'VEHICLE' as RegistrationType, label: 'Vehicle', icon: Truck, iconClass: 'bg-purple-100 text-purple-700' },
        ].map(({ type, label, icon: Icon, iconClass }) => (
          <div
            key={type}
            onClick={() => onNavigate('submissions')}
            className="bg-white p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 cursor-pointer transition-all flex items-center gap-3"
          >
            <div className={`w-9 h-9 rounded-lg ${iconClass} flex items-center justify-center shrink-0`}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-900">{pendingByType(type)}</div>
              <div className="text-[11px] text-slate-500 font-medium">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Submissions Queue */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900">Recent Registrations Queue</h3>
          <button
            onClick={() => onNavigate('submissions')}
            className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            View All Submissions <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px] font-normal border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                <th className="py-2 px-3">Reference</th>
                <th className="py-2 px-3 text-center">Type</th>
                <th className="py-2 px-3">Company</th>
                <th className="py-2 px-3 text-center">Facility</th>
                <th className="py-2 px-3">Cargomove ID</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {submissions.slice(0, 6).map((sub) => {
                const comp = sub.company_id ? getCompanyById(sub.company_id) : undefined;
                const idInfo = getCompanyExternalId(comp || { company_type: sub.company_type });

                return (
                  <tr key={sub.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 font-mono text-slate-900">
                      {sub.reference_no}
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {sub.registration_type}
                    </td>
                    <td className="py-2 px-3 text-slate-900">
                      {sub.company_name}
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {sub.port_location === 'PORT_KLANG' ? 'PORT KLANG' : sub.port_location === 'JOHOR' ? 'JOHOR' : 'OTHER PORT'}
                    </td>
                    <td className="py-2 px-3 font-mono">
                      {idInfo.has_required_id ? (
                        <span className="font-mono text-slate-700 text-[10px]">
                          {idInfo.active_id_value}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          ID Required
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <StatusBadge status={sub.status} />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => setActiveSubmission(sub)}
                        className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px]"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assign ID Modal */}
      <AssignIdModal
        company={selectedCompanyForId}
        isOpen={!!selectedCompanyForId}
        onClose={() => setSelectedCompanyForId(null)}
        onSuccess={refresh}
      />

      {/* Submission Detail Modal */}
      <SubmissionDetailModal
        submission={activeSubmission}
        isOpen={!!activeSubmission}
        onClose={() => setActiveSubmission(null)}
        onOpenAssignId={(compId) => {
          const c = getCompanyById(compId);
          if (c) setSelectedCompanyForId(c);
        }}
        onStatusChange={() => {
          refresh();
          if (activeSubmission) {
            const updated = getSubmissions().find((s) => s.id === activeSubmission.id);
            setActiveSubmission(updated || null);
          }
        }}
      />
    </div>
  );
}

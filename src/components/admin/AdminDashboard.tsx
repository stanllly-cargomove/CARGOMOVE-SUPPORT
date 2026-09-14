import React, { useEffect, useState } from 'react';
import {
  getCompanies,
  getSubmissions,
  getCompanyById,
  ensureSubmissionCompany,
  subscribeToStorage,
} from '../../services/storage';
import { getCompanyExternalId } from '../../services/companyHelper';
import { ExternalUserAccess, getExternalUserAccess } from '../../services/auth';
import { Company, RegistrationSubmission, RegistrationType } from '../../types';
import { StatusBadge } from '../common/Badge';
import { AssignIdModal } from './AssignIdModal';
import { SubmissionDetailModal } from './SubmissionDetailModal';
import { notifyWarning } from '../common/notifications';
import {
  Building2,
  FileSpreadsheet,
  Users,
  Container,
  Truck,
  ArrowUpRight,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface AdminDashboardProps {
  onNavigate: (tab: string, registrationType?: RegistrationType) => void;
}

interface RecentQueueItem {
  rowKey: string;
  referenceNo: string;
  type: RegistrationType | 'USER';
  companyId?: string;
  companyName: string;
  companyType: string;
  portLocation: RegistrationSubmission['port_location'];
  status: RegistrationSubmission['status'];
  submittedAt: string;
  submission: RegistrationSubmission;
}

const queueStatusPriority: Record<RegistrationSubmission['status'], number> = {
  PENDING: 0,
  REJECTED: 1,
  DONE: 2,
};

export function AdminDashboard({ onNavigate }: AdminDashboardProps) {
  const [companies, setCompanies] = useState(getCompanies());
  const [submissions, setSubmissions] = useState(getSubmissions());
  const [externalUsers, setExternalUsers] = useState<ExternalUserAccess[]>([]);
  const [queuePageSize, setQueuePageSize] = useState<20 | 30 | 50>(20);
  const [queuePage, setQueuePage] = useState(1);

  // Modals
  const [selectedCompanyForId, setSelectedCompanyForId] = useState<Company | null>(null);
  const [activeSubmission, setActiveSubmission] = useState<RegistrationSubmission | null>(null);

  const refresh = () => {
    setCompanies(getCompanies());
    setSubmissions(getSubmissions());
    void getExternalUserAccess().then(setExternalUsers).catch(() => setExternalUsers([]));
  };

  useEffect(() => {
    refresh();
    return subscribeToStorage(refresh);
  }, []);

  useEffect(() => {
    setQueuePage(1);
  }, [queuePageSize]);

  const pendingByType = (type: RegistrationType) =>
    submissions.filter((s) => s.registration_type === type && s.status === 'PENDING').length;

  const registeredByType = (type: RegistrationType) =>
    submissions.filter((s) => s.registration_type === type && s.status === 'DONE').length;

  const submissionQueue: RecentQueueItem[] = submissions.map((submission) => ({
    rowKey: `submission:${submission.id}`,
    referenceNo: submission.reference_no,
    type: submission.registration_type,
    companyId: submission.company_id,
    companyName: submission.company_name,
    companyType: submission.company_type,
    portLocation: submission.port_location,
    status: submission.status,
    submittedAt: submission.submitted_at,
    submission,
  }));
  const companySubmissionById = new Map<string, RegistrationSubmission>();
  submissions.forEach((submission) => {
    if (submission.registration_type !== 'COMPANY' || !submission.company_id) return;
    const current = companySubmissionById.get(submission.company_id);
    if (!current || Date.parse(submission.submitted_at) > Date.parse(current.submitted_at)) {
      companySubmissionById.set(submission.company_id, submission);
    }
  });
  const userQueue: RecentQueueItem[] = externalUsers.flatMap((user) => {
    const submission = user.company_id ? companySubmissionById.get(user.company_id) : undefined;
    if (!submission) return [];
    return [{
      rowKey: `user:${user.id}`,
      referenceNo: submission.reference_no,
      type: 'USER',
      companyId: user.company_id,
      companyName: user.company_name || submission.company_name,
      companyType: submission.company_type,
      portLocation: submission.port_location,
      status: user.status,
      submittedAt: user.created_at || submission.submitted_at,
      submission,
    }];
  });
  const recentQueue = [...submissionQueue, ...userQueue].sort((left, right) => {
    const statusDifference = queueStatusPriority[left.status] - queueStatusPriority[right.status];
    const dateDifference = Date.parse(left.submittedAt) - Date.parse(right.submittedAt);
    return statusDifference || dateDifference || left.rowKey.localeCompare(right.rowKey);
  });
  const queuePageCount = Math.max(1, Math.ceil(recentQueue.length / queuePageSize));
  const currentQueuePage = Math.min(queuePage, queuePageCount);
  const queueStart = (currentQueuePage - 1) * queuePageSize;
  const visibleQueue = recentQueue.slice(queueStart, queueStart + queuePageSize);

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

      {/* Pending and registered counts by type */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            type: 'COMPANY' as RegistrationType,
            label: 'Company',
            icon: Building2,
            iconClass: 'bg-blue-100 text-blue-600',
            cardClass: 'border-blue-100 bg-gradient-to-br from-white via-white to-blue-50',
            accentClass: 'bg-blue-200/30',
          },
          {
            type: 'DRIVER' as RegistrationType,
            label: 'Driver',
            icon: Users,
            iconClass: 'bg-emerald-100 text-emerald-600',
            cardClass: 'border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50',
            accentClass: 'bg-emerald-200/30',
          },
          {
            type: 'TRAILER' as RegistrationType,
            label: 'Trailer',
            icon: Container,
            iconClass: 'bg-violet-100 text-violet-600',
            cardClass: 'border-violet-100 bg-gradient-to-br from-white via-white to-violet-50',
            accentClass: 'bg-violet-200/30',
          },
          {
            type: 'VEHICLE' as RegistrationType,
            label: 'Vehicle',
            icon: Truck,
            iconClass: 'bg-fuchsia-100 text-fuchsia-600',
            cardClass: 'border-fuchsia-100 bg-gradient-to-br from-white via-white to-fuchsia-50',
            accentClass: 'bg-fuchsia-200/30',
          },
        ].map(({ type, label, icon: Icon, iconClass, cardClass, accentClass }) => (
          <button
            type="button"
            key={type}
            onClick={() => onNavigate('submissions', type)}
            aria-label={`View ${label} registrations: ${pendingByType(type)} pending and ${registeredByType(type)} registered`}
            className={`admin-summary-card group relative min-h-28 overflow-hidden rounded-xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${cardClass}`}
          >
            <span
              className={`pointer-events-none absolute -bottom-12 -right-10 h-28 w-28 rounded-full ${accentClass}`}
              aria-hidden="true"
            />

            <div className="relative flex gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
                <Icon className="h-6 w-6" strokeWidth={2.2} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold text-slate-900">{label}</span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5" />
                </div>

                <div className="mt-3 grid grid-cols-2">
                  <div className="min-w-0 pr-3">
                    <div className="text-xl font-bold leading-none tabular-nums text-slate-900">
                      {pendingByType(type)}
                    </div>
                    <div className="mt-1 text-[10px] font-bold text-amber-600">Pending</div>
                  </div>
                  <div className="min-w-0 border-l border-slate-200 pl-4">
                    <div className="text-xl font-bold leading-none tabular-nums text-slate-900">
                      {registeredByType(type)}
                    </div>
                    <div className="mt-1 truncate text-[10px] font-bold text-emerald-600">Registered</div>
                  </div>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Recent Submissions Queue */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="font-bold text-sm text-slate-900">Recent Registrations Queue</h3>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Show
              <select
                value={queuePageSize}
                onChange={(event) => setQueuePageSize(Number(event.target.value) as 20 | 30 | 50)}
                className="h-8 rounded-lg border border-slate-300 bg-slate-100 px-2.5 text-[10px] font-bold tracking-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Records per page"
              >
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
            </label>
            <button
              onClick={() => onNavigate('submissions')}
              className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"
            >
              View All Submissions <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
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
                <th className="py-2 px-3 text-center">Status</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleQueue.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    No registrations found.
                  </td>
                </tr>
              ) : visibleQueue.map((item) => {
                const sub = item.submission;
                const comp = item.companyId ? getCompanyById(item.companyId) : undefined;
                const idInfo = getCompanyExternalId(comp || { company_type: item.companyType });

                return (
                  <tr key={item.rowKey} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 font-mono text-slate-900">
                      {item.referenceNo}
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {item.type}
                    </td>
                    <td className="py-2 px-3 text-slate-900">
                      {item.companyName.toUpperCase()}
                    </td>
                    <td className="py-2 px-3 text-center text-slate-700">
                      {item.portLocation === 'PORT_KLANG' ? 'PORT KLANG' : item.portLocation === 'JOHOR' ? 'JOHOR' : 'OTHER PORT'}
                    </td>
                    <td className="py-2 px-3 font-mono">
                      {idInfo.has_required_id ? (
                        <span className="font-mono text-slate-700 text-[10px]">
                          {idInfo.active_id_value}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const company = ensureSubmissionCompany(sub.id);
                            if (company) {
                              setSelectedCompanyForId(company);
                            } else {
                              notifyWarning('This submission does not contain enough company information to create a master record.');
                            }
                          }}
                          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                          title="Assign ID and save it to Company Master"
                        >
                          ID Required
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex justify-center [&>span]:w-20 [&>span]:justify-center">
                        <StatusBadge status={item.status} />
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => item.type === 'USER' ? onNavigate('user-registration') : setActiveSubmission(sub)}
                        className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px]"
                      >
                        {item.type === 'USER' ? 'Manage' : 'Inspect'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {recentQueue.length > queuePageSize && (
          <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-[10px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing {queueStart + 1}–{Math.min(queueStart + queuePageSize, recentQueue.length)} of {recentQueue.length} records
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQueuePage(Math.max(1, currentQueuePage - 1))}
                disabled={currentQueuePage === 1}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> Previous
              </button>
              <span className="min-w-16 text-center font-semibold text-slate-600">
                {currentQueuePage} / {queuePageCount}
              </span>
              <button
                type="button"
                onClick={() => setQueuePage(Math.min(queuePageCount, currentQueuePage + 1))}
                disabled={currentQueuePage === queuePageCount}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
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

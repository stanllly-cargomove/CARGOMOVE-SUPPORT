import React, { useState } from 'react';
import { RegistrationSubmission, RegistrationType, SubmissionStatus, Company } from '../../types';
import {
  getSubmissions,
  getCompanyById,
  ensureSubmissionCompany,
  deleteSubmission,
  updateSubmissionStatus,
  subscribeToStorage,
} from '../../services/storage';
import { getCompanyExternalId } from '../../services/companyHelper';
import { exportSubmissionsToExcel } from '../../services/excelExport';
import { StatusBadge } from '../common/Badge';
import { SubmissionDetailModal } from './SubmissionDetailModal';
import { AssignIdModal } from './AssignIdModal';
import {
  Search,
  Filter,
  Eye,
  AlertTriangle,
  FileSpreadsheet,
  Trash2,
  Key,
  MoreVertical,
} from 'lucide-react';
import { notifyError, notifySuccess, notifyWarning, summarizeError } from '../common/notifications';

interface SubmissionsListProps {
  status: SubmissionStatus;
  initialType?: RegistrationType;
}

const statusTitles: Record<SubmissionStatus, string> = {
  PENDING: 'Pending Registration Submissions',
  DONE: 'Closed / Done Registration Submissions',
  REJECTED: 'Rejected Registration Submissions',
};

const statusTitleColors: Record<SubmissionStatus, string> = {
  PENDING: 'text-amber-600',
  DONE: 'text-emerald-700',
  REJECTED: 'text-red-600',
};

export function SubmissionsList({ status, initialType = 'COMPANY' }: SubmissionsListProps) {
  const [submissions, setSubmissions] = useState<RegistrationSubmission[]>(getSubmissions());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<RegistrationType | 'ALL'>(initialType);
  const [portFilter, setPortFilter] = useState<string>('ALL');
  const [missingIdOnly, setMissingIdOnly] = useState(false);
  const [openActionMenu, setOpenActionMenu] = useState<{ id: string; top: number; left: number } | null>(null);

  // Modals
  const [activeSubmission, setActiveSubmission] = useState<RegistrationSubmission | null>(null);
  const [assignIdCompany, setAssignIdCompany] = useState<Company | null>(null);

  const refreshList = () => {
    setSubmissions(getSubmissions());
  };

  React.useEffect(() => subscribeToStorage(refreshList), []);

  React.useEffect(() => {
    setSelectedIds([]);
    setOpenActionMenu(null);
    setActiveSubmission(null);
    setAssignIdCompany(null);
    setMissingIdOnly(false);
  }, [status]);

  React.useEffect(() => {
    setTypeFilter(initialType);
  }, [initialType]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredSubmissions.map((s) => s.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const filteredSubmissions = submissions.filter((sub) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      !term ||
      sub.reference_no.toLowerCase().includes(term) ||
      sub.company_name.toLowerCase().includes(term) ||
      sub.company_reg_no.toLowerCase().includes(term);

    const matchesType = typeFilter === 'ALL' || sub.registration_type === typeFilter;
    const matchesStatus = sub.status === status;
    const matchesPort = portFilter === 'ALL' || sub.port_location === portFilter;

    // Check if parent company has required ID
    const company = sub.company_id ? getCompanyById(sub.company_id) : undefined;
    const idInfo = getCompanyExternalId(company || { company_type: sub.company_type });
    const matchesMissingId = !missingIdOnly || !idInfo.has_required_id;

    return matchesSearch && matchesType && matchesStatus && matchesPort && matchesMissingId;
  });

  const handleBulkExport = () => {
    const selectedSubs = submissions.filter((s) => selectedIds.includes(s.id));
    if (selectedSubs.length === 0) {
      const message = 'Please select at least one submission to export.';
      notifyWarning(message);
      return;
    }

    const res = exportSubmissionsToExcel(selectedSubs);
    if (!res.success) {
      notifyError(summarizeError(res.error || 'Export failed.'));
    } else {
      notifySuccess(`Export complete: ${res.count} record(s) generated.`);
      refreshList();
      setSelectedIds([]);
    }
  };

  const handleOpenAssignIdForSub = (sub: RegistrationSubmission) => {
    const company = ensureSubmissionCompany(sub.id);
    if (company) {
      setAssignIdCompany(company);
    } else {
      notifyWarning('This submission does not contain enough company information to create a master record.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div>
          <h2 className={`text-xl font-bold tracking-tight ${statusTitleColors[status]}`}>{statusTitles[status]}</h2>
          <p className="text-xs text-slate-500 mt-1">
            Review customer applications, verify company ID linkage, and generate official backend Excel exports.
          </p>
        </div>

      </div>

      {/* Search and queue filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Reference (REG-...) or Company..."
            className="w-full px-3.5 py-2 pl-9 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">

          {/* Port Filter */}
          <select
            value={portFilter}
            onChange={(e) => setPortFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold uppercase focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">ALL FACILITIES</option>
            <option value="PORT_KLANG">PORT KLANG</option>
            <option value="JOHOR">JOHOR</option>
          </select>

          {/* Missing IDs are actionable only while a submission is pending. */}
          {status === 'PENDING' && (
            <button
              type="button"
              onClick={() => setMissingIdOnly(!missingIdOnly)}
              className={`h-9 whitespace-nowrap rounded-lg border px-3 text-xs font-bold uppercase transition-colors ${
                missingIdOnly
                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                  : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
              }`}
            >
              ⚠ MISSING ID ONLY
            </button>
          )}

          <button
            type="button"
            onClick={handleBulkExport}
            disabled={selectedIds.length === 0}
            className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            GENERATE EXCEL
          </button>
        </div>
        </div>
      </div>

      {/* Registration type chrome tabs and table */}
      <div className="rounded-xl">
        <div className="flex w-fit items-end gap-0">
        {[
          ['COMPANY', 'Company'],
          ['DRIVER', 'Driver'],
          ['TRAILER', 'Trailer'],
          ['VEHICLE', 'Vehicle'],
          ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTypeFilter(value as RegistrationType)}
            aria-selected={typeFilter === value}
            role="tab"
            className={`admin-registration-tab min-w-[132px] rounded-t-lg border px-5 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
              typeFilter === value
                ? `relative z-10 border-slate-400 bg-[#CBD5E1] ${statusTitleColors[status]}`
                : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
        </div>

      {/* Submissions Table */}
        <div className="overflow-x-auto rounded-b-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1120px] table-fixed text-left text-xs border-collapse">
            <colgroup>
              <col style={{ width: '5%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '26%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr className="admin-registration-table-header whitespace-nowrap border-b border-slate-400 bg-[#CBD5E1] font-bold uppercase tracking-wider text-slate-700">
                <th className="py-3 px-3 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredSubmissions.length > 0 &&
                      selectedIds.length === filteredSubmissions.length
                    }
                    onChange={handleSelectAll}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="py-3 px-4">Reference No</th>
                <th className="py-3 px-4">Company Name</th>
                <th className="py-3 px-3">Facility</th>
                <th className="py-3 px-3">Cargomove ID</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Submitted</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSubmissions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No submissions found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredSubmissions.map((sub) => {
                  const company = sub.company_id ? getCompanyById(sub.company_id) : undefined;
                  const idInfo = getCompanyExternalId(company || { company_type: sub.company_type });
                  const isSelected = selectedIds.includes(sub.id);

                  return (
                    <tr
                      key={sub.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        isSelected ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(sub.id)}
                          className="rounded text-blue-600 focus:ring-blue-500"
                        />
                      </td>

                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {sub.reference_no}
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{sub.company_name}</div>
                      </td>

                      <td className="py-2.5 px-3">
                        <span className="text-[11px] font-semibold text-slate-700">
                          {sub.port_location === 'PORT_KLANG' ? 'PORT KLANG' : sub.port_location === 'JOHOR' ? 'JOHOR' : 'OTHER PORT'}
                        </span>
                      </td>

                      {/* Backend ID Linkage Status */}
                      <td className="py-3 px-3 font-mono">
                        {idInfo.has_required_id ? (
                          <span className="font-mono text-[11px] text-slate-700">{idInfo.active_id_value}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenAssignIdForSub(sub)}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-700" />
                            <span>ID Required</span>
                          </button>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <StatusBadge status={sub.status} />
                      </td>

                      <td className="py-3 px-3 text-[11px] text-slate-500">
                        {new Date(sub.submitted_at).toLocaleDateString()}
                      </td>

                      <td className="relative py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={(event) => {
                            if (openActionMenu?.id === sub.id) {
                              setOpenActionMenu(null);
                              return;
                            }
                            const rect = event.currentTarget.getBoundingClientRect();
                            setOpenActionMenu({ id: sub.id, top: rect.bottom + 4, left: rect.right - 128 });
                          }}
                          aria-label={`Actions for ${sub.reference_no}`}
                          aria-expanded={openActionMenu?.id === sub.id}
                          className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openActionMenu?.id === sub.id && (
                          <div style={{ top: openActionMenu.top, left: openActionMenu.left }} className="fixed z-50 w-32 rounded-lg border border-slate-200 bg-white p-1 text-left shadow-xl">
                            <button type="button" onClick={() => { setActiveSubmission(sub); setOpenActionMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                              <Eye className="w-3.5 h-3.5" /> Review
                            </button>
                            {sub.status === 'PENDING' && (
                              <>
                                <button type="button" onClick={() => { updateSubmissionStatus(sub.id, 'DONE'); refreshList(); setOpenActionMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Register</button>
                                <button type="button" onClick={() => { updateSubmissionStatus(sub.id, 'REJECTED'); refreshList(); setOpenActionMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Reject</button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Submission Detail Modal */}
      <SubmissionDetailModal
        submission={activeSubmission}
        isOpen={!!activeSubmission}
        onClose={() => setActiveSubmission(null)}
        onOpenAssignId={(compGuid) => {
          const c = getCompanyById(compGuid);
          if (c) setAssignIdCompany(c);
        }}
        onStatusChange={() => {
          refreshList();
          if (activeSubmission) {
            const updated = getSubmissions().find((s) => s.id === activeSubmission.id);
            setActiveSubmission(updated || null);
          }
        }}
      />

      {/* Assign ID Modal */}
      <AssignIdModal
        company={assignIdCompany}
        isOpen={!!assignIdCompany}
        onClose={() => setAssignIdCompany(null)}
        onSuccess={() => {
          refreshList();
        }}
      />
    </div>
  );
}

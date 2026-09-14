import React, { useState } from 'react';
import { RegistrationSubmission, RegistrationType, SubmissionStatus, Company, RejectionReason } from '../../types';
import {
  getSubmissions,
  getCompanyById,
  ensureSubmissionCompany,
  deleteSubmission,
  updateSubmissionStatus,
  rejectCompanySubmission,
  revertSubmissionToPending,
  subscribeToStorage,
} from '../../services/storage';
import { getExternalUserAccess } from '../../services/auth';
import { EmailPreview, generateWelcomeEmailPreview, sendWelcomeEmail } from '../../services/email';
import { getCompanyExternalId } from '../../services/companyHelper';
import { exportSubmissionsToExcel } from '../../services/excelExport';
import { StatusBadge } from '../common/Badge';
import { SubmissionDetailModal } from './SubmissionDetailModal';
import { AssignIdModal } from './AssignIdModal';
import { RichTextEmailEditor } from './RichTextEmailEditor';
import {
  Search,
  Filter,
  Eye,
  AlertTriangle,
  FileSpreadsheet,
  Trash2,
  Key,
  MoreVertical,
  Mail,
  X,
  RotateCcw,
} from 'lucide-react';
import { notifyError, notifySuccess, notifyWarning, summarizeError } from '../common/notifications';

interface SubmissionsListProps {
  status: SubmissionStatus;
  initialType?: RegistrationType;
}

type IdFilter = 'ALL' | 'MISSING' | 'WITH_ID';

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
  const [idFilter, setIdFilter] = useState<IdFilter>('ALL');
  const [openActionMenu, setOpenActionMenu] = useState<{ id: string; top: number; left: number } | null>(null);

  // Modals
  const [activeSubmission, setActiveSubmission] = useState<RegistrationSubmission | null>(null);
  const [assignIdCompany, setAssignIdCompany] = useState<Company | null>(null);
  const [rejectingSubmission, setRejectingSubmission] = useState<RegistrationSubmission | null>(null);
  const [rejectionReason, setRejectionReason] = useState<RejectionReason | ''>('');
  const [rejectionDetail, setRejectionDetail] = useState('');
  const [savingRejection, setSavingRejection] = useState(false);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  const refreshList = () => {
    setSubmissions(getSubmissions());
  };

  React.useEffect(() => subscribeToStorage(refreshList), []);

  React.useEffect(() => {
    setSelectedIds([]);
    setOpenActionMenu(null);
    setActiveSubmission(null);
    setAssignIdCompany(null);
    setIdFilter('ALL');
    setRejectingSubmission(null);
    setPreview(null);
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
    const matchesId =
      idFilter === 'ALL' ||
      (idFilter === 'MISSING' && !idInfo.has_required_id) ||
      (idFilter === 'WITH_ID' && idInfo.has_required_id);

    return matchesSearch && matchesType && matchesStatus && matchesPort && matchesId;
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

  const openCompanyRejection = (submission: RegistrationSubmission) => {
    setOpenActionMenu(null);
    setActiveSubmission(null);
    setRejectingSubmission(submission);
    setRejectionReason(submission.rejection_reason || '');
    setRejectionDetail(submission.rejection_detail || '');
  };

  const rejectSubmission = (submission: RegistrationSubmission) => {
    if (submission.registration_type === 'COMPANY') {
      openCompanyRejection(submission);
      return;
    }
    updateSubmissionStatus(submission.id, 'REJECTED');
    refreshList();
    setOpenActionMenu(null);
  };

  const handleRevertToPending = async (submission: RegistrationSubmission) => {
    setOpenActionMenu(null);
    try {
      await revertSubmissionToPending(submission.id);
      refreshList();
      notifySuccess(`${submission.reference_no} reverted to pending.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to revert the submission.');
    }
  };

  const confirmCompanyRejection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rejectingSubmission || !rejectionReason) {
      notifyError('Select a rejection reason.');
      return;
    }
    if (rejectionReason === 'OTHER' && !rejectionDetail.trim()) {
      notifyError('Enter the reason for rejecting this registration.');
      return;
    }
    setSavingRejection(true);
    try {
      const rejected = await rejectCompanySubmission(rejectingSubmission.id, rejectionReason, rejectionDetail);
      const linkedUser = (await getExternalUserAccess()).find((user) => user.company_id === rejected.company_id);
      if (!linkedUser || linkedUser.status !== 'REJECTED') throw new Error('The linked User Registration could not be synchronized.');
      const generated = await generateWelcomeEmailPreview(linkedUser.id);
      setRejectingSubmission(null);
      setRejectionReason('');
      setRejectionDetail('');
      refreshList();
      setPreview(generated);
      notifySuccess('Company and User Registration rejected. Review the email before sending.');
    } catch (error) {
      refreshList();
      notifyError(error instanceof Error ? error.message : 'Unable to reject the company registration.');
    } finally {
      setSavingRejection(false);
    }
  };

  const sendRejectionEmail = async () => {
    if (!preview) return;
    setSendingEmail(true);
    try {
      await sendWelcomeEmail(preview);
      setPreview(null);
      notifySuccess('Rejection email sent through Gmail.');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to send the rejection email.');
    } finally {
      setSendingEmail(false);
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

          {/* ID completeness is actionable only while a submission is pending. */}
          {status === 'PENDING' && (
            <select
              value={idFilter}
              onChange={(event) => setIdFilter(event.target.value as IdFilter)}
              aria-label="Filter submissions by CargoMove ID status"
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold uppercase focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">ALL IDS</option>
              <option value="MISSING">MISSING ID</option>
              <option value="WITH_ID">WITH ID</option>
            </select>
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
              <col style={{ width: '15%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
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
                <th className="py-3 px-3 text-center">Type</th>
                <th className="py-3 px-3">Facility</th>
                <th className="py-3 px-3">Cargomove ID</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-center">Submitted</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSubmissions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
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
                        <div className="truncate whitespace-nowrap font-bold text-slate-900" title={sub.company_name}>
                          {sub.company_name.toUpperCase()}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <span className="text-[11px] font-semibold text-slate-700">
                          {(company?.company_type || sub.company_type || '—').toUpperCase()}
                        </span>
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

                      <td className="py-3 px-3 text-center text-[11px] text-slate-500">
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
                            setOpenActionMenu({ id: sub.id, top: rect.bottom + 4, left: rect.right - 160 });
                          }}
                          aria-label={`Actions for ${sub.reference_no}`}
                          aria-expanded={openActionMenu?.id === sub.id}
                          className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openActionMenu?.id === sub.id && (
                          <div style={{ top: openActionMenu.top, left: openActionMenu.left }} className="fixed z-50 w-40 rounded-lg border border-slate-200 bg-white p-1 text-left shadow-xl">
                            <button type="button" onClick={() => { setActiveSubmission(sub); setOpenActionMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                              <Eye className="w-3.5 h-3.5" /> Review
                            </button>
                            {sub.status === 'PENDING' && (
                              <>
                                <button type="button" onClick={() => { updateSubmissionStatus(sub.id, 'DONE'); refreshList(); setOpenActionMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Register</button>
                                <button type="button" onClick={() => rejectSubmission(sub)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Reject</button>
                              </>
                            )}
                            {sub.status !== 'PENDING' && (
                              <button type="button" onClick={() => void handleRevertToPending(sub)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50">
                                <RotateCcw className="h-3.5 w-3.5" /> Revert to Pending
                              </button>
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
        onReject={rejectSubmission}
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

      {rejectingSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs">
          <form onSubmit={confirmCompanyRejection} role="dialog" aria-modal="true" aria-labelledby="reject-company-title" className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-rose-50 px-5 py-4">
              <div><h3 id="reject-company-title" className="font-bold text-slate-900">Reject Company Registration</h3><p className="mt-0.5 text-xs text-slate-600">{rejectingSubmission.company_name.toUpperCase()} · {rejectingSubmission.reference_no}</p></div>
              <button type="button" onClick={() => setRejectingSubmission(null)} disabled={savingRejection} aria-label="Close rejection popup" className="rounded-lg p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50">×</button>
            </div>
            <div className="space-y-3 p-5">
              <p className="text-xs font-semibold text-slate-700">Select the company rejection reason. The linked User Registration will also be rejected.</p>
              {([
                ['ALREADY_REGISTERED_BOTH', 'Already registered (Westport & Northport)'],
                ['NORTHPORT_ADDED', 'Only need to add Northport'],
                ['OTHER', 'Other'],
              ] as const).map(([value, label]) => (
                <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${rejectionReason === value ? 'border-rose-400 bg-rose-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="company-rejection-reason" value={value} checked={rejectionReason === value} onChange={() => setRejectionReason(value)} className="mt-0.5 text-rose-600 focus:ring-rose-500" />
                  <span className="font-semibold text-slate-800">{label}</span>
                </label>
              ))}
              {rejectionReason === 'OTHER' && (
                <label className="block text-xs font-semibold text-slate-700">Rejection details
                  <textarea autoFocus required maxLength={2000} rows={4} value={rejectionDetail} onChange={(event) => setRejectionDetail(event.target.value)} placeholder="Explain why this company registration cannot proceed..." className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-rose-500" />
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button type="button" onClick={() => setRejectingSubmission(null)} disabled={savingRejection} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={savingRejection || !rejectionReason || (rejectionReason === 'OTHER' && !rejectionDetail.trim())} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"><Mail className="h-4 w-4" />{savingRejection ? 'Rejecting...' : 'Reject & Preview Email'}</button>
            </div>
          </form>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" aria-labelledby="rejection-email-preview-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div><h3 id="rejection-email-preview-title" className="font-bold text-slate-900">Rejection Email Preview</h3><p className="mt-0.5 text-xs text-slate-500">{preview.templateName}</p></div>
              <button type="button" onClick={() => setPreview(null)} disabled={sendingEmail} aria-label="Close email preview" className="rounded-lg p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5">
              <label className="block text-xs font-semibold text-slate-700">To<input value={preview.recipient} readOnly className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal text-slate-700" /></label>
              <label className="block text-xs font-semibold text-slate-700">Subject<input value={preview.subject} onChange={(event) => setPreview({ ...preview, subject: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
              <div className="text-xs font-semibold text-slate-700">Message<RichTextEmailEditor value={preview.body} onChange={(body) => setPreview((current) => current ? { ...current, body } : current)} minHeightClassName="min-h-64" /></div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button type="button" onClick={() => setPreview(null)} disabled={sendingEmail} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200">Cancel</button>
              <button type="button" onClick={() => void sendRejectionEmail()} disabled={sendingEmail} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"><Mail className="h-4 w-4" />{sendingEmail ? 'Sending...' : 'Send Email'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

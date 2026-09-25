import React, { useEffect, useState } from 'react';
import { RegistrationSubmission } from '../../types';
import { getCompanyById, updateSubmissionStatus } from '../../services/storage';
import { getCompanyExternalId } from '../../services/companyHelper';
import { exportSubmissionsToExcel } from '../../services/excelExport';
import { StatusBadge, TypeBadge, PortBadge } from '../common/Badge';
import {
  X,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  Download,
  Key,
  Calendar,
} from 'lucide-react';
import { notifyError, notifySuccess, summarizeError } from '../common/notifications';
import { formatAdminDateTime } from '../../utils/date';

interface SubmissionDetailModalProps {
  submission: RegistrationSubmission | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenAssignId: (companyId: string) => void;
  onStatusChange?: () => void;
  onReject?: (submission: RegistrationSubmission) => void;
}

export function SubmissionDetailModal({
  submission,
  isOpen,
  onClose,
  onOpenAssignId,
  onStatusChange,
  onReject,
}: SubmissionDetailModalProps) {
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => {
    setAdminNotes(submission?.admin_notes || '');
  }, [submission?.id, submission?.admin_notes]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !submission) return null;

  const company = submission.company_id ? getCompanyById(submission.company_id) : undefined;
  const idInfo = getCompanyExternalId(company || { company_type: submission.company_type });

  const handleUpdateStatus = (newStatus: any) => {
    if (newStatus === 'REJECTED' && submission.registration_type === 'COMPANY' && onReject) {
      onReject(submission);
      return;
    }
    updateSubmissionStatus(submission.id, newStatus, adminNotes);
    onStatusChange?.();
  };

  const handleExportSingle = () => {
    const result = exportSubmissionsToExcel([submission]);
    if (!result.success) {
      notifyError(summarizeError(result.error || 'Export failed.'));
    } else {
      notifySuccess('Submission exported successfully.');
      onStatusChange?.();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="submission-review-title"
        className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 sm:flex">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Submission review</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 id="submission-review-title" className="break-all text-base font-bold text-slate-900 sm:text-lg">
                  {submission.reference_no}
                </h2>
                <TypeBadge type={submission.registration_type} />
                <StatusBadge status={submission.status} />
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                <Calendar className="h-3.5 w-3.5" />
                Submitted {formatAdminDateTime(submission.submitted_at)}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close submission review"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
          {/* Missing ID warning if applicable */}
          {!idInfo.has_required_id && (
            <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-bold">
                    {idInfo.required_id_type === 'HAULIERID' ? 'HAULIERID' : 'Forwarding Agent ID'} required
                  </div>
                  <p className="mt-0.5 text-amber-800">
                    Assign the required company ID before exporting this submission to Excel.
                  </p>
                </div>
              </div>

              {submission.company_id && (
                <button
                  type="button"
                  onClick={() => onOpenAssignId(submission.company_id)}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-amber-700"
                >
                  Assign ID Now
                </button>
              )}
            </div>
          )}

          {/* Company Context */}
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:p-4">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">
              Company verification
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0">
                <span className="text-slate-500 block">Company Name</span>
                <span className="mt-1 block break-words font-bold leading-5 text-slate-900">{submission.company_name.toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 block">Registration No</span>
                <span className="mt-1 block break-all font-mono font-bold text-slate-900">{submission.company_reg_no}</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 block">Company Category</span>
                <span className="mt-1 block font-semibold text-blue-700">{idInfo.category}</span>
              </div>
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-slate-500"><Key className="h-3.5 w-3.5" />Assigned Backend ID</span>
                <span className="mt-1 block break-all font-mono font-bold leading-5 text-emerald-700">
                  {idInfo.active_id_value || <span className="text-amber-600 italic">Not Assigned</span>}
                </span>
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">
          {/* Form Specific Submitted Data */}
          <section className="h-full min-w-0 space-y-3 rounded-lg border border-slate-200 p-4">
            <div className="border-b border-slate-200 pb-2">
              <h3 className="text-sm font-bold text-slate-900">Submitted details</h3>
            </div>

            {submission.registration_type === 'COMPANY' && submission.data.company && (
              <div className="grid grid-cols-1 gap-x-5 gap-y-3 text-xs sm:grid-cols-2">
                <div className="min-w-0">
                  <span className="text-slate-500 block">Short Name</span>
                  <span className="mt-1 block font-semibold text-slate-900">{submission.data.company.short_name || 'N/A'}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-slate-500 block">SSM New Reg No</span>
                  <span className="mt-1 block break-all font-mono font-semibold text-slate-900">
                    {submission.data.company.registration_number_new || 'N/A'}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-slate-500 block">Contact Person</span>
                  <span className="mt-1 block break-words font-semibold leading-5 text-slate-900">
                    {submission.data.company.contact_name}
                    {submission.data.company.contact_designation ? ` (${submission.data.company.contact_designation})` : ''}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-slate-500 block">PIC Contact Info</span>
                  <span className="mt-1 block break-words leading-5 text-slate-800">
                    {submission.data.company.contact_email} / {submission.data.company.contact_mobile}
                    {submission.data.company.office_phone ? ` / Office: ${submission.data.company.office_phone}` : ''}
                    {submission.data.company.fax ? ` / Fax: ${submission.data.company.fax}` : ''}
                  </span>
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <span className="text-slate-500 block">Registered Address</span>
                  <span className="mt-1 block break-words leading-5 text-slate-800">
                    {submission.data.company.block ? `${submission.data.company.block}, ` : ''}
                    {submission.data.company.address1}, {submission.data.company.address2 ? `${submission.data.company.address2}, ` : ''}
                    {submission.data.company.city}, {submission.data.company.state} {submission.data.company.postcode}, {submission.data.company.country}
                  </span>
                </div>
              </div>
            )}

            {submission.registration_type === 'DRIVER' && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Driver List ({submission.data.drivers?.length || (submission.data.driver ? 1 : 0)})
                </div>
                <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                        <th className="py-2 px-2.5 w-8 text-center">#</th>
                        <th className="py-2 px-2.5">Driver Full Name</th>
                        <th className="py-2 px-2.5">Licence / NRIC</th>
                        <th className="py-2 px-2.5">Mobile Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(submission.data.drivers && submission.data.drivers.length > 0
                        ? submission.data.drivers
                        : submission.data.driver
                        ? [submission.data.driver]
                        : []
                      ).map((driver, i) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="py-1.5 px-2.5 text-center text-[10px] text-slate-400 font-bold font-mono">
                            {i + 1}
                          </td>
                          <td className="py-1.5 px-2.5 font-bold text-slate-900">{driver.name}</td>
                          <td className="py-1.5 px-2.5 font-mono text-slate-700">{driver.driving_license}</td>
                          <td className="py-1.5 px-2.5 text-slate-700">{driver.mobile_no}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {submission.registration_type === 'TRAILER' && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Trailer List ({submission.data.trailers?.length || (submission.data.trailer ? 1 : 0)})
                </div>
                <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                        <th className="py-2 px-2.5 w-8 text-center">#</th>
                        <th className="py-2 px-2.5">Trailer Plate / Reg No</th>
                        <th className="py-2 px-2.5">Type</th>
                        <th className="py-2 px-2.5">Unladen Wt</th>
                        <th className="py-2 px-2.5">BDM Wt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(submission.data.trailers && submission.data.trailers.length > 0
                        ? submission.data.trailers
                        : submission.data.trailer
                        ? [submission.data.trailer]
                        : []
                      ).map((trailer, i) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="py-1.5 px-2.5 text-center text-[10px] text-slate-400 font-bold font-mono">
                            {i + 1}
                          </td>
                          <td className="py-1.5 px-2.5 font-mono font-bold text-slate-900">
                            {trailer.registration_number}
                          </td>
                          <td className="py-1.5 px-2.5">
                            <span className="px-1.5 py-0.5 rounded bg-sky-50 text-[#0090e7] font-bold text-[10px] border border-sky-100">
                              {trailer.trailer_type}
                            </span>
                          </td>
                          <td className="py-1.5 px-2.5 font-mono text-slate-700">{trailer.weight} KG</td>
                          <td className="py-1.5 px-2.5 font-mono text-slate-700">{trailer.bdm_weight} KG</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {submission.registration_type === 'VEHICLE' && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Vehicle List ({submission.data.vehicles?.length || (submission.data.vehicle ? 1 : 0)})
                </div>
                <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                        <th className="py-2 px-2.5 w-8 text-center">#</th>
                        <th className="py-2 px-2.5">Vehicle Plate / Reg No</th>
                        <th className="py-2 px-2.5">Head Number</th>
                        <th className="py-2 px-2.5">Unladen Wt</th>
                        <th className="py-2 px-2.5">BGK Wt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(submission.data.vehicles && submission.data.vehicles.length > 0
                        ? submission.data.vehicles
                        : submission.data.vehicle
                        ? [submission.data.vehicle]
                        : []
                      ).map((vehicle, i) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="py-1.5 px-2.5 text-center text-[10px] text-slate-400 font-bold font-mono">
                            {i + 1}
                          </td>
                          <td className="py-1.5 px-2.5 font-mono font-bold text-slate-900">
                            {vehicle.registration_number}
                          </td>
                          <td className="py-1.5 px-2.5 font-mono font-bold text-sky-700">
                            {vehicle.head}
                          </td>
                          <td className="py-1.5 px-2.5 font-mono text-slate-700">{vehicle.weight} KG</td>
                          <td className="py-1.5 px-2.5 font-mono text-slate-700">{vehicle.bgk_weight} KG</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <div className="flex h-full min-w-0 flex-col gap-4">
          <section className="space-y-3 rounded-lg border border-slate-200 p-4">
            <div className="border-b border-slate-200 pb-2">
              <h3 className="text-sm font-bold text-slate-900">Submission contact</h3>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-xs sm:grid-cols-2">
              <div className="min-w-0">
                <span className="block text-slate-500">Submitted by</span>
                <span className="mt-1 block break-words font-semibold text-slate-900">{submission.submitted_by_name || 'N/A'}</span>
              </div>
              <div className="min-w-0">
                <span className="block text-slate-500">Email</span>
                <span className="mt-1 block break-all text-slate-800">{submission.submitted_by_email || 'N/A'}</span>
              </div>
              <div className="min-w-0">
                <span className="block text-slate-500">Mobile</span>
                <span className="mt-1 block break-words text-slate-800">{submission.submitted_by_mobile || 'N/A'}</span>
              </div>
              <div className="min-w-0">
                <span className="mb-1 block text-slate-500">Facility</span>
                <PortBadge location={submission.port_location} />
              </div>
            </div>
          </section>

          {/* Export status banner if already exported */}
          {submission.status === 'DONE' && (
            <div className="flex flex-1 flex-col justify-center rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                Exported to Excel backend
              </div>
              <div className="mt-1 break-all font-mono text-slate-700">{submission.export_filename || 'Filename unavailable'}</div>
              <div className="text-[11px] text-emerald-700 mt-0.5">
                Exported on {formatAdminDateTime(submission.exported_at)}
              </div>
            </div>
          )}
          </div>
          </div>

          {/* Admin Status Controls */}
          <section className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:grid-cols-2">
            <div className="space-y-2.5">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Registration status</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['PENDING', 'DONE', 'REJECTED'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => handleUpdateStatus(st)}
                    aria-pressed={submission.status === st}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      submission.status === st
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {st === 'PENDING' ? 'Pending' : st === 'DONE' ? 'Registered' : 'Rejected'}
                  </button>
                ))}
              </div>
            </div>
            <label className="block min-w-0">
              <span className="text-sm font-bold text-slate-900">Admin notes</span>
              <textarea
                value={adminNotes}
                onChange={(event) => setAdminNotes(event.target.value)}
                rows={2}
                placeholder="Add an internal review note..."
                className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
          </section>
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleExportSingle}
            disabled={!idInfo.has_required_id}
            title={!idInfo.has_required_id ? `Assign ${idInfo.required_id_type} before exporting` : 'Export this submission to Excel'}
            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export to Excel (.xlsx)
          </button>
        </div>
      </div>
    </div>
  );
}

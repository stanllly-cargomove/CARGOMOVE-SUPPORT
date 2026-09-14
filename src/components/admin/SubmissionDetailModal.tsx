import React, { useState } from 'react';
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
  Building2,
} from 'lucide-react';
import { notifyError, notifySuccess, summarizeError } from '../common/notifications';

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
  const [adminNotes, setAdminNotes] = useState(submission?.admin_notes || '');

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-900">
                Submission: {submission.reference_no}
              </span>
              <TypeBadge type={submission.registration_type} />
              <StatusBadge status={submission.status} />
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Submitted on {new Date(submission.submitted_at).toLocaleString()}
            </div>
          </div>

          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Missing ID warning if applicable */}
          {!idInfo.has_required_id && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div className="font-bold">
                    ⚠ {idInfo.required_id_type === 'HAULIERID' ? 'HAULIERID' : 'Forwarding Agent ID'} Required!
                  </div>
                  <p className="mt-0.5 text-amber-800">
                    This company has not been assigned a {idInfo.required_id_type}. Excel export is blocked until assigned.
                  </p>
                </div>
              </div>

              {submission.company_id && (
                <button
                  type="button"
                  onClick={() => onOpenAssignId(submission.company_id)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shrink-0 transition-colors shadow-xs"
                >
                  Assign ID Now
                </button>
              )}
            </div>
          )}

          {/* Company Context */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2">
            <div className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Master Company Verification
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <span className="text-slate-500 block">Company Name</span>
                <span className="font-bold text-slate-900">{submission.company_name.toUpperCase()}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Registration No</span>
                <span className="font-mono font-bold text-slate-900">{submission.company_reg_no}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Company Category</span>
                <span className="font-semibold text-blue-700">{idInfo.category}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Assigned Backend ID</span>
                <span className="font-mono font-bold text-emerald-700">
                  {idInfo.active_id_value || <span className="text-amber-600 italic">Not Assigned</span>}
                </span>
              </div>
            </div>
          </div>

          {/* Form Specific Submitted Data */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="font-bold text-slate-800 text-sm">
              Submitted Asset Specifications
            </div>

            {submission.registration_type === 'COMPANY' && submission.data.company && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Short Name</span>
                  <span className="font-semibold text-slate-900">{submission.data.company.short_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">SSM New Reg No</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {submission.data.company.registration_number_new || 'N/A'}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Registered Address</span>
                  <span className="text-slate-800">
                    {submission.data.company.block ? `${submission.data.company.block}, ` : ''}
                    {submission.data.company.address1}, {submission.data.company.address2 ? `${submission.data.company.address2}, ` : ''}
                    {submission.data.company.city}, {submission.data.company.state} {submission.data.company.postcode}, {submission.data.company.country}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Contact Person</span>
                  <span className="font-semibold text-slate-900">
                    {submission.data.company.contact_name}
                    {submission.data.company.contact_designation ? ` (${submission.data.company.contact_designation})` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">PIC Contact Info</span>
                  <span className="text-slate-800">
                    {submission.data.company.contact_email} / {submission.data.company.contact_mobile}
                    {submission.data.company.office_phone ? ` / Office: ${submission.data.company.office_phone}` : ''}
                    {submission.data.company.fax ? ` / Fax: ${submission.data.company.fax}` : ''}
                  </span>
                </div>
              </div>
            )}

            {submission.registration_type === 'DRIVER' && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Driver List ({submission.data.drivers?.length || (submission.data.driver ? 1 : 0)})
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
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
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
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
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
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
          </div>

          {/* Export status banner if already exported */}
          {submission.status === 'DONE' && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
              <div className="font-bold flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                Exported into Excel Backend File:
              </div>
              <div className="font-mono mt-1 text-slate-700">{submission.export_filename}</div>
              <div className="text-[11px] text-emerald-700 mt-0.5">
                Exported on {new Date(submission.exported_at || '').toLocaleString()}
              </div>
            </div>
          )}

          {/* Admin Status Controls */}
          <div className="pt-3 border-t border-slate-200 space-y-2">
            <label className="block text-xs font-semibold text-slate-700">
              Update Submission Status:
            </label>
            <div className="flex flex-wrap gap-2">
              {(['PENDING', 'DONE', 'REJECTED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => handleUpdateStatus(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    submission.status === st
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Mark as {st === 'DONE' ? 'REGISTERED' : st}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleExportSingle}
            disabled={!idInfo.has_required_id}
            className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export to Excel (.xlsx)
          </button>
        </div>
      </div>
    </div>
  );
}

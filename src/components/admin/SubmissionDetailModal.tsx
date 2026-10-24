import React, { useEffect, useState } from 'react';
import { RegistrationSubmission } from '../../types';
import { getCompanyById, getSubmissions, updateSubmissionStatus } from '../../services/storage';
import { getCompanyExternalId } from '../../services/companyHelper';
import { generateRegistrationExcel } from '../../services/registrationUploads';
import { RegistrationReference } from './RegistrationReference';
import { assetCompanyBlockReason } from '../../../shared/registration-eligibility';
import { CargoMoveIdBadge, StatusBadge } from '../common/Badge';
import {
  X,
  CheckCircle,
  AlertTriangle,
  Download,
  Calendar,
  MoreVertical,
  FileText,
} from 'lucide-react';
import { notifyError, notifySuccess, summarizeError } from '../common/notifications';
import { formatAdminDateTime } from '../../utils/date';

interface SubmissionDetailModalProps {
  submission: RegistrationSubmission | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenAssignId: (companyId: string) => void;
  onStatusChange?: () => void;
  onStatusUpdate?: (submission: RegistrationSubmission, status: 'DONE' | 'REJECTED', notes: string) => void;
  onExportSuccess?: (submission: RegistrationSubmission) => void;
  onReject?: (submission: RegistrationSubmission) => void;
}

export function SubmissionDetailModal({
  submission,
  isOpen,
  onClose,
  onOpenAssignId,
  onStatusChange,
  onStatusUpdate,
  onExportSuccess,
  onReject,
}: SubmissionDetailModalProps) {
  const [adminNotes, setAdminNotes] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showExportRecord, setShowExportRecord] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  useEffect(() => {
    setAdminNotes(submission?.admin_notes || '');
    setExportMenuOpen(false);
    setShowExportRecord(false);
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
  const companyBlockReason = assetCompanyBlockReason(submission, company, getSubmissions());
  const reviewLabels = {
    COMPANY: { title: 'Company registration', details: 'Company details', description: 'Check the company information, contact details and registered address.' },
    DRIVER: { title: 'Driver registration', details: 'Drivers', description: 'Check each driver’s name, identification and mobile number.' },
    TRAILER: { title: 'Trailer registration', details: 'Trailers', description: 'Check the trailer registration numbers, types and weights.' },
    VEHICLE: { title: 'Vehicle registration', details: 'Vehicles', description: 'Check the vehicle registration numbers, head numbers and weights.' },
  };
  const review = reviewLabels[submission.registration_type];

  const handleUpdateStatus = (newStatus: 'PENDING' | 'DONE' | 'REJECTED') => {
    if (newStatus === 'DONE' || newStatus === 'REJECTED') {
      if (newStatus === 'REJECTED' && submission.registration_type === 'COMPANY' && onReject) {
        onReject(submission);
        return;
      }
      if (onStatusUpdate) {
        onStatusUpdate(submission, newStatus, adminNotes);
        return;
      }
    }
    updateSubmissionStatus(submission.id, newStatus, adminNotes);
    onStatusChange?.();
  };

  const handleExportSingle = async () => {
    setExporting(true);
    const result = await generateRegistrationExcel([submission], setUploadProgress);
    setExporting(false);
    onStatusChange?.();
    if (!result.success) {
      notifyError(summarizeError(result.error || 'Export failed.'));
    } else {
      notifySuccess(submission.registration_type === 'COMPANY' ? 'Submission exported successfully.' : 'CargoMove processing verified.');
      onStatusChange?.();
      onExportSuccess?.(result.verified[0] || submission);
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
        className="submission-review flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="submission-review-title" className="break-words text-sm font-semibold leading-6 text-slate-900 sm:text-base">
                  <RegistrationReference submission={submission} /> - {submission.registration_type === 'COMPANY' ? review.title : review.title.toUpperCase()}
                </h2>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                <Calendar className="h-3.5 w-3.5" />
                Submitted {formatAdminDateTime(submission.submitted_at)}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex [&>span]:h-8 [&>span]:items-center [&>span]:rounded-lg [&>span]:px-3 [&>span]:py-0"><StatusBadge status={submission.status} /></span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close submission review"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="w-5 h-5" />
          </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden bg-slate-50 p-4 sm:p-6">
          {companyBlockReason && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">{companyBlockReason}</p>}
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
          <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs sm:px-5">
            <div className="grid grid-cols-2 items-start gap-x-5 gap-y-2 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
              <div className="col-span-2 min-w-0 lg:col-span-1"><p className="mb-1 text-slate-500">Company</p><h3 className="break-words font-bold leading-5 text-slate-900">{submission.company_name.toUpperCase()}</h3></div>
              <div className="min-w-0">
                <span className="text-slate-500 block">Registration No</span>
                <span className="mt-1 block break-words font-semibold leading-5 text-slate-900">{submission.company_reg_no}</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 block">Company category</span>
                <span className="mt-1 block break-words font-semibold leading-5 text-slate-900">{idInfo.category}</span>
              </div>
              <div className="min-w-0">
                <span className="block text-slate-500">CargoMove ID</span>
                <span className="mt-1 block">
                  {idInfo.active_id_value ? <CargoMoveIdBadge id={idInfo.active_id_value} /> : <span className="text-amber-600 italic">Not Assigned</span>}
                </span>
              </div>
              <div><span className="block text-slate-500">Facility</span><span className="mt-1 block font-semibold leading-5 text-slate-900">{submission.port_location === 'PORT_KLANG' ? 'Port Klang' : submission.port_location === 'JOHOR' ? 'Johor' : 'Other'}</span></div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-x-5 gap-y-2 border-t border-slate-100 pt-2 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_minmax(0,1.7fr)]">
              <div className="min-w-0"><span className="block text-slate-500">Submitted by</span><span className="mt-1 block break-words font-semibold text-slate-900">{submission.submitted_by_name || 'Not provided'}</span></div>
              <div className="min-w-0"><span className="block text-slate-500">Email</span><span className="mt-1 block break-all text-slate-800">{submission.submitted_by_email || 'Not provided'}</span></div>
              <div className="min-w-0"><span className="block text-slate-500">Mobile</span><span className="mt-1 block break-words text-slate-800">{submission.submitted_by_mobile || 'Not provided'}</span></div>
            </div>
          </section>

          <div className="space-y-4">
          {/* Form Specific Submitted Data */}
          <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">{review.details}</h3>
              <p className="mt-0.5 text-xs leading-4 text-slate-500">{review.description}</p>
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
                  <span className="text-slate-500 block">Contact email</span>
                  <span className="mt-1 block break-all leading-5 text-slate-800">{submission.data.company.contact_email || 'Not provided'}</span>
                </div>
                <div><span className="block text-slate-500">Contact mobile</span><span className="mt-1 block break-words text-slate-800">{submission.data.company.contact_mobile || 'Not provided'}</span></div>
                <div><span className="block text-slate-500">Office phone</span><span className="mt-1 block break-words text-slate-800">{submission.data.company.office_phone || 'Not provided'}</span></div>
                {submission.data.company.fax && <div><span className="block text-slate-500">Fax</span><span className="mt-1 block break-words text-slate-800">{submission.data.company.fax}</span></div>}
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
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                        <th className="py-2 px-2.5 w-8 text-center">#</th>
                        <th className="py-2 px-2.5">Driver Full Name</th>
                        <th className="py-2 px-2.5">Licence / identification</th>
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
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                        <th className="py-2 px-2.5 w-8 text-center">#</th>
                        <th className="py-2 px-2.5">Trailer Plate / Reg No</th>
                        <th className="py-2 px-2.5">Type</th>
                        <th className="py-2 px-2.5">Unladen (kg)</th>
                        <th className="py-2 px-2.5">BDM (kg)</th>
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
                          <td className="py-1.5 px-2.5 font-mono text-slate-700">{trailer.weight || '—'}</td>
                          <td className="py-1.5 px-2.5 font-mono text-slate-700">{trailer.bdm_weight || '—'}</td>
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
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                        <th className="py-2 px-2.5 w-8 text-center">#</th>
                        <th className="py-2 px-2.5">Vehicle Plate / Reg No</th>
                        <th className="py-2 px-2.5">Head Number</th>
                        <th className="py-2 px-2.5">Unladen (kg)</th>
                        <th className="py-2 px-2.5">BGK (kg)</th>
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
                          <td className="py-1.5 px-2.5 font-mono text-slate-700">{vehicle.weight || '—'}</td>
                          <td className="py-1.5 px-2.5 font-mono text-slate-700">{vehicle.bgk_weight || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          </div>

          {/* Admin Status Controls */}
          <section className="grid gap-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 lg:grid-cols-2">
            <div className="flex h-full flex-col gap-2.5">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Review decision</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">Choose a status after checking the submitted details.</p>
              </div>
              <div className="flex min-h-16 flex-1 flex-wrap items-center gap-2">
                {(['PENDING', 'DONE', 'REJECTED'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => handleUpdateStatus(st)}
                    disabled={st === 'DONE' && !!companyBlockReason}
                    title={st === 'DONE' ? companyBlockReason || undefined : undefined}
                    aria-pressed={submission.status === st}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      submission.status === st
                        ? st === 'DONE' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : st === 'REJECTED' ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-amber-300 bg-amber-50 text-amber-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {st === 'PENDING' ? 'Pending' : st === 'DONE' ? 'Registered' : 'Rejected'}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex h-full min-w-0 flex-col">
              <span className="text-sm font-bold text-slate-900">Internal review notes</span>
              <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Saved when you update the registration status.</span>
              <textarea
                value={adminNotes}
                onChange={(event) => setAdminNotes(event.target.value)}
                rows={2}
                placeholder="Add an internal review note..."
                className="mt-2 min-h-16 w-full flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
          </section>
        </div>

        {uploadProgress && <p role="status" className="px-4 py-2 text-xs text-blue-700">{uploadProgress}</p>}
        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 shrink-0 rounded-lg px-2 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:px-4"
          >
            Close
          </button>

          <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={handleExportSingle}
            disabled={!!companyBlockReason || !idInfo.has_required_id || exporting || submission.registration_type !== 'COMPANY' && submission.status === 'REJECTED'}
            title={companyBlockReason || (!idInfo.has_required_id ? `Assign ${idInfo.required_id_type} before exporting` : 'Export this submission to Excel')}
            className="inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg bg-emerald-600 px-2 py-2 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-xs"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            <span>{exporting ? 'Uploading and verifying...' : submission.registration_type === 'COMPANY' ? 'Export to Excel (.xlsx)' : 'Generate Excel & Upload'}</span>
          </button>
          <div className="relative">
            <button type="button" aria-label="More export options" aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen((value) => !value)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><MoreVertical className="h-4 w-4" /></button>
            {exportMenuOpen && <>
              <button type="button" tabIndex={-1} aria-label="Close export options" onClick={() => setExportMenuOpen(false)} className="fixed inset-0 z-10 cursor-default" />
              <div role="menu" className="absolute bottom-full right-0 z-20 mb-2 w-64 max-w-[80vw] rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                <button type="button" role="menuitem" aria-expanded={showExportRecord} onClick={() => setShowExportRecord((value) => !value)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"><CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />Excel Generated record</button>
                {showExportRecord && <div className="mx-2 mb-2 rounded-md border border-slate-100 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                  {submission.exported_at || submission.export_filename ? <><p className="break-words font-medium text-slate-800">{submission.export_filename || 'Filename not recorded'}</p><p className="mt-1">{submission.exported_at ? `Generated on ${formatAdminDateTime(submission.exported_at)}` : 'Generation date not recorded'}</p></> : <p>No Excel generation recorded.</p>}
                </div>}
                {submission.registration_type !== 'COMPANY' ? <a role="menuitem" href={`/api/email/submission-attachment?submissionIds=${encodeURIComponent(submission.id)}&download=1`} onClick={() => setExportMenuOpen(false)} className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><FileText className="h-4 w-4 text-blue-600" />Generate PDF Slip</a> : <button type="button" role="menuitem" disabled title="Company emails do not include an asset PDF slip" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-400"><FileText className="h-4 w-4" />PDF slip unavailable</button>}
              </div>
            </>}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

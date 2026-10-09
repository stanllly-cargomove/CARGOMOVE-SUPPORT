import React, { useState } from 'react';
import { RegistrationType, RegistrationSubmission, Company } from '../../types';
import { getSubmissions, getCompanies, getCompanyById } from '../../services/storage';
import { getCompanyExternalId, generateExcelFilename } from '../../services/companyHelper';
import { exportSubmissionsToExcel, EXCEL_TEMPLATES } from '../../services/excelExport';
import { EmailPreview, generateSubmissionBatchEmailPreviews, sendSubmissionBatchEmail } from '../../services/email';
import { TypeBadge } from '../common/Badge';
import { PdfAttachmentIcon } from './PdfAttachmentIcon';
import {
  FileSpreadsheet,
  Download,
  AlertTriangle,
  CheckCircle2,
  Filter,
  Layers,
  ArrowRight,
  Mail,
  X,
} from 'lucide-react';
import { notifyError, notifySuccess, notifyWarning, summarizeError } from '../common/notifications';

export function ExcelExportCenter() {
  const [selectedType, setSelectedType] = useState<RegistrationType>('COMPANY');
  const [filterCompanyId, setFilterCompanyId] = useState<string>('ALL');
  const [emailPreviews, setEmailPreviews] = useState<EmailPreview[]>([]);
  const [sendingPreview, setSendingPreview] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(0);

  const submissions = getSubmissions();
  const companies = getCompanies();

  // Filter submissions by chosen type and company
  const filteredSubmissions = submissions.filter((s) => {
    const matchesType = s.registration_type === selectedType;
    const matchesComp = filterCompanyId === 'ALL' || s.company_id === filterCompanyId;
    return matchesType && matchesComp;
  });

  // Calculate validation stats
  const itemsMissingId = filteredSubmissions.filter((s) => {
    const comp = s.company_id ? getCompanyById(s.company_id) : undefined;
    const idInfo = getCompanyExternalId(comp || { company_type: s.company_type });
    return !idInfo.has_required_id;
  });

  const canExport = filteredSubmissions.length > 0 && itemsMissingId.length === 0;

  const currentTemplate = EXCEL_TEMPLATES[selectedType];

  const handleExport = async () => {
    if (filteredSubmissions.length === 0) {
      const message = 'No submissions available to export in this category.';
      notifyWarning(message);
      return;
    }

    const res = exportSubmissionsToExcel(filteredSubmissions);
    if (!res.success) {
      notifyError(summarizeError(res.error || 'Export failed.'));
    } else {
      notifySuccess(`Export complete: ${res.count} record(s) generated.`);
      if (selectedType !== 'COMPANY') {
        try {
          setPreviewPage(0);
          setEmailPreviews(await generateSubmissionBatchEmailPreviews(filteredSubmissions.map((submission) => submission.id)));
        } catch (error) {
          notifyError(error instanceof Error ? error.message : 'Excel exported, but the email previews could not be prepared.');
        }
      }
    }
  };

  const sendPreview = async (preview: EmailPreview) => {
    setSendingPreview(preview.previewToken);
    try {
      await sendSubmissionBatchEmail(preview);
      setEmailPreviews((current) => {
        const next = current.filter((item) => item.previewToken !== preview.previewToken);
        setPreviewPage((page) => Math.min(page, Math.max(0, next.length - 1)));
        return next;
      });
      notifySuccess(`Registration email sent to ${preview.recipient}.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to send the registration email.');
    } finally {
      setSendingPreview(null);
    }
  };

  // Sample projected filename
  const sampleComp = filterCompanyId !== 'ALL' ? companies.find((c) => c.id === filterCompanyId) : undefined;
  const projectedFilename = generateExcelFilename(sampleComp?.short_name || sampleComp?.name, selectedType);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Excel Export Center</h2>
        <p className="text-xs text-slate-500 mt-1">
          Generate strict backend-compliant Excel spreadsheets for Port Operating Systems (TOS).
        </p>
      </div>

      {emailPreviews.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" aria-labelledby="batch-email-preview-title" className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div><h3 id="batch-email-preview-title" className="font-bold text-slate-900">Registration Email Previews</h3><p className="mt-0.5 text-xs text-slate-500">One separate email per company; review each company’s registration list before sending.</p></div>
              <button type="button" onClick={() => setEmailPreviews([])} disabled={Boolean(sendingPreview)} aria-label="Close email previews" className="rounded-lg p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5">
              {emailPreviews.slice(previewPage, previewPage + 1).map((preview) => <article key={preview.previewToken} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="text-sm font-bold text-slate-900">{preview.templateName}</h4><p className="mt-1 text-xs text-slate-600"><strong>To:</strong> {preview.recipient}</p><p className="mt-1 text-xs text-slate-600"><strong>Subject:</strong> {preview.subject}</p></div><button type="button" onClick={() => void sendPreview(preview)} disabled={Boolean(sendingPreview)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"><Mail className="h-3.5 w-3.5" />{sendingPreview === preview.previewToken ? 'Sending...' : 'Send Email'}</button></div>
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: preview.body }} />
                {preview.attachments.map((attachment) => <div key={attachment.path} className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"><span className="flex min-w-0 items-center gap-3"><PdfAttachmentIcon /><span className="min-w-0"><span className="block text-slate-500">Attachment</span><strong className="block truncate text-slate-800" title={attachment.name}>{attachment.name}</strong></span></span><span className="flex shrink-0 gap-3"><a href={attachment.path} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:text-blue-800">View</a><a href={`${attachment.path}&download=1`} className="font-semibold text-blue-600 hover:text-blue-800">Download</a></span></div>)}
              </article>)}
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3"><div className="flex items-center gap-2 text-xs text-slate-600"><button type="button" onClick={() => setPreviewPage((page) => Math.max(0, page - 1))} disabled={previewPage === 0 || Boolean(sendingPreview)} className="rounded px-2 py-1 hover:bg-slate-200 disabled:opacity-40">Previous</button><span>Company {previewPage + 1} of {emailPreviews.length}</span><button type="button" onClick={() => setPreviewPage((page) => Math.min(emailPreviews.length - 1, page + 1))} disabled={previewPage >= emailPreviews.length - 1 || Boolean(sendingPreview)} className="rounded px-2 py-1 hover:bg-slate-200 disabled:opacity-40">Next</button></div><button type="button" onClick={() => setEmailPreviews([])} disabled={Boolean(sendingPreview)} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">Close</button></div>
          </div>
        </div>
      )}

      {/* Select Category Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE'] as RegistrationType[]).map((type) => {
          const isSelected = selectedType === type;
          const count = submissions.filter((s) => s.registration_type === type).length;

          return (
            <button
              key={type}
              type="button"
              onClick={() => {
                setSelectedType(type);
              }}
              className={`p-4 rounded-xl text-left border transition-all ${
                isSelected
                  ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-500/20 shadow-xs'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <FileSpreadsheet
                  className={`w-5 h-5 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`}
                />
                <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                  {count} records
                </span>
              </div>
              <div className="text-sm font-bold text-slate-900 mt-2">
                {type}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {EXCEL_TEMPLATES[type].length} headers defined
              </div>
            </button>
          );
        })}
      </div>

      {/* Config & Validation Panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase">Target Excel Template</span>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              Admin_{selectedType}_Template.xlsx
            </div>
            <div className="text-xs font-mono text-slate-500 mt-0.5">
              Output Filename Pattern: <span className="text-blue-700 font-semibold">{projectedFilename}</span>
            </div>
          </div>

          {/* Filter by Specific Company */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">Filter Company:</label>
            <select
              value={filterCompanyId}
              onChange={(e) => setFilterCompanyId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.short_name || c.name} ({c.registration_number})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Validation Status */}
        {itemsMissingId.length > 0 ? (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold">
                Export Blocked: {itemsMissingId.length} record(s) belong to companies missing mandatory Backend IDs!
              </div>
              <p className="mt-0.5 text-amber-800">
                To prevent corrupted uploads into the Port Operating System, our validation engine prevents exporting records until their parent company has either a HAULIERID or FORWARDING_AGENT_ID assigned in the Company Master.
              </p>
            </div>
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs">
            No submissions recorded for this category yet. Submit records via the Customer Portal to populate.
          </div>
        ) : (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <strong>All Validation Passed!</strong> All {filteredSubmissions.length} record(s) have valid parent IDs resolved and are ready for official export.
            </div>
          </div>
        )}

        {/* Action button */}
        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-slate-500">
            Selected for Export: <strong className="text-slate-800 font-mono">{filteredSubmissions.length}</strong> row(s)
          </div>

          <button
            type="button"
            disabled={!canExport}
            onClick={handleExport}
            className="inline-flex items-center px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors shadow-sm"
          >
            <Download className="w-4 h-4 mr-2" />
            Generate & Download {selectedType} Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* Strict Header Structure Preview */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Verified Excel Column Sequence ({currentTemplate.length} Columns)
          </div>
          <span className="text-[11px] text-slate-400">Strict Header Compliance Active</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {currentTemplate.map((h, idx) => (
            <div
              key={h}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-slate-800 font-mono text-[11px]"
            >
              <span className="text-slate-400 font-bold text-[10px]">{idx + 1}.</span>
              <span className="font-bold text-blue-900">{h}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

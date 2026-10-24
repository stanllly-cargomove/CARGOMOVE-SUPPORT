import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import type { RegistrationSubmission } from '../../types';
import { checkRegistrationUpload } from '../../services/registrationUploads';
import { notifyError } from '../common/notifications';

export function RegistrationReference({ submission }: { submission: RegistrationSubmission }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updated, setUpdated] = useState<RegistrationSubmission | null>(null);
  useEffect(() => { setUpdated(null); }, [submission]);
  const current = updated || submission;
  const upload = current.cargomove_upload;
  const failed = upload && ['FAILED', 'UNKNOWN'].includes(upload.state);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [open]);
  const check = async () => {
    setChecking(true);
    try { setUpdated(await checkRegistrationUpload(upload!.id)); }
    catch (error) { notifyError(error instanceof Error ? error.message : 'Unable to check CargoMove.'); }
    finally { setChecking(false); }
  };
  return <span className="inline-flex items-center gap-1.5">
    <span className={`admin-registration-copy-text font-mono font-bold ${failed ? 'text-red-600' : ''}`}>{current.reference_no}</span>
    {upload && upload.state !== 'SUCCESS' && <button type="button" aria-label={`CargoMove upload information for ${current.reference_no}`}
      onClick={event => { event.stopPropagation(); setOpen(true); }}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${failed ? 'text-red-600 hover:bg-red-50' : 'text-blue-600 hover:bg-blue-50'}`}><Info className="h-4 w-4" /></button>}
    {open && upload && createPortal(<div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4" onClick={event => { event.stopPropagation(); setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label={`CargoMove upload for ${current.reference_no}`} onClick={event => event.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 text-sm text-slate-700 shadow-xl">
        <div className="flex items-center justify-between gap-3"><h3 className={`font-bold ${failed ? 'text-red-600' : 'text-slate-900'}`}>{current.reference_no}</h3><button autoFocus type="button" aria-label="Close upload information" onClick={() => setOpen(false)} className="rounded p-2 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
        <p className="mt-3 font-semibold">{upload.state === 'FAILED' ? 'Failed to upload or process this registration in CargoMove.' : upload.state === 'UNKNOWN' ? 'CargoMove upload or processing could not be verified.' : upload.state === 'SUCCESS' ? 'CargoMove processing verified.' : 'CargoMove upload is in progress.'}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{upload.message}</p>
        {upload.state !== 'SUCCESS' && <p className="mt-2 text-xs">This registration remains Pending.</p>}
        <p className="mt-3 break-all text-xs text-slate-500">{upload.filename}</p>
        {(upload.successCount !== null || upload.errorCount !== null) && <p className="mt-2 text-xs">Successful: {upload.successCount ?? 'unverified'} / {upload.expectedRows}. Errors: {upload.errorCount ?? 'unverified'}.</p>}
        {!['SUCCESS', 'FAILED'].includes(upload.state) && <button type="button" disabled={checking} onClick={() => void check()} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{checking ? 'Checking CargoMove...' : 'Check CargoMove result'}</button>}
      </div>
    </div>, document.body)}
  </span>;
}

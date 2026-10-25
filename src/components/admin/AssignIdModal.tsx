import React, { useState, useEffect } from 'react';
import { Company } from '../../types';
import { getCompanyExternalId, normalizeCompanyCategory } from '../../services/companyHelper';
import { updateCompanyId } from '../../services/storage';
import { X, Key } from 'lucide-react';
import { notifyError, notifySuccess, notifyWarning } from '../common/notifications';

interface AssignIdModalProps {
  company: Company | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AssignIdModal({
  company,
  isOpen,
  onClose,
  onSuccess,
}: AssignIdModalProps) {
  const [idValue, setIdValue] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (company) {
      const idInfo = getCompanyExternalId(company);
      setIdValue(idInfo.active_id_value || '');
      setSavedSuccess(false);
    }
  }, [company]);

  if (!isOpen || !company) return null;

  const idInfo = getCompanyExternalId(company);
  const category = idInfo.category;
  const targetIdType = idInfo.required_id_type; // 'HAULIERID' or 'FORWARDING_AGENT_ID'

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idValue.trim()) {
      const message = `Please enter a valid ${targetIdType}.`;
      notifyWarning(message);
      return;
    }

    const confirmed = window.confirm(
      'Save this ID to the Company Master? This will update the company record and apply the ID to related registrations and future exports.'
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const saved = await updateCompanyId(company.id, targetIdType, idValue.trim());
      if (!saved) throw new Error('Company record was not found.');
      setSavedSuccess(true);
      notifySuccess('Master ID assigned successfully.');
      onSuccess?.();
      onClose();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to save the Company Master ID.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-md">
      <div role="dialog" aria-modal="true" aria-label="Assign Master Backend ID" className="company-id-dialog max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
            <Key className="w-5 h-5 text-blue-600" />
            Assign Master Backend ID
          </div>
          <button
            onClick={onClose}
            aria-label="Close ID assignment"
            disabled={saving}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-slate-500">Company Name:</span>
            <span className="font-bold text-slate-900">{company.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Registration No:</span>
            <span className="font-mono font-bold text-slate-900">{company.registration_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Company Type:</span>
            <span className="font-semibold text-slate-800">{company.company_type}</span>
          </div>
          <div className="flex justify-between pt-1 border-t border-slate-200">
            <span className="text-slate-500">Normalized Category:</span>
            <span className="font-bold text-blue-700">{category}</span>
          </div>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-900 mb-1">
              {targetIdType === 'HAULIERID' ? 'HAULIERID' : 'FORWARDING_AGENT_ID'}{' '}
              <span className="text-rose-500">*</span>
            </label>
            <p className="text-[11px] text-slate-500 mb-2">
              {category === 'HAULIER'
                ? 'Because this company is categorized as Haulage/Haulier, HAULIERID must be populated and FORWARDING_AGENT_ID remains blank.'
                : 'Because this company is categorized as Forwarder/Transporter, FORWARDING_AGENT_ID must be populated and HAULIERID remains blank.'}
            </p>

            <input
              type="text"
              value={idValue}
              onChange={(e) => {
                setIdValue(e.target.value);
              }}
              placeholder={targetIdType === 'HAULIERID' ? 'XYZ-HAUL-456' : '64abc123xyz'}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={savedSuccess || saving}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'SAVING...' : 'SAVE CHANGES'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

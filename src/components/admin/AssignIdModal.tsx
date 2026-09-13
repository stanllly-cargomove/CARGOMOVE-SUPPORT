import React, { useState, useEffect } from 'react';
import { Company } from '../../types';
import { getCompanyExternalId, normalizeCompanyCategory } from '../../services/companyHelper';
import { updateCompanyId } from '../../services/storage';
import { X, Key } from 'lucide-react';
import { notifySuccess, notifyWarning } from '../common/notifications';

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

  const handleSave = (e: React.FormEvent) => {
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

    updateCompanyId(company.id, targetIdType, idValue.trim());
    setSavedSuccess(true);
    notifySuccess('Master ID assigned successfully.');

    setTimeout(() => {
      onSuccess?.();
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
            <Key className="w-5 h-5 text-blue-600" />
            Assign Master Backend ID
          </div>
          <button
            onClick={onClose}
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

          <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 text-[11px] text-blue-800 leading-relaxed">
            <strong>Automatic Propagation:</strong> Assigning this ID once saves it permanently to the Company Master and immediately updates all existing and future Driver, Trailer, Vehicle, and Company Excel exports!
          </div>

          <div className="flex items-center justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savedSuccess}
              className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
            >
              Save to Master
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, UserRound } from 'lucide-react';

export interface UserAccessFormData {
  username: string;
  email: string;
  password_hash: string;
  password?: string;
  full_name: string;
  mobile_number: string;
}

interface UserAccessFormProps {
  companyName: string;
  initialData?: UserAccessFormData;
  onSubmit: (data: UserAccessFormData) => void;
  onBack: () => void;
}

function FieldError({ message }: { message?: string }) {
  return <p aria-live="polite" className="min-h-[12px] text-[10px] text-rose-600 mt-0.5">{message || ''}</p>;
}

async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function UserAccessForm({ companyName, initialData, onSubmit, onBack }: UserAccessFormProps) {
  const [formData, setFormData] = useState({
    username: initialData?.username || '',
    email: initialData?.email || '',
    password: initialData?.password || '',
    full_name: initialData?.full_name || '',
    mobile_number: initialData?.mobile_number || '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (field: keyof typeof formData, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!formData.username.trim()) nextErrors.username = 'Username is required.';
    if (!formData.email.trim() || !formData.email.includes('@')) nextErrors.email = 'A valid email is required.';
    if (formData.password.length < 6) nextErrors.password = 'Password must be at least 6 characters.';
    if (!formData.full_name.trim()) nextErrors.full_name = 'Full name is required.';
    if (!formData.mobile_number.trim()) nextErrors.mobile_number = 'Mobile number is required.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      onSubmit({
        username: formData.username.trim(),
        email: formData.email.trim().toLowerCase(),
        password_hash: await hashPassword(formData.password),
        password: formData.password,
        full_name: formData.full_name.trim(),
        mobile_number: formData.mobile_number.trim(),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="customer-form max-w-3xl mx-auto min-h-[calc(100vh-270px)] flex flex-col gap-3">
      <div className="flex items-center justify-between pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight">Register User Access</h2>
          <p className="text-slate-500 text-xs mt-0.5">Create the first Cargomove login for {companyName || 'your company'}.</p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 text-[10px] font-semibold text-[#0090e7]">
        4. User Access Details
      </div>

      <div className="flex-1 bg-white rounded-lg border border-slate-200 p-4 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-xs uppercase tracking-wider pb-2 border-b border-slate-100">
          <UserRound className="w-4 h-4 text-[#0090e7]" />
          Login Account
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {[
            { field: 'username' as const, label: 'Username', type: 'text', placeholder: 'company.admin' },
            { field: 'email' as const, label: 'Email address', type: 'email', placeholder: 'admin@company.com' },
            { field: 'password' as const, label: 'Password', type: 'password', placeholder: 'Minimum 6 characters' },
            { field: 'full_name' as const, label: 'Full name', type: 'text', placeholder: 'Kevin Tan' },
            { field: 'mobile_number' as const, label: 'Mobile number', type: 'tel', placeholder: '+60123456789' },
          ].map((item) => (
            <div key={item.field}>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                {item.label} <span className="text-rose-500">*</span>
              </label>
              <input
                type={item.type}
                value={formData[item.field]}
                onChange={(event) => handleChange(item.field, event.target.value)}
                placeholder={item.placeholder}
                autoComplete={item.field === 'password' ? 'new-password' : item.field}
                minLength={item.field === 'password' ? 6 : undefined}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
              />
              <FieldError message={errors[item.field]} />
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 bg-slate-50 border border-slate-100 rounded p-2">
          This account can be used to log in to Cargomove and add additional users later.
        </p>
      </div>

      <div className="flex justify-between pt-1">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <button type="submit" disabled={isSubmitting} className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#0095e8] text-white text-xs font-bold hover:bg-[#0078c8] disabled:opacity-60">
          Continue to Review <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </form>
  );
}

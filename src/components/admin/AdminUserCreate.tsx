import React, { useState } from 'react';
import { KeyRound, LoaderCircle, UserPlus, X } from 'lucide-react';
import { createAdminUser } from '../../services/auth';
import { refreshProtectedStorage } from '../../services/storage';
import { notifyError, notifySuccess } from '../common/notifications';

const EMPTY_FORM = { username: '', fullName: '', password: '', mobileNumber: '', email: '' };

interface AdminUserCreateProps {
  onClose: () => void;
}

export function AdminUserCreate({ onClose }: AdminUserCreateProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = (field: keyof typeof EMPTY_FORM, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.password.length < 6) {
      notifyError('Password must be at least 6 characters.');
      return;
    }
    setIsSubmitting(true);
    try {
      await createAdminUser(form);
      await refreshProtectedStorage();
      setForm(EMPTY_FORM);
      notifySuccess('Admin user created successfully.');
      onClose();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to create the user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="admin-user-title" className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 p-5 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="admin-user-title" className="text-xl font-bold text-slate-900 tracking-tight">Admin User</h2>
            <p className="text-xs text-slate-500 mt-1">Create an admin-capable Cargomove account. The password is stored only in Supabase Auth.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
      <form onSubmit={submit} className="space-y-5">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-sm"><UserPlus className="w-4 h-4 text-blue-600" /> Account details</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-xs font-semibold text-slate-700">Username<input required value={form.username} onChange={(event) => update('username', event.target.value)} autoComplete="username" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-700">Name<input required value={form.fullName} onChange={(event) => update('fullName', event.target.value)} autoComplete="name" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-700">Email<input required type="email" value={form.email} onChange={(event) => update('email', event.target.value)} autoComplete="email" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-700">Phone number<input required type="tel" value={form.mobileNumber} onChange={(event) => update('mobileNumber', event.target.value)} autoComplete="tel" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Password <span className="font-normal text-slate-400">(at least 6 characters)</span><div className="relative mt-1.5"><KeyRound className="absolute left-3 top-3 w-4 h-4 text-slate-400" /><input required minLength={6} type="password" value={form.password} onChange={(event) => update('password', event.target.value)} autoComplete="new-password" className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm" /></div></label>
        </div>
        <button type="submit" disabled={isSubmitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
          {isSubmitting ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          {isSubmitting ? 'Creating user...' : 'Create admin user'}
        </button>
      </form>
      </div>
    </div>
  );
}

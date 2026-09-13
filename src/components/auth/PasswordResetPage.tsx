import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, LockKeyhole, LoaderCircle } from 'lucide-react';
import { browserSupabaseAuth } from '../../services/supabaseAuth';

interface PasswordResetPageProps {
  onDone: () => void;
}

export function PasswordResetPage({ onDone }: PasswordResetPageProps) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('error=') || hash.includes('error_code=')) {
      setError('This reset link has expired or has already been used. Request a new reset email.');
      return;
    }
    if (!browserSupabaseAuth) {
      setError('Password reset is not configured.');
      return;
    }
    void browserSupabaseAuth.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError || !data.session) {
        setError('This reset link is invalid or expired. Request a new reset email.');
      } else {
        setIsReady(true);
      }
    });
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    if (!browserSupabaseAuth) return;
    setIsSubmitting(true);
    const { error: updateError } = await browserSupabaseAuth.auth.updateUser({ password });
    setIsSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await browserSupabaseAuth.auth.signOut();
    window.history.replaceState({}, document.title, window.location.pathname);
    setMessage('Password updated. You can now sign in with your new password.');
  };

  return (
    <main className="min-h-screen bg-[#f8fafc] flex items-center justify-center px-4 py-8">
      <section className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-[#0b1930] px-6 py-7 text-white">
          <div className="flex items-center gap-3">
            <LockKeyhole className="w-7 h-7 text-sky-400" />
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-sky-300 font-bold">Cargomove</p>
              <h1 className="text-xl font-bold">Set a new password</h1>
            </div>
          </div>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
          {message && <div role="status" className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"><CheckCircle2 className="w-4 h-4 shrink-0" />{message}</div>}
          {!message && isReady && (
            <>
              <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" autoComplete="new-password" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              <input type="password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Confirm new password" autoComplete="new-password" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              <button type="submit" disabled={isSubmitting} className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
                {isSubmitting ? <LoaderCircle className="inline w-4 h-4 animate-spin" /> : 'Update password'}
              </button>
            </>
          )}
          {message && <button type="button" onClick={onDone} className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-bold text-white">Go to login</button>}
        </form>
      </section>
    </main>
  );
}

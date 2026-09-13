import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, LoaderCircle, LockKeyhole, LogIn, Mail } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../../services/supabase';

interface LoginPageProps {
  onBack: () => void;
  onSuccess: () => void;
}

export function LoginPage({ onBack, onSuccess }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!supabase || !isSupabaseConfigured) {
      setError('Secure login is not configured for this environment.');
      return;
    }

    if (!email.trim() || !password) {
      setError('Enter your username or email and password.');
      return;
    }

    setIsSubmitting(true);
    const loginEmail = email.includes('@')
      ? email.trim().toLowerCase()
      : `${email.trim().toLowerCase()}@cargomove.local`;
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (signInError) {
      setIsSubmitting(false);
      setError('Login failed. Check your email and password.');
      return;
    }

    const { data: appUser, error: appUserError } = await supabase
      .from('user_registrations')
      .select('id, username, email, type, full_name')
      .eq('email', loginEmail)
      .eq('type', 'ADMIN')
      .maybeSingle();

    if (appUserError || !appUser) {
      await supabase.auth.signOut();
      setIsSubmitting(false);
      setError('This login is not registered as an active admin user.');
      return;
    }

    setIsSubmitting(false);
    onSuccess();
  };

  return (
    <main className="min-h-screen bg-[#f8fafc] flex items-center justify-center px-4 py-8">
      <section className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-[#0b1930] px-6 py-7 text-white">
          <div className="flex items-center gap-3">
            <LockKeyhole className="w-7 h-7 text-sky-400" />
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-sky-300 font-bold">Cargomove</p>
              <h1 className="text-xl font-bold">Secure admin login</h1>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-300">
            Sign in to access company master data, registrations, and operational tools.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="block text-xs font-bold text-slate-700 mb-1.5">Username or email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                id="login-email"
                type="text"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="admin or admin@company.com"
                className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-bold text-slate-700 mb-1.5">Password</label>
            <div className="relative">
              <LockKeyhole className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {isSubmitting ? 'Signing in...' : 'Login'}
          </button>

          <button type="button" onClick={onBack} className="w-full inline-flex items-center justify-center gap-2 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to registration
          </button>
        </form>
      </section>
    </main>
  );
}

import React, { useRef, useState } from 'react';
import { ArrowLeft, Info, LoaderCircle, Lock, User, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import cargoMoveLogo from '../../../media/image-removebg-preview.png';
import { loginApplicationUser } from '../../services/auth';

interface LoginPageProps {
  onBack: () => void;
  onSuccess: (authenticated: boolean) => void;
}

export function LoginPage({ onBack, onSuccess }: LoginPageProps) {
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordShakeNonce, setPasswordShakeNonce] = useState(0);
  const [isInformationOpen, setIsInformationOpen] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!identifier.trim() || !password) {
      setError('Enter your username or email and password.');
      if (!password) setPasswordShakeNonce((current) => current + 1);
      return;
    }

    setIsSubmitting(true);
    try {
      await loginApplicationUser(identifier.trim(), password);
      onSuccess(true);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed. Please try again.');
      setPasswordShakeNonce((current) => current + 1);
      passwordInputRef.current?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main
      className="login-page relative flex min-h-screen items-center justify-center overflow-hidden bg-[#223c49] bg-cover bg-center px-4 py-20 sm:px-6"
      style={{ backgroundImage: "url('https://images.unsplash.com/photo-1578575437130-527eed3abbec?q=80&w=2070&auto=format&fit=crop')" }}
    >
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[5px]" aria-hidden="true" />

      <button
        type="button"
        onClick={onBack}
        className="group absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/20 px-4 py-2 text-xs font-semibold text-white/90 backdrop-blur-md transition hover:bg-black/35 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/80 sm:left-8 sm:top-8"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Back to registration
      </button>

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-lg bg-white shadow-[0_24px_70px_rgba(0,0,0,0.38)]"
        aria-labelledby="login-heading"
      >
        <div className="flex min-h-36 items-center justify-center border-b border-slate-100 bg-white px-8 py-8 sm:min-h-40 sm:px-12">
          <img src={cargoMoveLogo} alt="CargoMove" className="h-auto w-full max-w-[330px] object-contain" />
        </div>

        <div className="px-8 pb-8 pt-7 sm:px-9 sm:pb-9 sm:pt-8">
          <div className="mb-6 flex items-center gap-2 sm:mb-7">
            <h1 id="login-heading" className="text-2xl font-bold text-slate-800">Admin Login</h1>
            <button
              type="button"
              onClick={() => setIsInformationOpen(true)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#008bd2] transition hover:bg-sky-50 hover:text-[#0074b0] focus:outline-none focus:ring-2 focus:ring-[#0095e8] focus:ring-offset-2"
              aria-label="Information about this registration website"
              title="About this website"
            >
              <Info className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            <div className="group relative border-b border-slate-200 transition-colors focus-within:border-[#0095e8]">
              <User className="absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#0095e8]" aria-hidden="true" />
              <label htmlFor="login-identifier" className="sr-only">Username or email</label>
              <input
                id="login-identifier"
                name="login-identifier"
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    passwordInputRef.current?.focus();
                  }
                }}
                autoComplete="username"
                autoFocus
                placeholder="Your username"
                className="w-full bg-transparent py-3 pl-10 pr-3 text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>

            <div
              key={passwordShakeNonce}
              className={`group relative border-b transition-colors focus-within:border-[#0095e8] ${error ? 'border-rose-300' : 'border-slate-200'} ${passwordShakeNonce > 0 ? 'animate-login-password-shake' : ''}`}
            >
              <Lock className={`absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 transition-colors group-focus-within:text-[#0095e8] ${error ? 'text-rose-400' : 'text-slate-400'}`} aria-hidden="true" />
              <label htmlFor="login-password" className="sr-only">Password</label>
              <input
                ref={passwordInputRef}
                id="login-password"
                name="login-secret"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Your password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                className="w-full bg-transparent py-3 pl-10 pr-3 text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>

            <div className="relative mt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded bg-[#f59a45] px-4 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-md transition hover:-translate-y-px hover:bg-[#e88a36] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#f59a45] focus:ring-offset-2 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {isSubmitting ? 'Logging in...' : 'Login'}
              </button>

              {error && (
                <p id="login-error" role="alert" className="absolute left-0 right-0 top-full mt-2 truncate text-center text-xs leading-5 text-rose-600">
                  {error}
                </p>
              )}
            </div>

            <div className="pt-1 text-center">
              <a
                href="#"
                onClick={(event) => event.preventDefault()}
                className="text-sm text-[#008bd2] transition-colors hover:text-[#0074b0] hover:underline focus:outline-none focus:ring-2 focus:ring-[#0095e8] focus:ring-offset-2"
              >
                Forgot password?
              </a>
            </div>
          </form>
        </div>

      </motion.section>

      <AnimatePresence>
        {isInformationOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[3px] sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-information-title"
            onClick={() => setIsInformationOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl sm:p-10"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setIsInformationOpen(false)}
                className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0095e8]"
                aria-label="Close information"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>

              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-[#008bd2] sm:h-14 sm:w-14">
                <Info className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
              </div>
              <h2 id="login-information-title" className="pr-10 text-xl font-bold text-slate-800 sm:text-2xl">Registration website only</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                Please note that <strong className="font-semibold text-slate-800">this is not the CargoMove website for creating bookings</strong>. This website is <strong className="font-semibold text-slate-800">for registration purposes only</strong>.
              </p>
              <p className="mt-4 text-base leading-7 text-slate-600">
                To create and manage your bookings, please log in to the CargoMove system here:
              </p>
              <a
                href="https://www.cargomove.my"
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex w-full items-center justify-center rounded bg-[#0095e8] px-5 py-3.5 text-base font-bold text-white transition hover:bg-[#0078c8] focus:outline-none focus:ring-2 focus:ring-[#0095e8] focus:ring-offset-2"
              >
                CargoMove Login
              </a>
              <p className="mt-3 text-center text-sm text-slate-400">www.cargomove.my</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="absolute bottom-5 left-4 right-4 z-10 text-center text-[9px] font-normal italic tracking-[0.14em] text-white sm:bottom-8 sm:text-[10px]">
        COPYRIGHT © 2026 ALL RIGHTS RESERVED. CARGOFLOW.
      </p>
    </main>
  );
}

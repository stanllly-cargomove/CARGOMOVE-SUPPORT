import React, { useId } from 'react';
import { motion } from 'motion/react';

type Props = {
  email?: string;
  connecting: boolean;
  disabled?: boolean;
  onConnect: () => void;
  connectedAction?: 'reconnect' | 'refresh';
};

function GoogleIcon({ connected }: { connected: boolean }) {
  const color = (brandColor: string) => connected ? brandColor : '#111827';
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
      <path fill={color('#4285F4')} d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z" />
      <path fill={color('#34A853')} d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z" />
      <path fill={color('#FBBC05')} d="M6.39 13.9A6.01 6.01 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.49l3.35-2.59Z" />
      <path fill={color('#EA4335')} d="M12 5.97c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z" />
    </svg>
  );
}

export function GoogleConnectionButton({ email = '', connecting, disabled = false, onConnect, connectedAction = 'reconnect' }: Props) {
  const tooltipId = useId();
  return (
    <div className="group relative self-end sm:self-auto">
      <motion.button
        type="button"
        onClick={onConnect}
        disabled={connecting || disabled}
        aria-label={email ? `Google connected as ${email}. Click to ${connectedAction === 'refresh' ? 'refresh inbox' : 'reconnect'}.` : 'Google is not connected. Click to connect.'}
        aria-busy={connecting}
        aria-describedby={tooltipId}
        whileHover={{ y: -2, rotate: [0, -7, 7, 0], scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        transition={{ duration: 0.35 }}
        className="relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm outline-none transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-60"
      >
        <GoogleIcon connected={!!email} />
        {email && <span className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" aria-hidden="true" />}
      </motion.button>
      <div id={tooltipId} role="tooltip" className="pointer-events-none absolute right-full top-1/2 z-30 mr-3 w-max max-w-72 -translate-y-1/2 translate-x-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white opacity-0 shadow-xl transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100">
        <span className="block font-semibold">{email ? 'Google connected' : 'Google not connected'}</span>
        <span className="mt-0.5 block text-slate-300">{email || 'Click to connect'}</span>
        {connecting && <span className="mt-1 block text-slate-300">{email && connectedAction === 'refresh' ? 'Refreshing inbox...' : 'Connecting...'}</span>}
        <span className="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-slate-900" />
      </div>
    </div>
  );
}

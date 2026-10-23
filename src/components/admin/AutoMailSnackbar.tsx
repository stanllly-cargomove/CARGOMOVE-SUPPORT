import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function AutoMailSnackbar({ children, onDismiss, persistent = false, alert = false }: {
  children: React.ReactNode; onDismiss?: () => void; persistent?: boolean; alert?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (persistent || alert) return;
    const timer = window.setTimeout(() => { setVisible(false); dismiss.current?.(); }, 6500);
    return () => window.clearTimeout(timer);
  }, [persistent, alert]);
  if (!visible) return null;
  return <div role={alert ? 'alert' : 'status'} className="pointer-events-none flex items-center gap-3 rounded-md bg-[#323232] px-4 py-3 text-sm leading-5 text-white shadow-xl [&_button]:pointer-events-auto [&_button:not([aria-label])]:shrink-0 [&_button:not([aria-label])]:font-medium [&_button:not([aria-label])]:text-blue-300">
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
    <button type="button" aria-label="Dismiss notification" onClick={() => { setVisible(false); onDismiss?.(); }} className="shrink-0 rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
  </div>;
}

// Share one overlay so notices from the reader, composer and mailbox stack together.
let host: HTMLDivElement | null = null;
let hosts = 0;
export function AutoMailSnackbarArea({ children }: { children: React.ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('aria-label', 'Mail notifications');
      host.className = 'pointer-events-none fixed bottom-5 left-5 z-[100] flex max-h-[50dvh] w-[min(520px,calc(100vw-40px))] flex-col gap-2 overflow-y-auto';
      document.body.appendChild(host);
    }
    hosts++;
    setContainer(host);
    return () => { if (--hosts === 0) { host?.remove(); host = null; } };
  }, []);
  return container ? createPortal(children, container) : null;
}

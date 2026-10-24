import React, { useId, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Loader2 } from 'lucide-react';
import { AutoMailAgentSettings } from './AutoMailAgentSettings';
import { AutoMailIncomingSettings } from './AutoMailIncomingSettings';
import { motion, useReducedMotion } from 'motion/react';
import { type SettingsStatus, settingsSecondary } from './AutoMailSettingsUi';

// ChatGPT mark: https://commons.wikimedia.org/wiki/File:ChatGPT_logo.svg (OpenAI / Zhing Za).
const chatgptPath = 'M1107.3 299.1c-197.999 0-373.9 127.3-435.2 315.3L650 743.5v427.9c0 21.4 11 40.4 29.4 51.4l344.5 198.515V833.3h.1v-27.9L1372.7 604c33.715-19.52 70.44-32.857 108.47-39.828L1447.6 450.3C1361 353.5 1237.1 298.5 1107.3 299.1zm0 117.5-.6.6c79.699 0 156.3 27.5 217.6 78.4-2.5 1.2-7.4 4.3-11 6.1L952.8 709.3c-18.4 10.4-29.4 30-29.4 51.4V1248l-155.1-89.4V755.8c-.1-187.099 151.601-338.9 339-339.2z';

export function AutoEmailConfig({ onBack, onOpenMail }: { onBack: () => void; onOpenMail?: () => void }) {
  const [modelDirty, setModelDirty] = useState(false);
  const [incomingDirty, setIncomingDirty] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [modelStatus, setModelStatus] = useState<SettingsStatus>({ busy: true, ready: false, error: false });
  const [incomingStatus, setIncomingStatus] = useState<SettingsStatus>({ busy: true, ready: false, error: false });
  const tooltipId = useId();
  const reducedMotion = useReducedMotion();
  const busy = modelStatus.busy || incomingStatus.busy;
  const failed = modelStatus.error || incomingStatus.error;
  const ready = modelStatus.ready && incomingStatus.ready;
  const status = busy ? 'Checking AI settings...' : failed ? 'Unable to refresh AI settings' : ready ? 'AI configured' : 'AI is off or needs setup';
  const leave = (action: () => void) => {
    if (!(modelDirty || incomingDirty) || window.confirm('Discard unsaved email settings?')) action();
  };
  return <section aria-label="Auto Email configuration" className="min-w-0 space-y-5">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-xl font-bold tracking-tight text-slate-900">Auto Email Config</h2><p className="mt-1 text-xs leading-5 text-slate-500">Choose how AI prepares and sends support replies.</p></div>
      <div className="group relative shrink-0">
        <motion.button type="button" aria-label="Refresh AI settings" aria-describedby={tooltipId} aria-busy={busy} disabled={busy}
          onClick={() => leave(() => {
            setModelStatus(current => ({ ...current, busy: true }));
            setIncomingStatus(current => ({ ...current, busy: true }));
            setRefreshToken(value => value + 1);
          })}
          whileHover={reducedMotion ? undefined : { y: -2, rotate: [0, -7, 7, 0], scale: 1.08 }} whileTap={reducedMotion ? undefined : { scale: 0.94 }} transition={{ duration: 0.35 }}
          className="relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm outline-none transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-60">
          {busy ? <Loader2 aria-hidden="true" className="h-7 w-7 animate-spin motion-reduce:animate-none text-slate-500" /> : <svg viewBox="0 0 2406 2406" aria-hidden="true" className="h-7 w-7 text-slate-900">{[0, 60, 120, 180, 240, 300].map(angle => <path key={angle} d={chatgptPath} fill="currentColor" transform={`rotate(${angle} 1203 1203)`} />)}</svg>}
          <span aria-hidden="true" data-ai-status={busy ? 'loading' : failed ? 'error' : ready ? 'ready' : 'inactive'} className={`absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-white ${busy ? 'bg-slate-400' : failed ? 'bg-rose-500' : ready ? 'bg-emerald-500' : 'bg-amber-400'}`} />
        </motion.button>
        <div id={tooltipId} role="tooltip" className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-56 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="block font-semibold">ChatGPT: {status}</span><span className="mt-1 block text-slate-300">Click to refresh both settings cards. Status reflects saved configuration.</span>
        </div>
      </div>
    </div>
    <nav aria-label="Email settings navigation" className="flex flex-nowrap items-center justify-between gap-2">
      <button type="button" aria-label="Dev Setting" onClick={() => leave(onBack)} className={settingsSecondary}><ArrowLeft aria-hidden="true" className="h-4 w-4" />Back</button>
      {onOpenMail && <button type="button" onClick={() => leave(onOpenMail)} className={settingsSecondary}>Auto Mail<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></button>}
    </nav>
    <AutoMailAgentSettings onDirtyChange={setModelDirty} refreshToken={refreshToken} onStateChange={setModelStatus} />
    <AutoMailIncomingSettings onDirtyChange={setIncomingDirty} refreshToken={refreshToken} onStateChange={setIncomingStatus} />
  </section>;
}

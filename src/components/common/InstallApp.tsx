import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)');
    const syncInstalled = () => setInstalled(standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    syncInstalled();
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    try { setDismissed(sessionStorage.getItem('cargomove-install-dismissed') === '1'); } catch { /* Storage is optional. */ }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    standalone.addEventListener('change', syncInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      standalone.removeEventListener('change', syncInstalled);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem('cargomove-install-dismissed', '1'); } catch { /* Storage is optional. */ }
  };

  const install = async () => {
    if (!prompt || installing) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
    } catch {
      // The browser's own installation menu remains available.
    } finally {
      // A browser installation event can only be used once.
      setPrompt(null);
      setInstalling(false);
    }
  };

  if (installed || dismissed || (!prompt && !ios)) return null;

  return (
    <aside aria-label="Install CargoMove" className="fixed bottom-4 left-4 z-40 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-xl w-80">
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" width="40" height="40" alt="" className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Install CargoMove</p>
          <p className="mt-1 text-sm text-slate-600">Open the portal directly from your home screen or desktop.</p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss install suggestion" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
      </div>
      {prompt ? (
        <button type="button" onClick={() => void install()} disabled={installing} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
          <Download size={16} aria-hidden="true" />{installing ? 'Installing…' : 'Install app'}
        </button>
      ) : (
        <p className="mt-3 text-sm text-slate-600">In Safari, open the Share menu, choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</p>
      )}
    </aside>
  );
}

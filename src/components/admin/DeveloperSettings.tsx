import React, { useEffect, useState } from 'react';
import { BookOpen, ChevronRight, Clock3, FlaskConical, Settings, TableProperties } from 'lucide-react';
import { loadDeveloperSettings, saveDeveloperSettings, useDeveloperSettings, type DeveloperSettings as SettingsValues } from '../../services/developerSettings';
import { AutoRegisterCmToggle } from './AutoRegisterCm';

interface DeveloperSettingsProps {
  onOpenScheduler: () => void;
  onOpenExcelMapping: () => void;
  onOpenPortDepotConfig: () => void;
  onOpenAutoEmailConfig: () => void;
  onOpenAutoRegisterCm?: () => void;
  autoRegisterCacheScope?: string;
}

export function DeveloperSettings({ onOpenScheduler, onOpenExcelMapping, onOpenPortDepotConfig, onOpenAutoEmailConfig, onOpenAutoRegisterCm, autoRegisterCacheScope }: DeveloperSettingsProps) {
  const settings = useDeveloperSettings();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadDeveloperSettings().then(() => { if (active) setReady(true); }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);
  const updateSetting = async (key: keyof SettingsValues) => {
    setBusy(true); setError('');
    try { await saveDeveloperSettings({ [key]: !settings[key] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save developer settings.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Developer Settings</h2>
        <p className="mt-1 text-xs text-slate-500">Manage registration automation, ports and depots, schedulers, Excel mappings and email automation.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}<button type="button" className="ml-2 font-semibold underline" onClick={() => { void loadDeveloperSettings().then(() => { setReady(true); setError(''); }).catch(reason => setError(reason.message)); }}>Retry</button></p>}
      <section aria-label="Developer settings" className="w-full divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {([
          { key: 'registrationTestToolsEnabled', title: 'Registration test tools', description: 'Show Auto Fill on company forms and draft Excel downloads for all users.' },
          { key: 'simulationEnabled', title: 'Registration simulation', description: 'Show the Simulate button in the registration queue.' },
        ] as const).map(({ key, title, description }) => <div key={key} className="flex w-full items-center gap-4 p-4 sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><FlaskConical className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h3 id={`${key}-label`} className="text-sm font-semibold text-slate-900">{title}</h3>
            <p id={`${key}-description`} className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
          <button type="button" role="switch" disabled={!ready || busy} aria-labelledby={`${key}-label`} aria-describedby={`${key}-description`} aria-checked={settings[key]} onClick={() => void updateSetting(key)} className={`relative ml-auto inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:opacity-50 ${settings[key] ? 'bg-emerald-600' : 'bg-slate-300'}`}>
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${settings[key] ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>)}
        <div className="flex w-full items-center gap-3 p-4 sm:p-5">
          <button type="button" onClick={onOpenAutoRegisterCm} className="flex min-w-0 flex-1 items-center gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><Clock3 className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">Auto Register in CM</span><span className="mt-1 block text-xs leading-5 text-slate-500">Review eligible registrations, schedule them, and view run history.</span></span>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          </button>
          <AutoRegisterCmToggle cacheScope={autoRegisterCacheScope} />
        </div>
        {[
          { title: 'Auto Email Config', description: 'Configure AI models, incoming drafts and automatic replies.', icon: BookOpen, onClick: onOpenAutoEmailConfig },
          { title: 'Ports & Depots', description: 'Manage the ports and depots available for registration.', icon: Settings, onClick: onOpenPortDepotConfig },
          { title: 'System Scheduler', description: 'View saved schedulers and request a run.', icon: Clock3, onClick: onOpenScheduler },
          { title: 'Excel Mapping', description: 'Review how registration details map to Excel templates and database fields.', icon: TableProperties, onClick: onOpenExcelMapping },
        ].map(({ title, description, icon: Icon, onClick }) => (
          <button key={title} type="button" onClick={onClick} className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 sm:p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span>
            <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          </button>
        ))}
      </section>
    </div>
  );
}

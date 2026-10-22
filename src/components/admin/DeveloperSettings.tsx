import React, { useState } from 'react';
import { BookOpen, ChevronRight, Clock3, FlaskConical, Settings, TableProperties } from 'lucide-react';
import { areRegistrationTestToolsEnabled, setRegistrationTestToolsEnabled } from '../../services/developerSettings';

interface DeveloperSettingsProps {
  onOpenScheduler: () => void;
  onOpenExcelMapping: () => void;
  onOpenPortDepotConfig: () => void;
  onOpenAutoEmailConfig: () => void;
}

export function DeveloperSettings({ onOpenScheduler, onOpenExcelMapping, onOpenPortDepotConfig, onOpenAutoEmailConfig }: DeveloperSettingsProps) {
  const [testToolsEnabled, setTestToolsEnabled] = useState(areRegistrationTestToolsEnabled);

  const updateTestTools = (enabled: boolean) => {
    setRegistrationTestToolsEnabled(enabled);
    setTestToolsEnabled(enabled);
  };

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Developer Settings</h2>
        <p className="mt-1 text-xs text-slate-500">Manage registration testing, ports and depots, schedulers, Excel mappings and support knowledge.</p>
      </div>
      <section aria-label="Developer settings" className="w-full divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex w-full items-center gap-4 p-4 sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><FlaskConical className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h3 id="registration-tools-label" className="text-sm font-semibold text-slate-900">Registration test tools</h3>
            <p id="registration-tools-description" className="mt-1 text-xs leading-5 text-slate-500">Show Auto Fill on company forms and download a draft Excel file from the review page.</p>
          </div>
          <button type="button" role="switch" aria-labelledby="registration-tools-label" aria-describedby="registration-tools-description" aria-checked={testToolsEnabled} onClick={() => updateTestTools(!testToolsEnabled)} className={`relative ml-auto inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${testToolsEnabled ? 'bg-emerald-600' : 'bg-slate-300'}`}>
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${testToolsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {[
          { title: 'Auto Email Config', description: 'Manage the knowledge base and review learning from sent replies.', icon: BookOpen, onClick: onOpenAutoEmailConfig },
          { title: 'Ports & Depots', description: 'Manage the ports and depots available for registration.', icon: Settings, onClick: onOpenPortDepotConfig },
          { title: 'Scheduler', description: 'View saved schedulers and request a run.', icon: Clock3, onClick: onOpenScheduler },
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

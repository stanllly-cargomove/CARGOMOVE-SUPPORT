import React, { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { areRegistrationTestToolsEnabled, setRegistrationTestToolsEnabled } from '../../services/developerSettings';

export function DeveloperSettings() {
  const [testToolsEnabled, setTestToolsEnabled] = useState(areRegistrationTestToolsEnabled);

  const updateTestTools = (enabled: boolean) => {
    setRegistrationTestToolsEnabled(enabled);
    setTestToolsEnabled(enabled);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Developer Settings</h2>
        <p className="mt-1 text-xs text-slate-500">Control tools intended only for registration testing.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-5">
          <div className="flex gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><FlaskConical className="h-4 w-4" /></span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Registration test tools</h3>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-600">Shows Auto Fill on the company form and Generate Excel on the review page. The Excel download is a draft and does not submit or mark a registration as exported.</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={testToolsEnabled}
            onClick={() => updateTestTools(!testToolsEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${testToolsEnabled ? 'bg-emerald-600' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${testToolsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            <span className="sr-only">Toggle registration test tools</span>
          </button>
        </div>
        <p className={`mt-4 text-xs font-semibold ${testToolsEnabled ? 'text-emerald-700' : 'text-slate-500'}`}>{testToolsEnabled ? 'Enabled' : 'Disabled'}</p>
      </section>
    </div>
  );
}

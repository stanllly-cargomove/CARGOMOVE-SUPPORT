import { useSyncExternalStore } from 'react';

export type DeveloperSettings = { registrationTestToolsEnabled: boolean; simulationEnabled: boolean };
const disabled: DeveloperSettings = { registrationTestToolsEnabled: false, simulationEnabled: false };
let settings = disabled;
let epoch = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const publish = (next: DeveloperSettings) => { settings = next; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const parse = (body: any): DeveloperSettings => {
  if (typeof body?.settings?.registrationTestToolsEnabled !== 'boolean' || typeof body?.settings?.simulationEnabled !== 'boolean') throw new Error('Developer settings are unavailable.');
  return body.settings;
};
export const useDeveloperSettings = () => useSyncExternalStore(subscribe, () => settings, () => disabled);

export function loadDeveloperSettings(): Promise<void> {
  if (pending) return pending;
  const started = epoch;
  pending = fetch('/api/dev-tools/settings', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) })
    .then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load developer settings.');
      const next = parse(body);
      if (epoch === started) publish(next);
    }).catch(error => { if (epoch === started) publish(disabled); throw error; })
    .finally(() => { pending = null; });
  return pending;
}

export async function saveDeveloperSettings(change: Partial<DeveloperSettings>): Promise<void> {
  epoch++;
  const response = await fetch('/api/dev-tools/settings', {
    method: 'PATCH', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'manage-developer-settings' }, body: JSON.stringify(change),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unable to save developer settings.');
  epoch++;
  publish(parse(body));
}

export function startDeveloperSettingsSync(): () => void {
  // Legacy browser opt-ins must never override the shared settings.
  try { localStorage.removeItem('cargomove_registration_test_tools_enabled'); } catch { /* Storage may be unavailable. */ }
  const refresh = () => { if (document.visibilityState !== 'hidden') void loadDeveloperSettings().catch(() => undefined); };
  refresh();
  const timer = window.setInterval(refresh, 30_000);
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('online', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}

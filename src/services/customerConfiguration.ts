import type { PortConfig, DepotConfig } from '../types';

interface CustomerConfiguration { ports: PortConfig[]; depots: DepotConfig[] }
let configuration: CustomerConfiguration | null = null;
let configurationRequest: Promise<void> | null = null;

const CACHE_KEY = 'cargomove_public_registration_config_v1';

try {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached) as CustomerConfiguration;
    if (Array.isArray(parsed.ports) && Array.isArray(parsed.depots)) configuration = parsed;
  }
} catch {
  // The public form can still render from its built-in defaults if storage is unavailable.
}

export function getCustomerConfiguration() { return configuration; }

export function loadCustomerConfiguration(forceRefresh = false): Promise<void> {
  if (configurationRequest) return configurationRequest;
  if (configuration && !forceRefresh) return Promise.resolve();

  configurationRequest = fetch('/api/registration-config', { cache: 'no-store' })
    .then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to load registration facilities.');
      if (!Array.isArray(body.ports) || !Array.isArray(body.depots)) throw new Error('Invalid registration configuration.');
      configuration = { ports: body.ports, depots: body.depots };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(configuration)); } catch { /* Keep the live in-memory config. */ }
    })
    .finally(() => { configurationRequest = null; });
  return configurationRequest;
}

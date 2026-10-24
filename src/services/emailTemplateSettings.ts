import { getEmailTemplateCatalog, getEmailLogs, getGmailStatus } from './email';

type Settings = {
  catalog: Awaited<ReturnType<typeof getEmailTemplateCatalog>>;
  gmail: Awaited<ReturnType<typeof getGmailStatus>>;
  emailLogs: Awaited<ReturnType<typeof getEmailLogs>>;
};

// Session memory only: no template bodies or email logs in browser storage.
let cached: { value: Settings; savedAt: number } | null = null;
let pending: Promise<Settings> | null = null;
let generation = 0;

export function getCachedEmailTemplateSettings(): Settings | null {
  return cached?.value ?? null;
}

export function clearEmailTemplateSettingsCache(): void {
  generation++;
  cached = null;
  pending = null;
}

export function loadEmailTemplateSettings(force = false): Promise<Settings> {
  if (pending) return pending;
  if (!force && cached && Date.now() - cached.savedAt < 60_000) return Promise.resolve(cached.value);
  const requestGeneration = generation;
  const request = Promise.all([getEmailTemplateCatalog(), getGmailStatus(), getEmailLogs()])
    .then(([catalog, gmail, emailLogs]) => {
      const value = { catalog, gmail, emailLogs };
      if (requestGeneration === generation) cached = { value, savedAt: Date.now() };
      return value;
    }).finally(() => { if (pending === request) pending = null; });
  pending = request;
  return request;
}

export function supportTab(
  path: string,
): 'support-dashboard' | 'support-inbox' | 'support-knowledge' | 'support-learning' | 'support-analytics' | 'support-automation' | null {
  if (/^\/admin\/support\/automation\/?$/.test(path)) return 'support-automation';
  if (/^\/admin\/support\/analytics\/?$/.test(path)) return 'support-analytics';
  if (/^\/admin\/support\/learning\/?$/.test(path)) return 'support-learning';
  if (/^\/admin\/support\/knowledge\/?$/.test(path)) return 'support-knowledge';
  if (/^\/admin\/support\/?$/.test(path)) return 'support-dashboard';
  if (/^\/admin\/support\/(?:inbox\/?$|case\/[^/]+\/?$)/.test(path))
    return 'support-inbox';
  return null;
}
export function supportCaseId(path: string): string | undefined {
  return path.match(/^\/admin\/support\/case\/([^/]+)\/?$/)?.[1];
}

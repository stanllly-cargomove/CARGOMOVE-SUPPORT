export function supportTab(
  path: string,
): 'support-dashboard' | 'support-inbox' | null {
  if (/^\/admin\/support\/?$/.test(path)) return 'support-dashboard';
  if (/^\/admin\/support\/(?:inbox\/?$|case\/[^/]+\/?$)/.test(path))
    return 'support-inbox';
  return null;
}
export function supportCaseId(path: string): string | undefined {
  return path.match(/^\/admin\/support\/case\/([^/]+)\/?$/)?.[1];
}

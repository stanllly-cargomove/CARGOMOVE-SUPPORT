export interface ApplicationUser {
  id: string;
  username?: string;
  email: string;
  type: string;
  full_name?: string;
}

export interface AdminAccount {
  id: string;
  username: string;
  email: string;
  full_name: string;
  mobile_number: string;
}

export interface ExternalUserAccess {
  id: string;
  username: string;
  email: string;
  password: string;
  company_id?: string;
  company_name: string;
  full_name: string;
  mobile_number: string;
  status: 'PENDING' | 'DONE' | 'REJECTED';
  rejection_reason?: RejectionReason | null;
  rejection_detail?: string | null;
  email_status: 'NOT_READY' | 'READY' | 'SENDING' | 'SENT' | 'FAILED';
  email_sent: 0 | 1;
  created_at: string;
  updated_at: string;
}

export type RejectionReason = 'ALREADY_REGISTERED_BOTH' | 'NORTHPORT_ADDED' | 'OTHER';

export async function saveExternalUserAccess(input: Omit<ExternalUserAccess, 'id' | 'created_at' | 'updated_at' | 'status' | 'email_status' | 'email_sent'> & Partial<Pick<ExternalUserAccess, 'status' | 'email_sent'>> & { id?: string }): Promise<void> {
  await fetch('/api/external-user-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateExternalUserAccess(
  id: string,
  changes: Partial<Pick<ExternalUserAccess, 'username' | 'email' | 'password' | 'company_name' | 'full_name' | 'mobile_number' | 'status' | 'rejection_reason' | 'rejection_detail'>>,
): Promise<ExternalUserAccess> {
  const response = await fetch('/api/external-user-access', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...changes }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to update external user access.');
  if (body.user?.id && externalUserCache) {
    externalUserCache.set(body.user.id, body.user);
    externalUserCursor = newestTimestamp(externalUserCursor, body.user.updated_at);
  }
  return body.user;
}

let externalUserCache: Map<string, ExternalUserAccess> | null = null;
let externalUserCursor: string | undefined;
let externalUserRefresh: Promise<boolean> | null = null;
let externalUserRefreshedAt = 0;

function newestTimestamp(current: string | undefined, candidate: unknown) {
  if (typeof candidate !== 'string' || Number.isNaN(Date.parse(candidate))) return current;
  return !current || Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

export function clearExternalUserAccessCache(): void {
  externalUserCache = null;
  externalUserCursor = undefined;
  externalUserRefreshedAt = 0;
}

export async function refreshExternalUserAccess(options: { fullSync?: boolean } = {}): Promise<boolean> {
  if (externalUserRefresh) return externalUserRefresh;
  if (!options.fullSync && externalUserCache && Date.now() - externalUserRefreshedAt < 1_000) return false;

  externalUserRefresh = (async () => {
    const wasInitialized = externalUserCache !== null;
    const since = options.fullSync ? undefined : externalUserCursor;
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const response = await fetch(`/api/external-user-access${query}`, { credentials: 'include', cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to load external user access records.');

    const incoming = Array.isArray(body.users) ? body.users as ExternalUserAccess[] : [];
    const next = options.fullSync || !externalUserCache
      ? new Map(incoming.map((user) => [user.id, user]))
      : new Map(externalUserCache);
    incoming.forEach((user) => next.set(user.id, user));
    const changed = !wasInitialized || !!options.fullSync || incoming.length > 0;
    externalUserCache = next;
    externalUserCursor = typeof body.syncCursor === 'string'
      ? body.syncCursor
      : incoming.reduce((cursor, user) => newestTimestamp(cursor, user.updated_at), externalUserCursor);
    externalUserRefreshedAt = Date.now();
    return changed;
  })().finally(() => {
    externalUserRefresh = null;
  });
  return externalUserRefresh;
}

export async function getExternalUserAccess(): Promise<ExternalUserAccess[]> {
  await refreshExternalUserAccess();
  return Array.from(externalUserCache?.values() || [])
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

export async function getApplicationSession(): Promise<{ authenticated: boolean; user: ApplicationUser | null }> {
  try {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    if (!response.ok) return { authenticated: false, user: null };
    return response.json();
  } catch {
    return { authenticated: false, user: null };
  }
}

export async function loginApplicationUser(identifier: string, password: string): Promise<ApplicationUser> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Login failed.');
  return body.user;
}

export async function logoutApplicationUser(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function createAdminUser(input: {
  username: string;
  fullName: string;
  password: string;
  mobileNumber: string;
  email: string;
}): Promise<void> {
  const response = await fetch('/api/auth/users', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to create the user.');
}

export async function getAdminUsers(): Promise<AdminAccount[]> {
  const response = await fetch('/api/auth/users', { credentials: 'include' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to load admin users.');
  return body.users || [];
}

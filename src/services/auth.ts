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
  email_sent: 0 | 1;
  created_at: string;
}

export async function saveExternalUserAccess(input: Omit<ExternalUserAccess, 'id' | 'created_at' | 'status' | 'email_sent'> & Partial<Pick<ExternalUserAccess, 'status' | 'email_sent'>> & { id?: string }): Promise<void> {
  await fetch('/api/external-user-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateExternalUserAccess(
  id: string,
  changes: Partial<Pick<ExternalUserAccess, 'status' | 'email_sent'>>,
): Promise<ExternalUserAccess> {
  const response = await fetch('/api/external-user-access', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...changes }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to update external user access.');
  return body.user;
}

export async function getExternalUserAccess(): Promise<ExternalUserAccess[]> {
  const response = await fetch('/api/external-user-access', { credentials: 'include' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to load external user access records.');
  return body.users || [];
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

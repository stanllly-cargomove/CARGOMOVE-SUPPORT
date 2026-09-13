export interface ApplicationUser {
  id: string;
  username?: string;
  email: string;
  type: string;
  full_name?: string;
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

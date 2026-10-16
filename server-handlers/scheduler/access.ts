import { adminClient, readSession } from '../../api/_runtime.js';

export function allowedOrigin(origin: unknown): boolean {
  if (typeof origin !== 'string') return false;
  const configured = [process.env.SCHEDULER_PORTAL_URL || process.env.APP_URL, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`];
  if (!process.env.VERCEL) configured.push('http://localhost:3000');
  return configured.some(value => {
    try { return Boolean(value) && new URL(value!).origin === origin; } catch { return false; }
  });
}

export async function schedulerAdmin(request: any, deps = { adminClient, readSession }) {
  const session = deps.readSession(request);
  if (!session || session.type !== 'ADMIN') return { code: 401, message: 'Administrator authentication required.' } as const;
  const client = deps.adminClient();
  if (!client) return { code: 503, message: 'Scheduler database access is not configured.' } as const;
  try {
    const admin = await client.from('user_registrations').select('id').eq('email', session.email).eq('type', 'ADMIN').timeout(8000).maybeSingle();
    if (admin.error) return { code: 503, message: 'Unable to verify administrator access.' } as const;
    if (!admin.data) return { code: 403, message: 'Administrator access has been revoked.' } as const;
    return { session, client };
  } catch { return { code: 503, message: 'Unable to verify administrator access.' } as const; }
}

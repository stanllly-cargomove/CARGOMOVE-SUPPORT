import crypto from 'node:crypto';

export default async function session(request: any, response: any) {
  const secret = process.env.SESSION_SECRET;
  const value = request.headers?.cookie?.match(/(?:^|; )cargomove_session=([^;]+)/)?.[1];
  let current: { id: string; email: string; type: string; username?: string; full_name?: string; exp: number } | null = null;
  if (secret && value) {
    const [encoded, signature] = value.split('.');
    const expected = encoded ? crypto.createHmac('sha256', secret).update(encoded).digest('base64url') : '';
    if (encoded && signature && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString());
        if (parsed.exp > Date.now()) current = parsed;
      } catch {
        current = null;
      }
    }
  }
  if (!current) return response.status(200).json({ authenticated: false, user: null });
  let profile = { username: current.username, full_name: current.full_name };
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if ((!profile.username || !profile.full_name) && url && serviceRoleKey) {
    try {
      const query = new URLSearchParams({ select: 'username,full_name', email: `eq.${current.email}`, type: 'eq.ADMIN', limit: '1' });
      const result = await fetch(`${url}/rest/v1/user_registrations?${query}`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } });
      const rows = result.ok ? await result.json() : [];
      if (rows[0]) profile = { username: profile.username || rows[0].username, full_name: profile.full_name || rows[0].full_name };
    } catch { /* Keep the signed session valid if the profile lookup is temporarily unavailable. */ }
  }
  return response.status(200).json({ authenticated: true, user: { id: current.id, email: current.email, type: current.type, ...profile } });
}

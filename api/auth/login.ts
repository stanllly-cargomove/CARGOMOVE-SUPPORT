import { adminClient, authClient, missingVariables, requestBody, setSessionCookie, signSession } from '../_runtime';

export default async function login(request: any, response: any) {
  let stage = 'configuration';
  try {
    if (missingVariables.length > 0) {
      response.status(503).json({ error: 'Server authentication is not configured.', missing: missingVariables });
      return;
    }

    stage = 'request_body';
    const body = await requestBody(request).catch(() => ({})) as { identifier?: string; password?: string };
    const identifier = String(body.identifier || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!identifier || !password) {
      response.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    stage = 'client_init';
    const admin = adminClient();
    const auth = authClient();
    if (!admin || !auth) {
      response.status(503).json({ error: 'Supabase authentication is not configured.' });
      return;
    }

    stage = 'admin_lookup';
    const byUsername = await admin.from('user_registrations').select('id, username, email, type, full_name').eq('username', identifier).eq('type', 'ADMIN').maybeSingle();
    const byEmail = byUsername.data ? { data: null, error: null } : await admin.from('user_registrations').select('id, username, email, type, full_name').eq('email', identifier).eq('type', 'ADMIN').maybeSingle();
    const user = byUsername.data || byEmail.data;
    if (byUsername.error || byEmail.error || !user) {
      response.status(401).json({ error: 'Invalid admin credentials.' });
      return;
    }

    stage = 'supabase_auth';
    const { data: authData, error: authError } = await auth.auth.signInWithPassword({ email: user.email, password });
    if (authError || !authData.user || authData.user.email?.toLowerCase() !== user.email.toLowerCase()) {
      response.status(401).json({ error: 'Invalid admin credentials.' });
      return;
    }

    setSessionCookie(response, signSession({ id: authData.user.id, email: user.email, type: user.type, exp: Date.now() + 8 * 60 * 60 * 1000 }));
    response.status(200).json({ user: { id: user.id, username: user.username, email: user.email, type: user.type, full_name: user.full_name } });
  } catch (error) {
    console.error('Login handler failed:', stage, error);
    response.status(500).json({ error: 'Login service error.', stage });
  }
}

import crypto from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const app = express();
const port = Number(process.env.API_PORT || 8787);
const sessionSecret = process.env.SESSION_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const missingServerVariables = [
  !supabaseUrl && 'SUPABASE_URL (or VITE_SUPABASE_URL)',
  !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
  !supabaseAnonKey && 'SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)',
  !sessionSecret && 'SESSION_SECRET',
].filter(Boolean) as string[];

let supabase: ReturnType<typeof createClient> | null = null;
let clientInitializationError: string | null = null;
if (supabaseUrl && serviceRoleKey) {
  try {
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch (error) {
    clientInitializationError = error instanceof Error ? error.message : 'Invalid Supabase server configuration.';
  }
}

function createAuthClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch {
    return null;
  }
}

app.use(express.json({ limit: '1mb' }));

// Vercel can invoke an API function with either the public /api path or the
// function-relative path. Normalize both forms for the Express route table.
app.use((request, _response, next) => {
  if (!request.url.startsWith('/api')) {
    request.url = `/api${request.url.startsWith('/') ? '' : '/'}${request.url}`;
  }
  next();
});

app.get('/api/health', (_request, response) => {
  response.status(missingServerVariables.length ? 503 : 200).json({
    ok: missingServerVariables.length === 0 && !clientInitializationError,
    service: 'cargomove-api',
    missing: missingServerVariables,
    configurationError: clientInitializationError,
  });
});

function signSession(payload: { id: string; email: string; type: string; exp: number }) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function readSession(request: Request) {
  const value = request.headers.cookie?.match(/(?:^|; )cargomove_session=([^;]+)/)?.[1];
  if (!value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as { id: string; email: string; type: string; exp: number };
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function requireSession(request: Request, response: Response, next: NextFunction) {
  const session = readSession(request);
  if (!session || session.type !== 'ADMIN') {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }
  response.locals.session = session;
  next();
}

app.post('/api/auth/login', async (request, response) => {
  if (!supabase || !supabaseAnonKey || !sessionSecret) {
    response.status(503).json({ error: 'Server authentication is not configured.', missing: missingServerVariables });
    return;
  }
  const identifier = String(request.body?.identifier || '').trim().toLowerCase();
  const password = String(request.body?.password || '');
  if (!identifier || !password) {
    response.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  // Supabase Auth owns password verification. The application table supplies
  // the username alias and the ADMIN authorization check; it never verifies
  // or returns password_hash values.
  const byUsername = await supabase
    .from('user_registrations')
    .select('id, username, email, type, full_name')
    .eq('username', identifier)
    .eq('type', 'ADMIN')
    .maybeSingle();
  const byEmail = byUsername.data ? { data: null, error: null } : await supabase
    .from('user_registrations')
    .select('id, username, email, type, full_name')
    .eq('email', identifier)
    .eq('type', 'ADMIN')
    .maybeSingle();
  const user = byUsername.data || byEmail.data;
  if (byUsername.error || byEmail.error || !user) {
    response.status(401).json({ error: 'Invalid admin credentials.' });
    return;
  }

  const auth = createAuthClient();
  if (!auth) {
    response.status(503).json({ error: 'Supabase Auth is not configured.' });
    return;
  }
  const { data: authData, error: authError } = await auth.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (authError || !authData.user || authData.user.email?.toLowerCase() !== user.email.toLowerCase()) {
    response.status(401).json({ error: 'Invalid admin credentials.' });
    return;
  }

  const session = { id: authData.user.id, email: user.email, type: user.type, exp: Date.now() + 8 * 60 * 60 * 1000 };
  response.setHeader('Set-Cookie', `cargomove_session=${signSession(session)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800; ${process.env.VERCEL ? 'Secure' : ''}`);
  response.json({ user: { id: user.id, username: user.username, email: user.email, type: user.type, full_name: user.full_name } });
});

app.get('/api/auth/session', (request, response) => {
  const session = readSession(request);
  response.json({ authenticated: !!session, user: session ? { id: session.id, email: session.email, type: session.type } : null });
});

app.get('/api/auth/users', requireSession, async (_request, response) => {
  if (!supabase) {
    response.status(503).json({ error: 'Supabase server access is not configured.' });
    return;
  }
  const { data, error } = await supabase
    .from('user_registrations')
    .select('id, username, email, full_name, mobile_number')
    .eq('type', 'ADMIN')
    .order('created_at', { ascending: false });
  if (error) {
    response.status(502).json({ error: error.message });
    return;
  }
  response.json({ users: data || [] });
});

app.post('/api/auth/logout', (_request, response) => {
  response.setHeader('Set-Cookie', 'cargomove_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  response.status(204).end();
});

app.get('/api/snapshot', requireSession, async (_request, response) => {
  if (!supabase) {
    response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingServerVariables });
    return;
  }
  const tables = await Promise.all([
    supabase.from('port_configs').select('*'),
    supabase.from('depot_configs').select('*'),
    supabase.from('companies').select('*'),
    supabase.from('registration_submissions').select('*').order('submitted_at', { ascending: false }),
    supabase.from('user_registrations').select('id, username, email, type, company_id, company_name, full_name, mobile_number, created_at, updated_at').order('created_at', { ascending: false }),
    supabase.from('haulier_guidelines').select('content').eq('id', 'default').maybeSingle(),
  ]);
  const failed = tables.find((result) => result.error);
  if (failed?.error) {
    response.status(502).json({ error: failed.error.message });
    return;
  }
  const [ports, depots, companies, submissions, userRegistrations, guideline] = tables;
  response.json({
    ports: ports.data || [],
    depots: depots.data || [],
    companies: (companies.data || []).map((company: any) => ({ ...company, ...company.details, details: undefined })),
    submissions: submissions.data || [],
    userRegistrations: userRegistrations.data || [],
    guideline: (guideline as any).data?.content || null,
  });
});

const writableTables = new Set(['companies', 'port_configs', 'depot_configs', 'registration_submissions', 'user_registrations', 'haulier_guidelines']);
app.post('/api/data/:table', requireSession, async (request, response) => {
  if (!supabase) {
    response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingServerVariables });
    return;
  }
  if (!writableTables.has(request.params.table)) {
    response.status(404).json({ error: 'Unknown table.' });
    return;
  }
  const { data, error } = await supabase.from(request.params.table).upsert(request.body).select().single();
  if (error) {
    response.status(400).json({ error: error.message });
    return;
  }
  response.json(data);
});

app.delete('/api/data/:table/:id', requireSession, async (request, response) => {
  if (!supabase) {
    response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingServerVariables });
    return;
  }
  if (!writableTables.has(request.params.table)) {
    response.status(404).json({ error: 'Unknown table.' });
    return;
  }
  const { error } = await supabase.from(request.params.table).delete().eq('id', request.params.id);
  if (error) {
    response.status(400).json({ error: error.message });
    return;
  }
  response.status(204).end();
});

export default app;

const isServerlessRuntime = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
if (!isServerlessRuntime) {
  app.listen(port, () => console.log(`Cargomove API listening on http://localhost:${port}`));
}

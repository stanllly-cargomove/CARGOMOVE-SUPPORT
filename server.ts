import supportAnalyze from './server-handlers/ai/analyze.js';
import supportAnalysis from './server-handlers/ai/analysis.js';
import supportCases from './server-handlers/support/cases.js';
import supportCase from './server-handlers/support/case.js';
import supportStats from './server-handlers/support/stats.js';
import crypto from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import gmailConnect from './server-handlers/gmail/connect.js';
import gmailCallback from './server-handlers/gmail/callback.js';
import gmailMessages from './server-handlers/gmail/messages.js';
import gmailMessage from './server-handlers/gmail/message.js';
import gmailThread from './server-handlers/gmail/thread.js';
import gmailSync from './server-handlers/gmail/sync.js';
import gmailStatus from './server-handlers/gmail/status.js';
import emailTemplates from './server-handlers/email/templates.js';
import emailPreview from './server-handlers/email/preview.js';
import emailSend from './server-handlers/email/send.js';
import emailLogs from './server-handlers/email/logs.js';
import emailAttachments from './server-handlers/email/attachments.js';
import companyRegistration from './server-handlers/registration/submit.js';
import companyLookup from './server-handlers/registration/lookup.js';
import registrationStatus from './server-handlers/registration/status.js';

config({ path: '.env.local' });

const app = express();
const port = Number(process.env.API_PORT || 8787);
const sessionSecret = process.env.SESSION_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SNAPSHOT_READ_TIMEOUT_MS = 15_000;
const SNAPSHOT_MAX_READ_ATTEMPTS = 2;
const SNAPSHOT_RETRY_DELAY_MS = 250;

class SnapshotTableReadError extends Error {
  constructor(
    readonly table: string,
    readonly status?: number,
    readonly retryable = false,
    cause?: unknown,
  ) {
    super(`${table}_query_failed${status ? `_${status}` : ''}`, { cause });
    this.name = 'SnapshotTableReadError';
  }
}

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

async function fetchSupabaseTable(table: string, params: URLSearchParams) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase server access is not configured.');
  for (let attempt = 1; attempt <= SNAPSHOT_MAX_READ_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SNAPSHOT_READ_TIMEOUT_MS);
    try {
      const result = await fetch(`${supabaseUrl}/rest/v1/${table}?${params.toString()}`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      const body = await result.json().catch(() => null);
      if (result.ok) return body;

      const retryable = result.status === 408 || result.status === 429 || result.status >= 500;
      if (!retryable || attempt === SNAPSHOT_MAX_READ_ATTEMPTS) {
        throw new SnapshotTableReadError(table, result.status, retryable);
      }
    } catch (error) {
      if (error instanceof SnapshotTableReadError) throw error;
      if (attempt === SNAPSHOT_MAX_READ_ATTEMPTS) {
        throw new SnapshotTableReadError(table, undefined, true, error);
      }
    } finally {
      clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_RETRY_DELAY_MS));
  }

  throw new SnapshotTableReadError(table, undefined, true);
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

app.get('/api/external-user-access', requireSession, async (request, response) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  if (!supabase) {
    response.status(503).json({ error: 'Supabase server access is not configured.' });
    return;
  }
  const requestedSince = typeof request.query.since === 'string' ? request.query.since : '';
  const since = requestedSince && !Number.isNaN(Date.parse(requestedSince)) ? requestedSince : null;
  let syncCursor = new Date().toISOString();
  let query = supabase
    .from('external_user_access')
    .select('id, username, email, password, company_id, company_name, full_name, mobile_number, status, rejection_reason, rejection_detail, email_status, email_sent, created_at, updated_at')
    .order(since ? 'updated_at' : 'created_at', { ascending: !!since });
  if (since) query = query.gt('updated_at', since).limit(200);
  let { data, error } = await query;
  if (error && (error.message.includes('status') || error.message.includes('email_sent') || error.message.includes('email_status') || error.message.includes('rejection_reason') || error.message.includes('rejection_detail'))) {
    let legacyQuery = supabase
      .from('external_user_access')
      .select('id, username, email, password, company_id,company_name,full_name,mobile_number,created_at,updated_at')
      .order(since ? 'updated_at' : 'created_at', { ascending: !!since });
    if (since) legacyQuery = legacyQuery.gt('updated_at', since).limit(200);
    const legacyResult = await legacyQuery;
    data = legacyResult.data as typeof data;
    error = legacyResult.error;
  }
  if (error) {
    response.status(502).json({ error: error.message });
    return;
  }
  if (since && data?.length === 200) syncCursor = (data as any[])[data.length - 1]?.updated_at || syncCursor;
  response.json({
    users: (data || []).map((user: any) => ({
      ...user,
      status: ['PENDING', 'DONE', 'REJECTED'].includes(user.status) ? user.status : 'PENDING',
      email_sent: user.email_sent === 1 ? 1 : 0,
      email_status: ['NOT_READY', 'READY', 'SENDING', 'SENT', 'FAILED'].includes(user.email_status)
        ? user.email_status
        : user.email_sent === 1 ? 'SENT' : ['DONE', 'REJECTED'].includes(user.status) ? 'READY' : 'NOT_READY',
    })),
    syncCursor,
  });
});

app.patch('/api/external-user-access', requireSession, async (request, response) => {
  if (!supabase) {
    response.status(503).json({ error: 'Supabase server access is not configured.' });
    return;
  }
  const id = String(request.body?.id || '').trim();
  const changes: Record<string, unknown> = {};
  const requiredTextFields = ['username', 'email', 'password', 'full_name', 'mobile_number'] as const;
  for (const field of requiredTextFields) {
    if (request.body?.[field] === undefined) continue;
    const value = String(request.body[field]).trim();
    if (!value) {
      response.status(400).json({ error: `${field.replace('_', ' ')} is required.` });
      return;
    }
    changes[field] = field === 'username' || field === 'email' ? value.toLowerCase() : value;
  }
  if (request.body?.company_name !== undefined) changes.company_name = String(request.body.company_name).trim().toUpperCase();
  if (request.body?.status !== undefined) {
    if (!['PENDING', 'DONE', 'REJECTED'].includes(request.body.status)) {
      response.status(400).json({ error: 'Invalid registration status.' });
      return;
    }
    changes.status = request.body.status;
  }
  if (request.body?.rejection_reason !== undefined) {
    if (request.body.rejection_reason !== null && !['ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'OTHER'].includes(request.body.rejection_reason)) {
      response.status(400).json({ error: 'Invalid rejection reason.' });
      return;
    }
    changes.rejection_reason = request.body.rejection_reason;
  }
  if (request.body?.rejection_detail !== undefined) {
    const detail = request.body.rejection_detail === null ? null : String(request.body.rejection_detail).trim();
    if (detail && detail.length > 2000) {
      response.status(400).json({ error: 'The rejection details must be 2,000 characters or fewer.' });
      return;
    }
    changes.rejection_detail = detail || null;
  }
  if (request.body?.status === 'REJECTED') {
    if (!['ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'OTHER'].includes(request.body.rejection_reason)) {
      response.status(400).json({ error: 'Select a rejection reason.' });
      return;
    }
    if (request.body.rejection_reason === 'OTHER' && !String(request.body.rejection_detail || '').trim()) {
      response.status(400).json({ error: 'Enter the reason for rejecting this registration.' });
      return;
    }
  } else if (request.body?.status !== undefined) {
    changes.rejection_reason = null;
    changes.rejection_detail = null;
  }
  if (request.body?.email_sent !== undefined) {
    if (![0, 1, true, false].includes(request.body.email_sent)) {
      response.status(400).json({ error: 'Invalid email sent status.' });
      return;
    }
    changes.email_sent = request.body.email_sent === true || request.body.email_sent === 1 ? 1 : 0;
  }
  if (!id || Object.keys(changes).length === 0) {
    response.status(400).json({ error: 'A user id and at least one valid change are required.' });
    return;
  }
  const { data, error } = await (supabase.from('external_user_access') as any)
    .update(changes)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    response.status(error.code === '23505' ? 409 : 400).json({
      error: error.code === '23505'
        ? 'That username or email is already in use.'
        : error.message.includes('status') || error.message.includes('email_sent') || error.message.includes('rejection_reason') || error.message.includes('rejection_detail')
        ? 'The external user workflow migration has not been applied yet.'
        : 'Unable to update external user access.',
    });
    return;
  }
  response.json({ user: data });
});

app.post('/api/external-user-access', async (request, response) => {
  if (!supabase) {
    response.status(503).json({ error: 'Supabase server access is not configured.' });
    return;
  }
  const body = request.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const fullName = String(body.full_name || '').trim();
  const mobileNumber = String(body.mobile_number || '').trim();
  if (!username || !email || !password || !fullName || !mobileNumber) {
    response.status(400).json({ error: 'Username, email, password, full name, and mobile number are required.' });
    return;
  }
  const externalUserAccess = supabase.from('external_user_access') as any;
  const { data, error } = await externalUserAccess.insert({
    id: body.id || `external-user-${Date.now()}`,
    username,
    email,
    password,
    company_id: body.company_id || null,
    company_name: String(body.company_name || '').trim().toUpperCase(),
    full_name: fullName,
    mobile_number: mobileNumber,
  }).select().single();
  if (error) {
    response.status(error.code === '23505' ? 409 : 400).json({ error: error.message });
    return;
  }
  response.status(201).json({ user: data });
});

app.post('/api/auth/logout', (_request, response) => {
  response.setHeader('Set-Cookie', 'cargomove_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  response.status(204).end();
});

app.post('/api/gmail/connect', gmailConnect);
app.get('/api/gmail/callback', gmailCallback);
app.get('/api/gmail/status', gmailStatus);
app.post('/api/support/analyze', supportAnalyze);
app.get('/api/support/analysis', supportAnalysis);
app.get('/api/support/cases', supportCases);
app.get('/api/support/case', supportCase);
app.get('/api/support/stats', supportStats);
app.get('/api/gmail/messages', gmailMessages);
app.get('/api/gmail/message', gmailMessage);
app.get('/api/gmail/thread', gmailThread);
app.post('/api/gmail/sync', gmailSync);
app.get('/api/email/templates', emailTemplates);
app.post('/api/email/templates', emailTemplates);
app.put('/api/email/templates', emailTemplates);
app.delete('/api/email/templates', emailTemplates);
app.post('/api/email/preview', emailPreview);
app.post('/api/email/send', emailSend);
app.get('/api/email/logs', emailLogs);
app.post('/api/email/attachments', emailAttachments);
app.post('/api/company-registration', companyRegistration);
app.get('/api/company-lookup', companyLookup);
app.get('/api/registration-status', registrationStatus);

app.get('/api/snapshot', requireSession, async (request, response) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (!supabaseUrl || !serviceRoleKey) {
      response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingServerVariables });
      return;
    }
    const requestedSince = typeof request.query.since === 'string' ? request.query.since : '';
    const since = requestedSince && !Number.isNaN(Date.parse(requestedSince)) ? requestedSince : null;
    let syncCursor = new Date().toISOString();
    const changedParams = (select: string, order?: string) => {
      const params = new URLSearchParams({ select });
      if (since) {
        params.set('updated_at', `gt.${since}`);
        params.set('order', 'updated_at.asc');
        params.set('limit', '200');
      } else if (order) {
        params.set('order', order);
      }
      return params;
    };
    const tables = await Promise.all([
      fetchSupabaseTable('port_configs', changedParams('*')),
      fetchSupabaseTable('depot_configs', changedParams('*')),
      fetchSupabaseTable('companies', changedParams('*')),
      fetchSupabaseTable('registration_submissions', changedParams('*', 'submitted_at.desc')),
      fetchSupabaseTable('user_registrations', changedParams('id,username,email,type,company_id,company_name,full_name,mobile_number,created_at,updated_at', 'created_at.desc')),
      fetchSupabaseTable('haulier_guidelines', (() => {
        const params = changedParams('content,updated_at');
        params.set('id', 'eq.default');
        params.set('limit', '1');
        return params;
      })()),
    ]);
    const [ports, depots, companies, submissions, userRegistrations, guidelines] = tables as any[];
    const cappedTables = [ports, depots, companies, submissions, userRegistrations]
      .filter((rows) => Array.isArray(rows) && rows.length === 200);
    if (since && cappedTables.length > 0) {
      syncCursor = cappedTables.reduce((oldest, rows) => {
        const timestamp = rows[rows.length - 1]?.updated_at;
        return timestamp && Date.parse(timestamp) < Date.parse(oldest) ? timestamp : oldest;
      }, syncCursor);
    }
    const guideline = guidelines?.[0] || null;
    response.status(200).json({
      ports: ports || [],
      depots: depots || [],
      companies: (companies || []).map((company: any) => ({ ...company.details, ...company, details: undefined })),
      submissions: submissions || [],
      userRegistrations: userRegistrations || [],
      guideline: guideline?.content || null,
      guidelineUpdatedAt: guideline?.updated_at || null,
      syncCursor,
    });
  } catch (error) {
    console.error('Snapshot request failed:', error instanceof SnapshotTableReadError
      ? { table: error.table, status: error.status, retryable: error.retryable, cause: error.cause }
      : error);
    response.status(502).json({ error: 'Unable to load application data.' });
  }
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

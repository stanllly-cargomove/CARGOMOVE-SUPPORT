import crypto from 'node:crypto';

// Vercel injects environment variables before the function starts. Load the
// local file only outside Vercel so production never depends on dotenv or a
// filesystem file that is not part of the deployment.
if (!process.env.VERCEL) {
  try {
    process.loadEnvFile?.('.env.local');
  } catch {
    // Local environments may supply variables through the shell instead.
  }
}

function environment() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    sessionSecret: process.env.SESSION_SECRET,
  };
}

export const supabaseUrl = environment().supabaseUrl;
export const serviceRoleKey = environment().serviceRoleKey;
export const anonKey = environment().anonKey;
export const sessionSecret = environment().sessionSecret;

export const missingVariables = [
  !supabaseUrl && 'SUPABASE_URL (or VITE_SUPABASE_URL)',
  !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
  !anonKey && 'SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)',
  !sessionSecret && 'SESSION_SECRET',
].filter(Boolean) as string[];

type Operation = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
type SingleMode = 'many' | 'single' | 'maybeSingle';

class PostgrestBuilder implements PromiseLike<{ data: any; error: any }> {
  private operation: Operation = 'select';
  private columns = '*';
  private payload: unknown;
  private filters = new URLSearchParams();
  private orderValue?: string;
  private limitValue?: number;
  private returnRepresentation = false;
  private singleMode: SingleMode = 'many';

  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
    private readonly table: string,
  ) {}

  select(columns = '*') {
    this.columns = columns;
    if (this.operation !== 'select') this.returnRepresentation = true;
    return this;
  }

  insert(payload: unknown) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  upsert(payload: unknown) {
    this.operation = 'upsert';
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.append(column, `eq.${String(value)}`);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.append(column, `neq.${String(value)}`);
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.append(column, `lt.${String(value)}`);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderValue = `${column}.${options?.ascending === false ? 'desc' : 'asc'}`;
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  single() {
    this.singleMode = 'single';
    return this.execute();
  }

  maybeSingle() {
    this.singleMode = 'maybeSingle';
    return this.execute();
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    const params = new URLSearchParams(this.filters);
    if (this.operation === 'select' || this.returnRepresentation) params.set('select', this.columns);
    if (this.orderValue) params.set('order', this.orderValue);
    if (this.limitValue !== undefined) params.set('limit', String(this.limitValue));

    const method = this.operation === 'select'
      ? 'GET'
      : this.operation === 'delete'
        ? 'DELETE'
        : this.operation === 'update'
          ? 'PATCH'
          : 'POST';
    const prefer = [
      this.operation === 'upsert' ? 'resolution=merge-duplicates' : '',
      this.returnRepresentation ? 'return=representation' : 'return=minimal',
    ].filter(Boolean).join(',');

    try {
      const result = await fetch(`${this.baseUrl}/rest/v1/${encodeURIComponent(this.table)}?${params.toString()}`, {
        method,
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          Prefer: prefer,
        },
        body: method === 'POST' || method === 'PATCH' ? JSON.stringify(this.payload) : undefined,
      });
      const parsed = result.status === 204 ? null : await result.json().catch(() => null);
      if (!result.ok) {
        return { data: null, error: parsed || { message: `Supabase request failed (${result.status}).` } };
      }

      if (this.singleMode !== 'many') {
        const rows = Array.isArray(parsed) ? parsed : parsed == null ? [] : [parsed];
        if (rows.length === 0 && this.singleMode === 'maybeSingle') return { data: null, error: null };
        if (rows.length !== 1) {
          return { data: null, error: { message: `Expected one row but received ${rows.length}.` } };
        }
        return { data: rows[0], error: null };
      }
      return { data: parsed, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : 'Unable to reach Supabase.' },
      };
    }
  }
}

export function adminClient() {
  const { supabaseUrl: url, serviceRoleKey: key } = environment();
  if (!url || !key) return null;
  return { from: (table: string) => new PostgrestBuilder(url, key, table) };
}

export function authClient() {
  const { supabaseUrl: url, anonKey: key } = environment();
  if (!url || !key) return null;
  return { from: (table: string) => new PostgrestBuilder(url, key, table) };
}

export function readSession(request: any) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const value = request.headers.cookie?.match(/(?:^|; )cargomove_session=([^;]+)/)?.[1];
  if (!value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as { id: string; email: string; type: string; exp: number };
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function signSession(payload: { id: string; email: string; type: string; exp: number }) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is missing.');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function setSessionCookie(response: any, value: string, maxAge = 28800) {
  response.setHeader('Set-Cookie', `cargomove_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}; ${process.env.VERCEL ? 'Secure' : ''}`);
}

export async function requestBody(request: any) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    request.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

import { createClient } from '@supabase/supabase-js';

export function autoMailConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const url = env.AUTO_MAIL_SUPABASE_URL?.trim();
  const key = env.AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (env.AUTO_MAIL_ENABLED !== 'true') return { ready: false, message: 'Auto Mail is not enabled.' };
  if (!url || !key) return { ready: false, message: 'Configure the separate Auto Mail Supabase project on the server.' };
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error();
    const primary = [env.SUPABASE_URL, env.VITE_SUPABASE_URL].filter(Boolean);
    if (primary.some(value => new URL(value!.trim()).hostname.toLowerCase() === target.hostname.toLowerCase())) {
      return { ready: false, message: 'Auto Mail requires a different Supabase project from the main application.' };
    }
    // Refuse to connect when the primary project cannot be identified for comparison.
    if (!primary.length) return { ready: false, message: 'Configure the main Supabase URL before checking database isolation.' };
    return { ready: true, message: 'Separate database configured.', url: target.origin, key };
  } catch {
    return { ready: false, message: 'Check the server Supabase URLs. Auto Mail requires a valid HTTPS project URL.' };
  }
}

export function autoMailClient(config: ReturnType<typeof autoMailConfiguration>) {
  if (!config.ready || !config.url || !config.key) throw new Error('Auto Mail database is not configured.');
  return createClient(config.url, config.key, {
    db: { schema: 'auto_mail' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
}

import { createClient } from '@supabase/supabase-js';

const viteEnv = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env ?? ({} as ImportMetaEnv);
const supabaseUrl = viteEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export async function fetchSupabaseSnapshot() {
  if (!supabase) return null;
  const [ports, depots, companies, submissions, userRegistrations, guidelines] = await Promise.all([
    supabase.from('port_configs').select('*'),
    supabase.from('depot_configs').select('*'),
    supabase.from('companies').select('*'),
    supabase.from('registration_submissions').select('*').order('submitted_at', { ascending: false }),
    supabase.from('user_registrations').select('*').order('created_at', { ascending: false }),
    supabase.from('haulier_guidelines').select('content').eq('id', 'default').maybeSingle(),
  ]);
  const failed = [ports, depots, companies, submissions, userRegistrations, guidelines].find((result) => result.error);
  if (failed?.error) {
    console.error('Supabase read failed:', failed.error.message);
    return null;
  }
  return {
    ports: ports.data || [],
    depots: depots.data || [],
    companies: (companies.data || []).map((company: any) => ({ ...company, ...company.details, details: undefined })),
    submissions: submissions.data || [],
    userRegistrations: userRegistrations.data || [],
    guideline: guidelines.data?.content || null,
  };
}

export async function upsertSupabaseRow(table: string, row: object) {
  if (!supabase) return;
  const { error } = await supabase.from(table).upsert(row as Record<string, unknown>);
  if (error) console.error(`Supabase ${table} write failed:`, error.message);
}

export async function deleteSupabaseRow(table: string, id: string) {
  if (!supabase) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) console.error(`Supabase ${table} delete failed:`, error.message);
}
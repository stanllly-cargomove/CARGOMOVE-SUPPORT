import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.ADMIN_EMAIL || 'support@cargomove.com.my').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!url || !serviceRoleKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
}
if (!password || password.length < 8) {
  throw new Error('Provide a new password of at least 8 characters through ADMIN_PASSWORD.');
}

const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: users, error: listError } = await supabase.auth.admin.listUsers();
if (listError) throw listError;

const user = (users.users as any[]).find((candidate) => candidate.email?.toLowerCase() === email);
if (!user) throw new Error(`No Supabase Auth user exists for ${email}.`);

const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
  password,
  email_confirm: true,
});
if (updateError) throw updateError;

console.log(`Password updated for ${email}.`);

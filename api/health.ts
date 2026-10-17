import { uploadsEnabled } from '../server-handlers/northport/configuration.js';

export default function health(_request: any, response: any) {
  const names = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SESSION_SECRET',
  ];
  const configured = names.filter((name) => Boolean(process.env[name]));
  response.setHeader('Cache-Control','no-store');
  response.status(200).json({ ok: true, service: 'cargomove-api', configured, northportRecovery: { uploadsEnabled: uploadsEnabled() } });
}


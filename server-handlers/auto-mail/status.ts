import { noStore, requireAdmin } from '../_email.js';
import { encryptMailboxToken } from './token-encryption.js';
import { autoMailClient, autoMailConfiguration } from './configuration.js';
import { oauthConfig } from './gmail.js';
import { aiConfiguration } from './ai.js';

export default async function autoMailStatus(request: any, response: any) {
  noStore(response);
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });
  if (!requireAdmin(request, response)) return;
  const config = autoMailConfiguration();
  const base = { milestone: 4, sendingEnabled: false, mailboxConnected: false, manualReplyEnabled: false, knowledgeReady: false, aiEnabled: false, learningReady: false };
  if (!config.ready) return response.json({ ...base, state: 'SETUP_REQUIRED', message: config.message });
  try {
    const { data, error } = await autoMailClient(config).from('settings').select('schema_version').eq('id', 'system').maybeSingle();
    if (error || ![1, 2, 3, 4, 5].includes(data?.schema_version)) {
      return response.json({ ...base, state: 'DATABASE_REQUIRED', message: 'Database setup could not be verified. Check the separate project credentials, exposed schema, and Auto Mail migration.' });
    }
    if (data.schema_version === 1) return response.json({ ...base, state: 'MIGRATION_REQUIRED', message: 'Apply the Milestone 2 Gmail migration to the Auto Mail database to enable inbox and manual replies.' });
    let oauthReady = false;
    try { oauthConfig(); encryptMailboxToken('configuration-check'); oauthReady = true; } catch { /* Keep credentials private. */ }
    const result = await autoMailClient(config).from('gmail_connections').select('email,connected_at').eq('id', 'system').maybeSingle();
    if (result.error) return response.json({ ...base, state: 'DATABASE_REQUIRED', message: 'Unable to read Gmail connection settings. Check the Milestone 2 migration.' });
    const ai = aiConfiguration();
    return response.json({ ...base, state: 'READY', oauthReady, mailboxConnected: !!result.data, knowledgeReady: data.schema_version >= 3,
      aiDraftsReady: data.schema_version >= 4, aiEnabled: data.schema_version >= 4 && ai.ready, learningReady: data.schema_version >= 5,
      aiMessage: data.schema_version < 4 ? 'Apply the AI draft migration to the Auto Mail database to enable this feature.' : ai.message,
      mailbox: result.data?.email || null, manualReplyEnabled: !!result.data && oauthReady,
      message: result.data ? 'Gmail connected. Replies send only when you click Send reply.' : 'Database ready. Connect your Gmail account to open the inbox.' });
  } catch {
    return response.status(503).json({ error: 'Unable to check the Auto Mail development database. Try again.' });
  }
}

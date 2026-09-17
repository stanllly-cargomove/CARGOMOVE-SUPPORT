// Routed through the single Express Vercel function.
import crypto from 'node:crypto';
import { GMAIL_READ_SCOPE, GMAIL_COMPOSE_SCOPE } from './client.js';
import { configuredClient, createPkce, GMAIL_SEND_SCOPE, googleOAuthConfig, noStore, requireAdmin } from '../_email.js';

export default async function gmailConnect(request: any, response: any) {
  noStore(response);
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;
  try {
    const config = googleOAuthConfig();
    const state = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(state).digest('hex');
    const pkce = createPkce();
    await client.from('gmail_oauth_states').delete().lt('expires_at', new Date().toISOString());
    const { error } = await client.from('gmail_oauth_states').insert({
      state_hash: stateHash,
      pkce_verifier: pkce.verifier,
      admin_id: session.id,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) return response.status(502).json({ error: error.message });
    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: `openid email ${GMAIL_SEND_SCOPE} ${GMAIL_READ_SCOPE} ${GMAIL_COMPOSE_SCOPE}`,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    });
    response.json({ authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}` });
  } catch (error) {
    response.status(503).json({ error: error instanceof Error ? error.message : 'Gmail OAuth is not configured.' });
  }
}

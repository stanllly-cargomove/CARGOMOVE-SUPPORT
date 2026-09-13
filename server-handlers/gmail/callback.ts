// Routed through the single Express Vercel function.
import crypto from 'node:crypto';
import { configuredClient, encryptRefreshToken, GMAIL_SEND_SCOPE, googleOAuthConfig, requireAdmin } from '../_email';

export default async function gmailCallback(request: any, response: any) {
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;
  const state = String(request.query?.state || '');
  const code = String(request.query?.code || '');
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  try {
    const { data: savedState, error: stateError } = await client
      .from('gmail_oauth_states').select('*').eq('state_hash', stateHash).maybeSingle();
    await client.from('gmail_oauth_states').delete().eq('state_hash', stateHash);
    if (stateError || !savedState || savedState.admin_id !== session.id || Date.parse(savedState.expires_at) <= Date.now() || !code) {
      return response.status(400).send('Invalid or expired Gmail authorization request.');
    }
    const config = googleOAuthConfig();
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: savedState.pkce_verifier,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
      }),
    });
    const tokens = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) throw new Error(String(tokens.error || 'oauth_token_exchange_failed'));
    const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const identity = await identityResponse.json().catch(() => ({}));
    if (!identityResponse.ok || !identity.sub || !identity.email || identity.email_verified === false) throw new Error('google_identity_verification_failed');
    const encrypted = encryptRefreshToken(String(tokens.refresh_token));
    const { error } = await client.from('gmail_connections').upsert({
      id: 'system',
      google_subject: String(identity.sub),
      email: String(identity.email).toLowerCase(),
      ...encrypted,
      scopes: String(tokens.scope || GMAIL_SEND_SCOPE).split(' '),
      status: 'ACTIVE',
      connected_by: session.id,
      connected_at: new Date().toISOString(),
      last_error_code: null,
    }).select().single();
    if (error) throw error;
    response.redirect(302, `${config.appUrl}/?gmail=connected`);
  } catch (error) {
    console.error('Gmail OAuth callback failed:', error);
    response.status(502).send('Unable to connect Gmail. Return to CargoMove and try again.');
  }
}

import { bodyOf, noStore, requireAdmin } from '../_email.js';
import { autoMailClient, autoMailConfiguration } from './configuration.js';
import { checkOrigin, MailError } from './gmail.js';
import { modelIds, readAgentSettings } from './agent-config.js';

export default async function agentSettings(request: any, response: any) {
  noStore(response);
  const session = requireAdmin(request, response);
  if (!session) return;
  if (!['GET', 'POST'].includes(request.method)) return response.status(405).json({ error: 'Method not allowed.' });
  try {
    if (request.method === 'POST') checkOrigin(request);
    const config = autoMailConfiguration();
    if (!config.ready) throw new MailError(503, config.message);
    const client = autoMailClient(config);
    if (request.method === 'GET') {
      const result = await readAgentSettings(client);
      return response.json({ ...result, models: modelIds, serverEnabled: process.env.AUTO_MAIL_AI_ENABLED === 'true', keyConfigured: !!process.env.OPENAI_API_KEY?.trim() });
    }
    const input = await bodyOf(request);
    const enabled = input.enabled;
    const model = input.model;
    const models = input.enabledModels;
    if (typeof enabled !== 'boolean' || typeof model !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)
      || !Number.isSafeInteger(input.version) || Number(input.version) < 0 || !Array.isArray(models) || models.length > 30
      || models.some((value: unknown) => typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(value))
      || new Set(models).size !== models.length || (enabled && !models.includes(model))) throw new MailError(400, 'Select an enabled model and valid email agent settings.');
    const result = await client.rpc('save_agent_settings', { p_enabled: enabled, p_model: model, p_models: models, p_version: input.version, p_actor: session.id });
    if (result.error) {
      if (String(result.error.message).includes('AGENT_CONFLICT')) throw new MailError(409, 'Another administrator changed the agent settings. Reload before saving; your changes are preserved.');
      if (String(result.error.message).includes('AGENT_INVALID')) throw new MailError(400, 'Select an enabled model and valid email agent settings.');
      throw new MailError(503, 'Apply the email agent settings migration in the separate Auto Mail database, then reload.');
    }
    return response.json({ settings: result.data });
  } catch (error) {
    return response.status(error instanceof MailError ? error.status : 503).json({ error: error instanceof MailError ? error.message : 'Email agent settings could not be loaded. Try again.' });
  }
}

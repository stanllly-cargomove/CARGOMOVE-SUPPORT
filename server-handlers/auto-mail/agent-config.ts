import { autoMailClient } from './configuration.js';

export function aiConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (env.AUTO_MAIL_AI_ENABLED !== 'true') return { ready: false, message: 'AI suggestions are disabled. Enable them in the Auto Mail server configuration.' };
  const key = env.OPENAI_API_KEY?.trim();
  const model = env.AUTO_MAIL_AI_MODEL?.trim();
  if (!key || !model || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) return { ready: false, message: 'Configure OPENAI_API_KEY and AUTO_MAIL_AI_MODEL on the server.' };
  return { ready: true, message: 'OpenAI draft generation is configured.', key, model };
}

export type AgentSettings = { enabled: boolean; model: string; enabled_models: string[]; version: number };
export const modelIds = ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini', 'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o'];

export async function readAgentSettings(client: ReturnType<typeof autoMailClient>, env: NodeJS.ProcessEnv = process.env) {
  const result = await client.from('agent_settings').select('enabled,model,enabled_models,version').eq('id', 'system').maybeSingle();
  const missing = ['PGRST205', '42P01'].includes(result.error?.code || '');
  if (result.error && !missing) throw new Error('Email agent settings are unavailable.');
  const model = env.AUTO_MAIL_AI_MODEL?.trim() || 'gpt-5.4-mini';
  const settings: AgentSettings = result.data || { enabled: env.AUTO_MAIL_AI_ENABLED === 'true', model, enabled_models: [model], version: 0 };
  return { settings, storageReady: !missing };
}

export async function effectiveAiConfiguration(client: ReturnType<typeof autoMailClient>, env: NodeJS.ProcessEnv = process.env) {
  const { settings } = await readAgentSettings(client, env);
  if (!settings.enabled || !settings.enabled_models.includes(settings.model)) return { ready: false, message: 'AI suggestions are disabled in Auto Email Config.' };
  return aiConfiguration({ ...env, AUTO_MAIL_AI_MODEL: settings.model });
}

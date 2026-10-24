// Read-only operational readiness check. Default mode has no network access.
// Never prints credentials, tokens, message bodies or raw service errors.
import dotenv from 'dotenv';
import { autoMailClient, autoMailConfiguration } from '../server-handlers/auto-mail/configuration.js';
import { effectiveAiConfiguration } from '../server-handlers/auto-mail/agent-config.js';
import { accessToken, connected, gmailGet, oauthConfig, MODIFY_SCOPE, READ_SCOPE, SEND_SCOPE } from '../server-handlers/auto-mail/gmail.js';
import { evaluateAutoReply } from '../server-handlers/auto-mail/auto-reply.js';

dotenv.config({ path: '.env.local', quiet: true });
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !['--live', '--gmail', '--model'].includes(flag)) || ((flags.has('--gmail') || flags.has('--model')) && !flags.has('--live'))) throw new Error('Usage: npm run check:auto-mail [-- --live [--gmail] [--model]]');
const report: Record<string, unknown> = { mode: flags.has('--live') ? 'READ_ONLY_LIVE' : 'OFFLINE', checkedAt: new Date().toISOString(), checks: {} };
const checks = report.checks as Record<string, unknown>;
const config = autoMailConfiguration();
checks.separateDatabaseConfiguration = config.ready;
checks.aiServerConfigured = process.env.AUTO_MAIL_AI_ENABLED === 'true' && !!process.env.OPENAI_API_KEY?.trim();
checks.schedulerSecretConfigured = (process.env.AUTO_MAIL_SCHEDULER_SECRET?.length || 0) >= 32;
checks.autoReplyServerEnabled = process.env.AUTO_MAIL_AUTO_REPLY_ENABLED === 'true';
try { oauthConfig(); checks.gmailOAuthConfigured = true; } catch { checks.gmailOAuthConfigured = false; }
if (flags.has('--live') && config.ready) {
  const client = autoMailClient(config);
  const probes = [
    ['foundation', 'settings', 'schema_version'], ['gmail', 'gmail_connections', 'email,scopes,version'],
    ['knowledge', 'knowledge_articles', 'id,version'], ['aiDrafts', 'ai_reply_drafts', 'id,draft_kind,automatic'],
    ['learning', 'learning_suggestions', 'id,version'], ['agentSettings', 'agent_settings', 'id,version'],
    ['richReplies', 'reply_details', 'delivery_id'], ['outbox', 'outbox_messages', 'id'],
    ['scheduledReplies', 'outbox_messages', 'reply_context'], ['incomingDrafts', 'incoming_ai_jobs', 'id'],
    ['controlledAutoReplies', 'incoming_agent_settings', 'auto_reply_enabled,min_confidence,max_auto_replies_per_hour'],
  ] as const;
  const migrations: Record<string, boolean> = {};
  for (const [name, table, columns] of probes) {
    try { const result = await client.from(table).select(columns, { head: true }).limit(1); migrations[name] = !result.error; } catch { migrations[name] = false; }
  }
  checks.schemaCapabilities = migrations;
  for (const [name, table] of [['scheduled', 'outbox_worker_state'], ['incoming', 'incoming_worker_state']] as const) {
    try {
      const result = await client.from(table).select('last_seen').eq('id', 'system').maybeSingle();
      checks[name + 'WorkerRecent'] = !result.error && Date.parse(result.data?.last_seen) > Date.now() - 300000;
    } catch { checks[name + 'WorkerRecent'] = false; }
  }
  try {
    const result = await client.from('incoming_agent_settings').select('*').eq('id', 'system').maybeSingle();
    checks.incomingDraftingEnabled = !result.error && !!result.data?.enabled;
    checks.autoReplySavedEnabled = !result.error && !!result.data?.auto_reply_enabled;
  } catch { checks.incomingDraftingEnabled = false; checks.autoReplySavedEnabled = false; }
  try {
    const connection = await client.from('gmail_connections').select('scopes').eq('id', 'system').maybeSingle();
    checks.gmailConnected = !connection.error && !!connection.data;
    checks.gmailReadSendScopes = [READ_SCOPE, SEND_SCOPE].every(scope => connection.data?.scopes?.includes(scope));
    checks.gmailModifyScope = !!connection.data?.scopes?.includes(MODIFY_SCOPE);
  } catch { checks.gmailConnected = false; }
  try {
    const result = await client.from('knowledge_articles').select('id', { head: true, count: 'exact' }).eq('status', 'APPROVED');
    checks.approvedKnowledgeAvailable = !result.error && (result.count || 0) > 0;
  } catch { checks.approvedKnowledgeAvailable = false; }
  if (flags.has('--gmail')) {
    try { const connection = await connected(client); await gmailGet(await accessToken(connection), 'profile'); checks.liveGmailAuthentication = true; }
    catch { checks.liveGmailAuthentication = false; }
  }
  if (flags.has('--model')) {
    try {
      const ai = await effectiveAiConfiguration(client); if (!ai.ready) throw new Error();
      // Fictional fixture only. This checks access/structured outputs, not customer-answer quality.
      await evaluateAutoReply(ai, { id: 'readiness-fixture', subject: 'Fictional setup check', messages: [] }, [{ id: '10000000-0000-4000-8000-000000000001', title: 'Fictional example', version: 1, port: 'ALL', content: 'For this fictional test, ask the example user to provide their company certificate.' }], 'Please provide your company certificate.');
      checks.liveModelStructuredOutput = true;
    } catch { checks.liveModelStructuredOutput = false; }
  }
}
report.limits = 'Read-only checks do not verify production deployment parity, cron configuration, actual delivery, representative answer quality, or storage retention. OFF is a valid intentional policy setting.';
console.log(JSON.stringify(report, null, 2));

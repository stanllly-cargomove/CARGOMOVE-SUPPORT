import type { RegistrationSubmission } from '../../src/types/index.js';
import { registrationUploadBlockReason } from '../registration-uploads/eligibility.js';

const PAGE_SIZE = 100;
const KEY = 'auto_register_cm';

export async function pendingAutoRegisterPage(client: any, after: string | null, candidatesOnly = false): Promise<RegistrationSubmission[]> {
  const result = await client.rpc('auto_register_cm_pending_page', {
    p_after: after, p_limit: PAGE_SIZE, p_candidates_only: candidatesOnly,
  });
  if (result.error || !Array.isArray(result.data)) throw new Error('Unable to inspect pending registrations. Apply the Auto Register reliability migration.');
  return result.data;
}

export async function loadPendingAutoRegistrations(client: any): Promise<RegistrationSubmission[]> {
  const rows: RegistrationSubmission[] = [];
  let after: string | null = null;
  while (true) {
    const page = await pendingAutoRegisterPage(client, after);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    after = page[page.length - 1].id;
  }
}

export async function loadAutoScheduledIds(client: any): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const page = await client.from('auto_register_cm_scheduled_items').select('submission_id')
      .eq('status', 'SCHEDULED').order('id', { ascending: true }).range(offset, offset + 499).timeout(8000);
    if (page.error) throw new Error('Unable to inspect the scheduled registration queue.');
    for (const row of page.data || []) ids.add(row.submission_id);
    if ((page.data || []).length < 500) return ids;
  }
}

export async function loadAutoRegistrationIndicators(client: any): Promise<{
  scheduled: Set<string>;
  rescheduled: Map<string, { reason: string; retryAt: string | null }>;
  failed: Set<string>;
}> {
  const scheduled = await loadAutoScheduledIds(client);
  const failures = new Map<string, { count: number; safe: boolean; reason: string; completedAt: string | null; succeeded: boolean }>();
  for (let offset = 0; ; offset += 500) {
    const page = await client.from('auto_register_cm_scheduled_items')
      .select('submission_id,status,message,completed_at,retry_allowed').in('status', ['FAILED', 'SUCCESS'])
      .order('scheduled_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + 499).timeout(8000);
    if (page.error) throw new Error('Unable to inspect failed automatic registrations.');
    for (const row of page.data || []) {
      const previous = failures.get(row.submission_id);
      if (row.status === 'SUCCESS') {
        failures.set(row.submission_id, { count: previous?.count || 0, safe: previous?.safe ?? true,
          reason: previous?.reason || '', completedAt: previous?.completedAt || null, succeeded: true });
        continue;
      }
      failures.set(row.submission_id, {
        count: (previous?.count || 0) + 1,
        safe: (previous?.safe ?? true) && row.retry_allowed === true,
        reason: previous?.reason || row.message || 'The first automatic registration failed.',
        completedAt: previous?.completedAt || row.completed_at || null,
        succeeded: false,
      });
    }
    if ((page.data || []).length < 500) break;
  }
  const rescheduled = new Map<string, { reason: string; retryAt: string | null }>();
  const failed = new Set<string>();
  for (const [id, item] of failures) {
    if (item.succeeded) continue;
    if (item.count >= 2 || !item.safe) failed.add(id);
    else rescheduled.set(id, { reason: item.reason, retryAt: item.completedAt });
  }
  return { scheduled, rescheduled, failed };
}

/** Bounded discovery with a durable cursor: later candidates cannot starve behind
 * an old non-eligible backlog when the request's work budget is exhausted. */
export async function scheduleEligibleAutoRegistrations(
  client: any,
  actor: string,
  options: { deadline?: number; now?: () => number } = {},
): Promise<{ scheduled: number; hasMore: boolean }> {
  const now = options.now || Date.now;
  const deadline = options.deadline ?? now() + 20_000;
  const config = await client.from('automation_schedulers').select('discovery_cursor')
    .eq('scheduler_key', KEY).timeout(8000).maybeSingle();
  if (config.error || !config.data) throw new Error('Unable to load registration discovery progress.');
  let after: string | null = config.data.discovery_cursor || null;
  let scheduled = 0;
  let ports: any[] | undefined;
  const saveCursor = async (cursor: string | null) => {
    const saved = await client.from('automation_schedulers').update({ discovery_cursor: cursor })
      .eq('scheduler_key', KEY).timeout(8000);
    if (saved.error) throw new Error('Unable to save registration discovery progress.');
  };
  while (now() < deadline) {
    const page = await pendingAutoRegisterPage(client, after, true);
    if (!page.length) {
      if (after) await saveCursor(null);
      return { scheduled, hasMore: false };
    }
    if (!ports) {
      const result = await client.from('port_configs').select('*').limit(1000).timeout(8000);
      if (result.error) throw new Error('Port configuration could not be loaded.');
      ports = result.data || [];
    }
    for (let offset = 0; offset < page.length; offset += 8) {
      if (now() >= deadline) return { scheduled, hasMore: true };
      const chunk = page.slice(offset, offset + 8);
      const checked = await Promise.all(chunk.map(async submission => ({
        submission,
        reason: await registrationUploadBlockReason(client, submission, ports!),
      })));
      const ids = checked.filter(item => !item.reason).map(item => item.submission.id);
      if (ids.length) {
        const saved = await client.rpc('schedule_auto_register_cm_submissions', { p_actor: actor, p_submission_ids: ids });
        if (saved.error || !Array.isArray(saved.data)) throw new Error('Unable to schedule eligible registrations. Please retry.');
        scheduled += saved.data.length;
      }
      after = chunk[chunk.length - 1].id;
      await saveCursor(after);
    }
    if (page.length < PAGE_SIZE) {
      await saveCursor(null);
      return { scheduled, hasMore: false };
    }
  }
  return { scheduled, hasMore: true };
}

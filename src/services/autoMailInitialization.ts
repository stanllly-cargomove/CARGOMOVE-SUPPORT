import { cachedMail, onMailSessionCleared, peekMail, takeMailRevalidation, writeMail } from './autoMailCache';

type Readiness = { state: string; mailboxConnected: boolean; oauthReady?: boolean; connectionVersion?: string; mailbox?: string; composeReady?: boolean };
type Step = { name: string; state: 'pending' | 'loading' | 'ready' | 'unavailable' | 'error' };
export type MailInitializationProgress = { completed: number; steps: Step[] };
export const initialMailProgress = (): MailInitializationProgress => ({ completed: 0, steps: ['Connection', 'Inbox', 'Sent', 'Scheduled'].map((name, index) => ({name, state: index ? 'pending' : 'loading'})) });
type Task = { progress: MailInitializationProgress; listeners: Set<(progress: MailInitializationProgress) => void>; cancelled: boolean; promise: Promise<{status: Readiness; revalidate: boolean}> };
const tasks = new Map<string, Task>();
onMailSessionCleared(() => { tasks.forEach(task => { task.cancelled = true; }); tasks.clear(); });
const contextOf = (status?: Readiness) => status?.connectionVersion || status?.mailbox || '';
export function mailInitialized(scope: string) {
  const status = peekMail<Readiness>(scope, 'status');
  return !!status?.mailboxConnected && !!peekMail<{ready:boolean}>(scope, 'initialized', contextOf(status))?.ready;
}
export async function initializeMail<T extends Readiness>(scope: string, report: (progress: MailInitializationProgress) => void): Promise<{status:T; revalidate:boolean}> {
  let task = tasks.get(scope);
  if (!task) {
    const current: Task = {progress: initialMailProgress(), listeners: new Set(), cancelled: false, promise: null!};
    tasks.set(scope, current);
    const update = (index: number, state: Step['state']) => {
      if (current.cancelled) return;
      const steps = current.progress.steps.map((step, at) => at === index ? {...step, state} : step);
      current.progress = {steps, completed: steps.filter(step => step.state === 'ready' || step.state === 'unavailable').length};
      current.listeners.forEach(listener => listener(current.progress));
    };
    current.promise = (async () => {
      const revalidate = takeMailRevalidation(scope);
      let status: Readiness;
      try { status = await cachedMail<Readiness>(scope, 'status', {force:revalidate}); }
      catch (error) { update(0, 'error'); throw error; }
      if (current.cancelled) throw new Error('Your session ended. Sign in again.');
      if (status.state !== 'READY' || !status.mailboxConnected || !status.oauthReady) return {status, revalidate};
      const context = contextOf(status);
      if (peekMail<{ready:boolean}>(scope, 'initialized', context)?.ready) return {status, revalidate};
      update(0, 'ready');
      const paths = ['threads?folder=inbox', 'threads?folder=sent&order=sent-time', status.composeReady ? 'outbox?offset=0' : null];
      const results = await Promise.allSettled(paths.map(async (path, index) => {
        if (!path) { update(index + 1, 'unavailable'); return; }
        update(index + 1, 'loading');
        try { await cachedMail(scope, path, {context}); update(index + 1, 'ready'); }
        catch (error) { update(index + 1, 'error'); throw error; }
      }));
      if (current.cancelled) throw new Error('Your session ended. Sign in again.');
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw new Error(failure.reason instanceof Error ? failure.reason.message : 'Unable to initialize mail. Please retry.');
      writeMail(scope, 'initialized', {ready:true}, context);
      return {status, revalidate};
    })().finally(() => { if (tasks.get(scope) === current) tasks.delete(scope); });
    task = current;
  }
  task.listeners.add(report);
  // Existing initialized mail stays visible while its connection is revalidated.
  if (!mailInitialized(scope)) report(task.progress);
  try { return await task.promise as {status:T; revalidate:boolean}; }
  finally { task.listeners.delete(report); }
}

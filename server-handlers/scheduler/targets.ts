export const ORIGIN = 'https://www.cargomove.my';
export const DEFAULT_SCHEDULER_ID = '00000000-0000-4000-8000-000000000005';
export const TASK_ID = /^[a-f0-9]{24}$/;
export const WORKER_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,119}$/;
export const SCHEDULER_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type SchedulerTarget = { taskId: string; workerName: string };
export const NORTHPORT_TARGET: SchedulerTarget = { taskId: '5ff7ea8633904c1dd1bd892b', workerName: 'northport_containers' };

export function schedulerUrl(target: SchedulerTarget): string {
  if (!TASK_ID.test(target.taskId) || !WORKER_NAME.test(target.workerName)) throw new Error('Invalid saved scheduler target.');
  return `${ORIGIN}/administration/run_scheduled_task?${new URLSearchParams({ id: target.taskId, name: target.workerName })}`;
}

export function parseSchedulerUrl(value: unknown): SchedulerTarget {
  if (typeof value !== 'string' || value.length > 1000) throw new Error('Enter a CargoMove scheduler link.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete HTTPS CargoMove scheduler link.'); }
  if (url.protocol !== 'https:' || !['www.cargomove.my', 'cargomove.my'].includes(url.hostname)
    || url.port || url.username || url.password || url.hash || url.pathname !== '/administration/run_scheduled_task') {
    throw new Error('Use an HTTPS CargoMove /administration/run_scheduled_task link.');
  }
  if (url.searchParams.getAll('id').length !== 1 || url.searchParams.getAll('name').length !== 1
    || [...url.searchParams.keys()].some(key => !['id', 'name'].includes(key))) {
    throw new Error('The link must contain only one id and one name parameter.');
  }
  const target = { taskId: url.searchParams.get('id')!.toLowerCase(), workerName: url.searchParams.get('name')! };
  if (!TASK_ID.test(target.taskId) || !WORKER_NAME.test(target.workerName)) throw new Error('The scheduler ID or worker name is invalid.');
  return target;
}

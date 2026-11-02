import type { Browser } from 'playwright-core';

export class CargoMoveAccountBusyError extends Error {}
type LeaseClient = {rpc: (name:string, args:Record<string,unknown>) => Promise<{data?:unknown;error?:unknown}>};

// All automated users of the configured CargoMove login share this database
// lease, including requests on different servers or signed into the same account.
export async function launchAccountBrowser(client: LeaseClient, launch: () => Promise<Browser>): Promise<Browser> {
  const acquired = await client.rpc('acquire_cargomove_account_session', {});
  const id = acquired.data && typeof acquired.data === 'object' && 'id' in acquired.data ? acquired.data.id : undefined;
  if (acquired.error || typeof id !== 'string') throw new CargoMoveAccountBusyError(acquired.error
    ? 'CargoMove session protection is unavailable. Apply 20261102030000_cargomove_session_coordination.sql. No scheduler request was sent.'
    : 'The shared CargoMove login is busy with another operation. Wait a moment and retry from recovery history. No scheduler request was sent.');
  let releasePromise: Promise<void> | undefined;
  const release = () => releasePromise ??= (async () => {
    // A failed release leaves the bounded lease in place; never clear another holder.
    await client.rpc('release_cargomove_account_session', {p_id:id}).catch(() => {});
  })();
  try {
    const browser = await launch();
    const close = async () => {await browser.close();await release();};
    // Close before the three-minute database lease can expire, even on a hung flow.
    const timer = setTimeout(() => {void close().catch(() => {});}, 120000);
    timer.unref();
    browser.once('disconnected', () => {clearTimeout(timer);void release();});
    return new Proxy(browser, {get(target, key) {
      if (key === 'close') return async () => {try {await close();} finally {clearTimeout(timer);}};
      const value = Reflect.get(target,key);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
  } catch (error) {await release();throw error;}
}

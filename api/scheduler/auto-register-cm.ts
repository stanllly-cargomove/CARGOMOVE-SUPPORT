import autoRegisterCm from '../../server-handlers/scheduler/auto-register-cm.js';
import autoRegisterCmQueue from '../../server-handlers/scheduler/auto-register-cm-queue.js';

type Handler = (request: any, response: any) => unknown;

// Both public scheduler URLs share one Vercel function. The existing handlers
// retain their method, authentication, origin and confirmation checks.
export function createAutoRegisterCmRouter(handlers: { scheduler: Handler; queue: Handler } = {
  scheduler: autoRegisterCm,
  queue: autoRegisterCmQueue,
}) {
  return function autoRegisterCmRouter(request: any, response: any) {
    const route = request.query?.route;
    if (route === undefined) return handlers.scheduler(request, response);
    if (route === 'queue') return handlers.queue(request, response);
    response.setHeader('Cache-Control', 'no-store');
    return response.status(404).json({ error: 'Unknown Auto Register API route.' });
  };
}

export default createAutoRegisterCmRouter();

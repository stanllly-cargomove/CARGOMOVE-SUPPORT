import schedulerCatalog from '../server-handlers/scheduler/catalog.js';
import runScheduler from '../server-handlers/scheduler/handler.js';
import northportRecovery from '../server-handlers/northport/handler.js';
import systemVersions from '../server-handlers/system-versions.js';

type Handler = (request:any,response:any)=>unknown;
// Public URLs are preserved by explicit Vercel rewrites. Each handler retains
// its own method, ADMIN, origin, confirmation and database admission checks.
export function createDevToolsRouter(handlers:Record<string,Handler>={
  schedulers:schedulerCatalog,
  'run-scheduler':runScheduler,
  'northport-recovery':northportRecovery,
  'system-versions':systemVersions,
}) {
  return async function devTools(request:any,response:any) {
    response.setHeader('Cache-Control','no-store');
    const route=request.query?.route;
    if(typeof route!=='string'||!Object.hasOwn(handlers,route))return response.status(404).json({error:'Unknown developer API route.'});
    try {return await handlers[route](request,response);}
    catch {if(!response.headersSent)return response.status(503).json({error:'Developer tools are temporarily unavailable.'});}
  };
}
export default createDevToolsRouter();

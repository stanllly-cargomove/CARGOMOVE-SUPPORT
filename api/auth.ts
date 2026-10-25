import login from '../server-handlers/auth/login.js';
import session from '../server-handlers/auth/session.js';
import users from '../server-handlers/auth/users.js';

type Handler = (request: any, response: any) => unknown;

// Explicit rewrites preserve public auth URLs. The handlers retain all existing
// authentication, cookie and user-management behavior.
export function createAuthRouter(handlers: Record<string, Handler> = {
  login, session, users, logout: session,
}) {
  return function auth(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store');
    const route = request.query?.route;
    if (typeof route !== 'string' || !Object.hasOwn(handlers, route)) {
      return response.status(404).json({ error: 'Unknown authentication API route.' });
    }
    return handlers[route](request, response);
  };
}

export default createAuthRouter();

import { readSession } from '../_runtime';

export default function session(request: any, response: any) {
  const current = readSession(request);
  response.status(200).json({
    authenticated: Boolean(current),
    user: current ? { id: current.id, email: current.email, type: current.type } : null,
  });
}

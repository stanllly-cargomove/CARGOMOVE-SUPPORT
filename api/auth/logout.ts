import { setSessionCookie } from '../_runtime';

export default function logout(_request: any, response: any) {
  setSessionCookie(response, '', 0);
  response.status(204).end();
}

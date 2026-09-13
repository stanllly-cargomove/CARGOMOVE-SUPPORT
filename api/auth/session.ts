import crypto from 'node:crypto';

export default function session(request: any, response: any) {
  const secret = process.env.SESSION_SECRET;
  const value = request.headers?.cookie?.match(/(?:^|; )cargomove_session=([^;]+)/)?.[1];
  let current: { id: string; email: string; type: string; exp: number } | null = null;
  if (secret && value) {
    const [encoded, signature] = value.split('.');
    const expected = encoded ? crypto.createHmac('sha256', secret).update(encoded).digest('base64url') : '';
    if (encoded && signature && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString());
        if (parsed.exp > Date.now()) current = parsed;
      } catch {
        current = null;
      }
    }
  }
  response.status(200).json({
    authenticated: Boolean(current),
    user: current ? { id: current.id, email: current.email, type: current.type } : null,
  });
}

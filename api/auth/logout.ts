export default function logout(_request: any, response: any) {
  response.setHeader('Set-Cookie', 'cargomove_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  response.status(204).end();
}

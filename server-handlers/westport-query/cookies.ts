// Private jar for one fixed HTTPS host; never serialized into portal responses.
const HOST = 'etp.westports.com.my';
type Cookie = { name: string; value: string; path: string; expires: number };
export class WestportCookies {
  private cookies = new Map<string, Cookie>();
  constructor(private now: () => number) {}
  clear() { this.cookies.clear(); }
  update(headers: Headers, requestUrl: URL) {
    for (const line of headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const equals = pair.indexOf('=');
      const name = pair.slice(0, equals).trim(), value = pair.slice(equals + 1).trim();
      if (equals < 1 || !/^[!#$%&'*+.^_`|~a-zA-Z0-9-]+$/.test(name) || /[\x00-\x20\x7f;,]/.test(value)) continue;
      let path = requestUrl.pathname.slice(0, requestUrl.pathname.lastIndexOf('/')) || '/';
      let expires = Infinity, maxAge: number | undefined, allowed = true;
      for (const attribute of attributes) {
        const split = attribute.indexOf('=');
        const label = (split < 0 ? attribute : attribute.slice(0, split)).trim().toLowerCase();
        const content = split < 0 ? '' : attribute.slice(split + 1).trim();
        if (label === 'domain') {
          const domain = content.replace(/^\./, '').toLowerCase();
          if (![HOST, 'westports.com.my'].includes(domain)) allowed = false;
        }
        if (label === 'path' && content.startsWith('/')) path = content;
        if (label === 'max-age' && /^-?\d+$/.test(content)) maxAge = Number(content);
        if (label === 'expires' && Number.isFinite(Date.parse(content))) expires = Date.parse(content);
      }
      if (!allowed) continue;
      if (maxAge !== undefined) expires = this.now() + maxAge * 1000;
      const id = `${name}:${path}`;
      if (expires <= this.now()) this.cookies.delete(id);
      else this.cookies.set(id, { name, value, path, expires });
      if (this.cookies.size > 50) { this.clear(); throw new Error('Unexpected cookie count'); }
    }
  }
  header(url: URL) {
    if (url.protocol !== 'https:' || url.hostname !== HOST) throw new Error('Invalid Westports cookie destination');
    return [...this.cookies.entries()].filter(([id, cookie]) => {
      if (cookie.expires <= this.now()) { this.cookies.delete(id); return false; }
      return url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/');
    }).map(([, cookie]) => cookie).sort((a, b) => b.path.length - a.path.length).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }
}

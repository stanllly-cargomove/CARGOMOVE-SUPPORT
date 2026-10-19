import { Client } from 'basic-ftp';
import { Writable, Readable } from 'node:stream';
import { MAX_FILE, RecoveryError } from './format.js';
export function ftpConfig() {
  const env = process.env;
  if (!env.NORTHPORT_FTP_PASSWORD) throw new RecoveryError('Northport FTP password is not configured on the server.', 503);
  const mode = env.NORTHPORT_FTP_SECURE || 'true';
  if (!['true','false','implicit'].includes(mode)) throw new RecoveryError('Unsupported FTP TLS configuration.', 503);
  if (mode === 'false' && env.NORTHPORT_FTP_ALLOW_PLAINTEXT !== 'true') throw new RecoveryError('Plain FTP requires a documented security verification and NORTHPORT_FTP_ALLOW_PLAINTEXT=true.', 503);
  const base = env.NORTHPORT_FTP_BASE_DIR || '/ftp/CY/PROD/CONTAINERS';
  const success = env.NORTHPORT_FTP_SUCCESS_DIR || base + '/SUCCESS';
  if ([base,success].some(p => !p.startsWith('/') || /[\r\n\\]/.test(p) || p.split('/').includes('..')) || success.replace(/\/$/,'') !== base.replace(/\/$/,'') + '/SUCCESS') throw new RecoveryError('Configure an absolute incoming directory and its SUCCESS child.', 503);
  const port = Number(env.NORTHPORT_FTP_PORT || 21);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RecoveryError('Invalid FTP port configuration.', 503);
  return { base, success, access: { host: env.NORTHPORT_FTP_HOST || 'ftp.cargomove.my', port, user: env.NORTHPORT_FTP_USERNAME || 'northports', password: env.NORTHPORT_FTP_PASSWORD, secure: mode === 'implicit' ? 'implicit' as const : mode === 'true' } };
}
export async function withFtp<T>(operation: (client: Client, config: ReturnType<typeof ftpConfig>) => Promise<T>, signal?: AbortSignal, factory = () => new Client(10000, { maxListingBytes: 8 * 1024 * 1024, allowSeparateTransferHost: false })) {
  const config = ftpConfig(); const client = factory();
  const abort = () => client.close();
  const deadline = setTimeout(abort, 45000);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new RecoveryError('Search cancelled.', 499);
    await client.access(config.access); // Certificate verification stays enabled; never fall back from TLS.
    return await operation(client, config);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    const code = (error as any)?.code;
    throw new RecoveryError(code === 530 ? 'FTP login failed. Check server credentials.' : code === 550 ? 'FTP directory or file is not accessible. Verify account-root paths and permissions.' : 'FTP operation failed or timed out. Check TLS, passive connectivity and server access. An interrupted upload needs operator review before retrying.', 502);
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); client.close(); }
}
export async function download(client: Client, filename: string) {
  if (!/^CM_CONTAINER_\d{14}_(GP|EX)\.csv$/i.test(filename)) throw new RecoveryError('Invalid source filename.');
  let size = 0; const chunks: Buffer[] = [];
  await client.downloadTo(new Writable({ write(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > MAX_FILE) return callback(new RecoveryError('CSV exceeds the 2 MiB file limit.'));
    chunks.push(Buffer.from(chunk)); callback();
  } }), filename);
  if (size > MAX_FILE) throw new RecoveryError('CSV exceeds the 2 MiB file limit.');
  return Buffer.concat(chunks);
}
export async function safeUpload(client: Client, filename: string, id: string, bytes: Buffer) {
  if (!/^(?:CM_CONTAINER_\d{14}_(GP|EX)|REPROCESS_[A-Z0-9]{1,32})\.csv$/.test(filename) || !/^[a-f0-9-]{36}$/i.test(id)) throw new RecoveryError('Invalid recovery destination.');
  // This must also be verified on the real server: RNTO must refuse an existing target.
  const temporary = `.northport-${id}.part`;
  const files = await client.list();
  if (files.some(f => [filename.toLowerCase(),temporary.toLowerCase()].includes(f.name.toLowerCase()))) throw new RecoveryError('Recovery filename collision. No file was uploaded.',409);
  await client.uploadFrom(Readable.from(bytes), temporary);
  if (await client.size(temporary) !== bytes.length) throw new RecoveryError('Upload size verification failed. Operator review required.',502);
  if ((await client.list()).some(f => f.name.toLowerCase() === filename.toLowerCase())) throw new RecoveryError('Filename collision before rename. Temporary file requires operator review.',409);
  await client.rename(temporary, filename);
}

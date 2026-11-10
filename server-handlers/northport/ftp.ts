import { Client } from 'basic-ftp';
import { Writable, Readable } from 'node:stream';
import { filenameInfo, MAX_FILE, RecoveryError } from './format.js';
import { isMissingFile } from './scan.js';
export function ftpConfig() {
  const env = process.env;
  if (!env.NORTHPORT_FTP_PASSWORD) throw new RecoveryError('Northport FTP password is not configured on the server.', 503);
  const mode = env.NORTHPORT_FTP_SECURE || 'true';
  if (!['true','false','implicit'].includes(mode)) throw new RecoveryError('Unsupported FTP TLS configuration.', 503);
  if (mode === 'false' && env.NORTHPORT_FTP_ALLOW_PLAINTEXT !== 'true') throw new RecoveryError('Plain FTP requires a documented security verification and NORTHPORT_FTP_ALLOW_PLAINTEXT=true.', 503);
  const base = (env.NORTHPORT_FTP_BASE_DIR || '/ftp/CY/PROD/CONTAINERS').replace(/\/$/,'');
  const success = (env.NORTHPORT_FTP_SUCCESS_DIR || base + '/SUCCESS').replace(/\/$/,'');
  const archives = (env.NORTHPORT_FTP_SUCCESS_ARCHIVES_DIR || base + '/SUCCESS_ARCHIVES').replace(/\/$/,'');
  if ([base,success,archives].some(p => !p.startsWith('/') || /[\r\n\\]/.test(p) || p.split('/').includes('..')) || success !== base + '/SUCCESS' || archives !== base + '/SUCCESS_ARCHIVES') throw new RecoveryError('Configure an absolute incoming directory and its SUCCESS and SUCCESS_ARCHIVES children.', 503);
  const port = Number(env.NORTHPORT_FTP_PORT || 21);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RecoveryError('Invalid FTP port configuration.', 503);
  return { base, success, archives, access: { host: env.NORTHPORT_FTP_HOST || 'ftp.cargomove.my', port, user: env.NORTHPORT_FTP_USERNAME || 'northports', password: env.NORTHPORT_FTP_PASSWORD, secure: mode === 'implicit' ? 'implicit' as const : mode === 'true' } };
}
export type SourceDirectories = Pick<ReturnType<typeof ftpConfig>, 'success'|'archives'>;
// The worker can leave older files in SUCCESS. A filename date never proves
// that the file has moved to the archive.
export function sourceDirectory(config: SourceDirectories, _time?: number, _now?: number) {
  return config.success;
}
export function sourceDirectories(config: SourceDirectories, _time?: number, _now?: number) {
  return [config.success,config.archives];
}
export async function downloadSource(client: Client, config: SourceDirectories, filename: string) {
  const info = filenameInfo(filename);
  if (!info) throw new RecoveryError('Invalid source filename.');
  const [primary,fallback] = sourceDirectories(config,info.time);
  await client.cd(primary);
  try { return await download(client,filename); }
  catch (error) {
    if (!fallback || !isMissingFile(error)) throw error;
    await client.cd(fallback);
    return download(client,filename);
  }
}
export async function withFtp<T>(operation: (client: Client, config: ReturnType<typeof ftpConfig>, openSearchPeer: () => Promise<Client>) => Promise<T>, signal?: AbortSignal, factory = () => new Client(10000, { maxListingBytes: 8 * 1024 * 1024, allowSeparateTransferHost: false })) {
  const config = ftpConfig(); const client = factory();
  const clients = [client]; let peer: Promise<Client> | undefined; let stopped = false;
  const abort = () => { stopped = true; for (const connection of clients) connection.close(); };
  // Only searches request a second connection. Commands on each FTP connection
  // remain serial; basic-ftp rejects overlapping commands on a single client.
  const openSearchPeer = () => {
    if (stopped || signal?.aborted) return Promise.reject(new RecoveryError('Search cancelled or timed out.',499));
    return peer ??= (async () => {
      const connection = factory(); clients.push(connection);
      await connection.access(config.access);
      if (stopped || signal?.aborted) throw new RecoveryError('Search cancelled or timed out.',499);
      return connection;
    })();
  };
  const deadline = setTimeout(abort, 45000);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new RecoveryError('Search cancelled.', 499);
    await client.access(config.access); // Certificate verification stays enabled; never fall back from TLS.
    return await operation(client, config, openSearchPeer);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    const code = (error as any)?.code;
    throw new RecoveryError(code === 530 ? 'FTP login failed. Check server credentials.' : code === 550 ? 'FTP directory or file is not accessible. Verify account-root paths and permissions.' : 'FTP operation failed or timed out. Check TLS, passive connectivity and server access. An interrupted upload needs operator review before retrying.', 502);
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); abort(); }
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
export async function safeUpload(client: Client, filename: string, id: string, bytes: Buffer, reuseIdentical = false) {
  if (!/^(?:CM_CONTAINER_\d{14}_(GP|EX)|REPROCESS_[A-Z0-9]{1,32})\.csv$/.test(filename) || !/^[a-f0-9-]{36}$/i.test(id)) throw new RecoveryError('Invalid recovery destination.');
  // This must also be verified on the real server: RNTO must refuse an existing target.
  const temporary = `.northport-${id}.part`;
  const files = await client.list();
  const existing = files.find(f => f.name.toLowerCase() === filename.toLowerCase());
  if (reuseIdentical && existing) {
    // Explicit history retry: reconcile a previously completed rename without
    // overwriting the pending file or uploading a second copy.
    let size = 0; const chunks: Buffer[] = [];
    await client.downloadTo(new Writable({write(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > bytes.length) return callback(new RecoveryError('The pending recovery file differs from the saved approval. No file was overwritten.',409));
      chunks.push(Buffer.from(chunk));callback();
    }}), existing.name);
    if (!Buffer.concat(chunks).equals(bytes)) throw new RecoveryError('The pending recovery file differs from the saved approval. No file was overwritten.',409);
    return;
  }
  if (files.some(f => [filename.toLowerCase(),temporary.toLowerCase()].includes(f.name.toLowerCase()))) throw new RecoveryError('Recovery filename collision. No file was uploaded.',409);
  await client.uploadFrom(Readable.from(bytes), temporary);
  if (await client.size(temporary) !== bytes.length) throw new RecoveryError('Upload size verification failed. Operator review required.',502);
  if ((await client.list()).some(f => f.name.toLowerCase() === filename.toLowerCase())) throw new RecoveryError('Filename collision before rename. Temporary file requires operator review.',409);
  await client.rename(temporary, filename);
}

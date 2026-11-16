import type { Client } from 'basic-ftp';
import { filenameInfo, localTime, RecoveryError, type searchInput } from './format.js';
import { enterArchiveDirectory, isMissingDirectory, sourceDirectories, type SourceDirectories } from './ftp.js';
import { isMissingFile, probeFilenameBatch } from './scan.js';

export const PARTIAL_LISTING_WARNING = 'The FTP server has omitted existing files from date-filtered listings. These results may be incomplete. An empty result does not prove the container is absent. If you know the source filename, enter it to search that file directly.';
type Entry = { name: string; size: number; isFile: boolean };
type SearchFtp = Pick<Client,'list'|'size'|'cd'>;
export function listingMode() {
  const mode = process.env.NORTHPORT_FTP_LISTING_MODE || 'timestamp-scan';
  if (mode !== 'full' && mode !== 'date-pattern' && mode !== 'timestamp-scan') throw new RecoveryError('Invalid Northport listing mode. Use full, date-pattern or timestamp-scan.',503);
  return mode;
}
export function usesTimestampScan(filter: ReturnType<typeof searchInput>) {
  return !filter.sourceFilename && (filter.mode !== 'standard' || listingMode() === 'timestamp-scan');
}
// Search both folders concurrently when a second connection is available.
// SUCCESS takes precedence; serial callers retain archive fallback.
export async function searchSourceFiles(ftp: SearchFtp, config: SourceDirectories, filter: ReturnType<typeof searchInput>, options:{offset?:number;signal?:AbortSignal;now?:number;archiveFtp?:SearchFtp}={}) {
  const now = options.now ?? Date.now();
  const archiveFtp = options.archiveFtp;
  if (archiveFtp === ftp) throw new RecoveryError('Parallel searches require separate FTP connections.',503);
  const changeDirectory = async (connection:SearchFtp,directory:string,optionalArchive=false) => {
    if (options.signal?.aborted) throw new RecoveryError('Search cancelled.',499);
    try {
      if (optionalArchive) return await enterArchiveDirectory(connection,directory);
      await connection.cd(directory); return true;
    }
    catch (error) {
      if (options.signal?.aborted) throw new RecoveryError('Search cancelled.',499);
      if (error instanceof RecoveryError) throw error;
      // SUCCESS is required. Only an explicitly absent archive is optional.
      throw new RecoveryError('FTP source directory is not accessible. Verify account-root paths and permissions.',502);
    }
  };
  let archiveReady: Promise<boolean> | undefined;
  let archiveMissing = false;
  const archive = async () => {
    if (options.signal?.aborted) throw new RecoveryError('Search cancelled.',499);
    const available = await (archiveReady ??= changeDirectory(archiveFtp!,config.archives,true));
    return available ? archiveFtp! : null;
  };
  const listArchive = async (connection:SearchFtp,pattern?:string) => {
    try { return await connection.list(pattern); }
    catch (error) {
      // Clearance may remove the folder after its successful CWD.
      if (!isMissingDirectory(error)) throw error;
      archiveMissing = true; archiveReady = Promise.resolve(false);
      return [];
    }
  };
  let currentDirectory: string | undefined;
  const cd = async (directory: string) => {
    if (options.signal?.aborted) throw new RecoveryError('Search cancelled.',499);
    if (currentDirectory !== directory) { await changeDirectory(ftp,directory); currentDirectory = directory; }
  };
  return searchFiles({
    size: async filename => {
      const info = filenameInfo(filename);
      if (!info) throw new RecoveryError('Invalid source filename.');
      const [primary,fallback] = sourceDirectories(config,info.time,now);
      if (archiveFtp) {
        // Keep directory failures outside the missing-file handling below.
        const [,secondary] = await Promise.all([cd(primary),archive()]);
        const results = await Promise.allSettled([
          ftp.size(filename), ...(secondary ? [secondary.size(filename)] : [])
        ]);
        if (options.signal?.aborted) throw new RecoveryError('Search cancelled.',499);
        // Missing files are expected. A failed connection or denied directory
        // must still fail the search rather than claim complete coverage.
        for (const [index,result] of results.entries()) if (result.status === 'rejected' && !isMissingFile(result.reason) && !(index === 1 && isMissingDirectory(result.reason))) throw result.reason;
        for (const result of results) if (result.status === 'fulfilled') return result.value;
        throw (results[0] as PromiseRejectedResult).reason;
      }
      await cd(primary);
      try { return await ftp.size(filename); }
      catch (error) {
        if (!fallback || !isMissingFile(error)) throw error;
        if (options.signal?.aborted) throw new RecoveryError('Search cancelled.',499);
        // Absolute SIZE avoids switching directories twice for every missing
        // timestamp filename. The primary directory stays selected for the batch.
        try { return await ftp.size(`${fallback}/${filename}`); }
        catch (archiveError) { if (isMissingDirectory(archiveError)) throw error; throw archiveError; }
      }
    },
    list: async pattern => {
      const directories = sourceDirectories(config);
      const files: Awaited<ReturnType<Client['list']>> = [];
      const seen = new Set<string>(); let metadataEntries = 0;
      const listings = archiveFtp ? await Promise.all([
        (async () => { await cd(config.success); return ftp.list(pattern); })(),
        (async () => { const connection = await archive(); return connection ? listArchive(connection,pattern) : []; })()
      ]) : null;
      if (options.signal?.aborted) throw new RecoveryError('Search cancelled.',499);
      for (const directory of directories) {
        let entries: Awaited<ReturnType<Client['list']>>;
        if (listings) entries = listings[directory === config.success ? 0 : 1];
        else {
          if (directory === config.archives) {
            if (archiveMissing) continue;
            if (!await changeDirectory(ftp,directory,true)) { archiveMissing = true; continue; }
            currentDirectory = directory;
          } else await cd(directory);
          entries = directory === config.archives ? await listArchive(ftp,pattern) : await ftp.list(pattern);
        }
        const included = new Set<string>();
        metadataEntries += entries.length;
        if (metadataEntries > 20000) throw new RecoveryError('Directory metadata exceeds the 20,000-entry search budget. Use an exact filename or narrower dates.');
        for (const file of entries) {
          if (seen.has(file.name.toLowerCase())) continue;
          files.push(file);
          included.add(file.name.toLowerCase());
        }
        for (const name of included) seen.add(name);
      }
      return files;
    }
  },filter,options);
}
// Date patterns are a server-specific, explicitly incomplete discovery mode.
// Exact lookups bypass directory enumeration and do not assert whole-window coverage.
export async function searchFiles(ftp: Pick<Client,'list'|'size'>, filter: ReturnType<typeof searchInput>, options:{offset?:number;signal?:AbortSignal}={}) {
  if (filter.sourceFilename) {
    const size = await ftp.size(filter.sourceFilename);
    return { files: [{name:filter.sourceFilename,size,isFile:true}] as Entry[], scope:'file' as const, listingMode:'exact' as const, coverageWarning:null as string|null,scan:null };
  }
  if (usesTimestampScan(filter)) return probeFilenameBatch(ftp,filter,options.offset||0,options.signal);
  if (listingMode() === 'full') return {files:await ftp.list(),scope:'window' as const,listingMode:'full' as const,coverageWarning:null as string|null,scan:null};
  const files = new Map<string,Entry>();
  // Malaysia has no DST. Input bounds allow at most three calendar dates.
  const dates = new Set<string>();
  for (let ms = filter.start; ms <= filter.end; ms += 24*3600000) dates.add(localTime(ms).slice(0,10).replaceAll('-',''));
  dates.add(localTime(filter.end).slice(0,10).replaceAll('-',''));
  for (const date of dates) {
    // Numeric glob avoids assuming filename casing. Timestamp filtering still follows.
    const entries = await ftp.list(`*${date}*`);
    for (const entry of entries) files.set(entry.name,entry);
    if (files.size > 20000) throw new RecoveryError('Directory metadata exceeds the 20,000-entry search budget. Use an exact filename or narrower dates.');
  }
  return {files:[...files.values()],scope:'window' as const,listingMode:'date-pattern' as const,coverageWarning:PARTIAL_LISTING_WARNING,scan:null};
}

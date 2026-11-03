import type { Client } from 'basic-ftp';
import { filenameInfo, localTime, RecoveryError, type searchInput } from './format.js';
import { sourceDirectories, type SourceDirectories } from './ftp.js';
import { isMissingFile, probeFilenameBatch } from './scan.js';

export const PARTIAL_LISTING_WARNING = 'The FTP server has omitted existing files from date-filtered listings. These results may be incomplete. An empty result does not prove the container is absent. If you know the source filename, enter it to search that file directly.';
type Entry = { name: string; size: number; isFile: boolean };
export function listingMode() {
  const mode = process.env.NORTHPORT_FTP_LISTING_MODE || 'timestamp-scan';
  if (mode !== 'full' && mode !== 'date-pattern' && mode !== 'timestamp-scan') throw new RecoveryError('Invalid Northport listing mode. Use full, date-pattern or timestamp-scan.',503);
  return mode;
}
export function usesTimestampScan(filter: ReturnType<typeof searchInput>) {
  return !filter.sourceFilename && (filter.mode !== 'standard' || listingMode() === 'timestamp-scan');
}
// Keep the existing discovery modes and continuation offsets while routing each
// filename/date to the directory used by the external worker.
export async function searchSourceFiles(ftp: Pick<Client,'list'|'size'|'cd'>, config: SourceDirectories, filter: ReturnType<typeof searchInput>, options:{offset?:number;signal?:AbortSignal;now?:number}={}) {
  const now = options.now ?? Date.now();
  let currentDirectory: string | undefined;
  const cd = async (directory: string) => {
    if (options.signal?.aborted) throw new RecoveryError('Search cancelled.',499);
    if (currentDirectory !== directory) { await ftp.cd(directory); currentDirectory = directory; }
  };
  return searchFiles({
    size: async filename => {
      const info = filenameInfo(filename);
      if (!info) throw new RecoveryError('Invalid source filename.');
      const [primary,fallback] = sourceDirectories(config,info.time,now);
      await cd(primary);
      try { return await ftp.size(filename); }
      catch (error) {
        if (!fallback || !isMissingFile(error)) throw error;
        if (options.signal?.aborted) throw new RecoveryError('Search cancelled.',499);
        // Absolute SIZE avoids switching directories twice for every missing
        // timestamp filename. The primary directory stays selected for the batch.
        return ftp.size(`${fallback}/${filename}`);
      }
    },
    list: async pattern => {
      const directories = new Set<string>();
      // Date-pattern requests already identify one Malaysia calendar date.
      const date = pattern && /^\*(\d{8})\*$/.exec(pattern)?.[1];
      if (date) {
        const info = filenameInfo(`CM_CONTAINER_${date}000000_GP.csv`)!;
        for (const directory of sourceDirectories(config,info.time,now)) directories.add(directory);
      } else {
        // Read SUCCESS first when the range includes today, preferring its
        // metadata when the same filename temporarily exists in both folders.
        for (const time of [filter.end,filter.start]) for (const directory of sourceDirectories(config,time,now)) directories.add(directory);
      }
      const files: Awaited<ReturnType<Client['list']>> = [];
      const seen = new Set<string>(); let metadataEntries = 0;
      for (const directory of directories) {
        await cd(directory);
        const entries = await ftp.list(pattern);
        const included = new Set<string>();
        metadataEntries += entries.length;
        if (metadataEntries > 20000) throw new RecoveryError('Directory metadata exceeds the 20,000-entry search budget. Use an exact filename or narrower dates.');
        for (const file of entries) {
          const info = filenameInfo(file.name);
          if (info && !sourceDirectories(config,info.time,now).includes(directory)) continue;
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

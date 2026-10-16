import type { Client } from 'basic-ftp';
import { localTime, RecoveryError, type searchInput } from './format.js';
import { probeFilenameBatch } from './scan.js';

export const PARTIAL_LISTING_WARNING = 'The FTP server has omitted existing files from date-filtered listings. These results may be incomplete. An empty result does not prove the container is absent. If you know the source filename, enter it to search that file directly.';
type Entry = { name: string; size: number; isFile: boolean };
export function listingMode() {
  const mode = process.env.NORTHPORT_FTP_LISTING_MODE || 'timestamp-scan';
  if (mode !== 'full' && mode !== 'date-pattern' && mode !== 'timestamp-scan') throw new RecoveryError('Invalid Northport listing mode. Use full, date-pattern or timestamp-scan.',503);
  return mode;
}
// Date patterns are a server-specific, explicitly incomplete discovery mode.
// Exact lookups bypass directory enumeration and do not assert whole-window coverage.
export async function searchFiles(ftp: Pick<Client,'list'|'size'>, filter: ReturnType<typeof searchInput>, options:{offset?:number;signal?:AbortSignal}={}) {
  if (filter.sourceFilename) {
    const size = await ftp.size(filter.sourceFilename);
    return { files: [{name:filter.sourceFilename,size,isFile:true}] as Entry[], scope:'file' as const, listingMode:'exact' as const, coverageWarning:null as string|null,scan:null };
  }
  if (listingMode() === 'timestamp-scan') return probeFilenameBatch(ftp,filter,options.offset||0,options.signal);
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

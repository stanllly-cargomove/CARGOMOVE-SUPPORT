import systemVersions from '../generated/system-versions.json';
import type { VersionManifest } from '../../scripts/system-version';

export const SYSTEM_VERSIONS = systemVersions as VersionManifest;
export const GENERAL_VERSION = systemVersions.version;
export const AUTO_MAIL_VERSION = systemVersions.entries.find(entry => entry.id === 'auto-mail' && entry.kind === 'tool')?.version || GENERAL_VERSION;
// Every customer page uses the same General Version, including the Home hero.
export const PORTAL_VERSION = `V${GENERAL_VERSION}`;

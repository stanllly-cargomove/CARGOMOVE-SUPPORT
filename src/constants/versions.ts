import systemVersions from '../generated/system-versions.json';

export const SYSTEM_VERSIONS = systemVersions;
export const GENERAL_VERSION = systemVersions.version;
// Every customer page uses the same General Version, including the Home hero.
export const PORTAL_VERSION = `V${GENERAL_VERSION}`;

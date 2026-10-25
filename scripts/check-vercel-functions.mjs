import { readdir } from 'node:fs/promises';

async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async entry => {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) return sources(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  }));
  return paths.flat();
}

// Count even utility files conservatively so this check does not depend on
// underscore exclusions or handler-export detection. Run in the Vercel build.
const files = await sources(new URL('../api/', import.meta.url));
console.log(`[vercel-functions] ${files.length} API source files; Hobby maximum: 12.`);
if (files.length > 12) {
  throw new Error(`Consolidate API entry points before deploying:\n${files.map(file => file.pathname).join('\n')}`);
}

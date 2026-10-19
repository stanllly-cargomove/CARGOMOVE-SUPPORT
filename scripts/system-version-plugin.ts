import type { Plugin } from 'vite';
import { manifestPath, updateSystemVersion } from './system-version';

export function systemVersionPlugin(): Plugin {
  let root: string;
  return {
    name: 'system-version',
    configResolved(config) {
      root = config.root;
      updateSystemVersion(root);
    },
    configureServer(server) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const record = (file: string) => {
        const relative = file.replace(/\\/g, '/').replace(root.replace(/\\/g, '/') + '/', '');
        if (relative === manifestPath || relative.endsWith('.tmp') || !/^(src\/|api\/|server-handlers\/|media\/|supabase\/|index\.html$|package\.json$|server\.ts$)/.test(relative)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          try { updateSystemVersion(root); }
          catch (error) { server.config.logger.error(`Unable to update system version: ${error}`); }
        }, 750);
      };
      server.watcher.on('add', record).on('change', record).on('unlink', record);
      server.httpServer?.once('close', () => {
        clearTimeout(timer);
        server.watcher.off('add', record).off('change', record).off('unlink', record);
      });
    },
  };
}

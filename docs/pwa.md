CargoMove is installable as a standalone app from the deployed HTTPS site (or localhost for development checks). No database migration or backend change is required.

- Chrome/Edge: use the browser install icon or the **Install app** suggestion when the browser offers it.
- iPhone/iPad: open the site in Safari, use **Share → Add to Home Screen → Add**.
- Dismissing the suggestion hides it for the current tab session. Installed standalone windows hide it automatically.

Registration, tracking and admin functions require an internet connection. The service worker caches only `/offline.html`, never API responses, customer records, application HTML or downloads. Offline navigation displays a connection message, and **Try again** reloads the requested URL. It does not queue submissions.

Deploy the normal `npm run build` output with the included Vercel configuration. The manifest, worker, icons and offline document must be served as static files rather than rewritten to the SPA. `/sw.js` is revalidated; updates activate after existing app windows close, without interrupting forms. When changing the offline document, increment `CACHE_NAME` in `public/sw.js` so existing installations replace it.

Run `npm run lint` and `npm run test:pwa` to verify the production bundle, Chrome installability, icon dimensions, worker registration, installation action, offline fallback, API cache isolation and mobile installation guidance. The browser checks use locally installed Google Chrome and local API fixtures. iPhone guidance is checked with an emulated user agent; actual OS installation still needs a device check after deployment.

Icons are checked in. To recreate them from the existing CargoMove favicon with local Chrome installed, run `npm run generate:pwa-icons`.

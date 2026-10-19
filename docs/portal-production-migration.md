The public production app now opens the new home design and uses `/register`, `/track-status`, `/guideline`, and `/login`. Authenticated administrators use `/admin`. Vercel redirects the five former preview URLs to these routes, and serves the app for customer deep links while preserving API and asset routes. The guideline remains “Coming soon” by request.

The registration and login designs use the existing production services. A new read-only `/api/registration-config` route supplies active database ports and depots before the registration wizard opens. A failed configuration request shows a retry action instead of opening a form with invented facilities. Company lookup, submission, tracking, sessions and logout retain their existing API URLs. Registration test controls now require an explicit opt-in through Developer Settings.

Returning from review preserves driver, trailer and vehicle rows and driver mobile country codes. Submissions include only the selected asset category, and changing facility or company clears incompatible form data. Tracking from the success screen carries the saved reference number. Password recovery also responds to changes in the URL hash while the app is open.

The preview entry points and 52 unused preview PNGs were removed. The registration background moved into `media`. The old customer guideline component and tracking modal were retired. Public pages and the administrator interface load in separate JavaScript chunks.

Run verification with:

```sh
npm run lint
npm run test:portal
npm run test:portal:ui
npm run test:scheduler
npm run test:northport
npm run test:scheduler:ui
npm run test:northport:ui
```

The portal browser suite serves the built `dist` output and intercepts every API request. It covers navigation, refresh, browser history, responsive layouts, persisted themes, facility failures and retry, company lookup failures, tracking outcomes, multi-row asset registration, edit preservation, company registration at both facilities, Excel template download/import, consent, submission retry, login, administrator handoff, logout and expired password recovery links. It checks submitted company, account, facility and asset fields without writing production records or sending email.

Read-only checks against the configured live database on 19 October 2026 returned HTTP 200 for facility configuration (8 active ports and 2 active depots), a deliberately nonexistent company lookup, and a deliberately nonexistent registration reference. Successful production writes, actual email delivery and hosted Vercel routing still require a controlled deployment smoke test. No database migrations are needed for this UI migration.

The existing Northport browser suite has stale expectations unrelated to this migration: it mounts the component without the administrator toast provider and waits for an old connection message; later it targets a removed grid class. It currently fails before completing. The 31 Northport backend tests and the scheduler browser suite pass. The production Northport component is unchanged.

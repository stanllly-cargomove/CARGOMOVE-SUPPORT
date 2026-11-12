# Admin portal display size

The admin and developer portals use the full width of their main pane. Internal
form widths remain owned by the individual pages. The former shell-wide 1600px
content cap no longer leaves large margins on higher-resolution screens.

The header's **Display size** control defaults to **Auto**:

- Up to 1600 CSS pixels wide: 100%, retaining the existing laptop layout.
- Above 1600: a proportional increase, capped at 150% at 2400 pixels and wider.
- Manual choices: 100%, 115%, 125%, or 150%.
- Below 1280: always 100%, with the setting retained for returning to desktop.

Sizing uses the available browser viewport, not physical screen inches or device
pixel ratio. Operating-system and browser scaling already affect that viewport.
This prevents multiplying the size again merely because a display has higher DPI.
The setting is saved under `cargomove.admin.display-size` in this browser. Invalid
or unavailable storage falls back to Auto; storage failures do not block use.
Other tabs update through the browser storage event. Browser zoom is unchanged.

`useAdminDisplaySize` supplies `--admin-ui-scale` to `.admin-shell`. Native CSS
layout zoom scales existing pixel-based text, icons and controls together.
The shell also supplies logical viewport width/height variables for viewport-bound
sidebars, mailbox views and overlays. Native top-layer popovers convert measured
screen coordinates back to that logical viewport before positioning. New
viewport-bound admin components should use these variables with normal viewport
fallbacks, so they also work outside the shell.

Customer pages are outside `.admin-shell` and retain their original sizing.
Body-portaled elements also retain their own layout; their existing screen-space
anchor coordinates remain valid. No database or mailbox configuration is involved.

Offline verification:

- `npm run test:admin-display:ui`: real shell, preferences/reload, unavailable
  storage, DPI 1/2, responsive resizing, sidebar, real form/native dialogs,
  date-picker placement and mailbox height.
- `npm run test:np-query:ui`: the full fixture-only query flow from 320px to 2560px,
  including control scaling and full-width content.
- `npx tsx tests/queue-navigation-ui.ts`: existing offline large-queue navigation;
  set `ADMIN_DISPLAY_TEST_WIDTH=2560` to check the large-screen layout and footer.

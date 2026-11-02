# Changelog

All notable changes to BetterMyAdmin. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.26 (2026-11-02)

### Fixes

- ER diagram: Export as PNG failed on iPhone and iPad for a large database ("Error: png"). iOS
  Safari draws at most 16.7 million pixels on a canvas; the image is now sized for the device and,
  should a browser still refuse, made again smaller. If no size works the message says so and
  points to Export as SVG.

## 1.0.25 (2026-11-02)

### Fixes

- Phone layout: the SQL editor's text is 16px, so iOS Safari no longer zooms the page in when you
  tap it (the zoom pushed the editor past the screen and Go out of view). The on-screen keyboard
  is measured against the page's own height, which a zoom does not change.
- Phone layout: a cleaner top bar in every theme. It is one 52px row with the menu button centred.
  The breadcrumb no longer scrolls or cuts words: inside a database it shows the database, and on a
  table a two-line title (the database small above the table name); long names end in "…". The
  four page buttons (search, user, settings, top) are alike, borderless 40px buttons. The Native
  theme's capsule is padded.

## 1.0.24 (2026-11-02)

### Fixes

- Phone layout: the on-screen keyboard no longer covers Go, Save and the other buttons pinned to the
  bottom of the screen. The SQL page's Go bar, the cell editor and every other dialog, the
  confirmation sheet and the full-screen console move up above the keyboard while it is open
  (iOS Safari and Android Chrome lay the keyboard over the page; Android is also asked to resize
  the page instead).

## 1.0.23 (2026-11-02)

### New

- Phone layout: editing a cell is one tap. The value opens in a full-screen editor with a large
  text area (Enter makes a new line), the NULL box, date picker or value list below it, and
  Cancel / Save at the bottom. A long press still edits; desktop editing is unchanged.

### Fixes

- Phone layout with the Native theme: the open tab menu's items overlapped (Native's 22px desktop
  tab strip outranked the phone grid). The grid now keeps its own sizes in every theme.
- Phone layout: the Table structure / Relation view pills are 40px tall, in every theme.
- Phone layout: on the database and table Structure pages, the table name column that stays in view
  while the list scrolls sideways was see-through in the Native theme (its odd rows have no
  background), so checkboxes and action icons showed under the names. It is solid in every theme.

## 1.0.22 (2026-11-02)

### New

- **Phone layout.** Every page now fits a phone screen (767px wide or less); desktop is unchanged,
  checked pixel by pixel against the previous release on 27 pages.
  - The top bar is one line, with the breadcrumb scrolling sideways. The navigation panel is a
    drawer: the menu button, a swipe, Escape or a tap outside closes it, and so does picking a table.
  - The tab menu folds into a button naming the current tab. Dialogs and the command palette open
    full screen, and the console opens full screen from its strip.
  - Wide tables (browse results, structure, variables, processes, binlog and others) scroll in their
    own box rather than the page. User accounts are shown as cards, and privilege lists as rows.
  - SQL page: the Go button stays at the bottom of the screen while you write a query, and the
    delimiter and query options fold under an Options button.
  - Forms put labels above full-width fields. Touch targets are at least 40px, and fields use 16px
    text so iOS doesn't zoom in.
  - Status, monitor and dashboard charts stack in one column. The Designer pans in its own box, with
    pinch zoom and zoom buttons. The ER diagram fits the phone's screen on load.

## 1.0.21 (2026-11-01)

### Fixes

- Slow queries: times under a millisecond read "821.14 m ms". They now read "821.14 µs", and
  longer times read in ms or s.

## 1.0.20 (2026-11-01)

### New

These are BetterMyAdmin additions: phpMyAdmin has no equivalent, and its own pages are unchanged.

- **Query tabs on the SQL page.** Several queries side by side, each with its own results. Tabs
  can be renamed (double-click or F2) and closed (×, middle-click or Delete). Closing a tab with an
  unrun query asks first. Tabs and their queries are kept across reloads, per server, database or
  table. With a single tab the page looks as before, plus a "New tab" button. Shortcuts:
  Ctrl+Alt+T and Ctrl+Alt+W.
- **Command palette.** Ctrl+Shift+P (Cmd+Shift+P on macOS) or the search button in the top bar.
  It lists recent tables, the tabs of the current page, databases and tables (searched on the
  server for large servers), settings, themes, the console and log out. Typing `db.table`
  narrows the search to one database.
- **ER diagram.** A new Diagram tab for each database, after Designer. It lays out every table
  and view with its columns, and draws the foreign keys and the configuration storage's
  relations. You can pan and zoom, search, collapse tables, click through to a table's
  structure, export to SVG or PNG, and switch to a list view. It handles databases with 100+
  tables.
- **Live dashboard.** Status → Dashboard: live cards for queries per second, connections,
  threads, buffer pool hit rate and usage, traffic, slow queries, table locks, temporary tables on
  disk and replication lag. Cards turn yellow or red near limits. The refresh rate is 2 to 30
  seconds, and polling pauses while the browser tab is hidden.
- **Slow queries.** Status → Slow queries: the statements that cost the most time, from
  performance_schema's digests or the slow query log. Each shows its full formatted text and an
  example with real values, and runs EXPLAIN on demand; nothing else runs automatically. When a
  source is off, the page explains how to enable it.

## 1.0.19 (2026-10-31)

### Fixes

- The console strip at the bottom of the window no longer covers the end of the navigation
  panel. With a long list of databases, the last one was hidden under it. The console now starts
  after the panel and its resizer, as in phpMyAdmin, and follows when the panel is resized or
  collapsed.

## 1.0.18 (2026-10-30)

### New

- An agent API and an MCP endpoint for AI agents and scripts, which don't need the web interface.
  They're off until `AgentApi` is enabled.
  - `/api/agent/v1/servers/<n>/…` returns plain JSON: databases, tables, a table's description,
    query and explain.
  - `…/mcp` is a Model Context Protocol server with the same operations as tools, so agents such
    as Claude Code can connect with a URL and headers.
  - Every request carries its own credentials, with no session or CSRF token:
    - `config` servers use the configured user.
    - `cookie` and `http` servers take HTTP Basic credentials.
    - `signon` servers use the sign-on module's new `agentCredentials` export.
  - Each request passes the same login rules as a login (AllowDeny, AllowRoot, AllowNoPassword
    and the failed-login limiter), then runs with that MySQL user's privileges.
  - Requests from other websites are refused.
  - See "AI agents and scripts" in the documentation.

## 1.0.17 (2026-10-29)

### Upstream

- Synced to phpMyAdmin 6016908886 (2026-10-28).
- The Routines, Triggers and Events page titles always show both the icon and the text, as the
  other page titles do. They used to follow `ActionLinksMode`, so with icons only the title text
  disappeared.
- Translations: Spanish and Indonesian updates.

## 1.0.16 (2026-10-27)

### Upstream

- Synced to phpMyAdmin c7bb2a19e5 (2026-10-26).
- `AllowDeny` rules: IPv4 CIDR ranges now compare every bit of the address. The mask used to skip
  the most significant bit, so `allow % from 10.0.0.0/8` also matched `138.0.0.0/8`, and the
  `localhost` shortcut also matched `255.0.0.0/8`. Invalid addresses never match.
- Database structure, CSV size estimate: carriage returns in values are counted the same way as
  line feeds.
- PDF export: the structure table puts each optional column (Links to, Comments, Media type) under
  its own title. Without relations, the comments used to end up under the wrong title. The Media
  type column now needs the browser transformation feature.
- Events, routines and triggers: when a statement fails, the error shows the query and the server
  error on separate lines. Adding an item no longer inserts an extra blank line.
- Translations: Turkish, Ukrainian, Korean and French updates, and the strings from 1.0.6 are now
  in the catalogues.

## 1.0.15 (2026-10-26)

### Security

- Zod 3.24.4 → 4.6.6. This fixes GHSA-mrhx-c7xc-m3w5, where validating an oversized request could
  exhaust memory. `pnpm audit --prod` now reports no known vulnerabilities.

### Changes

- No behaviour change is intended. The request and response schemas and the configuration
  validation accept and produce the same values as before. A differential run checked this by
  parsing the same inputs with Zod 3 and Zod 4: 2,526 cases across all 421 API schemas, and 6,110
  cases covering every configuration directive with valid and invalid values. The places where
  Zod 4 changed the result have been adjusted to match Zod 3 and are pinned by tests: `.required()`
  with defaults, optional `unknown` fields, defaults that are parsed, and a configuration error
  that was reported twice.

## 1.0.14 (2026-10-26)

### Security

- DOMPurify 3.4.16 → 3.4.17, which fixes three advisories. BetterMyAdmin doesn't use the options
  they affect. The release is now past the 14-day minimum release age.

## 1.0.13 (2026-10-25)

### Fixes

- MariaDB: JSON columns read as `[object Object]`. mysql2 3.24 (updated in 1.0.5) parses JSON
  columns even with type casting off, so values reached BetterMyAdmin as objects instead of the text
  the server sent. This broke the user accounts list on MariaDB, where a locked account showed as
  unlocked because the lock flag lives in the JSON column `mysql.global_priv.Priv`. Connections now
  set `jsonStrings`, so JSON values come through as text.

## 1.0.12 (2026-10-24)

### Changes

- SQL history: deleting rows from a result records the DELETE statements, not the browse query
  shown again afterwards (X59, like saved edits in 1.0.11). The console shows them too.

## 1.0.11 (2026-10-24)

### Changes

- SQL history: saving a row (Edit, Copy or Insert opened from a result) now records the INSERT or
  UPDATE that ran, so the statement is still there after a reload. phpMyAdmin records the browse
  query it redisplays afterwards; this difference is listed in the parity exceptions register as
  X59.

## 1.0.10 (2026-10-24)

### Fixes

- Console: browsing a table, grid edits, insert/edit, row deletes and the other page actions show
  their statements in the console again, as phpMyAdmin's console does with every AJAX response's
  query. "Show current browsing query" still hides them. These statements were already saved to the
  SQL history, but they only appeared in the console after a page reload.

## 1.0.9 (2026-10-24)

### Features

- PDF export and the PDF relational schema, as phpMyAdmin offers them with TCPDF:
  - the "PDF" export format (report title, structure and/or data);
  - the Designer's "Export schema" to PDF (colours, keys only, same width, orientation, paper size,
    grid, and a data dictionary with contents, bookmarks and links).

  A new package, `packages/pdf`, ports the parts of TCPDF these use onto pdf-lib and embeds DejaVu
  Sans, so non-Latin text prints.
- Documentation site at https://cb-sigma.github.io/better-myadmin/: phpMyAdmin's manual adapted to
  BetterMyAdmin, with the same sections and anchors. Every help link in the app points there.
- `bettermyadmin import-pma-config config.inc.php [-o file] [--force]` converts a phpMyAdmin
  configuration file to a BetterMyAdmin JSON file. The PHP is read, not run, and the result is
  validated.
- `SessionStore: 'redis'` (with `RedisUrl`) now works, so several instances can share their sessions.
  An unreachable Redis server or a wrong password stops the server at startup.
- Docker: every phpMyAdmin image variable has a `BMA_` name: `BMA_HOST`, `BMA_HOST_LABEL` (was
  `PMA_VERBOSE`), `BMA_STORAGE_DB` (was `PMA_PMADB`), `BMA_LISTEN_PORT` (was `APACHE_PORT`) and so on.
  Both names work, and the `BMA_` name wins when both are set. The full table is in the
  [docs](https://cb-sigma.github.io/better-myadmin/setup.html#docker-vars).
- Try it in a browser: an "Open in GitHub Codespaces" button starts the released image with a demo
  database (`.devcontainer`).
- PHP-only features are replaced (parity exception X57):
  - "Create PHP code" is now "Create JS code" (the query as JavaScript string literals);
  - the "PHP array" export is now a "JavaScript module" export;
  - "Save as PHP file" is removed from Settings › Export;
  - the product is called BetterMyAdmin throughout the UI.

### Fixes

- SQL history: every statement phpMyAdmin records is now recorded, not only queries from the SQL box.
  That covers table and column changes, inserts and edits, grid saves, operations, privileges and
  exports.
- `blowfish_secret`: no "longer than necessary" warning (X58). BetterMyAdmin derives its keys from
  the secret, so a longer secret is fine.
- Navigation tree: the fast filter box no longer overlaps the tree lines.
- Grid editor: the date and time picker keeps the UI font and its own styling, and the editing
  frame widens to show it.

## 1.0.8 (2026-10-24)

### Features

- Two new optional themes (parity exception X56), each with light and dark modes; pmahomme stays the
  default:
  - **Classic**: pmahomme refreshed in the style of GitHub's Primer. A navy breadcrumb bar, folder
    tabs joined to the page with a blue top accent, boxes with a light grey header, framed tables with
    row lines, flat buttons and 4px corners. Its dark mode is true black (AMOLED) with steel-blue
    accents.
  - **Native**: the look of a native database client such as TablePlus. System font, a centred
    breadcrumb capsule, segmented tabs, a compact monospace grid with quiet zebra rows, coloured tree
    icons and macOS-style push buttons. Its dark mode is true black (AMOLED) too.
- Modern theme: tighter spacing (22px tree rows, compact tabs, cards and tables), crisper 4-6px
  corners and lighter shadows, monospace grid data, a true-black (AMOLED) dark mode, and a muted
  slate blue in place of the bright link blue.

### Fixes

- Navigation tree: the connector lines and the +/− expand boxes of phpMyAdmin's tree are back in
  pmahomme, original, metro and bootstrap (and classic); they had been replaced by chevrons when the
  tree became a virtualized list. Modern keeps its chevrons and gains indent guides; native keeps
  plain chevrons.
- Grid editing in a short result (one row): the cell editor reached past the bottom of the table's
  scrolling frame, so its NULL checkbox and hint were cut off, and typing scrolled the frame so the
  sticky header slid over the row. The frame now grows to fit the editor.

## 1.0.7 (2026-10-24)

### Fixes

- Results grid: an empty box at the end of every table's header row. phpMyAdmin puts an empty
  header cell there (no body cell below it) that its themes draw invisibly; it now takes no room.
- The full / partial texts toggle in the grid's top-left corner shows its name ("Full texts" /
  "Partial texts") on hover, as in phpMyAdmin.

## 1.0.6 (2026-10-24)

### Upstream

- Synced to phpMyAdmin 6eba7ba9ad (2026-10-23).
- Hardcoded UI strings are translatable: multi-table query messages and labels, the index column
  count check, normalization placeholders, the zoom search help title, the database search
  caption; the copy failure alert is "Copying failed!" and the export privileges dialog opens
  titled "Loading…". Translations follow with phpMyAdmin's next catalogue update.
- `uca1400` collations (MariaDB's default) are described as "UCA 14.0.0" instead of "UCA 4.0.0".
- New translations (Hebrew, Turkish, Dutch, Ukrainian, Indonesian).

## 1.0.5 (2026-10-23)

### Security

- Node.js 22.23.4 in the Docker image and CI (the 2026-10-21 security release: Brotli decoder
  out-of-bounds write reachable through `fetch()`, TLS hostname-check bypasses, and more).
- Dependencies with known advisories updated within their major versions: hono 4.13.13,
  @hono/node-server 1.19.17, mysql2 3.24.5, dompurify 3.4.16, @xmldom/xmldom 0.8.15, yaml 2.9.1.
  Three DOMPurify advisories fixed in 3.4.17 remain (`SAFE_FOR_TEMPLATES`, `IN_PLACE` hooks,
  `PARSER_MEDIA_TYPE`: options BetterMyAdmin does not use); 3.4.17 is taken once it passes the
  14-day minimum release age.

### Fixes

- Modern theme, dark mode: the options of an open drop-down were unreadable (#1).

## 1.0.4 (2026-10-23)

### Fixes

- phpMyAdmin addresses (bookmarks, links): `index.php`, `index.php?route=/database/structure&db=…`
  and phpMyAdmin 4's `db_structure.php`, `tbl_sql.php`, `server_status.php`, … were treated as
  static files, so a `signon` or `http` server never authenticated the page load and users ended
  on "Cannot log in to the database server." They now redirect to the BetterMyAdmin page they
  name (or the home page).
- A page whose last path segment has a dot (a table named `logs.2024`) was also treated as a
  static file on a direct load; every page under `/s/` now goes through authentication.

### Features

- `SignonPage` modules get `returnTo`: the page the user asked for before being sent to the
  signon page (a path on this host, else `/`), so a signed-on user lands there instead of on the
  home page.

## 1.0.3 (2026-10-23)

### Fixes

- SQL editor in dark colour modes (every theme): keywords, strings and other tokens used the light
  palette (#708 on near-black), the caret was black and the selection light grey. The editor now
  colours tokens with the theme's SQL colours, as the highlighted query results already did, and
  draws the caret and the selection in the theme's colours; it follows a colour-mode change while open.

## 1.0.2 (2026-10-23)

### Fixes

- A user named by an email (`'name@company.com'@'%'`, as single sign-on creates) lost the
  Triggers and Events tabs and other privilege-dependent features: `CURRENT_USER()` was split at
  its first `@`. It is split at the last one now, as are the definers of routines, triggers and
  events, which were saved naming another account. Parity exception X55.
- Editing a routine, trigger or event whose definition has Windows line endings (`\r\n`) failed
  with "A fatal JavaScript error has occurred. Selection points outside of document" once the SQL
  editor had been opened earlier in the session.

## 1.0.1 (2026-10-23)

### Features

- `SignonPage` (server setting, BetterMyAdmin only): a signon server's login page can be a
  JavaScript module that BetterMyAdmin serves itself at `SignonURL`, on its own port, the way a
  phpMyAdmin signon page is a PHP file next to phpMyAdmin. The module gets the request and helpers
  to read and write the `SignonSession` cookie; `apps/server/examples/signon-page.mjs` is the
  example. Parity exception X54.

## 1.0.0 (2026-10-21)

The first release: a feature-for-feature TypeScript / React port of phpMyAdmin 6.0.0-dev
(reference commit in `docs/reference/reference-commit.txt`), served by one Node.js process.

### Features

- Every phpMyAdmin 6.0 feature area: server, database and table pages, browse grid with inline
  editing, sorting, foreign-key links and transformations, insert / edit, structure, indexes,
  partitions, relations, search / zoom / find-and-replace, query by example, designer, routines,
  events, triggers, tracking, central columns, normalization, charts, GIS, export and import in all
  phpMyAdmin formats, user accounts and privileges, status / monitor / advisor, replication, binary
  log, variables, settings and preferences, two-factor authentication, the setup script, the SQL
  editor and console.
- Parity is measured, not claimed: routes, template controls, config directives, messages and JS
  behaviours are all mapped (100%), the 707-item feature checklist is covered, and golden tests
  compare pages and outputs against a running phpMyAdmin on MySQL 8.0 / 8.4 and MariaDB 10.11 / 11.4.
  Intentional differences are listed in `docs/reference/parity-exceptions.md`.
- phpMyAdmin's four themes (pmahomme, original, metro, bootstrap), each with a dark variant, plus an
  optional `modern` theme in the style of shadcn/ui. pmahomme is the default.
- Docker image configured by the official phpMyAdmin image's variables (`PMA_HOST`, `PMA_ARBITRARY`,
  `PMA_USER`, …) and `BMA__<Directive>` overrides; `docker compose up` brings up a demo with MySQL.
- Upstream phpMyAdmin is tracked daily, with a recorded decision for every upstream commit.

### Fixes in the final pre-release pass

- Sidebar links: the Tables "New" item, a table's Columns "New" and Insert, and column entries
  opened the not-found page or an empty Change form.
- Layout: width utilities on `.input` controls were ignored; Radix's hidden checkbox inputs widened
  pages; the browse pager broke labels over lines; short grid values wrapped; the collapsed
  sidebar's button covered the breadcrumb; message cards had an empty strip; the partition editor's
  brackets sat above and below the expression input.
- SQL editor: an autocompletion list that arrived after the editor lost focus stayed open.
- Dark mode: SQL highlighting follows the app's colour mode.
- Accessibility: names for row checkboxes, function and value controls, query-by-example selects,
  GIS controls and other unnamed controls; pmahomme's card captions keep their legibility shadows.

### Known limitations

- Not yet independently security-audited. Do not expose the server publicly without a
  configuration file and TLS (see `docs/architecture/07-security.md`).

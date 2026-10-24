# Changelog

All notable changes to BetterMyAdmin. Versions follow [Semantic Versioning](https://semver.org/).

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

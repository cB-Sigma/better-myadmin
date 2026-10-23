# Changelog

All notable changes to BetterMyAdmin. Versions follow [Semantic Versioning](https://semver.org/).

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

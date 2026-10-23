# Changelog

All notable changes to BetterMyAdmin. Versions follow [Semantic Versioning](https://semver.org/).

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

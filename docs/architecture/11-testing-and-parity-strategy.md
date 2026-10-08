# Testing and parity strategy

"Exact clone" is testable. This document defines how we prove parity with phpMyAdmin, how we test the clone on its own, and what "done" means for a feature.

## Definition of done for a feature area

A feature area (one `docs/features/*.md` file) is done when:

1. Every item in its **Micro-behaviours checklist** is either checked with a linked test, or explicitly marked `n/a` with a reason recorded in the doc (e.g. phpMyAdmin behaviour that is a bug, or PHP-specific).
2. Every config directive the doc lists is implemented and covered by at least one test that flips it.
3. Generated SQL for every action in the area passes the **golden SQL** comparison against phpMyAdmin.
4. The e2e **parity script** for the area runs green against the MySQL/MariaDB matrix.
5. axe passes, keyboard path passes, performance budget for its pages passes.
6. The strings parity check passes (no new msgids without annotation).

## Test layers

```mermaid
flowchart TB
  U[Unit (Vitest)<br/>sql-lexer · sql-gen · mysql-types · metadata · export/import plugins · format helpers] --> C[Contract (Vitest)<br/>Zod schemas · route registry rules (GET side-effect free, token required)]
  C --> I[Integration (Vitest + testcontainers)<br/>API against real MySQL 5.7/8.0/8.4 · MariaDB 10.6/10.11/11.x]
  I --> G[Golden parity<br/>same action in pMA and BMA → diff SQL from general_log, diff export files]
  G --> E[E2E (Playwright)<br/>feature scripts · keyboard-only · perf · axe]
```

### Unit

- **`sql-lexer`**: token streams compared with fixtures generated from `phpmyadmin/sql-parser`'s own test suite (`tests/data/lexer/*.in`/`*.out`, ~400 cases) exported to JSON. The classifier is tested against `tests/data/parser/*` statement lists for `kind`, `hasLimit`, `hasUnion`, `isAffected`, etc.
- **`sql-gen`**: every builder has fixtures with input → expected statements. Fixtures start as the phpMyAdmin PHPUnit expectations (`TableTest`, `CreateAddFieldTest`, `InsertEditTest`, `OperationsTest`, `IndexTest`, `RelationTest`, `ExportSqlTest`...) converted to JSON by a one-time script, then grow with our own cases. The `where.ts` unique-condition builder is tested against `UtilTest::testGetUniqueCondition` cases plus float/binary/bit/geometry edge cases.
- **`mysql-types`**: the type catalog, attribute rules and function lists compared with `TypesTest` and `UtilTest` expectations per server version.
- **export/import plugins**: each plugin's `header/structure/data/footer` output for the `sakila` schema is compared byte-for-byte with phpMyAdmin's output for the same options (see golden below). Import parsers are tested on the phpMyAdmin `tests/test_data/*` files (CSV, ODS, XML, MediaWiki, SHP, SQL dumps).
- **format helpers**: `formatNumber`, `formatByteDown`, `timespanFormat`, `localisedDate` vs phpMyAdmin test tables.

### Contract

- All Zod request/response schemas round-trip sample payloads.
- Route registry assertions: every non-GET route declares `mutation: true` and requires the CSRF token; GET handlers are wrapped in a guard that throws if `connection.query` is called with a non-read statement during tests (checked by classifying the SQL with our lexer).
- The `/api/meta/config-public` allow-list is asserted to exclude every directive tagged `secret`.

### Integration

- `testcontainers` spins MySQL 5.7, 8.0, 8.4 and MariaDB 10.6, 10.11, 11.4 (matrix in CI; developers run one locally). Fixtures: `sakila`, `world`, and `pma-edge` (our schema with every type, FKs across databases, tables without unique keys, tables with only a unique nullable key, views, partitioned tables, triggers, routines, events, geometry, JSON, invisible columns on 8.0.23+, generated columns, BIT, ENUM/SET with commas and quotes in values, names with backticks, spaces and unicode, 300-column table, 1M-row table).
- Tests hit the Hono app in-process with a real pool. Assertions cover behaviour and the exact SQL executed (captured via a test-only hook on `connection.query`).

### Golden parity against phpMyAdmin

The core "exact clone" proof.

1. Docker compose brings up MySQL with `general_log=ON, log_output=TABLE`, a phpMyAdmin container (pinned to the reference commit), and BetterMyAdmin.
2. A **parity script** per feature area (`tests/parity/<area>.ts`) performs the same user action in both tools through Playwright (phpMyAdmin via its UI; BetterMyAdmin via its UI), e.g. "add a VARCHAR(100) NOT NULL DEFAULT 'x' column after `name` with comment and index".
3. After each action we read `mysql.general_log` for each tool's connection id, normalise (strip comments like `/* pma */`, whitespace, our tool-identifying header), and **diff the SQL statements**. Differences fail the test unless listed in `tests/parity/allowed-diffs.yaml` with a justification (e.g. we use `information_schema` where phpMyAdmin used `SHOW`, which is a *read* difference and allowed; a *write* difference is never allowed).
4. For exports, both tools export the same objects with the same options and the files are diffed after stripping the header lines that name the tool, version and timestamp. Must be identical for SQL, CSV, JSON, XML, YAML, LaTeX, MediaWiki, PHP array, Texy; ODS/ODT/PDF/Excel are compared after extraction (XML content for ODS/ODT, text for PDF) because binary containers include timestamps.
5. For imports, the same file imported by both must leave identical table contents (`CHECKSUM TABLE` + row dumps).
6. Where the behaviour under test depends on directives (paging sizes, `DisableIS`, `hide_db`, grouping…), the suite starts a private phpMyAdmin from the same sources (`tests/parity/lib/pma-shadow.ts`: symlinked tree, its own `config.inc.php` including the reference one plus per-case overrides, `php -S` on its own port) and gives BetterMyAdmin the same directives. HTML responses are normalised into the same structure as BetterMyAdmin's JSON (e.g. `tests/parity/lib/nav-html.ts` for the navigation tree) and compared with `toEqual`. Suites can add or exclude allowances (`compareLogs(…, {extra, exclude})`) when a statement the global list tolerates is the one under test.
7. For metadata writes (pmadb), after the same action in both, the pmadb tables are dumped and diffed (e.g. `table_uiprefs.prefs` JSON after hiding a column and sorting).

### E2E (Playwright)

- One spec file per feature doc section. Each `- [ ]` checklist item maps to a `test()` whose title is the checklist text, and a script turns the test results back into a checked checklist in the doc (`pnpm parity:report` rewrites the `- [ ]`/`- [x]` markers and appends the test id). The doc is the dashboard.
- Keyboard-only suite, axe suite, perf suite ([Performance](08-performance-and-snappiness.md)).
- Visual regression (Playwright screenshots) for the four themes × light/dark on 12 key pages, with a 0.1% pixel threshold.

## Fixtures and data

- `packages/testing/fixtures/sql/`: `sakila`, `world`, `pma-edge` schemas and seeds.
- `packages/testing/fixtures/pmadb/`: `create_tables.sql` from phpMyAdmin plus seeded rows (relations, display fields, bookmarks, a tracked table with history, designer coordinates, central columns, export templates, user groups) so features gated by pmadb are exercised.
- `packages/testing/fixtures/golden/`: expected SQL and export outputs, regenerated by `pnpm golden:refresh` (which runs phpMyAdmin in Docker; the refreshed files are reviewed in the PR diff).

## Tooling

- Vitest workspaces for unit/contract/integration; `--coverage` thresholds 90% lines for `sql-gen`, `sql-lexer`, `mysql-types`, `metadata`, `export`, `import`.
- Playwright with sharding in CI; traces on failure uploaded as artifacts.
- `pnpm test` runs unit + contract; `pnpm test:int` integration (needs Docker); `pnpm test:parity` golden parity; `pnpm test:e2e`.
- Mutation testing (Stryker) on `sql-gen` and `where.ts` monthly, mirroring phpMyAdmin's use of Infection.

## Parity exceptions register

Known intentional differences live in `docs/reference/parity-exceptions.md` (one line each: what differs, why, link to the decision). Examples already identified by the feature audits:

- phpMyAdmin stores the encrypted password in the cookie; we store it server-side (security).
- Export of CSV formula-escaping is available as an opt-in (security), default output identical.
- `Text_Plain_External` transformation cannot execute shell programs; replaced by allow-listed in-process formatters.
- `RecodingEngine=recode` is not supported; `iconv` and `mb` semantics are emulated with `iconv-lite`.
- phpMyAdmin master's `/database/qbe` classic QBE page is removed upstream; we implement the current multi-table query builder only (noted by the database-level audit).
- The `~` approximate row-count marker and "exact count" link are absent in current master's Browse header; we follow master (noted by the browse audit) and keep the approximation policy (`MaxExactCount`) itself.
- No SQL-editor fullscreen toggle exists in master (only the Designer has one); we do not add one to the SQL tab by default.

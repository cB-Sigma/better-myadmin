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

- One spec file per feature doc section. Each `- [ ]` checklist item maps to a `test()` whose title contains the item's id (`p01-3f9a2c`, see below) or is the checklist text, and a script turns the test results back into a checked checklist in the doc (`pnpm parity:report` rewrites the `- [ ]`/`- [x]` markers and appends the test reference). The doc is the dashboard.
- **UI structure parity** (`tests/ui-parity`, `pnpm test:ui-parity`): every page a feature adds needs a `pageParity` case; differences are fixed or mapped with a parity-exception id. A case opens the page in the reference phpMyAdmin and in BetterMyAdmin (each logged in with its own MySQL account), captures the visible interactive controls of both (kind, accessible label, type, value, select options, checked/disabled/required state, section = nearest legend / card header / heading, order within the section), diffs them, then performs the case's interactions in both apps (by accessible name, or per-app code) and diffs again after each step, so dynamic show/hide behaviour is compared too. Unmapped differences fail the case; intentional ones go in `tests/ui-parity/maps/<case>.yaml` (renames need an exception id from the register, `n/a`/`added` need a reason). Screenshots of both apps per step land in `.data/ui-parity/index.html` (review aid, not a gate). A case with differences still to fix carries `known: 'TODO …'` (`test.fail`). See [tests/ui-parity/README.md](../../tests/ui-parity/README.md).
- Keyboard-only suite, axe suite, perf suite ([Performance](08-performance-and-snappiness.md)).
- Visual regression (Playwright screenshots) for the four themes × light/dark on 12 key pages, with a 0.1% pixel threshold.

## Mechanical inventories and the parity gate

The checklists are written by people; `tools/parity` makes sure nothing phpMyAdmin has slips through them. It extracts inventories from the reference checkout, maps each item to what replaces it, computes coverage and gates CI on a ratchet. Reports: [docs/reference/coverage](../reference/coverage/README.md).

| Inventory | Extracted from (by executing or parsing phpMyAdmin itself) | Implemented when |
|---|---|---|
| Routes (`inventory/routes.json`) | `Routes::collect` run against a recording FastRoute collector (`php/routes.php`), plus the setup script's dispatcher | every target in `map/routes.yaml` exists: Hono registrations under `apps/server/src` (mounts followed through imports) and TanStack file routes under `apps/web/src/routes` (catch-alls and routes rendering `NotImplemented` do not count) |
| Template controls (`inventory/controls.json`) | every Twig template's inputs, selects (static options), textareas, buttons, submit labels, translated action links, radio/checkbox groups; `link_or_button()`; PHP helpers `Generator::getNavigationLink`, `Util::pageselector` (`php/helpers.php`) | a component claims it (`pma-controls.ts` or `data-pma`, see [conventions](12-project-structure-and-conventions.md#parity-markers)) and the claimed file still shows it |
| Config directives (`inventory/directives.json`) | the `packages/config` schema, cross-checked with phpMyAdmin's `Settings::asArray()` dump | code outside `packages/config` reads it (`cfg.MaxRows`, `server.DisableIS`, destructuring, `'Export/csv_columns'`) |
| Messages (`inventory/messages.json`) | `phpmyadmin.pot` ∪ uses found with Twig's own parser (`t()` nodes), PHP tokens (`__()`, `_ngettext()`, `_pgettext()`) and `window.Messages` keys in `resources/js` (`php/messages.php`) | our code translates the msgid (same calls as `pnpm i18n:parity`, plus msgid constants) |
| JS behaviours (`inventory/js.json`) | `resources/js/**/*.ts` parsed with TypeScript: jQuery/DOM event bindings (`.on('evt', selector)`, shorthands with a handler, `addEventListener`) with the keys keyboard handlers compare, `confirm()`/`alert()`/`.confirm()` with their `window.Messages` keys, AJAX calls (`$.post`/`$.get`/`$.ajax`/`.load`/`fetch`) with their routes, CodeMirror `extraKeys` and commands; key `js:<script>#<event>:<selector>` etc. | a component claims it (`js:` keys in `pma-controls.ts`, optionally with `match`) and the claimed file still exists / contains the match |
| Checklist items (`map/checklist-ids.json`) | every `- [ ]`/`- [x]` of `docs/features/*.md`, with a stable id minted from file + section + text and kept across edits | a linked test passes |

Items that will not be implemented as phpMyAdmin has them carry a disposition in `tools/parity/map/*.yaml`: `planned: M<n>`, `exception: X<n>` (must exist in [parity exceptions](../reference/parity-exceptions.md)) or `n/a: reason`; a checklist item uses `<!-- parity:n/a: reason -->`. Covered = implemented + exception + n/a. Every item is attributed to a feature area through `map/areas.yaml` (pma path prefix → `docs/features` number). Unused msgids grouped by the templates and PHP files that use them are the "likely missing features" list.

Commands:

- `pnpm parity:inventory` regenerates the inventories (needs PHP and the checkout at `reference-commit.txt`; `PMA_PATH` overrides `/home/user/ref/pma`).
- `pnpm parity:report [--run[=unit,int,parity,playwright-web,playwright-e2e|all]]` runs the chosen suites with their JSON reporters (results in `.data/parity-results/`, default `--run` = unit), assigns checklist ids, rewrites the checklist markers from the results (a suite that was not run leaves its items' markers alone; a failing linked test unticks), and writes the coverage reports and `docs/reference/pma-route-map.md`.
- `pnpm parity:check` is the gate (CI job `parity-gate`): it fails when an item the baseline had implemented or covered regresses (unmapped, target removed, claim broken, test unlinked), a map or claim points at something that does not exist, a covered/implemented count or a coverage ratio drops, the inventories were extracted from another commit (or, where the checkout exists, a fresh extraction differs), a map names an unknown exception or milestone, or `pma-route-map.md` is stale. It needs neither PHP nor a database; checklist status comes from the committed markers plus the statically found test links.
- `pnpm parity:baseline` records the current numbers and item keys in `tools/parity/baseline.json`. Run it when coverage went up; CI never runs it.

## Fixtures and data

- `packages/testing/fixtures/sql/`: `sakila`, `world`, `pma-edge` schemas and seeds.
- `packages/testing/fixtures/pmadb/`: `create_tables.sql` from phpMyAdmin plus seeded rows (relations, display fields, bookmarks, a tracked table with history, designer coordinates, central columns, export templates, user groups) so features gated by pmadb are exercised.
- `packages/testing/fixtures/golden/`: expected SQL and export outputs, regenerated by `pnpm golden:refresh` (which runs phpMyAdmin in Docker; the refreshed files are reviewed in the PR diff).

## Tooling

- Vitest workspaces for unit/contract/integration; `--coverage` thresholds 90% lines for `sql-gen`, `sql-lexer`, `mysql-types`, `metadata`, `export`, `import`.
- Playwright with sharding in CI; traces on failure uploaded as artifacts.
- `pnpm test` runs unit + contract; `pnpm test:int` integration (needs Docker); `pnpm test:parity` golden parity; `pnpm test:e2e`; `pnpm test:ui-parity` UI structure parity (needs the reference phpMyAdmin).
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

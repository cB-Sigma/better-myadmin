# Roadmap and milestones

The order is chosen so that each milestone is usable on its own, the riskiest shared pieces (lexer, SQL generation, grid, metadata) land first, and parity testing exists before the bulk of the UI is written. Sizes are rough relative weights, not promises.

## M0: Foundations (weight 8)

- Monorepo, CI (lint, typecheck, unit, contract), Docker dev compose with MySQL 8.4 + MariaDB 11 + reference phpMyAdmin.
- `packages/config`: full directive schema with defaults ([reference](../reference/config-directives.md)), file + env loader, `bma import-pma-config`.
- `packages/sql-lexer`: lexer + contexts + classifier with phpMyAdmin fixtures.
- `packages/sql-gen`: quoting, `where.ts` unique conditions, basic `ALTER/CREATE` builders.
- `packages/mysql-types`: type catalog.
- `packages/metadata`: pmadb discovery (`*work` flags), relation/display-field/column_info readers, SQLite fallback driver.
- Server skeleton: config, sessions, cookie auth (no 2FA yet), pool manager, `/query` pipeline (LIMIT, count policy, metadata enrichment), error envelope, CSRF, headers.
- Web skeleton: router, query client, shell layout (empty panels), theme tokens, i18n import of English + 3 locales, dense shadcn preset.
- Golden parity harness: general-log capture, diff tool, allowed-diffs file, first 10 golden cases (create table, add column, browse).

Exit: `bma` starts, you can log in, run a query in a bare SQL box, see rows in an unstyled virtualized grid, and the parity harness runs in CI.

## M1: Navigate and browse (weight 10)

Feature docs: [Shell, navigation, auth](../features/01-shell-navigation-auth.md), [Browse grid](../features/02-browse-results-grid.md), [SQL editor and pipeline](../features/09-sql-editor-query-pipeline.md).

- Navigation tree complete (grouping, paging, filters, lazy containers, favorites, recent, hide/unhide, link with main panel, resize, reload, server selector).
- Top bar, breadcrumbs, tab bars with visibility rules and overflow, page title templates, messages/toasts, confirm dialogs, doc links, keyboard shortcuts, console (all five tabs).
- Browse grid: every item in its checklist, including grid editing, FK traversal, uiprefs persistence, options panel, pagination, sort/multi-sort, selection and "With selected", delete confirmation, print, copy, export link-out, bookmark-this-query, chart link-out (chart itself in M3).
- SQL tab: editor, autocomplete, lint, format, snippets, bind params, delimiter, FK checks, rollback, bookmarks, history, profiling, explain, simulate DML, inline edit, multi-statement, signed URLs, cancel.
- Home page with all blocks and warnings. Login page, logout, session expiry, `LoginCookieRecall`.
- Themes page with four themes + dark; language selector.

Exit: a phpMyAdmin user can do their daily browsing and querying without noticing missing behaviour.

## M2: Edit data and structure (weight 10)

Feature docs: [Insert/edit and transformations](../features/03-insert-edit-transformations.md), [Table level](../features/04-table-level.md).

- Insert/Edit form with every widget, function lists, NULL/ignore semantics, after-insert options, continue insertion, keyboard navigation, FK dropdown/popup, GIS editor, file upload (incl. `UploadDir`), copy row, multi-row edit, preview SQL, exact INSERT/UPDATE generation.
- Transformations: all 15 output and 8 input plugins + overview page + Structure configuration + `column_info` storage.
- Table Structure (columns, indexes, partitions, information, move columns, propose structure, print, data dictionary), column definition form, Create table, Add/Change column, Index editor, Partition editor.
- Table Operations (all cards), maintenance actions, Relation view, Search, Zoom search, Find & Replace, Triggers (table scope), Views create/operations, Privileges tab (read + link to editor), Tracking (table scope).
- Normalization wizard.

Exit: schema design and data entry parity; golden SQL suite covers every DDL/DML builder.

## M3: Database and server administration (weight 10)

Feature docs: [Database level](../features/05-database-level.md), [Server level](../features/06-server-level.md).

- DB Structure with all bulk actions and prefix tools, Create database, server Databases page, DB Operations (rename/copy/collation), DB Search, multi-table Query builder, Routines (editor + execute), Events (+ scheduler toggle), Triggers (db scope), DB Tracking, Central columns, Data dictionary, Privileges tab.
- Designer: canvas, relations, pages, settings, build-query mode, schema export (PDF/SVG/DIA/EPS).
- Charts (table chart page and "Display chart" from results), GIS visualization page.
- Server Status (overview, processes with auto-refresh and kill, query stats, variables with alerts, monitor with SSE and log analysis, advisor with all 55 rules), Variables (inline edit), Charsets, Engines (+ InnoDB pages), Plugins, Replication (all dialogs and controls), Binary log, User accounts (list, add, edit with every tab, delete, export, lock/unlock, groups), User groups, Change password, Flush privileges.

Exit: a DBA can administer users, replication and performance without leaving the tool.

## M4: Export, import, settings (weight 8)

Feature docs: [Export/import](../features/07-export-import.md), [Settings, preferences, pmadb](../features/08-settings-preferences-pmadb.md).

- Export at three scopes + selected rows + selected tables, all 16 plugins with every option, templates, aliases, compression, separate files, save to server, view as text; byte-identical golden tests vs phpMyAdmin for text formats.
- Import with chunked resumable upload, drag-and-drop, server directory, all 7 plugins, progress SSE, partial import/resume, CSV → new table analysis, compression detection, charset conversion.
- Settings: every tab and field, validators, import/export of prefs, reset, page-settings gear for every page, 2FA (TOTP, WebAuthn, simple), `UserprefsDisallow`.
- pmadb status page, Create missing tables, ZeroConf.
- Remaining auth types: `config`, `http`, `signon`; captcha; rate limiting; allow/deny; arbitrary server.
- Setup/first-run wizard replacing phpMyAdmin's `setup/` (generates `bettermyadmin.config.*`).

Exit: full feature parity. Every checklist in `docs/features` green or `n/a`.

## M5: Polish, performance, release (weight 5)

- Performance suite at budget on all pages; bundle gates; INP p95 ≤ 100 ms.
- Visual regression baselines for 4 themes × 2 modes.
- All 97 locales imported and spot-checked (RTL pass).
- Accessibility audit and fixes.
- Packaging: `npx bettermyadmin`, Docker multi-arch, Bun binaries, Helm chart example, reverse-proxy examples (Nginx, Caddy, Traefik) with `basePath`.
- Documentation site built from `docs/`.
- 1.0.

## Beyond parity (explicitly out of scope until 1.0 ships)

Ideas that users will ask for and that we will not build before parity is complete, so they do not dilute the goal: query tabs, saved connections per user, schema diff, data compare, AI query assistance, PostgreSQL. They are tracked in the issue tracker under `post-1.0`.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Lexer/classifier divergence from phpMyAdmin leads to different LIMIT/count/editable decisions | Fixture import from `phpmyadmin/sql-parser` test data; classifier fuzzing against the PHP implementation in the parity harness (`/lint`-like endpoint on the reference phpMyAdmin container returns its analysis for a statement) |
| SQL generation differs subtly (quoting, ordering) | Golden general-log diffs for every builder; no builder merges without a golden case |
| Export byte-parity is brittle | Normaliser only strips tool header/timestamps; any other diff is a bug or an entry in `allowed-diffs.yaml` with review |
| Grid complexity balloons | The grid is specified by one doc and one checklist; build it feature-flagged behind the checklist, no undocumented behaviour |
| MySQL/MariaDB version matrix | testcontainers matrix in CI from M0; `server-info.ts` capability flags are the only place version checks live |
| Scope creep from "modern" features | Out-of-scope list above; PR template asks "which checklist item does this complete?" |

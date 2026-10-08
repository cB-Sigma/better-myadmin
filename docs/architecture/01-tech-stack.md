# Tech stack and decisions

This file records every stack decision, the alternatives we weighed, and why we chose what we chose. Decisions are numbered (D1, D2...) so other docs can reference them. Changing one is a pull request against this file.

## Summary table

| Layer | Choice | Replaces in phpMyAdmin |
|---|---|---|
| Language | TypeScript 5.x everywhere (strict) | PHP 8.2 + TypeScript 5.3 |
| Monorepo | pnpm workspaces + Turborepo | single composer/yarn project |
| Frontend framework | React 19 + Vite 6 | server-rendered Twig + jQuery AJAX swapping |
| Routing | TanStack Router (type-safe, loaders, preloading) | FastRoute + `index.php?route=` URLs |
| Server state | TanStack Query | none (full page re-render) |
| Client state | Zustand (small, per-feature stores) + URL search params | `CommonParams`, globals, hidden inputs |
| Tables / grids | TanStack Table + TanStack Virtual | `makegrid.ts` (2.8k lines of jQuery) + `tablesorter` |
| UI kit | shadcn/ui (Radix primitives) + Tailwind CSS v4 | Bootstrap 5 + jQuery UI + 4 themes |
| Icons | Lucide | `pmahomme` PNG sprite / `s_*.png` icons |
| SQL editor | CodeMirror 6 (`@codemirror/lang-sql`, MySQL dialect) | CodeMirror 5.65 |
| SQL tokenizer/splitter | `@bettermyadmin/sql-lexer` (our port of `phpmyadmin/sql-parser` lexer + statement classifier) | `phpmyadmin/sql-parser` (PHP) |
| Charts | Chart.js 4 (query charts, status pie) + uPlot (live monitor) | Chart.js 4 + chartjs-plugin-zoom |
| Designer canvas | `@xyflow/react` (React Flow) with custom nodes | hand-written SVG/`designer/*.ts` |
| Maps / GIS | OpenLayers 10 | OpenLayers 10 |
| Date/time | `date-fns` + native `<input type=datetime-local>` + custom picker component | jQuery UI datetimepicker |
| Forms | react-hook-form + Zod | jquery-validation + server-side `Validator.php` |
| i18n | `@lingui/core` with PO catalogues imported from phpMyAdmin's 97 locales | gettext `.po` via `motranslator` |
| Backend runtime | Node.js 22 LTS (Bun-compatible) | PHP-FPM / Apache |
| HTTP framework | Hono (with typed RPC client) | Slim PSR-7 + FastRoute + Symfony DI |
| Validation | Zod schemas shared between client and server | ad hoc |
| MySQL driver | `mysql2` (promise API, streaming rows, multi-statement, compression, SSL) | `ext-mysqli` |
| Sessions | Server-side encrypted session store (SQLite by default, Redis optional), cookie carries session id only | PHP sessions + AES-encrypted cookie for credentials |
| Metadata store | phpMyAdmin `pmadb` tables on the MySQL server (compatible) with an optional local SQLite fallback | `pmadb` |
| Realtime | Server-Sent Events (monitor, import progress, long exports) | polling via AJAX |
| Export engine | Streaming `Readable` pipelines per plugin, `zlib`/`archiver` for gzip/zip | buffered PHP strings, `CompressOnFly` |
| Import engine | Chunked, resumable uploads (`tus`-style) + streaming parsers | PHP `$_FILES` + `UploadDir` + partial-import timers |
| PDF generation | `pdf-lib` for schema/table PDF export | hand-rolled TCPDF-like `Pdf.php` |
| Spreadsheets | `exceljs` for ODS/Excel import/export helpers | custom XML writers |
| Shapefile | `shapefile` npm | `phpmyadmin/shapefile` |
| Testing | Vitest (unit), Playwright (e2e against a dockerized MySQL/MariaDB matrix), golden SQL snapshot tests vs phpMyAdmin output | PHPUnit, Jest, Selenium |
| Packaging | `npx bettermyadmin`, Docker image, Bun single-binary build | tarball/zip + PHP host |

## D1: TypeScript on both sides, Node.js runtime

**Considered:** Go backend (single binary, fast, great MySQL drivers), Rust (axum + sqlx), keeping PHP and only rewriting the frontend, Node/Bun.

**Chosen:** TypeScript on Node.js 22, Bun-compatible.

**Why:** The hardest part of cloning phpMyAdmin is not the database layer, it is the ten thousand small behaviours in the UI and the SQL generation that drives them. Those live on both sides of the wire (a column definition form generates `ALTER TABLE` on the server and validates on the client; the result grid needs the server's analysis of the statement to know what is editable). One language lets us share the Zod schemas, the SQL lexer, the type-catalog (`Types.php` equivalent), the quoting helpers and the i18n catalogue instead of maintaining two copies. Go would give a smaller binary and faster cold start but cost us that sharing, and `mysql2` already streams rows and handles multi-statement, compression and SSL. Bun compatibility (no Node-only native addons on the hot path) keeps the single-binary option open via `bun build --compile`.

**Rejected keeping PHP:** the backend is where most SQL generation lives and we want it tested from TypeScript with the same fixtures the frontend uses. A PHP backend would also keep the deployment story phpMyAdmin has (web server + PHP), which is the thing users complain about most.

## D2: React 19 + Vite, not Next.js / Remix / SolidJS / Svelte

**Considered:** Next.js (App Router), Remix/React Router 7 framework mode, SvelteKit, SolidStart, plain React + Vite.

**Chosen:** React 19 with Vite, client-rendered SPA, served as static assets by the Node server.

**Why:** A database admin tool is 100% authenticated and 0% SEO. SSR brings nothing, and a framework that wants to own the server would fight the API server we need anyway (streaming exports, SSE). shadcn/ui is React. React Flow, TanStack Table and CodeMirror 6 all have first-class React integrations. Svelte/Solid would be marginally faster to render but the ecosystem gap (shadcn, React Flow, TanStack Table maturity) costs more than it saves, and our performance budget is met with React when rendering is virtualized (D6).

## D3: TanStack Router for routing, TanStack Query for server state

**Why Router:** every phpMyAdmin page is addressable by URL with a `route=` plus `db`, `table`, `sql_query`, `pos`, `session_max_rows`... We need the same deep-linkability, typed search params (Zod-validated, so `pos` is a number and `sql_query` is a string), route-level loaders that start fetching before the component renders, and *intent preloading*: hovering a table in the tree or a tab in the menu starts loading it. That preload is the single biggest reason the clone feels faster than phpMyAdmin's AJAX swap. React Router 7 could do most of this; TanStack Router's typed search params and built-in preload-on-hover tipped it.

**Why Query:** cache keyed by server/db/table so navigating back is instant, background revalidation, mutation invalidation (dropping a column invalidates structure, browse, and the nav tree node), `placeholderData` for pagination so the grid never flashes empty, and dedup of the dozens of small lookups (enum values, foreign values, column lists) the UI fires.

## D4: shadcn/ui + Tailwind v4 as the component system

**Considered:** Mantine, MUI, Ant Design, Radix Themes, headless (Ark/React Aria) + custom CSS, keeping Bootstrap.

**Chosen:** shadcn/ui components copied into `packages/ui`, themed with CSS variables, Tailwind v4.

**Why:** shadcn gives us owned source for every component (we will need to modify `DataTable`, `Command`, `Popover`, `Dialog` density and behaviour heavily), accessible Radix primitives, and a design-token system that makes the four phpMyAdmin themes plus dark mode a matter of CSS variables. The risk with shadcn is "looks like every other SaaS dashboard"; we counter that with a dense admin preset (see [UI design system](09-ui-design-system.md)): 13px base in grids, 28px row height, tight paddings, visible borders on tables. Ant Design was the closest alternative (its Table is excellent) but it brings its own design language and a large bundle.

## D5: CodeMirror 6 for SQL editing

Same lineage as phpMyAdmin's CodeMirror 5 so behaviours port cleanly (Ctrl+Space autocomplete, Ctrl+Enter run, fullscreen toggle, lint gutter). `@codemirror/lang-sql` with the `MySQL` dialect gives highlighting and schema-aware completion (tables and columns passed in from the navigation cache, matching `EnableAutocompleteForTablesAndColumns`). Linting uses our lexer (D7) in a web worker, no `/lint` round trip. Monaco was rejected: 2-3 MB of JS and a worker setup for a feature that CodeMirror does in 300 KB.

## D6: TanStack Table + TanStack Virtual for the browse grid

The grid is the heart of the product. Requirements from [the browse doc](../features/02-browse-results-grid.md): client-side column reorder and hide (persisted to `table_uiprefs`), multi-column sort, row selection, inline cell editing with type-aware editors, FK traversal links, truncation toggles, transformations, sticky headers, repeat headers every N rows, 25 to "show all" rows. TanStack Table handles the model (column order/visibility/selection/sorting) as plain state we can persist. TanStack Virtual renders only visible rows so "Show all" on a 200k-row table stays interactive, something phpMyAdmin cannot do (it refuses above a threshold and we keep that refusal as a parity behaviour but allow override).

AG Grid Community was considered: faster out of the box, but its editor model and styling fight shadcn, and the Enterprise features we would want (row grouping, pivot) are not needed.

## D7: Our own SQL lexer and statement classifier, ported from `phpmyadmin/sql-parser`

phpMyAdmin leans on its parser for: splitting multi-statement input by the current delimiter, classifying statements (`is_select`, `is_show`, `is_maint`, `is_affected`, `is_explain`...), detecting `LIMIT`/`UNION`/`DISTINCT`/`GROUP BY`/`ORDER BY`/`INTO OUTFILE`, extracting tables/columns for Browse, rewriting `ORDER BY` for "remember sorting", appending `LIMIT`, linting, formatting, and a few niche things (routine body parsing, `CREATE TABLE` partition parsing for the Structure tab).

**Considered:** `node-sql-parser` (MySQL/MariaDB dialect coverage is partial; chokes on vendor syntax, procedures, `DELIMITER`), `sql-formatter` (format only), tree-sitter-sql via WASM (heavy, not MySQL-complete), writing a full parser.

**Chosen:** port the *lexer* (`Lexer.php`, `Token.php`, `Context` keyword tables for MySQL 5.x/8.x and MariaDB) and the *statement classifier* (what `ParseAnalyze.php` and `Sql.php` actually need) to TypeScript as `packages/sql-lexer`. This is roughly 3k lines, deterministic, and gives identical token streams to phpMyAdmin, which matters for parity: the same statement must be classified the same way. Full AST parsing is only needed for `CREATE TABLE` (partitions, column definitions) and routines; for those we use `SHOW CREATE TABLE` + targeted mini-parsers rather than a general AST. `sql-formatter` (npm) with the `mysql` dialect handles the Format button; its output differs cosmetically from `phpmyadmin/sql-parser`'s formatter, which we accept (formatting is presentation, not behaviour).

## D8: Hono for the HTTP layer, with typed RPC

Hono runs on Node and Bun unchanged, is tiny, has first-class streaming (`streamSSE`, `stream`), and its RPC mode gives the client a fully typed `hc<AppType>()` client from the route definitions with Zod validators, so an endpoint's request and response types are the same object on both sides. tRPC was the alternative; it is excellent but awkward for streaming downloads, file uploads and the "plain URL" endpoints we need (export download links, transformation wrapper images). Fastify is faster per request by a hair but needs a separate type-sharing layer.

## D9: `mysql2`, one pool per (session, server), with KILL support

`mysql2/promise` supports: streaming result rows (`.stream()`) for exports and big browses, `multipleStatements` (enabled only for the SQL tab path, never for API-generated queries), `rowsAsArray`, typed fields metadata (needed to reproduce phpMyAdmin's `FieldMetadata` flags: `is_blob`, `is_binary`, `is_num`, `is_unique`, `is_primary`, `is_multiple_key`...), compression, SSL options matching `Servers[$i]['ssl_*']`, `charset`/`collation`, `timezone`. Each authenticated session gets a small pool (default max 4) per server; a running query's connection id is tracked so "Cancel" issues `KILL QUERY <id>` on a control connection. Pools idle out after `LoginCookieValidity` seconds, matching phpMyAdmin's session lifetime.

## D10: Auth model mirrors phpMyAdmin's `auth_type` options

- `cookie` (default): login form, credentials encrypted with a server secret (`blowfish_secret` equivalent, 32 bytes, auto-generated on first run if missing like phpMyAdmin's `ZeroConf`), stored **server-side** in the session store. The browser cookie carries only a random session id (HttpOnly, SameSite=Lax, Secure when behind HTTPS). This is stricter than phpMyAdmin (which stores the encrypted password in the cookie) while keeping identical UX: `LoginCookieValidity`, `LoginCookieStore`, `LoginCookieRecall` (prefill last username), `LoginCookieDeleteAll`.
- `config`: credentials in the server config file, no login screen.
- `http`: Basic auth challenge, same realm directive.
- `signon`: external session hand-off via a signed URL, equivalent of `SignonURL`/`SignonScript`.
- Two-factor: TOTP (`application`), WebAuthn (`key`), `simple` (confirm). Stored in `pmadb.userconfig` under the `2fa` key exactly as phpMyAdmin does, so a user's 2FA configured in phpMyAdmin works in BetterMyAdmin.

Details in [Security](07-security.md) and [Shell, navigation, auth](../features/01-shell-navigation-auth.md).

## D11: pmadb compatibility rather than a new metadata store

We read/write the 19 phpMyAdmin configuration storage tables as-is (schema in [Settings, preferences, pmadb](../features/08-settings-preferences-pmadb.md)). Reasons: zero migration for existing users, side-by-side operation, and phpMyAdmin's gating logic ("relation feature works only if `relation` and `table_info` tables exist") is already a good model for progressive enhancement. When no `controluser`/pmadb is configured we fall back to a local SQLite file for *per-browser* conveniences only (recent tables, UI prefs, bookmarks), which is a superset of phpMyAdmin's "store in browser localStorage" fallback and avoids the "configuration storage not completely configured" warning being a wall. The warning itself is kept (it tells the user which features are off), with the same "Find out why" and "Create" actions.

## D12: Streaming export, chunked import

phpMyAdmin builds export output in memory or with `CompressOnFly`, and fights PHP execution time limits during import (`ExecTimeLimit`, the "partial import" resume dance with `skip_queries`). In Node we stream: an export is a `Readable` of SQL/CSV/... chunks piped through optional gzip/zip into the HTTP response, so a 10 GB dump never touches memory. Import uploads in chunks (resumable), is parsed as a stream by format, and reports progress over SSE. We keep the *UI* of partial import (the checkbox, the "skip this number of queries" field) because the semantics are useful (stop on error, resume from statement N), but the time-limit motivation is gone.

## D13: Lingui with phpMyAdmin's PO catalogues

phpMyAdmin has 3,442 source strings and 97 locales. We import the `.po` files directly (same msgids), so translations carry over on day one, and we keep the English source strings identical where the UI text is identical. This is also a parity tool: if a UI string isn't in the catalogue, we probably invented a feature.

## D14: Testing against a MySQL/MariaDB matrix with golden files from phpMyAdmin

Parity is checked by running the same user action in both tools (Playwright against a dockerized phpMyAdmin and BetterMyAdmin) and diffing generated SQL (captured from the general log) and export output. See [Testing and parity](11-testing-and-parity-strategy.md).

## Things we explicitly keep from phpMyAdmin's approach

- Server-side decides what is editable, what is a key, what links where. The client never guesses from column names.
- Every destructive action has the same confirmation text and the same `Confirm` directive to turn it off.
- MySQL doc links (`MySQLDocumentation::show`) for every error code, variable, and status counter, generated from the same `williamdes/mariadb-mysql-kbs` knowledge base (we vendor its JSON).
- Theme switching, language switching and "page settings" live in the same places.

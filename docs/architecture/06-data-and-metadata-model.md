# Data and metadata model

BetterMyAdmin stores almost nothing of its own. Like phpMyAdmin it is a window onto MySQL/MariaDB, and the little state it needs (bookmarks, relations, UI preferences, tracking) lives in the phpMyAdmin configuration storage (`pmadb`) on the database server itself. This document explains the layers of configuration and state, where each lives, and how the pmadb compatibility works. The pmadb table-by-table semantics are in [Settings, preferences, pmadb](../features/08-settings-preferences-pmadb.md); this is the model.

## Layers

```mermaid
flowchart TB
  A[Defaults<br/>packages/config/defaults.ts<br/>= Settings.php defaults] --> B[Server config<br/>bettermyadmin.config.* + env<br/>= config.inc.php]
  B --> C[User preferences<br/>pmadb.userconfig (per MySQL user)<br/>or browser localStorage fallback]
  C --> D[Per-page settings<br/>same store, edited via the gear popup]
  D --> E[Per-request overrides<br/>URL search params: pos, rows, sort, display options]
```

Resolution order is identical to phpMyAdmin's `Config::loadUserPreferences`: a directive listed in `UserprefsDisallow` cannot be overridden by the user; `UserprefsDeveloperTab` exposes the developer form. The merged result is served by `GET /api/servers/:s/prefs` with the *source* of each value so the Settings UI can show "Restore default" only where it differs.

## Server configuration

| Concern | Where | Notes |
|---|---|---|
| Servers list | `Servers[]` array in config | 1-based like phpMyAdmin; every `Servers[$i]` key accepted (`host`, `port`, `socket`, `ssl*`, `compress`, `auth_type`, `user`, `password`, `controluser`, `controlpass`, `controlhost`, `controlport`, `pmadb`, 19 table-name keys, `hide_db`, `only_db`, `verbose`, `AllowDeny`, `AllowRoot`, `AllowNoPassword`, `DisableIS`, `SessionTimeZone`, `MaxTableUiprefs`, `tracking_*`, `SignonURL`, `SignonSession`, `LogoutURL`, `auth_http_realm`, `hide_connection_errors`) |
| Secret | `blowfish_secret` (alias `secret`) | 32+ bytes; auto-generated into the data dir when absent |
| Data directory | `DataDir` (new; default `~/.bettermyadmin` or `/data` in Docker) | holds generated secret, SQLite session store, SQLite metadata fallback, upload/save dirs if `UploadDir`/`SaveDir` are relative |
| Session store | `SessionStore: 'sqlite' | 'redis'`, `RedisUrl` | new |
| Listen | `Listen: { host, port, basePath }` | `PmaAbsoluteUri` still honoured for absolute links |
| Everything else | directive by directive, see [reference](../reference/config-directives.md) | identical names |

The CLI `bma import-pma-config path/to/config.inc.php` converts an existing phpMyAdmin config by evaluating the PHP array syntax (a small PHP-array parser, no PHP runtime) to our format, so migration is one command.

## Sessions

Table `sessions` in the session store:

| Column | Type | Purpose |
|---|---|---|
| `id` | text PK | 32 random bytes, base64url, the cookie value |
| `created_at`, `last_seen_at` | int | sliding expiry (`LoginCookieValidity`), hard cap (`LoginCookieStore`) |
| `servers` | JSON | per server index: `{ user, credEnc (AES-256-GCM), twoFactorOk, collation, lastDb, lastTable }` |
| `csrf_token` | text | double-submit token |
| `lang`, `theme` | text | mirrored from cookies for server-side needs (print view, emails) |
| `flash` | JSON | one-shot messages between a redirecting mutation and the next page (phpMyAdmin's `FlashMessenger`) |
| `debug_sql` | JSON | per-request executed statements when `DBG.sql` is on (Console "Debug SQL" tab) |

Credentials are never written anywhere else (no logs, no error reports).

## The configuration storage (pmadb)

19 tables, schema from phpMyAdmin's `resources/sql/create_tables.sql`, unchanged. BetterMyAdmin discovers them via `Servers[i].pmadb` + the per-table name keys, with the same auto-detection phpMyAdmin performs when `pmadb` is set but table names are not (defaults `pma__*`). The control connection uses `controluser`/`controlpass` when present, else the logged-in user's connection (same fallback as phpMyAdmin, same consequence: the user needs privileges on `pmadb`).

| Table (default name) | Gates (phpMyAdmin flag) | Used by | Read/write pattern |
|---|---|---|---|
| `pma__bookmark` | `bookmarkwork` | SQL tab bookmarks, Console bookmarks, "Bookmark this query" from results, import "use bookmark" | small, read per SQL page, write on save |
| `pma__relation` | `relwork` | internal relations (Relation view), FK traversal in Browse for engines without FKs, Designer lines, QBE auto-join, export "Display foreign key relationships" | read per table meta (cached per session with invalidation on Relation view save) |
| `pma__table_info` | `displaywork` | display field per table (FK dropdown labels, tooltip/replacement in Browse, Designer "choose column to display") | read with relation |
| `pma__table_coords`, `pma__pdf_pages` | `pdfwork` | Designer positions per page, schema export layout | read on Designer open, write on move/save |
| `pma__column_info` | `commwork`, `mimework` | column comments (for engines that lack native comments), MIME type + transformation + options + input transformation | read per table meta; write from Structure column form |
| `pma__history` | `historywork` | SQL query history (`QueryHistoryDB`), trimmed to `QueryHistoryMax` | append per executed SQL-tab query |
| `pma__recent`, `pma__favorite` | `recentwork`, `favoritework` | recent tables dropdown, favorites (star), synced with localStorage | write per table visit / star toggle |
| `pma__table_uiprefs` | `uiprefswork` | per-user per-table: `sorted_col`, `col_order`, `col_visib`; capped by `MaxTableUiprefs` (oldest evicted) | read per Browse; write on sort/reorder/hide |
| `pma__tracking` | `trackingwork` | versions, tracked statements, schema and data SQL logs, snapshots | write on DDL/DML when active |
| `pma__userconfig` | `userconfigwork` | user preferences JSON + `2fa` + console config + `Export`/`Import` defaults | read at session start; write on Settings save |
| `pma__users`, `pma__usergroups` | `menuswork` | user groups and allowed menu tabs | read per request (cached), write from User groups page |
| `pma__navigationhiding` | `navwork` | hidden nav items | read with nav tree |
| `pma__savedsearches` | `savedsearcheswork` | QBE saved searches | QBE page |
| `pma__central_columns` | `centralcolumnswork` | central columns per db | Central columns page, column form picker, Structure "add to central columns" |
| `pma__designer_settings` | `designersettingswork` | per-user Designer toggles | Designer open/save |
| `pma__export_templates` | `exporttemplateswork` | named export option sets per export type | Export page |

Behavioural rules carried over:

- A feature whose table is missing is hidden or degraded, never erroring. The home page shows phpMyAdmin's warning with "Find out why" (→ status page listing each table and its flag) and a "Create" link when `pmadb` exists but tables do not (`fixUpMissing`); when nothing is configured and `ZeroConf` is on, the "Create a database named 'phpmyadmin' and setup the phpMyAdmin configuration storage there" action is offered, running `create_tables.sql` as the current user.
- `MaxTableUiprefs` eviction, `QueryHistoryMax` trimming, `NumRecentTables`/`NumFavoriteTables` caps are enforced server-side with the same queries.
- Writes are done with the exact same column values phpMyAdmin would write (e.g. `col_order` as a comma-separated list, `prefs` JSON for `table_uiprefs`, `config_data` JSON for `userconfig`), verified by round-tripping with phpMyAdmin in the parity test suite.

## Local fallback store (new)

When no pmadb is available, phpMyAdmin keeps user preferences and favorites in browser localStorage. We do the same, and additionally the server keeps a SQLite file (`DataDir/local-metadata.sqlite`) with the *same table shapes* as pmadb, keyed additionally by `(server_index, mysql_user)`. The metadata package has one interface with two drivers (`PmadbDriver`, `SqliteDriver`), so features do not know which is in use. Only the per-user tables are mirrored locally (`userconfig`, `recent`, `favorite`, `table_uiprefs`, `history`, `bookmark`, `designer_settings`, `export_templates`, `savedsearches`); relational metadata (`relation`, `table_info`, `column_info`, `tracking`, `central_columns`, `navigationhiding`, `users`, `usergroups`, `table_coords`, `pdf_pages`) stays off unless pmadb exists, because it describes the database and must be shared across users. The UI tells the user which mode is active with the same warning phpMyAdmin shows.

## Relation and metadata resolution

How "this column is a foreign key to that table" is decided, mirrored from `Relation::getForeigners`:

1. **FK constraints** from `information_schema.KEY_COLUMN_USAGE` + `REFERENTIAL_CONSTRAINTS` (or `SHOW CREATE TABLE` parsing when `DisableIS`), including `ON DELETE`/`ON UPDATE`, multi-column constraints and constraint names.
2. **Internal relations** from `pma__relation` for the same table (only when `relwork`), which supply single-column relations for engines without FK support or for cross-database links.
3. Merge: FK constraints win on collision; the result map is `column → {db, table, column, constraint?, onDelete?, onUpdate?, isInternal}`.
4. **Display field** of the referenced table from `pma__table_info` (`displaywork`); when absent, the referenced key itself is shown.
5. **Column comments**: native comments from `information_schema.COLUMNS`; `pma__column_info.comment` only for `commwork` on engines/versions without native comments (phpMyAdmin `Relation::getComments` precedence).
6. **MIME/transformations** from `pma__column_info` (`mimework`): `mimetype`, `transformation`, `transformation_options`, `input_transformation`, `input_transformation_options`.

The result is cached per `(session, server, db, table)` and invalidated by any DDL on the table, any save in Relation view, Structure column edits, Designer relation changes, and the "Reload navigation" action.

## Identity of a row

Row edit/delete/copy need a `WHERE` clause. phpMyAdmin's `Results::getUniqueConditions` / `Util::getUniqueCondition` picks, in order: the primary key, a unique key (a NULL value in it is still used, compared with `IS NULL`, and the clause stays unique), otherwise *all* columns (with `RowActionLinksWithoutUnique` controlling whether links are shown at all, and the generated `DELETE/UPDATE` gets `LIMIT 1` when no unique key exists). Column comparisons use type-aware literal forms: numbers unquoted, strings escaped, binary compared as `= CAST(0x... AS BINARY)`, `BIT` as `= b'...'`, spatial as `= CAST(0x... AS BINARY)` like other binary values, NULL as `IS NULL`, floating point with the `CONCAT`/precision trick phpMyAdmin uses to avoid float-equality failures. All of this lives in `packages/sql-gen/where.ts` with phpMyAdmin's unit fixtures ported.

## Type catalog

`packages/mysql-types` is the port of `Types.php`, `Util::getSupportedDatatypes`, `Util::getFunctionsForField`, `InsertEdit::getFunctionColumn`, `Charsets`: the grouped type list shown in dropdowns (Numeric, Date and time, String, Spatial, JSON), per-type attributes (`UNSIGNED`, `ZEROFILL`, `BINARY`, `on update CURRENT_TIMESTAMP`), which types take a length/values, which take a collation, default-value rules, the per-type function lists for insert/edit and the restricted lists for hashing, and MariaDB-only types (`INET6`, `UUID`). Server version/vendor from `server-info.ts` toggles availability (JSON on 5.7.8+, `UUID` on MariaDB 10.7+, invisible columns, expression defaults on 8.0.13+, `CHECK` on 8.0.16+/MariaDB 10.2.1+).

## Numeric and value fidelity

JavaScript has a single IEEE-754 double numeric type, so `BIGINT` beyond 2^53, `DECIMAL`, and `FLOAT`/`DOUBLE` text would be corrupted if parsed. phpMyAdmin avoids this because mysqli returns every column as a string and the application never parses user data; PHP floats are doubles too. We follow the same discipline and enforce it:

- Driver settings: `mysql2` with `bigNumberStrings: true`, `supportBigNumbers: true`, `decimalNumbers: false`, `dateStrings: true`, `typeCast` left default for strings. Every numeric and temporal column arrives as the exact text the server sent.
- Cell values are typed `string | null | Uint8Array` throughout `contracts`, the grid, editors, export writers and `sql-gen`. "Is numeric" and right-alignment come from `FieldMetadata`, never from parsing.
- Write-back emits the user's text as the literal (`0.1` stays `0.1`; `9223372036854775807` stays intact). `BIT` renders and round-trips as `b'...'`; binary stays bytes and is emitted as `0x...`.
- Arithmetic exists only for derived display values: `BigInt` for counters and sums, doubles for rates, percentages, byte formatting and chart series, matching phpMyAdmin's own float use in `Util::formatNumber` and the status pages.
- Lint rule (Biome custom / local ESLint): `Number()`, `parseFloat`, `parseInt` and unary `+` are banned on anything typed as a cell value; allowed only in `packages/i18n/format.ts` and the status/monitor code on explicitly derived values.
- Timezone conversion is never done in JS; `SessionTimeZone` sets it on the connection and temporal values are displayed as strings.

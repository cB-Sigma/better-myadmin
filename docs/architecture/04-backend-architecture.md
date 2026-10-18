# Backend architecture

`apps/server` is a Hono application running on Node 22 (Bun-compatible). It serves the SPA, exposes `/api/*`, owns all database connections, all SQL generation that is executed, authentication, sessions, the metadata (pmadb) layer, and the streaming export/import engines.

## Module layout

```
apps/server/src
  main.ts                 CLI entry: parse args/env, load config, start http server, print URL
  app.ts                  Hono app: middleware chain, route mounting, static serving
  config/                 loads bettermyadmin.config.* + env, validates with packages/config schema
  auth/                   plugins: cookie.ts config.ts http.ts signon.ts; twofactor/{totp,webauthn,simple}.ts
  session/                store interface; sqlite.ts; redis.ts; crypto.ts (AES-256-GCM, key from blowfish_secret)
  db/
    pool-manager.ts       (sessionId, serverIdx) -> mysql2 pool; control connection; KILL; idle eviction
    connection.ts         wrappers: query(), stream(), multi(), with timing + general-log capture hook
    field-meta.ts         mysql2 field packets -> FieldMetadata (type name, flags, charsetnr, is_blob, is_binary, is_num, is_unique_key, is_primary_key, is_multiple_key, is_zerofill, is_unsigned ...)
    server-info.ts        version detection (MySQL / MariaDB / Percona), capability flags (JSON type, CHECK constraints, invisible columns, ...), information_schema vs SHOW strategy (DisableIS)
  query/
    pipeline.ts           the SQL tab/browse pipeline (see features/09)
    analyze.ts            uses packages/sql-lexer classifier
    limit.ts  count.ts  remember-sorting.ts  profiling.ts  explain.ts  simulate-dml.ts  signature.ts
  schema/                 read model: databases, tables, columns, indexes, fks, partitions, triggers, routines, events, views, charsets, engines, variables, status, processes
  ddl/                    write model, each file a builder returning {sql, params} using packages/sql-gen
    table-create.ts  table-alter.ts  column.ts  index.ts  partition.ts  relation.ts  view.ts  routine.ts  event.ts  trigger.ts  database.ts  privileges.ts  maintenance.ts  copy-move.ts  normalization.ts
  dml/                    insert-edit.ts (INSERT/UPDATE builders with function wrapping, NULL, hex binary), delete.ts, find-replace.ts, copy-rows.ts
  metadata/               thin facade over packages/metadata bound to the session's control connection
  export/  import/        route handlers that wire packages/export|import plugins to HTTP streams, SSE progress, templates, UploadDir/SaveDir
  status/                 monitor SSE sampler, process list, advisor runner, log analysis
  routes/                 one file per API resource; imports Zod contracts from packages/contracts
  telemetry/              error report sink (opt-in), version check
```

## Configuration

Two sources, merged in this order: defaults (`packages/config/defaults.ts`, one-to-one with `Settings.php`) ← config file (`bettermyadmin.config.ts`, `.json`, or `.yaml`; also reads a legacy `config.inc.php`-shaped JSON export produced by our `bma import-pma-config` command) ← environment (`BMA__Servers__1__host` style double-underscore paths, plus the common shortcuts `BMA_HOST`, `BMA_PORT`, `BMA_USER`, `BMA_PASSWORD`, `BMA_ARBITRARY_SERVER`, `BMA_ABSOLUTE_URI`). Every directive in the [reference](../reference/config-directives.md) is accepted under its phpMyAdmin name. Unknown keys fail startup with a message naming the nearest directive.

`blowfish_secret` (we accept both this name and `secret`) is required for cookie auth; if missing, we generate one and persist it to the data directory (phpMyAdmin's `ZeroConf`-style behaviour) and show the same home-page notice recommending a fixed value.

## Sessions and credentials

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as Server
  participant St as Session store
  participant My as MySQL
  B->>S: POST /api/auth/login {server, user, password}
  S->>My: connect (pool probe)
  My-->>S: ok / ER_ACCESS_DENIED
  S->>St: put(sessionId, encrypt(credentials), prefs, 2fa state)
  S-->>B: Set-Cookie: bma_sid=<random 32 bytes>; HttpOnly; SameSite=Lax; [Secure]
  B->>S: GET /api/... Cookie: bma_sid
  S->>St: get(sessionId) → decrypt credentials → pool-manager.get(session, server)
```

- Credentials are encrypted at rest in the session store with AES-256-GCM, key derived from `blowfish_secret` with HKDF. The cookie never contains credentials. (phpMyAdmin stores the encrypted password in a cookie; we chose stricter storage with the same user-facing semantics.)
- Sliding expiry: `LoginCookieValidity` (default 1440 s) of inactivity logs out, with phpMyAdmin's "Your session has expired. Please log in again." message and the pre-filled username when `LoginCookieRecall` is on. `LoginCookieStore` > 0 keeps the session that long regardless of activity.
- `LoginCookieDeleteAll`: logging out from one server logs out of all.
- CSRF: the login response also sets a readable `bma_token` cookie; every mutating request echoes it in `X-BMA-Token` (double submit). GET endpoints are side-effect free by contract, enforced by a test that greps route definitions.

## Connection manager

- Key: `(sessionId, serverIndex)`. Value: `mysql2` pool with `connectionLimit` from `Servers[i].max_connections` (new, default 4), `multipleStatements: false` by default. Options map from `Servers[i]`: `host`, `port`, `socket`, `compress`, `ssl`, `ssl_key`, `ssl_cert`, `ssl_ca`, `ssl_ca_path`, `ssl_ciphers`, `ssl_verify`, `SessionTimeZone` (`SET time_zone`), connection collation (`collation_connection` from the home page selector), `init_command` to `SET NAMES utf8mb4`.
- A **control connection** per pool is used for `KILL QUERY <id>` (cancel button in the SQL tab and Browse), for `SHOW PROCESSLIST` when the user is viewing their own processes, and for the pmadb control user when `controluser` is configured (separate pool with those credentials, as phpMyAdmin does).
- The SQL tab path acquires a dedicated connection with `multipleStatements: true` for the duration of one request so multi-statement input runs sequentially and its connection id is known for cancellation; `SET profiling=1` and `SHOW PROFILE`, `EXPLAIN`, `ROLLBACK`, `SET FOREIGN_KEY_CHECKS` all run on that same connection, which phpMyAdmin also requires.
- Connections do not pile up (`ConnectionPool`, X24): a free connection closes after `idleTimeout` seconds (default 10, mysql2 `maxIdle: 0`); a pool without a request for that long is dropped; logout, the inactivity logout, `Session::secure()`'s new session id and the session sweep drop the session's pools at once; every pool of the process (user links and control links) holds at most `maxTotal` connections together (default 50): at the cap the least recently used idle pool is closed, else the request waits up to `waitTimeout` seconds (default 30) for a release.
- A connection is reused only while its session state is a fresh connection's: after any statement other than a plain read (`SET`, `USE`, transactions, temporary tables, locks, user variables, `INTO`, `INSERT`'s `LAST_INSERT_ID()`, prepared statements, `SET profiling`), it is closed on release (`Conn.dirty`), so a request never sees what an earlier one left, as with phpMyAdmin's connection per request.
- Pool errors with `ER_ACCESS_DENIED_ERROR` on reconnection invalidate the session (password changed), producing phpMyAdmin's "Access denied" login redirect.

## Query execution service

The browse/SQL path is specified step by step in [SQL editor and query pipeline](../features/09-sql-editor-query-pipeline.md). Server responsibilities in short:

1. **Split** multi-statement input using the delimiter (lexer). Reject when `multipleStatements` is not allowed for the caller (API-generated queries always run one statement).
2. **Classify** each statement: `SELECT`-like, `SHOW`, `EXPLAIN`, `CALL`, DML (`INSERT/UPDATE/DELETE/REPLACE`), DDL, maintenance (`ANALYZE/CHECK/OPTIMIZE/REPAIR/CHECKSUM`), `SET`, `USE` (which switches scope in the response), transaction control.
3. **Decide LIMIT**: append `LIMIT pos, maxRows` when the statement is a plain `SELECT` without `LIMIT`, `INTO OUTFILE`, `FOR UPDATE`/`LOCK IN SHARE MODE`, and not a `CALL`/`SHOW` (SHOW gets client-side paging). `rows='all'` skips the LIMIT only when under `ShowAll` policy or explicitly confirmed.
4. **Remember sorting**: if `RememberSorting` and the table has a saved `sorted_col` in `table_uiprefs` and the query is a bare browse query, inject the `ORDER BY`.
5. **Execute** with timing. Capture warnings (`SHOW WARNINGS`) when `ShowSQL` and warnings count > 0.
6. **Count**: for a `SELECT` without `GROUP BY`/`DISTINCT`/`UNION`/`HAVING`/aggregates, run `SELECT COUNT(*) FROM <same FROM/WHERE>`; following `Sql::countQueryResults`: when "just browsing" (single table, no WHERE beyond `WHERE 1`, no GROUP BY/DISTINCT/UNION/JOIN/HAVING) use `Table::countRecords` semantics (`SHOW TABLE STATUS` rows if `>= MaxExactCount`, else exact `COUNT(*)`), otherwise wrap the statement in a `SELECT COUNT(*)` subquery. The estimate is flagged `approximate: true`; current master shows no `~` marker in the Browse header (Database Structure keeps it), which we mirror. Views follow `MaxExactCountViews` (0 = unknown, `-1`).
7. **Metadata**: for every result field, resolve `table`/`orgTable`/`orgName`, flags, type, and whether it is part of the unique key used for row addressing; join FK info (`KEY_COLUMN_USAGE` + `pmadb.relation`), display fields (`table_info`), column comments and MIME transformations (`column_info`), `ENUM`/`SET` option lists.
8. **Respond** with rows (as arrays, nulls preserved, binary as base64 with `binary: true` flag and `ProtectBinary` policy applied, long text truncated per `LimitChars` with flag), fields, analysis, counts, timing, executed SQL + signature, messages, and the set of "query result operations" permitted (print, export, chart, create view, copy to clipboard, bookmark).
9. **History**: append to `pmadb.history` when `QueryHistoryDB`, trimming to `QueryHistoryMax`; otherwise the client keeps it in localStorage.
10. **Tracking hook**: DDL/DML that matches an active tracking version's tracked statements is logged into `pmadb.tracking` (`schema_sql_log`/`data_sql_log`).

## DDL and DML generation

All SQL that is executed is generated server-side by builders in `apps/server/src/ddl|dml` using `packages/sql-gen` (identifier quoting with backticks and escaping of backticks, string escaping via `mysql2.escape` with the connection's charset, hex literals for binary, `b'...'` for BIT, `NULL`, `DEFAULT`, `CURRENT_TIMESTAMP[(fsp)]`, expression defaults for 8.0.13+). Builders are pure functions `(input) => {statements: string[], warnings: string[]}` and are the unit under golden-file tests. Each builder's doc comment names the phpMyAdmin function it mirrors (e.g. `Table::generateAlter`, `CreateAddField::getColumnCreationQuery`, `InsertEdit::getQueryValuesForInsertAndUpdate`).

"Preview SQL" buttons call the same builders with `dryRun: true`; the response is the statement list. This guarantees the preview is what will run.

## Metadata (pmadb) service

Wraps `packages/metadata`. On session start it runs the equivalent of `Relation::getRelationParameters`: checks which of the 19 tables exist and are usable, caching the `*work` flags per server for the session. Every feature that needs a table asks the flag first and degrades exactly as phpMyAdmin does (e.g. no `relation` table → internal relations UI hidden, only FK constraints shown in Relation view; no `table_uiprefs` → column order kept in localStorage only). The `/api/servers/:s/metadata-storage/status` endpoint feeds the home-page warning and the "Create" action runs `create_tables.sql` with the control connection (`fixUpMissing` semantics: creates only the missing tables). Full table semantics: [Settings, preferences, pmadb](../features/08-settings-preferences-pmadb.md).

## Export engine

```
GET /api/export?... (or POST with options, returns a job id + one-shot download URL)
  → ExportJob { plugin, scope, objects, options, compression, aliases, templates }
  → plugin.stream(job, conn): AsyncIterable<Uint8Array | string>
  → optional transform: gzip (zlib) | zip (archiver, one entry or one per db/table when "separate files")
  → Response with Content-Disposition from the file-name template (@SERVER@ @DATABASE@ @TABLE@ + strftime)
```

Plugins implement `header()`, `exportDbHeader/Footer`, `exportDbCreate`, `exportStructure(table, mode)`, `exportData(table, rows stream)`, `exportRoutines`, `exportEvents`, `exportTriggers`, `exportMetadata`, `footer()`, each yielding chunks, mirroring `ExportPlugin`'s method set so the statement ordering in the SQL dump matches phpMyAdmin. Data rows are read with `connection.stream()` and `SET SESSION sql_mode` adjustments are mirrored. `SaveDir` saving writes the same stream to disk. "View output as text" returns `text/plain` inline up to a size cap with the same "output too large" notice. The `check-time-out` endpoint is kept for UI parity but always reports healthy.

## Import engine

```
POST /api/import/uploads        → create resumable upload (size, name, format hints) → uploadId
PATCH /api/import/uploads/:id   → append chunk (Content-Range), idempotent
POST /api/import/jobs           → { uploadId | serverFile (UploadDir) | pastedSql, format, options, scope } → jobId; starts
GET  /api/import/jobs/:id/events (SSE) → progress {bytes, statements, rows, warnings[], currentStatement}, done {queriesExecuted, message}, error {errno, message, failedStatementIndex}
```

Parsers are streaming: SQL (delimiter-aware, uses the lexer, skips `skip_queries`, honours `Allow interrupt` by checkpointing the statement index so a resume continues), CSV (RFC-ish with the configurable separators, `LOAD DATA` variant builds a `LOAD DATA LOCAL INFILE` with `mysql2`'s `infileStreamFactory`), ODS/XLSX via `exceljs` streaming reader, XML (phpMyAdmin export schema), MediaWiki, Shapefile (SHP+DBF → `GeomFromText` inserts). "Create table from CSV" column type analysis reproduces `Import::analyzeTable` (type detection for int/decimal/varchar with size buckets). Compressed uploads (`.gz`, `.bz2`, `.zip`) are decompressed on the fly; multi-file zips are refused with phpMyAdmin's message.

## Status monitor

`GET /api/servers/:s/status/monitor/stream?interval=…&series=…` is an SSE feed; the server samples `SHOW GLOBAL STATUS` (and `/proc` or `os` module equivalents of `SysInfo` for CPU/memory/swap when the server is local) on the interval and emits deltas per selected series. Log analysis endpoints run the same `general_log`/`slow_log` table queries phpMyAdmin does and return grouped rows. The advisor runs phpMyAdmin's rule set (exported by executing `Rules.php` into `packages/kbs/src/generated/advisor-rules.json`) with a port of Symfony ExpressionLanguage on PHP 8.3 value semantics (`packages/kbs/src/advisor/`), incl. `fired()`, `round()`, `substr()`, `preg_match()`, `ADVISOR_bytime`, `ADVISOR_timespanFormat`, `ADVISOR_formatByteDown` and their coercive argument passing; golden fixtures come from running phpMyAdmin's Advisor with PHP (`packages/kbs/scripts/`).

## Error model

```json
{ "error": { "code": "MYSQL_ERROR", "errno": 1146, "sqlstate": "42S02",
             "message": "Table 'shop.orderz' doesn't exist",
             "docUrl": "https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html#error_er_no_such_table",
             "sql": "SELECT * FROM `orderz`", "statementIndex": 0 } }
```

Codes: `MYSQL_ERROR`, `VALIDATION` (Zod issues), `AUTH_REQUIRED`, `AUTH_EXPIRED`, `FORBIDDEN` (allow/deny, missing privilege), `NOT_FOUND`, `CONFLICT` (e.g. bookmark exists), `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_SERVER` (version below minimum, mirroring `DatabaseServerVersionChecking`), `FEATURE_DISABLED` (pmadb table missing), `INTERNAL`. The message text for user-facing errors uses phpMyAdmin's msgids so translations apply.

## Observability

- Structured logs (pino) with request id, session id hash, server index, route, duration; SQL text logged only at `debug` level and never with values when `DBG.sql` is off.
- `/api/meta/health` for liveness; `/api/meta/build` for the version/git info shown on the home page (`GitInfoController` equivalent).
- Optional "Debug SQL" console tab is fed by a per-request array of executed statements with timings when `DBG.sql` is enabled, mirroring phpMyAdmin's `$_SESSION['debug']` structure.

## Bun / single-binary notes

No native addons in the server (SQLite via `better-sqlite3` is replaced by `node:sqlite` on Node 22.5+ and `bun:sqlite` on Bun through a tiny adapter). `bun build --compile` produces `bettermyadmin-{os}-{arch}` with the SPA assets embedded.

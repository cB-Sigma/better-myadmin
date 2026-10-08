# API reference

All endpoints live under `/api`. JSON in, JSON out, except where noted (streams, SSE, uploads). Request and response schemas are Zod objects in `packages/contracts/src/<resource>.ts`; this document is the human index. The phpMyAdmin route each endpoint replaces is listed so a feature can be traced back to its source behaviour (full table: [pMA route map](../reference/pma-route-map.md)).

Conventions:

- `:s` server index (1-based), `:db` database, `:t` table. Names are URL-encoded; the server validates them against the actual catalog before use and never interpolates them without quoting.
- Mutations are `POST` (we do not use `PUT/DELETE` verbs, because many phpMyAdmin actions are not idempotent resource replacements and because `DELETE` with a body is awkward). GETs are side-effect free.
- Every mutating request carries `X-BMA-Token`.
- Every response that executed SQL includes `executed: Array<{sql: string, ms: number, affectedRows?: number, warnings?: Warning[]}>` so the UI can render phpMyAdmin's green message with the SQL.
- Pagination: `pos` (offset) + `limit`, mirroring `pos`/`session_max_rows`. Lists that phpMyAdmin pages with `MaxTableList`/`MaxNavigationItems` use the same names.
- Errors: see [Backend: error model](04-backend-architecture.md#error-model).

## Auth and session

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/auth/state` | `{authenticated, server, user, twoFactorPending, servers:[{index,verbose,host,authType}], loginCookieRecall: username?}` | login page / `AuthenticationCookie` |
| POST | `/api/auth/login` | `{server, username, password, captchaToken?}` → `{ok, twoFactorRequired?, redirect}`; sets session cookie | cookie auth `authenticate()` |
| POST | `/api/auth/two-factor` | `{code}` or WebAuthn assertion → `{ok}` | `TwoFactor::check` |
| POST | `/api/auth/logout` | clears session (all servers if `LoginCookieDeleteAll`) → `{logoutUrl}` (`LogoutURL`) | `/logout` |
| POST | `/api/auth/switch-server` | `{server}` for `config`/`signon` types | `?server=` |
| POST | `/api/servers/:s/account/password` | `{mode:'none'|'text', password?, hashing?}` → sets current user password (`SET PASSWORD` / `ALTER USER`) | `/user-password` |
| POST | `/api/servers/:s/session/collation` | `{collation}` → `SET collation_connection` for the session | `/collation-connection` |

## Meta

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/meta/build` | version, git commit/branch, build date | `/git-revision` |
| GET | `/api/meta/version-check` | `{latest, isNewer, releaseDate}` (respects `VersionCheck`) | `/version-check` |
| GET | `/api/meta/health` | liveness | — |
| GET | `/api/i18n[?lang=xx]` | `{key, code, dir, languages: [{key, name}] \| null, warning}`: the request language (`Lang` → `lang` param → `bma_lang` cookie → Accept-Language → User-Agent → `DefaultLang`), the selector options when phpMyAdmin shows the selector, "Ignoring unsupported language code." when applicable; `lang` sets the cookie. Every API response uses the request language for its messages | `LanguageManager::selectLanguage`, `?lang=` |
| GET | `/api/meta/config-public` | the subset of config the client needs (directives flagged client-visible in `packages/config`) | inlined JS globals |
| POST | `/api/telemetry/error` | sanitized client error report, only when `SendErrorReports` allows | `/error-report` |

## Preferences and page settings

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/servers/:s/prefs` | merged prefs + per-directive source (`default|config|user`) + `userprefsDisallow` list | `UserPreferences::load` |
| POST | `/api/servers/:s/prefs` | `{patch: Record<directive, value>}` → validated, stored in `userconfig` (or returned for localStorage when `!userconfigwork`) | `/preferences/*` save |
| POST | `/api/servers/:s/prefs/reset` | `{directives?: string[]}` all or some to default | "Restore default value" |
| POST | `/api/servers/:s/prefs/import` | `{json}` or `{file}` + `merge?` | `/preferences/manage` import |
| GET | `/api/servers/:s/prefs/export?format=json|php` | download | `/preferences/manage` export |
| GET | `/api/servers/:s/prefs/forms` | the form definitions (groups, fields, types, validators) for Settings tabs and page-settings gear | `Config/Forms/*` |
| GET/POST | `/api/servers/:s/two-factor` | current backend; `POST {backend, setupToken...}` configure/disable | `/preferences/two-factor` |
| POST | `/api/servers/:s/console/config` | `{key, value}` console options | `/console/update-config` |
| POST | `/api/servers/:s/navigation/width` | `{width}` | `/navigation/update-width` |

## Navigation tree

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/servers/:s/navigation/databases?pos=&filter=` | paged db list, grouped per `NavigationTreeDbSeparator`, with `hidden` counts and `total` | `/navigation` (root) |
| GET | `/api/servers/:s/navigation/db/:db?container=tables|views|procedures|functions|events&pos=&filter=` | children of a container with counts; `container` omitted returns the container summary (counts) | `/navigation` (`aPath`/`vPath`) |
| GET | `/api/servers/:s/navigation/db/:db/table/:t` | columns + indexes nodes | `/navigation` |
| GET | `/api/servers/:s/navigation/hidden/:db` | hidden items list | `navigationhiding` |
| POST | `/api/servers/:s/navigation/hide` / `unhide` | `{db, itemType, itemName}` | `/navigation` hide/unhide |
| POST | `/api/servers/:s/navigation/reload` | drops server-side nav caches | "Reload navigation panel" |
| GET | `/api/servers/:s/recent-favorite` | `{recent:[], favorite:[]}` | `/table/recent-favorite` |
| POST | `/api/servers/:s/favorites` | `{action:'add'|'remove'|'sync', db, table, localList?}` | `/database/structure/favorite-table`, `/sync-favorite-tables` |

## Server scope

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/servers/:s` | server info block for home page (version, type, host, user, charset, SSL status; master shows no protocol version) + web server block + capabilities + metadata-storage status + warnings list | `HomeController` |
| GET | `/api/servers/:s/metadata-storage/status` | per-table existence and `*work` flags | `/check-relations` |
| POST | `/api/servers/:s/metadata-storage/create` | create missing pmadb tables (`fixUpMissing`) | `/check-relations` create |
| GET | `/api/servers/:s/databases?pos=&sortBy=&sortOrder=&withStats=` | db list with collation and (optional) stats | `/server/databases` |
| POST | `/api/servers/:s/databases` | `{name, collation}` create | `/server/databases/create` |
| POST | `/api/servers/:s/databases/drop` | `{names[]}` | `/server/databases/destroy` |
| GET | `/api/servers/:s/variables?filter=` | name, global, session, isEditable, doc | `/server/variables` |
| GET/POST | `/api/servers/:s/variables/:name` | get / `{value}` set (`SET GLOBAL`) | `/server/variables/get|set/{name}` |
| GET | `/api/servers/:s/collations` | charsets with collations, defaults, descriptions | `/server/collations` |
| GET | `/api/servers/:s/engines` | list | `/server/engines` |
| GET | `/api/servers/:s/engines/:engine?page=` | engine details/pages (InnoDB status, buffer pool...) | `/server/engines/{engine}[/{page}]` |
| GET | `/api/servers/:s/plugins` | grouped plugin list | `/server/plugins` |
| GET | `/api/servers/:s/status` | overview counters (traffic, connections, uptime, replication summary) | `/server/status` |
| POST | `/api/servers/:s/status/flush` | `{what:'status'|'tables'}` | flush links |
| GET | `/api/servers/:s/status/variables?filter=&alertOnly=` | all status vars with categories, docs, trend hints | `/server/status/variables` |
| GET | `/api/servers/:s/status/queries` | per-command stats | `/server/status/queries` |
| GET | `/api/servers/:s/processes?showFull=&sortBy=&order=` | process list | `/server/status/processes` |
| POST | `/api/servers/:s/processes/:id/kill` | `KILL <id>` | `/server/status/processes/kill/{id}` |
| GET | `/api/servers/:s/status/monitor/stream` (SSE) | live samples | `/server/status/monitor/chart` polling |
| POST | `/api/servers/:s/status/monitor/log-vars` | `{changes}` set `log_output`, `general_log`, `slow_query_log`, `long_query_time` | `/server/status/monitor/log-vars` |
| POST | `/api/servers/:s/status/monitor/slow-log` / `general-log` | `{from, to, groupSame, removeVariables}` → grouped rows | `/server/status/monitor/slow-log|general-log` |
| POST | `/api/servers/:s/status/monitor/query` | `{sql}` → EXPLAIN + profiling for log analysis | `/server/status/monitor/query` |
| GET | `/api/servers/:s/status/advisor` | fired rules grouped | `/server/status/advisor` |
| GET | `/api/servers/:s/replication` | primary/replica status | `/server/replication` |
| POST | `/api/servers/:s/replication/*` | `primary/add-user`, `replica/configure`, `replica/control {action: start|stop|reset, thread?: io|sql|both}`, `replica/skip-errors {count}` | `/server/replication` actions |
| GET | `/api/servers/:s/binlog?log=&pos=&showFull=` | logs list + events page | `/server/binlog` |
| GET | `/api/servers/:s/privileges/users?initial=&db=&table=` | account list with privilege summary and groups | `/server/privileges` |
| GET | `/api/servers/:s/privileges/users/:user/:host?tab=global|databases|tables|routines|password|login|export&db=&table=&routine=` | edit payload per tab | `/server/privileges` edit |
| POST | `/api/servers/:s/privileges/users` | create account (full form payload) | add user |
| POST | `/api/servers/:s/privileges/users/:user/:host/*` | `grants {scope, privileges, limits, ssl}`, `revoke`, `password`, `rename {newUser,newHost, mode}`, `lock`, `unlock`, `expire`, `group {name}` | edit actions, `/server/privileges/account-lock|unlock` |
| POST | `/api/servers/:s/privileges/users/delete` | `{accounts[], dropDatabases, revoke, reload}` | remove users |
| GET | `/api/servers/:s/privileges/users/:user/:host/export` | GRANT statements text | export |
| POST | `/api/servers/:s/privileges/flush` | `FLUSH PRIVILEGES` | reload privileges |
| GET/POST | `/api/servers/:s/user-groups` | list / create / edit allowed tabs / delete | `/server/user-groups*` |

## Database scope

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/servers/:s/databases/:db` | capabilities for tab bar (can create, counts, is `information_schema`, user privs) | `Menu` |
| GET | `/api/servers/:s/databases/:db/structure?pos=&sortBy=&sortOrder=` | table list with rows (exact/approx), engine, collation, size, overhead, comments, timestamps, favorites | `/database/structure` |
| GET | `/api/servers/:s/databases/:db/structure/real-row-count?table=` | exact count on demand | `/database/structure/real-row-count` |
| POST | `/api/servers/:s/databases/:db/tables/bulk` | `{tables[], action: empty|drop|analyze|check|checksum|optimize|repair|print|show-create|export|add-prefix|replace-prefix|copy-with-prefix|copy, params}` | `/database/structure/*` |
| POST | `/api/servers/:s/databases/:db/tables/show-create` | `{tables[]}` → SQL | `/database/structure/show-create` |
| GET | `/api/servers/:s/databases/:db/data-dictionary` | printable structure | `/database/data-dictionary` |
| POST | `/api/servers/:s/databases/:db/operations/*` | `rename {name, adjustPrivileges}`, `copy {target, what, createDb, addAutoIncrement, addConstraints, switch, adjustPrivileges}`, `drop`, `collation {collation, changeTables, changeColumns}`, `comment` | `/database/operations*` |
| POST | `/api/servers/:s/databases/:db/search` | `{words, mode: any|all|exact|regex, tables[], column?}` → per-table matches | `/database/search` |
| GET | `/api/servers/:s/databases/:db/search/matches?table=&...` | browse/delete URLs for a match | search results |
| GET | `/api/servers/:s/databases/:db/qbe?savedSearch=` / POST `.../qbe/generate` / `.../qbe/saved-searches` | QBE builder state, generated SQL, saved searches CRUD | `/database/qbe`, `savedsearches` |
| GET | `/api/servers/:s/databases/:db/multi-table-query/tables` / POST `.../query` | new multi-table query UI | `/database/multi-table-query*` |
| GET/POST | `/api/servers/:s/databases/:db/routines[/:name]` | list; create/edit `{type, params[], returns, definition, deterministic, definer, security, dataAccess, comment}`; drop; export; `execute {args}` | `/database/routines` |
| GET/POST | `/api/servers/:s/databases/:db/events[/:name]` | list, CRUD, `scheduler {on|off}` | `/database/events` |
| GET/POST | `/api/servers/:s/databases/:db/triggers[/:name]?table=` | list (db or table), CRUD, export | `/triggers` |
| GET/POST | `/api/servers/:s/databases/:db/tracking` | tracked/untracked tables; create versions; activate/deactivate/drop | `/database/tracking` |
| GET | `/api/servers/:s/databases/:db/designer?page=` | tables, columns, fks, internal relations, coordinates, settings | `/database/designer` |
| POST | `/api/servers/:s/databases/:db/designer/*` | `pages (new/save/save-as/delete/open)`, `coords`, `relation (create/delete)`, `display-field`, `settings`, `tables/add` | designer actions |
| POST | `/api/servers/:s/databases/:db/schema-export` | `{format: pdf|svg|dia|eps, page?, options}` → file stream | `/schema-export` |
| GET/POST | `/api/servers/:s/databases/:db/central-columns` | list (paged); add/edit/delete; `populate {table}`; `from-table-columns` | `/database/central-columns*` |
| GET | `/api/servers/:s/databases/:db/privileges` | users with db privileges | `/database/privileges` |
| GET | `/api/servers/:s/databases/:db/tables?names=1` | names only (pickers) | `/tables` |

## Table scope

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/servers/:s/databases/:db/tables/:t/meta` | columns (full definition), indexes, FKs + internal relations, display field, comments, MIME, uiprefs, engine, is view, row estimate, capabilities | `Table`, `Relation` |
| GET | `/api/servers/:s/databases/:db/tables/:t/structure` | structure tab payload (columns, indexes, partitions, information/statistics) | `/table/structure` |
| POST | `/api/servers/:s/databases/:db/tables/:t/columns/*` | `add {count, position, defs[]}`, `change {defs[]}`, `drop {names}`, `move {order[]}`, `key {type: primary|unique|index|spatial|fulltext, columns[]}`, `central-add`, `central-remove`, `reserved-word-check {names}` | `/table/add-field`, `/table/structure/*` |
| POST | `/api/servers/:s/databases/:db/tables/:t/columns/preview` | `{op, defs}` → SQL statements (dry run) | "Preview SQL" |
| GET/POST | `/api/servers/:s/databases/:db/tables/:t/indexes[/:name]` | edit form payload; create/edit `{name, type, columns:[{name, subPart}], keyBlockSize, parser, comment, visible}`; `rename`; drop | `/table/indexes*` |
| GET/POST | `/api/servers/:s/databases/:db/tables/:t/partitions/*` | `analyze|check|optimize|rebuild|repair|truncate|drop {partitions[]}`, `remove-partitioning`, `partitioning {definition}` | `/table/partition/*`, `/table/structure/partitioning` |
| GET/POST | `/api/servers/:s/databases/:db/tables/:t/relations` | relation view payload; save `{internal:[{col, refDb, refTable, refCol}], foreign:[{name, cols[], refDb, refTable, refCols[], onDelete, onUpdate}], displayField}` | `/table/relation` |
| POST | `/api/servers/:s/databases/:db/tables/:t/operations/*` | `order {column, dir}`, `move {targetDb, targetTable, what, ...}`, `options {name, comment, engine, collation, autoIncrement, packKeys, checksum, delayKeyWrite, transactional, pageChecksum, rowFormat}`, `copy {...}`, `maintenance {action}`, `empty`, `drop`, `referential-check` | `/table/operations`, `/table/maintenance/*` |
| POST | `/api/servers/:s/databases/:db/tables/:t/search` | criteria → signed SQL + redirect to browse | `/table/search` |
| POST | `/api/servers/:s/databases/:db/tables/:t/zoom-search` | criteria → points payload; `row` fetch by PK | `/table/zoom-search` |
| POST | `/api/servers/:s/databases/:db/tables/:t/find-replace` | `{column, find, replace, regex, preview}` → preview rows or affected | `/table/find-replace`, `/table/replace` |
| GET/POST | `/api/servers/:s/databases/:db/tables/:t/tracking` | report, versions, create, activate/deactivate, delete, export SQL, snapshot | `/table/tracking` |
| GET/POST | `/api/servers/:s/databases/:db/tables/:t/chart` | data for chart from query | `/table/chart` |
| GET | `/api/servers/:s/databases/:db/tables/:t/gis?sql=&labelColumn=&spatialColumn=&format=png|svg|pdf` | visualization data / files | `/table/gis-visualization` |
| GET | `/api/servers/:s/databases/:db/tables/:t/privileges` | table privileges | `/table/privileges` |
| GET | `/api/servers/:s/databases/:db/tables/:t/insert-form?rows=&where=&clone=` | per-column widget descriptors, functions, defaults, enum/set values, FK info | `/table/change` |
| POST | `/api/servers/:s/databases/:db/tables/:t/rows` | insert/update: `{rows:[{values, functions, nulls, where?}], afterInsert, ignore[], fkChecks}` | `/table/replace` |
| POST | `/api/servers/:s/databases/:db/tables/:t/rows/delete` | `{where[]}` | `/table/delete/rows` |
| POST | `/api/servers/:s/databases/:db/tables/:t/rows/preview` | dry run of insert/update SQL | "Preview SQL" |
| GET | `/api/servers/:s/databases/:db/tables/:t/cell?where=&column=&transform=` | raw cell bytes (BLOB download, image inline, transformation wrapper) | `/table/get-field`, `/transformation/wrapper` |
| GET | `/api/servers/:s/databases/:db/tables/:t/foreign-values?column=&search=&pos=` | FK browse popup / dropdown data (`ForeignKeyMaxLimit`, ordering) | `/browse-foreigners`, `/sql/get-relational-values` |
| GET | `/api/servers/:s/databases/:db/tables/:t/enum-values?column=` / `set-values` | option lists for grid editors | `/sql/get-enum-values`, `/sql/get-set-values` |
| POST | `/api/servers/:s/databases/:db/tables/:t/uiprefs` | `{sortedCol?, colOrder?, colVisib?}` | `/sql/set-column-preferences` |
| GET/POST | `/api/servers/:s/databases/:db/tables/:t/normalization/*` | wizard steps (1NF 1-4, 2NF, 3NF, partial-dependencies, create tables, move repeating group, add primary) | `/normalization/*` |
| GET | `/api/servers/:s/databases/:db/tables/:t/columns?names=1` | names (pickers) | `/columns` |

## Views

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/servers/:s/databases/:db/views/:v` | definition (algorithm, definer, security, check option, SQL) | `/view/create` (edit) |
| POST | `/api/servers/:s/databases/:db/views` | create/alter `{orReplace, algorithm, definer, security, name, columns, as, checkOption}` | `/view/create` |
| POST | `/api/servers/:s/databases/:db/views/:v/operations/*` | `rename`, `drop`, `options` | `/view/operations` |

## SQL execution

| Method | Path | Purpose | pMA |
|---|---|---|---|
| POST | `/api/servers/:s/query` | `{sql, db?, table?, pos, maxRows, delimiter, params?, fkChecks?, rollback?, showAsPhp?, profiling?, explain?, isBrowse?, displayOptions, bookmark?: {label, shared, replace}}` → result envelope (rows, fields, counts, analysis, executed, messages, operations, redirectScope?) | `/sql`, `/database/sql`, `/table/sql`, `/server/sql` |
| POST | `/api/servers/:s/query/cancel` | `{queryId}` → `KILL QUERY` | — (new) |
| POST | `/api/servers/:s/query/simulate` | `{sql}` → matched rows for UPDATE/DELETE | `/import/simulate-dml` |
| POST | `/api/servers/:s/query/explain` | `{sql}` | Explain link |
| POST | `/api/servers/:s/sql/format` | `{sql}` → formatted | `/database/sql/format` |
| POST | `/api/servers/:s/sql/lint` | `{sql}` → issues (fallback; client lints in a worker) | `/lint` |
| GET | `/api/servers/:s/sql/autocomplete?db=` | tables and columns for the editor | `/database/sql/autocomplete` |
| GET | `/api/servers/:s/sql/default-fk-check` | `{checked}` from `DefaultForeignKeyChecks` + server var | `/sql/get-default-fk-check-value` |
| GET | `/api/servers/:s/sql/history?limit=` | query history (pmadb or empty) | console history |
| GET/POST | `/api/servers/:s/bookmarks` | list; create `{label, sql, shared, db}`; `/:id/delete`; `/:id/run {variables}` returns signed SQL | `/console/bookmark/*`, bookmark forms |
| POST | `/api/servers/:s/query/sign` | `{sql}` → `{sig}` for building browse links (FK traversal, search redirects) | `Core::signSqlQuery` |

## Export

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/export/options?scope=server|database|table&format=` | plugin list and option descriptors (labels, defaults from `Export[*]`) | `/export` page |
| POST | `/api/export/jobs` | full option payload (scope, objects, structure/data per table, rows range, aliases, output, compression, format options) → `{jobId, downloadUrl}` | `/export` submit |
| GET | `/api/export/jobs/:id/download` | the stream (`Content-Disposition` from template) | output |
| GET | `/api/export/jobs/:id/text` | inline text output when "View output as text" | output as text |
| GET/POST | `/api/export/templates?type=` | list; create/update/delete/load | `/export/template/*` |
| GET | `/api/export/check-time-out` | always healthy (kept for UI parity) | `/export/check-time-out` |
| POST | `/api/export/rows` | selected rows export (`where[]`) | `/table/export/rows` |

## Import

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/import/options?scope=&format=` | plugin list and options (`Import[*]` defaults, `upload_max_filesize` equivalent `MaxUploadSize`), server upload dir files | `/import` page |
| POST | `/api/import/uploads` / PATCH `/api/import/uploads/:id` | resumable chunked upload | `$_FILES` |
| POST | `/api/import/jobs` | `{source: {uploadId}|{serverFile}|{sql}, format, options, scope, skipQueries, allowInterrupt, fkChecks, charset}` → `{jobId}` | `/import` submit |
| GET | `/api/import/jobs/:id/events` (SSE) | progress / done / error | `/import-status` polling |
| POST | `/api/import/jobs/:id/resume` | continue after interrupt from statement N | partial import resume |

## Transformations

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/transformations` | overview: all output/input plugins with descriptions and MIME types | `/transformation/overview` |

## GIS

| Method | Path | Purpose | pMA |
|---|---|---|---|
| POST | `/api/gis/preview` | `{wkt | gisData}` → SVG + WKT (editor preview) | `/gis-data-editor` |

## Response envelope for `POST /query` (abridged)

```ts
type QueryResponse = {
  scope: { server: number; db?: string; table?: string }           // may change after USE
  statements: Array<{
    sql: string; signed: string; sig: string; kind: StatementKind;  // see features/09 flags table
    executed: Executed[];                                            // the actual SQL incl. LIMIT/COUNT
    message: { type: 'success'|'notice'|'error'; text: string; affectedRows?: number; errno?: number; docUrl?: string };
    result?: {
      fields: Field[];                                               // name, orgName, table, orgTable, type, flags, length, renderer, editable, isKey, fk?, transformation?, comment?, truncated?
      rows: Array<Array<null | string | number | { b64: string; bytes: number }>>;
      rowCount: number; totalRows: number | null; approximate: boolean; pos: number; maxRows: number | 'all';
      uniqueKey: { table: string; columns: string[] } | null;        // for WHERE building
      editable: boolean; reason?: string;                            // e.g. view / no single table / information_schema
      sort: Array<{ col: string; dir: 'ASC'|'DESC' }>; rememberedSort?: boolean;
      operations: { print: boolean; export: boolean; chart: boolean; createView: boolean; bookmark: boolean; copyClipboard: boolean };
      profiling?: ProfilingRow[]; explain?: Row[]; warnings?: Warning[];
      timing: { ms: number };
    };
  }>;
  historyId?: number;
};
```

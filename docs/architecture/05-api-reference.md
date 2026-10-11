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
| GET | `/api/servers/:s/account/password` | the change-password form: `{origAuthPlugin, showHashing, showSslNotice, authPlugins[], allowNoPassword}` (refused for `config` auth) | `GET /user-password` |
| POST | `/api/servers/:s/account/password` | `{nopass, pma_pw, pma_pw2, authentication_plugin?}` → `ALTER USER` / `UPDATE mysql.user` / `SET password` + `FLUSH PRIVILEGES`; `{message, sql}` with the password masked; the session keeps working with the new password | `POST /user-password` |
| POST | `/api/servers/:s/session/collation` | `{collation_connection}` → stored as this login's `DefaultConnectionCollation`; new pooled connections run `SET collation_connection` (skipped for `''` and the `SET NAMES` collation) | `/collation-connection` |
| POST | `/api/servers/:s/themes/set` | `{theme}` → `ThemeDefault` in the user preferences (load, set, save); the theme itself lives in the client-side store (X31) | `/themes/set` |

## Meta

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/meta/build` | version, git commit/branch, build date | `/git-revision` |
| GET | `/api/meta/version-check` | `{}` or `{version, date}` of the latest compatible release (respects `VersionCheck`; feed from `BMA_VERSION_FEED_URL`, cached 6 h) | `/version-check` |
| GET | `/api/meta/health` | liveness | — |
| GET | `/api/i18n[?lang=xx]` | `{key, code, dir, languages: [{key, name}] \| null, warning}`: the request language (`Lang` → `lang` param → `bma_lang` cookie → Accept-Language → User-Agent → `DefaultLang`), the selector options when phpMyAdmin shows the selector, "Ignoring unsupported language code." when applicable; `lang` sets the cookie. Every API response uses the request language for its messages | `LanguageManager::selectLanguage`, `?lang=` |
| GET | `/api/meta/config-public` | the subset of config the client needs (directives flagged client-visible in `packages/config`) | inlined JS globals |
| POST | `/api/telemetry/error` | `{exception_type, get_settings?}` → `{report_setting}`; without `send_error_report` → `{report}` (modal preview); with it → sends to `BMA_ERROR_REPORT_URL` or the server log, `{message}`; `always_send` persists `SendErrorReports=always` | `/error-report` |

## Preferences and page settings

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/servers/:s/prefs` | `{storage: db|local|session, mtime, configData, values}`: every user-preference path with effective value, phpMyAdmin default, config value, source (`default|config|user`) and `disallowed` (`UserprefsDisallow`) | `UserPreferences::load` + `apply` |
| POST | `/api/servers/:s/prefs` | `{configData}` replaces the stored flat map (`2fa` kept when absent); pmadb `userconfig`, else local store, else session. Form validation arrives with the Settings UI | `UserPreferences::save` |
| POST | `/api/servers/:s/prefs/option` | `{path, value, default?}` one value, removed when equal to the default (phpMyAdmin's when omitted) | `UserPreferencesHandler::setUserValue` (`/console/update-config`, theme, lang, nav width...) |
| POST | `/api/servers/:s/prefs/reset` | wipe all preferences (`save([])`, which keeps `2fa`) | `/preferences/manage` Reset (`submit_clear`) |
| POST | `/api/servers/:s/prefs/import` | `{json}` or `{file}` + `merge?` | `/preferences/manage` import |
| GET | `/api/servers/:s/prefs/export?format=json|php` | download | `/preferences/manage` export |
| GET | `/api/servers/:s/prefs/forms` | the form definitions (groups, fields, types, validators) for Settings tabs and page-settings gear | `Config/Forms/*` |
| GET/POST | `/api/servers/:s/two-factor` | current backend; `POST {backend, setupToken...}` configure/disable | `/preferences/two-factor` |
| POST | `/api/servers/:s/navigation/width` | `{width}` | `/navigation/update-width` |

## Navigation tree

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/servers/:s/navigation/tree?pos=&searchClause=&db=` | the whole tree (`NavTreeResponse`): panel settings, root list (database fast filter, `dbselector` page selector, `New` + database and group nodes, already grouped and sorted), user errors. Without `pos`, `db` selects the page holding that database (`getNavigationDbPos`) | `/navigation` `full=1` (`renderState`) |
| POST | `/api/servers/:s/navigation/tree` | `{pos?, searchClause?, db?, paths: [{aPath, vPath, pos2Name?, pos2Value?, pos3Name?, pos3Value?}], reload}`: the tree with the listed branches expanded (state restore); `reload: true` is "Reload navigation panel" and also sets the session's `dbs_to_test` to false (#14252) | `/navigation` `reload=1` + `n{i}_aPath`… |
| GET | `/api/servers/:s/navigation/branch?path=…&pos=&pos2Name=&pos2Value=&pos3Name=&pos3Value=&searchClause=&searchClause2=` | one branch (`NavBranchResponse`: `{list, error, searchResults, results}`); `path` repeats per aPath component after `root` (`db`, `db/tables`, `db/tables/t`, `db/tables/t/columns`); no `path` is the root list (database search). `results` is "%s result(s) found" when a search clause is given | `/navigation` `aPath`/`vPath` (`renderPath`) |
| GET | `/api/servers/:s/navigation/hidden?db=` | `{available, hidden: {item_type: names[]}, counts: {db: n}}` | `Navigation::getHiddenItems`, `Node::getNavigationHidingData` |
| POST | `/api/servers/:s/navigation/hide` / `unhide` | `{dbName, itemType, itemName}` | `/navigation` `hideNavItem` / `unhideNavItem` |
| GET | `/api/servers/:s/recent-favorite` | `{recent, favorite, numRecentTables, numFavoriteTables, syncFavorites}` (lists loaded once per session) | navigation recent/favorite lists |
| POST | `/api/servers/:s/recent` | `{db, table}` adds a recently used table (trimmed to `NumRecentTables`); `POST /query` with a `table` does the same | `RecentTableHandling` middleware |
| POST | `/api/servers/:s/favorites` | `{action:'add'|'remove', db, table, favoriteTables}` → `{changes, message?, user (sha1), favoriteTables (localStorage JSON), favorite}`; *Favorite List is full!* at `NumFavoriteTables` | `/database/structure/favorite-table` |
| POST | `/api/servers/:s/favorites/sync` | `{favoriteTables}` localStorage → storage when the stored list is empty | `/sync-favorite-tables` |

## Server scope

| Method | Path | Purpose | pMA |
|---|---|---|---|
| GET | `/api/servers/:s/metadata-storage/status?db=` | `RelationParameters::toArray()`, the home and DB-operations notices, the one create action offered, the check page's table and feature lines, the store serving each per-user feature, the control-link error | `/check-relations`, `HomeController` notice |
| POST | `/api/servers/:s/metadata-storage/create` | `{action: create_pmadb|fixall_pmadb|fix_pmadb, db?}` → `{message, status}` | `/check-relations` (`createPmaDatabase`, `fixPmaTables`) |
| GET | `/api/servers/:s` | server scope for the shell: breadcrumb name, host/verbose, version, capabilities (`isSuperUser`, `isGrantUser`, `isCreateUser`, binary logs, tracker, central columns, column comments, configurable menus, `CURRENT_USER()`), the visible server tab keys | `Menu::getServerTabs` |
| GET | `/api/servers/:s/home` | home page blocks: server selection, change-password link, connection collations, Database server, Web server, version/git info, warnings, configuration-storage notice, partial-logout flag | `HomeController` |
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
| GET | `/api/servers/:s/databases/:db` | database scope: visible db tab keys (with the empty-database warning), `isSystemSchema`, table count, pmadb database comment | `Menu::getDbTabs` |
| GET | `/api/servers/:s/databases/:db/tables/:t/capabilities` | table scope: visible table tab keys, `isView`, `isUpdatableView`, table comment (without `; InnoDB free`) | `Menu::getTableTabs` |
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
| GET | `/api/servers/:s/databases/:db/tables/:t/structure` | `StructureResponse`: columns (print type, collation + description, attribute, default, comment, extra, primary/index icons, row-action availability, distinct-values and drop SQL), indexes + duplicate notices, partitions card, Information card (sizes formatted), links, config flags | `/table/structure` |
| GET | `/api/servers/:s/databases/:db/tables/:t/columns/form?fields=a&fields=b` | change form of the selected columns in table order: option lists (type catalog, attributes, default types, virtuality, charsets/collations, engines, privileges) + per column the values the form shows and the `_orig` snapshot | `/table/structure/change` |
| GET | `/api/servers/:s/databases/:db/tables/:t/columns/add-form` | option lists of the add-columns form | `/table/add-field` (form) |
| POST | `/api/servers/:s/databases/:db/tables/:t/columns/add` | `{columns[], indexes[], where: last|first|after, afterField, onlineTransaction, dryRun}` | `/table/add-field` |
| POST | `/api/servers/:s/databases/:db/tables/:t/columns/change` | `{columns[] (values + orig + moveTo + adjustPrivileges), onlineTransaction, dryRun}` | `/table/structure/save` |
| POST | `/api/servers/:s/databases/:db/tables/:t/columns/drop` | `{columns[], source: row|bulk}` (row = the /sql link, bulk = the Yes/No page) | `/sql`, `/table/structure/drop` |
| POST | `/api/servers/:s/databases/:db/tables/:t/columns/key` | `{type: PRIMARY|UNIQUE|INDEX|SPATIAL|FULLTEXT, columns[], source: row|bulk, confirmed}` → `confirm` for a bulk Primary on a table with a PK | `/table/structure/add-key`, `/primary`, `/unique`, `/index`, `/spatial`, `/fulltext` |
| POST | `/api/servers/:s/databases/:db/tables/:t/columns/move` | `{order[], dryRun}` | `/table/structure/move-columns` |
| POST | `/api/servers/:s/databases/:db/tables/:t/columns/preview` | `{op: add|change|move, body}` → `{preview}` (always a dry run of the same builders) | "Preview SQL" |
| POST | `/api/servers/:s/databases/:db/tables/:t/columns/reserved-word-check` | `{names[], table?}` → `{reserved, message}` | `/table/structure/reserved-word-check` |
| GET | `/api/servers/:s/databases/:db/tables/:t/indexes/form?index=…|create=N` | the index editor as phpMyAdmin pre-fills it | `/table/indexes` (form), `/table/indexes/rename` (form) |
| POST | `/api/servers/:s/databases/:db/tables/:t/indexes` | `{oldIndex, index: {name, choice, keyBlockSize, type, parser, comment, columns:[{name, subPart, collation}]}, dryRun}` (phpMyAdmin has no index visibility control) | `/table/indexes` |
| POST | `/api/servers/:s/databases/:db/tables/:t/indexes/rename` / `drop` | `{oldIndex, name, dryRun}` / `{name}` (drop = the /sql link) | `/table/indexes/rename`, `/sql` |
| GET | `/api/servers/:s/databases/:db/tables/:t/partitions/form` | partition editor pre-filled from SHOW CREATE TABLE | `/table/structure/partitioning` |
| POST | `/api/servers/:s/databases/:db/tables/:t/partitions/partitioning` / `maintenance` / `remove-partitioning` | `{partitioning, dryRun}` / `{operation, partition}` / — | `/table/structure/partitioning`, `/table/partition/*`, `/sql` |
| GET | `/api/servers/:s/databases/:db/create-table/form` | option lists, 4 default rows | `/table/create` (form) |
| POST | `/api/servers/:s/databases/:db/tables` | create table `{table, columns[], indexes[], comment, collation, engine, connection, partitioning, dryRun}` | `/table/create` |
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
| GET | `/api/servers/:s/databases/:db/tables/:t/uiprefs` | validated `{sorted_col, col_order, col_visib, createTime}` (stale values removed) | `Table::getUiProp` |
| POST | `/api/servers/:s/databases/:db/tables/:t/uiprefs` | `{col_order?, col_visib?, table_create_time}` (comma lists) | `/sql/set-column-preferences` |
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
| POST | `/api/servers/:s/query` | `{sql, db?, table?, pos, maxRows?, delimiter, fromQueryBox, sig?, fkChecks?, rollback?, params? ({':name': value}), showAsPhp?, profiling? (true = on, false = off, omitted = unchanged), queryId?, noHistory?, bookmark? {label, shared, replace}}` → `{statements[], executed, db, table, ajaxReload?, reloadNavigation, sqlQuery}`; each statement has `kind` (`resultset`/`affected`/`empty`/`error`/`php`/`import`), `message`, `card` (SQL shown + `links` {editInline, edit, explain, php, refresh, profiling}), `error` (mysqlDie: static analysis, SQL, server message), `result`, `moreResults` (CALL), `profiling`, `warnings`. A `sig` that does not verify → 400 "Missing parameter: sql_query". Afterwards the request records `Current::$sqlQuery` in the SQL history (StatementHistory; `noHistory` skips it), adds the posted db/table to the recent tables (RecentTableHandling) and, with `bookmark`, stores the posted SQL once as a bookmark in the final database when the run completed | `/import` (SQL tab, console), `/sql` |
| POST | `/api/servers/:s/query/cancel` | `{queryId}` → `{killed}` (`KILL QUERY` on the connection running that request) | — (new, X14) |
| POST | `/api/servers/:s/query/simulate` | `{sql, db?, delimiter}` → `{sqlData: [{sqlQuery, matchedRows, matchedRowsSql, matchedRowsSig}] \| null, message?}` | `/import/simulate-dml` |
| POST | `/api/servers/:s/sql/format` | `{sql, singleLine}` → `{sql}` (ported Formatter) | `/database/sql/format` |
| POST | `/api/servers/:s/sql/lint` | `{sql, editorType?: event\|routine\|trigger}` → `{lints}` (fallback; the editor lints in a worker) | `/lint` |
| GET | `/api/servers/:s/sql/autocomplete?db=` | `{tables: {table: [{field, columnHint}]}}` | `/database/sql/autocomplete` |
| GET | `/api/servers/:s/sql/default-fk-check` | `{defaultFkCheckValue}` from `DefaultForeignKeyChecks` + server var | `/sql/get-default-fk-check-value` |
| GET | `/api/servers/:s/sql/form?db=&table=&sqlQuery=` | what the SQL tab renders server-side: scope, legend name, prefilled query (`DefaultQuery*` expanded), columns, FK default, profiling support, server parser context, SQL-box settings; 404 "No databases selected." / "No table selected." | `/server/sql`, `/database/sql`, `/table/sql` |
| GET | `/api/servers/:s/sql/history` | `{history: rows newest first, or false, queryHistoryDB}`; `POST /query` records the last statement like `StatementHistory` (`noHistory` skips it) | `Console\History::getHistory` |
| GET | `/api/servers/:s/console/config` | `{settings (Console/* with the user preferences applied), debugSql, maxCharactersInDisplayedSql, confirm}` | `console/display.twig` data |
| POST | `/api/servers/:s/console/config` | `{key, value}` validated like `parseValueParam` (400 "Unexpected parameter value."), stored as `Console/<key>` in the user preferences (configuration storage or session) → `{message}` | `/console/update-config` |
| GET/POST | `/api/servers/:s/bookmarks` | `?db=` list (own + shared); create `{db, label, query, shared, replace}`; `GET /:id` show; `POST /:id/delete`; `POST /:id/run {db, variables, allUsers, noHistory}` runs it through the SQL-box pipeline | bookmark forms, `/import` `id_bookmark` / `action_bookmark` |
| GET/POST | `/api/servers/:s/console/bookmarks` | console list with *Showing N bookmarks (both private and shared)*; add `{db, label, bookmark_query, shared}` → *Succeeded* / *Failed* | `/console/bookmark/refresh`, `/console/bookmark/add` |
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

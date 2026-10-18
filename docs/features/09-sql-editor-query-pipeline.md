# 09 — SQL Editor & Query Execution Pipeline

Everything below is derived from the phpMyAdmin master checkout (Oct 2026) at `scratchpad/pma`. File paths are relative to that root. Config directives are named with the default enforced by `src/Config/Settings.php` (or the dedicated settings class). Where the sql-parser library (`phpmyadmin/sql-parser ^6.0`, not vendored in this checkout) is referenced, behaviour is cited from the library's `src/Utils/*` sources on GitHub master.

---

## Scope & source map

| Concern | Source |
|---|---|
| SQL tab page (server/db/table) | `src/Controllers/Server/SqlController.php` (`/server/sql`), `src/Controllers/Database/SqlController.php` (`/database/sql`), `src/Controllers/Table/SqlController.php` (`/table/sql`) |
| Query form rendering | `src/SqlQueryForm.php` (`getHtml`, `init`), `resources/templates/sql/query.twig` |
| Form submit target (SQL tab, console, inline edit) | `src/Controllers/Import/ImportController.php` (`/import`) → `src/Import/Import.php` (`runQuery`, `executeQuery`, `handleRollbackRequest`, `checkIfRollbackPossible`) → `src/Plugins/Import/ImportSql.php` (`doImport`, statement splitting via `BufferedQuery`) |
| Browse/URL execution target | `src/Controllers/Sql/SqlController.php` (`/sql`) |
| Execution core | `src/Sql.php` (`executeQueryAndSendQueryResponse`, `executeQueryAndGetQueryResponse`, `executeTheQuery`, `countQueryResults`, `isAppendLimitClause`, `getSqlWithLimitClause`, `isRememberSortingOrder`, `handleSortOrder`, `isJustBrowsing`, `getDefaultSqlQueryForBrowse`, `getQueryResponseForNoResultsReturned`, `getQueryResponseForResultsReturned`, `getHtmlForStoredProcedureResults`, `getMessageForNoRowsReturned`, `getDetailedProfilingStats`, `storeTheQueryAsBookmark`, `hasNoRightsToDropDatabase`, `handleQueryExecuteError`) |
| Parse/analyse | `src/ParseAnalyze.php` (`sqlQuery`) wrapping `PhpMyAdmin\SqlParser\Utils\Query::getAll` → `StatementInfo` / `StatementFlags` / `StatementType` |
| Message box with SQL + action links | `src/Html/Generator.php` (`getMessage`, `formatSql`, `mysqlDie`, `linkOrButton`, `getBackUrlHtml`, `getStartAndNumberOfRowsFieldsetData`) |
| Results message ("Showing rows…") | `src/Display/Results.php` (`setMessageInformation`, `getTable`, `setConfigParamsForDisplayTable`, `setDisplayPartsForShow`, `setMimeMap`, `getResultsOperations`) |
| Result templates | `resources/templates/sql/sql_query_results.twig`, `sql/no_results_returned.twig`, `sql/_bookmark.twig`, `sql/profiling_chart.twig` |
| Simulate DML | `src/Controllers/Import/SimulateDmlController.php` (`/import/simulate-dml`), `src/Import/SimulateDml.php` |
| Autocomplete | `src/Controllers/Database/SqlAutoCompleteController.php` (`/database/sql/autocomplete`) + `codeMirrorAutoCompleteOnInputRead` in `resources/js/modules/functions.ts` |
| Format | `src/Controllers/Database/SqlFormatController.php` (`/database/sql/format`) using `SqlParser\Utils\Formatter` |
| Lint | `src/Controllers/LintController.php` (`/lint`), `src/Linter.php`, `resources/js/codemirror/addon/lint/sql-lint.ts` |
| Bookmarks | `src/Bookmarks/Bookmark.php`, `src/Bookmarks/BookmarkRepository.php`, `src/Controllers/Console/Bookmark/AddController.php` (`/console/bookmark/add`), `RefreshController.php` (`/console/bookmark/refresh`), bookmark actions inside `ImportController` (`id_bookmark`/`action_bookmark`) and `Controllers/Sql/SqlController::addBookmark` (`store_bkm`) |
| Query history | `src/Console/History.php`, `src/Http/Middleware/StatementHistory.php`, `src/Console/Console.php`, `resources/templates/console/display.twig`, `console/bookmark_content.twig`, `resources/js/modules/console.ts`, `resources/js/modules/console/config.ts`, `src/Controllers/Console/UpdateConfigController.php` (`/console/update-config`) |
| Profiling | `src/Profiling.php`, `src/Http/Middleware/ProfilingChecking.php`, `sql/profiling_chart.twig`, `resources/js/sql.ts` (`buildProfilingChart`, `initProfilingTables`) |
| Foreign key checks | `src/Utils/ForeignKey.php`, `src/Controllers/Sql/DefaultForeignKeyCheckValueController.php` (`/sql/get-default-fk-check-value`) |
| Signed SQL in URLs | `src/Core.php` (`signSqlQuery`, `checkSqlQuerySignature`) |
| DB layer | `src/Dbal/DatabaseInterface.php` (`query`, `tryQuery`, `tryMultiQuery`, `nextResult`, `affectedRows`, `insertId`, `getWarnings`, `getFieldsMeta`, `lastQueryExecutionTime`), `src/Query/Utilities.php` (`isSystemSchema`, `debugLogQueryIntoSession`), `src/Query/Cache.php` (table row-count cache used by `countRecords`) |
| Editor JS | `resources/js/sql.ts`, `resources/js/modules/functions.ts` (`getSqlEditor`, `onloadCodeMirrorEditor`, `teardownCodeMirrorEditor`, `bindCodeMirrorToInlineEditor`, `onloadSqlQueryEditEvents`, `updateQueryParameters`, `confirmQuery`, `checkSqlQuery`, `loadForeignKeyCheckbox`, `getKeyboardFormSubmitEventHandler`), `resources/js/modules/sql-highlight.ts` |
| Page settings panel | `src/Config/Forms/Page/SqlForm.php` → `src/Config/Forms/User/SqlForm.php` |
| pmadb schema | `resources/sql/create_tables.sql` (`pma__bookmark`, `pma__history`, `pma__table_uiprefs`) |
| Remembered sorting storage | `src/Table/Table.php` (`getUiProp`, `setUiProp`, `removeUiProp`, `loadUiPrefs`, `saveUiPrefsToDb`, `countRecords`, `isUpdatableView`), `src/Table/UiProperty.php` |

### Config directives touched by this area (with defaults)

| Directive | Default | Where it bites |
|---|---|---|
| `$cfg['ShowSQL']` | `true` | `Generator::getMessage` — whether the executed SQL card is rendered at all; `Sql::getQueryResponseForNoResultsReturned` adds `sql_query` JSON only when true |
| `$cfg['Confirm']` | `true` | JS `confirmQuery` — if `Messages.strDoYouReally` is empty (Confirm off) no confirmation prompt |
| `$cfg['QueryHistoryDB']` | `false` | `History::setHistory/getHistory` — pmadb vs. session history |
| `$cfg['QueryHistoryMax']` | `25` | both session array trimming (`array_shift`) and pmadb purge (`purgeHistory`) |
| `$cfg['IgnoreMultiSubmitErrors']` | `false` | `Import::executeQuery` continues after errors; `Sql::executeTheQuery` turns error into inline message instead of aborting |
| `$cfg['MaxCharactersInDisplayedSQL']` | `1000` (coerced to 1000 if `<1`) | truncation in `Generator::formatSql`, hides Explain/PHP-code links when exceeded (`$queryTooBig`), history skips longer queries, `ResponseRenderer` omits `reloadQuerywindow.sql_query` if `>=` limit, `ImportController` skips parsing if longer |
| `$cfg['RetainQueryBox']` | `false` | initial `checked` state of "Retain query box"; JS auto-hides the query box after a run when unchecked |
| `$cfg['CodemirrorEnable']` | `true` | `query.twig` shows Format buttons only when true; CodeMirror JS is loaded conditionally (`window.CodeMirror` undefined otherwise → plain textarea) |
| `$cfg['LintEnable']` | `true` | governs loading of `codemirror/addon/lint/sql-lint` (presence of `window.CodeMirror.sqlLint` enables lint gutter in `getSqlEditor`) |
| `$cfg['EnableAutocompleteForTablesAndColumns']` | `true` | `SqlAutoCompleteController` returns `[]` when false |
| `$cfg['DefaultForeignKeyChecks']` | `'default'` (`'enable'`/`'disable'`) | `ForeignKey::isCheckEnabled` initial state of "Enable foreign key checks" |
| `$cfg['MaxRows']` | `25` | initial `$_SESSION['tmpval']['max_rows']` (`Results::setConfigParamsForDisplayTable`, `Generator::getStartAndNumberOfRowsFieldsetData`) |
| `$cfg['RememberSorting']` | `true` | `Sql::isRememberSortingOrder` |
| `$cfg['TablePrimaryKeyOrder']` | `'NONE'` (`'ASC'`/`'DESC'`) | `Sql::getDefaultSqlQueryForBrowse` default ORDER BY |
| `$cfg['DefaultQueryTable']` | `'SELECT * FROM @TABLE@ WHERE 1'` | prefilled query on table SQL tab via `Util::expandUserString` |
| `$cfg['DefaultQueryDatabase']` | `''` | prefilled query on database SQL tab |
| `$cfg['AllowSharedBookmarks']` | `true` | shows "Let every user access this bookmark"; `BookmarkRepository` includes `user = ''` rows |
| `$cfg['AllowUserDropDatabase']` | `false` | `Sql::hasNoRightsToDropDatabase` (non-superusers blocked) |
| `$cfg['MaxExactCount']` | `50000` | `countQueryResults` / `Table::countRecords` exact vs approximate |
| `$cfg['MaxExactCountViews']` | `0` | `Table::countRecords` for views (0 = never count, returns -1 → "at least this number of rows" hint) |
| `$cfg['RowActionLinksWithoutUnique']` | `false` | editable decision when no unique key in result set |
| `$cfg['TextareaCols']` / `TextareaRows` | `40` / `15` | textarea size and Columns list `size` |
| `$cfg['TextareaAutoSelect']` | `false` | `data-textarea-auto-select` → select-all on click (plain textarea only) |
| `$cfg['SQLQuery']['Edit' / 'Explain' / 'ShowAsPHP' / 'Refresh']` | all `true` (`src/Config/Settings/SqlQueryBox.php`) | which action links appear under the executed SQL |
| `$cfg['ActionLinksMode']` | `'both'` | Insert button renders `<<` with title when icons enabled |
| `$cfg['Console'][…]` | `StartHistory=false, AlwaysExpand=false, CurrentQuery=true, EnterExecutes=false, DarkTheme=false, Mode='info', Height=92, GroupQueries=false, OrderBy='exec', Order='asc'` (`src/Config/Settings/Console.php`) | console behaviour; persisted per user through `/console/update-config` |
| `$cfg['ConsoleEnterExecutes']` | `false` | legacy twin of `Console/EnterExecutes` |
| `$cfg['DBG']['sql']` / `['sqllog']` | `false` | Debug SQL console card; `tryQuery` logs into session / syslog |
| `$cfg['Servers'][$i]['bookmarktable']` / `['history']` / `['table_uiprefs']` | `''` (pmadb names `pma__bookmark`, `pma__history`, `pma__table_uiprefs`) | enables bookmark feature, DB history, remembered sorting persistence |
| `$cfg['Servers'][$i]['MaxTableUiprefs']` | `100` | row cap on `table_uiprefs` |
| `$cfg['ShowStats']`, `$cfg['NaturalOrder']` (`true`), `$cfg['InitialSlidersState']` (`'closed'`), `$cfg['UserprefsDisallow']` (`[]`) | — | listed in the brief; `NaturalOrder` affects table sorting in `DatabaseInterface::sortTables` (not the SQL editor); `ShowStats`/`InitialSlidersState` are not referenced by any SQL-editor code path in this checkout; `UserprefsDisallow` hides directives from the page-settings "SQL queries" panel |

---

## Screens / components

### 1. The SQL tab (server / database / table scope)

**Purpose.** Free-form query editor. The same form (`sql/query.twig`) is rendered by three controllers; differences are the legend, the prefilled query, the Columns side-list (table scope only) and the `goto` target.

**Route behaviour.**

- `/server/sql` (`Controllers/Server/SqlController`): adds scripts `makegrid.js`, `vendor/jquery/jquery.uitablefilter.js`, `sql.js`; `PageSettings::init('Sql')` renders the page-settings panel; if the user is superuser, `selectDb('mysql')`; renders `SqlQueryForm::getHtml('', '')`.
- `/database/sql`: requires `db` (else `missingParameterError('db')`); `DbTableExists::selectDatabase` else error "No databases selected." (AJAX JSON error or redirect to `/` with `reload=true`). Sets `UrlParams::$goto = /database/sql` and `$back` to the same. Reads `delimiter` body param (default `;`), html-escaped into the form.
- `/table/sql`: requires `db` and `table`; same existence checks ("No table selected."). Passes `$request->getQueryParam('sql_query', true)` as the query — i.e. a `?sql_query=` query-string param prefills the textarea (true = "use last executed query" otherwise).

**`SqlQueryForm::getHtml($db, $table, $query = true, $displayTab = false, $delimiter = ';')`.**

- `$displayTab` false/'' → `'full'`. `'full'|'sql'` renders the query card; only `'full'` renders the Bookmarked-SQL card. (Other callers — table Structure and Tracking — reuse the form.)
- `$query === true` → `Current::$sqlQuery`; if that's empty and `show_query` is present in GET/POST, the `sql_query` param is used. This is how "Show this query here again"/Edit links round-trip the query.
- `init($query)` builds the legend:
  - server: `Run SQL query/queries on server “%s”` with `verbose` or `host`;
  - database: `Run SQL query/queries on database %s` with a link to `DefaultTabDatabase`; empty query → `expandUserString(DefaultQueryDatabase)`;
  - table: `Run SQL query/queries on table %s` (link to `DefaultTabTable`, text `db.table`), columns fetched via `dbi->getColumns`; empty query → `expandUserString(DefaultQueryTable)`.
  - Legend always ends with `: ` + `MySQLDocumentation::show('SELECT')` (help icon to the SELECT manual page).
- `Util::expandUserString` placeholders: `@HTTP_HOST@`, `@SERVER@`/`__SERVER__`, `@VERBOSE@`, `@VSERVER@`, `@DATABASE@`/`__DB__`, `@TABLE@`/`__TABLE__`, `@PHPMYADMIN@`, `@COLUMNS@` (comma-joined column names of current table; `@FIELDS@` is rewritten to `@COLUMNS@` for 3.5.x back-compat). Values are passed through `Util::backquote` when used for default queries. `strftime` directives are also expanded (deprecated PHP call, suppressed with `@`). There is no `@FIELDS_LIST@`.
- Bookmarks list (full tab only, bookmark feature configured): `BookmarkRepository::getList(user, db)` → `{id, variable_count, label, is_shared}` where `is_shared = user === ''`.
- Template vars: `textarea_cols/rows`, `textarea_auto_select`, `columns_list`, `codemirror_enable`, `has_bookmark`, `delimiter`, `retain_query_box`, `is_upload` (adds `enctype=multipart/form-data`), `goto`, `can_convert_kanji` (`Encoding::canConvertKanji()` → includes `encoding/kanji_encoding_form.twig`), `is_foreign_key_check`, `allow_shared_bookmarks`.

**Layout (`sql/query.twig`).** `<form method="post" action="/import" class="ajax lock-page" id="sqlqueryform" name="sqlform">` containing:

Hidden: `is_js_confirmed=0`, `pos=0`, `goto`, `message_to_show="Your SQL query has been executed successfully."`, `prev_sql_query`, plus `get_hidden_inputs(db, table)` (server, db, table, token).

Card "Run SQL query/queries on …":

| Control | Name/id | Behaviour |
|---|---|---|
| Textarea | `sql_query` / `#sqlquery`, `tabindex=100`, `cols/rows` from config, `data-textarea-auto-select` | Replaced by CodeMirror (`onloadCodeMirrorEditor`) when `window.CodeMirror` exists. Plain textarea: click selects content once if auto-select enabled (`selectContent`, `onlyOnceElements`) |
| `#querymessage` div | — | shows "Formatting SQL…" + ajax clock during Format |
| Snippet buttons (only if columns list non-empty, i.e. table scope) | `SELECT *` (`#selectall`), `SELECT` (`#select`), `INSERT` (`#insert`), `UPDATE` (`#update`), `DELETE` (`#delete`), class `sqlbutton` | `insertQuery(id)` in `sql.ts` builds: `SELECT * FROM \`t\` WHERE 1`; `SELECT col1, col2 FROM \`t\` WHERE 1`; `INSERT INTO \`t\`(cols) VALUES ('[value-1]','[value-2]'…)`; `UPDATE \`t\` SET col1='[value-1]',col2='[value-2]' WHERE 1`; `DELETE FROM \`t\` WHERE 0`. Uses **all** options of the hidden `dummy` select (not just selected). Table name via `escapeBacktick`. Sets `sqlBoxLocked` during the operation; then `handleSimulateQueryButton()` |
| `Clear` (`#clear`) | sqlbutton | `setQuery('')` |
| `Format` (`#format`) and `Format as a single line` (`#formatSingleLine`) | shown only when `codemirror_enable` | POST `/database/sql/format` `{sql, formatSingleLine}` → replaces editor value with `data.sql` (only when CodeMirror exists) |
| `Get auto-saved query` (`#saved`) | always rendered; disabled by `checkSavedQuery()` when nothing saved | restores `localStorage['autoSavedSql_<db>[.<table>]']` (cookie fallback) |
| `Bind parameters` checkbox | `parameterized` / `#parameterized` with doc link `faq6-40` | `updateQueryParameters()` scans editor for `/:[a-zA-Z0-9_]+/g`, dedups, renders `<span class="parameter" id="paramSpan_<name>"><label>:name</label><input name="parameters[:name]"></span>` into `#parametersDiv`; "No parameters found!" when none; re-run on checkbox change and on editor blur. Existing inputs are preserved across re-scans (moved to a temp div and reused) |
| Columns list (table scope) | `<select id="fieldsSelect" name="dummy" size=TextareaRows multiple>` options `value=backquote(field)` with `title=comment` | double-click → `insertValueQuery()` |
| `<<` / `Insert` button | `#insertBtn` | `insertValueQuery()` inserts selected columns comma-joined at cursor (`replaceSelection` in CodeMirror; selectionStart/End in textarea) |
| Bookmark this SQL query | `bkm_label` (`tabindex 110`) | text input; when non-empty the two checkboxes below are shown (`input#bkm_label` `input` handler toggles their parents) |
| Let every user access this bookmark | `bkm_all_users=true` (shown only if `AllowSharedBookmarks`) | shared bookmark (user stored as `''`) |
| Replace existing bookmark of same name | `bkm_replace=true` | deletes same-label bookmarks of the user/db first |

Card footer:

| Control | Name | Behaviour |
|---|---|---|
| Delimiter | `sql_delimiter` (`#id_sql_delimiter`, size 3, default `;`) | fed to `BufferedQuery::setDelimiter` on import and to simulate-dml |
| Show this query here again | `show_query=1` (`#checkbox_show_query`) | On Go click, JS stores `localStorage.showThisQuery='1'` and `showThisQueryObject={db,table,query}`; `setShowThisQuery()` on load re-checks the box and restores the query for the same db/table. Server side `show_query` makes `SqlQueryForm` display `sql_query` param |
| Retain query box | `retain_query_box=1`, `checked` iff `RetainQueryBox` | if unchecked, after a successful AJAX run the form is collapsed via `#togglequerybox` ("Hide query box"/"Show query box" button appended by JS) |
| Rollback when finished | `rollback_query=1` | `Import::handleRollbackRequest` — see pipeline; message gets `[ROLLBACK occurred.]` |
| Enable foreign key checks | hidden `fk_checks=0` + checkbox `fk_checks=1`, checked iff `ForeignKey::isCheckEnabled()` | `ForeignKey::handleDisableCheckInit` sets session `FOREIGN_KEY_CHECKS` ON/OFF for the request and restores afterwards |
| Go | `name=SQL`, `#button_submit_query`, `tabindex 200` | click handler empties `id_bookmark` select so `/import` doesn't treat it as a bookmark run; hides `.alert-success,.alert-danger` |
| Simulate query | `#simulate_dml` (`tabindex 199`) | **dynamically injected** before Go by `handleSimulateQueryButton()` on every `keyup` in the form or sqlbutton click, only when the query matches `^\s*UPDATE … SET` or `^\s*DELETE … FROM` regexes |

Card "Bookmarked SQL query" (only when there are bookmarks):

| Control | Name | Behaviour |
|---|---|---|
| Bookmark select | `id_bookmark` (`#id_bookmark`), first option empty; options `data-varcount`, label + ` (shared)` suffix | `change` → builds `#bookmarkVariables` with `Variable %d:` inputs `bookmark_variable[i]` (i=1..varcount); hides the `.hide` Variables block when varcount = 0 (block has doc link `faqbookmark`) |
| Radios `action_bookmark` | `0` Submit (default), `1` View only, `2` Delete | handled in `ImportController` |
| Go | `name=SQL`, `#button_submit_bookmark` | Enter inside `bookmark_variable` inputs triggers this button instead of the main Go |

Also in the page: `#sqlqueryresultsouter` (results injected by AJAX) and the Bootstrap modal `#simulateDmlModal` ("Simulate query", body filled by JS, Close button).

**Editor behaviours (JS).**

- `getSqlEditor($textarea, options, resize='vertical', lintOptions)` (`functions.ts`): CodeMirror options `lineNumbers:true, matchBrackets:true, extraKeys:{'Ctrl-Space':'autocomplete'}, hintOptions:{completeSingle:false, completeOnSingleClick:true}, indentUnit:4, mode:'text/x-mysql', lineWrapping:true`; if `CodeMirror.sqlLint` exists adds `gutters:['CodeMirror-lint-markers'], lint:{getAnnotations: sqlLint, async:true, lintOptions}`. Wrapper gets CSS `resize` (vertical by default). `inputRead` → `codeMirrorAutoCompleteOnInputRead`; `change` → `AJAX.lockPageHandler` with `{value:3, content: isClean()}` (leave-page lock when dirty).
- `onloadCodeMirrorEditor`: binds to `#sqlquery` once, focuses, `blur` → `updateQueryParameters`; then `highlightSql($('body'))`. `teardownCodeMirrorEditor` writes the value back into the textarea and `toTextArea()`.
- Keyboard: `getKeyboardFormSubmitEventHandler` — `Ctrl+Enter` or `Alt+Enter` (`e.which===13`) clicks the first submit button of the enclosing form. Inline editor: `Ctrl/Cmd+Enter` (`keyCode 13 or 10`) clicks `#sql_query_edit_save`. `Ctrl-Space` = autocomplete. (No "toggle editor fullscreen" exists for the SQL editor in this checkout; the only fullscreen toggle is the Designer's `#toggleFullscreen`.)
- Autosave: every `change` (CodeMirror) or `input propertychange` (textarea) → `Sql.autoSave(query)` into `localStorage['autoSavedSql_' + db[.table]]` (cookie fallback, path = rootPath; at server scope there is no `db` input and the key is literally `autoSavedSql_undefined`, verified on the reference, Q34); `checkSavedQuery()` enables/disables `#saved`. Without CodeMirror, the `#RememberSorting` checkbox path also mirrors the "Sort by key" select into `localStorage.autoSavedSqlSort` and reapplies it.
- Submit (`#sqlqueryform.ajax` submit): copies CodeMirror value into `sql_query`; `checkSqlQuery(form)` → `confirmQuery` (prompt `Do you really want to execute "%s"?` truncated to 100 chars for `^\s*DROP\s+(IF EXISTS\s+)?(TABLE|PROCEDURE)\s`, `^\s*ALTER\s+TABLE\s+<name>\s+DROP\s`, `^\s*DELETE\s+FROM\s`, `^\s*TRUNCATE\s`, and any `UPDATE` without `WHERE`; confirmed → `is_js_confirmed=1`); empty query → alert "Missing value in the form!" (skipped if an `sql_file` or a bookmark is selected). Then `prepareForAjaxRequest`, POST `form.serialize() + ajax_page_request=true`. On success: handles `action_bookmark` (`'1'` → `setQuery(data.sql_query)`; `'2'` → remove option, hide `#fieldsetBookmarkOptions` when only the empty option remains), injects `data.message` into `#sqlqueryresultsouter`, `highlightSql`, menu/params updates, `ajax_reload` (`reload`, optional `table_name` → set table + `refreshMainContent()`, else `Navigation.reload()`), or `data.reload` (USE/DROP: updates `db`, `table=''`, reloads `/table/sql` | `/database/sql` | `/server/sql` and re-injects the message in `AJAX.callback`), triggers `makeGrid`, shows `#togglequerybox`, and collapses the box unless "Retain query box" is checked. On `success:false` the error HTML goes into `#sqlqueryresultsouter` and the page scrolls to bottom.
- Page settings panel `Sql` (`Config/Forms/User/SqlForm`): groups `Sql_queries` = ShowSQL, Confirm, QueryHistoryMax, IgnoreMultiSubmitErrors, MaxCharactersInDisplayedSQL, RetainQueryBox, CodemirrorEnable, LintEnable, EnableAutocompleteForTablesAndColumns, DefaultForeignKeyChecks; `Sql_box` = SQLQuery/Edit, Explain, ShowAsPHP, Refresh.

**Server-side behaviour.** The form posts to `/import` (not `/sql`). See the pipeline section for the full flow. pmadb storage: bookmarks (`pma__bookmark`) when `bkm_label` set; history (`pma__history`) via middleware.

### 2. The executed-query message card (shown above results, and alone for non-result queries)

**Purpose.** Confirms what ran, with timing, and offers the action links. Produced by `Generator::getMessage(Message $message, ?string $sqlQuery)`.

**Layout.** `<div class="card mb-3 result_query">` → `<div class="alert alert-{success|danger|notice…}">` with `getMessageWithIcon()`; `<div class="card-body sqlOuter">` with the formatted SQL (`formatSql` → `<pre><code class="sql" dir="ltr">` escaped; truncated at `MaxCharactersInDisplayedSQL` chars with `[...]`); `<div class="card-footer tools d-print-none">` row containing a `<form action="/sql" method="post" class="disableAjax">` (hidden inputs db/table/token + `sql_query`, and, when a Refresh link exists and `Profiling::isSupported`, hidden `profiling_form=1` + checkbox `profiling` `autosubmit` labelled "Profiling", checked iff `$_SESSION['profiling']`) followed by links in this order: **Edit inline**, **Edit**, **Explain SQL / Skip Explain SQL / Skip Analyze SQL**, **Create PHP code / (Without PHP code, Submit query)**, **Refresh**.

- `$sqlQuery === null` → falls back to `Current::$displayQuery` then `Current::$sqlQuery`. Card only rendered if `ShowSQL && sql !== '' && sql !== ';'` (`';'` is what the import flow sets as `displayQuery` to suppress the SQL for multi-query runs). Otherwise only `$message->getDisplay()`.
- `Sql::$usingBookmarkMessage` ("Using bookmark "%s" as default browse query." + FAQ 6.22 doc icon) is prepended once and cleared.
- `Sql::$showAsPhp === true` renders the query as `<pre><code class="php">$sql = "…";</code></pre>` with `addslashes`, html-escaped, line breaks turned into `\n"\n    . "` concatenation.
- Link targets: `editLinkRoute` is `/table/sql`, `/database/sql` or `/server/sql` depending on `Current::$database/$table`; params `db`, `table`, `sql_query`, `show_query=1`.
- **Explain SQL** (`SQLQuery/Explain`, not `$queryTooBig`): for `^SELECT\s` → `/import` with `sql_query = 'EXPLAIN ' . $sql`. If query matches `^EXPLAIN\s+(ANALYZE\s+)?(FORMAT=(JSON|TREE|TRADITIONAL)\s+)?SELECT` → **Skip Explain SQL** (strips that prefix). If `^ANALYZE\s+(FORMAT=(JSON|TRADITIONAL)\s+)?SELECT` → **Skip Analyze SQL**.
- **Edit** (`SQLQuery/Edit`, not when showing PHP) → `editLinkRoute` with params; shown even when truncated ("unless it's enormous" per `linkOrButton`).
- **Create PHP code** (`SQLQuery/ShowAsPHP`, not `$queryTooBig`) → `/import` with `show_as_php=1`. When already showing PHP: **Without PHP code** and **Submit query**, both `/import` with `db, table, sql_query, show_query=1` and *no* `show_as_php`, so both re-run the query (Q30; "Showing SQL query" only appears when `show_as_php=0` is posted, which no link does).
- **Refresh** (`SQLQuery/Refresh`, `showAsPhp === null`, and query matches `^(ANALYZE|EXPLAIN|SELECT|SHOW)\s`) → `/sql` route with params (re-executes via `Controllers/Sql/SqlController`).
- **Edit inline** (`SQLQuery/Edit`, not too big, not PHP): `<a href="#" class="btn btn-link inline_edit_sql">`. JS (`onloadSqlQueryEditEvents`): inserts `<div id="inline_editor_outer">` before the `<pre>` with `<textarea id="sql_query_edit">` (escaped query), a foreign-key checkbox loader (GET `/sql/get-default-fk-check-value` → `fk_checks` checkbox "Enable foreign key checks"), `#sql_query_edit_save` (Go) and `#sql_query_edit_discard` (Cancel); hides the pre; binds CodeMirror (`bindCodeMirrorToInlineEditor`, keeps the textarea height). Save builds a fake form POST to `/import` with `server, db, table, token, show_query=1, is_js_confirmed=0, sql_query, fk_checks` after `checkSqlQuery`. Discard shows the pre again. Only one inline editor at a time.
- `linkOrButton` turns long URLs into POST forms (so huge queries still work as buttons).
- `highlightSql` (`sql-highlight.ts`) post-processes every visible `code.sql`: renders a `div.sql-highlight.cm-s-default` via `CodeMirror.runMode(text, 'text/x-mysql')`, hides the raw code, and wraps keywords/builtins in `<a target="mysql_doc" class="cm-sql-doc">` links to the MySQL manual using the `mysqlDocKeyword` (multi-word first: 3-word, then 2-word, then 1-word matches, e.g. `SHOW CREATE TABLE`) and `mysqlDocBuiltin` maps, URL from `window.mysqlDocTemplate` (`#anchor` encoded).

**The message text** (`Sql::getMessageForNoRowsReturned`), in priority order:
1. `queryType === Delete` → "%d row(s) deleted."
2. `isInsert`: `Replace` → "%d row(s) affected." else "%d row(s) inserted."; if `insertId() !== 0` appends `[br]` + "Inserted row id: %d" computed as `insertId + numRows - 1`.
3. `isAffected` → "%d row(s) affected."
4. `message_to_show` non-empty and not a SELECT → that text (`rawSuccess`, escaped) — this is "Your SQL query has been executed successfully." from the form's hidden input.
5. `showAsPhp === true` → "Showing as PHP code"; `=== false` → notice "Showing SQL query".
6. else "MySQL returned an empty result set (i.e. zero rows)."
Then, if `queryTime > 0`, appends notice `(Query took %01.4f seconds.)`; if `rollback_query` was posted appends `[ROLLBACK occurred.]`.

For result sets the message is built by `Results::setMessageInformation`: `Showing rows %1s - %2s` (`firstShownRec` from the statement LIMIT offset if the statement has a LIMIT, else `$_SESSION['tmpval']['pos']`; last = min(first+rowCount, first+total)-1), then `(` + `%s total` or `%1$s total, %2$s in query` (when `unlimNumRows !== total`, e.g. `SELECT … LIMIT` typed by the user) with optional `~` approximate prefix (`$preCount`)/`$afterCount`, `, Query took %01.4f seconds.)` and the sorted-column first/last value hint. Views whose count is `-1` show "This view has at least this number of rows. Please refer to documentation." (doc `cfg_MaxExactCount`). When there's no navigation bar (SHOW, EXPLAIN, maintenance) the message is just success + `(Query took …)`.

### 3. Results wrapper (editor-relevant parts only)

`sql/sql_query_results.twig` = `<div class="sqlqueryresults ajax">` → `previous_update_query` (the `disp_query`/`disp_message` card for a preceding DML — only if `ShowSQL`), `profiling_chart`, `missing_unique_column_message`, `bookmark_created_message` ("Bookmark %s has been created." when `?label=` is in the URL, i.e. after a non-AJAX bookmark save redirect), the results `table`, and `_bookmark.twig`.

`sql/no_results_returned.twig` = message card, optional table (for result sets with columns but no rows, e.g. empty SELECT, rendered with `hasNavigationBar=false, hasBookmarkForm, hasTextButton, hasPrintLink`), profiling chart, then (if not a procedure) card **"Query results operations"** with the single link **Create view** (`/view/create`, params `db, table, printview=1, sql_query`, class `create_view ajax btn`; opens `modals/create_view.twig`), then the bookmark form. The "Query results operations" card for *non-empty* results (Print, Copy to clipboard, Export, Display chart, Create view) is produced by `Results::getResultsOperations` — Export only for `Select` statements without `PROCEDURE` (`single_table=true` when exactly one table, `raw_query=true` when none; `table` falls back to `SHOW TABLES` first result so `/table/export` doesn't fail), Display chart when a geometry column is found (`has_geometry`) is actually the GIS visualization gate; details belong to the results/grid document.

**"Bookmark this SQL query" form (`_bookmark.twig`)** — rendered when the bookmark feature exists, `hasBookmarkForm`, `id_bookmark <= 0`, and there is a query. `<form action="/sql" method="post" class="card bookmarkQueryForm d-print-none disableAjax">` with hidden `db`, `goto=/sql?db&table&sql_query&id_bookmark=1`, `bkm_fields[bkm_database]`, `bkm_fields[bkm_user]`, `bkm_fields[bkm_sql_query]` (= `complete_sql_query`, i.e. the *whole* submitted text for multi-statement runs), `store_bkm=1`; header icon `b_bookmark` "Bookmark this SQL query"; input `bkm_fields[bkm_label]` ("Bookmark label:"); switch `bkm_all_users=true` ("Let every user access this bookmark") when `AllowSharedBookmarks`; submit "Create new bookmark". JS intercepts submit: requires a label ("Missing value in the form!"), POSTs with `ajax_request=1`; `Controllers/Sql/SqlController::addBookmark` → "Bookmark %s has been created." or error "Bookmark not created!" (non-AJAX: redirect to `goto&label=…`).

### 4. Bookmarks (data model and all entry points)

**Storage.** `pma__bookmark(id int unsigned AI PK, dbase varchar(255), user varchar(255), label varchar(255) utf8mb4_general_ci, query text)`; feature active when `Servers[$i]['bookmarktable']` set (`RelationParameters->bookmarkFeature`). All queries run on the **control user** connection.

**`Bookmark`**: `save()` = `INSERT … (id, dbase, user, query, label) VALUES (NULL, …)`; `delete()` = `DELETE … WHERE id = n` (`tryQuery`); `getVariableCount()` = count of `/\[VARIABLE[0-9]*\]/`; `applyVariables($vars)`: first strips comments enclosing a placeholder (`/\*(.*\[VARIABLE[0-9]*\].*)\*/` → inner text, so `/* AND x = [VARIABLE1] */` becomes active SQL only when used), then replaces `[VARIABLE1]`…`[VARIABLEn]` with `$vars[i] ?? ''`, and `[VARIABLE]` with `$vars[1]` for back-compat. **Values are substituted raw — not quoted or escaped.**

**`BookmarkRepository`**: `createBookmark(sql, label, user, db, shared)` → false if feature missing, sql or label empty, or (`!shared && user===''`); `shared` forced false when `!AllowSharedBookmarks`; shared bookmarks store `user=''`. `getList(user, db|false)` = `WHERE (user = ? [OR user = ''])[ AND dbase = ?] ORDER BY label ASC`. `get(user|null, id)` adds the same user filter unless `user === null` (used when `action_bookmark_all` is posted). `getByLabel(user, db, label)` exact match on label+dbase+user (used for the browse-default bookmark trick: a bookmark whose label equals a table name replaces `SELECT * FROM t` when browsing; `Sql::getDefaultSqlQueryForBrowse`).

**Entry points.**
1. SQL tab with `bkm_label` (+`bkm_replace`, `bkm_all_users`): `Sql::storeTheQueryAsBookmark` — on replace, deletes all of the user's bookmarks in that db with the same label, then saves; called from `Sql::executeTheQuery` for single runs (after a successful query, with `sql_query_for_bookmark = Import::$importText`) and from `ImportController` for multi-query runs (once, with the raw `sql_query` body param).
2. Results "Bookmark this SQL query" form → `/sql` with `store_bkm`.
3. Bookmarked-SQL card: `id_bookmark` + `action_bookmark` posted to `/import`: `0` run (with `bookmark_variable[]`; also sets DROP/CREATE/ALTER reload flags by regex), `1` view (AJAX: JSON `message:"Showing bookmark", sql_query, action_bookmark:1`, no execution), `2` delete (AJAX JSON "The bookmark has been deleted." + `id_bookmark`; non-AJAX sets `Import::$hasError` as a hack to skip execution and shows the deleted query as `displayQuery`).
4. Console → `/console/bookmark/add` (`db, label, bookmark_query, shared`) returns `message: Succeeded|Failed`, `data` (bkm fields), `isShared`; `/console/bookmark/refresh` returns re-rendered `console/bookmark_content.twig`. Console delete posts `action_bookmark=2` to `/import`.

### 5. Query history (console)

**Recording.** `Http/Middleware/StatementHistory` runs after every request: if `!no_history` param, `Current::$sqlQuery !== ''` and connected → `History::setHistory(db, table, user, sql)`. `setHistory` ignores queries longer than `MaxCharactersInDisplayedSQL`; always appends `{db, table, sqlquery}` to `$_SESSION['sql_history']` trimmed to `QueryHistoryMax` (`array_shift`); if the pmadb history feature is configured **and** `QueryHistoryDB` is true, inserts into `pma__history(username, db, table, timevalue=NOW(), sqlquery)` then `purgeHistory`: finds the `timevalue` at offset `QueryHistoryMax` (`ORDER BY timevalue DESC LIMIT max,1`) and deletes rows `<=` it. The lint endpoint sends `no_history=true` so linting doesn't pollute history. Note: `Current::$sqlQuery` is whatever the request set — browsing a table (`SELECT * FROM t`) is recorded too, not only typed queries.

**Reading.** `History::getHistory(user)` → `false` without the feature; with `QueryHistoryDB` false → reversed session array; otherwise `SELECT db, table, sqlquery, timevalue … WHERE username=? ORDER BY id DESC`.

**Schema.** `pma__history(id bigint unsigned AI, username varchar(64), db varchar(64), table varchar(64), timevalue timestamp default CURRENT_TIMESTAMP, sqlquery text, KEY(username,db,table,timevalue))`.

**Console UI (`console/display.twig` + `console.ts`)** — editor-relevant parts:
- Toolbar: Console switch, Clear, History, Options, Bookmarks (if feature), Debug SQL (if `DBG.sql`).
- Welcome line: "Press Ctrl+Enter to execute query" / "Press Enter to execute query" (toggled by `EnterExecutes`).
- History entries rendered server-side (`sql_history|reverse`) as `.message.history.collapsed.hide[.select]` with `targetdb`/`targettable` attributes and actions **Collapse / Expand / Requery / Edit / Explain / Profiling / Bookmark**, texts "Query failed", "Database: …", "Queried time: <timevalue or 'During current session'>". `.select` class is added when the SQL matches `^SELECT\s`.
- Input: a CodeMirror instance (`theme:'pma', mode:'text/x-sql', lineWrapping, Ctrl-Space autocomplete, lint gutter with `sqlLint``) or textarea fallback. Keys: `Enter` executes when `EnterExecutes` (Shift+Enter newline) else `Ctrl+Enter`; `Ctrl+L` clears the line; `Ctrl+U` clears all messages; `↑`/`↓` on first/last line navigate history (`ConsoleMessages.getHistory(nthLast)` reads the `.query` texts in DOM; current input preserved in `historyPreserveCurrent`).
- `Console.execute(query, {db, table, profiling})`: requires a letter in the string; fills a hidden `<form method=post action=/import>` with `is_js_confirmed, sql_query, console_message_id, server, db, table, token` (+ `profiling=on`); runs `confirmQuery`; appends a pending message (`appendQuery`) whose id is posted as `console_message_id`; submits through `AJAX.requestHandler`; clears input; `Navigation.reload()`.
- `Console.ajaxCallback(data)`: `console_message_id` → `updateQuery(id, success, data.reloadQuerywindow)` (marks `successed`/`failed`, rewrites query/db/table); otherwise if `reloadQuerywindow.sql_query` non-empty appends a `successed` message hidden unless `CurrentQuery` ("Show current browsing query"). `ResponseRenderer` adds `reloadQuerywindow = {db, table, sql_query}` to **every** AJAX response (query omitted when `>= MaxCharactersInDisplayedSQL`).
- Message actions: Edit → put into input; Requery → confirm "Execute this query again?" (query truncated to 100 chars) then execute with the stored db/table; Explain → execute `'EXPLAIN ' + query`; Profiling → execute with `profiling:true`; Bookmark → opens the Add-bookmark card prefilled (query, target db); bookmark entries have Edit (prefill label/shared) and Delete ("Do you really want to delete this bookmark?").
- Options card: Always expand query messages, Show query history at start, Show current browsing query, Execute queries on Enter…, Switch to dark theme, "Restore default values". Each change POSTs `/console/update-config` (`key`, `value`) — server validates keys (`StartHistory, AlwaysExpand, CurrentQuery, EnterExecutes, DarkTheme, Mode(show|collapse|info), Height(>0), GroupQueries, OrderBy(exec|time|count), Order(asc|desc)`) and persists via `UserPreferencesHandler::setUserValue('Console/…')`; 400 "Unexpected parameter value." otherwise.
- Debug SQL card: shows `data.debug` from the footer (`Utilities::debugLogQueryIntoSession` records query, error, time, backtrace when `DBG.sql`), with order/group controls. "This query executed N times" style grouping lives here (`GroupQueries`, "Count:"/"Time taken:" texts) — it is a debug feature of all internal queries in a request, not a user history counter.

### 6. Profiling

- `ProfilingChecking` middleware → `Profiling::check`: `?profiling` param (and `isSupported`: `SELECT @@have_profiling`, cached in `SessionCache['profiling_supported']`) sets `$_SESSION['profiling']=true`; presence of `profiling_form` without `profiling` unsets it (unchecked switch). When active, scripts `vendor/chart.umd.js` and `jquery.tablesorter.js` are added.
- `Sql::executeTheQuery`: `Profiling::enable` runs `SET PROFILING=1;` before the query; `Profiling::getInformation` runs `SHOW PROFILE;` after and returns `[{Status, Duration}]`.
- `getDetailedProfilingStats`: total = sum of durations (returns `[]` if 0); per-state `ucwords(Status)` aggregated into `{total_time, calls}` sorted desc (`arsort`); `profile` list with `Util::formatNumber(duration, 3, 1)`; `chart = {labels, data}`.
- `sql/profiling_chart.twig`: card "Profiling" with three columns: **Detailed profile** table `#profiletable` (Order, State, Time with hidden `.rawvalue`), **Summary by state** `#profilesummarytable` (State, Total Time, % Time, Calls, ø Time) with MySQL doc link `general-thread-states`, and `<canvas id="profilingChartCanvas" data-chart-data=json>` → `createProfilingChart` pie (legend bottom). `initProfilingTables` makes both tables sortable (tablesorter, zebra; detail sorted by Order asc, summary by Total Time desc, numeric extraction from `.rawvalue`).

---

## Query execution pipeline

### A. Submission paths

1. **SQL tab / console / inline edit / bookmark run** → `POST /import` (`ImportController`).
2. **Browse, Refresh link, "matched rows" link of Simulate, sort/paging, results re-display** → `GET|POST /sql` (`Controllers/Sql/SqlController`), optionally with `sql_signature`.
3. Both converge on `Sql::executeQueryAndGetQueryResponse`.

### B. `/import` handling of a typed query (`ImportController::__invoke`)

1. `Sql::$showAsPhp` set from `show_as_php` (true/false) if present.
2. If `Current::$sqlQuery !== ''`:
   - **Bind parameters**: when `parameterized` and `parameters[]` present, each value that is not numeric is `dbi->quoteString`-ed; replacements use `preg_replace('/:name([^a-zA-Z0-9_])/', value.'$1')` and `'/:name$/'` so `:param` doesn't clobber `:param1`.
   - `Import::$importText = sql`, `importType='query'`, `format='sql'`, `$_SESSION['sql_from_query_box']=true` (used to *skip* remembered-sorting injection for this run).
   - **Rollback**: `rollback_query` → `Import::handleRollbackRequest`: splits on `$_POST['sql_delimiter']` with `explode`, each non-empty piece must pass `checkIfRollbackPossible` (parser's first statement is INSERT/UPDATE/DELETE/REPLACE or `SET` without options, and every table from `Query::getTables` is transactional per `isTableTransactional`), else AJAX error (DB error or "Only INSERT, UPDATE, DELETE, REPLACE and SET (without options like GLOBAL) SQL queries containing transactional engine tables can be rolled back.") and exit; otherwise `START TRANSACTION`.
   - Reload hints by regex on the raw text: `^(DROP)\s+(VIEW|TABLE|DATABASE|SCHEMA)\s+` → `ResponseRenderer::$reload=true` + `ajax_reload.reload`; `^(CREATE|ALTER)\s+(VIEW|TABLE|DATABASE|SCHEMA)\s+` → `ajax_reload.reload`; `^RENAME\s+TABLE\s+(.*?)\s+TO\s+(.*?)($|;|\s)` → `ajax_reload.table_name` (unquoted).
   - `Current::$sqlQuery = ''` (it will be rebuilt by `runQuery`).
3. Else if `id_bookmark` → `importType='query'`, `format='sql'`.
4. Empty GET+POST → "You probably tried to upload a file that is too large…" (FAQ 1.16).
5. `console_message_id` echoed into JSON.
6. `goto`/error URL: `/table/structure`, `/database/structure` or `/server/sql` depending on context when `goto` is not set.
7. `selectDb`, `Util::setTimeLimit(ExecTimeLimit)`, `memory_limit`.
8. Bookmark actions (`id_bookmark`, `action_bookmark` 0/1/2) as described; running a bookmark applies `bookmark_variable[]`.
9. `showAsPhp !== null` → `runQuery=false`, `goSql=true` (display only).
10. Import plugin `ImportSql::doImport()`, wrapped in `ForeignKey::handleDisableCheckInit/Cleanup` (so with `fk_checks` posted the `SHOW … FOREIGN_KEY_CHECKS` / `SET` pair runs around the import as well as around each goSql statement):
    - `SET SQL_MODE` if `sql_compatibility`/`sql_no_auto_value_on_zero` posted.
    - `BufferedQuery` with `setDelimiter($_POST['sql_delimiter'])`. `extract()` splits on the delimiter while honouring `'`, `"`, backtick strings and `#`, `--`, `/* */` comments, and recognises `DELIMITER xx` lines at statement start (changes the active delimiter). CR (not CRLF) normalised to LF.
    - Each statement → `Import::runQuery($statement, $sqlData)`.
11. `Import::runQuery` (one-statement lookbehind buffer `importRunBuffer`, statements re-suffixed with `;`): appends to `Current::$sqlQuery`, increments `executedQueries`. **If `runQuery && executedQueries < 50`** → `goSql=true`: the statement is **not executed here**; it's pushed into `$sqlData` and `Current::$completeQuery/$displayQuery` are set to the accumulated text. **Else** (≥50 statements) → falls into "import mode": previously collected `$sqlData` statements are executed in order via `executeQuery` (stop on first error unless `IgnoreMultiSubmitErrors`), then each further statement is executed immediately. `executeQuery` appends `# Rows: n` / `# n rows affected.` / `# MySQL returned an empty result set (i.e. zero rows).` / `# Error` comments to `Current::$sqlQuery`, records failures in `ImportSettings::$failedQueries`, detects `USE db` (`lookForUse`) to switch `Current::$database` + reload, and sets reload for `DROP|CREATE [IF EXISTS] TABLE|DATABASE`. If the accumulated display text exceeds 50000 chars, or >50 queries, or any statement >1000 chars, display of the SQL is disabled (`sqlQueryDisabled`, `Current::$sqlQuery=''`).
12. After import: optional charset reset; messages: delete-bookmark / "Showing bookmark" / finished (`displayQuery=';'`, and for non-`query` import types "Import has been successfully finished, %d queries executed."); timeout message with resume link.
13. If `strlen(sql) <= MaxCharactersInDisplayedSQL` → `ParseAnalyze::sqlQuery` to fix db/table.
14. Failed queries → `Generator::mysqlDie(error, sql)` for each; if `Import::$hasError` the response is the error (AJAX JSON `message` or HTML + Back link) and stops.
15. **`goSql` branch (the normal SQL-tab path, <50 statements)**: for each statement in `$queriesToBeExecuted` (or `[Current::$sqlQuery]` if empty): `ParseAnalyze::sqlQuery`, `hasNoRightsToDropDatabase` check (""DROP DATABASE" statements are disabled."), table fix-up, then `Sql::executeQueryAndGetQueryResponse(request, info, isGotoFile=false, db, table, sqlQueryForBookmark='', messageToShow='', goto, dispQuery=null, dispMessage=null, sql, completeQuery=sql)` — **HTML of every statement is concatenated**, so a multi-statement run shows one message card (and result table when applicable) per statement, each executed sequentially in the same connection. A bookmark is created once afterwards from the raw `sql_query` body param if `bkm_label` is set. JSON `ajax_reload` added. Response returned.
16. Non-`goSql` (import mode) tail: `rollback_query` → `ROLLBACK` and `[ROLLBACK occurred.]` appended without a space; `Import::$result` true → JSON `message` success and `sql_query` = `Generator::getMessage(success, Current::$sqlQuery)` (the commented transcript); false → error. The message is `ImportSettings::$message`, i.e. only the **last** statement's `# Rows: n` / `# n rows affected.` / `# MySQL returned an empty result set (i.e. zero rows).`, and the SQL tab's JS displays only `data.message` (the transcript card is never shown on the SQL tab, Q32). With exactly 50 statements the transcript starts with the last two statements (`b49;b50;`) followed by one comment line per statement; from 51 on the SQL display is disabled. Import-mode errors: each failed query goes through `mysqlDie`, and with `hasError` the first one is the response (`success:false`); with `IgnoreMultiSubmitErrors` they are discarded and only `# Error` lines remain.

Note on rollback in the normal path: `START TRANSACTION` is issued before execution, but the `ROLLBACK` statement itself is only issued in the import-mode tail. In the `goSql` path `[ROLLBACK occurred.]` is appended to the message by `getMessageForNoRowsReturned` based on the `rollback_query` flag (the transaction is left open and is discarded when the PHP connection closes — the code comments "We rollback because there might be other queries that need to be executed after this, e.g. creation of a bookmark"). Verified on the reference (general log: `START TRANSACTION`, the statements, no `ROLLBACK`). BetterMyAdmin sends the same statements and discards the pooled connection at the end of the request (Q3). A refused rollback is a plain `Message::rawError` with `success: true`; the error is the last server error of the table check (e.g. `#1146 - Table … doesn't exist`) or "Only INSERT, UPDATE, DELETE, REPLACE and SET (without options like GLOBAL) SQL queries containing transactional engine tables can be rolled back."; the split uses `explode` on the delimiter, not `BufferedQuery`.

### C. `/sql` handling (`Controllers/Sql/SqlController`)

1. `PageSettings::init('Browse')`; scripts `jquery.uitablefilter.js`, `table/change.js`, `gis_data_editor.js`, `multi_column_sort.js`.
2. `goto` defaults to `DefaultTabDatabase`/`DefaultTabTable` routes; `errorUrl` from `back` or `goto` with db (+table) appended.
3. Query source precedence: `bkm_fields[bkm_sql_query]` (bookmark dialog) → body `sql_query` → **GET `sql_query` only when `sql_signature` verifies** (`Core::checkSqlQuerySignature` = `hash_equals(hash_hmac('sha256', sql, $_SESSION[' HMAC_secret '] . blowfish_secret), sig)`). Unsigned GET queries are ignored (then default browse or "missing parameter" error). `Core::signSqlQuery` is used wherever the app builds such URLs (sort links, simulate "matched rows", row links in `Display/Results`).
4. No query + table → `Sql::getDefaultSqlQueryForBrowse(db, table)`: bookmark labelled like the table (notice "Using bookmark …") or `SELECT * FROM \`t\`` + ` ORDER BY \`t\`.\`pk\` ASC|DESC` when `TablePrimaryKeyOrder !== 'NONE'` and a primary key exists; `goto=''`. No query, no table → `missingParameterError('sql_query')`.
5. `ParseAnalyze::sqlQuery` → table override; `hasNoRightsToDropDatabase` guard; `store_bkm` → `addBookmark` and return.
6. If `goto` is the bare `/sql` route → `isGotoFile=false` and `goto` is rebuilt with `db, table, sql_query`.
7. `Sql::executeQueryAndSendQueryResponse(request, info, isGotofile, db, table, Import::$importText, message_to_show, goto, Current::$displayQuery, Current::$displayMessage, sql, Current::$completeQuery ?? sql)`.

### D. `Sql::executeQueryAndGetQueryResponse` — the core

1. **Remember sorting** — if `isRememberSortingOrder(info)` (`RememberSorting` && not `isCount|isExport|isFunc|isAnalyse` && `selectFrom` && select expressions are `[]` or exactly `['*']` && exactly one `selectTables`) && `!union` && no `sort_by_key` param: if `$_SESSION['sql_from_query_box']` is set (query came from the SQL tab) it is **unset and nothing is applied**; otherwise `handleSortOrder`: no ORDER BY in statement → read `UiProperty::SortedColumn` (`sorted_col`) from table ui-prefs, strip `\`table\`.` prefix, `Query::replaceClause(statement, tokens, 'ORDER BY ' . col)` and **re-parse** (`Query::getAll`); has ORDER BY → store `Query::getClause(..., 'ORDER BY')` into `sorted_col`. `Table::getUiProp(SortedColumn)` validates the column still exists (unless `discard_remembered_sort` posted) and removes stale prefs. Storage: `$_SESSION['tmpval']['table_uiprefs'][server][db][table]` always, plus `pma__table_uiprefs(username, db_name, table_name, prefs JSON, last_update)` when the ui-prefs feature is configured (`saveUiPrefsToDb` also trims rows beyond `MaxTableUiprefs`, erroring "Failed to cleanup table UI preferences…").
2. `new DisplayResults(dbi, config, db, table, server, goto, sql)`; `setConfigParamsForDisplayTable(request, info)` keyed by `md5(server.db.sql)` in `$_SESSION['tmpval']['query']` (max 10 remembered queries, LRU by moving the current one to the end): `max_rows` from `session_max_rows` (numeric or `'all'`) else remembered else `MaxRows`; `pos` from param else remembered else 0; `pftext` full for EXPLAIN by default; `relational_display`, `geoOption`, `display_binary` (default on unless `display_options_form` unchecked it), `display_blob`, `hide_transformation`, `repeat_cells`. Copies into `$_SESSION['tmpval'][...]`.
3. **Decide LIMIT** — `isAppendLimitClause`: parser has **no errors**, `max_rows !== 'all'`, not `isExport`, not `isAnalyse`, (`selectFrom` || `isSubQuery`), and the statement has **no LIMIT**. Then `getSqlWithLimitClause` = `Query::replaceClause(statement, tokens, 'LIMIT pos, max_rows')` → `$fullSqlQuery`. Consequences: `SELECT 1` (no FROM) is not limited; a user LIMIT is respected; UNION queries are still limited if the first statement has `selectFrom` (the LIMIT is placed by `replaceClause`); `CALL`, `SHOW`, `EXPLAIN` are never limited.
4. `ResponseRenderer::$reload = hasCurrentDbChanged(db)` (`SELECT DATABASE()` differs → USE happened); `selectDb(db)`.
5. **Show-as-PHP short-circuit**: if `showAsPhp !== null` → optional transformation cleanup, build the no-rows message with `numRows=0` and return `Generator::getMessage(message, Current::$sqlQuery)` — **the query is not executed**.
6. `ForeignKey::handleDisableCheckInit()` — reads current `FOREIGN_KEY_CHECKS`; if `fk_checks` in request sets ON/OFF (`SET FOREIGN_KEY_CHECKS`) for the session.
7. **`executeTheQuery`**: menu table set; `Profiling::enable`; `session_write_close()` (so long queries don't block other tabs); `dbi->tryQuery($fullSqlQuery)`; `queryTime = dbi->lastQueryExecutionTime` (microtime around `realQuery`, user connection only); `session_start(['use_cookies'=>false])`. Error: if `IgnoreMultiSubmitErrors` → kept as `$errorMessage` (rendered as `rawError` in the no-results card); else `handleQueryExecuteError`: `isGotoFile` → JSON `message: rawError`, status false; else `Generator::mysqlDie(error, fullSql, false)` → AJAX JSON `message` (status false) or HTML; `callExit()`. Then bookmark store (`bkm_label` && `sqlQueryForBookmark`), `numRows` = `affectedRows()` if `isAffected` else `result->numRows()` (0 if false), profiling info, `justBrowsing = isJustBrowsing(info)`, `unlimNumRows = countQueryResults(...)`, `cleanupRelations(db, table, dropped_column, purge)` (relation cleanup after DROP from structure pages).
8. `dbi->getWarnings()` captured (`SHOW WARNINGS`) and appended as notice boxes at the end of the HTML.
9. **Branch**: `(numRows === 0 && unlimNumRows === 0) || isAffected || result === false` → `getQueryResponseForNoResultsReturned`; else `getQueryResponseForResultsReturned`.
10. `ForeignKey::handleDisableCheckCleanup($default)` restores the original setting.

**`countQueryResults(numRows, justBrowsing, db, table, info)`** — the "Showing rows … of N" total:
- statement null → 0.
- LIMIT **not** appended by pMA → `unlim = numRows` (whatever the server returned; so a user-typed `LIMIT 10` yields "10 total, N in query" only if… actually `unlim===total` here so just "%s total").
- `max_rows > numRows` → `unlim = pos + numRows` (fewer rows than a page: no count query).
- `queryType === Select || isSubQuery`:
  - **just browsing** (`isJustBrowsing`: no `isGroup`, `isFunc`, `union`, `distinct`, `group`, `isSubQuery`, `join`, `having`; `selectFrom`; exactly one table; WHERE empty or exactly `WHERE 1`) → `Table::countRecords()` (approximate: `SHOW TABLE STATUS`/information_schema `Rows` via `getTablesFull`, cached in `Query\Cache`; if the approximate value `< MaxExactCount` → `countRecords(true)` = exact `SELECT COUNT(*)`; views: `MaxExactCountViews === 0` → `-1`, else `SELECT 1 … LIMIT MaxExactCountViews` and `-1` when the limit is reached). `-1`/approx triggers the `~` prefix / view hint in `Results`.
  - otherwise builds `SELECT COUNT(*) FROM (<statement> ) as cnt` from a **clone** of the parsed statement with `order = null`, `limit = null`, `SQL_NO_CACHE` option removed, and (when no GROUP BY/DISTINCT/UNION) the select list replaced by `1` to avoid "Duplicate column name" from aliases.
- otherwise (`SHOW`, `EXPLAIN`, DML…) → 0.

**No-results branch (`getQueryResponseForNoResultsReturned`)**: ALTER/DROP → `deleteTransformationInfo` (clears column/table MIME transformations for dropped columns/tables); message via `rawError($errorMessage)` or `getMessageForNoRowsReturned`; `Generator::getMessage`; `showAsPhp !== null` → return just that; JSON extras: `reload`+`db` when `$reload`, `message` and (if `ShowSQL`) `sql_query` when **not** `ajax_page_request` (i.e. non-page AJAX callers like grid edits get the message as JSON), `indexes_list` after `dropped_column`; adds `sql.js`. If the result has no columns (DML/DDL) → return the card only. If it has columns (empty SELECT, or `SHOW` with no rows) → render the (empty) results table with `hasNavigationBar=false` + profiling chart + `no_results_returned.twig` (Create view + bookmark form).

**Results branch (`getQueryResponseForResultsReturned`)**: `grid_edit` param → return a single cell value as JSON (`bin2hex` for binary) and exit. `fieldsMeta`; `justOneTable` (all fields from one non-empty `table`) and forced false when `join`, `isSubQuery` or `count(selectTables) !== 1`; `updatableView` when `SELECT *` from a table that is an updatable view (`information_schema.VIEWS.IS_UPDATABLE`); `hasUnique = resultSetContainsUniqueKey` (every column of some unique index present in the result — invisible columns excluded); `editable = (hasUnique || RowActionLinksWithoutUnique || updatableView) && justOneTable && !isSystemSchema(db)`; `$_SESSION['tmpval']['possible_as_geometry'] = editable`. DisplayParts: editable → edit links + DELETE_ROW; else no edit/delete + text button; `printview` → everything off and no scripts, else `makegrid.js`, `sql.js`. `missing_unique_column_message`: system schema or not editable → "Current selection does not contain a unique column. Grid edit, checkbox, Edit, Copy and Delete features are not available. %s"; no unique but editable (RowActionLinksWithoutUnique) → "… may result in undesired behavior. %s" (doc `cfg_RowActionLinksWithoutUnique`). `getHtmlForSqlQueryResultsTable` → `isProcedure` → `getHtmlForStoredProcedureResults` (loop `while ($result !== false)`: render each non-empty result set as its own table with navigation bar, `$result = dbi->nextResult()`), else `DisplayResults::setProperties(unlimNumRows, fieldsMeta, isCount, isExport, isFunc, isAnalyse, numRows, queryTime, isMaint, queryType===Explain, queryType===Show, printView, editable, isBrowseDistinct)` + `getTable(...)`. Then bookmark form data (same conditions) and `sql_query_results.twig`.

### E. Special paths summary

| Path | Behaviour |
|---|---|
| **SHOW …** | `isShow`/`queryType=Show`; no LIMIT; `countQueryResults` → 0 → "Showing rows" path isn't used (no navigation bar; `setDisplayPartsForShow`: no edit/sort/nav, bookmark form, text button, print; `SHOW [FULL] PROCESSLIST` gets `KILL_PROCESS` delete links). `setMimeMap`: for `SHOW CREATE TABLE` the `Create Table` column (and `Info` column for PROCESSLIST) gets the `Text_Plain_Sql` output transformation (formatted/highlighted SQL cell) unless `hide_transformation`. Refresh link available (regex `^(ANALYZE|EXPLAIN|SELECT|SHOW)`). For `SHOW STATUS`-like results with no table, `Results` uses `fieldsMeta[0]->table` as table. |
| **EXPLAIN / ANALYZE** | `queryType=Explain`; `isExplain`; no LIMIT; `pftext` forced to full text; display parts "non-data" (no sort/nav); "Skip Explain SQL" link; Refresh available. The link adds the `EXPLAIN ` prefix as plain string. |
| **CALL procedure** | `isProcedure`; no LIMIT, `unlim=0`; multi-result loop via `nextResult()`, each non-empty result set rendered with its own card "Showing rows 0 - n-1 (n total, Query took …)" (same query time); `no_results_returned.twig` hides "Query results operations"; export link suppressed. mysqli keeps the further result sets pending, so `SHOW PROFILE` and `SHOW WARNINGS` fail client-side and are never sent for a CALL that returns result sets (Q36). |
| **INSERT/UPDATE/DELETE/REPLACE/LOAD** | `isAffected` → `numRows = affectedRows()`; always the no-results card with the row-count messages above; `Inserted row id`. `UPDATE` without WHERE and `DELETE FROM` get a JS confirm. Simulate button offered for single-table UPDATE/DELETE. |
| **DDL (CREATE/ALTER/DROP)** | `ParseAnalyze` sets `$reload` for Alter/Create/Drop statements; DROP DATABASE blocked unless `AllowUserDropDatabase` or superuser; `deleteTransformationInfo` on ALTER … DROP col / DROP; `/import` regexes set `ajax_reload` → navigation reload; RENAME TABLE → switch to new table. |
| **USE db** | `hasCurrentDbChanged` → `reload` JSON with new `db` → JS reloads `/database/sql`. Import mode: `lookForUse`. |
| **Multi-statement** | split by `BufferedQuery` using the Delimiter field; <50 statements → each executed sequentially by `Sql::executeQueryAndGetQueryResponse`, outputs concatenated (every statement gets its own message card and, for SELECTs, its own result table); ≥50 → import mode with a commented transcript and a single summary. Errors abort at the first failing statement unless `IgnoreMultiSubmitErrors`. Only one bookmark stored (whole text). |
| **Bookmark variables** | `[VARIABLE]`, `[VARIABLE1..n]`, optionally inside `/* … */` which is un-commented when substituted; inputs `bookmark_variable[i]`; raw substitution. |
| **Simulate DML** | POST `/import/simulate-dml` `{db, sql_query, sql_delimiter}` → `SimulateDmlController`: lexes with the delimiter, removes comment tokens, parses; any parser error → first error message; every statement must be `UpdateStatement`/`DeleteStatement` with no JOIN and exactly one table, else "Only single-table UPDATE and DELETE queries can be simulated." `SimulateDml::getMatchedRows`: DELETE → count `SELECT COUNT(*) FROM (SELECT 1 FROM t WHERE … ORDER BY … LIMIT …) AS pma_tmp`, select `SELECT * FROM (SELECT * FROM t …) AS pma_tmp`; UPDATE → for each `SET col = val` (last assignment wins, iterated reversed) builds `val AS \`col *new*\``; count `SELECT COUNT(*) FROM (SELECT cols, vals FROM t WHERE… ) AS pma_tmp WHERE NOT (old cols) <=> (new cols)` (rows whose values would actually change). Returns `{sql_query: formatSql(statement->build()), matched_rows, matched_rows_url: /sql?db&sql_query&sql_signature}`. JS renders in `#simulateDmlModal`: "SQL query:" + formatted SQL + "Affected rows:" + linked count, `<hr>` between statements, `highlightSql` on show. |
| **Rollback** | see B.2; message `[ROLLBACK occurred.]`. |
| **Profiling** | `SET PROFILING=1` + `SHOW PROFILE` around the single statement; chart card. |
| **Show as PHP** | query not executed: `runQuery=false` so nothing reaches `$sqlData` and the **whole** text (statements re-suffixed with `;` and concatenated) becomes one card; the message follows `getMessageForNoRowsReturned` with 0 rows ("Showing as PHP code", but "0 rows affected." / "0 rows deleted." for DML); no "Query took"; links "Explain SQL" (for SELECT), "Without PHP code" / "Submit query" (both re-run). |
| **Errors** | `Generator::mysqlDie(serverMessage, sql, isModifyLink)`: `<div class="alert alert-danger"><h1>Error</h1>`; if the SQL doesn't contain `connect`: static analysis section when the parser finds errors ("Static analysis:", "%d errors were found during analysis.", `<ol><li>message (near "x" at position n)</li>`) and the SQL **unformatted-escaped** in that case (else `formatSql` truncated); "SQL query:" + copy-to-clipboard button + SELECT doc icon when the SQL contains `select`; optional Edit icon link (`isModifyLink`, used by `DatabaseInterface::query` fatal path) to the right SQL tab with `show_query=1`; then "MySQL said: " + doc icon `server-error-reference` + `<code>` server message (double spaces/tabs → nbsp, newlines → `<br>`, 3+ blank lines collapsed). Stored in `$_SESSION['Import_message']['message']`. The server message comes from `dbi->getError()` → `Utilities::formatError(errno, msg)` (`#errno - msg`, with special text for 2002 and 2003 (" — The server is not responding…"), 1698 (" — Logout and try as another user." link) and 1005 (errno 13: privileges hint; otherwise "(Details…)" link to the InnoDB status)). AJAX: `success:false`, `message` HTML → JS places it in `#sqlqueryresultsouter` and scrolls down; non-AJAX adds `[ Back ]` link (`getBackUrlHtml`, appends `no_history=true`). |

### F. Flowchart

```mermaid
flowchart TD
  A[SQL tab Go / Console Ctrl+Enter / Inline edit Go] -->|POST /import| B[ImportController]
  A2[Browse / Refresh link / signed URL] -->|GET,POST /sql| C[Sql SqlController]
  B --> B1{sql_query set?}
  B1 -->|yes| B2[Bind :params → quote non-numeric]
  B2 --> B3{rollback_query?}
  B3 -->|yes| B4[checkIfRollbackPossible each stmt → START TRANSACTION or error]
  B3 -->|no| B5
  B4 --> B5[regex reload hints DROP/CREATE/ALTER/RENAME]
  B1 -->|id_bookmark| B6[action 0 run +variables / 1 view / 2 delete]
  B5 --> B7[ImportSql::doImport → BufferedQuery split by delimiter]
  B6 --> B7
  B7 --> B8{< 50 statements?}
  B8 -->|yes goSql| B9[for each stmt: ParseAnalyze → DROP DATABASE guard → executeQueryAndGetQueryResponse]
  B8 -->|no import mode| B10[executeQuery each; transcript '# Rows: n'; summary message]
  C --> C1[sql from bkm_fields / body / signed GET]
  C1 --> C2{empty + table?}
  C2 -->|yes| C3[getDefaultSqlQueryForBrowse: bookmark=table or SELECT * ORDER BY pk]
  C2 -->|no| C4[ParseAnalyze]
  C3 --> C4
  C4 --> C5{store_bkm?}
  C5 -->|yes| C6[addBookmark → message]
  C5 -->|no| D
  B9 --> D[Sql::executeQueryAndGetQueryResponse]
  D --> D1{RememberSorting applicable & not from query box?}
  D1 -->|yes| D2[inject/store ORDER BY via table_uiprefs sorted_col]
  D1 -->|no| D3
  D2 --> D3[setConfigParamsForDisplayTable: pos,max_rows,...]
  D3 --> D4{isAppendLimitClause?}
  D4 -->|yes| D5[replaceClause LIMIT pos,max_rows]
  D4 -->|no| D6
  D5 --> D6{show_as_php?}
  D6 -->|yes| D7[render PHP code card, no execution]
  D6 -->|no| D8[FK checks init → SET PROFILING=1 → session_write_close → tryQuery → session_start]
  D8 --> D9{error?}
  D9 -->|yes & !IgnoreMultiSubmitErrors| D10[mysqlDie error card → exit]
  D9 -->|no| D11[store bookmark if bkm_label; numRows affected/numRows; SHOW PROFILE]
  D11 --> D12[countQueryResults: none / pos+numRows / countRecords / SELECT COUNT(*) FROM (stmt)]
  D12 --> D13[SHOW WARNINGS]
  D13 --> D14{rows==0 && unlim==0 or isAffected or result false?}
  D14 -->|yes| D15[no-results card: deleted/inserted/affected/empty set + Query took + ROLLBACK; empty table if columns; Create view; bookmark form]
  D14 -->|no| D16[results: editable decision, procedure multi-result loop, DisplayResults::getTable Showing rows x-y (N total, Query took)]
  D15 --> D17[restore FOREIGN_KEY_CHECKS; append warnings]
  D16 --> D17
  D17 --> E[JSON: message html, reloadQuerywindow, ajax_reload/reload, console_message_id]
  E --> F[StatementHistory middleware: session + pma__history]
```

---

## Statement analysis flags

`ParseAnalyze::sqlQuery(sql, db, isAjax)` returns `[StatementInfo, db, table, reload]`: `Query::getAll(sql)`; `reload` true for `AlterStatement|CreateStatement|DropStatement`; if `selectTables` non-empty: one table → `table = selectTables[0][0]`, `db = selectTables[0][1]` if qualified; more than one → `table=''`; non-AJAX and not already reloading → `reload = strcasecmp(db, previousDb) !== 0`.

`StatementInfo` = `{parser: Parser, statement: Statement|null (first statement), flags: StatementFlags, selectTables: list<[table, db|null]>, selectExpressions: list<string|null>}`. `selectTables` are the real table names behind aliases found in the SELECT expressions, falling back to the FROM clause; `selectExpressions` are the column expressions without an explicit table qualifier.

| Flag (`StatementFlags`) | Set when (sql-parser `Query::getFlags`) | What it drives in phpMyAdmin |
|---|---|---|
| `queryType: StatementType` | first keyword: Alter, Analyze, Call, Check, Checksum, Create, Delete, Drop, Explain, Insert, Kill, Load, Optimize, Repair, Replace, Select, Set, Show, Update | `Delete` → "rows deleted" message; `Replace` → affected wording; `Select`/`isSubQuery` → count query; `Alter|Drop` → transformation cleanup; `Explain`/`Show` → `DisplayResults` flags; `Select` → export link, `hasExportButton`, `Results` table-name fallback |
| `selectFrom` | SELECT with FROM | LIMIT appending, remember sorting, just-browsing |
| `distinct` | `SELECT DISTINCT` | not just-browsing; count query keeps expressions |
| `isGroup` | GROUP BY or HAVING present | not just-browsing; count query keeps expressions; `changeExpression` |
| `group` / `having` | GROUP BY / HAVING | just-browsing exclusion |
| `union` | UNION present | skip remember-sorting; not just-browsing; count keeps expressions |
| `join` | any JOIN | not just-browsing; result not editable |
| `isSubQuery` | subquery detected | LIMIT appended even without FROM; count query path; not editable; not just-browsing |
| `order` | ORDER BY (SELECT/UPDATE/DELETE) | remember sorting: store vs. inject; count query clones statement |
| `limit` | LIMIT (SELECT/UPDATE/DELETE) | never append pMA LIMIT; `Results` uses statement offset for "Showing rows" |
| `offset` | TODO in library | unused |
| `isCount` | `SELECT COUNT(…)` | no remember-sorting; `DisplayResults` "non-data" parts |
| `isFunc` | aggregate SUM/AVG/STD/MIN/MAX/BIT_OR/BIT_AND | no remember-sorting; not just-browsing; `DisplayResults` |
| `isExport` | `INTO OUTFILE` | no LIMIT, no remember-sorting, `DisplayResults` |
| `isAnalyse` | `PROCEDURE ANALYSE(` | no LIMIT, no remember-sorting, non-data display |
| `isProcedure` | `CALL` | multi-result rendering, hides Create view and export |
| `isAffected` | INSERT/LOAD/REPLACE/UPDATE/DELETE | `affectedRows()` as count; forces no-results branch |
| `isInsert` | INSERT/LOAD/REPLACE | "rows inserted" + "Inserted row id" |
| `isMaint` | ANALYZE/CHECK/CHECKSUM/OPTIMIZE/REPAIR | `DisplayResults` text button in non-data parts |
| `dropDatabase` | `DROP DATABASE|SCHEMA` | `hasNoRightsToDropDatabase` |
| `reload` | ALTER/CREATE/DROP | (library flag; pMA recomputes reload itself in `ParseAnalyze`) |
| `isDelete`, `isExplain`, `isReplace`, `isSelect`, `isShow` | deprecated mirrors of `queryType` | pMA code uses `queryType` comparisons |

Other analysis consumers: `Results::setMessageInformation` reads `statement->limit->offset/rowCount`; `Results::getTable` uses `Query::replaceClause(..., 'ORDER BY', '')` to produce the "unsorted" query for sort links; `Results::extractSortingExpressions(statement->order)`; `Import::checkIfRollbackPossible` uses statement classes + `Query::getTables`; `SimulateDml` uses `Query::getClause(statement, list, 'WHERE'|'ORDER BY'|'LIMIT')`; `Generator::mysqlDie` reruns `Lexer`+`Parser` to list static-analysis errors; `Linter` likewise.

Parser errors: `isAppendLimitClause` is false when `parser->errors !== []` so a syntactically broken query is sent verbatim and the true server error is shown. `Results` sets `[posNext, posPrev] = [total, 0]` when there was a parser error.

---

## Autocomplete / lint / format details

### Autocomplete
- Trigger: CodeMirror `inputRead` (every typed character) → `codeMirrorAutoCompleteOnInputRead(instance)`; also `Ctrl-Space`.
- Data load (once per page, guarded by `sqlAutoCompleteInProgress` / module-level `sqlAutoComplete` cache; reset by `removeAutocompleteInfo()` on teardown): POST `/database/sql/autocomplete` `{db, no_debug:true}`. Server (`SqlAutoCompleteController`): if `EnableAutocompleteForTablesAndColumns` and `db` is a valid `DatabaseName`: `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY FROM information_schema.columns WHERE table_schema = 'db'` → `{tables: {tableName: [{field, columnHint: COLUMN_TYPE + ' | Primary' | ' | Unique' | ''}]}}`. Server scope (`db=''`) therefore yields no table/column completion — only keywords.
- Client transforms into CodeMirror sql-hint `tables = [{text: table, columns: [{text: field, displayText: 'field | hint', columnName, columnHint, render}]}]`, `defaultTable = current table` (so bare column names of the current table complete).
- Custom render: `<div class="autocomplete-column-name">` + `<div class="autocomplete-column-hint">`.
- Popup opened only when `!instance.state.completionActive` and the token at cursor matches `/^[.`\w@]\w*$/` (so typing `table.` or a backtick or `@var` triggers). Keywords/functions come from CodeMirror's `text/x-mysql` mode keyword list (`completeSingle:false` means never auto-insert a single match).

### Lint
- `sql-lint.ts` registers `CodeMirror.sqlLint(text, updateLinting, options, cm)`: empty text → no annotations; else POST `/lint` `{sql_query, options: lintOptions, no_history:true, ajax_request:true}` and maps each item to `{from: Pos(fromLine, fromColumn), to: Pos(toLine, toColumn), messageHTML, severity}`.
- `LintController` (AJAX only): `options.editorType` ∈ `event|routine|trigger` prepends a synthetic header (`DELIMITER $$ CREATE EVENT \`a\` ON SCHEDULE EVERY MINUTE DO\n`, `… CREATE PROCEDURE \`a\`()\n`, `… CREATE TRIGGER \`a\` AFTER INSERT ON \`b\` FOR EACH ROW\n`) so routine bodies lint in context, then subtracts 1 from line numbers (except line 0). Response is raw JSON with `Core::headerJSON()` headers.
- `Linter::lint(query)`: `> 10000` chars → single warning "Linting is disabled for this query because it exceeds the maximum length." at 0:0; else `Lexer` + `Parser`, `ParserError::get([$lexer,$parser])` → each `[message, code, string, position]` converted to line/column using `getLines` (UTF-8 aware via `UtfString`) with `message = '%1$s (near <code>%2$s</code>)'` (escaped), `severity: 'error'`, `to` = `from + mb_strlen(string)`.
- Linting is purely syntactic (lexer/parser errors); no semantic checks (unknown tables etc.).

### Format
- `SqlFormatController`: `Formatter::format($sql, ['type' => 'text'])`; single-line variant adds `'line_ending' => ' ', 'indentation' => ''`. Formatter semantics (library): clauses on new lines (`clause_newline`), inline clauses `CREATE, INTO, LIMIT, PARTITION BY, PARTITION, PROCEDURE, SUBPARTITION BY, VALUES` stay on the line, indentation increases inside clauses and for bracket groups longer than 30 chars, comments kept unless `remove_comments`, keyword case left as typed unless format rules apply (default rules upper-case keywords in `html`/`cli` types).
- Server-side `Generator::formatSql` is **not** a reformatter — it only wraps/escapes/truncates; the visual highlighting is client-side CodeMirror `runMode`.
- Simulate DML displays `statement->build()` (the parser's canonical rebuild), not the user's text.

---

## Micro-behaviours checklist

- [x] Legend text per scope: `Run SQL query/queries on server “%s”` / `on database <link>` / `on table <link db.table>`, each followed by `:` and a SELECT-manual help icon. <!-- parity:test --> `p09-74590b` [sql-tab.test.ts:177](../../apps/server/test/int/sql-tab.test.ts#L177) +1
- [x] Table scope prefills `DefaultQueryTable` (`SELECT * FROM \`t\` WHERE 1`), database scope `DefaultQueryDatabase` (empty by default); placeholders `@TABLE@ @DATABASE@ @COLUMNS@ (@FIELDS@) @SERVER@ @VERBOSE@ @VSERVER@ @HTTP_HOST@ @PHPMYADMIN@`, values back-quoted. <!-- parity:test --> `p09-50c42a` [sql-tab.test.ts:177](../../apps/server/test/int/sql-tab.test.ts#L177) +1
- [x] `/table/sql?sql_query=…` prefills the editor without executing. <!-- parity:test --> `p09-097a18` [sql-editor-extras.e2e.ts:62](../../tests/e2e/sql-editor-extras.e2e.ts#L62)
- [x] Snippet buttons only at table scope; they use **all** columns, `[value-N]` placeholders, `WHERE 1` for SELECT/UPDATE and `WHERE 0` for DELETE. <!-- parity:test --> `p09-625a43` [logic.test.ts:69](../../apps/web/src/features/sql/logic.test.ts#L69) +1
- [x] Columns list: double-click or `<<`/Insert inserts selected columns comma-separated at the cursor; option title shows the column comment. <!-- parity:test --> `p09-0cd66f` [logic.test.ts:81](../../apps/web/src/features/sql/logic.test.ts#L81) +1
- [x] Format / Format as a single line only when CodeMirror is enabled; shows "Formatting SQL…" spinner in `#querymessage`. <!-- parity:test --> `p09-58f383` [sql-editor.e2e.ts:157](../../tests/e2e/sql-editor.e2e.ts#L157)
- [x] Autosave on every change to `localStorage.autoSavedSql_<db>[.<table>]`; "Get auto-saved query" disabled when none exists. <!-- parity:test --> `p09-d68993` [logic.test.ts:102](../../apps/web/src/features/sql/logic.test.ts#L102) +1
- [x] "Show this query here again" persists `{db, table, query}` in localStorage and re-fills the editor on the same db/table; server honours `show_query` param to prefill. <!-- parity:test --> `p09-5e5479` [sql-editor-extras.e2e.ts:156](../../tests/e2e/sql-editor-extras.e2e.ts#L156)
- [x] "Retain query box" default from `RetainQueryBox`; unchecked → query card slides up after a successful run and a "Show query box" button appears (`<br id="togglequerybox_spacer">` spacer trick). <!-- parity:test --> `p09-5a7b7c` [sql-editor.e2e.ts:74](../../tests/e2e/sql-editor.e2e.ts#L74)
- [x] Bookmark checkboxes (shared / replace) hidden until a label is typed. <!-- parity:test --> `p09-bd3b52` [sql-editor-extras.e2e.ts:113](../../tests/e2e/sql-editor-extras.e2e.ts#L113)
- [x] "Let every user access this bookmark" hidden when `AllowSharedBookmarks=false`; shared bookmarks listed with ` (shared)` suffix and stored with empty user. <!-- parity:test --> `p09-6efe0c` [sql-editor-extras.e2e.ts:113](../../tests/e2e/sql-editor-extras.e2e.ts#L113)
- [x] Bookmark replace deletes every same-label bookmark of the user in that db before inserting. <!-- parity:test --> `p09-8e8a52` [metadata.test.ts:105](../../apps/server/test/int/metadata.test.ts#L105) +1
- [x] Bookmark dropdown change renders `Variable %d:` inputs per `data-varcount`; Enter in those inputs clicks the bookmark Go, not the main Go. <!-- parity:test --> `p09-3ceb0e` [sql-editor-extras.e2e.ts:113](../../tests/e2e/sql-editor-extras.e2e.ts#L113)
- [x] Main Go click clears `id_bookmark` so a selected bookmark isn't run accidentally. <!-- parity:test --> `p09-44e585` [sql-editor-extras.e2e.ts:113](../../tests/e2e/sql-editor-extras.e2e.ts#L113)
- [x] `[VARIABLE]`/`[VARIABLEn]` substituted raw; comment wrappers `/* … [VARIABLE1] … */` are un-commented. <!-- parity:test --> `p09-714ea3` [metadata.test.ts:105](../../apps/server/test/int/metadata.test.ts#L105) +1
- [x] Delimiter field drives both execution splitting and simulate-dml parsing; `DELIMITER xx` inside the text is honoured by `BufferedQuery`. <!-- parity:test --> `p09-eef6d7` [query.test.ts:115](../../apps/server/test/int/query.test.ts#L115) +1
- [x] Simulate query button appears/disappears live (keyup) for single-table UPDATE/DELETE; modal shows per-statement formatted SQL and "Affected rows: N" linking to a signed `/sql` SELECT preview. <!-- parity:test --> `p09-c33691` [sql-editor.e2e.ts:139](../../tests/e2e/sql-editor.e2e.ts#L139)
- [x] Simulate rejects joins/multi-table and non-UPDATE/DELETE statements with "Only single-table UPDATE and DELETE queries can be simulated."; UPDATE simulation counts only rows whose values would change (`NOT (old) <=> (new)`). <!-- parity:test --> `p09-4e070d` [sql-tab.parity.test.ts:444](../../tests/parity/sql-tab.parity.test.ts#L444)
- [x] Rollback when finished: pre-check every statement (INSERT/UPDATE/DELETE/REPLACE/plain SET on transactional tables) else error; `START TRANSACTION` before run; `[ROLLBACK occurred.]` appended. <!-- parity:test --> `p09-aa1339` [sql-tab.test.ts:99](../../apps/server/test/int/sql-tab.test.ts#L99) +4
- [x] Enable foreign key checks: initial state from `DefaultForeignKeyChecks` (`default` = server's `FOREIGN_KEY_CHECKS`), request-scoped `SET FOREIGN_KEY_CHECKS` and restore; inline editor fetches the default via `/sql/get-default-fk-check-value`. <!-- parity:test --> `p09-1fc182` [sql-tab.test.ts:114](../../apps/server/test/int/sql-tab.test.ts#L114) +4
- [x] Bind parameters: `:name` regex, dedup, inputs preserved on rescan, "No parameters found!", non-numeric values quoted server-side, `:param` vs `:param1` boundary-safe. <!-- parity:test --> `p09-ec9fe2` [logic.test.ts:55](../../apps/web/src/features/sql/logic.test.ts#L55) +2
- [x] Confirm dialog (`Confirm=true`) for DROP TABLE/PROCEDURE, ALTER TABLE … DROP, DELETE FROM, TRUNCATE, UPDATE without WHERE; text truncated to 100 chars; sets `is_js_confirmed=1`. <!-- parity:test --> `p09-e295f8` [logic.test.ts:39](../../apps/web/src/features/sql/logic.test.ts#L39) +1
- [x] Empty query → alert "Missing value in the form!" (not when a file or bookmark is selected). <!-- parity:test --> `p09-331963` [logic.test.ts:45](../../apps/web/src/features/sql/logic.test.ts#L45) +1
- [x] Ctrl+Enter / Alt+Enter submits the enclosing form; Ctrl+Space autocomplete; inline editor Ctrl/Cmd+Enter saves. <!-- parity:test --> `p09-ba7ff7` [sql-editor.e2e.ts:74](../../tests/e2e/sql-editor.e2e.ts#L74) +2
- [x] CodeMirror options: line numbers, bracket matching, `text/x-mysql`, 4-space indent, line wrapping, vertical resize handle, lint gutter when `LintEnable`. <!-- parity:test --> `p09-32b8dd` [sql-editor-extras.e2e.ts:74](../../tests/e2e/sql-editor-extras.e2e.ts#L74)
- [x] Dirty editor engages the page-lock (leave-page warning) via `isClean()`. <!-- parity:test --> `p09-67640f` [sql-editor-extras.e2e.ts:167](../../tests/e2e/sql-editor-extras.e2e.ts#L167)
- [x] Lint: async POST `/lint`, errors as red markers with `message (near <code>token</code>)`; disabled above 10000 chars with a warning marker; routine/trigger/event editors get a synthetic header; `no_history=true` so lint requests never enter history. <!-- parity:test --> `p09-d82c3f` [lint.test.ts:26](../../packages/sql-lexer/test/lint.test.ts#L26) +1
- [x] Autocomplete lists tables and columns of the **current database** only, column hint `TYPE | Primary|Unique`, default table = current table; fetched once per page, never auto-completes a single candidate. <!-- parity:test --> `p09-d9ff25` [sql-tab.test.ts:218](../../apps/server/test/int/sql-tab.test.ts#L218) +2
- [x] Executed-SQL card hidden entirely when `ShowSQL=false` or SQL is `;`. <!-- parity:test --> `p09-ac586d` [sql-message.test.ts:79](../../apps/server/test/unit/sql-message.test.ts#L79) +1
- [x] Executed SQL truncated to `MaxCharactersInDisplayedSQL` + `[...]`; Explain and PHP-code links vanish for longer queries; Edit stays. <!-- parity:test --> `p09-16d3bb` [sql-tab.test.ts:56](../../apps/server/test/int/sql-tab.test.ts#L56) +1
- [x] Links order and conditions: Edit inline (Edit on, not big, not PHP), Edit (Edit on, not PHP), Explain SQL (`^SELECT`) / Skip Explain SQL (`^EXPLAIN [ANALYZE] [FORMAT=…] SELECT`) / Skip Analyze SQL (`^ANALYZE [FORMAT=…] SELECT`), Create PHP code (or "Without PHP code" + "Submit query"), Refresh (`^(ANALYZE|EXPLAIN|SELECT|SHOW)` and not showing PHP). <!-- parity:test --> `p09-0c49c5` [sql-message.test.ts:19](../../apps/server/test/unit/sql-message.test.ts#L19) +3
- [x] Profiling switch appears only next to a Refresh link and when `@@have_profiling`; it auto-submits the small `/sql` form; state kept in `$_SESSION['profiling']`. <!-- parity:test --> `p09-280f8a` [sql-message.test.ts:41](../../apps/server/test/unit/sql-message.test.ts#L41) +2
- [x] "Create PHP code" does **not** execute the query; output `$sql = "…";` with `\n"` + `. "` continuation lines; message "Showing as PHP code"; "Without PHP code" and "Submit query" both re-run the query (notice "Showing SQL query" only for a posted `show_as_php=0`). <!-- parity:test --> `p09-550737` [sql-message.test.ts:84](../../apps/server/test/unit/sql-message.test.ts#L84) +3
- [x] Keyword/function doc links inside highlighted SQL (`cm-sql-doc`, target `mysql_doc`), multi-word keywords resolved greedily (3→2→1 words). <!-- parity:test --> `p09-dc4450` [highlight.test.ts:10](../../apps/web/src/features/sql/editor/highlight.test.ts#L10) +1
- [x] Messages: "%d row(s) deleted." / "%d row(s) inserted." (+ "Inserted row id: %d" = `insert_id + n - 1`) / "%d row(s) affected." (also for REPLACE) / "Your SQL query has been executed successfully." / "MySQL returned an empty result set (i.e. zero rows)." each followed by `(Query took %01.4f seconds.)` when time > 0. <!-- parity:test --> `p09-a212a5` [query.test.ts:88](../../apps/server/test/int/query.test.ts#L88) +3
- [x] Results message: "Showing rows a - b (N total[, M in query], Query took t seconds.)" with `~` for approximate counts and a view hint when the count is -1. <!-- parity:test --> `p09-4df052` [query.test.ts:41](../../apps/server/test/int/query.test.ts#L41) +2
- [x] LIMIT appended only for parse-clean `SELECT … FROM` or subquery statements without their own LIMIT and when not "all rows"; never for SHOW/EXPLAIN/CALL/INTO OUTFILE/PROCEDURE ANALYSE. <!-- parity:test --> `p09-662a39` [query.test.ts:41](../../apps/server/test/int/query.test.ts#L41) +4
- [x] Row count: no count query when the page isn't full; `countRecords` for simple single-table browsing (approximate unless `< MaxExactCount`); otherwise `SELECT COUNT(*) FROM (…stmt without ORDER BY/LIMIT, select list → 1 unless GROUP/DISTINCT/UNION…) as cnt`. <!-- parity:test --> `p09-7438a7` [query.test.ts:41](../../apps/server/test/int/query.test.ts#L41) +4
- [x] Remembered sorting only for `SELECT *`/no-expression single-table queries, skipped when the query came from the SQL tab (`sql_from_query_box`) or from "Sort by key"; stored in `table_uiprefs.sorted_col`, invalidated if the column disappears, `discard_remembered_sort` bypasses. <!-- parity:test --> `p09-a6b162` [browse.test.ts:70](../../apps/server/test/int/browse.test.ts#L70) +1
- [x] Multi-statement: <50 → each statement individually executed and rendered; ≥50 → import-mode transcript; first error aborts unless `IgnoreMultiSubmitErrors`. <!-- parity:test --> `p09-9a56f6` [query.test.ts:122](../../apps/server/test/int/query.test.ts#L122) +6
- [x] `USE db` in the SQL tab (fewer than 50 statements) does not switch the page's database: every following statement is re-run in the page's database (`hasCurrentDbChanged` + `selectDb`) and the JS ignores `data.reload` because `ajax_reload` is always present (Q31); in import mode `lookForUse` switches `Current::$database` (`reloadQuerywindow.db`, navigation reload). DROP/CREATE/ALTER/RENAME reload navigation (RENAME switches to the new table). <!-- parity:test --> `p09-410573` [sql-message.test.ts:117](../../apps/server/test/unit/sql-message.test.ts#L117) +7
- [x] DROP DATABASE blocked for non-superusers unless `AllowUserDropDatabase` ("DROP DATABASE" statements are disabled.). <!-- parity:test --> `p09-15a63a` [sql-tab.test.ts:91](../../apps/server/test/int/sql-tab.test.ts#L91) +1
- [x] Error card: "Error" heading, optional "Static analysis: N errors were found during analysis." list, "SQL query:" + copy button + SELECT doc icon, "MySQL said:" + doc icon + `#errno - message` in `<code>`; query hidden if it contains `connect`. <!-- parity:test --> `p09-a25a57` [sql-message.test.ts:92](../../apps/server/test/unit/sql-message.test.ts#L92) +2
- [x] Warnings after execution (`SHOW WARNINGS`) appended as notice boxes. <!-- parity:test --> `p09-001dd4` [sql-tab.parity.test.ts:206](../../tests/parity/sql-tab.parity.test.ts#L206)
- [x] Session is closed around query execution so long queries don't block the UI, reopened without resending the cookie. <!-- parity:test --> `p09-11fdd7` [sql-tab.test.ts:146](../../apps/server/test/int/sql-tab.test.ts#L146)
- [x] `Query took` uses wall-clock microtime around `mysqli_query`, 4 decimals. <!-- parity:test --> `p09-4c9f73` [query.test.ts:41](../../apps/server/test/int/query.test.ts#L41)
- [x] SHOW CREATE TABLE's `Create Table` cell and PROCESSLIST `Info` cell rendered through the `Text_Plain_Sql` transformation (highlighted SQL) unless "hide transformations". <!-- parity:test --> `p09-6e6b10` [sql-editor-extras.e2e.ts:87](../../tests/e2e/sql-editor-extras.e2e.ts#L87)
- [x] SHOW PROCESSLIST rows get Kill links; SHOW results have no sorting/navigation but keep bookmark/print. <!-- parity:test --> `p09-3ce77a` [sql-editor-extras.e2e.ts:87](../../tests/e2e/sql-editor-extras.e2e.ts#L87)
- [x] CALL renders each returned result set as a separate table; no "Create view"/export. <!-- parity:test --> `p09-c6af25` [sql-tab.parity.test.ts:170](../../tests/parity/sql-tab.parity.test.ts#L170) +1
- [x] Empty result sets with columns still render the (empty) table header plus "Query results operations" (Create view) and the bookmark form. <!-- parity:test --> `p09-4d18f5` [query.test.ts:109](../../apps/server/test/int/query.test.ts#L109) +1
- [x] Bookmark form under results posts the *complete* submitted text, not the single statement; shows "Bookmark %s has been created." / "Bookmark not created!". <!-- parity:test --> `p09-523b05` [sql-editor-extras.e2e.ts:113](../../tests/e2e/sql-editor-extras.e2e.ts#L113)
- [x] Browsing a table whose name equals one of the user's bookmark labels runs the bookmark instead and shows "Using bookmark "%s" as default browse query." with FAQ 6.22 icon. <!-- parity:test --> `p09-6b0a5a` [sql-editor-extras.e2e.ts:183](../../tests/e2e/sql-editor-extras.e2e.ts#L183)
- [x] Default browse ORDER BY uses the first primary-key column when `TablePrimaryKeyOrder` is ASC/DESC. <!-- parity:test --> `p09-945e16` [browse.test.ts:135](../../apps/server/test/int/browse.test.ts#L135)
- [x] `sql_query` in GET is executed only with a valid `sql_signature` (HMAC-SHA256 of the SQL with session secret + `blowfish_secret`). <!-- parity:test --> `p09-3ee67a` [sql-tab.test.ts:136](../../apps/server/test/int/sql-tab.test.ts#L136)
- [x] History records every request's `Current::$sqlQuery` (browse included) unless `no_history`; skips queries longer than `MaxCharactersInDisplayedSQL`; capped at `QueryHistoryMax` in session and (when `QueryHistoryDB`) in `pma__history` by timestamp purge. <!-- parity:test --> `p09-45cd38` [metadata.test.ts:183](../../apps/server/test/int/metadata.test.ts#L183) +1
- [x] Console: history entries have Requery (confirm), Edit, Explain (prefix `EXPLAIN `), Profiling, Bookmark; `.select` styling for SELECTs; "Queried time" shows DB timestamp or "During current session"; `reloadQuerywindow` appends the current browsing query to the console on every AJAX response (hidden unless "Show current browsing query"). <!-- parity:test --> `p09-f102f9` [sql-editor.e2e.ts:274](../../tests/e2e/sql-editor.e2e.ts#L274)
- [x] Console keys: Enter vs Ctrl+Enter (option), Shift+Enter newline, Ctrl+L clear line, Ctrl+U clear console, ↑/↓ history at first/last line. <!-- parity:test --> `p09-c24913` [sql-editor.e2e.ts:236](../../tests/e2e/sql-editor.e2e.ts#L236)
- [x] Console options persist per user via `/console/update-config` with strict key/value validation (400 on invalid). <!-- parity:test --> `p09-f4e866` [sql-tab.test.ts:241](../../apps/server/test/int/sql-tab.test.ts#L241)
- [x] Debug SQL card only with `$cfg['DBG']['sql']`; shows every internal query with time, count grouping and backtraces. <!-- parity:test --> `p09-b87d68` [sql-tab.test.ts:289](../../apps/server/test/int/sql-tab.test.ts#L289)
- [x] Profiling card: Detailed profile (Order/State/Time), Summary by state (State/Total Time/% Time/Calls/ø Time, doc link `general-thread-states`), pie chart; tables sortable. <!-- parity:test --> `p09-33158a` [sql-message.test.ts:141](../../apps/server/test/unit/sql-message.test.ts#L141) +3
- [x] Page settings "SQL queries" panel exposes ShowSQL, Confirm, QueryHistoryMax, IgnoreMultiSubmitErrors, MaxCharactersInDisplayedSQL, RetainQueryBox, CodemirrorEnable, LintEnable, EnableAutocompleteForTablesAndColumns, DefaultForeignKeyChecks and the four SQLQuery link toggles. <!-- parity:test --> `p09-efe138` [preferences.parity.test.ts:214](../../tests/parity/preferences.parity.test.ts#L214)
- [x] Kanji encoding conversion card appears when `Encoding::canConvertKanji()`. <!-- parity:test --> `p09-b31fd8` [sql-editor-extras.e2e.ts:193](../../tests/e2e/sql-editor-extras.e2e.ts#L193)
- [ ] Form has `enctype=multipart/form-data` only when uploads are enabled (shared with import). <!-- parity:n/a: the SPA posts JSON (no HTML form submit); file upload lives on the Import page -->

---

## Rebuild notes (modern mapping)

**Parser.** The entire pipeline depends on a *clause-aware, token-preserving* MySQL parser (replace/get clause by name, rebuild statement, extract tables behind aliases, detect subqueries/joins/aggregates, split multi-statements with custom delimiters, report lexer/parser errors with absolute positions). `node-sql-parser` gives an AST but not token positions, clause slicing or MySQL-dialect error positions, and its `DELIMITER`/comment handling is weak. Recommended: port `phpmyadmin/sql-parser` (Lexer, Parser, `Utils\Query`, `Utils\BufferedQuery`, `Utils\Formatter`, `Utils\Error`) to TypeScript so one implementation serves the browser (lint, autocomplete context, simulate-button detection — today a regex — and formatting) and the server (LIMIT injection, count rewriting, flags). Keep the `StatementFlags`/`StatementInfo` shape so the flag table above maps 1:1. Replace the ad-hoc regexes (`^SELECT`, `^EXPLAIN …`, DROP/CREATE/RENAME reload hints, confirm patterns, simulate detection, SHOW variants) with flag checks from the same parser, but keep their observable behaviour.

**Editor.** CodeMirror 6 (or Monaco) with: MySQL mode, bracket matching, line numbers, wrapping, resizable height, `Ctrl-Space` completion sourced from a per-database schema endpoint (`information_schema.columns`) plus keyword list, async lint provider that calls the shared parser locally (no round-trip; keep the 10k-char cutoff and the routine/trigger/event header trick), `Ctrl/Alt+Enter` run, dirty-state page-lock, autosave to localStorage keyed by `db[.table]`, "Show this query here again" persistence, bind-parameter panel (`:name` scanning with preserved inputs), delimiter input, snippet buttons at table scope, column side-list with insert-at-cursor.

**Execution service.** One endpoint receives `{sql, db, table, delimiter, params, options: {rollback, fkChecks, profiling, showAsPhp, bookmark: {label, shared, replace}, bookmarkRun: {id, variables}}}`. Server steps: split (parser), per-statement analyse → flags, DROP DATABASE guard, FK checks set/restore, optional `START TRANSACTION`/`ROLLBACK` (actually issue the ROLLBACK), LIMIT injection with the same `isAppendLimitClause` rules, execute, capture `affected_rows`, `insert_id`, warnings, timing, `SHOW PROFILE`, compute total via the same three-tier strategy (no count / approximate `information_schema` or `SHOW TABLE STATUS` with `MaxExactCount` threshold / `SELECT COUNT(*) FROM (…)` rewrite), remembered sorting from a `table_uiprefs` equivalent, and return a structured result per statement: `{kind: 'resultset'|'affected'|'error'|'php', sql, limitedSql, flags, rows, fields, numRows, totalRows, approximate, queryTime, insertId, warnings, profile, message, links: {editInline, edit, explain|skipExplain|skipAnalyze, createPhp, refresh}}`. Render the message card client-side from this structure (texts above), so "Create PHP code" becomes a client-side transformation (`addslashes` + `\n"` continuation) with no server call.

**Streaming & cancellation.** `tryQuery` is buffered and single-shot; long SELECTs block until complete (session is closed around the call to avoid locking other tabs). In the rebuild: run the statement on a dedicated connection, stream rows (NDJSON/SSE) after the first page, compute the total asynchronously (second request) so the grid appears immediately, and expose cancel: record the connection's `CONNECTION_ID()` per running request and issue `KILL QUERY <id>` from a control connection (phpMyAdmin already has `getKillQuery()` for the processlist). Timeouts: honour `ExecTimeLimit` with `max_execution_time` hints (`SET SESSION max_execution_time` for SELECT on MySQL ≥5.7.8).

**Result rendering.** Virtualize rows (windowed table) while preserving the "Showing rows a – b (N total, …)" semantics; keep the `~` approximate marker and the view hint; keep per-statement result blocks for multi-statement runs and multi-result loops for `CALL`.

**Bookmarks/history.** Tables `bookmark(id, dbase, user, label, query)` and `history(id, username, db, table, timevalue, sqlquery)` map directly; keep variable syntax `[VARIABLE]`/`[VARIABLEn]` and the comment-unwrapping rule for compatibility, but consider escaping options. History should be written server-side on execution (not via a middleware observing `Current::$sqlQuery`) with the same cap/purge; keep session fallback when DB history is off. Console: keep the shortcuts, history navigation, requery/explain/profiling actions and per-user persisted options.

**Security parity.** Signed `sql_query` URLs (HMAC with per-session secret) for GET execution; `AllowUserDropDatabase`; confirm prompts (configurable via `Confirm`); never run queries when generating PHP code; lint endpoint parses only.

**Implementation notes (BetterMyAdmin).** Parity registries: `apps/web/src/features/sql/pma-controls.ts` (sql/query.twig, resources/js/sql.ts) and `apps/web/src/features/console/pma-controls.ts` (console/display.twig, resources/js/modules/console.ts); UI parity cases in `tests/ui-parity/sql.uip.ts` (`db-sql`, `table-sql`, `table-sql-results`, `console`; `server-sql` in pages.uip.ts); statements in `tests/parity/sql-tab.parity.test.ts`, `metadata.parity.test.ts` (bookmarks, console bookmarks add/refresh, history) and `name-lists.parity.test.ts` (/tables, /columns). Behaviours aligned with phpMyAdmin in this pass:
- a console query is the SQL box request (`grid`), so the main panel gets the full results (operations, "Bookmark this SQL query") in the context the query sets (the response's db and table, like the /import response's menu);
- an empty result set shows "Query results operations" with Create view only (sql/no_results_returned.twig);
- the console's message list and input scroll as one `.content` (Console.scrollBottom);
- both console inputs lint (CodeMirror.sqlLint) and complete tables and columns on input and Ctrl+Space (codeMirrorAutoCompleteOnInputRead); the console's highlighting has no manual links (CodeMirror.runMode);
- the Options and Debug SQL cards close with their own title (`.switch_button`); text selection is off while the console is resized (`selectstart`);
- Debug SQL shows the statements of every API response that reports them (`$(document).on('ajaxSuccess')`), not only the console's; PHP backtraces (Show trace / arguments) are n/a;
- the view form's plain AS textarea selects its text on the first click (`#view_as` selectContent).


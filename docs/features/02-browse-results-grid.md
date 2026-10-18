# Browse / SQL Query Results Grid

This document describes, exhaustively and from source, how phpMyAdmin (master, Oct 2026) renders and operates the result set of a SQL query: the "Browse" tab of a table, the output of the SQL tab, and every control around the grid (pagination, sorting, display options, grid editing, row actions, bulk actions, query-results operations, bookmarks, error display). Every statement below cites the PHP class/method, Twig template or TypeScript module it was derived from so that a developer can verify it. Config directives are named with their defaults as declared in `src/Config/Settings.php` (and `docs/config.rst`).

Path prefix for all citations: the phpMyAdmin repository root. `Results.php` means `src/Display/Results.php`; `table.twig` means `resources/templates/display/results/table.twig`; `makegrid.ts` means `resources/js/makegrid.ts`; `sql.ts` means `resources/js/sql.ts`.

---

## Scope & source map

| Feature area | phpMyAdmin source |
|---|---|
| Entry point for Browse / run query / sort / paginate / display options / single-row delete / FK traversal | `src/Controllers/Sql/SqlController.php` (route `/sql`, GET+POST) |
| Query pipeline: remembered sort, LIMIT injection, row counting, execution, FK-check toggle, result vs no-result response, "editable" detection, bookmark store | `src/Sql.php` (`executeQueryAndGetQueryResponse`, `executeTheQuery`, `countQueryResults`, `isAppendLimitClause`, `isJustBrowsing`, `handleSortOrder`, `resultSetContainsUniqueKey`, `getQueryResponseForResultsReturned`, `getQueryResponseForNoResultsReturned`, `getMessageForNoRowsReturned`) |
| Query parsing / db+table detection | `src/ParseAnalyze.php` (`sqlQuery`) |
| Default browse query, bookmark-as-default-query, TablePrimaryKeyOrder | `Sql::getDefaultSqlQueryForBrowse` |
| Grid HTML generation (header, message, navigation, options block, headers, body, cells, operations) | `src/Display/Results.php`, helpers `src/Display/DisplayParts.php`, `DeleteLinkEnum.php`, `ForeignKeyRelatedTable.php`, `SortExpression.php` |
| Grid templates | `resources/templates/display/results/{table,table_headers_for_columns,checkbox_and_links,row_data,null_display,empty_display,value_display,comment_for_row,page_selector}.twig` |
| Wrapper templates for results page | `resources/templates/sql/{sql_query_results,no_results_returned,_bookmark,profiling_chart,query,enum_column_dropdown,set_column,relational_column_dropdown}.twig` |
| Unique WHERE clause per row | `src/UniqueCondition.php` |
| Result header "query box" (Edit / Edit inline / Explain / Create PHP code / Refresh / Profiling) | `src/Html/Generator.php::getMessage`; `src/Config/Settings/SqlQueryBox.php` (`$cfg['SQLQuery']`) |
| SQL error display | `src/Html/Generator.php::mysqlDie`; `Sql::handleQueryExecuteError` |
| Page selector (dropdown of pages) | `src/Util.php::pageselector` |
| Row count (approximate vs exact) | `src/Table/Table.php::countRecords`; `Sql::countQueryResults` |
| Column order / visibility / remembered sort persistence (pmadb `table_uiprefs`) | `src/Table/Table.php` (`getUiProp`, `setUiProp`, `removeUiProp`, `loadUiPrefs`, `getUiPrefsFromDb`, `saveUiPrefsToDb`), `src/Table/UiProperty.php`, `src/Controllers/Sql/ColumnPreferencesController.php` (route `/sql/set-column-preferences`) |
| Grid editing AJAX helpers | `src/Controllers/Sql/EnumValuesController.php` (`/sql/get-enum-values`), `SetValuesController.php` (`/sql/get-set-values`), `RelationalValuesController.php` (`/sql/get-relational-values`), `DefaultForeignKeyCheckValueController.php` (`/sql/get-default-fk-check-value`); `Sql::getValuesForColumn`, `getFullValuesForSetColumn`, `getHtmlForRelationalColumnDropdown`; full-value fetch via `/sql` with `grid_edit=1` (`Sql::getResponseForGridEdit`) |
| Grid-edit save | `src/Controllers/Table/ReplaceController.php` (route `/table/replace`), `src/InsertEdit.php` (`verifyWhetherValueCanBeTruncatedAndAppendExtraData`, `getDisplayValueForForeignTableColumn`, `getLinkForRelationalDisplayField`) |
| Bulk actions: Edit/Copy/Export/Delete with selected | `src/Controllers/Table/ChangeRowsController.php` (`/table/change/rows`), `ExportRowsController.php` (`/table/export/rows`), `DeleteConfirmController.php` (`/table/delete/confirm`), `DeleteRowsController.php` (`/table/delete/rows`); template `resources/templates/table/delete/confirm.twig` |
| BLOB/binary download link | `src/Controllers/Table/GetFieldController.php` (`/table/get-field`) |
| Foreign key metadata / display column / FK dropdown | `src/ConfigStorage/Relation.php` (`getForeignersInternal`, `getForeignKeysData`, `getDisplayField`, `getForeignData`, `foreignDropdown`, `buildForeignDropdown`, `getComments`) |
| Browse foreign values popup | `src/Controllers/BrowseForeignersController.php` (`/browse-foreigners`), `src/BrowseForeigners.php`, `resources/templates/table/browse_foreigners/*.twig`, `sql.ts::browseForeignDialog` |
| Browser transformations on display | `src/Transformations.php::getMime`, `Results::setMimeMap`, `Results::setDefaultTransformations`, `src/Config/SpecialSchemaLinks.php`, `src/InternalRelations.php`, `src/Plugins/Transformations/**` |
| FK checks toggle | `src/Utils/ForeignKey.php` (`isCheckEnabled`, `handleDisableCheckInit`, `handleDisableCheckCleanup`) |
| Client-side grid (resize/reorder/visibility/grid edit/cell selection/copy) | `resources/js/makegrid.ts` |
| Client-side page glue (delete row, bookmark, copy to clipboard, show-all confirm, filter rows, display options form, bulk submit, simulate DML, browse-foreign modal, column hover/mark, profiling tables) | `resources/js/sql.ts` |
| Multi-column sort (Shift/Ctrl/Alt click) | `resources/js/multi_column_sort.ts` |
| Sort icon hover swap, check-all with shift-range, page selector/autosubmit forms, print, confirm dialogs, datepicker, inline SQL edit | `resources/js/modules/functions.ts`, `resources/js/modules/functions/event-loader.ts` |
| Global keyboard shortcuts | `resources/js/shortcuts_handler.ts` |
| Simulate UPDATE/DELETE | `src/Controllers/Import/SimulateDmlController.php`, `src/Import/SimulateDml.php` |
| Rollback-when-finished | `src/Controllers/Import/ImportController.php`, `src/Import/Import.php::checkIfRollbackPossible` |
| Query box form | `src/SqlQueryForm.php`, `resources/templates/sql/query.twig` |
| JS strings (hints, confirmations) | `src/Controllers/JavaScriptMessagesController.php` |
| JS runtime params (`LimitChars`, `pftext`, `confirm`) | `src/Header.php::getJsParams` |
| Page settings panel for Browse | `src/Config/PageSettings.php`, `src/Config/Forms/Page/BrowseForm.php`, `src/Config/Forms/User/MainForm.php` (group `Browse`) |
| Bookmarks | `src/Bookmarks/Bookmark.php`, `src/Bookmarks/BookmarkRepository.php` |

### Config directives touching the grid (name → default → where it bites)

All in `src/Config/Settings.php` unless stated.

| Directive | Default | Effect / where used |
|---|---|---|
| `MaxRows` | `25` | Rows per page when the query has no LIMIT (`Results::setConfigParamsForDisplayTable`, `Sql::getSqlWithLimitClause`). Also used as the "Number of rows" value when returning from Show all. |
| `ShowAll` | `false` | Always show the "Show all" checkbox; otherwise only shown when `unlimNumRows <= 500` (`Results::getTableNavigation` → `has_show_all`). |
| `Order` | `'SMART'` | Direction of first click on an unsorted column: `SMART` = DESC for date/time types, ASC otherwise; else `ASC`/`DESC` literal (`Results::getSingleAndMultiSortUrls`). |
| `RepeatCells` | `100` | Repeat header row every N data rows (0 disables) (`Results::getTableBody`, `getRepeatingHeaders`). Stored per-query in session as `repeat_cells`. |
| `LimitChars` | `50` | Truncate non-numeric/non-binary cell text to N chars + `...` in "Partial texts" mode (`Results::getPartialText`); also truncates column comments in headers, FK display values, sorted-column first/last message. Sent to JS as `CommonParams LimitChars`. |
| `ShowBrowseComments` | `true` | Show column comments under header names (`Results::getTableCommentsArray`, `comment_for_row.twig`). |
| `GridEditing` | `'double-click'` | `'click'`, `'double-click'`, `'disabled'` → class `click1`/`click2` on cells (`Results::getTableBody`, `getRowValues`; `makegrid.ts::initGridEdit`). |
| `SaveCellsAtOnce` | `false` | Post each edited cell immediately vs. collect edits and show "Save edited data" button (`table.twig` hidden input `.save_cells_at_once`; `makegrid.ts::saveOrPostEditedCell`). |
| `RelationalDisplay` | `'K'` | Default for Options → Relational key (`K`) / Display column (`D`) (`Results::setConfigParamsForDisplayTable`). Session value wins over later config changes. |
| `ProtectBinary` | `'blob'` | `false`/`'blob'`/`'noblob'`/`'all'`; disables grid editing of binary cells (`Results::getDataCellForNonNumericColumns`). |
| `DisplayBinaryAsHex` | — | **Removed in 4.3.0** (`docs/config.rst`). Not present in `Settings.php`. Replaced by Options → "Show binary contents"/"Show BLOB contents". |
| `ForeignKeyMaxLimit` | `100` | If foreign table has at least this many rows, grid-edit shows "Browse foreign values" link instead of dropdown (`Relation::getForeignData`, `Sql::getHtmlForRelationalColumnDropdown`). |
| `ForeignKeyDropdownOrder` | `['content-id', 'id-content']` | Ordering/duplication of FK dropdown sections (`Relation::foreignDropdown`, `buildForeignDropdown`). |
| `NaturalOrder` | `true` | Natural sort used inside FK dropdown sections (`Relation::buildForeignDropdown`). |
| `RowActionLinks` | `'left'` | `left`/`right`/`both`/`none` placement of checkbox+Edit+Copy+Delete (`Results::getTableBody`, `getFieldVisibilityParams`, `getColumnAtRightSide`). |
| `RowActionType` | `'both'` | `icons`/`text`/`both` for Edit/Copy/Delete link content (`Results::getActionLinkContent`). |
| `RowActionLinksWithoutUnique` | `false` | Show row actions and checkboxes even when result has no unique key (`Sql::getQueryResponseForResultsReturned`). |
| `TablePrimaryKeyOrder` | `'NONE'` | `NONE`/`ASC`/`DESC`: default `ORDER BY <first PK column>` for Browse (`Sql::getDefaultSqlQueryForBrowse`). |
| `RememberSorting` | `true` | Persist last ORDER BY per table in `table_uiprefs` (`Sql::isRememberSortingOrder`, `handleSortOrder`). |
| `BrowsePointerEnable` | `true` | Row hover highlight (`nopointer` class when disabled) and column hover (`th.pointer`). |
| `BrowseMarkerEnable` | `true` | Row marking on checkbox and column marking on header click (`nomarker` class when disabled; `th.marker`). |
| `TableNavigationLinksMode` | `'icons'` | `text`/`icons`/`both` for Begin/Previous/Next/End buttons (`table.twig` via `show_icons`/`show_text`). |
| `ActionLinksMode` | `'both'` | Icons/text for tab links (used in query box "Insert" button label, `query.twig`). |
| `ShowSQL` | `true` | Render the executed SQL in the result header card (`Generator::getMessage`), and include `sql_query` HTML in AJAX no-result responses. |
| `RetainQueryBox` | `false` | Default of "Retain query box" checkbox (`SqlQueryForm::getHtml`); when unchecked the query box is collapsed after a successful AJAX run (`sql.ts`). |
| `CodemirrorEnable` | `true` | Enables CodeMirror editor and "Format"/"Format as a single line" buttons (`query.twig`). |
| `LintEnable` | `true` | SQL linting in CodeMirror (used by codemirror module; not grid-specific). |
| `SQLQuery.Edit`/`Explain`/`ShowAsPHP`/`Refresh` | all `true` (`src/Config/Settings/SqlQueryBox.php`) | Which links appear in the result header card (`Generator::getMessage`). |
| `MaxCharactersInDisplayedSQL` | `1000` | Beyond this the Explain / Create PHP code / Edit inline links are omitted (`Generator::getMessage` `$queryTooBig`). |
| `MaxExactCount` | `50000` | Threshold where InnoDB approximate row count is accepted instead of `SELECT COUNT(*)` (`Table::countRecords`, `Sql::countQueryResults`, `Results::isExactCount`). |
| `MaxExactCountViews` | `0` | Row counting for views: 0 bypasses counting (total = -1) (`Table::countRecords`). |
| `BrowseMIME` | `true` | Apply browser transformations in grid (`Results::setMimeMap`, `getRowValues`). |
| `DefaultTransformations` | object (`src/Config/Settings/Transformations.php`) | Default options per transformation plugin (e.g. `TextLink`). |
| `InitialSlidersState` | `'closed'` | Options panel collapsed/open/disabled (`table.twig` `default_sliders_state`). |
| `IgnoreMultiSubmitErrors` | `false` | When true, a MySQL error is shown inline as message instead of aborting (`Sql::executeTheQuery`). |
| `Confirm` | `true` | JS confirm dialogs (`CommonParams confirm`; `functions.ts::confirmDialog`). Delete-row link confirmation. |
| `DefaultForeignKeyChecks` | `'default'` | Initial state of "Enable foreign key checks" checkbox (`ForeignKey::isCheckEnabled`). |
| `AllowSharedBookmarks` | (see Settings) | Show "Let every user access this bookmark" switch (`_bookmark.twig`, `query.twig`). |
| `LinkLengthLimit` | (see Settings) | `Generator::linkOrButton` turns long GET links into POST buttons (`data-post`) — affects sort links, FK links, Edit/Copy links with huge WHERE clauses. |
| `Servers[i].MaxTableUiprefs` | per server | Max rows kept in `pma__table_uiprefs` (`Table::saveUiPrefsToDb`). |
| `TextareaCols`/`TextareaRows`/`TextareaAutoSelect` | `40`/`15`/`false` | Query box textarea (`SqlQueryForm`). |
| `DefaultQueryTable`/`DefaultQueryDatabase` | see Settings | Prefill of the query box when empty (`SqlQueryForm::init`). |
| `AllowUserDropDatabase` | see Settings | `DROP DATABASE` refused for non-superusers in `/sql` (`Sql::hasNoRightsToDropDatabase`). |
| `DisableShortcutKeys` | `false` | Whether `shortcuts_handler.js` is loaded (global shortcuts). |

User-preference "Page settings" (gear) for the Browse page exposes exactly: `TableNavigationLinksMode, ActionLinksMode, ShowAll, MaxRows, Order, BrowsePointerEnable, BrowseMarkerEnable, GridEditing, SaveCellsAtOnce, RepeatCells, LimitChars, RowActionLinks, RowActionLinksWithoutUnique, TablePrimaryKeyOrder, RememberSorting, RelationalDisplay` (`src/Config/Forms/User/MainForm.php` group `Browse`; `SqlController` calls `$this->pageSettings->init('Browse')`; the panel is not rendered in print view, `PageSettings::init`).

---

## Screens / components

### Request → response pipeline (what happens before anything is rendered)

**Purpose:** Every grid action (browse, run query, sort, paginate, change display options, delete a row, follow a FK link, change "Number of rows") is a request to route `/sql` handled by `SqlController::__invoke`, which delegates to `Sql::executeQueryAndSendQueryResponse`.

**Server-side behaviour (in order), `SqlController::__invoke` and `Sql::executeQueryAndGetQueryResponse`:**

1. `PageSettings::init('Browse')` renders the page-settings panel (skipped when `printview`). Scripts added: `vendor/jquery/jquery.uitablefilter.js`, `table/change.js`, `gis_data_editor.js`, `multi_column_sort.js`. (`makegrid.js`, `sql.js` are added later only when results are returned and not print view: `Sql::getQueryResponseForResultsReturned`.)
2. `goto`: if empty it defaults to `DefaultTabDatabase` (no table) or `DefaultTabTable` route. `errorUrl` = `back` or `goto` + `db` (+ `table`).
3. The SQL query is taken from, in priority: bookmark dialog fields `bkm_fields[bkm_sql_query]`; POST `sql_query`; GET `sql_query` **only when accompanied by a valid `sql_signature`** (`Core::checkSqlQuerySignature`). Sort links, FK links, Refresh links etc. are GET links carrying a signature. A GET `sql_query` without valid signature is ignored.
4. If no query and `db`+`table` are set → default browse query `Sql::getDefaultSqlQueryForBrowse`: if a bookmark whose **label equals the table name** exists for the current user in this db, its query is used and a notice "Using bookmark "%s" as default browse query." (+ FAQ 6.22 doc link) is displayed above the result (`Sql::$usingBookmarkMessage`, rendered in `Generator::getMessage`). Otherwise `SELECT * FROM \`table\``, plus ` ORDER BY \`table\`.\`<first PK column>\` ASC|DESC` when `TablePrimaryKeyOrder` is not `NONE` and the table has a PRIMARY key. In that case `goto` is reset to `''`.
5. If still no query → "missing parameter sql_query" error.
6. `ParseAnalyze::sqlQuery` parses with phpmyadmin/sql-parser (`Query::getAll`). If the statement selects from exactly one table, `db`/`table` are overridden by the table (and db) found in the SQL; with more than one table, `table` becomes `''`. `reload` flag is set for ALTER/CREATE/DROP statements or when the db changed (non-AJAX only).
7. `DROP DATABASE` by non-superuser when `AllowUserDropDatabase` is false → error `"DROP DATABASE" statements are disabled.`
8. `store_bkm` POST → create bookmark from `bkm_fields` (+`bkm_all_users`) and return `Bookmark %s has been created.` / `Bookmark not created!` (`SqlController::addBookmark`). Non-AJAX redirects to `goto&label=…`, which triggers the "created" banner (`Sql::getBookmarkCreatedMessage` reads GET `label`).
9. If `goto` equals plain `/sql`, it is rewritten to `/sql?db&table&sql_query` and `isGotofile=false`.
10. `message_to_show` POST param is used as success message for non-SELECT queries that return no rows (e.g. "The row has been deleted." passed by the Delete link).
11. **Remembered sorting** (`Sql::isRememberSortingOrder` + `handleSortOrder`): applies only when `RememberSorting` is on, statement is `SELECT *` (no expressions or exactly `*`) from exactly one table, not COUNT/export/function/ANALYSE, not UNION, and the request did not come from the "Sort by key" dropdown (`sort_by_key` param). If the query has no ORDER BY → read `sorted_col` from the table's UI prefs (`Table::getUiProp(UiProperty::SortedColumn)`), strip the `\`table\`.` prefix and inject `ORDER BY <sorted_col>` via `Query::replaceClause` (re-parsing the query). If the query has an ORDER BY → save it as `sorted_col`. **Exception:** if `$_SESSION['sql_from_query_box']` is set (set by the query box submission in `ImportController`), the remembered sort is *not* applied once and the flag is cleared — so a hand-typed query is executed as typed. `getUiProp(SortedColumn)` validates the column still exists in the table (unless POST `discard_remembered_sort` is set) and removes the pref otherwise.
12. `Results::setConfigParamsForDisplayTable` establishes per-query session state (see "Session state" below).
13. **LIMIT injection** (`Sql::isAppendLimitClause` → `getSqlWithLimitClause`): a `LIMIT <pos>, <max_rows>` clause is appended/replaced when: no parser errors; `max_rows !== 'all'`; not `INTO OUTFILE`/export; not `PROCEDURE ANALYSE`; the statement is a SELECT-FROM or a sub-query; and the user's query has **no LIMIT of its own**. Queries with their own LIMIT are run verbatim and the navigation bar is hidden (`Results::getTable`: `navigation` only when `empty($statement->limit)`).
14. `ResponseRenderer::$reload` = whether `SELECT DATABASE()` differs from `$db` (a `USE` was sent). `selectDb($db)`.
15. "Create PHP code" mode (`Sql::$showAsPhp !== null`, set by `ImportController` from `show_as_php`): the query is **not executed**; only the message card is returned (`Sql::getMessageForNoRowsReturned` yields "Showing as PHP code" or "Showing SQL query").
16. `ForeignKey::handleDisableCheckInit`: reads current `FOREIGN_KEY_CHECKS`; if request has `fk_checks` → set ON/OFF accordingly. Restored after the response is built (`handleDisableCheckCleanup`).
17. `Sql::executeTheQuery`: enables profiling if requested (`Profiling::enable` — session flag `profiling`), **closes the PHP session during execution** (`session_write_close`) then reopens it, runs `tryQuery`, records `lastQueryExecutionTime` as `queryTime`. On MySQL error: if `IgnoreMultiSubmitErrors` → error becomes an inline message; otherwise `handleQueryExecuteError` emits `Generator::mysqlDie` output (AJAX: JSON `message` with `success=false`) and exits. If `bkm_label` POST is non-empty → `storeTheQueryAsBookmark` (with `bkm_replace` deleting same-label bookmarks first, `bkm_all_users` for shared). `numRows` = `affectedRows()` for affected statements else `numRows()`. Profiling results fetched. `unlimNumRows` via `countQueryResults`. Relation cleanup for dropped columns/tables (`purge`).
18. Warnings (`dbi->getWarnings()`) are appended as notice messages after the whole output.
19. Branch: no rows (`numRows===0 && unlimNumRows===0`), or an "affected" statement, or `result===false` → `getQueryResponseForNoResultsReturned`; else `getQueryResponseForResultsReturned`.

**Row counting (`Sql::countQueryResults`), i.e. the "N total" number:**
- If no LIMIT was appended: `unlimNumRows = numRows`.
- Else if `max_rows > numRows` (page not full): `unlimNumRows = pos + numRows` (no count query at all).
- Else if SELECT or sub-query:
  - **Just browsing** (`Sql::isJustBrowsing`: no GROUP BY, no function, no UNION, no DISTINCT, one table, WHERE absent or exactly `WHERE 1`, no sub-query, no JOIN, no HAVING): `Table::countRecords()` — uses `SHOW TABLE STATUS` `Rows` (approximate for InnoDB) if that is `>= MaxExactCount`, otherwise `SELECT COUNT(*)`. Then if the value is `< MaxExactCount` an exact `countRecords(true)` is forced. Result is cached per request (`ExactRows`). For a VIEW: `MaxExactCountViews === 0` → returns **-1** (unknown); otherwise `SELECT 1 FROM view LIMIT MaxExactCountViews` and -1 if the limit was reached.
  - Otherwise: a count query `SELECT COUNT(*) FROM (<statement without ORDER BY and LIMIT, SQL_NO_CACHE removed, SELECT list replaced by `1` unless GROUP BY/DISTINCT/UNION>) as cnt`.
- Non-SELECT: 0.

Note: current master passes empty `$preCount`/`$afterCount` to `setMessageInformation`, so there is **no "~" approximate marker and no "exact count" link** in the header any more; the displayed total may silently be the InnoDB estimate when the table has `>= MaxExactCount` rows. The only approximate-count UI remaining is the view hint described under the header message.

**Editable detection (`Sql::getQueryResponseForResultsReturned`):**
- `justOneTable` = all non-empty `field->table` values are identical (`resultSetHasJustOneTable`) and, for SELECT, there is no JOIN, no sub-query and exactly one table in `selectTables`.
- `updatableView` = statement is `SELECT *` on a table and `Table::isUpdatableView()`.
- `hasUnique` = `resultSetContainsUniqueKey`: some UNIQUE index of the table has **all** its columns present in the result set by name (INVISIBLE columns count as present).
- `editable = (hasUnique || RowActionLinksWithoutUnique || updatableView) && justOneTable && !isSystemSchema(db)` (information_schema, performance_schema, mysql, sys treated as system).
- `$_SESSION['tmpval']['possible_as_geometry'] = editable` (controls whether the "Geometry" radio appears in Options).
- `DisplayParts`: editable → `hasEditLink=true, deleteLink=DELETE_ROW, hasSortLink, hasNavigationBar, hasBookmarkForm, hasTextButton=false, hasPrintLink`. Not editable → same but `hasEditLink=false, deleteLink=NO_DELETE, hasTextButton=true`. `printview` → everything false.
- A notice is shown above the grid (`Sql::getMessageIfMissingColumnIndex`) when a table is known:
  - system schema or not editable: "Current selection does not contain a unique column. Grid edit, checkbox, Edit, Copy and Delete features are not available." + doc link `cfg_RowActionLinksWithoutUnique`.
  - editable only because of `RowActionLinksWithoutUnique` (no unique key): "Current selection does not contain a unique column. Grid edit, Edit, Copy and Delete features may result in undesired behavior." + doc link.

**Display parts refinement in `Results::setDisplayPartsAndTotal`:**
- Print view → no edit/delete/sort/navigation/bookmark/text-button/print link.
- COUNT / PROCEDURE ANALYSE / maintenance (CHECK/ANALYZE/REPAIR/OPTIMIZE/CHECKSUM) / EXPLAIN → no edit/delete/sort/navigation; bookmark form yes; text button only for maintenance; print link yes.
- SHOW … → no edit/sort/navigation; if `SHOW [FULL] PROCESSLIST` the delete link becomes **KILL_PROCESS** (a "Kill" link per row that runs `dbi->getKillQuery(id)` with `db=mysql`); bookmark form, text button, print link yes.
- Other SELECT: links are removed if columns come from more than one table (`field->table` differs across fields) or no field has a table.
- Total: `unlimNumRows` if `> 0`, else `countRecords()` when a navigation bar or sort links are present and db/table known.
- `SELECT COUNT` with more than one row (GROUP BY) re-enables navigation and sort links.
- Sort links are removed when `unlimNumRows < 2` **unless the table is a view** (view counts may be unknown).

**Session state (`Results::setConfigParamsForDisplayTable`), keyed by `md5(server . db . sql_query)` in `$_SESSION['tmpval']['query'][...]`, max 10 remembered queries (LRU, oldest removed):**
- `repeat_cells` (default `RepeatCells`).
- `max_rows`: from request `session_max_rows` (numeric or `'all'`), else remembered, else `MaxRows`.
- `pos`: from request `pos` (numeric), else remembered, else 0.
- `pftext`: request `pftext` (`P`/`F`), else `F` forced for EXPLAIN statements, else remembered, else `P`.
- `relational_display`: request (`K`/`D`), else remembered, else `RelationalDisplay`.
- `geoOption`: request (`WKT`/`WKB`/`GEOM`), else remembered, else `GEOM`.
- `display_binary`: true if request has `display_binary`; unset if the Options form was submitted without it (`display_options_form` present); **otherwise defaults to true** unless the request came from the "full text" toggle link (`full_text_button`).
- `display_blob`, `hide_transformation`: true if present in request; unset when Options form submitted without them; otherwise remembered.
- The current values are copied to `$_SESSION['tmpval'][pftext|relational_display|geoOption|display_binary|display_blob|hide_transformation|pos|max_rows|repeat_cells]` for use by the renderer.
- Note that `pos`/`max_rows` are remembered per exact SQL string, so the same query re-run later returns to the remembered page.

---

### Screen: Results page wrapper (`sql/sql_query_results.twig`)

**Layout top-to-bottom** (`Sql::getQueryResponseForResultsReturned`):
1. `previous_update_query`: when the request carried a `disp_query`/`disp_message` (e.g. after bulk delete) and `ShowSQL` is on → a message card with the previously executed query (`Generator::getMessage`).
2. `profiling_chart` (see Profiling).
3. `missing_unique_column_message` (see above).
4. `bookmark_created_message` "Bookmark %s has been created." when GET `label` is present.
5. `table` — the whole grid output of `Results::getTable` (see below).
6. Bookmark form (`sql/_bookmark.twig`) when the bookmark feature (pmadb `bookmark` table) is configured, `hasBookmarkForm` is true, GET `id_bookmark <= 0` and a query exists.

Everything is wrapped in `<div class="sqlqueryresults ajax">`; the `makeGrid` custom event is triggered on it after every AJAX load (`sql.ts`).

---

### Component: Result header / message card ("result_query")

**Source:** `Results::getTable` (message assembly), `Results::setMessageInformation`, `Results::getSortedColumnMessage`, `Generator::getMessage`.

**Purpose:** Shows success status, row range, totals, timing and the executed SQL with action links.

**Layout:**
1. Optional "Using bookmark … as default browse query." notice.
2. Bootstrap alert (`alert-success` for success, `alert-notice`… by message context) with icon and text:
   - With navigation bar: `Showing rows <first> - <last> (<total> total, Query took <t> seconds.) [<sortcol>: <FIRST> - <LAST>]`
     - `first`/`last`: if the user's statement has its own LIMIT → `offset` and `offset + min(rowCount,total) - 1`; if showing all rows or `posNext > total` → `pos` and `pos + numRows - 1`; otherwise `pos` and `posNext - 1`.
     - If the result is a **view and total === -1** the second number is replaced by `...` plus a hint icon "This view has at least this number of rows. Please refer to documentation." (doc link `cfg_MaxExactCount`) and the total part is omitted.
     - Totals: `"%1$s total, %2$s in query"` when `unlimNumRows !== total` (numbers formatted with `Util::formatNumber(…,0)`), else `"%s total"`.
     - Query time `Query took %01.4f seconds.`
     - For each ORDER BY expression, a sorted-column message ` [col: <FIRST VALUE…> - <LAST VALUE…>]` is appended: first and last row of the **current page** are fetched (`seek`), value cut to `LimitChars` chars + `...` and **upper-cased**; BLOB/geometry/binary show `[BLOB - 1.2 KiB]`-style text instead. Only when the sorted column is found in the result fields (table+name match).
   - Without navigation bar (not print view, not limited display): `Message::success()` default text with `(Query took %01.4f seconds.)` if time > 0.
3. The SQL (`card-body sqlOuter`): `Generator::formatSql` (highlighted `<code class="sql">`), or when in PHP mode a `<pre><code class="php">$sql = "…";</code></pre>` with newlines turned into `\n" . "` concatenations. Rendering of the SQL requires `ShowSQL` and a non-empty query (not `;`).
4. Footer tools (`card-footer tools d-print-none`), left to right:
   - A `<form class="disableAjax" action=/sql>` with hidden `sql_query` and, when the Refresh link applies and profiling is supported, a **Profiling** switch (`name=profiling`, `autosubmit`, checked when `$_SESSION['profiling']` set) with hidden `profiling_form=1`. Checking it re-runs the query with profiling.
   - **Edit inline** (`a.inline_edit_sql`, requires `SQLQuery.Edit`, not too big, not PHP mode): replaces the SQL `<pre>` with a textarea (CodeMirror-bound), "Enable foreign key checks" checkbox loaded via `/sql/get-default-fk-check-value`, Go (`#sql_query_edit_save`) and Cancel (`#sql_query_edit_discard`). Go builds a fake form posting `show_query=1, is_js_confirmed=0, sql_query, fk_checks` to `/import` (`functions.ts::onloadSqlQueryEditEvents`).
   - **Edit** (requires `SQLQuery.Edit`): link to `/table/sql` (if table), `/database/sql` (if db) or `/server/sql` with `sql_query` and `show_query=1` → opens the query box prefilled.
   - **Explain SQL** (requires `SQLQuery.Explain`, query not too big): for a query starting with `SELECT` → `/import` with `EXPLAIN <query>`. If the query already starts with `EXPLAIN [ANALYZE] [FORMAT=JSON|TREE|TRADITIONAL] SELECT` the link is **Skip Explain SQL** (strips the prefix); `ANALYZE [FORMAT=…] SELECT` → **Skip Analyze SQL**.
   - **Create PHP code** (requires `SQLQuery.ShowAsPHP`, not too big): `/import` with `show_as_php=1`. In PHP mode the links become **Without PHP code** (back to normal) and **Submit query** (`/import` normal run).
   - **Refresh** (requires `SQLQuery.Refresh`, not in PHP mode, query starts with `ANALYZE|EXPLAIN|SELECT|SHOW`): GET link to `/sql` with the query (signed).
   - All links use `Generator::linkOrButton`, which turns a link exceeding `LinkLengthLimit` into a POST button (`data-post`).

**Config:** `ShowSQL`, `SQLQuery.*`, `MaxCharactersInDisplayedSQL`, `LinkLengthLimit`.

---

### Component: Table navigation bar (rendered twice: above and below the grid)

**Source:** `Results::getTableNavigation`, `Results::getHtmlPageSelector`, `Util::pageselector`, `Results::getSortByKeyDropDown`, template `table.twig` block `navigation_html` (printed before and after the table; `d-print-none`).

**Visibility:** only when `hasNavigationBar`, no parser errors, the statement exists and **has no LIMIT of its own**.

**Controls (left to right):**
- **Begin** (`<<`) and **Previous** (`<`) buttons: shown only when `pos > 0` and not showing all. Each is a tiny POST form to `/sql` with hidden `db, table, sql_query, pos (0 | pos_previous), is_browse_distinct, goto`; submit input `name=navig class="btn btn-secondary ajax"`. Labels depend on `TableNavigationLinksMode`: icons → `<<`/`<`; text → "Begin"/"Previous"; both → icon + text. `pos_previous = max(0, pos - max_rows)`.
- **Page selector** (`page_selector.twig`): shown when more than one page and not showing all. `<select class="pageselector ajax" name="pos">` with option values `(page-1)*max_rows`; the current page option is `selected` and bold. `Util::pageselector` lists all pages when `< 200` pages; otherwise first 5, last 5, pages near the current one (±10), pages every `floor(total/20)`, plus geometric distances ±2,4,8,… from the current page, unified and sorted. Changing it submits the form (`select.pageselector` change handler → form submit).
- **Next** (`>`) button: shown when `!is_last_page`. `pos_next = pos + max_rows`.
- **End** (`>>`) button: shown when `!is_last_page && is_last_page_known` (i.e. `unlimNumRows !== -1`). `pos_last = (ceil(unlim/max_rows) - 1) * max_rows`. Its form has `onsubmit="return true|false"` — false when `pos + max_rows >= unlim` or the current page isn't full, which blocks the submit.
  - `is_last_page` = `unlimNumRows !== -1 && (showingAll || (isExactCount && pos + max_rows >= unlim) || numRows < max_rows)`; `isExactCount` = `unlim < MaxExactCount || showingAll || numRows < max_rows` (`Results::isExactCount`). So on a huge InnoDB table with an estimated count, Next keeps appearing until a short page is returned.
- Separator `|` when more than one page.
- **Show all** checkbox (`.showAllRows`, `name=navig value=all`): shown when `ShowAll` or `unlimNumRows <= 500`. Its form carries `session_max_rows = 'all'` (or `MaxRows` when currently showing all, to go back) and `pos=0`. Clicking it when turning ON opens a confirm dialog "Do you really want to see all of the rows? For a big table this could crash the browser." and submits via AJAX (`sql.ts`); turning OFF submits immediately.
- **Save edited data** (`div.save_edited.hide`): hidden until `SaveCellsAtOnce` collects edits (makegrid shows it).
- **Restore column order** (`div.restore_column.hide`): shown by makegrid when column order differs from natural order and more than one column visible.
- **Number of rows:** `<form class="maxRowsForm">` with `<select class="autosubmit" name="session_max_rows">` options `25, 50, 100, 250, 500` (plus the current custom value inserted in sorted position if not in the list; when showing all, a disabled selected "All" option is added). Hidden `pos` (current) and `unlim_num_rows`. On submit, JS validates `session_max_rows >= 1` and `0 <= pos <= unlim-1` ("Not a valid row number" message) (`sql.ts .maxRowsForm submit`).
- **Filter rows:** `<input id="filterRows" class="filter_rows" placeholder="Search this table" data-for="<uniqueId>">` (`largescreenonly`). `keyup` runs `$.uiTableFilter` over the table with that `data-uniqueId`, matching against all `th[data-column]` columns (client-side, current page only). The value is mirrored into the other Filter rows box (top/bottom). To cope with a `colspan=4` action header, three dummy hidden `<th>` are prepended during filtering and removed afterwards.
- **Sort by key:** `<select name="sql_query" class="autosubmit">` (only when the result is a plain single-table SELECT with at least one index; `getSortByKeyDropDown`). For every index: `<index name> (ASC)` and `(DESC)` options whose value is the full query with `ORDER BY col1 ASC, col2 ASC…` injected before any `LIMIT/PROCEDURE/FOR UPDATE/LOCK IN SHARE MODE` tail; plus a "None" option (unsorted query), selected when no index matches the current ORDER BY. Hidden fields `db, table, server, sort_by_key=1, session_max_rows`. When RememberSorting UI is checked, the chosen value is auto-saved to localStorage `autoSavedSqlSort` and re-applied on load (`sql.ts`).

**Hidden inputs shared by the forms:** `db, table, server, sql_query, is_browse_distinct, goto` (`hidden_fields`).

---

### Component: Display options ("Extra options") panel

**Source:** `Results::getOptionsBlock`, `getTableHeaders`; `table.twig` form `displayOptionsForm` (`class="ajax d-print-none"`, POST `/sql`, hidden `db, table, sql_query, goto, display_options_form=1`). Not rendered in print view or limited display.

**Layout:** If `InitialSlidersState !== 'disabled'`, a button "Extra options" (`#extraOptionsButton`, Bootstrap collapse; expanded when state is `open`) wraps a card; with `disabled` the card is always visible. Fieldsets:
- Radio `pftext`: **Partial texts** (`P`) / **Full texts** (`F`).
- Radio `relational_display`: **Relational key** (`K`) / **Display column for relationships** (`D`) — only when both the relation feature (`pma__relation`) and display feature (`pma__table_info`) are configured (`relwork and displaywork`).
- Checkbox `display_binary` **Show binary contents**; checkbox `display_blob` **Show BLOB contents**.
- Checkbox `hide_transformation` **Hide browser transformation**.
- Radio `geoOption`: **Geometry** (`GEOM`, only if `possible_as_geometry` i.e. the result is editable), **Well Known Text** (`WKT`), **Well Known Binary** (`WKB`). If the result is not editable and the stored option is GEOM it is coerced to WKT (`getOptionsBlock`).
- Footer: **Go** submit.

**Interactions:** submitting via AJAX replaces the entire `.sqlqueryresults` HTML with the response and re-triggers `makeGrid`, SQL and JSON highlighting (`sql.ts displayOptionsForm submit`). Because the form includes `display_options_form=1`, unchecked checkboxes are explicitly unset in the session.

**Also:** the "Full texts"/"Partial texts" **toggle button** in the top-left action header (`Results::getFullOrPartialTextButtonOrLink`): an image link (`s_fulltext.png` / `s_partialtext.png`, title "Full texts"/"Partial texts") to `/sql` with `pftext` flipped and `full_text_button=1`. Rendered in the first `<th class="column_action">` when there are row action links and `hasTextButton`; placement rules in `getFieldVisibilityParams`/`getColumnAtRightSide`.

---

### Component: Column headers

**Source:** `Results::getTableHeaders`, `getTableHeadersForColumns`, `getOrderLinkAndSortedHeaderHtml`, `getSingleAndMultiSortUrls`, `getSortOrderLink`, `getSortOrderHiddenInputs`, `getSortingUrlParams`, `getCommentForRow`, `setHighlightedColumnGlobalField`; templates `table_headers_for_columns.twig`, `comment_for_row.twig`; JS `multi_column_sort.ts`, `functions.ts::onloadSortLinkMouseEvent`, `sql.ts` (hover/mark), `makegrid.ts` (hints, reorder, visibility).

**Layout of `<thead><tr>`:**
1. Leading action header (`headers.button`): rules in `getFieldVisibilityParams`:
   - No edit/delete links and `hasTextButton` → nothing (0 empty columns).
   - `RowActionLinks` left/both and `hasTextButton` → `<th class="column_action position-sticky bg-body d-print-none" colspan=4?>` containing the full/partial text toggle; `numEmptyColumnsBefore = 4` when both edit and delete links exist.
   - left/both with edit or delete links but no text button → `<td colspan=4?></td>` placeholder.
   - `RowActionLinks = none` → `<th class="column_action position-sticky bg-body"></th>` placeholder (so the checkbox column aligns).
   - `colspan="4"` is used whenever both edit link and delete link are present (checkbox + Edit + Copy + Delete).
2. One `<th class="draggable position-sticky bg-body [text-end] [hide] [column_heading] [marker] [pointer] [condition]" data-column="<name>">` per column, in the **persisted column order** (`col_order` UI pref, `getColumnParams`). `text-end` when the column is numeric (REAL, INT or BIT mapped type — `isColumnNumeric`), `hide` when hidden by the `col_visib` pref, `column_heading` when sortable, `marker` when `BrowseMarkerEnable`, `pointer` when `BrowsePointerEnable`, `condition` when the column appears in the WHERE clause (parser identifiers; `highlightColumns`).
   - Sortable (`hasSortLink && !isLimitedDisplay`): content is the sort link (see below) + comment.
   - Not sortable: the escaped column name + comment.
3. Trailing column (`headers.column_at_right_side`, `getColumnAtRightSide`): for `RowActionLinks` right (or both with links and text button) → `<th class="column_action …" colspan=4?>` with the text toggle; for left/both without links → an empty sticky `<td>`. `numEmptyColumnsAfter` = 4 or 1 accordingly.

**Sort link (`getSortOrderLink`):** `<a class="sortlink" href="/sql?...single-sort...">name <img s_asc|s_desc class="soimg"> <img the-other class="soimg hide"> <small>N</small><input type=hidden value="/sql?...multi-sort..."></a>` followed by hidden inputs `url-remove-order` and `url-add-order`.
- **Single sort URL** (plain click): the query with ORDER BY replaced by `ORDER BY [\`table\`.]\`col\` <dir>`. If the column is currently sorted → direction flipped (ASC↔DESC). If not sorted → direction is `Order` config (`SMART`: DESC for date/time types, ASC otherwise). The table prefix is used only when the field has a table and is not aliased (`orgname === name`). URL params: `db, table, sql_query, sql_signature, session_max_rows, is_browse_distinct`. `session_max_rows` is the remembered `max_rows` for this query so a "Show all" state survives sorting (0 in limited display).
- **Multi sort URL** (`url-add-order`, Shift+click): all existing ORDER BY expressions kept in order; the clicked column is appended if absent, or its direction flipped if present. Numeric ORDER BY indexes (`ORDER BY 2`) are resolved to column names (`extractSortingExpressions`).
- **Remove URL** (`url-remove-order`, Ctrl+click or Alt+click): the query re-built with this column removed from ORDER BY (via parser `build()`); when no ORDER BY remains, `&discard_remembered_sort=1` is appended so the remembered sort is not re-applied.
- `multi_column_sort.ts`: on click of `th.draggable.column_heading.pointer.marker a`, Ctrl/Alt → POST the remove URL to `/sql` via AJAX; Shift → POST the add URL. Plain click follows the href (AJAX page load).
- **Sort indicator:** for a sorted column the icon for the current direction is shown and the opposite is `hide`; `<small>N</small>` shows the 1-based position in a multi-column ORDER BY. Hovering a `.sortlink` toggles both `.soimg` so the user sees the direction the click will produce (`functions.ts::onloadSortLinkMouseEvent`).
- Sort links also carry `data-column` on the `<th>`; double-clicking a header copies the column name to clipboard ("Column name successfully copied to clipboard!" / failure message) (`makegrid.ts::initColReorder`).

**Comments under header (`comment_for_row.twig`):** when `ShowBrowseComments` and the statement is SELECT/DELETE with FROM: `Relation::getComments(db, table)` (native column comments from `getColumns`) per table in FROM; rendered as `<br><small class="text-body-secondary" title="<full comment>">` with text cut to `LimitChars` chars + `…`.

**Header tooltips (Bootstrap, `makegrid.ts::updateHint`):** built from: "Click to sort results by this column." and "Shift+Click to add this column to ORDER BY clause or to toggle ASC/DESC.<br>- Ctrl+Click or Alt+Click (Mac: Shift+Option+Click) to remove column from ORDER BY clause" (while hovering the link), otherwise "Drag to reorder.", "Click to mark/unmark.", "Double-click to copy column name." (shown only when >1 visible column and marker headers exist). The non-draggable first header gets "Click the drop-down arrow to toggle column's visibility."

**Column hover / mark (`sql.ts`):** `mouseenter`/`mouseleave` on `th.column_heading.pointer` adds/removes class `hover` on every `td.data` at that index (column highlight) — requires `BrowsePointerEnable`. Click on `th.column_heading.marker` toggles class `marked` on the column's cells — requires `BrowseMarkerEnable`. Index math skips the leading `column_action` header.

**Repeating header rows:** `Results::getRepeatingHeaders` emits `<tr class="repeating_header_row">` with placeholder `<th colspan=numEmptyColumnsBefore>` (or an empty `<th>` when `RowActionLinks=none`), the stored header `<th class="draggable [condition]" data-column>` descriptions (sort link + comments), and trailing `<th colspan=numEmptyColumnsAfter>`; inserted before row `k*repeat_cells` for `k>=1`. Filter rows skips them when copying; `Copy to clipboard` skips them.

---

### Component: Column resize, reorder and visibility (client, `makegrid.ts`)

**Init (`makeGrid(t)`):** called on every `.table_results` after each load via the `makeGrid` event. Wraps every `td.data.truncated` inner content in `<span title="Original length N">` (using `data-originallength`), wraps all other `th`/`td` content in `<span>`, moves the table into a `div.data` wrapper (`gDiv`, relative), reads `.col_order`, `.col_visib`, `.table_create_time` hidden inputs and the `common_hidden_inputs` (`server, db, table`). `actionSpan` = colspan of the first non-draggable header (0 if none).

**Resize (`initColResize`, `dragStartRsz`, `dragMove`, `dragEnd`, `resize`, `reposRsz`):** a `div.cRsz` holds one `div.colborder` per draggable header positioned at the column's right edge (Safari uses `outerWidth()` without margins). Mousedown + drag changes the `span` width of the header and of every cell in that column (`th.draggable:visible` index n / `td:visible` index `actionSpan+n`), min width 15px. Body cursor `col-resize`, text selection disabled while dragging. Resize handles of `condition` columns get class `condition` (and the one to the left); first header gets `before-condition`. Widths are **not persisted**.

**Reorder (`initColReorder`, `dragStartReorder`, `shiftCol`, `restoreColOrder`, `sendColPrefs`):** enabled only when a `table.navigation` exists in the results (so disabled for EXPLAIN/SHOW etc.). Mousedown on a `th.draggable` (when >1 visible column) starts a drag: a floating copy of the header (`div.cCpy`) follows the mouse and a `div.cPointer` marks the drop position. On release, `shiftCol(old,new)` moves `th` and `td` in every row, the column-visibility list entry, and the `colOrder`/`colVisib` arrays; then `sendColPrefs()` if `tableCreateTime` is known, and the "Restore column order" button is shown/hidden (`refreshRestoreButton`: hidden when order is natural or only one column visible). Header cursor is `move` when >1 visible column. Dragging links is prevented (`dragstart` returns false).

**Visibility (`initColVisib`, `toggleCol`, `afterToggleCol`, `showAllColumns`, `showColList`, `hideColList`):** only when >1 draggable column. A `div.coldrop` arrow is appended to the first non-draggable header (the action header); clicking toggles a `div.cList` dropdown listing every column with a checkbox (checked = visible). Clicking an entry toggles that column (hide all `th`/`td` at that index); the last visible column cannot be hidden (its checkbox is forced checked/disabled). A "Show all" button is at the bottom (and also prepended at the top when >10 columns). The list hides when the mouse enters any `td`/`th.draggable`. After each toggle: resize handles repositioned, prefs sent, restore button refreshed.

**Persistence (`sendColPrefs` → POST `/sql/set-column-preferences` with `db, table, table_create_time, col_order (csv), col_visib (csv)`):** only when the table is `.ajax` and `db`/`table` are strings. Server `ColumnPreferencesController`: `Table::setUiProp(ColumnOrder, …, tableCreateTime)` then `setUiProp(ColumnVisibility, …)` only if the first succeeded. `setUiProp` refuses (error "Cannot save UI property "%s". The changes made will not be persistent after you refresh this page. Please check if the table structure has been changed.") when the table is not a view and the posted create time differs from the current `CREATE_TIME` of the table; stores `CREATE_TIME` next to the prefs. Prefs live in `$_SESSION['tmpval']['table_uiprefs'][server][db][table]` and, when pmadb `table_uiprefs` is configured, are `REPLACE`d into `pma__table_uiprefs (username, db_name, table_name, prefs JSON)`; rows beyond `Servers[i].MaxTableUiprefs` are purged by `last_update ASC`. On read (`Results::getColumnParams`), `col_order` is dropped if any index `>= fieldsCount` or its length differs from the field count; `col_visib` dropped if length differs; `Table::getUiProp` also drops them when the table `Create_time` changed, and never returns them for views. Errors are shown by JS via `ajaxShowMessage(data.error)`.

**Hidden inputs emitted by `table.twig`:** `.col_order`, `.col_visib` (comma-joined) when prefs exist, `.table_create_time` when not a view (`getDataForResettingColumnOrder`, only for single-table `SELECT … FROM`).

---

### Component: Row action cells (checkbox, Edit, Copy, Delete / Kill)

**Source:** `Results::getTableBody`, `getLinksHtml`, `getUrlParams`, `getDeleteAndKillLinks`, `getActionLinkContent`, `getUniqueCondition`; `UniqueCondition`; template `checkbox_and_links.twig`; JS `sql.ts a.delete_row.ajax`, `functions.ts getCheckAllCheckboxEventHandler`.

**Placement:** per `RowActionLinks`: `left` → cells before data; `right` → after data in reversed order (Delete, Copy, Edit, checkbox); `both` → both sides; `none` → only the checkbox cell (left). Only rendered when `hasEditLink` or `deleteLink !== NO_DELETE`.

**Cells (left order):**
1. Checkbox `<input type=checkbox class="multi_checkbox checkall" id="id_rows_to_delete<N>_left|right" name="rows_to_delete[<N>]" value="<where clause>">` + `<input type=hidden class="condition_array" value='<JSON {"`t`.`col`":"= 'v'", …}>'>`. Only when `deleteLink === DELETE_ROW`. The `checkall` class ties it to the global check-all handler: clicking toggles the row's `marked table-active` classes; **Shift+click selects/deselects the range** since the last clicked row (`functions.ts`). 
2. Edit: `<td class="text-center d-print-none edit_row_anchor [nonunique]" data-grid-edit-config="click|double-click|disabled">` with `link_or_button('/table/change', params + default_action=update, <icon/text>)` and a Bootstrap tooltip "You can also edit most values by clicking directly on them." / "…by double-clicking directly on them." (placement right for left-side links, left for right-side), plus hidden `<input class="where_clause" value="…">`. `nonunique` when the WHERE clause is not based on a PK/unique key.
3. Copy: same URL with `default_action=insert`, icon `b_insrow`, label "Copy", hidden `where_clause`.
4. Delete: `<td class="text-center d-print-none [ajax]">` link to `/sql` with class `delete_row requireConfirm ajax`, params `db, table, sql_query = DELETE FROM \`table\` WHERE <clause>[ LIMIT 1], message_to_show="The row has been deleted.", goto=<link back to the current browse query>` and a hidden `<div class="hide">DELETE FROM table WHERE …</div>` used as the confirmation text. For `KILL_PROCESS` the link is `db=mysql, sql_query=KILL <id>` with icon `b_drop` and label "Kill".

**Edit/Copy URL params (`getUrlParams`):** `db, table, where_clause, where_clause_signature, clause_is_unique (bool), sql_query (shortened), sql_signature, goto=/sql`. The "shortened" query (`getUrlSqlQuery`): if the SELECT is ≥ 200 chars, only `SELECT <list> FROM <from>` is passed to keep URLs short.

**Link content (`getActionLinkContent`):** `RowActionType` `icons` → image only; `text` → text only; `both` → `Generator::getIcon` (icon + text).

**Delete click behaviour (`sql.ts`):** `e.preventDefault()`; confirm dialog `Do you really want to execute "<DELETE statement>"?` (skipped when `Confirm` is false — `confirmDialog` checks `CommonParams confirm`); on OK, POST to the link URL with `ajax_request=1&is_js_confirmed=1` + the link's post data; success → `ajaxShowMessage(data.message)` and **the `<tr>` is removed client-side** (no reload, counts in the header are not refreshed); failure → error message.

**Unique WHERE clause (`UniqueCondition`):** For each field (optionally restricted to one table): alias handling (if `orgname` is empty, map alias → real column via the SELECT expressions; table alias replaced by the real table unless it is a view); key = `` `table`.`orgname` `` or `CONCAT(\`table\`.\`col\`)` for REAL types (float precision workaround); value: `IS NULL` for null; `= <raw>` for numeric; for BLOB with binary charset (63) or non-empty BINARY strings: `= CAST(0x<hex> AS BINARY)` when length < 1000, `CHAR_LENGTH(col) = n` when it is the only field, else the column is skipped; geometry: `= CAST(0x<hex> AS BINARY)` when < 5000 chars else skipped; BIT: `= b'0101'`; else `= '<quoted string>'`. Preference order: all PRIMARY KEY columns → all UNIQUE KEY columns → (unless `forceUnique`) **all columns conjunction**, in which case `clauseIsUnique = false`. The `conditionArray` (key → value) is what the checkbox `condition_array` holds and what grid-edit JS mutates when an edited column participates in the WHERE clause. Delete/Update statements built from a non-unique clause get ` LIMIT 1` appended (`getDeleteAndKillLinks`, `ReplaceController`), so only the first matching row is affected.

**Bulk-form uniqueness flag:** `Results::isClauseUnique` computes `clause_is_unique` from the **last row** of the page (`seek(numRows-1)`) and emits it as hidden input in the bulk form.

**Row classes:** `<tr class="nopointer nomarker">` when the respective config is disabled; otherwise bare `<tr>` (Bootstrap `table-hover`/`table-striped` give hover and zebra).

---

### Component: Data cells

**Source:** `Results::getRowValues`, `getDataCellForNumericColumns`, `getDataCellForGeometryColumns`, `getDataCellForNonNumericColumns`, `getRowData`, `handleNonPrintableContents`, `getFromForeign`, `buildNullDisplay`, `buildEmptyDisplay`, `buildValueDisplay`, `addClass`, `getClassForDateTimeRelatedFields`, `getPartialText`, `setMimeMap`, `setDefaultTransformations`, `getSpecialLinkUrl`; templates `row_data.twig`, `null_display.twig`, `empty_display.twig`, `value_display.twig`.

**Per-cell class composition (`getRowValues` + `addClass`):** `data` + `grid_edit click1|click2` (only when `meta->orgtable !== ''` and grid editing enabled) + `not_null` + `relation` (column is a FK/relation source) + `hide` (hidden by col_visib) + date class (`datetimefield` for DATETIME/TIMESTAMP, `datefield`, `timefield`, `text` for STRING) + `text-end` for numeric + `text-nowrap`/`pre_wrap` + mime class (`Text_Plain` etc. with `/`→`_`) + `condition` (in WHERE) + `truncated` + `transformed` (output or input transformation configured) + `enum` / `set` / `bit` / `hex` (binary). Attributes: `data-decimals`, `data-type` (mapped type: `string`, `blob`, `json`, `int`, `real`, `date`, `time`, `datetime`, `timestamp`, `bit`, `geometry`, …), `data-originallength` (truncated non-numeric cells).

**Rendering rules:**
- `NULL` → `<td … class="… null"><em>NULL</em></td>` (`null_display.twig`; class `null` is required by grid editing).
- Empty string → `<td class="… text-nowrap"></td>`.
- **Numeric** (`meta->isNumeric`): `text-end text-nowrap`, raw value, where-comparison `= <value>`.
- **Geometry** (`isMappedTypeGeometry`): grid editing is removed. `geoOption`: `GEOM` → `[GEOMETRY - <size>]` text (with download link when possible); `WKT` → `Gis::convertToWellKnownText` (runs `SELECT ST_ASTEXT(0x…)`-style conversion on the server) truncated per `getPartialText`; `WKB` → if `display_binary` is on, hex of the WKB **without the 4-byte SRID prefix** (`substr(bin2hex, 8)`) truncated; else `[BINARY - size]` with download link.
- **Non-numeric** (`getDataCellForNonNumericColumns`):
  - Grid edit disabled when the column is binary and `ProtectBinary` is `all`, or `noblob` and not a BLOB, or `blob` and a BLOB; or when the transformation plugin is a non-Text type (e.g. image).
  - **Truncation**: unless the transformation is a `Link` plugin or the column is binary, the text is cut to `LimitChars` + `...` when `pftext === 'P'` (`getPartialText`); `data-originallength` carries the full length and class `truncated` is set.
  - **BIT**: `Util::printableBitValue(value, length)` → binary digits string.
  - **BINARY/BLOB** (and not PROCEDURE ANALYSE): `handleNonPrintableContents('BINARY'|'BLOB', …)`: default text `[BLOB - 12 B]` / `[BINARY - 1.2 KiB]` (`Util::formatByteDown(size,3,1)`), `[BLOB - NULL]` for null. If a transformation applies with Octetstream subtype or Text type, the raw content is passed through the plugin. If `display_binary` (for `TYPE_STRING` binaries) or `display_blob` (for BLOBs) is on: show the content as text when it is valid UTF-8 without control chars (`htmlspecialchars`), otherwise as `0x<hex>`; then truncated per `getPartialText`. Whatever is shown is wrapped in a **download link** `<a class="disableAjax" href="/table/get-field?db&table&where_clause&where_clause_sign&transform_key=<orgname>[&sql_query]">` when db and `orgtable` are known. Grid editing is disabled when the displayed text still contains the `BLOB`/`BINARY` placeholder (i.e. content not shown). `GetFieldController` validates the `where_clause_sign`, runs `SELECT \`col\` FROM \`table\` WHERE <clause> LIMIT 1` and streams the bytes as `<table>-<col>.bin` with `Mime::detect` content type.
  - Otherwise: `text-nowrap` for date/time types or when the transformation plugin requests no-wrap, else `pre_wrap`; where-comparison `= '<quoted original value>'`.
- **Default output function** `Core::mimeDefaultFunction`: `htmlspecialchars`, double spaces → ` &nbsp;`, newlines → `<br>\n`.
- **Relations / foreign keys (`getRowData`):** `$map` (built by `getForeignKeyRelatedTables`) merges internal relations from pmadb `pma__relation` (`Relation::getForeignersInternal`, plus emulated relations for `information_schema`/`mysql` tables from `InternalRelations`) and native FOREIGN KEYs parsed out of `SHOW CREATE TABLE` (`getForeignKeysData`); each entry holds foreign db/table/field and the **display field** (`Relation::getDisplayField`: pmadb `pma__table_info.display_field`, else emulated for `information_schema.CHARACTER_SETS`→`DESCRIPTION` / `TABLES`→`TABLE_COMMENT`, else the **first CHAR-class column** of the foreign table, else none). Column aliases are resolved back to the real column name before the lookup. For a FK cell:
  - Display value: `SELECT \`display_field\` FROM \`fdb\`.\`ftable\` WHERE \`ffield\` = <value> LIMIT 1` (`getFromForeign`), cached per query string for the page; "Link not found!" when no row; truncated to `LimitChars`.
  - The cell content is a **link** to `/sql?db=<fdb>&table=<ftable>&pos=0&sql_query=SELECT * FROM \`fdb\`.\`ftable\` WHERE \`ffield\` = <value>&sql_signature=…`.
  - `relational_display = 'K'` (default): the cell shows the key value; the link `title` is the display value. `'D'`: the cell shows the display value (or `<em>NULL</em>` when the display value is NULL) and the `title` is the key. A transformation, if any, is always applied to the real key value and shown instead.
  - When grid editing is possible the link gets class `ajax`; makegrid intercepts: in `click` mode a click starts editing; in `double-click` mode a **single click (after 700 ms without a second click) follows the link** via the AJAX page loader, a double click starts editing (`initGridEdit`).
  - Print view: `value <code>[-&gt;display]</code>`.
  - **Browse distinct values** (`is_browse_distinct=1`, coming from Structure → "Browse distinct values"): the second column is treated as a FK to the same table so each distinct value links to `SELECT * FROM table WHERE col = value`.
- **Transformations:** when pmadb `column_info` + browser transformation feature are configured and `BrowseMIME` is on and `hide_transformation` is off, `Transformations::getMime(db, orgtable)` is loaded once per table (`setMimeMap`) and the plugin named in `transformation` is instantiated with `transformation_options`; `meta->internalMediaType` is set; the plugin's `applyTransformation(data, options, meta)` replaces the default output. Options also receive `wrapper_link`/`wrapper_params` (`db, table, where_clause, where_clause_sign, transform_key, sql_query`) so plugins like image/download can link to `/table/get-field`. **Built-in default transformations** (`setDefaultTransformations`, applied without pmadb): SQL highlighting (`Text_Plain_Sql`) for `information_schema.events.event_definition`, `processlist.info`, `routines.routine_definition`, `triggers.action_statement`, `views.view_definition`, `mysql.general_log.argument`, `help_topic.example`, `slow_log.sql_text`; octet-stream SQL for `mysql.event.body(_utf8)`, `mysql.proc.{param_list,returns,body,body_utf8}`; link for `mysql.help_category.url`, `help_topic.url`; and for the pmadb itself: `history.sqlquery`/`bookmark.query`/`tracking.{schema_sql,data_sql}` as SQL, `favorite.tables`/`recent.tables`/`savedsearches.search_data`/`designer_settings.settings_data`/`table_uiprefs.prefs`/`userconfig.config_data`/`export_templates.template_data` as JSON (`Text_Plain_Json` → `<pre><code class="json">`, highlighted client-side by CodeMirror `highlightJson`). For `SHOW [FULL] PROCESSLIST` the `Info` column and for `SHOW CREATE TABLE` the `Create Table` column are SQL-highlighted. **Special schema links** (`SpecialSchemaLinks::get`) for `mysql`/`information_schema` tables (e.g. `mysql.db.user` → user privileges page, `tables_priv.table_name` → table page) wrap the value in a `Text_Plain_Link` to the relevant phpMyAdmin route, with extra params pulled from other columns of the same row (`getRowInfoForSpecialLinks`).
- JSON columns (`data-type="json"`) are stringified/pretty-printed in the grid editor (`stringifyJSON(value,null,4)`) and, when transformed, highlighted via `code.json`.

---

### Component: Grid editing (inline cell editing)

**Source:** `makegrid.ts` (`initGridEdit`, `showEditCell`, `showEditArea`, `saveEditedCell`, `saveOrPostEditedCell`, `postEditedCell`, `hideEditCell`, `moveUp/Down/Left/Right`), `sql.ts::getFieldName`, server endpoints listed in the source map, `ReplaceController`, `InsertEdit`.

**Enablement:** server side `gridEditConfig` = `disabled` when `isLimitedDisplay`, not editable, or `GridEditing='disabled'`; `click` or `double-click` otherwise (`Results::getTableBody`). Client side `initGridEdit` runs only when the table has class `ajax`. Cells carry `grid_edit click1` (click) or `grid_edit click2` (double-click). Geometry cells, protected binaries, non-text transformations and BLOB/BINARY placeholders never get `grid_edit`.

**Starting an edit:** `click` on `td.data.click1` or `dblclick` on `td.data.click2` (clicks on `.grid_edit a` have default prevented; relational link single-click vs double-click logic described above). If another cell is being edited, that edit is saved/posted first (`startGridEditing`). `showEditCell`: choose the editor: `<textarea class="edit_box">` for `data-type` `string`/`blob`/`json`, else `<input class="edit_box">`; the `div.cEdit` is positioned over the cell with the cell's outer width/height; the value is `getCellValue(td)` (`''` for NULL cells, `original_data` if previously fetched, else the cell text), JSON pretty-printed when not truncated; the cursor is moved to the end; focus triggers `showEditArea`.

**Edit area (`showEditArea`, dropdown under the input):**
- "Go to link: <a>" clone when the cell contains a link.
- **NULL checkbox** (unless the column is `not_null`), pre-checked for NULL cells. Typing/pasting un-checks it; emptying the box re-checks it; checking it clears the editor/select/textarea (for `datefield` it triggers the datepicker button).
- **Relation** cell: POST `/sql/get-relational-values` with `column, curr_value (cell text), relation_key_or_display_column (link title)`. Server (`RelationalValuesController` + `Sql::getHtmlForRelationalColumnDropdown`): when `relational_display === 'D'` the current value used for selection is the link title (the key), else `curr_value`. If the foreign table has fewer than `ForeignKeyMaxLimit` rows → `<select>` built by `Relation::foreignDropdown` (sections ordered per `ForeignKeyDropdownOrder`: e.g. `content-id` then `id-content`, separated by an empty option; `NaturalOrder` sorting; values with invalid UTF-8/control chars shown as hex); else the template `sql/relational_column_dropdown.twig`: `<span class="curr_value">` + "Browse foreign values" link (`a.browse_foreign`, POST `db, table, field` to `/browse-foreigners`). Selecting an option copies the value into the edit box; the `span.curr_value` is hidden and a change on it (set by the browse modal) copies into the edit box. The dropdown's initial value is stored as `original_data`.
- **ENUM** cell: POST `/sql/get-enum-values` (`column, curr_value`) → `<select>` with all enum members (`Util::parseEnumSetValues` on `SHOW COLUMNS` type), current one selected; selection copies into the edit box.
- **SET** cell: POST `/sql/get-set-values` (`column, curr_value`, and when the cell is `truncated` also `get_full_values=true, where_clause` so the server fetches the full value via `SELECT col FROM db.table WHERE … LIMIT 1`) → `<select multiple size=min(n,10) class="resize-vertical">` with current members selected; `original_data` = joined selected values.
- **Truncated or transformed** cell: if already edited (`to_be_saved`) a textarea mirrored with the edit box; otherwise POST `/sql` with `sql_query = SELECT \`col\` FROM \`table\` WHERE <where_clause>` and `grid_edit=true` → server `Sql::getResponseForGridEdit` returns JSON `value` (hex-encoded when the field is binary); stored as `original_data` and placed in the edit box (JSON pretty-printed).
- **Date/time** cells (`timefield|datefield|datetimefield|timestampfield`): jQuery UI datetimepicker attached (`addDatepicker`, `yy-mm-dd`, `HH:mm:ss`, `showOn: button`, button image `b_calendar.png`, `changeYear`), with milliseconds/microseconds enabled according to `data-decimals` (`>3` → `HH:mm:ss.lc`, else `HH:mm:ss.l`; value padded with zeros to match). The picker is shown immediately and moved inside `div.cEdit`; typing a value that does not match the date/time regexes hides the picker (`toggleDatepickerIfInvalid`). Enter posts; other keys re-validate.
- Otherwise plain text editing. A hint "Press escape to cancel editing.<br>- Shift+Enter for a newline." is appended when the area has children.
- While the area is loading (`edit_area_loading`), saving is a no-op.

**Keys:** Enter saves (`keydown` 13; for textarea only without Shift — Shift+Enter inserts a newline); Esc cancels (`hideEditCell(true)`), clicking anywhere outside `cEdit`/datepicker/browse-foreign modal/`.dismissable` saves (`hideEditCell()`); Ctrl/Alt + Arrow Up/Down/Left/Right saves the current cell and moves editing to the same column in the previous/next row or the previous/next `grid_edit` cell in the row (`moveUp/Down/Left/Right`, matched by `where_clause` and field name).

**Determining the new value (`saveEditedCell`):** NULL checkbox checked → `null` (post only if it was not already NULL). BIT → edit box; SET → joined selected options; relation/enum → edit box value; `hex` (binary) → edit box must match `/^(0x)?[a-f0-9]*$/i` else error "Please enter a valid hexadecimal string. Valid characters are 0-9, A-F." and the old value is kept; JSON compared after `stringifyJSON`. Only changed values (or a change from NULL) mark the cell `to_be_saved` with `data('value')`; with `SaveCellsAtOnce` the "Save edited data" button appears and `isCellEdited=true` (a `beforeunload` warning "You have edited some data and they have not been saved…" is armed).

**Posting (`postEditedCell` → POST `/table/replace`):** for every row with `to_be_saved` cells: `where_clause[]`, `fields[multi_edit][row][]`, `fields_name[multi_edit][row][]`, `fields_type[multi_edit][row][]` (`bit`/`hex` where applicable), `fields_null[multi_edit][row][]` (`'on'` for NULL), `rel_fields_list` (url-encoded relation cells by index), `transform_fields_list` + `do_transformations`, `relational_display` (current radio), `clause_is_unique` (0 when the row anchor has `nonunique`), `goto=/sql`, `submit_type=save`, `ajax_request`. If the table is non-unique an `alert()` "This table does not contain a unique column. Features related to the grid edit, checkbox, Edit, Copy and Delete links may not work after saving." is shown before posting. For each edited column that appears in the WHERE clause, the JS rewrites the `condition_array` entry (`IS NULL` or `= 'escaped'`) and stores `new_clause` on the row. Field name is derived from the header text at the same index minus the action colspan (`Sql.getFieldName`, stripping the `<small>` sort index and comment span).
- Server (`ReplaceController`): builds `UPDATE \`table\` SET … WHERE <where_clause>[ LIMIT 1 when clause_is_unique is falsy]`, runs it, and returns JSON `message` (affected rows + SQL), `sql_query` (HTML of the message card), and extras: `isNeedToRecheck`/`truncatableFieldValue` — the server re-reads the saved cell (`SELECT \`t\`.\`col\` … WHERE <where_clause[0]> LIMIT 1`, adding microseconds for time types and `0x` hex for binary) so the client can re-truncate the displayed value (`InsertEdit::verifyWhetherValueCanBeTruncatedAndAppendExtraData`); `relations[cellIndex]` — new `<a>` for relational cells honoring `relational_display` (`getLinkForRelationalDisplayField`); `transformations[cellIndex]` — re-transformed display HTML.
- Client on success (`hideEditCell(true, data)`): shows the message, updates `where_clause` hidden inputs, rewrites Edit/Copy/Delete hrefs and the delete confirmation text with the new clause, renames checkbox `name`/`value`, appends the new query card (`sqlOuter` + `tools`) to the existing `.result_query` (keeping at most two query boxes) and re-highlights; updates the cell display: `NULL` → `<em>NULL</em>`-like text and class `null`; otherwise re-truncates to `LimitChars` when `pftext==='P'` (class `truncated`), escapes HTML, turns `\n` into `<br>`, trims time decimals according to `data-decimals`, updates `code` blocks via `updateCode` (CodeMirror run-mode for json/sql/xml), BIT cells show the raw value, `hex` cells update the `<a>` instead of the span. Then hides the editor, removes `to_be_saved`, hides "Save edited data". On failure: `ajaxShowMessage(error)` and (immediate mode) `to_be_saved` removed. During the post, the editor is disabled (`edit_box_posting`) or, in save-at-once mode, the Save button is disabled (`saving_edited_data`).

**Browse foreign values modal (`sql.ts::browseForeignDialog`, `BrowseForeigners`):** POST `/browse-foreigners` (`db, table, field, fieldkey, data, pos, foreign_filter, foreign_showAll, rownumber`) into a Bootstrap `modal-lg` "Browse foreign values". Content: a filter form (`Search:` text `foreign_filter`, Go, page selector built with `Util::pageselector` over `MaxRows`-sized pages, "Show all" button when `ShowAll` and total > `MaxRows`) and a two-sided table (Keyname | Description | spacer | Description | Keyname) listing the foreign rows; the filter matches `ffield LIKE '%x%' OR display LIKE '%x%'` (`Relation::getForeignData`). Clicking a `a.foreign_value` puts its `data-key` into the grid edit box (or the preceding text input in the insert form) and triggers `change`, closing the modal. Changing the filter resets `pos` to 0.

---

### Component: Cell selection and copy (client only)

**Source:** `makegrid.ts::initCellSelection`.

- Mouse down (left button, not on a link/input/select/textarea/edit box) on `td.data` starts a rectangular selection; drag over `td.data`/header `th` extends it (rows × columns sets rendered with class `cell-selected`, `with-bg-color` when more than one cell); Ctrl/Cmd+mousedown adds to the selection (toggle); mouse up ends; mouse down outside the table or Escape clears. Text selection is cleared when leaving cells.
- Keyboard: when focus is not in an input, Shift+Arrow extends the selection from the last cell (into the header row with ArrowUp from row 0); Ctrl/Cmd+A selects all `td.data` and non-action headers. Events throttled to 100 ms. The viewport auto-scrolls to keep the end cell visible.
- `copy` event (no native text selection, not editing): clipboard gets selected header names joined by tabs on the first line, then each row's selected cell texts joined by tabs, rows by newlines.

---

### Component: Bulk actions bar ("Check all / With selected")

**Source:** `table.twig` (form `resultsForm` with `id="resultsForm_<uniqueId>" class="ajax"`), `sql.ts` (`submit_mult` click), controllers `ChangeRowsController`, `ExportRowsController`, `DeleteConfirmController`, `DeleteRowsController`.

**Visibility:** form rendered when `deleteLink` is `DELETE_ROW` or `KILL_PROCESS` (`has_bulk_actions_form`); the bar itself only for `DELETE_ROW` (`has_bulk_links`). Hidden inputs: `db, table, goto=/sql, clause_is_unique, sql_query`.

**Controls:** "With selected:" arrow image; `#resultsForm_<id>_checkall` checkbox labelled **Check all** (checks every `.checkall` box in the form); buttons `submit_mult` = **Edit** (`b_edit`), **Copy** (`b_insrow`), **Delete** (`b_drop`), and **Export** (`b_tblexport`) when the statement is a SELECT (`hasExportButton`).

**Behaviour (`sql.ts`):** click serializes the form + `ajax_request=true&ajax_page_request=true` and POSTs to: Edit → `/table/change/rows` + `default_action=update`; Copy → `/table/change/rows` + `default_action=insert`; Export → `/table/export/rows`; Delete → `/table/delete/confirm`. The response replaces the main content (`AJAX.responseHandler`).
- `ChangeRowsController`: if `rows_to_delete` missing/not array and `goto` present → error "No row selected."; else sets `Current::$whereClause = array_values(rows_to_delete)` and delegates to the Change (insert/edit) controller, which renders one edit form per selected row (Copy pre-fills an insert form).
- `ExportRowsController`: same "No row selected." check; sets `Export::$singleTable = true`, `whereClause` = selected clauses; delegates to table export (exports only those rows).
- `DeleteConfirmController`: requires `rows_to_delete` array else "No row selected."; checks db/table exist; renders `table/delete/confirm.twig`.

---

### Screen: Delete confirmation (`table/delete/confirm.twig`) and execution

**Layout:** card with header icon `s_really` + "Do you really want to execute the following query?"; body: a `<ul>` with one `<li><code>DELETE FROM \`table\` WHERE <clause>;</code></li>` per selected row; checkbox `fk_checks` "Enable foreign key checks" (pre-checked per `ForeignKey::isCheckEnabled`; hidden `fk_checks=0` ensures a value is always posted); footer: **Yes** (`btn-danger`, `name=mult_btn`) and **No** (`btn-secondary`, `name=mult_btn`). Hidden: `db, table, selected[]` (the clauses), `original_sql_query` (the browse query).

**`DeleteRowsController` (`/table/delete/rows`):** if `mult_btn === 'Yes'`: `handleDisableCheckInit`, `selectDb`, then for each clause `DELETE FROM \`table\` WHERE <clause> LIMIT 1;` is executed individually (always `LIMIT 1`, regardless of uniqueness), all statements concatenated with newlines as the display query; `handleDisableCheckCleanup`; `displayMessage = success`. Then (Yes or No) the `original_sql_query` is re-executed through `executeQueryAndSendQueryResponse` so the grid is re-rendered, with the executed DELETEs shown in the `previous_update_query` card above it.

---

### Component: Query results operations card

**Source:** `Results::getResultsOperations`, `table.twig` (bottom), `no_results_returned.twig`; JS `event-loader.ts` (print), `sql.ts` (`#copyToClipBoard`), `handleCreateViewModal`.

**Visibility:** not in print view / limited display. Card header "Query results operations". Contents:
- **Print** (`button.jsPrintButton`, when `hasPrintLink`): calls `window.print()`; all `d-print-none` elements (navigation, options, action cells, bulk bar, operations, tools) are hidden by print CSS.
- **Copy to clipboard** (`#copyToClipBoard`, with Print): builds a text blob: breadcrumb raw texts joined by `/`, two tabs, the page URL, newline, every `.alert-success` text, every `.sql pre` text, header names (without `<small>` sort numbers) tab-separated, then one line per non-repeating body row with each `.data span` text (NULL cells contribute `NULL` from `<em>`) tab-separated; copies via a hidden textarea + `execCommand('copy')`; `alert('Sorry! Unable to copy')` on failure.
- When the statement is not a PROCEDURE call (`has_procedure`): if SELECT (`has_export_link`): **Export** → `/table/export` with `db, table, printview=1, sql_query, single_table=true (one table), raw_query=true (no tables), unlim_num_rows`; when no table name is known (e.g. derived table) the first table of the db (`SHOW TABLES`) is substituted so the export script does not fail. **Display chart** → `/table/chart` with the same params. **Visualize GIS data** → `/table/gis-visualization` when any field is geometry. Always: **Create view** (`a.create_view.ajax`, `/view/create` with `db, table, sql_query, printview`) opening the create-view modal (`modals/create_view.twig` is included).
- The no-results page shows only the "Create view" operation (plus bookmark form).

---

### Component: Bookmark this SQL query (`sql/_bookmark.twig`)

Card "Bookmark this SQL query" (POST `/sql`, class `bookmarkQueryForm disableAjax`): hidden `db, goto (/sql?db&table&sql_query&id_bookmark=1), bkm_fields[bkm_database], bkm_fields[bkm_user], bkm_fields[bkm_sql_query] (= complete query, i.e. the whole text submitted, not just the executed statement), store_bkm=1`; text **Bookmark label**; switch **Let every user access this bookmark** (`bkm_all_users`, only when `AllowSharedBookmarks`); button **Create new bookmark**. `sql.ts` ajaxifies the submit: empty label → "The form is empty" style error (`strFormEmpty`); success → `Bookmark %s has been created.` toast. `BookmarkRepository::createBookmark` refuses empty query/label, forces non-shared when `AllowSharedBookmarks` is off, stores `user=''` for shared bookmarks. Bookmarks are stored in pmadb `pma__bookmark (id, dbase, user, query, label)`. Shown when the bookmark feature is enabled, `hasBookmarkForm`, and the request is not itself a bookmark run (`id_bookmark <= 0`).

---

### Screen: No results / affected-rows response (`sql/no_results_returned.twig`)

**Source:** `Sql::getQueryResponseForNoResultsReturned`, `getMessageForNoRowsReturned`.

- Message (in the same `result_query` card with SQL): DELETE → `%d row(s) deleted.`; INSERT (non-REPLACE) → `%d row(s) inserted.` + `Inserted row id: %d` (last insert id + numRows − 1) when `insertId !== 0`; REPLACE → `%d row(s) affected.`; other affected statements (UPDATE, ALTER…) → `%d row(s) affected.`; `message_to_show` for non-SELECT when provided (e.g. "Your SQL query has been executed successfully." from the query box, "The row has been deleted." from the Delete link); PHP mode → "Showing as PHP code" / "Showing SQL query"; otherwise "MySQL returned an empty result set (i.e. zero rows)." Always followed by `(Query took %01.4f seconds.)` when time > 0 and `[ROLLBACK occurred.]` when `rollback_query` was requested. With `IgnoreMultiSubmitErrors`, a raw error message replaces it.
- AJAX extras: `reload`/`db` when `ResponseRenderer::$reload`; `message` and `sql_query` (HTML, if `ShowSQL`) unless `ajax_page_request`; `indexes_list` HTML when a column was dropped (`dropped_column`) to refresh the Structure page's index list.
- If the result has columns but zero rows (empty table browse), an **empty grid** is still rendered with sort links but no navigation/edit (`DisplayParts hasSortLink=true, hasNavigationBar=false`, `isLimitedDisplay=true`) so headers remain visible. ALTER/DROP statements clear stored transformation info for dropped columns/tables (`deleteTransformationInfo`).
- Profiling card, "Query results operations" (Create view only, unless PROCEDURE), bookmark form and the create-view modal follow.

---

### Component: SQL error display

**Source:** `Generator::mysqlDie(serverMessage, sqlQuery, isModifyLink)`, `Sql::handleQueryExecuteError`.

`<div class="alert alert-danger"><h1>Error</h1>` then, unless the query contains `connect` (hidden for security): a **Static analysis** section when the sql-parser reports lexer/parser errors ("%d errors were found during analysis." + ordered list "<msg> (near "<token>" at position <n>)"); "SQL query:" + copy-to-clipboard icon + MySQL doc link for `SELECT` when the query contains it + optional Edit icon link to the query box (`/table/sql`, `/database/sql` or `/server/sql` with `sql_query&show_query=1`) when `isModifyLink`; the formatted query (`formatSql`, or plain escaped when it does not parse). Then "MySQL said: " + doc link `server-error-reference` + the server message (runs of 3+ newlines collapsed). In AJAX the HTML is returned as JSON `message` with `success=false`; `sql.ts` then renders it into `#sqlqueryresultsouter` and scrolls to the bottom. For `/sql` the `isModifyLink` flag is `false` (`Sql::handleQueryExecuteError`), while `GetFieldController` uses `true`.

---

### Screen: Query box (`sql/query.twig`, `SqlQueryForm`) — the controls that influence execution

Form `#sqlqueryform` (POST `/import`, `class="ajax lock-page"`, multipart when uploads enabled). Hidden: `db, table, is_js_confirmed=0, pos=0, goto, message_to_show="Your SQL query has been executed successfully.", prev_sql_query`.
- Card header legend "Run SQL query/queries on table db.table:" (or database/server variants) + SELECT doc link.
- `<textarea id="sqlquery" name="sql_query" cols=TextareaCols rows=TextareaRows data-textarea-auto-select>` prefilled with `sql_query` when `show_query` is set, else `DefaultQueryTable`/`DefaultQueryDatabase` expanded (`Util::expandUserString`). Auto-saved to localStorage key `autoSavedSql_<db>.<table>` on every change (`Sql.autoSave`); "Get auto-saved query" button (`#saved`) is disabled when nothing is saved.
- Buttons (when a table's column list is available): `SELECT *`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` (templates built from the column list, e.g. `SELECT * FROM \`t\` WHERE 1`, `DELETE FROM \`t\` WHERE 0`), always `Clear`, with CodeMirror `Format` and `Format as a single line` (`/database/sql/format`), `Get auto-saved query`. Column multi-select `#fieldsSelect` with `<<` **Insert** button (icon when `ActionLinksMode` shows icons) and double-click to insert column names at the cursor.
- **Bind parameters** checkbox (`parameterized`, FAQ 6.40): `:name` placeholders get inputs; `ImportController` substitutes values (quoted unless numeric) before running.
- Bookmark fields (when bookmark feature): **Bookmark this SQL query:** label `bkm_label`, **Let every user access this bookmark** (`bkm_all_users`, if allowed), **Replace existing bookmark of same name** (`bkm_replace`); the two checkboxes are hidden until the label is non-empty.
- Footer: **Delimiter** (`sql_delimiter`, default `;`), **Show this query here again** (`show_query`; state persisted in localStorage `showThisQuery` + `showThisQueryObject {db,table,query}` and re-applied on load when db/table match), **Retain query box** (`retain_query_box`, default `RetainQueryBox`; when unchecked the query box collapses after a successful AJAX run via the injected "Hide query box"/"Show query box" toggle `#togglequerybox`), **Rollback when finished** (`rollback_query`: `ImportController` → `Import::handleRollbackRequest`, allowed only for INSERT/UPDATE/DELETE/REPLACE (or `SET`) on transactional (InnoDB) tables — `checkIfRollbackPossible`; a `ROLLBACK` is issued after execution and `[ROLLBACK occurred.]` is appended to the message), **Enable foreign key checks** (`fk_checks`, default via `DefaultForeignKeyChecks`/server variable), **Go** (`#button_submit_query`). A **Simulate query** button (`#simulate_dml`) is injected live while the text matches `^UPDATE … SET` or `^DELETE … FROM` (`sql.ts::handleSimulateQueryButton`); it POSTs `/import/simulate-dml` (`db, sql_query, sql_delimiter`) and shows a modal "Simulate query" listing for each statement the formatted SQL, "Affected rows:" and a link with the matched-row count that opens `/sql` with an equivalent `SELECT` (`SimulateDml::getSimulatedDeleteQuery`/`getSimulatedUpdateQuery`: UPDATE is rewritten as `SELECT old cols, <expr> AS \`col *new*\`…`; joins are rejected).
- "Bookmarked SQL query" card (full tab only): bookmark `<select id="id_bookmark">` (shared ones labelled "(shared)"), radios **Submit** / **View only** / **Delete**, variable inputs `bookmark_variable[i]` shown according to the `[VARIABLE…]` placeholders count, **Go** (`#button_submit_bookmark`; Enter in a variable box triggers it).
- Results of the query box land in `#sqlqueryresultsouter` (AJAX, `ajax_page_request=true`), `makeGrid` is triggered, menu/params/navigation may be refreshed (`reload`, `ajax_reload.table_name` for RENAME), and `sql_from_query_box` suppresses remembered sorting for that run.
- "Delayed inserts" and "Ignore errors" are **not** options of the query box in current master; `IgnoreMultiSubmitErrors` is a config directive only, and "Ignore" checkboxes (`insert_ignore_N`) belong to the Insert/Edit form (`resources/js/table/change.ts`), not to the grid.

---

### Component: Profiling (`sql/profiling_chart.twig`, `Sql::getDetailedProfilingStats`, `sql.ts::initProfilingTables`, `buildProfilingChart`)

When `$_SESSION['profiling']` is on and `SHOW PROFILE` returns rows with non-zero total: card "Profiling" with **Detailed profile** table (`#profiletable`: Order, State, Time with hidden raw value) and **Summary by state** table (`#profilesummarytable`: State, Total Time, % Time, Calls, ø Time; doc link `general-thread-states`), both sortable via tablesorter (default sorts: order asc; total time desc), plus a chart (`#profilingChartCanvas`, Chart.js via `createProfilingChart`) of total time per state. States are `ucwords()`-capitalised and aggregated.

---

### Component: Print view

Requested with `printview=1` (POST) — used by "Export"/"Display chart"/"Create view" URLs for other pages and historically for a print page. In `Results`: all display parts off, no options block, no row action columns, no navigation; FK cells show `value [->display]` in `<code>`. The in-page **Print** button simply calls `window.print()` relying on `d-print-none`.

---

### pmadb storage touched by this area

| Table (pmadb) | Use |
|---|---|
| `pma__table_uiprefs` (`username, db_name, table_name, prefs JSON, last_update`) | `sorted_col` (remembered ORDER BY), `col_order`, `col_visib`, `CREATE_TIME` guard (`Table::*UiPref*`). Capped by `MaxTableUiprefs`. |
| `pma__relation` | Internal relations → FK links/display (`Relation::getForeignersInternal`). |
| `pma__table_info` (`display_field`) | Display column for FK cells and dropdowns (`Relation::getDisplayField`). |
| `pma__column_info` | Browser transformations (`mimetype, transformation, transformation_options, input_transformation…`) and column comments feature (`Transformations::getMime`). |
| `pma__bookmark` | Bookmarks (default browse query by label = table, bookmark form, bookmarked query runner). |
| `pma__history` | Not used by the grid itself; the SQL history is written by the query runner (out of scope here). |
| PHP session `$_SESSION['tmpval']` | Per-query view state (see Session state), `table_uiprefs` cache, `possible_as_geometry`, `profiling`, `sql_from_query_box`. |
| Browser localStorage | `autoSavedSql_<db>.<table>`, `autoSavedSqlSort`, `showThisQuery`, `showThisQueryObject`. |

---

### Component: Keyboard shortcuts relevant to the grid

**Grid-specific (`makegrid.ts`):** Enter = save cell (Shift+Enter newline in textarea editors); Esc = cancel edit, also clears cell selection; Ctrl/Alt+Arrow = save and move editing to adjacent cell; Shift+Arrow = extend cell selection; Ctrl/Cmd+A = select all cells; Ctrl/Cmd+C with a cell selection = copy TSV; Shift+click on a row checkbox = range select (`functions.ts`); Shift/Ctrl/Alt+click on a sort header = multi-sort add/remove (`multi_column_sort.ts`); double-click header = copy column name.

**Global (`shortcuts_handler.ts`, loaded unless `DisableShortcutKeys`), only when focus is not in an input/textarea/select/contenteditable and no session-expired overlay:** `Ctrl+K` or `K` toggle the SQL console (also `Ctrl+Alt+C`); `D` then `S` (within 2 s) → database Structure, `D` then `F` → database Search; `T` then `S` → table Structure, `T` then `F` → table Search; `S` alone → navigation settings; `E` → Export tab; `H` → Home; `Backspace` → `history.back()`.

---

## Micro-behaviours checklist

Parity acceptance list. Each item is something the clone must reproduce; the citation in parentheses is the source.

### Query handling, counting and header message
- [x] A GET `sql_query` is only accepted when accompanied by a valid `sql_signature`; all generated links (sort, FK, refresh, Browse-distinct, simulate "matched rows") carry one (`SqlController`, `Core::signSqlQuery`). <!-- parity:test --> `p02-fae7cc` [browse.test.ts:83](../../apps/server/test/int/browse.test.ts#L83) +1
- [x] Browsing a table with no query produces `SELECT * FROM \`t\``; with `TablePrimaryKeyOrder` ≠ NONE it appends `ORDER BY \`t\`.\`<first PK col>\` ASC|DESC` (`Sql::getDefaultSqlQueryForBrowse`). <!-- parity:test --> `p02-1f1189` [browse.test.ts:135](../../apps/server/test/int/browse.test.ts#L135)
- [ ] A bookmark whose label equals the table name (same db, same user) replaces the default browse query and shows the notice "Using bookmark "%s" as default browse query." with FAQ 6.22 link.
- [x] `RememberSorting`: the last ORDER BY of `SELECT *` single-table queries is stored per table (`sorted_col`) and re-applied to later unsorted `SELECT *` browses; not applied when the request originates from the query box (`sql_from_query_box`) or from "Sort by key"; a stored column that no longer exists is discarded; `discard_remembered_sort=1` skips it. <!-- parity:test --> `p02-dafcf6` [browse.test.ts:70](../../apps/server/test/int/browse.test.ts#L70) +1
- [x] `LIMIT pos, max_rows` is injected only for SELECT/sub-query statements without their own LIMIT, when the parser found no errors, and `max_rows !== 'all'`; export (`INTO OUTFILE`) and `PROCEDURE ANALYSE` are excluded. <!-- parity:test --> `p02-9f5692` [query.test.ts:41](../../apps/server/test/int/query.test.ts#L41) +3
- [x] Queries with their own LIMIT show no navigation bar and the header uses the user's offset/count for "Showing rows a - b". <!-- parity:test --> `p02-290262` [query.test.ts:58](../../apps/server/test/int/query.test.ts#L58) +1
- [ ] Row total is `pos + numRows` without a count query when the returned page is shorter than `max_rows`.
- [x] "Just browsing" single-table queries use `SHOW TABLE STATUS` row estimate when ≥ `MaxExactCount`, else `SELECT COUNT(*)`; other SELECTs use `SELECT COUNT(*) FROM (<query minus ORDER BY/LIMIT, SELECT list → 1 unless GROUP BY/DISTINCT/UNION, SQL_NO_CACHE removed>) as cnt`. <!-- parity:test --> `p02-b29af3` [query.test.ts:41](../../apps/server/test/int/query.test.ts#L41) +3
- [ ] Views with `MaxExactCountViews = 0` report total −1: header shows "Showing rows X - ..." with a hint icon "This view has at least this number of rows." and no total; no page selector; no End button; Next always available.
- [x] Header text: `Showing rows %1s - %2s (%s total, Query took %01.4f seconds.)`; when `unlimNumRows !== total` the parenthesis reads `%1$s total, %2$s in query`; numbers are locale-formatted (`Util::formatNumber`). <!-- parity:test --> `p02-356f71` [browse.parity.test.ts:407](../../tests/parity/browse.parity.test.ts#L407)
- [x] For each ORDER BY column present in the result, ` [col: FIRST... - LAST...]` is appended using the first and last row of the **current page**, values upper-cased and truncated to `LimitChars`; BLOB/binary/geometry show `[BLOB - size]`. <!-- parity:test --> `p02-b74767` [browse.test.ts:70](../../apps/server/test/int/browse.test.ts#L70)
- [x] Without navigation bar the message is just the success icon + `(Query took %01.4f seconds.)`. <!-- parity:test --> `p02-507e37` [query.test.ts:138](../../apps/server/test/int/query.test.ts#L138)
- [x] Executed SQL is displayed highlighted only when `ShowSQL` is true and the query is non-empty and not `;`. <!-- parity:test --> `p02-f22617` [sql-message.test.ts:79](../../apps/server/test/unit/sql-message.test.ts#L79) +1
- [ ] PHP session is closed during query execution and reopened afterwards (long queries do not block other tabs). <!-- parity:n/a: no PHP session lock; the Node server answers requests of one session concurrently -->
- [x] MySQL warnings after execution are appended as notice messages below the result. <!-- parity:test --> `p02-be287b` [sql-tab.parity.test.ts:206](../../tests/parity/sql-tab.parity.test.ts#L206)
- [x] `DROP DATABASE` is refused when `AllowUserDropDatabase` is false and user is not superuser: ""DROP DATABASE" statements are disabled." <!-- parity:test --> `p02-1f1ac2` [sql-tab.test.ts:91](../../apps/server/test/int/sql-tab.test.ts#L91) +1
- [x] `USE db` changes trigger a navigation reload (`reload`) in the AJAX response. <!-- parity:test --> `p02-b19bd5` [sql-message.test.ts:117](../../apps/server/test/unit/sql-message.test.ts#L117) +2
- [x] `fk_checks` request param sets `FOREIGN_KEY_CHECKS` ON/OFF for the duration of the request and restores the previous value afterwards. <!-- parity:test --> `p02-b10e84` [sql-tab.test.ts:114](../../apps/server/test/int/sql-tab.test.ts#L114) +1

### Result header card tools
- [x] "Edit inline" replaces the SQL display with an editor + FK-checks checkbox (default fetched from `/sql/get-default-fk-check-value`) + Go/Cancel; Go posts `show_query=1` to `/import`. Only one inline editor at a time. <!-- parity:test --> `p02-9128e7` [sql-editor.e2e.ts:179](../../tests/e2e/sql-editor.e2e.ts#L179)
- [x] "Edit" goes to the SQL tab of table/db/server with the query prefilled (`show_query=1`). <!-- parity:test --> `p02-88edc9` [sql-tab.parity.test.ts:196](../../tests/parity/sql-tab.parity.test.ts#L196) +1
- [x] "Explain SQL" only for queries beginning with `SELECT`; "Skip Explain SQL"/"Skip Analyze SQL" when already prefixed (supports `ANALYZE`, `FORMAT=JSON|TREE|TRADITIONAL`). <!-- parity:test --> `p02-aa2107` [sql-message.test.ts:19](../../apps/server/test/unit/sql-message.test.ts#L19) +3
- [x] "Create PHP code" renders `$sql = "…";` with newline concatenation; in that mode links become "Without PHP code" and "Submit query". <!-- parity:test --> `p02-f4f624` [sql-message.test.ts:84](../../apps/server/test/unit/sql-message.test.ts#L84) +2
- [x] "Refresh" only for `ANALYZE|EXPLAIN|SELECT|SHOW` and not in PHP mode. <!-- parity:test --> `p02-f44b2c` [sql-message.test.ts:41](../../apps/server/test/unit/sql-message.test.ts#L41) +1
- [x] Explain / PHP / Edit-inline links disappear when the query is longer than `MaxCharactersInDisplayedSQL`. <!-- parity:test --> `p02-40a8f8` [sql-tab.test.ts:56](../../apps/server/test/int/sql-tab.test.ts#L56) +1
- [x] Profiling switch appears next to Refresh when the server supports profiling; checking it re-runs the query and renders Detailed profile + Summary by state + chart. <!-- parity:test --> `p02-2a54e4` [sql-message.test.ts:41](../../apps/server/test/unit/sql-message.test.ts#L41) +3

### Navigation bar
- [x] Rendered both above and below the table; hidden in print. <!-- parity:test --> `p02-42e1d3` [browse-extras.e2e.ts:73](../../tests/e2e/browse-extras.e2e.ts#L73)
- [x] Begin/Previous only when `pos > 0` and not Show-all; Next when not last page; End when not last page and the total is known. <!-- parity:test --> `p02-437552` [browse.test.ts:90](../../apps/server/test/int/browse.test.ts#L90)
- [ ] Button labels obey `TableNavigationLinksMode` (`<<`, `<`, `>`, `>>` icons / text / both).
- [ ] Last-page detection treats an InnoDB estimate as inexact: Next remains until a short page is returned (`isExactCount`).
- [ ] End button's form refuses submit (`onsubmit return false`) when `pos + max_rows >= total` or the page isn't full.
- [x] Page selector shown only when > 1 page and not Show-all; current page bold; condensed page list for ≥ 200 pages (first 5, last 5, ±10 around current, 5 % steps, powers-of-two distances). <!-- parity:test --> `p02-3e8068` [browse.test.ts:47](../../apps/server/test/int/browse.test.ts#L47)
- [x] "Show all" checkbox appears when `ShowAll` or total ≤ 500; enabling asks "Do you really want to see all of the rows? For a big table this could crash the browser."; disabling returns to `MaxRows` rows at `pos=0`. <!-- parity:test --> `p02-c722eb` [browse.parity.test.ts:115](../../tests/parity/browse.parity.test.ts#L115)
- [x] "Number of rows" select offers 25/50/100/250/500 (+ the current custom value, sorted; "All" disabled option when showing all); change autosubmits; `session_max_rows ≥ 1` and `0 ≤ pos ≤ total−1` validated client side ("Not a valid row number"). <!-- parity:test --> `p02-1e3bfc` [logic.test.ts:45](../../apps/web/src/features/browse/logic.test.ts#L45)
- [x] The chosen `max_rows`/`pos` are remembered per exact SQL string (md5 of server+db+sql) for the last 10 queries in the session. <!-- parity:test --> `p02-284f7e` [browse.test.ts:90](../../apps/server/test/int/browse.test.ts#L90) +1
- [ ] Sort links carry `session_max_rows` so that "Show all" survives re-sorting.
- [x] "Filter rows" box filters the current page client-side across all `data-column` headers, mirrors its text to the twin box, hides non-matching rows live on keyup. <!-- parity:test --> `p02-fbe95b` [logic.test.ts:64](../../apps/web/src/features/browse/logic.test.ts#L64)
- [x] "Sort by key" select lists `<index> (ASC)` / `(DESC)` per index plus "None", selected according to the current ORDER BY; autosubmits the rewritten query with `sort_by_key=1` (bypasses remembered sort). <!-- parity:test --> `p02-440ff1` [browse.parity.test.ts:87](../../tests/parity/browse.parity.test.ts#L87)
- [ ] "Save edited data" and "Restore column order" buttons live in the navigation bar and are hidden until relevant.

### Display options
- [ ] Panel collapsible per `InitialSlidersState` (`closed` default, `open`, `disabled` = always open without toggle).
- [ ] Partial/Full texts radio; Relational key / Display column radio only when both `relation` and `table_info` pmadb features exist; Show binary contents; Show BLOB contents; Hide browser transformation; Geometry (only when result is editable) / WKT / WKB radios; Go.
- [x] Submitting the options form re-renders the whole result block via AJAX and reinitialises the grid. <!-- parity:test --> `p02-5293ef` [browse.e2e.ts:42](../../tests/e2e/browse.e2e.ts#L42)
- [ ] `display_binary` defaults to **on** for a fresh query unless toggled off via the options form; the full/partial toggle link does not reset it.
- [ ] EXPLAIN results default to Full texts.
- [ ] Options persist per query (same session key as pagination) and the `RelationalDisplay` config default is only consulted when the session has no value.
- [ ] The full/partial text toggle image button sits in the action header (left/right per `RowActionLinks`) and flips `pftext`.

### Column headers & sorting
- [ ] Headers are sticky (`position-sticky bg-body`); numeric columns right-aligned; hidden columns carry `hide`.
- [x] Columns referenced in the WHERE clause get class `condition` (header and cells) for highlighting. <!-- parity:test --> `p02-c75482` [browse.test.ts:213](../../apps/server/test/int/browse.test.ts#L213)
- [x] Column comments (native) shown under the name in small muted text, truncated to `LimitChars` with full comment as tooltip (`ShowBrowseComments`). <!-- parity:test --> `p02-26b09f` [browse.test.ts:47](../../apps/server/test/int/browse.test.ts#L47)
- [x] Plain click on header: sort by that column; first click direction is `Order` (`SMART` → DESC for date/time, ASC otherwise); clicking a sorted column flips its direction; other ORDER BY columns are dropped. <!-- parity:test --> `p02-50ad5b` [browse.test.ts:47](../../apps/server/test/int/browse.test.ts#L47)
- [x] Shift+click adds the column to the ORDER BY (or flips its direction); Ctrl+click / Alt+click removes it; multi-sort indices shown as `<small>N</small>`. <!-- parity:test --> `p02-17fc03` [browse.parity.test.ts:87](../../tests/parity/browse.parity.test.ts#L87)
- [ ] Hovering a sort link swaps the asc/desc icon preview.
- [x] Table-qualified `ORDER BY \`t\`.\`c\`` only when the field has a table and is not aliased. <!-- parity:test --> `p02-c390b7` [browse.test.ts:70](../../apps/server/test/int/browse.test.ts#L70)
- [ ] `ORDER BY 2`-style positional sorts are resolved to column names for the indicator.
- [x] Sort links are not shown when fewer than 2 rows (except for views), for SHOW/EXPLAIN/COUNT/maintenance statements, or for multi-table results. <!-- parity:test --> `p02-b790fa` [browse.parity.test.ts:160](../../tests/parity/browse.parity.test.ts#L160)
- [x] Header tooltip texts: "Click to sort results by this column.", the Shift/Ctrl/Alt multi-sort hint, "Drag to reorder.", "Click to mark/unmark.", "Double-click to copy column name.", and "Click the drop-down arrow to toggle column's visibility." on the action header. <!-- parity:test --> `p02-0ad93b` [browse-extras.e2e.ts:86](../../tests/e2e/browse-extras.e2e.ts#L86)
- [ ] Hovering a header highlights the entire column (`hover` on cells) when `BrowsePointerEnable`; clicking a header toggles `marked` on the column when `BrowseMarkerEnable`.
- [x] Double-click on a header copies the column name and toasts success/failure. <!-- parity:test --> `p02-ba813c` [browse-extras.e2e.ts:125](../../tests/e2e/browse-extras.e2e.ts#L125)
- [x] Header row repeats every `RepeatCells` rows (`repeating_header_row`) with matching action-column placeholders. <!-- parity:test --> `p02-684d83` [browse-extras.e2e.ts:73](../../tests/e2e/browse-extras.e2e.ts#L73)

### Column reorder / resize / visibility
- [ ] Drag a header to reorder; ghost header follows pointer; insertion pointer shown; order applied to every row including repeated headers.
- [x] Column order and visibility persist via `/sql/set-column-preferences` with `table_create_time`; the server rejects saves if the table structure changed since the page was rendered, with the exact message "Cannot save UI property …". <!-- parity:test --> `p02-19721f` [repositories.test.ts:248](../../packages/metadata/test/repositories.test.ts#L248) +1
- [x] Prefs are discarded server-side when the column count changes or any index is out of range, when the table create time changed, and never applied to views. <!-- parity:test --> `p02-3b326e` [repositories.test.ts:270](../../packages/metadata/test/repositories.test.ts#L270) +1
- [ ] Reorder disabled for results without a navigation bar (EXPLAIN/SHOW etc.).
- [ ] Column widths resizable by dragging the border after each header; min 15 px; not persisted.
- [x] Visibility dropdown (arrow in the action header) lists all columns with checkboxes; the last visible column cannot be hidden; "Show all" button (duplicated at the top when > 10 columns); list hides when the mouse enters the table. <!-- parity:test --> `p02-f866f3` [browse-extras.e2e.ts:112](../../tests/e2e/browse-extras.e2e.ts#L112)
- [ ] "Restore column order" visible only when order differs from natural and more than one column is visible; restoring also persists.
- [x] pmadb `table_uiprefs` rows beyond `MaxTableUiprefs` are purged oldest-first on save. <!-- parity:test --> `p02-e55a88` [repositories.test.ts:248](../../packages/metadata/test/repositories.test.ts#L248)

### Row actions and selection
- [x] Checkbox + Edit + Copy + Delete rendered at left/right/both/none per `RowActionLinks`; `none` still shows the checkbox column; the header above them uses `colspan=4` when both edit and delete exist. <!-- parity:test --> `p02-31ba46` [logic.test.ts:24](../../apps/web/src/features/browse/logic.test.ts#L24)
- [ ] Edit/Copy/Delete content is icon/text/both per `RowActionType`.
- [ ] Edit link → `/table/change` with `where_clause`, `where_clause_signature`, `clause_is_unique`, `sql_query` (SELECT list + FROM only when the query is ≥ 200 chars), `default_action=update`; Copy identical with `default_action=insert`.
- [x] Edit cell tooltip: "You can also edit most values by (double-)clicking directly on them." (placement right/left), absent when grid editing is disabled. <!-- parity:test --> `p02-e392ea` [browse-extras.e2e.ts:86](../../tests/e2e/browse-extras.e2e.ts#L86)
- [x] Delete link → `/sql` with `DELETE FROM \`t\` WHERE <clause>` (+ ` LIMIT 1` when the clause is not unique), `message_to_show="The row has been deleted."`, `goto` back to the browse query; confirm "Do you really want to execute "<SQL>"?" unless `Confirm` is false; on success the row is removed from the DOM without reloading. <!-- parity:test --> `p02-2b0c72` [browse.test.ts:141](../../apps/server/test/int/browse.test.ts#L141) +1
- [ ] `SHOW [FULL] PROCESSLIST` rows get a "Kill" action running `KILL <id>` against db `mysql`.
- [x] WHERE clause preference: PRIMARY → UNIQUE → all columns (`clause_is_unique=false`, row anchor class `nonunique`); REAL columns compared via `CONCAT(col)`; binary/BLOB via `CAST(0x… AS BINARY)` (< 1000 bytes) or `CHAR_LENGTH(col)=n` when sole field or skipped; geometry via `CAST(0x… AS BINARY)` (< 5000); BIT via `b'…'`; NULL via `IS NULL`; aliases mapped back to original columns; table aliases replaced by real table unless it is a view. <!-- parity:test --> `p02-841990` [where.test.ts:55](../../packages/sql-gen/test/where.test.ts#L55) +1
- [x] Each row carries hidden `where_clause` and JSON `condition_array` for client-side updates. <!-- parity:test --> `p02-3ec720` [browse.test.ts:47](../../apps/server/test/int/browse.test.ts#L47)
- [x] Shift+click on checkboxes selects a range; checked rows get `marked table-active`. <!-- parity:test --> `p02-a662d5` [browse-extras.e2e.ts:97](../../tests/e2e/browse-extras.e2e.ts#L97)
- [x] Rows without a unique key (and `RowActionLinksWithoutUnique` on) show the notice "…may result in undesired behavior."; system schemas / non-unique results show "…features are not available." with doc link `cfg_RowActionLinksWithoutUnique`. <!-- parity:test --> `p02-c56862` [browse.test.ts:118](../../apps/server/test/int/browse.test.ts#L118) +1
- [ ] Multi-table (JOIN/sub-query) results, `information_schema`-like schemas, and results from multiple tables never show row actions or grid editing; updatable views do.

### Bulk actions
- [x] "Check all" toggles every row checkbox; "With selected: Edit / Copy / Delete / Export (SELECT only)". <!-- parity:test --> `p02-9afb97` [browse.parity.test.ts:316](../../tests/parity/browse.parity.test.ts#L316)
- [x] Submitting with nothing selected returns "No row selected." for Edit/Copy/Export/Delete. <!-- parity:test --> `p02-6ae687` [browse-extras.e2e.ts:97](../../tests/e2e/browse-extras.e2e.ts#L97)
- [ ] Edit opens the multi-row edit form; Copy opens insert forms prefilled; Export exports only the selected rows (`single_table`).
- [x] Delete shows a confirmation page listing every `DELETE FROM \`t\` WHERE <clause>;`, with "Enable foreign key checks" checkbox, Yes (danger) / No; Yes executes each delete with `LIMIT 1`, then re-runs the original browse query and shows the executed DELETEs above the grid. <!-- parity:test --> `p02-a3dbd4` [browse.test.ts:141](../../apps/server/test/int/browse.test.ts#L141) +1
- [ ] `clause_is_unique` for the bulk form is computed from the last row of the page.

### Cell rendering
- [x] NULL → italic `NULL` with class `null`; empty string → empty non-wrapping cell; numeric → right-aligned no-wrap. <!-- parity:test --> `p02-f6be27` [browse-extras.e2e.ts:57](../../tests/e2e/browse-extras.e2e.ts#L57)
- [x] Non-numeric, non-binary text truncated at `LimitChars` + `...` in Partial mode with `data-originallength` and tooltip "Original length N"; Link transformations and binaries are never truncated by this rule. <!-- parity:test --> `p02-dc194e` [browse.test.ts:47](../../apps/server/test/int/browse.test.ts#L47)
- [x] Date/time cells `text-nowrap`; other text `pre_wrap` (whitespace preserved, newlines → `<br>`, double space → `&nbsp;`). <!-- parity:test --> `p02-57815e` [browse-extras.e2e.ts:57](../../tests/e2e/browse-extras.e2e.ts#L57)
- [x] BIT shown as binary digits (`printableBitValue`). <!-- parity:test --> `p02-9cc265` [browse-extras.e2e.ts:57](../../tests/e2e/browse-extras.e2e.ts#L57)
- [x] BINARY/BLOB shown as `[BINARY - 12 B]`/`[BLOB - 1.2 KiB]` (`[BLOB - NULL]` for NULL), wrapped in a download link to `/table/get-field` (file `<table>-<col>.bin`, MIME sniffed); with Show binary/BLOB contents the value is shown as UTF-8 text or `0x<hex>` when not printable, truncated; grid editing disabled when the placeholder is shown or `ProtectBinary` forbids. <!-- parity:test --> `p02-ed7243` [browse.test.ts:118](../../apps/server/test/int/browse.test.ts#L118)
- [ ] Geometry: `[GEOMETRY - size]` link, or WKT text (server-converted), or WKB hex without SRID (needs Show binary contents) — never grid-editable.
- [x] FK/relation cells are links to `SELECT * FROM \`fdb\`.\`ft\` WHERE \`ff\` = <value>` at `pos=0`; `K` mode shows key with display value as tooltip, `D` mode shows display value (italic NULL if null) with key as tooltip; "Link not found!" when no matching foreign row; display value truncated to `LimitChars`; lookups cached per page. <!-- parity:test --> `p02-1e062a` [browse.test.ts:102](../../apps/server/test/int/browse.test.ts#L102) +1
- [x] Display column resolution: `pma__table_info.display_field` → emulated for `information_schema.CHARACTER_SETS/TABLES` → first CHAR-class column → none. <!-- parity:test --> `p02-2e6fb1` [browse.test.ts:102](../../apps/server/test/int/browse.test.ts#L102)
- [ ] Both pmadb internal relations and native FOREIGN KEYs (from `SHOW CREATE TABLE`) produce FK links; `information_schema`/`mysql` tables get emulated relations and special links (e.g. user → privileges page).
- [x] Browse-distinct results (`is_browse_distinct=1`) link each distinct value back to the filtered table. <!-- parity:test --> `p02-0d4e9a` [table-structure-extras.e2e.ts:79](../../tests/e2e/table-structure-extras.e2e.ts#L79)
- [x] Browser transformations (pmadb `column_info`) applied unless "Hide browser transformation"; built-in SQL/JSON/link transformations for system/pmadb columns and `SHOW PROCESSLIST`/`SHOW CREATE TABLE` outputs; transformed cells get class `transformed`; JSON highlighted via CodeMirror. <!-- parity:test --> `p02-15262e` [insert-edit.test.ts:226](../../apps/server/test/int/insert-edit.test.ts#L226)
- [ ] Print view shows FK cells as `value [->display]`.

### Grid editing
- [ ] Trigger per `GridEditing` (click / double-click / disabled); on relational links in double-click mode a single click (700 ms) follows the link and a double-click edits.
- [ ] Editor type: textarea for `string`/`blob`/`json`, input otherwise; sized to the cell; cursor at end; JSON pretty-printed.
- [ ] NULL checkbox (unless NOT NULL) with auto-uncheck on typing and auto-check on emptying; checking clears the editor.
- [x] ENUM → dropdown of values; SET → multi-select (size ≤ 10) with full value re-fetched when truncated; relation → FK dropdown (ordered per `ForeignKeyDropdownOrder`, natural sort, blank separators) or "Browse foreign values" modal when ≥ `ForeignKeyMaxLimit` rows. <!-- parity:test --> `p02-10a94f` [browse.test.ts:164](../../apps/server/test/int/browse.test.ts#L164) +1
- [x] Truncated/transformed cells fetch the full value via `/sql` + `grid_edit` (binary returned as hex). <!-- parity:test --> `p02-85eff6` [browse.test.ts:164](../../apps/server/test/int/browse.test.ts#L164) +1
- [ ] Date/time cells get a datetimepicker with precision from `data-decimals`; invalid typed values hide the picker.
- [x] Enter saves (Shift+Enter newline in textarea); Esc cancels; click outside saves; Ctrl/Alt+arrows move editing between cells saving on the way. <!-- parity:test --> `p02-8c16e6` [browse.e2e.ts:42](../../tests/e2e/browse.e2e.ts#L42)
- [x] Hex cells validate `^(0x)?[a-f0-9]*$` ("Please enter a valid hexadecimal string…"). <!-- parity:test --> `p02-b9d7d4` [logic.test.ts:64](../../apps/web/src/features/browse/logic.test.ts#L64)
- [ ] Only changed values are posted; `SaveCellsAtOnce` collects `to_be_saved` cells and shows "Save edited data"; leaving the page with unsaved edits warns.
- [x] Non-unique tables alert "This table does not contain a unique column. Features related to the grid edit, checkbox, Edit, Copy and Delete links may not work after saving." before posting; UPDATE gets `LIMIT 1`. <!-- parity:test --> `p02-03ff49` [browse.test.ts:118](../../apps/server/test/int/browse.test.ts#L118)
- [x] After save: message toast, new WHERE clause propagated to hidden inputs, Edit/Copy/Delete links, delete confirmation text and checkboxes; cell re-truncated per `LimitChars`/`pftext`; time decimals trimmed to `data-decimals`; relational cells re-rendered as links per `relational_display`; transformed cells re-rendered; query card appended (max two). <!-- parity:test --> `p02-784009` [logic.test.ts:64](../../apps/web/src/features/browse/logic.test.ts#L64) +1
- [x] Editing a column that is part of the row's WHERE clause rewrites the condition for subsequent edits. <!-- parity:test --> `p02-ae4d44` [logic.test.ts:54](../../apps/web/src/features/browse/logic.test.ts#L54)

### Cell selection / copy
- [ ] Mouse drag selects a rectangle of cells (headers included), Ctrl/Cmd toggles, Shift+arrows extend, Ctrl/Cmd+A selects all, Esc/outside click clears; Ctrl/Cmd+C copies TSV with header line.
- [x] "Copy to clipboard" button copies breadcrumb, URL, messages, SQL, headers and all page rows (NULL as `NULL`), skipping repeated header rows. <!-- parity:test --> `p02-5aad8b` [browse-extras.e2e.ts:125](../../tests/e2e/browse-extras.e2e.ts#L125)

### Operations / misc
- [x] Query results operations: Print, Copy to clipboard, Export (with `single_table`/`raw_query`/`unlim_num_rows`), Display chart, Visualize GIS data (geometry present), Create view (modal); omitted for `PROCEDURE` results; only Create view on no-result pages. <!-- parity:test --> `p02-7d28de` [table-visualization.e2e.ts:48](../../tests/e2e/table-visualization.e2e.ts#L48) +1
- [x] Bookmark form below the results with label + shared switch; empty label refused; success toast "Bookmark %s has been created."; hidden when running a bookmark. <!-- parity:test --> `p02-62c852` [repositories.test.ts:56](../../packages/metadata/test/repositories.test.ts#L56) +1
- [x] No-result messages: `%d row(s) deleted/inserted/affected`, `Inserted row id: N`, "MySQL returned an empty result set (i.e. zero rows).", `[ROLLBACK occurred.]`, "Showing as PHP code"; always with query time. <!-- parity:test --> `p02-68785a` [query.test.ts:88](../../apps/server/test/int/query.test.ts#L88) +2
- [x] Empty table browse still renders headers (sortable, no navigation/actions). <!-- parity:test --> `p02-141e59` [query.test.ts:109](../../apps/server/test/int/query.test.ts#L109)
- [x] SQL errors: "Error" alert with static analysis list, "SQL query:" + copy icon + doc links, formatted query, "MySQL said:" + server message; AJAX scrolls to it. <!-- parity:test --> `p02-fa2d56` [sql-message.test.ts:92](../../apps/server/test/unit/sql-message.test.ts#L92) +2
- [x] Simulate query button for UPDATE/DELETE text; modal with per-statement SQL, "Affected rows" count link opening the equivalent SELECT. <!-- parity:test --> `p02-930d5c` [sql-editor.e2e.ts:139](../../tests/e2e/sql-editor.e2e.ts#L139)
- [x] Rollback when finished only for DML on transactional tables. <!-- parity:test --> `p02-b3ba1b` [sql-tab.parity.test.ts:89](../../tests/parity/sql-tab.parity.test.ts#L89) +1
- [x] Query box: Show this query here again (localStorage), Retain query box (collapse toggle), Bind parameters, Delimiter, FK checks, bookmark label/shared/replace, auto-save & "Get auto-saved query", SELECT*/SELECT/INSERT/UPDATE/DELETE/Clear/Format templates, column insert list. <!-- parity:test --> `p02-390d7c` [sql-editor.e2e.ts:74](../../tests/e2e/sql-editor.e2e.ts#L74) +1
- [ ] Page-settings gear on Browse exposes exactly the 16 `Browse` directives listed above.
- [x] Global keyboard shortcuts (D/T prefixes, K console, E export, H home, Backspace back) are inactive while typing. <!-- parity:test --> `p02-a7b23d` [shell.test.tsx:103](../../apps/web/src/features/shell/shell.test.tsx#L103)

---

## Rebuild notes (modern SPA mapping)

### Routes (client)
- `/db/:db/table/:table/browse` — table Browse (default query, remembered sort, uiprefs). Query string: `?sql=<base64/signed>&pos=&limit=&sort=col:dir,col:dir&pftext=P|F&rel=K|D&geo=GEOM|WKT|WKB&bin=1&blob=1&notrans=1`. Keep "view state" in the URL so deep links and back/forward work (phpMyAdmin keeps it in a server session keyed by query hash; the SPA should make it explicit but may also persist the last state per query hash in localStorage to mimic the "remembered pos/max_rows for the last 10 queries" behaviour).
- `/db/:db/sql`, `/db/:db/table/:table/sql`, `/server/sql` — query box + results panel (same grid component).
- Modal/sub-routes: `…/browse/delete-confirm`, `…/rows/edit`, `…/rows/copy`, `…/rows/export`, `…/browse-foreign/:column`, `…/view/create`, `…/chart`, `…/gis`.

### API endpoints (server)
- `POST /api/sql/execute` → `{ columns: FieldMeta[], rows, numRows, unlimNumRows (or -1 unknown), isExactCount, queryTime, warnings[], statementInfo { type, selectTables, hasLimit, orderBy[], whereIdentifiers[], isJustBrowsing, isProcedure, isMaintenance … }, editable, hasUniqueKey, updatableView, displayParts, rememberedSortApplied, appliedSql, message (for non-result statements: deleted/inserted/affected counts, insertId), profiling? }`. The server must replicate `isAppendLimitClause`, `countQueryResults`, `handleSortOrder`, `resultSetContainsUniqueKey`, `isJustBrowsing` exactly.
- `GET /api/relations/:db/:table` → FK map (internal + native) with display fields; `GET /api/fk/display-values?db&table&field&values[]` batched lookup replacing the per-cell `SELECT display LIMIT 1` (phpMyAdmin issues one per distinct value; batch into one `WHERE ff IN (...)`).
- `GET /api/fk/options?db&table&column&q&pos` → FK dropdown / browse-foreign data (paginated, `ForeignKeyMaxLimit` logic).
- `GET /api/columns/:db/:table/:column/enum-set` → values for ENUM/SET editors.
- `GET /api/cell?db&table&where&column` → full untruncated value (hex for binary); `GET /api/cell/download` → bytes with sniffed MIME.
- `POST /api/rows/update` (grid save: `[{where, isUnique, fields:{col:{value,null,type}}}]`) returning the re-read values, new display/link for relational cells, re-transformed HTML, and the affected count; `POST /api/rows/delete` (`[where]`, `fkChecks`); `POST /api/rows/export`.
- `PUT /api/uiprefs/:db/:table` (`colOrder, colVisib, sortedCol, createTime`) with the create-time guard; `GET` on browse load.
- `GET /api/transformations/:db/:table` (pmadb column_info) and `GET /api/comments/:db/:table`.
- `POST /api/bookmarks`, `GET /api/bookmarks?db`, `GET /api/bookmarks/by-label?db&label` (default browse query).
- `POST /api/sql/simulate`, `POST /api/sql/explain`, `GET /api/server/fk-check-default`.
- `GET /api/count?db&table&sql&exact=1` — explicit exact count (new; phpMyAdmin no longer has the link but a clone can expose it).

### State
- Grid view state (per query hash): `pos, maxRows|'all', pftext, relationalDisplay, geoOption, displayBinary, displayBlob, hideTransformation, repeatCells`, mirrored to URL + localStorage (LRU 10).
- Table UI prefs: `colOrder[], colVisib[], sortedCol, createTime` (server-persisted when pmadb exists; otherwise localStorage, as phpMyAdmin falls back to session).
- Editing state: `editingCell, pendingEdits (Map<rowKey, Map<col, value|null>>), saveCellsAtOnce, isSaving, lastRequestAbort`.
- Selection state: `selectedRows (Set), lastClickedRow for shift-range, cellSelection {rows:Set, cols:Set, anchor, end}`.
- Derived: `whereClause` and `conditionArray` per row (compute client-side from metadata with the same PK → UNIQUE → all-columns algorithm, or ship from the server; shipping is safer because of binary/REAL/BIT quoting rules).

### Where snappiness matters
- Sorting, paging, row-count changes, and display-option toggles should be **in-place** data refreshes (JSON), not full HTML swaps; keep the header/filter/scroll position; show skeleton rows only after ~150 ms.
- Grid edit: optimistic cell update on Enter with rollback on failure; the server's re-read value (`isNeedToRecheck`) replaces the optimistic one when it arrives.
- Row delete from the action link: optimistic row removal (phpMyAdmin already does this client-side), but also decrement the totals in the header and refresh the page when the page becomes empty.
- Filter rows: pure client filtering over the loaded page — keep it instant; consider offering a server-side "search this table" when `max_rows` < total.
- FK display values: batch per page and cache per (table, field, value); render keys immediately, hydrate display values/tooltips when the batch returns.
- Column resize/reorder/visibility: pure client, debounce the prefs PUT (phpMyAdmin posts on every change).

### Prefetch / optimistic
- Prefetch the next page when the user reaches the bottom of the grid or hovers Next; keep previous page cached for instant Back.
- Prefetch ENUM/SET value lists and FK option counts for editable columns on page load (phpMyAdmin fetches lazily per edit).
- Compute "exact count" lazily in the background when the first count was an estimate, then update the header (replaces the removed "exact count" link).
- Keep the `editable`/`hasUniqueKey` evaluation server-side and cache per (db, table, column set).
- When `RememberSorting` is on, store the remembered ORDER BY immediately on sort and apply it client-side to the default browse query before the first request.

### Things to consciously keep or drop
- Keep: signature on all generated SQL links (or use POST bodies), `LIMIT 1` safety on non-unique deletes/updates, create-time guard for persisted column prefs, view hint for unknown counts, the exact confirmation texts above, the distinction between Partial/Full texts and the `data-originallength` tooltip, print-friendly layout.
- Drop/modernise: jQuery UI datepicker (use a native/modern picker but keep microsecond precision rules), `execCommand('copy')` (use Clipboard API), per-cell FK lookups (batch), full-HTML re-render on options change, the 10-query session LRU (use URL state).

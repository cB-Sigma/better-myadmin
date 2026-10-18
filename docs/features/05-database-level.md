# 05 — Database level (Structure, Search, Query, Operations, Privileges, Routines, Events, Triggers, Tracking, Designer, Central columns, Data dictionary, Create database, server Databases list)

Source snapshot: phpMyAdmin `master` (Oct 2026), cloned at `scratchpad/pma`. All paths below are relative to that root. Everything in this document is derived from the cited PHP controllers, Twig templates and TypeScript modules; nothing is invented. Where a behaviour depends on a configuration directive, the directive is named with its default from `src/Config/Settings.php` (or `src/Config/Settings/Schema.php` / `src/Config/Settings/Server.php`).

Out of scope here (covered by other documents, only pointed to): the SQL editor (`/database/sql`, `SqlController`, `SqlAutoCompleteController`, `SqlFormatController`), Export/Import tabs (`/database/export`, `/database/import`), the table-level maintenance routes (`/table/maintenance/*`) that the Structure bulk-actions submit to, the `/server/privileges` user editor that the DB Privileges tab links into, table-level Tracking (`/table/tracking`), and the Trigger editor dialog itself (shared with the table level).

---

## Scope & source map

### Database tab bar

`src/Menu.php::getDbTabs()` builds the tabs. Order and visibility rules:

| Key | Route | Label / icon | Shown when |
|---|---|---|---|
| structure | `/database/structure` | Structure / `b_props` | always |
| sql | `/database/sql` | SQL / `b_sql` | always |
| search | `/database/search` | Search / `b_search` | always; carries warning "Database seems to be empty!" if `count(getTables(db)) === 0` |
| query | `/database/multi-table-query` | Query / `s_db` | always; same empty-DB warning |
| export | `/database/export` | Export / `b_export` | always; same empty-DB warning |
| import | `/database/import` | Import / `b_import` | not a system schema |
| operation | `/database/operations` | Operations / `b_tblops` | not a system schema |
| privileges | `/database/privileges` | Privileges / `s_rights` | not system schema AND (super user OR grant user OR create user) |
| routines | `/database/routines` | Routines / `b_routines` | not a system schema |
| events | `/events` | Events / `b_events` | not system schema AND `Util::currentUserHasPrivilege('EVENT', db)` |
| triggers | `/triggers` | Triggers / `b_triggers` | not system schema AND `currentUserHasPrivilege('TRIGGER', db)` |
| tracking | `/database/tracking` | Tracking / `eye` | `Tracker::isActive()` AND not system schema |
| designer | `/database/designer` | Designer / `b_relations` | not a system schema |
| central_columns | `/database/central-columns` | Central columns / `centralColumns` | not system schema AND `relationParameters->centralColumnsFeature !== null` (pmadb `central_columns` configured) |

"System schema" is `PhpMyAdmin\Query\Utilities::isSystemSchema()` (`information_schema`, `performance_schema`, `mysql`, `sys` — `mysql`/`sys` only when the `$testForMysqlSchema` flag is true; the db-tab check uses the default which treats `information_schema`/`performance_schema` as system).

`$cfg['DefaultTabDatabase']` (default `'structure'`) is the route the Databases list and Create-database flows land on (`Url::getFromRoute($config->config->DefaultTabDatabase)`). Allowed values in Settings: `structure`, `sql`, `search`, `operations`.

### File map

| Area | PHP | Twig | TS |
|---|---|---|---|
| Structure | `src/Controllers/Database/StructureController.php`, `src/Controllers/Database/Structure/*.php` (AddPrefix, AddPrefixTable, ChangePrefixForm, CopyForm, CopyTable, CopyTableWithPrefix, DropForm, DropTable, EmptyForm, EmptyTable, FavoriteTable, RealRowCount, ReplacePrefix, ShowCreate), `src/Controllers/Database/Structure/CentralColumns/{Add,Remove,MakeConsistent}Controller.php` | `resources/templates/database/structure/*.twig`, `database/create_table.twig`, `filter.twig`, `list_navigator.twig` | `resources/js/database/structure.ts`, `modules/functions/adjustTotals.ts`, `modules/navigation/event-loader.ts` (favorite click) |
| Create database / Databases list | `src/Controllers/Server/DatabasesController.php`, `src/Controllers/Server/Databases/{Create,Destroy}Controller.php`, `src/Controllers/DatabaseController.php` (`POST /databases` JSON list) | `resources/templates/server/databases/index.twig` | `resources/js/server/databases.ts` |
| Operations | `src/Controllers/Operations/DatabaseController.php`, `src/Controllers/Operations/Database/CollationController.php`, `src/Operations.php` | `database/operations/index.twig` | `database/operations.ts` |
| Search | `src/Controllers/Database/SearchController.php`, `src/Database/Search.php` | `database/search/{main,results}.twig` | `database/search.ts` |
| Query (multi-table) | `src/Controllers/Database/MultiTableQueryController.php`, `.../MultiTableQuery/{Query,Tables}Controller.php`, `src/Database/MultiTableQuery.php` | `database/multi_table_query/form.twig` | `database/multi_table_query.ts`, `database/query_generator.ts` |
| Privileges | `src/Controllers/Database/PrivilegesController.php` (+ `src/Server/Privileges.php::getAllPrivileges`) | `database/privileges/index.twig` | `server/privileges.ts` |
| Routines | `src/Controllers/Database/RoutinesController.php`, `src/Database/{Routines,Routine,RoutineItem,RoutineType}.php` | `database/routines/{index,row,editor_form,parameter_row,execute_form}.twig` | `database/routines.ts` |
| Events | `src/Controllers/Events/{Index,Export}Controller.php`, `src/Events/Events.php` | `events/{index,row,editor-form}.twig` | `events.ts` |
| Triggers (db scope) | `src/Controllers/Triggers/IndexController.php`, `src/Triggers/*` | `triggers/{list,row,editor_form,export}.twig` | `triggers.ts` |
| Tracking (db scope) | `src/Controllers/Database/TrackingController.php`, `src/Tracking/{Tracking,Tracker,TrackingChecker,TrackedTable,TrackedData}.php` | `database/tracking/tables.twig`, `create_tracking_version.twig` | `database/tracking.ts` |
| Designer | `src/Controllers/Database/DesignerController.php`, `src/Database/Designer.php`, `src/Database/Designer/{Common,DesignerTable,ColumnInfo}.php` | `database/designer/{main,database_tables,edit_delete_pages,page_save_as,page_selector,schema_export}.twig` | `resources/js/designer/{init,config,move,page,history,database,objects}.ts` |
| Schema export | `src/Controllers/SchemaExportController.php`, `src/Export/Export.php::getExportSchemaInfo`, `src/Plugins/SchemaPlugin.php`, `src/Plugins/Schema/{SchemaPdf,SchemaSvg,SchemaDia,SchemaEps}.php`, `src/Plugins/Schema/ExportRelationSchema.php`, `src/Plugins/Schema/{Pdf,Svg,Dia,Eps}/*` | `database/designer/schema_export.twig` | (designer `exportPages`) |
| Central columns | `src/Controllers/Database/CentralColumnsController.php`, `.../CentralColumns/PopulateColumnsController.php`, `src/Database/CentralColumns.php` | `database/central_columns/{main,edit,edit_table_row,populate_columns}.twig` | `database/central_columns.ts` |
| Data dictionary | `src/Controllers/Database/DataDictionaryController.php` | `database/data_dictionary/index.twig` | (print button only) |
| Config storage check | `src/Controllers/CheckRelationsController.php` | `relation/check_relations.twig` | — |

### pmadb (configuration storage) tables used at this level

DDL from `resources/sql/create_tables.sql`:

- `pma__pdf_pages (db_name varchar(64), page_nr int unsigned AI PK, page_descr varchar(50))` — Designer pages.
- `pma__table_coords (db_name, table_name, pdf_page_number int, x float unsigned, y float unsigned; PK(db_name,table_name,pdf_page_number))` — table positions per page.
- `pma__designer_settings (username varchar(64) PK, settings_data text)` — JSON blob of per-user Designer toggles.
- `pma__table_info (db_name, table_name, display_field; PK(db_name,table_name))` — "display field" chosen in Designer.
- `pma__relation (master_db, master_table, master_field, foreign_db, foreign_table, foreign_field; PK(master_*), KEY(foreign_db,foreign_table))` — internal (non-FK) relations created in Designer.
- `pma__central_columns (db_name, col_name, col_type, col_length text, col_collation, col_isNull boolean, col_extra varchar(255), col_default text; PK(db_name,col_name))`.
- `pma__tracking (db_name, table_name, version int unsigned, date_created, date_updated, schema_snapshot text, schema_sql text, data_sql longtext, tracking set(...), tracking_active int(1) default 1; PK(db_name,table_name,version))`.
- `pma__favorite (username PK, tables text)` and `pma__recent (username PK, tables text)` — favorite/recent tables (`RecentFavoriteTables::saveToDb` uses `REPLACE INTO ... (username, tables)`).
- `pma__bookmark (id, dbase, user, label, query)` — duplicated on database copy.
- `pma__userconfig (username PK, timevalue, config_data text)` — stores user preferences, including the "DbStructure" page-settings group.
- `pma__savedsearches (id, username, db_name, search_name, search_data; UNIQUE(username,db_name,search_name))` — **still created and still reported on the Check-relations page ("Saving Query-By-Example searches")**, but no controller in master reads or writes it: the legacy QBE (`/database/qbe`, `PhpMyAdmin\Database\Qbe`) has been removed from master and replaced by `/database/multi-table-query`. See the Query section.

---

## Screens / components

### Database Structure (`/database/structure`)

**Purpose.** List all tables/views in the current database with statistics and per-table action icons, provide bulk actions, favorites, and the "Create new table" starter form.

**Controller.** `StructureController::__invoke` (GET/POST). Rejects when `Current::$database === ''` (missing-parameter error) or the database cannot be selected (`DbTableExists::selectDatabase`): AJAX gets `success:false` + "No databases selected."; non-AJAX redirects to `/` with `reload=true&message=No databases selected.`. Loads scripts `database/structure.js` and `table/change.js`. Initialises page settings group `DbStructure` (`PageSettings::init('DbStructure')`) which renders the per-page "Settings" gear with the five `ShowDbStructure*` checkboxes (`src/Config/Forms/User/MainForm.php` group `DbStructure`; persisted in `pma__userconfig` when available).

**Data gathering** (`getDatabaseInfo` → `getDbInfo` or `getTablesWhenOpen`):

- If `$cfg['SkipLockedTables']` (default `false`) is true, `getTablesWhenOpen()` runs `SHOW OPEN TABLES FROM `db` WHERE In_use > 0;` then `SHOW FULL TABLES FROM `db` [WHERE (…group LIKE…)] [AND/WHERE Table_type IN/NOT IN ('BASE TABLE','SYSTEM VERSIONED')]`; tables that are "in use" get a stub row (`ENGINE: ''`, `TABLE_ROWS: 0`, `TABLE_COMMENT: ''`) and the rest go through `getTablesFull`. Sorted with `strnatcasecmp` when `$cfg['NaturalOrder']` (default `true`). No pagination in this branch.
- Otherwise `getDbInfo($db, sort, sort_order, tbl_group, tbl_type, pos)`:
  - `sort` query param mapping: `table→Name`, `records→Rows`, `type→Engine`, `collation→Collation`, `size→Data_length`, `overhead→Data_free`, `creation→Create_time`, `last_update→Update_time`, `last_check→Check_time`, `comment→Comment`; anything else → `Name`. `sort_order` is honoured only when the sort key is recognised and equals `DESC`, otherwise `ASC`.
  - When no `tbl_group`/`tbl_type`: total count = `count($dbi->getTables($db))`; when sorting by Name the name list itself is sliced (`array_slice(reversed-if-DESC, pos, MaxTableList)`) before `getTablesFull` (so pagination is done on names, and `limitCount` is 0); for other sorts `getTablesFull(limitOffset: pos, limitCount: MaxTableList, sortBy, sortOrder)` is used.
  - `tbl_type` (`table`/`view` via `TableType::tryFrom`) alone → all tables of that type, no pagination (`total = count`).
  - `tbl_group` (navigation tree group prefix) → tables named exactly `group` plus those starting with `group . $cfg['NavigationTreeTableSeparator']`, no pagination.
- `$cfg['MaxTableList']` (default `250`) is the page size. Position comes from `getTableListPosition()` which stores `$_SESSION['tmpval']['table_limit_offset']` and `..._db`; resets to 0 when the DB changes; `pos` query param (numeric, clamped ≥ 0) overrides. If `pos >= totalNumTables` the controller redirects to `/database/structure?db=…&pos=max(0, total − MaxTableList)&reload=1`.
- Stats are shown when `$cfg['ShowStats']` (default `true`) and the DB is not a system schema (`Utilities::isSystemSchema` with default flags; for `information_schema`/`performance_schema` the stats are forced off and `dbIsSystemSchema = true`).
- `isShowDbDetails = $cfg['PropertiesNumColumns'] < 2` (default `1`). When `PropertiesNumColumns > 1` the list is split into that many column blocks: `numColumns = ceil(numTables / PropertiesNumColumns) + 1` and a fresh `table_header` is emitted every `numColumns` rows (so you get N side-by-side tables) and the Type/Collation columns are hidden.

**Layout** (`structure/index.twig`): flash messages → `#tableslistcontainer` { list navigator (top), `filter.twig` ("Filters" card with text input `#filterText` "Containing the word:"; client-side filter via `data-filter-row="TABLE_NAME uppercased"` in `modules/functions.ts` ~3513), the tables form, list navigator (bottom) } → `<hr>` → paragraph with "Print" button (`.jsPrintButton`, calls `window.print`) and "Data dictionary" link (`/database/data-dictionary?db=…&goto=/database/structure`) → `create_table.twig` unless system schema. When there are no tables: notice "No tables found in database." plus the create-table form.

**List navigator** (`Generator::getListNavigator`, `list_navigator.twig`): rendered only when `MaxTableList < total`. Contains "Page number:" label, `<<` Begin and `<` Previous links (when `pos > 0`), a `<select>` page selector (`Util::pageselector('pos', MaxTableList, currentPage, ceil(total/MaxTableList))` inside a POST form), `>` Next and `>>` End links (when `pos + max < total`; End position = `(count // max) * max`, or `count − max` if that equals count). Links carry `db`, `pos`, and current `sort`/`sort_order`. Icons/text depend on `$cfg['TableNavigationLinksMode']`.

**Table header** (`table_header.twig`), one `<th>` each, all sortable via `sortable_table_header(label, sortKey[, defaultOrder])`:

1. (checkbox column, `d-print-none`)
2. **Table** (sort key `table`)
3. **Replication** — only if replica status is on (`ReplicationInfo::getReplicaInfo()['status']`); shows `s_success` "Replicated" or `s_cancel` "Not replicated" per table (`getReplicationStatus`: table is *ignored* if in `Ignore_DB`/`Ignore_Table`/`Wild_Ignore_Table` match; *do* if in `Do_DB` by table or db name, or no Do/Ignore lists at all, or `Wild_Do_Table` prefix match).
4. **Action** colspan: 6 normally (Browse, Structure, Search, Insert, Empty/Edit, Drop), 3 for system schema (Browse, Structure, Search); +1 when `$cfg['NumFavoriteTables'] > 0` (default `10`) for the favorite star column.
5. **Rows** (sort `records`, default DESC) with hint "May be approximate. Click on the number to get the exact count. See FAQ 3.11."
6. **Type** (sort `type`) and **Collation** (sort `collation`) — only when `isShowDbDetails`.
7. **Size** (sort `size`, DESC) and **Overhead** (sort `overhead`, DESC) — only when `isShowStats`.
8. **Charset** (sort `charset`) — `$cfg['ShowDbStructureCharset']` (default `false`).
9. **Comment** (sort `comment`) — `$cfg['ShowDbStructureComment']` (default `false`).
10. **Creation** (sort `creation`, DESC) — `$cfg['ShowDbStructureCreation']` (default `false`).
11. **Last update** (sort `last_update`, DESC) — `$cfg['ShowDbStructureLastUpdate']` (default `false`).
12. **Last check** (sort `last_check`, DESC) — `$cfg['ShowDbStructureLastCheck']` (default `false`).

Note: the `charset` sort key is emitted by the template but `getDbInfo()` has no mapping for it → falls back to Name ASC.

**Table row** (`structure_table_row.twig`; `<tr id="row_tbl_{n}" class="is_view"?>`):

- Checkbox `name="selected_tbl[]" value=TABLE_NAME class="checkall[ tbl-overhead]"` (`tbl-overhead` added when the table has Data_free > 0 and stats shown).
- `<th>`: table name as link to `/sql?db&table&pos=0` (Browse), `title` = TABLE_COMMENT (so hovering the name shows the comment). Followed by the tracking icon (`tracking_icon.twig`) when `Tracker::isActive()` and the table has a tracking row: `eye` "Tracking is active." or `eye_grey` "Tracking is not active.", linking to `/table/tracking`.
- Replication cell (see above).
- Favorite cell (`favorite_anchor.twig`, when `NumFavoriteTables > 0`): `<a id="{md5(table)}_favorite_anchor" class="ajax favorite_table_anchor" data-favtargets="{md5(db.table)}" title="Add to Favorites"|"Remove from Favorites">` with icon `b_no_favorite`/`b_favorite`; href `/database/structure/favorite-table?db&ajax_request=1&favorite_table=T&add_favorite=1` (or `remove_favorite`). Bootstrap tooltips are attached in `structure.ts::addTooltipToFavoriteIcons`.
- Action icons (all `class="disableAjax"` except Empty/Drop):
  - Browse → `/sql?db&table&pos=0`; icon `b_browse` if `may_have_rows` (TABLE_ROWS > 0 or is a view) else greyed `bd_browse`. Link is always active (comment in controller explains: views have unknown counts, tables may have been populated since).
  - Structure → `/table/structure?db&table` (`b_props`).
  - Search → `/table/search?db&table` (`b_select` / greyed `bd_select`).
  - Insert → `/table/change?db&table` (`b_insrow`) — hidden for system schema.
  - Empty (tables) → `<a class="truncate_table_anchor ajax" href="/sql" data-post="db&table&sql_query=TRUNCATE `T`&message_to_show=Table T has been emptied.">` (`b_empty` / greyed `bd_empty`). For views this cell is instead **Edit** → `/view/create?db&table` (`b_edit`).
  - Drop → `<a class="ajax drop_table_anchor[ view]" href="/sql" data-post="db&table&reload=1&purge=1&sql_query=DROP TABLE|VIEW `T`&message_to_show=Table|View T has been dropped.">` (`b_drop`).
- Rows cell (`td.value.tbl_rows[data-table=T]`): `format_number(TABLE_ROWS, 0)`; if `approx_rows` the number is wrapped in `<a class="ajax real_row_count" href="/database/structure/real-row-count?ajax_request=1&db&table"><bdi>~N</bdi></a>`. For views exceeding `MaxExactCountViews` a superscript hint "This view has at least this number of rows. Please refer to documentation." is appended.
- Type cell: ENGINE, or "View" for views. Collation cell: `<dfn title="{collation description}">{collation name}</dfn>` or `---`.
- Size cell: link to `/table/structure?db&table#showusage` with `<span>{size}</span>&nbsp;<span class="unit">{unit}</span>`. Overhead cell: `-` or link to the same `#showusage` with the Data_free formatted (`overhead.twig`).
- Charset cell, Comment cell (if comment longer than `$cfg['LimitChars']` (default `50`) it is truncated with `<abbr title="full comment">…</abbr>`), Creation / Last update / Last check cells (`Util::localisedDate`, `-` when null).
- Degenerate rows: a view with no TABLE_ROWS shows `-`, "View", `---`, dashes; a table "in use"/unknown engine shows a single `colspan` cell with the comment or the text **"in use"**.

**Row-count semantics** (`getStuffForEngineTypeTable` + `isRowCountApproximated`):

- MyISAM/ISAM/HEAP/MEMORY/ARCHIVE/Aria/Maria: `TABLE_ROWS`, `Data_length+Index_length`, `Data_free` are taken as exact (`getValuesForAriaTable`; for system schemas row count is re-counted).
- InnoDB/PBMS/TokuDB/ROCKSDB (`getValuesForInnodbTable`): if engine is InnoDB/TokuDB and `TABLE_ROWS < $cfg['MaxExactCount']` (default `50000`) or TABLE_ROWS unset → `COUNTED=true` and the exact count is fetched (`Table::countRecords(true)` = `SELECT COUNT(*) FROM `db`.`t``). Otherwise `COUNTED=false` → row shows `~N` approx link.
- CSV (`getValuesForCsvTable`): exact count; size computed as `SUM(LENGTH(REPLACE(REPLACE(REPLACE(CONCAT(cols),'\n','nl'),'"','qu'),'\\','bs'))) + rows*(quotedCols*2 + nCols)` after `SET SESSION group_concat_max_len = 10*1024*1024`.
- MERGE/MRG_MyISAM: size shows ` - `; rows excluded from the Sum (`!isMerge()`).
- `null`/`SYSTEM VIEW` engine: treated as view candidate. Mroonga: sized only if `StorageEngine::hasMroongaEngine()`. Unknown engine: size "unknown".
- Views (`TABLE_TYPE === 'VIEW'|'SYSTEM VIEW'`): `countRecords(true)`; `$cfg['MaxExactCountViews']` (default `0`): 0 → count is skipped and returns −1; otherwise `SELECT 1 FROM view LIMIT N` and the number of rows returned is used; if that equals/exceeds `MaxExactCountViews` the row is approximate with the superscript hint.

**Summary row** (`body_for_table_summary.twig`, `<tfoot id="tbl_summary_row">`): "N table(s)"; "Replication" header when replica active; a `Sum` header spanning 7 (4 for system schema, −1 when favorites disabled); rows total (`~N` wrapped in `<a class="ajax row_count_sum" href="/database/structure/real-row-count?ajax_request=1&db&real_row_count_all=true">` when any row is approximate); default storage engine (`SELECT @@default_storage_engine` on ≥5.5.3 else `@@storage_engine`) with tooltip "X is the default storage engine on this MySQL server."; database default collation `<dfn title="desc (Default)">`; total size & overhead (`format_byte_down(sum, 3, 1)`); charset; blank comment cell; earliest creation / latest update / latest check.

**Real row count endpoint** (`RealRowCountController`, `/database/structure/real-row-count`, AJAX only): with `table` → `{real_row_count: formatted}` (`Table::getRealRowCountTable()` = `SELECT COUNT(*)`); with `real_row_count_all` → `{real_row_count_all: [{table, row_count}]}` for every table. JS (`structure.ts::fetchRealRowCount`) swaps a throbber in, replaces the cell text / each `td[data-table*=…]`, then `adjustTotals()` recomputes the tfoot: table count, row sum (keeps `~` prefix if any row still approximate), size and overhead sums converted through the byte-unit ladder (B, KiB, MiB, GiB, TiB, PiB, EiB). On failure shows `strErrorRealRowCount`.

**"With selected" bar** (`check_all_tables.twig`): `select_all_arrow` image, checkbox `#tablesForm_checkall` "Check all", `/ Check tables having overhead` link (`.checkall-filter[data-checkall-selector=".tbl-overhead"]`, only when at least one table has overhead), and `<select name="submit_mult">`:

- `With selected:` (placeholder, selected)
- `copy_tbl` Copy table
- `show_create` Show create
- `export` Export
- optgroup **Delete data or table** (hidden for system schema or when `$cfg['DisableMultiTableMaintenance']` (default `false`)): `empty_tbl` Empty, `drop_tbl` Drop
- optgroup **Table maintenance** (same condition): `analyze_tbl`, `check_tbl`, `checksum_tbl`, `optimize_tbl`, `repair_tbl`
- optgroup **Prefix** (same condition): `add_prefix_tbl` Add prefix to table, `replace_prefix_tbl` Replace table prefix, `copy_tbl_change_prefix` Copy table with prefix
- optgroup **Central columns** (when central columns feature configured): `sync_unique_columns_central_list` Add columns to central list, `delete_unique_columns_central_list` Remove columns from central list, `make_consistent_with_central_list` Make consistent with central list

Hidden inputs `views[]=name` are emitted for each view so the server can distinguish them. Two modals follow: `#bulkActionModal` (title/body injected, Cancel / Continue) and `#makeConsistentWithCentralListModal` ("Are you sure? This action may change some of the columns definition. Are you sure you want to continue?" Cancel / Continue).

**`submit_mult` change handling** (`structure.ts`): the select's `change` event drives everything (there is no Go button):

- `make_consistent_with_central_list` → shows the confirm modal; Continue posts `#tablesForm` serialised (+`ajax_request`+`ajax_page_request`) to `/database/structure/central-columns/make-consistent`.
- `copy_tbl`, `add_prefix_tbl`, `replace_prefix_tbl`, `copy_tbl_change_prefix` → if no checkbox checked, silently returns; else POSTs the form to `/database/structure/copy-form`, `/add-prefix`, `/change-prefix-form`, `/change-prefix-form` respectively, injects returned HTML into `#bulkActionModal` with title `strCopyTablesTo` / `strAddPrefix` / `strReplacePrefix` / `strCopyPrefix`, and Continue submits the inner `#ajax_form`.
- `analyze_tbl`→`/table/maintenance/analyze`, `check_tbl`→`/table/maintenance/check`, `checksum_tbl`→`/table/maintenance/checksum`, `optimize_tbl`→`/table/maintenance/optimize`, `repair_tbl`→`/table/maintenance/repair`, `drop_tbl`→`/database/structure/drop-form`, `empty_tbl`→`/database/structure/empty-form`, `export`→`/export/tables`, `show_create`→`/database/structure/show-create`, `sync_unique_columns_central_list`→`/database/structure/central-columns/add`, `delete_unique_columns_central_list`→`/database/structure/central-columns/remove` — all POSTed via `AJAX.responseHandler` (page content is replaced by the response).
- Any other value → plain submit of `#tablesForm` to `/database/structure`.

**Bulk sub-forms** (server side):

- Every form controller first checks `selected_tbl` is non-empty; otherwise returns `success:false` + "No table selected.".
- *Copy table* (`copy_form.twig` → `CopyTableController`): `Database:` `<select name="target_db">` listing all databases except the current one; radios `what`: `data` "Structure and data" (checked), `structure` "Structure only", `dataonly` "Data only"; checkboxes `drop_if_exists=true` "Add DROP TABLE", `sql_auto_increment=1` "Add AUTO INCREMENT value", `add_constraints=1` "Add constraints" (checked), `adjust_privileges=1` "Adjust privileges" (FAQ 6.39 link). For each selected table: `TableMover::moveCopy(db, t, target_db, t, MoveScope::from(what), MoveMode::SingleTable, drop_if_exists==='true')` then, if `adjust_privileges`, `Operations::adjustPrivilegesCopyTable`. `MoveScope` enum: `structure`, `data`, `dataonly`, `move`. Then re-renders Structure with `Message::success()`.
- *Add prefix* (`add_prefix.twig` → `AddPrefixTableController`): single input `add_prefix`; for each table `ALTER TABLE `t` RENAME `{prefix}{t}``; queries are accumulated in `Current::$sqlQuery`.
- *Replace prefix* (`change_prefix_form.twig`, route `/database/structure/replace-prefix` → `ReplacePrefixController`): inputs `from_prefix` "From", `to_prefix` "To"; for each table, if the name starts with `from_prefix` the new name is `to_prefix + substr(name, len(from))`, else unchanged; `ALTER TABLE `t` RENAME `new``; redirect (302) to `/database/structure?db=` with a flash success message carrying the SQL.
- *Copy table with prefix* (same form, route `/database/structure/copy-table-with-prefix` → `CopyTableWithPrefixController`): new name = `to_prefix + substr(name, len(from_prefix))` (no prefix match check); `moveCopy(db, t, db, new, StructureAndData, SingleTable, drop_if_exists)`.
- *Drop* (`drop_form.twig` → `DropFormController` then `DropTableController`): card "Do you really want to execute the following query?" showing `DROP TABLE `a`, `b`;` and/or `DROP VIEW `v`;` lines, checkbox `fk_checks=1` "Enable foreign key checks" (pre-checked from `ForeignKey::isCheckEnabled()`, hidden `fk_checks=0` fallback), buttons `mult_btn=Yes` (danger) / `mult_btn=No`. On Yes: `ForeignKey::handleDisableCheckInit()`; for each table `RelationCleanup::table()`; builds one `DROP TABLE` statement for tables and one `DROP VIEW` for views; clears `$_SESSION['tmpval']['table_limit_offset*']` (issue #14205); `tryQuery` each; `ResponseRenderer::$reload = true`; errors become `Message::error(getError())`. On No: "No change".
- *Empty* (`empty_form.twig` → `EmptyTableController`): same confirm layout with `TRUNCATE `t`;` per table; views are skipped; `fk_checks` handled; No → flash "No change" + redirect.
- *Show create* (`ShowCreateController`, `show_create.twig`): AJAX returns HTML "Showing create queries" with two cards: **Tables** (Table / Create table columns) and **Views** (View / Create view), each `<pre><code class="sql">SHOW CREATE output</code></pre>` (`Table::showCreate()`).
- *Central columns add/remove/make-consistent*: call `CentralColumns::syncUniqueColumns(db, tables)`, `deleteColumnsFromList(db, tables)`, `makeConsistentWithList(db, tables)` then re-render Structure with the returned `Message` or "Success!".

**Single-row AJAX actions** (`structure.ts`):

- Truncate: confirm dialog text = `strTruncateTableStrongWarning + "Do you really want to execute TRUNCATE `T`"` + foreign-key checkbox loader (`getForeignKeyCheckboxLoader`, populated by `loadForeignKeyCheckbox`); POST to `/sql`; on success the row's `.tbl_rows` is set to `0`, `.tbl_size,.tbl_overhead` to `-`, `adjustTotals()`.
- Drop: question = `strDropTableStrongWarning + "Do you really want to execute DROP TABLE `T`"` (views: just the DROP VIEW question) + FK checkbox; on success row is hidden/removed, `adjustTotals()`, `Navigation.reload()`.
- Favorite star (`modules/navigation/event-loader.ts` ~263): click POSTs the anchor href with `favoriteTables` from `localStorage` (if present). `FavoriteTableController` (AJAX only): decodes `favoriteTables` JSON, key per user `sha1(username)`; `remove_favorite` removes; `add_favorite` adds unless `count === $cfg['NumFavoriteTables']` → `{changes:false, message:"Favorite List is full!"}`. Response `{changes, user, favoriteTables (json), list (navigation HTML), anchor (new star HTML)}`; JS updates `#favoriteTableList`, swaps the anchor via `updateFavoriteTableButton`, and writes `localStorage.favoriteTables`. `RecentFavoriteTables::add` unshifts and trims to the limit, then `REPLACE INTO pma__favorite`. Recent tables (`$cfg['NumRecentTables']` default `10`) are maintained elsewhere (navigation), stored in `pma__recent`.

**Create new table** (`create_table.twig`, `<form id="createTableMinimalForm" action="/table/create" class="card lock-page">`): "Create new table" header (`b_table_add`), `Table name` text (`name=table`, `maxlength=64`, `autocomplete=off`), `Number of columns` number (`name=num_fields`, `min=1`, `value=4`, required), **Create** submit. Hidden on system schemas.

**Config directives:** `MaxTableList=250`, `ShowStats=true`, `PropertiesNumColumns=1`, `NumFavoriteTables=10`, `NumRecentTables=10`, `ShowDbStructureCharset/Comment/Creation/LastUpdate/LastCheck=false`, `MaxExactCount=50000`, `MaxExactCountViews=0`, `SkipLockedTables=false`, `NaturalOrder=true`, `LimitChars=50`, `DisableMultiTableMaintenance=false`, `NavigationTreeTableSeparator='__'`, `TableNavigationLinksMode='icons'`. (`$cfg['HideStructureActions']` default `true` belongs to the *table* Structure page, not this one.)

---

### Server → Databases list & Create database (`/server/databases`)

**Controller.** `Server\DatabasesController`. Params: `statistics` (truthy → stats mode), `pos` (int), `sort_by` (whitelist `SCHEMA_NAME, DEFAULT_COLLATION_NAME, SCHEMA_TABLES, SCHEMA_TABLE_ROWS, SCHEMA_DATA_LENGTH, SCHEMA_INDEX_LENGTH, SCHEMA_LENGTH, SCHEMA_DATA_FREE`; unknown → `SCHEMA_NAME`), `sort_order` (`desc` else `asc`). Data: `$dbi->getDatabasesFull(null, hasStatistics, ConnectionType::User, sortBy, sortOrder, pos, true)` (information_schema query `QueryGenerator::getInformationSchemaDatabasesFullRequest` which, with stats, aggregates `COUNT(t.TABLE_SCHEMA) SCHEMA_TABLES, SUM(TABLE_ROWS), SUM(DATA_LENGTH), SUM(INDEX_LENGTH), SUM(DATA_LENGTH+INDEX_LENGTH) SCHEMA_LENGTH, SUM(DATA_FREE)`); on `DatabasesFullInfoFailure` the message is returned instead. `database_count = count($dbi->getDatabaseList())`. Page size `$cfg['MaxDbList']` (default `100`). Super users have `mysql` selected first.

**Layout** (`server/databases/index.twig`):

- Heading "Databases" or "Databases statistics" (`s_db`).
- **Create database** card (`$cfg['ShowCreateDb']` default `true`): if `userPrivileges->isCreateDatabase`: `<form id="create_database_form" class="ajax" action="/server/databases/create">` with hidden `reload=1`, hidden `statistics=1` when in stats mode, text `new_db` (maxlength 64, placeholder "Database name", prefilled with `databaseToCreate` — the wildcard DB name the user has privileges on), collation `<select name="db_collation">` (first option "Collation", then blank, then optgroups per charset with the server collation preselected), **Create** button. Otherwise red "No privileges to create databases".
- If `database_count > 0`: a toolbar with (when drop allowed = super user OR `$cfg['AllowUserDropDatabase']` default `false`) "Check all" checkbox (`form=dbStatsForm`) + **Drop** button (`submit_mult=Drop`), and a right-aligned Search filter input `#filterText` (client-side via `data-filter-row`).
- List navigator (`get_list_navigator(count, pos, url_params, '/server/databases', 'frame_content', MaxDbList)`).
- `<form class="ajax" id="dbStatsForm" action="/server/databases">` table: columns (drop checkbox) · **Database** (sortable `SCHEMA_NAME`) · **Collation** (sortable `DEFAULT_COLLATION_NAME`) · stats columns when enabled: Tables (number), Rows (number), Data (byte, colspan 2 value+unit), Indexes (byte), Total (byte), Overhead (byte), each sortable with asc/desc icons · **Primary replication** / **Replica replication** (when active; `s_success` Replicated / `s_cancel` Not replicated computed from `Do_DB`/`Ignore_DB`) · **Action** (2 cells): "Check privileges" → `/database/privileges?db=X` (`s_rights`, title `Check privileges for database "X".`), "SQL" → `/database/sql?db=X` (`b_sql`).
  - Row: `tr.db-row[.noclick]` with `data-filter-row=UPPER(name)`; checkbox `selected_dbs[]` disabled for system schemas (`isSystemSchema(name, true)`) and the pmadb; name is a link to `$cfg['DefaultTabDatabase']` route with `db=`; collation `<dfn title=description>`.
  - tfoot: `Total: <span id="filter-rows-count">N</span>`, stats totals.
- When not in stats mode: an info card "Note: Enabling the database statistics here might cause heavy traffic between the web server and the MySQL server." with link **Enable statistics** (`data-post="statistics=1"`).
- If no databases: alert "No databases".
- `#dropDatabaseModal` (Confirm / Cancel / **Drop** danger) when dropping is allowed.

**JS** (`server/databases.ts`): submitting `#dbStatsForm` collects checked `selected_dbs[]`, marks rows `.removeMe`, builds question `strDropDatabaseStrongWarning + "Do you really want to execute DROP DATABASE `a`;<br>DROP DATABASE `b`;"`, shows the modal; Drop → POST `/server/databases/destroy` with the serialised form; on success shows message, decrements `#filter-rows-count`, removes rows, re-sorts tbody by `.name`, refreshes main content if the page emptied, `Navigation.reload()`. No selection → warning `strNoDatabasesSelected` for 2 s.

Creating: `#create_database_form` submit (alerts `strFormEmpty` if empty) POSTs to `/server/databases/create`; on success shows message, increments counter, `Navigation.reload()`, then GETs `data.url` (the DefaultTabDatabase page for the new db) through `AJAX.responseHandler`.

**Server-side SQL:**

- `CreateController` (AJAX only, else `Message::error()`): lower-cases the name when `lower_case_table_names = 1`; `CREATE DATABASE `name`` + ` DEFAULT CHARACTER SET x [COLLATE y]` (`Util::getCharsetQueryPart`) only if the posted collation exists in the server's charset/collation lists; `;`. Failure → `rawError(getError())`, `Current::$database = ''`. Success → message "Database %1$s has been created.", `sql_query` HTML, `url` of the default tab.
- `DestroyController` (AJAX only; requires super user or `AllowUserDropDatabase`): filters out non-strings, system schemas and the pmadb; empty → "No databases selected."; for each: `RelationCleanup::database()`, `DROP DATABASE `x``, `Transformations::clear(db)`; rebuilds the DB list; message "%d database(s) have been dropped successfully.".

`DatabaseController` (`POST /databases`) just returns `{databases: [...]}` (used by pickers).

---

### Operations (`/database/operations`)

**Controller.** `Operations\DatabaseController` (GET/POST). Loads `database/operations.js`. Handles rename/copy on POST (`db_rename` or `db_copy` present) before rendering; handles `comment` POST (`Relation::setDbComment`) ; validates DB; returns empty for system schemas; sets `goto=/database/operations`.

Also shows (once, on top) the notice "The phpMyAdmin configuration storage has been deactivated. Find out why." linking to `/check-relations` (`data-post="db=…"`) when `!relationParameters->hasAllFeatures()` and `$cfg['PmaNoRelation_DisableWarning']` (default `false`) is false; it becomes an **error** if a `pmadb` is configured but broken.

**Layout** (`operations/index.twig`, inside `.container`): heading "Database operations", previous message HTML, then cards:

1. **Database comment** (only when `columnCommentsFeature` configured): `<form id="formDatabaseComment">` text `comment`, **Go**. Server: `Relation::setDbComment(db, comment)` writes to `pma__column_info` with `table_name=''`/`column_name='(db_comment)'`.
2. **Create new table** — same fields as Structure's form (`table`, `num_fields` default 4) → `/table/create`.
3. **Rename database to** (hidden when `db == 'mysql'`): `<form id="rename_db_form" class="ajax">` with hidden `what=data`, `db_rename=true`, `db_collation=<current>` (when known); text `newname` (maxlength 64, prefilled with current name, required); checkbox `adjust_privileges=1` — checked when `has_adjust_privileges` (user has `database && table && column && routines && isReload` privileges), otherwise disabled with title "You don't have sufficient privileges to perform this operation; Please refer to the documentation for more details."; **Go**.
4. **Remove database** (when `isSuperUser() || $cfg['AllowUserDropDatabase']`, and db != `mysql`): link/button `#drop_db_anchor.ajax.text-danger` "Drop the database (DROP)" posting `sql_query=DROP DATABASE `db``, `back=/database/operations`, `goto=/`, `reload=1`, `purge=1`, `message_to_show=Database `db` has been dropped.`; MySQL docu link `DROP_DATABASE`.
5. **Copy database to**: `<form id="copy_db_form" class="ajax">` hidden `db_copy=true`, `db_collation`; text `newname` (prefilled, required); radios `what`: `structure` "Structure only", `data` "Structure and data" (checked), `dataonly` "Data only"; checkboxes: `create_database_before_copying=1` "CREATE DATABASE before copying" (checked), `drop_if_exists=true` "Add DROP TABLE / DROP VIEW", `sql_auto_increment=1` "Add AUTO_INCREMENT value" (checked), `add_constraints=1` "Add constraints" (checked), `adjust_privileges=1` "Adjust privileges" (checked/disabled as above), `switch_to_new=true` "Switch to copied database" (checked if `$_SESSION['pma_switch_to_new']`); **Go** (`name=submit_copy`).
6. **Collation**: `<form id="change_db_charset_form" class="ajax" action="/database/operations/collation">` select `db_collation` (blank option + optgroups per charset, current preselected), checkbox `change_all_tables_collations` "Change all tables collations", checkbox `change_all_tables_columns_collations` "Change all tables columns collations" (its wrapper `#span_change_all_tables_columns_collations` is hidden by JS until the first checkbox is clicked), **Go**.

Note: there is no "Edit or export relational schema" link in the master Operations page; schema export lives entirely in the Designer (see below).

**Rename / copy algorithm** (controller + `src/Operations.php`):

1. `newname` → `DatabaseName::from` (invalid → error message); lower-cased when `lower_case_table_names = 1`. If equal to the current name → error "Cannot copy database to the same name. Change the name and try again.".
2. If renaming (`move`) or `create_database_before_copying`: `createDbBeforeCopy`: `CREATE DATABASE IF NOT EXISTS `new` [DEFAULT CHARACTER SET … COLLATE …];` (collation from posted `db_collation`), then `SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'`, then rebuild DB list.
3. `runProcedureAndFunctionDefinitions`: for each procedure then function (`information_schema.ROUTINES`), `SHOW CREATE PROCEDURE|FUNCTION` in the source db and execute the CREATE in the target db.
4. `getViewsAndCreateSqlViewStandIn`: for each view, if `drop_if_exists === 'true'` and `what !== 'nocopy'` → `DROP VIEW IF EXISTS `new`.`v``; create a stand-in table (`ExportSql::getTableDefStandIn`) in the target so dependent views can be created later.
5. `copyTables`: for each non-view table: MERGE tables downgrade `data→structure`, `dataonly→nocopy` (skipped); fetch triggers; `TableMover::moveCopy(db, t, new, t, move ? Move : MoveScope::from(what), MoveMode::WholeDatabase, drop_if_exists)`; stop at first failure; re-create triggers in target (`Trigger::getCreateSql('')`); if `add_constraints` posted, accumulate `TableMover::sqlConstraintsQuery` per table.
6. `handleTheViews`: `moveCopy(..., move ? Move : StructureOnly, WholeDatabase, true)` for each view (drop-if-exists forced to replace the stand-in).
7. `createAllAccumulatedConstraints`: run the collected `ALTER TABLE … ADD CONSTRAINT` statements in the target.
8. MySQL ≥ 5.1: `runEventDefinitionsForDb`: `SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA='db'` → `SHOW CREATE EVENT` → execute in target.
9. `duplicateBookmarks`: copies `pma__bookmark` rows (`user,label,query`) with `dbase=new`.
10. Move: if `adjust_privileges` → `adjustPrivilegesMoveDb`: in `mysql` db, `UPDATE db|tables_priv|columns_priv|procs_priv SET Db='new' WHERE Db='old'` (underscores escaped as `\_`), then `FLUSH PRIVILEGES`; `RelationCleanup::database(old)`; `DROP DATABASE `old`;`; message "Database %1$s has been renamed to %2$s."; `Current::$database = new`.
11. Copy: if `adjust_privileges` → `adjustPrivilegesCopyDb`: `SELECT * FROM mysql.db|tables_priv|columns_priv|procs_priv WHERE Db="old"` and `INSERT … VALUES(...)` duplicates with the new name, `FLUSH PRIVILEGES`; message "Database %1$s has been copied to %2$s."; if `switch_to_new === 'true'` set `$_SESSION['pma_switch_to_new']=true` and switch `Current::$database`.
12. `ResponseRenderer::$reload = true`. AJAX JSON: `message`, `newname`, `sql_query` (all accumulated statements rendered), `db`.

**JS** (`operations.ts`): rename submit → empty check (`strFormEmpty`), same-name check (`strDatabaseRenameToSameName`), confirm dialog `CREATE DATABASE new / DROP DATABASE old`, POST with `is_js_confirmed=1`, then `Navigation.update(db=newname)` and `Navigation.reload` with a simulated click on the new db node. Copy submit → `strCopyingDatabase`, POST; if "Switch to copied database" checked → update navigation db and `refreshMainContent(false)`, else keep current db; `Navigation.reload()`. Collation submit → `strChangingCharset`, POST, shows message. Drop anchor → `strDropDatabaseStrongWarning + "Do you really want to execute DROP DATABASE `db`"` confirm; on success `Navigation.reload()`, db set to '', `refreshMainContent('/server/databases')`.

**Collation controller** (`/database/operations/collation`, AJAX only): empty collation → "No collation provided."; `ALTER DATABASE `db` DEFAULT CHARACTER SET cs [COLLATE col]`; if `change_all_tables_collations === 'on'`: for each non-view table `ALTER TABLE `db`.`t` DEFAULT CHARACTER SET … [COLLATE …]` and, if `change_all_tables_columns_collations === 'on'`, `Operations::changeAllColumnsCollation` → `ALTER TABLE `t` CONVERT TO CHARACTER SET cs [COLLATE col]` (views skipped — issue #15283).

**Config:** `AllowUserDropDatabase=false`, `PmaNoRelation_DisableWarning=false`.

---

### Search (`/database/search`)

**Controller.** `SearchController`. Scripts `database/search.js`, `sql.js`, `makegrid.js`. Disabled when `$cfg['UseDbSearch']` (default `true`) is false → error "Searching inside the database is disabled by the [code]$cfg['UseDbSearch'][/code] configuration." (AJAX JSON or `error/simple` page with back URL to the DefaultTabDatabase). On `submit_search` the results HTML is prepended; for AJAX requests without `ajax_page_request` only the results are returned; otherwise the form is rendered.

**Form** (`search/main.twig`, `<form id="db_search_form" class="card ajax lock-page">`):

- `Words or values to search for (wildcard: "%"):` text `criteriaSearchString`.
- fieldset **Find:** radios `criteriaSearchType`: `1` "at least one of the words" (hint: Words are separated by a space character), `2` "all of the words" (same hint), `3` "the exact phrase as substring", `4` "the exact phrase as whole field", `5` "as regular expression" (MySQL `Regexp` docu). Default checked = 1.
- legend **Options:** hidden `criteriaSearchOptionIncludeHex=0` + checkbox value `1` "include hex matches" (docu `function_hex`).
- fieldset **Inside tables:** buttons `#select_all` "Select all" / `#unselect_all` "Unselect all" (`setSelectOptions('db_search','criteriaTables[]', bool)`), `<select id="criteriaTables" name="criteriaTables[]" multiple>` of all tables; all selected by default (or previous selection).
- `Inside column:` text `criteriaColumnName`.
- footer **Search** (`#buttonGo`, `name=submit_search`).
- Below: `#togglesearchformdiv > button#togglesearchformlink`, `#searchresults`, `#togglesearchresultsdiv > button#togglesearchresultlink`, `#table-info` (`s_tbl` icon + `#table-link`), `#browse-results`, `#sqlqueryform`, `button#togglequerybox` — all initially hidden and shown by JS.

**Server** (`Database\Search`): `setSearchParams` validates the type against 1..5, intersects `criteriaTables` with real table names. `getWhereClause(table)`: `LIKE` for types 1–4, `REGEXP` for 5; automatic `%` wildcard only for types < 4; words = `explode(' ', string)` for types 1–2, the whole string for 3–5; empty words skipped. Per word, per column (restricted to `criteriaColumnName` if given): `CONVERT(`col` USING utf8) LIKE|REGEXP 'word'` and, with hex option, `HEX(`col`) LIKE|REGEXP '…'`, OR-joined. Word clauses are joined with ` OR ` for type 1, ` AND ` otherwise: `WHERE (…) AND (…)`. If no clause (e.g. column doesn't exist) → `WHERE FALSE`. Three statements per table: `SELECT * FROM `db`.`t` WHERE…`, `SELECT COUNT(*) AS `count` FROM …`, `DELETE FROM …`. `getSearchResults` runs the COUNT per selected table.

**Results** (`search/results.twig`): caption `Search results for "<em>string</em>" {type description}:`; one row per table: "N match(es) in **table**", and when N > 0 two buttons: **Browse** (`.browse_results`, `data-href=/sql?db&table&goto=/database/sql&pos=0&is_js_confirmed=0`, `data-browse-sql=<select>`) and **Delete** (`.delete_results`, `data-delete-sql=<delete>`). If more than one table searched: "**Total:** *N* match(es)".

**JS** (`search.ts`): submit → if no table selected show `strNoTableSelected`; POST serialised form + `submit_search`; on success inject results, show "Hide search results" toggle, slide the form up and show "Show search criteria" toggle; on error show `data.error` in `#searchresults`. Browse → POSTs `sql_query` (with `ajax_request`, `is_js_confirmed`) to the `/sql` href + `#searchresults`, shows table name link, injects grid (`makeGrid` on `.table_results`), highlights SQL, scrolls to results. Delete → `confirm(sprintf(strConfirmDeleteResults, table))`; POST the DELETE; shows the executed query box in `#sqlqueryform`, re-triggers the search (`#buttonGo` click) so counts refresh, shows "Hide query box" toggle. Clicking Search hides previous browse/delete panes.

---

### Query — multi-table query builder (`/database/multi-table-query`)

Note on history: the classic Query-by-example page (`/database/qbe`, `PhpMyAdmin\Database\Qbe` with column/alias/show/sort/criteria rows, Ins/Del, automatic joins and saved searches in `pma__savedsearches`) is **not present in master**; only the pmadb table, the `SavedQueryByExampleSearchesFeature` value object and the check-relations row remain, and `designer/main.twig` still posts the visual-builder query to `/database/qbe` (a dead route; see Designer). The live "Query" tab is the newer multi-table UI documented here.

**Controller.** `MultiTableQueryController` (GET): scripts `database/multi_table_query.js`, `database/query_generator.js`; `MultiTableQuery::getColumnsInTables(db)` runs `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns WHERE table_schema = 'db'` and groups columns per table with `hash = md5(table)`; renders the form with `default_no_of_columns = 3`.

**Form** (`multi_table_query/form.twig`):

- Collapse toggle button "Query window" controlling `#queryWindow` (open by default).
- Hidden `#db_name`. Per table a hidden `<div id={hash}>` holding `<option value="*">*</option>` + one option per column (used as a template for column selects).
- A row of **column cards** (ids 0..3; card 0 is the hidden `#new_column_layout` template, so three visible cards initially). Each card (`fieldset`):
  - `<select class="tableNameSelect">` ("select table" + every table with `data-hash`), a literal `.`, `<select class="columnNameSelect">` ("select column", filled on table change).
  - checkbox `.show_col` (checked) "Show".
  - text `.table_alias` placeholder "Table alias", text `.col_alias` placeholder "Column alias".
  - checkbox `.criteria_col` (title "Use this column in criteria") + button "criteria" (`.jsCriteriaButton`, Bootstrap collapse of `#criteriaOptions{id}`).
  - Collapsible criteria table: row **Sort** radios `sort[id]` Ascending/Descending (present in markup; not read by the query generator); row **Add as** radios `logical_op[id]` AND (checked) / OR (row hidden until more than one criteria column is checked); row **Column** `<select class="columnNameSelect opColumn">` (column list minus `*`); row **Op** `<select class="criteria_op">` with `=, >, >=, <, <=, !=, LIKE, LIKE %...%, NOT LIKE, NOT LIKE %...%, IN (...), NOT IN (...), BETWEEN, NOT BETWEEN, IS NULL, IS NOT NULL, REGEXP, REGEXP ^...$, NOT REGEXP` and `<select class="criteria_rhs">` Text / Another column; row `.rhs_table` (hidden) with a second table select + column select; row `.rhs_text` with `<input class="rhs_text_val" placeholder="Enter criteria as free text">`.
  - `×` close button `.jsRemoveColumn` ("Remove this column").
- Button **+ Add column** (`#add_column_button`) clones the template card (incrementing `columnCount`, unique collapse ids `criteriaOptionsExtraN`).
- `<textarea id="MultiSqlquery" name="sql_query">` upgraded to a CodeMirror editor (`getSqlEditor`).
- Footer: **Update query** (`#update_query_button`), **Copy query** (`#copy_query`, disabled while the editor is empty; copies via `copyToClipboard` and shows a notification), **Submit query** (`#submit_query`).
- `#sql_results` container.

**JS behaviours** (`multi_table_query.ts`, `query_generator.ts`):

- Table select change: fills sibling column selects from the hashed template; `.opColumn` selects drop the `*` option; column alias disabled until a column is chosen; choosing `*` clears and disables the column alias.
- `criteria_op` change: `IS NULL`/`IS NOT NULL` hide the value input and the Text/Another-column select; `IN (...)`/`NOT IN (...)` swap in a multi-value widget (`.options.multi` with "Enter an option" inputs, `+` add / `−` remove buttons, de-duplicated); `BETWEEN`/`NOT BETWEEN` swap in two inputs (`strFirstValuePlaceholder`, `strSecondValuePlaceholder`); other ops restore a single free-text input.
- `criteria_rhs` change toggles `.rhs_text` vs `.rhs_table` rows.
- Checking `.criteria_col` expands the criteria collapse (and vice-versa via the button); once >1 criteria columns are checked the "Add as" AND/OR row is displayed.
- **Update query**: collects every card whose table is set and `Show` is checked → `[tableOrAlias, column, columnAlias]`; builds a map `tableAliases[table] = [alias…]`; if none → error "Nothing selected". Synchronously GETs `/database/multi-table-query/tables?db&tables[]=…` → `TablesController` returns `foreignKeyConstrains` from `information_schema.key_column_usage WHERE referenced_table_name IS NOT NULL AND TABLE_SCHEMA='db' AND TABLE_NAME IN (…) AND REFERENCED_TABLE_NAME IN (…)`. Query text: `SELECT `t`.`c` [AS `alias`], …` (`*` unquoted) + `\nFROM ` + `generateFromBlock`: first table plain (`AS alias` if any); each further table joins via the first matching FK between it and an already-used table as `\n\tLEFT JOIN `t` [AS `a`] ON `x`.`col` = `y`.`refcol``, otherwise appended as `\n\t, `t` [AS a]`. If any `.criteria_col` is checked, `\nWHERE ` + `generateWhereBlock`: conditions joined by the chosen `logical_op`, each `generateCondition`: `` `tableOrAlias`.`opColumn` `` then, for Text RHS, the op's format (`= 'v'`, `LIKE '%v%'`, `IN ('a','b')` — values single-quote escaped, `BETWEEN 'a' AND 'b'`, `REGEXP '^v$'`, bare `IS NULL`, …), or for "Another column" `` op `otherTable`.`otherCol` ``. Ends with `;` and is written into the editor.
- **Submit query**: empty → `strEmptyQuery`; POST `{db, sql_query}` to `/database/multi-table-query/query` → `QueryController` runs `ParseAnalyze::sqlQuery` and `Sql::executeQueryAndSendQueryResponse(...)` with `goto=/database/multi-table-query`; the returned results HTML is injected into `#sql_results` with pagination/sort/ajax links neutralised (click handlers prevented), and the criteria area is collapsed (`#slide-handle` click).

---

### Privileges (`/database/privileges`)

**Controller.** `Database\PrivilegesController` (GET). Validates `db` (lower-cased when `lower_case_table_names=1`). Scripts `server/privileges.js`, `vendor/zxcvbn-ts.js`. If not super user and neither GRANT nor CREATE USER → sub-page header + error "No Privileges". If not grant/create user → notice "You do not have the privileges to administrate the users!". Super users get `Privileges::getAllPrivileges(db)` (global, database-specific/wildcard and routine privileges for every account touching this DB). Also renders `export_modal`.

**Layout** (`privileges/index.twig`):

- Super user: heading `b_usrcheck` "Users having access to "<a href=DefaultTabDatabase?db>db</a>"" and `<form id="usersForm" action="/server/privileges" class="card">` with table columns: checkbox · User name · Host name · Type · Privileges · Grant · Action (2). One row per account; when an account has several privilege entries the first three cells `rowspan`. Type cell: `global`, `database-specific` (when the entry's database equals the current db with `_`/`%` escaped) or `wildcard: <code>pattern</code>`, or `routine`. Privileges `<code>` list (routine rows: `routine_name (PRIVS)`). Grant Yes/No. Action: **Edit privileges** (`.edit_user_anchor` → `/server/privileges?username&hostname&dbname=(priv db or current db)&tablename=&routinename=`, only for grant users) and **Export** (`.export_user_anchor.ajax` → `/server/privileges?username&hostname&export=1&initial=`). Empty: "No user found.". Footer: "Check all" + "With selected: Export" (`submit_mult=export`). Username empty → red "Any".
- Non-super user: error "Not enough privilege to view users.".
- Create users: button **Add user account** (`#add_user_anchor` → `/server/privileges?adduser=1&dbname=db`), which opens the server Add-user form with the "Database for user account" section pre-set to grant on this database. Details of that editor belong to the Server privileges document.

---

### Routines (`/database/routines`)

**Controller.** `RoutinesController` (GET/POST). Scripts `database/routines.js`, `sql.js`. Optional `type` (`PROCEDURE`/`FUNCTION`) filter; works at DB level or (when `table` is given and exists) table context (passes `table` through URLs). Dispatch order: editor submit (`editor_process_add`/`editor_process_edit`) → editor display (`add_item`, `edit_item`, or no-JS buttons `routine_addparameter`, `routine_removeparameter`, `routine_changetype`) → `execute_routine` POST → `execute_dialog` GET → `export_item` GET → list.

**List** (`routines/index.twig`): heading `b_routines` Routines + docu `STORED_ROUTINES`. Toolbar: when there are routines, "Check all" + **Export** (`#bulkActionExportButton`) + **Drop** (`#bulkActionDropButton`) and a Search filter input; always a **Create new routine** button (`a.ajax.add_anchor`, `/database/routines?db&table&add_item=1`, disabled unless `currentUserHasPrivilege('CREATE ROUTINE')`). Pagination: `$cfg['MaxRoutineList']` (default `250`) via `getListNavigator` above and below the table; count via `information_schema.ROUTINES`; if `pos >= total` → redirect to last page. Table `#routinesTable` columns: checkbox (`item_name[]`), **Name** (with hidden `span.drop_sql` = `DROP PROCEDURE|FUNCTION IF EXISTS `name``), **Type**, **Returns** (`DTD_IDENTIFIER`), then Edit / Execute / Export / Drop icons. `#nothing2display` notice "There are no routines to display." when empty. Three modals: `#routinesEditorModal` ("Routine editor", Close / **Save changes**), `#routinesExportModal` ("Export routine", Close), `#routinesExecuteModal` ("Execute routine", Close / **Execute**).

Per-row privileges (`Routines::getRow`): edit & export require (`CREATE ROUTINE` on db AND current user is definer) OR super user; execute requires `EXECUTE` on db OR being the definer; otherwise greyed icons (`bd_*`). Edit → `edit_item=1&item_name&item_type`; Execute → `execute_dialog=1&…`; Export → `export_item=1&…`; Drop → `link_or_button('/sql', {sql_query: DROP … IF EXISTS …, goto: /database/routines?db})` with class `ajax drop_anchor`. The query for the list: `SELECT SPECIFIC_NAME AS Name, ROUTINE_TYPE AS Type, DEFINER AS Definer, DTD_IDENTIFIER FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = 'db' [AND ROUTINE_TYPE='…'] ORDER BY SPECIFIC_NAME [LIMIT n OFFSET m]`.

**Editor** (`routines/editor_form.twig`, `form.rte_form`): hidden `add_item=1`/`edit_item=1`, in edit mode `item_original_name`, `item_original_type`. Card "Details" (+ docu `CREATE_PROCEDURE` when adding):

- **Routine name** text `item_name` (maxlength 64).
- **Type** `<select name="item_type">` PROCEDURE / FUNCTION (AJAX); no-JS fallback shows the type + button "Change to FUNCTION/PROCEDURE" (`routine_changetype`).
- **Parameters** grid (`routine_params_table`): header cells drag handle · **Direction** (hidden for functions, class `routine_direction_cell`) · **Name** · **Type** · **Length/Values** · **Options** (2 cells) · remove. Each row (`parameter_row.twig`, indices `item_param_*[i]`): drag handle (`ui-icon-arrowthick-2-n-s`, rows are sortable), `<select item_param_dir>` IN/OUT/INOUT, text `item_param_name`, `<select item_param_type>` (all supported datatypes, grouped), text `item_param_length` with an "ENUM/SET editor" pencil (`.open_enum_editor`), a hidden `no_len` `---` cell, `<select item_param_opts_text>` charset list ("Charset" placeholder), hidden `no_opts` cell, `<select item_param_opts_num>` `UNSIGNED` / `ZEROFILL` / `UNSIGNED ZEROFILL`, and a drop anchor (`routine_param_remove_anchor`, hidden in the template row).
- **Add parameter** button (`#addRoutineParameterButton`; no-JS: submit buttons "Add parameter" / "Remove last parameter").
- Function-only rows (`routine_return_row`, hidden for procedures): **Return type** select `item_returntype`, **Return length/values** text `item_returnlength`, **Return options**: charset select `item_returnopts_text` + numeric select `item_returnopts_num`.
- **Definition** textarea `item_definition` (15 rows) + **Format** button (`#format`, SQL formatter).
- **Is deterministic** checkbox `item_isdeterministic`.
- Edit mode only: **Adjust privileges** checkbox `item_adjust_privileges=1` (checked when user has routines + reload privilege, else disabled with explanation; FAQ 6.39).
- **Definer** text `item_definer`; **Security type** select `item_securitytype` DEFINER/INVOKER; **SQL data access** select `item_sqldataaccess` `CONTAINS SQL`, `NO SQL`, `READS SQL DATA`, `MODIFIES SQL DATA`; **Comment** text `item_comment`.
- AJAX: hidden `editor_process_add|edit=true`, `ajax_request=true`; else footer **Go**.

Client validation (`routines.ts::validateCustom` etc.): name and definition required (`strFormEmpty`); every parameter needs name and type; `ENUM`/`SET`/`VAR*` parameters and function return types require length/values; a FUNCTION definition must contain `RETURN` (`MissingReturn`). `setOptionsForParameter` enables the charset select only for character types, the numeric select only for numeric types, and hides the length input for types that don't take one (shows the `---` placeholders). Changing `item_type` toggles the return rows and the direction cells. Removing a parameter re-indexes `item_param_*[i]` names (`reindexParameters`). Editor loads via AJAX into the modal (`data.message`, title from the clicked anchor's title/text); `paramTemplate` (a row with `%s` index) is returned alongside.

**Server-side create/edit** (`Routines::getQueryFromRequest`, `handleRequestCreateOrEdit`): builds `CREATE [DEFINER=`u`@`h` ]PROCEDURE|FUNCTION `name`(params) [RETURNS type[(len)] [CHARSET cs] [UNSIGNED…]] [COMMENT '…'] DETERMINISTIC|NOT DETERMINISTIC [sql data access] [SQL SECURITY DEFINER|INVOKER] definition`. Parameters: `DIR `name` TYPE[(len)][ CHARSET cs][ UNSIGNED…]` (direction only for procedures; `CHARSET` only for char types except BINARY/VARBINARY; numeric options only for numeric types). Validation errors collected: definer must be `username@hostname`; invalid routine type; missing name; "You must provide a name and a type for each routine parameter."; invalid direction; "You must provide length/values for routine parameters of type ENUM, SET, VARCHAR and VARBINARY."; valid return type; "You must provide a routine definition.". Length is appended unless type matches `DATE|TINYBLOB|TINYTEXT|BLOB|TEXT|MEDIUMBLOB|MEDIUMTEXT|LONGBLOB|LONGTEXT|SERIAL|BOOLEAN` (return type also excludes DATETIME/TIME). Edit: backs up the original with `SHOW CREATE`, optionally backs up `mysql.procs_priv` rows (`backupPrivileges`), `DROP <type> `orig`;`, runs the new CREATE; on failure re-runs the backup CREATE ("Sorry, we failed to restore the dropped routine." if that fails too); then re-inserts `procs_priv` rows with the new name/type and `FLUSH PRIVILEGES` → "Routine %1$s has been modified. Privileges have been adjusted." else "Routine %1$s has been modified.". Add: "Routine %1$s has been created.". Errors are listed under "One or more errors have occurred while processing your request:". AJAX success returns `name`, `new_row` (rendered row), `insert:true`, `message`, `tableType:'routines'` so the JS inserts/replaces the row.

**Execute** (`execute_form.twig` + `Routines::getExecuteForm/handleExecuteRoutine`): dialog "Execute routine `name`" (card "Routine parameters") with a table Name · Type · [Function — only when `$cfg['ShowFunctionFields']` default `true`] · Value; OUT parameters are omitted; IN/INOUT params get a text input `params[name]` (class `datefield`/`datetimefield` for DATE/DATETIME/TIMESTAMP → datepicker), ENUM → radios, SET → checkboxes (`params[name][]`), optional `funcs[name]` select of MySQL functions (not for ENUM/SET). Empty parameter list → "This routine does not require any parameters.". Server: for each param `SET @pN = 'value';` (or `SET @pN = FUNC('value');` when a valid function chosen; SET arrays imploded with commas); procedure → `CALL `name`(@p0, @p1…);` plus `SELECT @p1 AS `outname`, …;` for OUT/INOUT; function → `SELECT `name`(@p0…) AS `name`;`. Results: each non-empty result set rendered as a table (`NULL` in italics), the pretty-printed queries, a card "Execution results of routine `name`", message "Your SQL query has been executed successfully." plus for procedures "%d row(s) affected by the last statement inside the procedure."; no result sets → notice "MySQL returned an empty result set (i.e. zero rows).". Errors → "The following query has failed: … MySQL said: …". Executing a routine with no parameters still goes through the dialog (JS opens the modal and the Execute button posts).

**Export**: `export_item` → `SHOW CREATE FUNCTION|PROCEDURE `db`.`name`` wrapped as `DELIMITER $$\n…$$\nDELIMITER ;` in a modal textarea titled "Export of routine `name`". Missing/forbidden → error "…No routine with name … found in database … You might be lacking the necessary privileges to view/export this routine.". Bulk Export concatenates each selected row's export (sequential GETs); none exportable → `NoExportable`.

**Drop**: single → confirm with the row's `drop_sql` text, POST to `/sql`, remove row (hide table and show `#nothing2display` when it was the last), `slidingMessage(sql_query)`, `Navigation.reload()`. Bulk → confirm `strDropRTEitems`, sequential posts per selected row.

---

### Events (`/events`, `/events/export`)

**Controllers.** `Events\IndexController` (`/events`, GET/POST) and `Events\ExportController` (`/events/export`, GET, `item_name`). Scripts `events.js`, `sql.js`. A missing or unknown `db` answers "No database selected." (redirect to `/` outside AJAX). Index dispatch: editor submit → editor display (`add_item`/`edit_item`/`item_changetype`) → list. With the event scheduler `DISABLED` (server started with `--event-scheduler=DISABLED`) neither the editor nor the export does anything and the page shows only the heading and the notice "The event scheduler is disabled." (avoids the server error 1577).

**List** (`events/index.twig`): heading `b_events` Events + docu `EVENTS`. Toolbar: Check all + Export + Drop (when any), **Create new event** (`add_item=1`, disabled unless `EVENT` privilege). Table `#eventsTable`: checkbox · **Name** (hidden `drop_sql` = `DROP EVENT IF EXISTS `name``) · **Status** · **Type** · Edit / Export / Drop. Rows sorted by name (`array_multisort`). Source query: `information_schema.EVENTS` (or `SHOW EVENTS FROM `db`` when `DisableIS`). Empty → "There are no events to display.".

**Event scheduler status** card: a toggle switch (`.toggleAjax` "Click to toggle") with ON/OFF; ON posts `sql_query=SET GLOBAL event_scheduler="ON"` to `/sql` (goto `/events?db`), OFF posts `SET GLOBAL event_scheduler="OFF"`; state from `SHOW GLOBAL VARIABLES LIKE 'event_scheduler'` (`Events::getEventSchedulerStatus`: `DISABLED`, else `ON` or `1` → `ON`, else `OFF`); the switch shows on only for `ON`. Callback `window.pmaSlidingMessage(data.sql_query)`.

Modals: `#eventsEditorModal` ("Event editor", Close / Save changes), `#eventsExportModal` ("Export event").

**Editor** (`events/editor_form.twig`): hidden `add_item`/`edit_item`, `item_original_name` in edit. Rows: **Event name** text `item_name` (maxlength 64); **Status** select `item_status` `ENABLED` / `DISABLED` / `SLAVESIDE_DISABLED`; **Event type** select `item_type` `RECURRING` / `ONE TIME` (no-JS: "Change to …" button `item_changetype`); **Execute at** text `item_execute_at` (`datetimefield`, row `onetime_event_row` shown for ONE TIME); **Execute every** text `item_interval_value` + select `item_interval_field` `YEAR, QUARTER, MONTH, DAY, HOUR, MINUTE, WEEK, SECOND, YEAR_MONTH, DAY_HOUR, DAY_MINUTE, DAY_SECOND, HOUR_MINUTE, HOUR_SECOND, MINUTE_SECOND` (row `recurring_event_row`); **Start** `item_starts` (datetime); **End** `item_ends` (datetime); **Definition** textarea `item_definition` + **Format**; **On completion preserve** checkbox `item_preserve`; **Definer** text; **Comment** text (maxlength 64). Changing `item_type` toggles the recurring/one-time rows (`events.ts`). Datetime inputs get the datepicker on modal show.

**Server** (`Events::getQueryFromRequest`): `CREATE [DEFINER=`u`@`h` ]EVENT `name` ON SCHEDULE ` + (`RECURRING`: `EVERY <int> <FIELD> [STARTS '…'] [ENDS '…']` — "You must provide a valid interval value for the event." when the value is empty or the field not one of the 15 units; `0` is accepted and left to the server; `ONE TIME`: `AT '…'` — "You must provide a valid execution time for the event.") + `ON COMPLETION [NOT ]PRESERVE ` + status mapped `ENABLED→ENABLE`, `DISABLED→DISABLE`, `SLAVESIDE_DISABLED→DISABLE ON SLAVE` + `[COMMENT '…'] DO <definition>`. Errors: definer format, "You must provide an event name!", "You must provide a valid type for the event.", "You must provide an event definition.". Edit: backup via `SHOW CREATE EVENT`, `DROP EVENT IF EXISTS `orig`;`, CREATE, restore on failure ("Sorry, we failed to restore the dropped event."). Messages "Event %1$s has been created." / "Event %1$s has been modified.". After a successful AJAX create, if the event is immediately gone (one-time event already executed and not preserved) → `success:false` "The event was dropped immediately after creation.". Export: `SHOW CREATE EVENT` text in modal "Export of event `name`" (plain, no DELIMITER wrapper). Drop/bulk drop identical to routines (`strDropRTEitems`).

---

### Triggers at database level (`/triggers` without `table`)

`Triggers\IndexController` serves both scopes. At DB level `Current::$table = ''` and `Triggers::getDetails(dbi, db, '')` lists every trigger in the database. `triggers/list.twig`: heading `b_triggers` Triggers + docu; toolbar Check all / Export / Drop + **Create new trigger** (`add_item=1`, disabled without `TRIGGER` privilege); table `#triggersTable` columns: checkbox · **Name** (hidden `drop_sql` = `DROP TRIGGER IF EXISTS …`) · **Table** (only at DB level — a link to `/triggers?db&table=T` i.e. the table-scoped list) · **Time** (BEFORE/AFTER) · **Event** (INSERT/UPDATE/DELETE) · Edit / Export / Drop. Empty → "There are no triggers to display.". The editor (`triggers/editor_form.twig`: name, table select, time, event, definition, definer) and export (`DELIMITER $$` + create SQL) are shared with the table-level doc. At DB level a newly created trigger row is inserted (`insert = true` when `table === ''`).

---

### Tracking at database level (`/database/tracking`)

**Controller.** `Database\TrackingController`. Scripts `vendor/jquery/jquery.tablesorter.js`, `database/tracking.js`. Validates db. Sets `goto=/table/tracking`, `back=/database/tracking`. POST handlers, in order:

- `delete_tracking` + `table` → `Tracking::deleteTracking(db, table)` (`/*NOTRACK*/ DELETE FROM pmadb.tracking WHERE db_name=… AND table_name=…`) → "Tracking data deleted successfully.".
- `submit_create_version` → `createTrackingForMultipleTables(db, selected[], version)`: for each table `Tracker::createVersion(db, table, version, trackingSet, isView)`; message "Version %1$s was created for selected tables, tracking is active for them.".
- `submit_mult=delete_tracking` with `selected_tbl[]` → delete each; `submit_mult=track` → renders `create_tracking_version.twig` (route `/database/tracking`, `last_version=0`, `type='both'`, `default_statements=$cfg['Servers'][$i]['tracking_default_statements']`) and returns; no selection → notice "No tables selected.".

Then: `getTrackedData(db, '', '1')` for the database-level log; if no tables and no log → "No tables found in database." + create-table form. Otherwise `getHtmlForDbTrackingTables` and, if a database-level DDL log exists, a "Database Log" message box listing `# date user\nstatement` lines.

**`getHtmlForDbTrackingTables`** queries `SELECT table_name, MAX(version) FROM pmadb.tracking WHERE db_name=… GROUP BY table_name ORDER BY table_name` then `SELECT * … WHERE db_name AND table_name AND version` per table (control connection). Untracked = `TrackingChecker::getUntrackedTableNames` (all tables minus those with a tracking row — "Deactivated tracked tables are not included").

**Layout** (`tracking/tables.twig`):

- **Tracked tables** (`#tracked_tables`, when any): `<form id="trackedForm" class="ajax">` table `#versions`: checkbox (`selected_tbl[]`) · **Table** · **Last version** · **Created** · **Updated** · **Status** (toggle switch "active"/"not active" posting to `/table/tracking?db&table&version&toggle_activation=activate_now|deactivate_now`) · **Action** (`a.delete_tracking_anchor.ajax` "Delete tracking" → `delete_tracking=1&table`) · **Show** (three links to `/table/tracking`: **Versions** `b_versions`, **Tracking report** `b_report` with `report=1&version`, **Structure snapshot** `b_props` with `snapshot=1&version`). Footer: `select_all.twig` (Check all / Uncheck all) + button **Delete tracking** (`submit_mult=delete_tracking`). Sorted client-side with tablesorter (default by Table ascending; checkbox/status/action/show columns not sortable; version as integer).
- **Untracked tables** (when any): `<form id="untrackedForm" class="ajax">` table `#noversions`: checkbox · **Table** · **Action** (`eye` "Track table" → `/table/tracking?db&table`). Footer: Check all / Uncheck all + **Track table** button (`submit_mult=track`).

**Create version form** (`create_tracking_version.twig`): card "Create version 1 of db.table" (single) or "Create version 1"; hidden `version=1`, hidden `selected[]`; "Track these data definition statements:" checkboxes `alter_table`, `rename_table`, `create_table`, `drop_table`, `alter_view`, `create_view`, `drop_view`, `create_index`, `drop_index`; "Track these data manipulation statements:" `insert`, `update`, `delete`, `truncate` — each pre-checked when its statement appears in `tracking_default_statements` (default `CREATE TABLE,ALTER TABLE,DROP TABLE,RENAME TABLE,CREATE INDEX,DROP INDEX,INSERT,UPDATE,DELETE,TRUNCATE,REPLACE,CREATE VIEW,ALTER VIEW,DROP VIEW,CREATE DATABASE,ALTER DATABASE,DROP DATABASE`); **Create version** submit (`submit_create_version=1`). `Tracking::getTrackingSet()` turns checked boxes into the `tracking` SET value.

**JS** (`tracking.ts`): delete-tracking buttons confirm with `strDeleteTrackingDataMultiple` / `strDeleteTrackingData`, then POST with `ajax_page_request` through `AJAX.responseHandler`; Track submits directly.

**Config:** `Tracker::isActive()` requires the `tracking` pmadb table; `$cfg['Servers'][$i]['tracking_version_auto_create']` (default `false`), `tracking_default_statements` (above), `tracking_add_drop_view/table/database` (default `true`).

---

### Designer (`/database/designer`)

**Purpose.** Canvas-based ER view of the database: draggable table boxes, relation lines (FK and internal), relation creation/deletion by clicking columns, display-field selection, named "pages" persisting positions, schema export (PDF/SVG/DIA/EPS), and a "visual query builder" mode.

**Controller** (`DesignerController`, GET/POST). Three request kinds:

1. `dialog=` POST (AJAX HTML fragments): `edit` → `edit_delete_pages.twig` (operation `editPage`, label "Page to open:"), `delete` → same with `deletePage` ("Page to delete:"), `save_as` → `page_save_as.twig`, `export` → `schema_export.twig` (`Designer::getHtmlForSchemaExport(db, selected_page, format, export_type)`), `add_table` → renders `database_tables.twig` for a single `db.table` (used by "Add tables from other databases").
2. `operation=` POST (AJAX JSON): `deletePage` (`Common::deletePage(selected_page)` → `DELETE FROM table_coords WHERE pdf_page_number=…; DELETE FROM pdf_pages WHERE page_nr=…`), `savePage` (`save_page=same` → existing `selected_page`; else if `getPageExists(selected_value)` → error "There already exists a page named "%s" please rename it to something else."; else `createNewPage` → `INSERT INTO pdf_pages (db_name, page_descr) VALUES (db, name|'no description')`, returns `id`; then `saveTablePositions(page)`: `DELETE FROM table_coords WHERE pdf_page_number=…` and for each posted `t_h[k]` truthy `INSERT INTO table_coords (db_name, table_name, pdf_page_number, x, y) VALUES (t_db[k], t_tbl[k], page, t_x[k], t_y[k])`), `setDisplayField` (`Table::updateDisplayField` → DELETE then INSERT into `pma__table_info`; error if display feature missing: "phpMyAdmin configuration storage is not configured for "Display Features"."), `addNewRelation` (T1/F1 referenced, T2/F2 referencing, `on_delete`, `on_update`, DB1, DB2), `removeRelation`, `save_setting_value` (`index`, `value` → `pma__designer_settings` JSON upsert: `SELECT settings_data WHERE username=…`, then `UPDATE … SET settings_data=json` or `INSERT (username, settings_data)`).
3. Page GET: requires db. `visualBuilderMode = ?query` present. Page to display: query mode → `getDefaultPage(db)` (page whose `page_descr` equals the db name, else −1); `?page=N` → N; else `getLoadingPage(db)` (default page, else `MIN(page_nr)` for the db, else −1). Loads `getTablesInfo()` (`getTablesFull` + display field per table), adds tables from other DBs that the page references (`getTablePositions` → `SELECT CONCAT_WS('.', db_name, table_name) name, db_name, table_name, x X, y Y, 1 V, 1 H FROM table_coords WHERE pdf_page_number=N`), column info (`information_schema.COLUMNS` ordered by ordinal position), `getScriptTabs` (`j_tabs[db.table] = supportsForeignkeys ? 1 : 0`, `h_tabs = 1`), `getAllKeys` (first column of each index → `db.table.col => isUnique`), `getScriptContr` (all relations: internal from `pma__relation` via `getForeignersInternal` with empty constraint name, plus real FKs via `getForeignKeysData` keyed by constraint name; only kept when both ends are among the displayed tables; structure `contr[i][constraintName][srcDbTable][srcCol] = [refDbTable, refCol]`, all `rawurlencode`d), menu button classes from saved settings (`M_butt_Selected_down` vs `M_butt`), random default positions X∈[20,700], Y∈[20,550] for tables without saved coords. Minimal footer, body id `designer_body`, script `designer/init.js`. `window.designerConfig = {db, scriptTables, scriptContr, server, scriptDisplayField, displayPage, tablesEnabled}` is embedded; `tablesEnabled = pdfFeature !== null`.

**Column icons** (`Designer::getColumnTypes`): `designer/FieldKey_small` for key columns, else `designer/Field_small` + `_char` (char/text), `_int` (int/float/double/decimal), `_date` (date/time/year), or plain.

**Layout** (`designer/main.twig`):

- `#name-panel` (not in query mode): `#page_name` (page name or "Untitled") + `#saved_state` (`*` when unsaved).
- **Side menu** `#side_menu.designer_header` — vertical icon bar; hovering shows the labels (`.hidable`), unless pinned. Buttons in order:
  - `#key_Show_left_menu` Show/Hide tables list
  - `#toggleFullscreen` View in fullscreen / Exit fullscreen (uses Fullscreen API; failure → `strFullscreenRequestDenied`; leaving via ESC persists `full_screen=off`)
  - `#addOtherDbTables` Add tables from other databases
  - (not in query mode) `#newPage` New page · `#editPage` Open page · `#savePos` Save page · `#SaveAs` Save page as · `#delPages` Delete pages · `#StartTableNew` Create table (→ `/table/create` in main content) · `#rel_button` Create relationship · `#display_field_button` Choose column to display · `#reloadPage` Reload · Help (FAQ 6.31, new tab)
  - `#angular_direct_button` Angular links / Direct links (class from `angular_direct === 'angular'`)
  - `#grid_button` Snap to grid (`snap_to_grid === 'on'`)
  - `#key_SB_all` Small/Big All (`small_big_all === 'v'`)
  - `#SmallTabInvert` Toggle small/big
  - `#relLineInvert` Toggle relationship lines (`relation_lines === 'false'` → selected)
  - `#exportPages` Export schema (normal mode) **or** `#build_query_button` Build Query (query mode)
  - `#key_Left_Right` Move Menu (`side_menu === 'true'`)
  - `#pin_Text` Pin text (`pin_text === 'true'`)
- `#canvas_outer > form#container-form` containing `#osn_tab` with `<canvas id="canvas">` (relation lines are drawn on this canvas; table boxes are absolutely positioned DOM `<table class="designer_tab">` elements over it), the **tables list panel** `#layer_menu` (hidden by default; "Hide/Show all" `#key_HS_all`, "Hide/Show tables with no relationship" `#key_HS`, scrollable list `#id_scroll_tab` with one checkbox `check_vis_{db.table}` + structure link per table, "Number of tables: N", resizer handle `#layer_menu_sizer_btn` — drag to resize, min width 150), and the table boxes (`database_tables.twig`).
- Each table box: hidden inputs `t_x[]`, `t_y[]`, `t_v[]`, `t_h[]`; header row with (query mode) a "Select all" checkbox, the `small_tab` collapse toggle (`v` expanded / `>` collapsed, title "Show/hide columns"), `small_tab_pref` "See table structure" icon (→ `/table/structure` in the main window via `startTabUpd`), the title cell `tab_zag` showing `<span class="owner">db</span> table` (hover highlights header; drag handle), and (query mode) an extra cell. Body rows `tr.tab_field[_3 when display field]` each with `click_field_param="table,col,[isKey],db"`, icon + `col : type`, and in query mode a per-column checkbox and an "Options" icon (`small_tab_pref_click_opt`).
- `#designer_hint` floating hint. Panes: `#layer_new_relation` ("Create relationship": FOREIGN KEY block with `on delete` / `on update` selects `--`, CASCADE, SET NULL, NO ACTION, RESTRICT; **OK** / **Cancel**), `#layer_upd_relation` ("Delete relationship": **Delete** / **Cancel**). Query mode adds `#designer_optionse` (column options: WHERE relationship operator `--,=,>,<,>=,<=,NOT,IN,Except,NOT IN` + Value/subquery textarea; Rename to; Aggregate operator `SUM,MIN,MAX,AVG,COUNT`; GROUP BY checkbox; ORDER BY `ASC/DESC`; HAVING operator + relationship operator + value; OK/Cancel), per-type edit panes `#query_rename_to`, `#query_having`, `#query_Aggregate`, `#query_where`, the history accordion `#ab` with an "Active options" trigger, and `#buildQueryModal` (textarea `sql_query` in `form#vqb_form` posting to `/database/qbe` with `submit_sql=true`, buttons Close / Submit).
- Generic modals `#designerGoModal` (Go / Cancel) and `#designerPromptModal` (Yes / No / Cancel).

**Interactions** (`designer/move.ts`, `page.ts`, `init.ts`):

- *Drag*: mousedown on a table header (`SPAN`/`tab_zag_2`) picks the box, hides the canvas and raises z-index; mousemove translates by the delta (RTL-aware), with `snap to grid` rounding to multiples of `gridSize = 10`, clamped at 0; marks unsaved (`*`); mouseup shows the canvas and `reload()` redraws all lines. `resizeOsnTab` grows the canvas to the farthest box + 50px.
- *Lines* (`reload`): for every relation whose two tables are both visible, chooses the closest pair of box edges (left/right), computes the y of the referencing and referenced column rows (`heightField = 7`; collapsed boxes use the header), and draws via `drawLine0` → `line0`/`line2`/`line3` depending on angular/direct mode, in a per-target colour (`getColorByTarget`) with endpoint circles. Clicking the canvas near a line start (±10px x, ±7px y) highlights it red and opens the delete pane with `T1/F1/T2/F2`.
- *Toggle rel lines* flips `showRelationLines`, saves `relation_lines`. *Angular/Direct* flips `onAngularDirect`, saves `angular_direct`, redraws. *Snap to grid* saves `snap_to_grid` on/off. *Small/Big All* collapses or expands every box (saves `small_big_all` `v`/`>`). *Toggle small/big* inverts each box. *Pin text* saves `pin_text` and keeps labels visible. *Move Menu* toggles `#side_menu.right`, swaps icons, saves `side_menu`. Tables-list checkboxes show/hide a box (`visibleTab`, marks unsaved); `#key_HS_all` checks/unchecks all; `#key_HS` hides tables with no relationship (`noHaveConstr`).
- *Create relationship*: click `#rel_button` → hint `strSelectReferencedKey`; click a column: must be a key when FKs are unsupported (`strPleaseSelectPrimaryOrUniqueKey` alert), records `DB1/T1/F1`, hint `strSelectForeignKey`; click the second column → shows the relationship pane (FK on-delete/on-update block hidden when either side can't do FKs or the referenced column isn't a key); **OK** posts `operation=addNewRelation` and reloads the page. Server (`Common::addNewRelation`): if both engines support FKs and are equal: existing FK on F2 → "Error: relationship already exists."; both columns must appear in `SHOW INDEX` of their table else "Error: Missing index on column(s)."; `ALTER TABLE `db2`.`t2` ADD FOREIGN KEY (`f2`) REFERENCES `db1`.`t1`(`f1`) [ON DELETE x] [ON UPDATE y];` → "FOREIGN KEY relationship has been added." / "Error: FOREIGN KEY relationship could not be added!". Otherwise internal relation: requires `relationFeature` ("Error: Relational features are disabled!"), `INSERT INTO pma__relation(master_db, master_table, master_field, foreign_db, foreign_table, foreign_field) VALUES (db2,t2,f2,db1,t1,f1)` → "Internal relationship has been added.".
- *Delete relationship*: pane **Delete** → `operation=removeRelation`; FK → `ALTER TABLE `db2`.`t2` DROP FOREIGN KEY `constraint`;` "FOREIGN KEY relationship has been removed."; else `DELETE FROM pma__relation WHERE master_*/foreign_* match` "Internal relationship has been removed.".
- *Choose column to display*: `#display_field_button` → hint `strChangeDisplay`; clicking a column sets (or, if already the display field, clears) it, restyles the row (`tab_field_3`), posts `setDisplayField` (`field` empty to clear), shows `strModificationSaved`.
- *Pages* (pmadb mode, `designerTablesEnabled`): **New page** → `promptToSaveCurrentPage` (if unsaved or page −1: modal `strLeavingPage` Yes → save flow, No → continue) then `loadPage(-1)` (reload with no page: all tables shown at random positions). **Open page** → `dialog=edit` select; Go loads `?page=N` (`strSelectPage` if none). **Save page** → if a page is selected `save2`: `operation=savePage&save_page=same&selected_page=N` + `t_x/t_y/t_v/t_h/t_db/t_tbl` per table (`getUrlPos`), message `strModificationSaved`, clears `*`; if no page → `save3` prompts for a name (`strEnterValidPageName` when blank) and creates it. **Save page as** → `dialog=save_as`: page selector + radios "Save to selected page" / "Create a page and save to it" + "New page name"; Go validates and posts `savePage` with `save_page=new&selected_value=name` (server rejects duplicate names). **Delete pages** → `dialog=delete`; Go confirms and posts `deletePage` → `strSuccessfulPageDelete`, then reloads to the first remaining page. **Reload** reloads the current page. Table positions that reference tables no longer present are skipped; missing tables on load → `strSavedPageTableMissing` and unsaved mark.
- *Offline mode* (no `pdf_pages`/`table_coords` configured, `tablesEnabled=false`): `designer/database.ts` opens IndexedDB `pma_designer` v1 with object stores `pdf_pages` (key `pgNr`, AI) and `table_coords` (key `id`, AI); `page.ts` implements the same page operations client-side (`loadFirstPage` prefers a page named like the db, `saveToSelectedPage` = delete + recreate, `createPageList` builds the select). `strIndexedDBNotWorking` when unavailable. Schema export then adds `offline_export=true` and posts the coordinates directly.
- *Add tables from other databases*: modal with a database select (populated by posting `SHOW databases;` to `/sql` and scraping the grid) and a table select (`SHOW tables;` for the chosen db); Go rejects duplicates (`strTableAlreadyExists`), posts `dialog=add_table`, appends the returned box, registers events, adds it to the tables list, `jTabs[db.table]=1`, marks unsaved.
- *Export schema*: posts `dialog=export&selected_page=N`; the returned form (`schema_export.twig`: `<select id="plugins" name="export_type">` PDF/SVG/Dia/EPS + each plugin's "Format Specific Options") is placed in the Go modal; the current coordinates are appended as hidden fields (`t_x[i], t_y[i], t_v[i], t_h[i], t_db[i], t_tbl[i]`); changing the format shows only `#<format>_options`; Go submits `form#id_export_pages` (POST `/schema-export`, `disableAjax` → file download).
- *Visual query builder* (`?query`): header "Select all" checkbox adds `` `table`.* `` to the select list; column checkboxes add `` `table`.`col` `` (`storeColumn`); the per-column Options icon opens `#designer_optionse` pre-titled "Add an option for column "c"."; **OK** (`addObject`) creates history objects for each filled section — Where (`strQueryEmpty` if value missing), Rename, Aggregate, GroupBy, Having, OrderBy — reports `strObjectsCreated`, and renders them into the `#ab` accordion (each with edit/delete icons and AND/OR toggles). **Build Query** (`DesignerHistory.buildQuery`) composes `SELECT [aggregate(col)] [AS rename] … | *` + `\nFROM ` + `queryFrom()` (first used table, then `LEFT JOIN `t` ON `a`.`x` = `b`.`y`` for each relation in `contr` linking a used table to a pending one, iterated twice, remaining tables comma-joined) + optional `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, opens `#buildQueryModal` with a CodeMirror editor; Submit posts `#vqb_form` (to the removed `/database/qbe` route — see unresolved notes).

**Config/pmadb.** Settings persisted per user in `pma__designer_settings.settings_data` JSON keys: `angular_direct` (`angular`|`direct`), `snap_to_grid` (`on`|`off`), `pin_text` (`true`|`false`), `relation_lines` (`true`|`false`), `small_big_all` (`v`|`>`), `side_menu` (`true`|`false`), `full_screen` (`off`). Pages in `pma__pdf_pages`/`pma__table_coords`; display fields in `pma__table_info`; internal relations in `pma__relation`.

---

### Schema export (`/schema-export`, used from Designer)

`SchemaExportController` (GET/POST): requires `db` and `export_type` ("Missing parameter: db|export_type" with FAQ link); `Export::getExportSchemaInfo(db, format)` validates the format against `/^[a-zA-Z]+$/` (default `pdf`), loads `Plugins::getPlugin('schema', format)` ("Bad type!" if none), selects the db and returns `{fileName, mediaType, fileData}` streamed with `Core::downloadHeader`.

Common base `ExportRelationSchema`: reads `page_number` and `offline_export` from the request; tables come from `t_tbl[]` (`getTablesFromRequest`, rawurldecoded) and positions from `t_x[]`/`t_y[]`; the filename is the page's `page_descr` (`SELECT page_descr FROM pdf_pages WHERE page_nr=N`) when a page is selected and not offline, else the database name, plus the extension.

Options per plugin (`SchemaPlugin::addCommonOptions` adds `<name>_show_color` "Show color" and `<name>_show_keys` "Only show keys" to every plugin):

- **PDF** (`SchemaPdf`): `pdf_show_color`, `pdf_show_keys`, `pdf_all_tables_same_width` "Same width for all tables", `pdf_orientation` Landscape (`L`) / Portrait (`P`), `pdf_paper` (values from `$cfg['PDFPageSizes']`), `pdf_show_grid` "Show grid", `pdf_with_doc` "Data dictionary", `pdf_table_order` None / Name (Ascending) / Name (Descending). `PdfRelationSchema` also reads `pdf_show_table_dimension` (no UI item in master). Defaults (`Settings/Schema.php`): `format='pdf'`, `pdf_show_color=true`, `pdf_show_keys=false`, `pdf_all_tables_same_width=false`, `pdf_orientation='L'`, `pdf_paper='A4'`, `pdf_show_grid=false`, `pdf_with_doc=true`, `pdf_table_order=''`.
- **SVG**: `svg_show_color` (default true), `svg_show_keys` (false), `svg_all_tables_same_width` (false); reads `svg_show_table_dimension` too.
- **Dia**: `dia_show_color` (true), `dia_show_keys` (false), `dia_orientation` (`L`), `dia_paper` (`A4`).
- **EPS**: `eps_show_color` (true), `eps_show_keys` (false), `eps_all_tables_same_width` (false), `eps_orientation` (`L`); reads `eps_show_table_dimension`.

Media types/extensions: PDF `application/pdf` `.pdf`; SVG, Dia, EPS per their plugin properties.

---

### Central columns (`/database/central-columns`)

**Purpose.** Maintain a per-database "central list" of column definitions (stored in `pma__central_columns`) that can be reused when creating/altering tables and pushed back onto tables ("Make consistent").

**Controller** (`CentralColumnsController`, GET/POST). Scripts `vendor/jquery/jquery.uitablefilter.js`, `vendor/jquery/jquery.tablesorter.js`, `database/central_columns.js`. Handlers:

- `edit_save` → `editSave(...)` → `CentralColumns::updateOneColumn(db, orig_col_name, col_name, col_type, col_attribute, col_length, col_isNull !== null, collation, col_extra, default)` where default `NONE` (unless `col_default_sel === 'USER_DEFINED'`) becomes `''`. Returns immediately (AJAX inline edit).
- `add_new_column` → `updateOneColumn(db, '', …)` → INSERT.
- `getColumnList` → JSON `message` = `getListRaw(db, cur_table)` (central columns not already present in `cur_table`; used by the table structure editor's "Pick from central list").
- `add_column` (from the "Add column" form) → `syncUniqueColumns(db, [column-select], false, table-select)`.
- `edit_central_columns_page` → renders `edit.twig` for the `selected_fld[]` ("Edit multiple").
- `multi_edit_central_column_save` → `updateMultipleColumn(params)` (loops `updateOneColumn`; `NONE` → '', `USER_DEFINED` → `field_default_value[i]`).
- `delete_save` → `col_name` is a URL-encoded string (`selected_fld[]=…`) parsed with `parse_str` → `deleteColumnsFromList(db, selected, false)`.
- Finally `main(pos, total_rows, db)` renders the list and sets message "Showing rows %1$s - %2$s." (or the operation's message).

**Storage SQL** (`Database\CentralColumns`, control connection): list `SELECT * FROM pmadb.central_columns WHERE db_name='db' LIMIT from, num`; count `SELECT count(db_name) …`; insert `INSERT INTO … VALUES ('db','col','type','length','collation','0|1','extra,attribute','default')` (note: `col_extra` stores `extra,attribute` joined by a comma; `handleColumnExtra` splits it back into `col_extra`/`col_attribute`); update `UPDATE … SET col_type, col_name, col_length, col_isNull, col_collation, col_extra='extra,attribute', col_default WHERE db_name AND col_name=orig`; delete `DELETE FROM … WHERE db_name='db' AND col_name IN (…)`. `syncUniqueColumns` (from Structure bulk action or Add column) reads real column definitions (`getColumns`/`getColumn`) and inserts those not already present; existing ones produce notice "Could not add %1$s as they already exist in central list!" + "Please remove them first from central list if you want to update above columns"; failures "Could not add columns!". `deleteColumnsFromList` notices "Couldn't remove Column(s) %1$s as they don't exist in central columns list!". `makeConsistentWithList(db, tables)`: for each table builds `ALTER TABLE `t` MODIFY `col` type(len) attribute NULL|NOT NULL extra [DEFAULT …]` for every column that exists in the central list and is not referenced by a child FK (`checkChildForeignReferences … isEditable`). Missing pmadb → "The configuration storage is not ready for the central list of columns feature.".

**Layout** (`central_columns/main.twig`):

- **Add new column** (`#add_col_div`): a `+ Add new column` / `- Add new column` toggle link; form `#add_new` (hidden when the list is non-empty) with a one-row table: Name (`columns_definitions/column_name.twig`, `field_name[0]`), Type `field_type[0]` (all datatypes), Length/Value `field_length[0]` + "Edit ENUM/SET values" link, Default select `field_default_type[0]` (None / As defined: / NULL / CURRENT_TIMESTAMP) + `field_default_value[0]` (input or textarea depending on `$cfg['CharEditing']` default `'input'`), Collation select `field_collation[0]`, Attribute (`column_attribute.twig`: BINARY / UNSIGNED / UNSIGNED ZEROFILL / on update CURRENT_TIMESTAMP), Null checkbox `field_null[0]`, A_I checkbox `col_extra[0]=auto_increment`, **Save**. The JS (`#add_new` submit) remaps these `field_*` names to `col_name, col_type, col_length, col_default_sel, col_default, collation, col_attribute, col_isNull, col_extra` before posting `add_new_column`.
- Empty state: info alert "The central list of columns for the current database is empty".
- Pagination bar (when rows exist): `<` form (`pos − max_rows`), page selector (`Util::pageselector('pos', max_rows, page, pages)`) when more than one page, `>` form, and "Filter rows:" input `#filterRows.filter_rows` placeholder "Search this table" (client-side filter). Page size = `$cfg['MaxRows']` (default `25`) — there is no separate "number of rows to display" control in master; `total_rows` is carried as a hidden field to avoid recounting.
- **Add column** from existing table (`#add_column` form, icon `centralColumns_add`): `<select id="table-select">` ("Select a table" + tables) → on change posts `selectedTable` to `/database/central-columns/populate` (`PopulateColumnsController` → `getColumnsNotInCentralList` → `<option>`s), filling `<select id="column-select">` ("Select a column."); **Add** submit.
- **List** `#table_columns.tablesorter` (when rows exist): header checkbox col · hidden col · **Action** (colspan 2) · Name · Type · Length/Value · Default · Collation · Attribute · Null · A_I (sortable, "Click to sort."). Each row (`tr#f_{n}[data-rownum]`) carries hidden `edit_save=save`, a checkbox `selected_fld[]`, an **Edit** pencil (`td.edit`), a **Delete** icon (`td.del_row`) plus a hidden **Cancel** button, a hidden **Save** cell, and for each attribute both a `<span>` (view) and the editing control (hidden). Clicking Edit switches that row to inline-edit mode (spans hidden, inputs shown, Save/Cancel visible); Save posts `edit_save` via AJAX and updates the spans; Cancel restores. Delete → confirm `strDeleteCentralColumnWarning` then submits `#del_form` with `col_name=selected_fld[]=…`. Footer: `select_all.twig` + **Edit** (`edit_central_columns`, opens the multi-edit page for all checked rows; `strRadioUnchecked` if none) + **Delete** (`delete_central_columns`, same check).
- **Edit multiple** (`edit.twig`): `form#multi_edit_central_columns` card "Structure" with a table Name · Type · Length/Values · Default · Collation · Attributes · Null · A_I, one `edit_table_row.twig` per selected column (hidden `orig_col_name[i]`), **Save** (`save_multi_central_column_edit`) → JS posts `multi_edit_central_column_save`.
- `default_type` select change toggles the default-value input (shown only for "As defined:").

---

### Data dictionary (`/database/data-dictionary`)

`DataDictionaryController` (GET): requires db. For every table (`getTables` + `getTablesFull` for comments): primary key columns (`Index::getPrimary`), foreigners (when `relationFeature`), MIME map (when `browserTransformationFeature`), columns (`getColumns`), indexes (`Index::getFromTable`).

Template (`data_dictionary/index.twig`, `.container-fluid`): `<h1>db</h1>`, "Database comment: *comment*" if set, **Print** button (`.jsPrintButton`, hidden when printing); per table: `<h2>table</h2>`, "Table comments: `<pre>comment</pre>`" if any, columns table with headers Column · Type · Null · Default · [Links to] · Comments · [Media type]; each row: name (+ *(Primary)*), `print_type` (nowrap unless set/enum), Yes/No, default (`<em>NULL</em>` when null and nullable), relation as `foreign_table -> foreign_field`, comment, MIME type (`_`→`/`); then `<h3>Indexes</h3>` with Keyname · Type · Unique · Packed · Column · Cardinality · Collation · Null · Comment (multi-column indexes use `rowspan`; sub-part shown as `col (n)`), or "No index defined!". Another Print button at the bottom. Reached from Structure's "Data dictionary" link (`goto=/database/structure`).

---

### Configuration storage check (`/check-relations`)

Linked from the Operations notice. `CheckRelationsController` disables the Tracker, then: `create_pmadb` → `Relation::createPmaDatabase(cfgStorageDbName)` + `fixPmaTables`; `fixall_pmadb` → `fixPmaTables(current db)`; `fix_pmadb` → `fixPmaTables(configured pmadb)`. Template `relation/check_relations.twig` lists each `$cfg['Servers'][$i][...]` key (`pmadb`, `relation`, `table_info`, `table_coords`, `pdf_pages`, `column_info`, `bookmarktable`, `history`, `recent`, `favorite`, `table_uiprefs`, `tracking`, `userconfig`, `users`, `usergroups`, `navigationhiding`, `savedsearches`, `central_columns`, `designer_settings`, `export_templates`) as **OK** / **not OK** with the derived feature status (General relation features, Display features, Designer and creation of PDFs, Displaying column comments, Browser transformation, Bookmarked SQL query, SQL history, Persistent recently used tables, Persistent favorite tables, Persistent tables' UI preferences, Tracking, User preferences, Configurable menus, Hide/show navigation items, Saving Query-By-Example searches, Managing central list of columns, Remembering designer settings, Saving export templates) Enabled/Disabled. With `$cfg['ZeroConf']` (default `true`) it offers "Create a database named 'phpmyadmin' and setup the phpMyAdmin configuration storage there." (no db selected), "Create the phpMyAdmin configuration storage in the current database.", or "Create missing phpMyAdmin configuration storage tables." Otherwise lists "Quick steps to set up advanced features" (create tables with `create_tables.sql`, create a control user, enable in `config.inc.php`, re-login).

---

### SQL / Export / Import tabs (pointers only)

- `/database/sql` (`Database\SqlController`): renders the shared SQL query form in database context (bookmarks, delimiter, "Show this query here again", etc.). See the SQL editor document.
- `/database/export` (`Database\ExportController`, `database/export/index.twig` extends `export.twig`): title "Exporting tables from "db" database"; adds a **Tables:** selection card listing every table with checkboxes `table_select[]`, `table_structure[]`, `table_data[]` and "Select all" controls; the rest (format plugins, options) is the shared export page. When invoked from the Structure bulk action the route is `/export/tables` with the selected tables pre-checked.
- `/database/import` (`Database\ImportController`, `database/import/index.twig` extends `import.twig`): title "Importing into the database "db"".

---

## Micro-behaviours checklist

Structure
- [x] `pos` beyond the end redirects to the last page (`max(0, total − MaxTableList)`) with `reload=1`. <!-- parity:test --> `p05-9533c7` [database-structure.test.ts:39](../../apps/server/test/int/database-structure.test.ts#L39)
- [x] Session remembers the table-list offset per database; switching DB resets to 0. <!-- parity:test --> `p05-76c52c` [database-checklist.test.ts:88](../../apps/server/test/int/database-checklist.test.ts#L88)
- [x] Name sort is done on the plain table-name list before `getTablesFull`; other sorts use SQL `ORDER BY` + `LIMIT`. <!-- parity:test --> `p05-16d3fa` [database-checklist.test.ts:64](../../apps/server/test/int/database-checklist.test.ts#L64)
- [x] `sort_order=DESC` is ignored for unknown sort keys (and `charset` is an unknown key). <!-- parity:test --> `p05-5eda6c` [database-checklist.test.ts:74](../../apps/server/test/int/database-checklist.test.ts#L74)
- [x] `tbl_group` / `tbl_type` filters disable pagination entirely. <!-- parity:test --> `p05-b457b3` [database-checklist.test.ts:79](../../apps/server/test/int/database-checklist.test.ts#L79)
- [x] `SkipLockedTables=true` shows locked tables as "in use" rows with no stats and disables pagination. <!-- parity:test --> `p05-b75822` [database-checklist.test.ts:125](../../apps/server/test/int/database-checklist.test.ts#L125)
- [x] InnoDB/TokuDB tables with `TABLE_ROWS ≥ MaxExactCount` show `~N` with a per-row exact-count link; the Sum shows `~` and an "all tables" exact-count link. <!-- parity:test --> `p05-b35450` [database-structure.parity.test.ts:127](../../tests/parity/database-structure.parity.test.ts#L127)
- [x] Views: `MaxExactCountViews=0` → no count (−1 → shows `-1`? no: TABLE_ROWS set to −1 then formatted; the row still shows a number); `>0` → `SELECT 1 … LIMIT N`, superscript hint when at the cap. <!-- parity:test --> `p05-be3af8` [database-structure.test.ts:44](../../apps/server/test/int/database-structure.test.ts#L44)
- [x] MERGE tables excluded from the row Sum; CSV size computed with the CONCAT/REPLACE formula. <!-- parity:test --> `p05-860f02` [database-checklist.test.ts:95](../../apps/server/test/int/database-checklist.test.ts#L95)
- [x] Favorite star toggles via AJAX; list capped at `NumFavoriteTables` → "Favorite List is full!"; state mirrored to `localStorage.favoriteTables` keyed by `sha1(user)`. <!-- parity:test --> `p05-09381e` [database-checklist.test.ts:140](../../apps/server/test/int/database-checklist.test.ts#L140)
- [x] Tracking eye icon only when `Tracker::isActive()` and the table has a tracking row; grey when deactivated. <!-- parity:test --> `p05-a895d3` [database-checklist.test.ts:187](../../apps/server/test/int/database-checklist.test.ts#L187)
- [x] Comments longer than `LimitChars` are truncated with an `<abbr>` tooltip; the table-name link's `title` is the full comment. <!-- parity:test --> `p05-7fa25a` [database-checklist.test.ts:112](../../apps/server/test/int/database-checklist.test.ts#L112) +2
- [x] Browse/Search/Empty icons greyed (`bd_*`) when `TABLE_ROWS == 0` and not a view, but still clickable. <!-- parity:test --> `p05-9b302e` [database-checklist.test.ts:104](../../apps/server/test/int/database-checklist.test.ts#L104)
- [x] Views: Empty is replaced by Edit (`/view/create`); Drop confirm omits the strong warning and uses `DROP VIEW`. <!-- parity:test --> `p05-3eaa5f` [database-checklist.e2e.ts:51](../../tests/e2e/database-checklist.e2e.ts#L51)
- [x] Truncate/Drop confirmations include the "Enable foreign key checks" checkbox loaded lazily. <!-- parity:test --> `p05-22cce4` [database-checklist.e2e.ts:63](../../tests/e2e/database-checklist.e2e.ts#L63)
- [x] After AJAX truncate: row shows 0 rows, `-` size/overhead, totals recomputed. After drop: row removed, totals recomputed, navigation reloaded. <!-- parity:test --> `p05-731ff5` [database-checklist.e2e.ts:63](../../tests/e2e/database-checklist.e2e.ts#L63)
- [x] Bulk select is a `<select>`; the action fires on `change`, no Go button; copy/prefix actions silently no-op with nothing checked, others return "No table selected.". <!-- parity:test --> `p05-cf9152` [database-checklist.test.ts:166](../../apps/server/test/int/database-checklist.test.ts#L166)
- [x] "Check tables having overhead" selects only rows with `tbl-overhead`. <!-- parity:test --> `p05-7f697c` [database-checklist.e2e.ts:77](../../tests/e2e/database-checklist.e2e.ts#L77)
- [x] Delete/maintenance/prefix groups hidden on system schemas or when `DisableMultiTableMaintenance`. <!-- parity:test --> `p05-d2bc56` [database-checklist.test.ts:112](../../apps/server/test/int/database-checklist.test.ts#L112)
- [x] Central columns group only when pmadb `central_columns` configured; "Make consistent" asks "Are you sure?" first. <!-- parity:test --> `p05-2acc14` [database-checklist.e2e.ts:95](../../tests/e2e/database-checklist.e2e.ts#L95)
- [x] Copy-table modal excludes the current database from the target list; defaults: Structure and data, Add constraints checked, Add DROP TABLE / AUTO_INCREMENT / Adjust privileges unchecked. <!-- parity:test --> `p05-4aab6b` [database-checklist.test.ts:173](../../apps/server/test/int/database-checklist.test.ts#L173)
- [x] Replace prefix leaves non-matching names unchanged; copy-with-prefix does not check the match. <!-- parity:test --> `p05-fdecd7` [database-structure.parity.test.ts:194](../../tests/parity/database-structure.parity.test.ts#L194) +1
- [x] Drop/Empty confirm pages show the exact SQL (`DROP TABLE `a`, `b`;` + separate `DROP VIEW …;`; `TRUNCATE` per table) with Yes/No; No → "No change". <!-- parity:test --> `p05-a7eaad` [database-structure.test.ts:67](../../apps/server/test/int/database-structure.test.ts#L67) +1
- [x] Dropping clears the session table-offset cache (#14205). <!-- parity:test --> `p05-d99774` [database-checklist.test.ts:180](../../apps/server/test/int/database-checklist.test.ts#L180)
- [x] Show create groups Tables and Views separately. <!-- parity:test --> `p05-d5ead9` [database-structure.test.ts:52](../../apps/server/test/int/database-structure.test.ts#L52)
- [x] `PropertiesNumColumns > 1` splits the list into N vertical blocks and hides Type/Collation. <!-- parity:test --> `p05-ccc3d5` [database-checklist.test.ts:112](../../apps/server/test/int/database-checklist.test.ts#L112)
- [x] Page-settings gear exposes the five `ShowDbStructure*` toggles and persists them in `pma__userconfig`. <!-- parity:test --> `p05-67e9c0` [database-checklist.e2e.ts:562](../../tests/e2e/database-checklist.e2e.ts#L562)
- [x] Print view hides checkboxes/actions (`d-print-none`) and the create-table form. <!-- parity:test --> `p05-898d30` [database-checklist.e2e.ts:85](../../tests/e2e/database-checklist.e2e.ts#L85)
- [x] Create-table form: name maxlength 64, columns min 1 default 4, `lock-page` (warns on navigation with unsaved input). <!-- parity:test --> `p05-6362c2` [database-checklist.e2e.ts:102](../../tests/e2e/database-checklist.e2e.ts#L102)

Databases list / Create database
- [x] Create-database form hidden when `ShowCreateDb=false`; red "No privileges to create databases" when the user lacks CREATE. <!-- parity:test --> `p05-2bf992` [database-checklist.test.ts:276](../../apps/server/test/int/database-checklist.test.ts#L276)
- [x] Name prefilled with the user's wildcard DB (`databaseToCreate`); server collation preselected; blank collation allowed. <!-- parity:test --> `p05-b1a892` [database-checklist.test.ts:282](../../apps/server/test/int/database-checklist.test.ts#L282)
- [x] Name lower-cased when `lower_case_table_names=1`; collation only applied if it exists on the server. <!-- parity:test --> `p05-f14700` [server-databases.parity.test.ts:193](../../tests/parity/server-databases.parity.test.ts#L193)
- [x] After creation: counter +1, navigation reload, auto-open the new DB's default tab. <!-- parity:test --> `p05-3d20d2` [database-checklist.e2e.ts:127](../../tests/e2e/database-checklist.e2e.ts#L127)
- [x] Drop checkboxes disabled for system schemas and the pmadb; server also filters them. <!-- parity:test --> `p05-684480` [server-databases.parity.test.ts:227](../../tests/parity/server-databases.parity.test.ts#L227)
- [x] Drop requires super user or `AllowUserDropDatabase`; confirmation lists each `DROP DATABASE `x`;`. <!-- parity:test --> `p05-2f780c` [database-checklist.test.ts:288](../../apps/server/test/int/database-checklist.test.ts#L288)
- [x] Statistics off by default; "Enable statistics" link carries a heavy-traffic warning; stats mode changes the title to "Databases statistics" and adds 6 sortable columns. <!-- parity:test --> `p05-45f47d` [database-checklist.test.ts:262](../../apps/server/test/int/database-checklist.test.ts#L262)
- [x] Sorting whitelist; unknown `sort_by` → `SCHEMA_NAME`; `sort_order` anything but `desc` → `asc`. <!-- parity:test --> `p05-700f1e` [database-checklist.test.ts:246](../../apps/server/test/int/database-checklist.test.ts#L246)
- [x] Pagination by `MaxDbList=100`. <!-- parity:test --> `p05-8ea9f0` [database-checklist.test.ts:255](../../apps/server/test/int/database-checklist.test.ts#L255)
- [x] Replication columns appear only when primary/replica status is active. <!-- parity:test --> `p05-e64b2f` [database-checklist.test.ts:295](../../apps/server/test/int/database-checklist.test.ts#L295)
- [x] Client-side filter box filters rows by uppercase name. <!-- parity:test --> `p05-838cf0` [database-checklist.e2e.ts:127](../../tests/e2e/database-checklist.e2e.ts#L127)

Operations
- [x] Rename and Drop cards hidden for `mysql`; Drop also requires super user or `AllowUserDropDatabase`. <!-- parity:test --> `p05-1cb456` [database-checklist.test.ts:219](../../apps/server/test/int/database-checklist.test.ts#L219)
- [x] Rename: client rejects same name; confirm shows `CREATE DATABASE new / DROP DATABASE old`; `adjust_privileges` checked by default when the user has all required privileges, disabled otherwise. <!-- parity:test --> `p05-d8139a` [database-checklist.e2e.ts:142](../../tests/e2e/database-checklist.e2e.ts#L142)
- [x] Copy: defaults Structure and data, CREATE DATABASE before copying, AUTO_INCREMENT, Add constraints, Adjust privileges checked; DROP TABLE/VIEW unchecked; Switch to copied database remembers last choice in session. <!-- parity:test --> `p05-b5ba2f` [database-checklist.test.ts:232](../../apps/server/test/int/database-checklist.test.ts#L232) +1
- [x] Same-name copy → "Cannot copy database to the same name. Change the name and try again." <!-- parity:test --> `p05-312a1f` [database-operations.parity.test.ts:147](../../tests/parity/database-operations.parity.test.ts#L147)
- [x] Copy order: routines → view stand-ins → tables (+triggers) → views → constraints → events → bookmarks → privileges. <!-- parity:test --> `p05-187236` [database-operations.parity.test.ts:59](../../tests/parity/database-operations.parity.test.ts#L59)
- [x] MERGE tables: data never copied. <!-- parity:test --> `p05-5c5fc6` [database-checklist.test.ts:232](../../apps/server/test/int/database-checklist.test.ts#L232)
- [x] Rename uses copy + `DROP DATABASE old` and updates `mysql.db/tables_priv/columns_priv/procs_priv` when adjusting privileges. <!-- parity:test --> `p05-1a14a6` [database-operations.parity.test.ts:121](../../tests/parity/database-operations.parity.test.ts#L121)
- [x] Collation form: second checkbox hidden until "Change all tables collations" is clicked; views skipped when changing table collations; columns converted with `CONVERT TO CHARACTER SET`. <!-- parity:test --> `p05-7be12a` [database-operations.parity.test.ts:166](../../tests/parity/database-operations.parity.test.ts#L166)
- [x] Database comment card only with `column_info` configured. <!-- parity:test --> `p05-6822ae` [database-checklist.test.ts:225](../../apps/server/test/int/database-checklist.test.ts#L225)
- [x] "Configuration storage deactivated" notice (error if pmadb configured) with link to `/check-relations`, suppressed by `PmaNoRelation_DisableWarning`. <!-- parity:test --> `p05-c7616f` [database-checklist.test.ts:225](../../apps/server/test/int/database-checklist.test.ts#L225)

Search
- [x] Disabled by `UseDbSearch=false` with a config-pointing error. <!-- parity:test --> `p05-64f92a` [database-checklist.test.ts:339](../../apps/server/test/int/database-checklist.test.ts#L339)
- [x] Five search types; `%` auto-wildcard for types 1–3 only; type 4 is exact whole-field; type 5 uses REGEXP. <!-- parity:test --> `p05-2fb5eb` [database-checklist.test.ts:308](../../apps/server/test/int/database-checklist.test.ts#L308)
- [x] Words split on single space; empty words skipped; OR for "at least one", AND for others. <!-- parity:test --> `p05-fc8d02` [database-checklist.test.ts:308](../../apps/server/test/int/database-checklist.test.ts#L308)
- [x] Column restriction by exact column name; non-existent column → `WHERE FALSE` (0 matches). <!-- parity:test --> `p05-431e33` [database-checklist.test.ts:317](../../apps/server/test/int/database-checklist.test.ts#L317)
- [x] Hex option adds `HEX(col) LIKE …` clauses. <!-- parity:test --> `p05-89ec76` [database-checklist.test.ts:328](../../apps/server/test/int/database-checklist.test.ts#L328)
- [x] All tables preselected; Select all / Unselect all buttons; submit with none selected → `strNoTableSelected`. <!-- parity:test --> `p05-b20265` [database-checklist.e2e.ts:171](../../tests/e2e/database-checklist.e2e.ts#L171)
- [x] Results: per table count, Browse/Delete only when count > 0; total line only when >1 table. <!-- parity:test --> `p05-b47d7f` [database-checklist.test.ts:334](../../apps/server/test/int/database-checklist.test.ts#L334)
- [x] Browse renders a grid under the results; Delete confirms per table, runs the DELETE, re-runs the search, and shows the executed query box. <!-- parity:test --> `p05-286ac8` [database-checklist.e2e.ts:171](../../tests/e2e/database-checklist.e2e.ts#L171)
- [x] After a search the criteria form collapses with "Show search criteria" / "Hide search results" toggles. <!-- parity:test --> `p05-802894` [database-checklist.e2e.ts:171](../../tests/e2e/database-checklist.e2e.ts#L171)

Query (multi-table)
- [x] Three column cards initially; `+ Add column` clones; each card removable. <!-- parity:test --> `p05-bd2290` [database-checklist.e2e.ts:295](../../tests/e2e/database-checklist.e2e.ts#L295)
- [x] Column select populated from the table's hashed option template; `*` disables column alias; criteria column select excludes `*`. <!-- parity:test --> `p05-24d15b` [database-checklist.e2e.ts:295](../../tests/e2e/database-checklist.e2e.ts#L295)
- [x] Criteria collapse syncs with the "use in criteria" checkbox; AND/OR row appears with every criteria column. <!-- parity:test --> `p05-41c645` [database-checklist.e2e.ts:295](../../tests/e2e/database-checklist.e2e.ts#L295)
- [x] Operator-specific RHS widgets: none for IS [NOT] NULL, multi-value for IN/NOT IN, two values for BETWEEN, free text otherwise; "Another column" RHS swaps in table+column selects. <!-- parity:test --> `p05-86eabf` [queryGenerator.test.ts:51](../../apps/web/src/features/database/queryGenerator.test.ts#L51)
- [x] Update query: "Nothing selected" error when no shown column; FROM built with LEFT JOINs from FK metadata, else comma joins; aliases honoured. <!-- parity:test --> `p05-661434` [queryGenerator.test.ts:33](../../apps/web/src/features/database/queryGenerator.test.ts#L33) +1
- [x] Copy query disabled while editor empty; Submit query rejects empty (`strEmptyQuery`) and renders results inline with pagination links disabled. <!-- parity:test --> `p05-cd1b8a` [database-checklist.e2e.ts:295](../../tests/e2e/database-checklist.e2e.ts#L295) +1

Privileges
- [x] Non-admin users see "No Privileges"; grant/create-less users get a notice. <!-- parity:test --> `p05-2e6a47` [database-checklist.test.ts:457](../../apps/server/test/int/database-checklist.test.ts#L457)
- [x] Type column distinguishes global / database-specific / wildcard / routine; multi-entry accounts use rowspan. <!-- parity:test --> `p05-5f98bb` [database-checklist.test.ts:443](../../apps/server/test/int/database-checklist.test.ts#L443)
- [x] Edit link only for grant users; Export per user and bulk; "Add user account" pre-targets this DB. <!-- parity:test --> `p05-0c928d` [database-checklist.test.ts:457](../../apps/server/test/int/database-checklist.test.ts#L457)

Routines
- [x] Pagination by `MaxRoutineList=250`; out-of-range `pos` redirects to the last page. <!-- parity:test --> `p05-e92f6e` [database-checklist.test.ts:346](../../apps/server/test/int/database-checklist.test.ts#L346)
- [x] Create button disabled without `CREATE ROUTINE`; per-row edit/export need definer+CREATE ROUTINE or super user; execute needs EXECUTE or definer. <!-- parity:test --> `p05-815a47` [database-checklist.test.ts:354](../../apps/server/test/int/database-checklist.test.ts#L354)
- [x] Editor: PROCEDURE/FUNCTION switch toggles Direction column and Return rows; parameters sortable by drag; Add parameter appends from `paramTemplate`; removing re-indexes. <!-- parity:test --> `p05-505ad5` [database-checklist.e2e.ts:206](../../tests/e2e/database-checklist.e2e.ts#L206)
- [x] Length input hidden for types that take none; charset select only for char types (not BINARY/VARBINARY); numeric options only for numeric types. <!-- parity:test --> `p05-1a3bef` [database-checklist.e2e.ts:206](../../tests/e2e/database-checklist.e2e.ts#L206)
- [x] Client validation: name, definition, param name/type, lengths for ENUM/SET/VAR*, RETURN keyword in function body. <!-- parity:test --> `p05-2eb385` [database-checklist.e2e.ts:206](../../tests/e2e/database-checklist.e2e.ts#L206)
- [x] Edit = backup + DROP + CREATE, with restore on failure; Adjust privileges copies `procs_priv` rows to the new name/type and flushes. <!-- parity:test --> `p05-fe4110` [database-programs.parity.test.ts:184](../../tests/parity/database-programs.parity.test.ts#L184)
- [x] Execute dialog hides OUT params, uses radios for ENUM, checkboxes for SET, datepickers for DATE/DATETIME/TIMESTAMP, optional function column (`ShowFunctionFields`); results per result set; "%d rows affected" for procedures; empty-set notice. <!-- parity:test --> `p05-0167fe` [database-programs.parity.test.ts:224](../../tests/parity/database-programs.parity.test.ts#L224)
- [x] Export wraps in `DELIMITER $$ … $$ DELIMITER ;`; bulk export concatenates; none exportable → message. <!-- parity:test --> `p05-73e5bf` [database-programs.parity.test.ts:272](../../tests/parity/database-programs.parity.test.ts#L272)
- [x] Drop/bulk drop confirm; table hides and "no routines" notice shows when the last row is removed. <!-- parity:test --> `p05-9964cd` [database-checklist.e2e.ts:248](../../tests/e2e/database-checklist.e2e.ts#L248)

Events
- [x] Tab only with EVENT privilege; create button disabled without it. <!-- parity:test --> `p05-f1997a` [database-checklist.test.ts:360](../../apps/server/test/int/database-checklist.test.ts#L360)
- [x] Status options ENABLED/DISABLED/SLAVESIDE_DISABLED map to ENABLE/DISABLE/DISABLE ON SLAVE. <!-- parity:test --> `p05-fd2119` [database-checklist.test.ts:379](../../apps/server/test/int/database-checklist.test.ts#L379)
- [x] Type switch toggles Execute at vs Execute every/Start/End rows; interval value cast to int; 15 interval units. <!-- parity:test --> `p05-f63b73` [database-checklist.test.ts:379](../../apps/server/test/int/database-checklist.test.ts#L379) +1
- [x] ON COMPLETION PRESERVE from checkbox; comment maxlength 64. <!-- parity:test --> `p05-f3950a` [database-checklist.test.ts:379](../../apps/server/test/int/database-checklist.test.ts#L379)
- [x] Scheduler toggle issues `SET GLOBAL event_scheduler="ON"|"OFF"`; it shows on only for `ON`. <!-- parity:test --> `p05-396223` [database-programs.parity.test.ts:289](../../tests/parity/database-programs.parity.test.ts#L289) +1
- [x] Scheduler `DISABLED`: only the notice "The event scheduler is disabled.", no list, editor or export. <!-- parity:test --> `p05-8a82ee` [database-programs.parity.test.ts:289](../../tests/parity/database-programs.parity.test.ts#L289)
- [x] One-time event that fires immediately → "The event was dropped immediately after creation.". <!-- parity:test --> `p05-7e227b` [database-checklist.test.ts:374](../../apps/server/test/int/database-checklist.test.ts#L374)
- [x] Rows sorted by name; export shows raw `SHOW CREATE EVENT`. <!-- parity:test --> `p05-cfe947` [database-programs.parity.test.ts:422](../../tests/parity/database-programs.parity.test.ts#L422)

Triggers (db scope)
- [x] Extra "Table" column linking to the table-scoped list; new rows inserted live. <!-- parity:test --> `p05-6d51f6` [database-checklist.e2e.ts:282](../../tests/e2e/database-checklist.e2e.ts#L282) +1

Tracking (db scope)
- [x] Tab only when `Tracker::isActive()`; tracked vs untracked tables listed separately. <!-- parity:test --> `p05-edc4ef` [database-admin.parity.test.ts:366](../../tests/parity/database-admin.parity.test.ts#L366)
- [x] Untracked list excludes deactivated-but-tracked tables (they appear as tracked, "not active"). <!-- parity:test --> `p05-579ebb` [database-checklist.test.ts:205](../../apps/server/test/int/database-checklist.test.ts#L205)
- [x] Status toggle hits `/table/tracking` activate/deactivate; Delete tracking removes all versions for the table. <!-- parity:test --> `p05-e6492b` [database-admin.parity.test.ts:389](../../tests/parity/database-admin.parity.test.ts#L389)
- [x] Bulk "Track table" shows the create-version form (version 1) with statement checkboxes pre-checked from `tracking_default_statements`; bulk delete confirms. <!-- parity:test --> `p05-e898ae` [database-checklist.test.ts:211](../../apps/server/test/int/database-checklist.test.ts#L211)
- [x] Database-level DDL log shown as "Database Log" when present; empty DB shows create-table form. <!-- parity:test --> `p05-504fe5` [database-admin.parity.test.ts:366](../../tests/parity/database-admin.parity.test.ts#L366)
- [x] Tables sorted client-side (tablesorter), version numeric. <!-- parity:test --> `p05-6d5ef9` [database-checklist.e2e.ts:467](../../tests/e2e/database-checklist.e2e.ts#L467)

Designer
- [x] Page selection: `?page=N`, else page named like the DB, else lowest page number, else none (−1 → all tables at random positions). <!-- parity:test --> `p05-1864e4` [database-designer.test.ts:49](../../apps/server/test/int/database-designer.test.ts#L49)
- [x] Unsaved indicator `*`; prompts to save when creating a new page with unsaved changes. <!-- parity:test --> `p05-1655f2` [database-checklist.e2e.ts:512](../../tests/e2e/database-checklist.e2e.ts#L512)
- [x] Drag with snap-to-grid (10px) and non-negative clamp; lines redrawn on mouseup. <!-- parity:test --> `p05-39dc32` [designer.test.ts:54](../../apps/web/src/features/database/designer/designer.test.ts#L54)
- [x] Line routing picks closest box edges; angular vs direct style; lines hidden when toggle off or either table hidden. <!-- parity:test --> `p05-d2699b` [designer.test.ts:5](../../apps/web/src/features/database/designer/designer.test.ts#L5)
- [x] Clicking a line start selects it (red) and opens the delete pane. <!-- parity:test --> `p05-e7645a` [designer.test.ts:60](../../apps/web/src/features/database/designer/designer.test.ts#L60)
- [x] Create relationship enforces key on referenced column when FKs unsupported; FK path requires indexes on both columns and same FK-capable engine; else internal relation in `pma__relation`. <!-- parity:test --> `p05-cec42b` [database-designer.parity.test.ts:320](../../tests/parity/database-designer.parity.test.ts#L320) +1
- [x] Display field toggle: clicking the current display field clears it. <!-- parity:test --> `p05-1b1083` [database-designer.parity.test.ts:300](../../tests/parity/database-designer.parity.test.ts#L300)
- [x] Seven toggles persisted per user (`angular_direct`, `snap_to_grid`, `pin_text`, `relation_lines`, `small_big_all`, `side_menu`, `full_screen`). <!-- parity:test --> `p05-8248ec` [database-designer.parity.test.ts:416](../../tests/parity/database-designer.parity.test.ts#L416)
- [x] Save page rejects duplicate names; Save as offers "selected page" vs "new page". <!-- parity:test --> `p05-3c7130` [database-designer.parity.test.ts:158](../../tests/parity/database-designer.parity.test.ts#L158)
- [x] Offline (IndexedDB) fallback when pmadb Designer tables are missing. <!-- parity:test --> `p05-585808` [database-designer.test.ts:169](../../apps/server/test/int/database-designer.test.ts#L169)
- [x] Add tables from other databases with duplicate detection. <!-- parity:test --> `p05-853bd8` [database-checklist.e2e.ts:528](../../tests/e2e/database-checklist.e2e.ts#L528)
- [x] Export schema modal shows only the chosen format's options and posts current coordinates. <!-- parity:test --> `p05-f81540` [database-checklist.e2e.ts:543](../../tests/e2e/database-checklist.e2e.ts#L543)
- [x] Query mode: select-all/column checkboxes, per-column options (WHERE/Rename/Aggregate/GROUP BY/ORDER BY/HAVING), history accordion with edit/delete/AND-OR, Build Query with LEFT JOIN inference. <!-- parity:test --> `p05-32645c` [history.test.ts:28](../../apps/web/src/features/database/designer/history.test.ts#L28)

Central columns
- [x] Tab only with pmadb `central_columns`; empty-state alert; "Add new column" form auto-expanded only when the list is empty. <!-- parity:test --> `p05-9d28f6` [database-checklist.test.ts:410](../../apps/server/test/int/database-checklist.test.ts#L410) +2
- [x] Page size `MaxRows=25` with prev/next and page selector; client filter box. <!-- parity:test --> `p05-ab58ec` [database-checklist.test.ts:404](../../apps/server/test/int/database-checklist.test.ts#L404)
- [x] Add from table: table select populates column select with columns not yet in the list. <!-- parity:test --> `p05-b6cb36` [database-admin.test.ts:37](../../apps/server/test/int/database-admin.test.ts#L37)
- [x] Inline edit per row (Edit → Save/Cancel), delete with confirm, bulk Edit (multi-edit page) and bulk Delete requiring a selection. <!-- parity:test --> `p05-1c26ce` [database-checklist.e2e.ts:434](../../tests/e2e/database-checklist.e2e.ts#L434)
- [x] Default type select controls the default-value field; `col_extra` stores `extra,attribute`. <!-- parity:test --> `p05-23ba82` [database-checklist.test.ts:415](../../apps/server/test/int/database-checklist.test.ts#L415)
- [x] Sync from Structure reports already-existing columns; Make consistent skips FK-referenced columns. <!-- parity:test --> `p05-36e33d` [database-admin.parity.test.ts:109](../../tests/parity/database-admin.parity.test.ts#L109) +1

Data dictionary
- [x] Shows DB comment, per-table comments, primary markers, relations (when configured), MIME types (when configured), indexes with rowspans; print buttons top and bottom. <!-- parity:test --> `p05-8e2280` [database-admin.parity.test.ts:422](../../tests/parity/database-admin.parity.test.ts#L422)

---

## Rebuild notes (modern SPA mapping)

**Routing & shell.** Model the database tab bar as a route-level layout (`/db/:name/*`) whose tab list is computed from capabilities: `isSystemSchema`, user privileges (`EVENT`, `TRIGGER`, super/grant/create), pmadb features (`tracking`, `central_columns`, `pdf_pages+table_coords`, `relation`, `table_info`, `column_info`). Keep `DefaultTabDatabase` as a user preference that both the Databases list and Create-database flows honour.

**Structure.** Implement the list as a server-paginated, server-sorted grid (`pos`, `sort`, `sort_order`, `MaxTableList`) backed by one endpoint returning per-table `{name, isView, engine, collation, charset, rows, rowsApprox, size, overhead, comment, createTime, updateTime, checkTime, replication, tracked, favorite}` plus the summary and `defaultStorageEngine`. Reproduce the approximate-count rule (InnoDB/TokuDB ≥ `MaxExactCount`, views vs `MaxExactCountViews`) server-side and expose a `POST /real-row-count` for one or all tables; recompute totals client-side exactly like `adjustTotals` (keep the `~` when any row remains approximate). Keep column visibility as user preferences (`ShowDbStructure*`, `ShowStats`, `NumFavoriteTables`). Bulk actions become a toolbar with the same groups; copy/prefix actions open modals whose payloads match `CopyTableController` / `ReplacePrefixController`; drop/empty open confirm dialogs that display the exact SQL and the FK-checks toggle. Favorites: keep both the server list (`pma__favorite`) and a local cache keyed by user hash so the sidebar can render instantly.

**Databases list / create.** One table component with optional statistics columns (toggle persisted in the URL as `statistics=1`), client filter, bulk drop with a confirmation that lists each statement, inline create form that redirects into the new DB's default tab.

**Operations.** Straightforward forms; the rename/copy pipeline must be a server job that streams the accumulated SQL log (routines → stand-in views → tables+triggers → real views → constraints → events → bookmarks → privilege adjustment → optional DROP). Preserve the MERGE-table rule and the "switch to copied database" session flag.

**Search / Query.** Search is a pure server computation (build the WHERE per table, run COUNT, then on demand SELECT/DELETE); render results in the shared result grid. For the multi-table builder, port `query_generator.ts` logic to a typed query-model (columns, aliases, criteria tree with AND/OR, FK join inference from `key_column_usage`) and render the SQL into the shared editor; results go through the shared SQL execution endpoint. If a QBE-style grid is wanted, note that master has removed it; `pma__savedsearches` can be reused to add "saved queries" to the new builder.

**Routines / Events / Triggers.** Model as CRUD resources with: list endpoint (information_schema), "definition" endpoint (`SHOW CREATE …`), editor schema (the exact field lists above), server-side query composition + validation messages identical to `Routines::getQueryFromRequest` / `Events::getQueryFromRequest`, and the edit = backup → drop → create → restore-on-failure transaction. Execute-routine needs a parameter form generator (OUT params skipped, ENUM radios, SET checkboxes, date pickers, optional function wrapper) and a multi-result-set renderer.

**Tracking.** Reuse the table-level tracking service; the DB page is two lists (tracked with last-version metadata and activate/deactivate toggle; untracked) plus a "create version N" form seeded from `tracking_default_statements`.

**Designer — recommended canvas approach.** Replace the DOM-tables-over-`<canvas>` hybrid with a single interactive canvas/SVG scene graph (e.g. an SVG layer for nodes and edges, or a WebGL/canvas renderer with hit-testing) holding: table nodes (collapsible, with column rows carrying key/type icons and the display-field marker), edge objects for FK and internal relations (distinguished visually), and an orthogonal/straight edge router equivalent to `reload()` (choose nearest side, route to the column row's y). Keep the state model: `{pageId, pageName, dirty, tables: {id, db, name, x, y, collapsed, visible}, relations: [{constraint?, src, srcCol, dst, dstCol, kind: 'fk'|'internal'}], displayFields, settings}`. Persist positions in `pma__table_coords`/`pma__pdf_pages` (or IndexedDB when pmadb is absent — keep this fallback, it is what offline mode does), settings in `pma__designer_settings` (same JSON keys so existing data loads), display fields in `pma__table_info`, internal relations in `pma__relation`. Implement relationship creation as a two-click (or drag) gesture with the same validations (key requirement, index requirement, engine compatibility) and the ON DELETE / ON UPDATE options; deletion by selecting an edge. Toolbar actions map 1:1 to the side-menu list above (fullscreen, tables panel, pages CRUD, add tables from other DBs, snap to grid, angular/direct, small/big, relation lines, pin labels, menu side, export). Schema export stays a server endpoint receiving `{page, format, options, coordinates}` and streaming PDF/SVG/DIA/EPS with the option sets listed. The visual query builder can be rebuilt on the same scene graph: column selection toggles, a per-column options popover (where/rename/aggregate/group/order/having), a history list, and the `buildQuery` composition — but route its submission to the SQL execution endpoint rather than the dead `/database/qbe` route.

**Central columns.** A paginated editable grid (inline row edit, multi-edit, delete, add-new, add-from-table) over `pma__central_columns`; keep the `extra,attribute` packing or migrate it to two columns while preserving the API semantics; expose `getListRaw` for the table-structure editor's "pick from central list".

**Data dictionary.** A print-oriented read-only view; reuse the table-structure column/index models and the relation/MIME lookups.

**Config-storage check.** Render as a diagnostic page of feature → required tables → status, with the three "create" actions (new pmadb, in current db, missing tables).

### Unresolved / discrepancies noticed in source

- `designer/main.twig` posts the visual-builder SQL to `/database/qbe`, but no `qbe` route/controller exists in master (QBE removed); the Designer "Build Query → Submit" therefore has no working backend in this snapshot.
- `pma__savedsearches` is created and reported in check-relations but unused by any controller.
- The `charset` sortable header on DB Structure has no server-side sort mapping (falls back to Name).
- `pdf_show_table_dimension` / `svg_show_table_dimension` / `eps_show_table_dimension` are read by the schema plugins but not offered as UI options.
- Central columns has no explicit "number of rows to display" control; page size is the global `MaxRows`.
- No "Edit or export relational schema" link exists on the Operations page in master; schema export is only reachable from the Designer toolbar.

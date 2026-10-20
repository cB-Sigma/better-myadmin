# 07 — Export, Import and Schema Export

Source basis: phpMyAdmin `master` as of October 2026 (clone at `scratchpad/pma`). Every label, parameter name, default and behaviour below is taken from the files listed in the source map. Where the source contains an evident inconsistency or bug it is called out explicitly ("Source quirk") rather than silently "fixed", because a feature-for-feature clone must decide deliberately whether to reproduce it.

---

## Scope & source map

| Concern | Files |
|---|---|
| Export orchestration | `src/Export/Export.php` (dump walker, filename, locking, metadata types, HTML wrapper for "view as text"), `src/Export/OutputHandler.php` (buffering, compression, charset/kanji conversion, save-to-server), `src/Export/Options.php` (builds export page view-model), `src/Export/SeparateFiles.php`, `src/Export/StructureOrData.php`, `src/Export/Template.php`, `src/Export/TemplateModel.php` |
| Export controllers | `src/Controllers/Export/ExportController.php` (`/export`, executes the dump), `src/Controllers/Export/TablesController.php` (`/export/tables`), `src/Controllers/Export/CheckTimeOutController.php` (`/export/check-time-out`), `src/Controllers/Export/Template/{Create,Load,Update,Delete}Controller.php`, `src/Controllers/Server/ExportController.php` (`/server/export`), `src/Controllers/Database/ExportController.php` (`/database/export`), `src/Controllers/Table/ExportController.php` (`/table/export`), `src/Controllers/Table/ExportRowsController.php` (`/table/export/rows`) |
| Export plugins | `src/Plugins/ExportPlugin.php` (base), `src/Plugins/ExportType.php`, `src/Plugins/Export/Export{Sql,Csv,Excel,Json,Latex,Mediawiki,Ods,Odt,Pdf,Phparray,Texytext,Toon,Xml,Yaml,Htmlword,Codegen}.php`, `src/Plugins/Export/Helpers/Pdf.php` (TCPDF subclass), `src/Plugins/Export/Helpers/TableProperty.php` (CodeGen) |
| Option declaration system | `src/Plugins.php` (`getPlugin`, `getPlugins`, `getChoice`, `getOptions`, `checkboxCheck`, `getDefault`, `validatePluginNameOrUseDefault`), `src/Properties/Plugins/{ExportPluginProperties,ImportPluginProperties,SchemaPluginProperties,PluginPropertyItem}.php`, `src/Properties/Options/Groups/{OptionsPropertyRootGroup,OptionsPropertyMainGroup,OptionsPropertySubgroup}.php`, `src/Properties/Options/Items/{Bool,Hidden,MessageOnly,Number,Radio,Select,Text}PropertyItem.php` |
| Import orchestration | `src/Import/Import.php` (chunk reader, query runner, CSV/ODS/XML analysis & table builder, rollback), `src/Import/ImportSettings.php` (static state), `src/Import/Ajax.php` (upload-progress plugin selection), `src/Import/{ImportTable,AnalysedColumn,ColumnType,DecimalSize,SimulateDml}.php` |
| Import controllers | `src/Controllers/Import/ImportController.php` (`/import`), `src/Controllers/Import/StatusController.php` (`/import-status`), `src/Controllers/Import/SimulateDmlController.php` (`/import/simulate-dml`), `src/Controllers/Server/ImportController.php`, `src/Controllers/Database/ImportController.php`, `src/Controllers/Table/ImportController.php` |
| Import plugins | `src/Plugins/ImportPlugin.php`, `src/Plugins/Import/ImportFormat.php` (enum of allowed formats), `src/Plugins/Import/{ImportSql,AbstractImportCsv,ImportCsv,ImportLdi,ImportMediawiki,ImportOds,ImportShp,ShapeFileImport,ImportXml}.php`, `src/Plugins/Import/Upload/{UploadNoplugin,UploadProgress,UploadSession}.php`, `src/Plugins/UploadInterface.php` |
| Schema export | `src/Controllers/SchemaExportController.php` (`/schema-export`), `src/Plugins/SchemaPlugin.php`, `src/Plugins/Schema/{SchemaPdf,SchemaSvg,SchemaDia,SchemaEps}.php`, `src/Plugins/Schema/ExportRelationSchema.php`, `src/Plugins/Schema/{TableStats,RelationStats}.php`, `src/Plugins/Schema/{Pdf,Svg,Eps,Dia}/*.php`, `src/Database/Designer.php::getHtmlForSchemaExport`, `resources/templates/database/designer/schema_export.twig`, `resources/js/designer/move.ts` (export dialog) |
| Files / compression / charsets | `src/File.php`, `src/ZipExtension.php`, `src/FileListing.php`, `src/Encoding.php`, `src/Charsets.php` (`$mysqlCharsetMap`), `src/OpenDocument.php`, `src/Util.php` (`expandUserString`, `getUploadSizeInBytes`, `getFormattedMaximumUploadSize`, `getCompressionMimeType`, `userDir`), `src/Sanitize.php::sanitizeFilename`, `src/Core.php::downloadHeader`, `src/Utils/ForeignKey.php` |
| Config | `src/Config/Settings.php` (SaveDir, UploadDir, ZipDump, GZipDump, BZipDump, CompressOnFly, ExecTimeLimit, MemoryLimit, SkipLockedTables, ShowSQL, RecodingEngine, IconvExtraParams, AvailableCharsets, PDFPageSizes, PDFDefaultPageSize, enable_drag_drop_import, IgnoreMultiSubmitErrors, MaxCharactersInDisplayedSQL, DefaultForeignKeyChecks, TempDir), `src/Config/Settings/Export.php`, `src/Config/Settings/Import.php`, `src/Config/Settings/Schema.php`, `src/Config/Forms/User/{ExportForm,ImportForm}.php` (what the page-settings gear exposes) |
| Templates | `resources/templates/export.twig` (base), `server/export/index.twig`, `database/export/index.twig`, `table/export/index.twig`, `export/template_options.twig`, `export_modal.twig` (privileges export modal shell; not part of the dump flow), `import.twig`, `server/import/index.twig`, `database/import/index.twig`, `table/import/index.twig`, `import_status.twig`, `file_select_options.twig`, `encoding/kanji_encoding_form.twig`, `navigation/main.twig` (drag-drop markers) |
| Client scripts | `resources/js/export.ts`, `resources/js/export_output.ts`, `resources/js/import.ts`, `resources/js/drag_drop_import.ts`, `resources/js/sql.ts` (results "Export" multi-submit), `resources/js/database/structure.ts` ("With selected: Export") |
| pmadb | `resources/sql/create_tables.sql` → `pma__export_templates`; also `pma__pdf_pages`, `pma__table_coords` (schema export page names), and every pmadb table listed in `Export::getMetadataTypes()` (SQL "Export metadata") |

Not covered here (owned by other areas): bookmark CRUD UI on the SQL tab, the Designer canvas itself, user-privileges export (`export_modal.twig`), tracking export.

---

## Export UI

### Purpose

Produce a dump of the whole server, one database, one table, or the result of an arbitrary SELECT ("raw query") in one of 16 formats, either shown inline as text, downloaded as a file (optionally zip/gzip-compressed, optionally charset-converted, optionally as separate files inside a zip), or written to a server-side directory (`SaveDir`). Settings can be remembered as named "export templates" in pmadb.

### Entry points and scopes

`ExportType` enum (`src/Plugins/ExportType.php`): `server`, `database`, `table`, `raw`.

| Route | Method | Scope | Notes |
|---|---|---|---|
| `/server/export` | GET/POST | `server` | Lists all non-system databases. If super user, selects `mysql` DB first. |
| `/database/export` | GET/POST | `database` or `raw` | Requires `db`; redirects to `/` with "No database selected." if the DB does not exist. Fails with "No tables found in database." when `getTables(db)` is empty. Becomes `raw` when body has `raw_query` or when returning (`export_type=raw`) from a raw export. Accepts `selected_tbl[]` (from DB structure) or `table_select[]`/`table_structure[]`/`table_data[]` (repopulate) to pre-check rows. |
| `/table/export` | GET/POST | `table` or `raw` | Requires `db` and `table` unless `raw_query`. If a `sql_query` is present it is parsed; `LIMIT` is removed and, when `Current::$whereClause` was set (rows export), the WHERE is replaced by `WHERE (c1) OR (c2) …` (`Query::replaceClauses`). |
| `/table/export/rows` | POST | `table` | "With selected → Export" on a result grid (`resources/js/sql.ts`, action `export`). Requires `rows_to_delete[]` (checkbox values are the per-row unique WHERE clauses rendered by `display/results/checkbox_and_links.twig`), else JSON error "No row selected.". Forces `Export::$singleTable = true` ("Needed to allow SQL export"), builds `Current::$whereClause` from the values and delegates to `/table/export`. |
| `/export/tables` | POST | `database` | "With selected → Export" on DB structure (`resources/js/database/structure.ts`). Requires `selected_tbl[]`, else JSON error "No table selected."; delegates to `/database/export`. |
| `/export` | GET/POST | all | Executes the dump (form `name="dump"`, class `disableAjax`, so it is a full-page POST that yields a download). |
| `/export/check-time-out` | GET (ajax) | – | Returns `{message:'timeout'}` if `$_SESSION['pma_export_error']` is set (and clears it), else `'success'`. |
| `/export/template/create|load|update|delete` | POST (ajax) | – | Export templates CRUD (see pmadb storage). |

Results-grid link (`src/Display/Results.php::getResultsOperations`): an "Export" link exists for any SELECT without `PROCEDURE`; parameters `db`, `table`, `printview=1`, `sql_query`, `unlim_num_rows`, plus `single_table=true` when the statement selects exactly one table, and `raw_query=true` when it selects from no table at all. If no `table` could be determined but `db` is set, `table` is set to the first name returned by `SHOW TABLES` so `/table/export` does not fail.

`single_table` meaning (ExportPlugin::$singleTable): when exporting at `table` scope **without** `single_table`, the SQL plugin (`ExportSql::setProperties`, `$hideSql`) and the structure sections of LaTeX/ODT (`$hideStructure`) hide their options (SQL shows *no* options at all unless `raw_query` is set). With `single_table` (default from table Export tab links and from rows export) the full option set is shown.

### Layout (top to bottom), from `resources/templates/export.twig`

1. **Title** with `b_export` icon: "Exporting databases from the current server" / "Exporting tables from "%s" database" / "Exporting rows from "%s" table" / "Exporting a raw query".
2. **Page settings** block (`PageSettings::init('Export')`) — the gear icon that exposes the `Export/*` user preferences listed in `src/Config/Forms/User/ExportForm.php` (groups: Export_defaults, Sql, CodeGen, Csv, Latex, Microsoft_Office, Open_Document, Texy). Flash messages follow (results of save-to-server).
3. **Export templates** card (only when `exportTemplatesFeature` is configured).
4. **SQL query** card (only when `sql_query` non-empty): button "Show SQL query" opens modal `#showSqlQueryModal` with the highlighted query (`highlightSql`).
5. The `dump` form containing: hidden inputs → **Export method** card → **Format** card → scope-specific **selection** block → **Rows** card → **Output (quick)** card → **Rename** modal → **Output** card → **Format-specific options** card → **Encoding Conversion** card (Japanese UI only) → **Export** button.

### Every control

**Hidden inputs** (`Options::getOptions`): `db`, `table`, `export_type`, `export_method` (POST `export_method` or `Export/method`), `template_id` (POST or ''), `single_table` (only when `Export::$singleTable`), `sql_query` (only when non-empty).

**Export templates card** (`templates.is_enabled`):
- Fieldset "New template:" — text `templateName` (`maxlength=64`, `required`, placeholder "Template name"), submit `createTemplate` "Create". JS intercepts: POSTs `/export/template/create` with `exportType`, `templateName`, `templateData` = JSON of `getTemplateData()`; on success replaces the `#template` select with returned `<option>`s, selects the new one, toast "Template was created.".
- Fieldset "Existing templates:" — select `template` (`required`; first option "-- Select a template --"), submit `updateTemplate` "Update" (formaction `/export/template/update`), submit `deleteTemplate` "Delete" (formaction `/export/template/delete`). JS: `change` on select loads (POST `/export/template/load` → JSON `data` is the saved object; each key is applied to `[name=key]` in the form: `null` unchecks a checkbox; arrays are set on checkboxes/radios/multiselects; `.trigger('change')` fires on each; `template_id` hidden is set; toast "Template was loaded."). Update: toast "Template was updated."; Delete: removes the option, toast "Template was deleted.".
- `getTemplateData()` (`export.ts`): serializes `form[name=dump]` excluding `token, server, db, table, single_table, export_type, export_method, sql_query, template_id`; repeated names become arrays; **unchecked checkboxes are stored as `null`**; selects with no selected option are stored as `[]`.

**Export method** card `#quick_or_custom` (omitted entirely when `Export/method == 'custom-no-form'`): radios `quick_or_custom` = `quick` ("Quick - display only the minimal options") / `custom` ("Custom - display all possible options"). Checked from POST `quick_or_custom` else `Export/method`. `toggleQuickOrCustom()`: custom shows `#databases_and_tables`, `#rows`, `#output`, `#format_specific_opts` and hides `#output_quick_export`; quick does the inverse. When no `#quick_or_custom` exists (custom-no-form) everything behaves as custom.

**Format** card: `<select id="plugins" name="what">` with one option per export plugin, `data-is-binary` = plugin `forceFile` (true for ods, odt, pdf, toon, yaml, htmlword). Selected = `what` param, else `format` param, else `Export/format` (default `sql`); invalid names fall back to `sql` (`validatePluginNameOrUseDefault`). On change: shows only `#<name>_options`; **selecting `excel` switches the charset select to `windows-1252`, selecting anything else resets it to `utf-8`**; binary formats force "Save output to a file" and disable "View output as text".

**Selection — server scope** (`server/export/index.twig`): card "Databases" with buttons `#db_select_all` "Select all" / `#db_unselect_all` "Unselect all" and `<select name="db_select[]" id="db_select" size="10" multiple>`; all non-system DBs preselected unless POST `db_select` given (string form `a,b,c` from the Back link is url-decoded and exploded).

**Selection — database scope** (`database/export/index.twig`): card "Tables:" (scrollable, max-height 20em) with hidden `structure_or_data_forced`; a table with header "Tables | Structure | Data", a "Select all" row (`#table_structure_all`, `#table_data_all` checkboxes with aria labels "Export the structure of all tables." / "Export the data of all tables."), and one row per table: `table_select[]` (class `checkall`), name, `table_structure[]`, `table_data[]`. All checked by default; from `selected_tbl[]`/`table_select[]` otherwise. JS behaviour (`export.ts`):
- `table_select[]` change → `toggleTableSelect` checks/unchecks both sub-boxes of the row and toggles `marked` class.
- Sub-box change → `checkTableSelected`: both → select checked, one → select checked + `indeterminate`, none → unchecked.
- `checkTableSelectAll`: header boxes become checked / unchecked / indeterminate.
- `handleAddProcCheckbox`: `#checkbox_sql_procedure_function` is checked iff both header boxes are checked, unchecked otherwise.
- `checkTableSelectStructureOrData`: when no data box is checked the `#<plugin>_data` option group slides up and `#checkbox_sql_auto_increment` is disabled.
- At database scope the per-plugin `*_structure_or_data` **radios are removed** and replaced by a hidden `<name>_structure_or_data=structure_and_data` plus a disabled hidden `<name>_structure_or_data_default` holding the configured default; `#checkbox_sql_create_table` is forced checked, disabled and shadowed by a hidden clone. `setupTableStructureOrData()` then: if the plugin had no radio (CSV, Excel, JSON, ODS, PHP array, XML, YAML, CodeGen, TOON) → `structure_or_data_forced=1`, structure/data checkboxes disabled and faded; else `structure_or_data_forced=0` and the default decides which column is pre-checked (`structure` unchecks data boxes, `data` unchecks structure boxes; if nothing is checked in a required column all selected rows get checked).

**Rows** card `#rows` (table scope; rendered only when `table !== ''`, `numTables === 0`, table is not a MERGE table and type is not `raw`): radios `allrows=1` "Dump all rows" / `allrows=0` "Dump some row(s)"; `limit_to` "Number of rows:" (value: POST `limit_to`, else `unlim_num_rows` if non-zero, else `Table::countRecords()`), `limit_from` "Row to begin at:" (default 0); both have `onfocus=this.select()`. Sub-inputs disabled/faded unless "Dump some row(s)". `toggleStructureDataOpts()` hides `#rows` when the plugin's structure/data radio is `structure`.

**Output (quick)** card `#output_quick_export` (only when `SaveDir` non-empty): switches `quick_export_onserver=saveit` "Save on server in the directory **<userDir(SaveDir)>**" (default `Export/quick_export_onserver`), `quick_export_onserver_overwrite=saveitover` "Overwrite existing file(s)" (default `Export/quick_export_onserver_overwrite`).

**Output** card `#output`:
- Switch `#btn_alias_config` "Rename exported databases/tables/columns" (checked when session has non-empty aliases). Click opens modal `#renameExportModal` (see Interactions). The modal's `<tbody>` is pre-filled from `$_SESSION['tmpval']['aliases']` (then unset) so a Back/repopulate round-trip keeps aliases.
- Switch `lock_tables=y` "Use `LOCK TABLES` statement" — **not shown at server scope**; checked if `Export/lock_tables` (unless `repopulate`) or POST `lock_tables`.
- Radios `output_format`: `astext` "View output as text" (checked on `repopulate` or when `Export/asfile` is false) / `sendit` "Save output to a file" (checked when `Export/asfile` and not repopulate). `toggleSaveToFile()` fades/disables the whole `#ul_save_asfile` block when not saving to file.
- Inside `#ul_save_asfile`:
  - (if `SaveDir`) switches `onserver=saveit` "Save on server in the directory **…**" (`Export/onserver`), `onserver_overwrite=saveitover` "Overwrite existing file(s)" (`Export/onserver_overwrite`).
  - "File name template:" text `filename_template` with hint "This value is interpreted using the 'strftime' function, so you can use time formatting strings. Additionally the following transformations will happen: %s Other text will be kept as is. See the FAQ 6.27 for details." where `%s` is scope-specific: server "@SERVER@ will become the server name.", database "@SERVER@ will become the server name and @DATABASE@ will become the database name.", table "@SERVER@ will become the server name, @DATABASE@ will become the database name and @TABLE@ will become the table name.". Value: POST `filename_template`, else user-pref cookie `pma_server_filename_template` / `pma_db_filename_template` / `pma_table_filename_template`, else `Export/file_template_server|database|table` (defaults `@SERVER@`, `@DATABASE@`, `@TABLE@`). Switch `remember_template` "Use this for future exports" (default `Export/remember_file_template` = true).
  - (if `Encoding::isSupported()`) "Character set of the file:" `<select name="charset" id="select_charset">` over `Encoding::listEncodings()`; selected = `Export/charset` or `utf-8` when empty.
  - (if zip or gzip available) "Compression:" `<select name="compression" id="compression">` options `none` "None", `zip` "zipped" (if `ZipDump && gzcompress`), `gzip` "gzipped" (if `GZipDump && gzencode`); selected = POST `compression`, else `Export/compression`, forced to `zip` when `Export/as_separate_files` is on. If neither is available a hidden `compression` input carries the selected value.
  - (server/database scope) switch `as_separate_files` with `value="<export_type>"`: "Export databases as separate files" (server) / "Export tables as separate files" (database); default `Export/as_separate_files`. JS: checking it sets compression to `zip`; choosing a non-zip compression unchecks it.
- "Skip tables larger than:" `<input type="number" name="maxsize" id="maxsize">` with help "The size is measured in MiB." (no default).

**Format-specific options** card `#format_specific_opts`: raw HTML from `Plugins::getOptions(PluginType::Export, $exportList)` — one `<div id="<name>_options" class="format_specific_options">` per plugin containing `<h3>Text</h3>` (removed by JS), then per `OptionsPropertyMainGroup` a `<div id="<group name>">` with optional `<h5>` title and a `<ul class="list-group">`; subgroups render their header item then `<li><ul id="ul_<header name>">…</ul></li>`. A main group with only hidden items prints "This format has no options". Item renderers (`src/Properties/Options/Items/*`): Bool → switch `name=<opt> value=y id=checkbox_<opt>` checked by `Plugins::checkboxCheck` (GET `opt` wins when `repopulate`; else `$_REQUEST[opt]` when import timeout passed; else config `[Export][opt]` truthy); Text → `input type=text id=text_<opt>` (optional `size`, `maxlength`); Number → `input type=number min=0 id=number_<opt>`; Select → `select id=select_<opt>`; Radio → `input type=radio id=radio_<opt>_<key>`; Hidden → `input type=hidden`; MessageOnly → text; all defaults from `Plugins::getDefault` (GET `opt` → `$_REQUEST[opt]` on import-timeout → config `[Export][opt]` → ''). Doc links (`setDoc`) render a MySQL-docs or FAQ anchor after the control.

**Encoding Conversion** card `#kanji_encoding` (only when UI language is `ja`): radios `knjenc` = '' "None" (checked) / `EUC-JP` "EUC" / `SJIS` "SJIS"; checkbox `xkana=kana` "Convert to Kana".

**Export** button `#buttonGo` (`data-exec-time-limit="<ExecTimeLimit>"`). On click, if the limit > 0, JS schedules a GET to `/export/check-time-out` after `limit+1` seconds and shows the error toast "Your export is incomplete, due to a low execution time limit at the PHP level!" when the server reports `timeout`.

### Interactions

**Rename aliases modal** (`#renameExportModal`, title "Rename exported databases/tables/columns"): table `#alias_data` "Defined aliases" with rows of type Database/Table/Column (`aliases[db][alias]`, `aliases[db][tables][t][alias]`, `aliases[db][tables][t][colums][c]`) each with a "Remove" button; a hidden `<tfoot>` row template; table "Define new aliases" with three rows: "Select database:" `#db_alias_select` + `#db_alias_name` (placeholder "New database name") + "Add"; "Select table:" `#table_alias_select` + `#table_alias_name` + "Add"; "Select column:" `#column_alias_select` + `#column_alias_name` + "Add". Footer "Save & close". JS: on show, if a current `db` exists it is the only option (auto-selected), else `/databases` is fetched; selecting a DB populates tables (current `table` only, or `/tables`); selecting a table fetches `/columns`. Inputs/buttons of a row are enabled only when the select has a value. `addAlias()` clones the tfoot row, sets the field name/value, replaces any existing row with the same name. On hide, empty inputs' rows are removed and `#btn_alias_config` is checked iff any alias remains. **Source quirk:** the column alias field is named `[colums]` in both twig and JS while `Export::mergeAliases` and `ExportPlugin::getColumnAlias` read `['columns']`; column aliases entered through the modal therefore never reach the plugins (only column aliases derived from the SELECT query's `AS` clauses do). Reproduce or fix consciously.

**SQL-specific toggles** (`export.ts`): `sql_structure_or_data` change — `data` disables `#checkbox_sql_dates` (if comments on), `#checkbox_sql_relation`, `#checkbox_sql_mime`; `structure` disables `#checkbox_sql_auto_increment`. `#checkbox_sql_include_comments` change — unchecked fades/disables everything under `#ul_sql_include_comments`; checked re-enables (only `#text_sql_header_comment` when the `data` radio is selected). `toggleStructureDataOpts()` on any `*_structure_or_data` radio — slides `#<plugin>_data` / `#<plugin>_structure` groups up or down and hides `#rows` for `structure`.

**View as text result page**: `/export` echoes `Export::getHtmlForDisplayedExportHeader` — "[ Back ]" link (to the scope's export route with all scalar POST params and `repopulate=1` appended), "[ Refresh ]" (hidden form `#export_refresh_form` re-POSTing every original param to `/export`; also bound to the F5 key code 116 by `export_output.ts`), "[ Copy to clipboard ]" (copies `#textSQLDUMP`), then `<textarea name="sqldump" id="textSQLDUMP" wrap="OFF">` sized to the window by inline script; footer repeats the three links. Content is `htmlspecialchars`-escaped line by line. At database scope with zero selected tables the controller instead re-renders the export page with "No tables found in database.".

### Server-side behaviour (`/export`, `ExportController`)

1. Reads `quick_or_custom`, `output_format`, `compression`, `as_separate_files`, `quick_export_onserver`, `onserver`, `aliases[]`, `structure_or_data_forced`, `remember_template`, `db_select`, `table_structure`, `lock_tables`, `single_table`, `charset` → `Current::$charset`, `knjenc`, `xkana`, `maxsize` → `Export::$tableMaxSizeInMb`, `table_select`, `table_data` → `Export::$tableData`, `what` (`Core::securePath`; missing → "missing parameter" error), `export_type`.
2. Instantiates the plugin (`Plugins::getPlugin('export', what, exportType, singleTable)`); unknown → "Bad type!". Calls `setExportOptions(request, config->Export)` — each plugin reads its own `*_` params (checkboxes by presence, text/select by value falling back to config).
3. Output mode: `output_format === 'astext'` → `OutputHandler::$asFile = false`; else file. Separate-files is honoured **only when compression is `zip`**. Compression applied only if in the allowed list. Save-on-server when (`quick` and `quick_export_onserver`) or (`custom` and `onserver`) **and** `SaveDir !== ''`.
4. Scope validation: database needs `db` and `table_select` (array of strings asserted); table needs `db` and `table`.
5. Aliases: SELECT aliases parsed from `Current::$sqlQuery` (`SelectStatement::getAliases(db)`), merged with POST aliases (POST wins when non-empty, `mergeAliases`); POST aliases are stored in `$_SESSION['tmpval']['aliases']`.
6. `Util::setTimeLimit(ExecTimeLimit)`; `ini_set('memory_limit', MemoryLimit)` unless `''`/`'0'`; shutdown function records `$_SESSION['pma_export_error']` when the last error mentions "execution time".
7. Kanji conversion enabled when UI lang is `ja`; charset conversion enabled when file output, `Encoding::isSupported()`, charset set, `!== 'utf-8'` and in `listEncodings()`.
8. On-the-fly gzip: `memoryLimit = (memory_limit − 1.5 MB if > 1.5 MB) / 8`; when buffered bytes exceed it, the buffer is charset-converted, gzencoded (if needed) and flushed (to file or stdout).
9. Filename: `remember_template` → `rememberFilename` stores the template in user prefs `Export/file_template_<scope>` with cookie name `pma_<server|db|table>_filename_template`. Final name = `Sanitize::sanitizeFilename(Util::expandUserString(template), replaceDots=true)` → `getFinalFilename` appends `.<ext>` unless the name already ends with it (case-insensitive), then `.gz` or `.zip`. `expandUserString` runs `strftime()` on the whole string then replaces `@HTTP_HOST@`, `@SERVER@`, `__SERVER__`, `@VERBOSE@`, `@VSERVER@`, `@DATABASE@`, `__DB__`, `@TABLE@`, `__TABLE__`, `@PHPMYADMIN@` ("phpMyAdmin <version>"), `@COLUMNS@` (comma list of the current table's columns; `@FIELDS@` is an alias). `sanitizeFilename` keeps only Unicode letters/digits, `_`, `-` (and `.` unless replaceDots). Raw exports are always named `export.<ext>`. MIME: `application/x-gzip`, `application/zip`, else plugin MIME.
10. Save on server: `OutputHandler::openFile` → path `userDir(user, SaveDir) . preg_replace('@[/\\\\]@','_',filename)`. Errors (flash + redirect back): "File %s already exists on server, change filename or check overwrite option." (exists and overwrite not ticked for the active mode), "The web server does not have permission to save the file %s." (not writable / fopen failed). On completion `closeFile` writes remaining buffer → "Insufficient space to save the file %s." or success "Dump has been saved to file %s." (flash `success`, redirect to the scope's export page).
11. Download: `ini_set('url_rewriter.tags','')`, `Core::downloadHeader(filename, mime)` (removes `Content-Encoding`).
12. Dump: `clearBuffer()`; for XML `setTables($tableNames)`; `exportHeader()`; then by scope: `exportServer(db_select)`, `exportDatabase(...)` (with `structure_or_data_forced` → structure and data lists = all selected tables; `lock_tables` → `LOCK TABLES db.t READ, …` and `UNLOCK TABLES` in `finally`), `exportRawQuery(db, sql)`, or `exportTable(db, table, allrows, limit_to, limit_from, sql_query)` (also lockable); `exportFooter()`. `ExportException` is swallowed (partial output already written is returned).
13. Post: if not file → footer HTML. Else `convertBufferCharset()`, `compress(separate, filename)` (zip: `ZipExtension::createFile(buffer|buffers, filename-without-.zip)`; gzip: `gzencode`), then write to file or return body.

**Dump walk order (`Export::exportDatabase`)** — this is the order every structured plugin sees:
1. `exportDBHeader(db, dbAlias)`; 2. `exportDBCreate(db, dbAlias)`; [separate-files: save `database`]; 3. if structure: `exportRoutines(db)` [save `routines`]; 4. prefetch `getTablesFull(db, tables)`; 5. for each table in the given order: views are collected; if structure and table in `tableStructure`: view → `exportStructure(..., 'stand_in')` **only in single-file mode**; table → skipped entirely when `exceedsMaxTableSize` (query `data_length + index_length` from `information_schema.TABLES`, compared in MiB to `maxsize`; evaluated only for non-views and only when structure is included) else `exportStructure(..., 'create_table')`; if data and table in `tableData` and not a view: `SELECT <non-generated columns> FROM db.t` → `exportData`; tables with no non-generated columns are skipped; [save `table_<t>`]; if structure: `exportStructure(..., 'triggers')` (after data, "because triggers can modify already imported tables") [append to `table_<t>`]; 6. for each view, if structure: `exportStructure(..., 'create_view')` [save `view_<v>`]; 7. `exportDBFooter(db)` [save `extra`]; 8. `exportMetadata(db, tables, metadataTypes)` [save `metadata`]; 9. if structure: `exportEvents(db)` [save `events`].

`exportTable`: DBHeader → (structure) `create_view` or `create_table` → (data) query: if `sql_query` given, strip trailing `;` when adding ` LIMIT [from, ]to` (only when `allrows === '0'`, `limit_to > 0`, `limit_from >= 0`) and `selectDb`; else `SELECT nongenerated FROM db.t LIMIT…` → (structure) `triggers` → DBFooter → `exportMetadata(db, table)`.

`exportServer`: iterates `getDatabaseList()` keeping those in `db_select`; each DB is exported with all its tables; in `SeparateFiles::Server` mode each DB buffer is saved under its name.

`getMetadataTypes()` (always all, "in the future these can be allowed to be selected"): `column_info`, `table_uiprefs`, `tracking`, `bookmark`, `relation`, `table_coords`, `pdf_pages`, `savedsearches`, `central_columns`, `export_templates`.

### Config directives (defaults from `Settings.php` / `Settings/Export.php`)

Top-level: `SaveDir` `''`; `UploadDir` `''`; `ZipDump` `true`; `GZipDump` `true`; `BZipDump` `true`; `CompressOnFly` `true`; `ExecTimeLimit` `300` (≥0 else 300); `MemoryLimit` `'-1'` (string); `SkipLockedTables` `false` (not referenced by the export code path); `ShowSQL` `true`; `MaxSizeForInputField` `60`; `RecodingEngine` `'auto'` (valid: `auto`, `iconv`, `mbstring`, `none`; `recode` maps to `mbstring`); `IconvExtraParams` `'//TRANSLIT'`; `AvailableCharsets` = `iso-8859-1 … iso-8859-15, windows-1250, windows-1251, windows-1252, windows-1256, windows-1257, koi8-r, big5, gb2312, utf-16, utf-8, utf-7, x-user-defined, euc-jp, ks_c_5601-1987, tis-620, SHIFT_JIS, SJIS, SJIS-win` (34 entries); `TempDir` `ROOT/tmp/`; `MaxCharactersInDisplayedSQL` `1000`; `IgnoreMultiSubmitErrors` `false`; `enable_drag_drop_import` `true`; `DefaultForeignKeyChecks` `'default'`; `PDFPageSizes` `['A3','A4','A5','letter','legal']`; `PDFDefaultPageSize` `'A4'`. There is **no** `allow_recoding` directive in current master; `Encoding::isSupported()` is purely `RecodingEngine !== 'none'` after auto-detection (`iconv` preferred, then `mbstring`). `Encoding::listEncodings()` returns `AvailableCharsets` (minus anything matching `ISO-2022-CN-EXT`, CVE-2024-2961) for iconv, or the intersection of `mb_list_encodings()` (lower-cased) with `AvailableCharsets` for mbstring.

`$cfg['Export']` general keys: `format` `'sql'`; `method` `'quick'` (`quick|custom|custom-no-form`); `compression` `'none'` (`none|zip|gzip`); `lock_tables` `false`; `as_separate_files` `false`; `asfile` `true`; `charset` `''`; `onserver` `false`; `onserver_overwrite` `false`; `quick_export_onserver` `false`; `quick_export_onserver_overwrite` `false`; `remember_file_template` `true`; `file_template_table` `'@TABLE@'`; `file_template_database` `'@DATABASE@'`; `file_template_server` `'@SERVER@'`; `remove_definer_from_definitions` `false`. Per-plugin keys are listed in each plugin section.

### pmadb storage

`pma__export_templates` (`resources/sql/create_tables.sql`): `id int(5) unsigned AUTO_INCREMENT PK`, `username varchar(64)`, `export_type varchar(10)` (`server|database|table|raw`), `template_name varchar(64)`, `template_data text`, `UNIQUE u_user_type_template (username, export_type, template_name)`, comment "Saved export templates", `utf8mb4_bin`. `TemplateModel`: `create` INSERT; `delete`/`load`/`update` filter by `id` **and** `username`; `getAll` filters `username` and `export_type`, `ORDER BY template_name`. All run as the control user; DB errors are returned as the JSON `message` with `success=false`. The feature is active only when `exportTemplatesFeature` (relation param `export_templates`) is configured. User-preference storage is also touched: `Export/file_template_*` via `UserPreferencesHandler::setUserValue` with cookie fallbacks.

---

## Export plugin catalog

Common contract (`ExportPlugin`): `exportHeader()`, `exportFooter()`, `exportDBHeader(db, alias)`, `exportDBFooter(db)`, `exportDBCreate(db, alias)`, `exportData(db, table, sqlQuery, aliases)` (abstract), `exportRoutines`, `exportEvents`, `exportRawQuery(db, sql)`, `exportStructure(db, table, mode∈{create_table,triggers,create_view,stand_in}, aliases)`, `exportMetadata`, `getTableDefStandIn`, `setExportOptions(request, Export config)`, `includeStructure()/includeData()` derived from `$structureOrData` (`setStructureOrData(request value → config value → plugin default)`). Alias helpers `getDbAlias/getTableAlias/getColumnAlias`; `getRelationString` → "`ForeignTable (foreign_field)`". Every plugin writes through `OutputHandler::addLine`. All data queries run unbuffered on the user connection (except TOON, which is buffered to know the row count). Binary/GEOMETRY cells are emitted as `0x<hex>` in CSV, LaTeX, MediaWiki, PHP array, Texy, TOON, XML, YAML, JSON (BLOB/STRING with charsetnr 63), SQL (when `sql_hex_for_binary`); ODS/ODT emit an empty string cell for binary BLOBs and `0x…` only for GEOMETRY; PDF prints `[BLOB]`/`[GEOMETRY]`; HtmlWord prints the raw value escaped.

Plugin list (dropdown order is alphabetical by display text, case-insensitive): CodeGen, CSV, CSV for MS Excel, JSON, LaTeX, MediaWiki Table, Microsoft Word 2000, OpenDocument Spreadsheet, OpenDocument Text, PDF, PHP array, SQL, Texy! text, TOON, XML, YAML. Availability: PDF requires `TCPDF` class **and** `curl` extension; XML requires a current database (not offered at server scope); everything else always.

### SQL (`ExportSql`, name `sql`, ext `sql`, MIME `text/x-sql`, default plugin)

Default structure/data: `structure_and_data`. Options are hidden at table scope unless `single_table` or `raw_query`.

Group `sql_general_opts` (no title):

| Label | Param | Config default | Effect |
|---|---|---|---|
| Display comments *(includes info such as export timestamp, PHP version, and server version)* (subgroup header) | `sql_include_comments` | `true` | `$doComments`: enables every `-- ` comment line (header block, section banners, table banners, constraint banners) and the blank lines produced by `possibleCRLF()`. When off the dump contains no comments and almost no blank lines. |
| Additional custom header comment (\n splits lines): | `sql_header_comment` (text) | `''` | Appended after the standard header, each `\n` (the two characters backslash-n) starts a new `-- ` line, wrapped in empty `--` lines. |
| Include a timestamp of when databases were created, last updated, and last checked | `sql_dates` | `false` | `getTableStatus`: before each CREATE TABLE prints `-- Creation: <localised Create_time>`, `-- Last update: …`, `-- Last check: …` (each only if present). |
| Display foreign key relationships (only if relation feature) | `sql_relation` | `false` | After CREATE TABLE prints `-- RELATIONSHIPS FOR TABLE `t`:` then per internal relation `--   `col`` / `--       `ftable` -> `fcol`` and the same for native FOREIGN KEYs. |
| Display media types (only if browser-transformation feature) | `sql_mime` | `false` | Prints `-- MEDIA TYPES FOR TABLE `t`:` with `--   `col`` / `--       `mimetype``. |
| Enclose export in a transaction (doc: mysqldump --single-transaction) | `sql_use_transaction` | `true` | `START TRANSACTION;` in header, `COMMIT;` in footer. |
| Disable foreign key checks (doc: foreign_key_checks) | `sql_disable_fk` | `false` | `SET FOREIGN_KEY_CHECKS=0;` in header, `SET FOREIGN_KEY_CHECKS=1;` in footer. |
| Export views as tables | `sql_views_as_tables` | `false` | Views are emitted as `CREATE TABLE` built from `getColumns` (type, COLLATE, NOT NULL, DEFAULT, COMMENT) with banner "Structure for view %s exported as a table", and view **data is exported** (otherwise a view yields `-- VIEW `v`` / `-- Data: None`). |
| Export metadata | `sql_metadata` | `false` | Emits pmadb rows (see below). |
| Database system or older MySQL server to maximize output compatibility with: (doc: sql-mode) | `sql_compatibility` (select) | `'NONE'` | Values `NONE, ANSI, DB2, MAXDB, MYSQL323, MYSQL40, MSSQL, ORACLE, TRADITIONAL` (`DatabaseInterface::getCompatibilities`; POSTGRESQL deliberately removed). Header runs `SET SQL_MODE="<compat or ''>"` on the connection; `NONE` adds `SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";`; identifiers quoted via `Util::backquoteCompat` (ANSI quotes for non-NONE modes when backquotes on); `USE` statement unquoted for non-NONE; `MSSQL` additionally rewrites CREATE TABLE (see below) and wraps data in `SET IDENTITY_INSERT `t` ON ;` / `OFF;`. |
| Dump table (subgroup `sql_dump_table`) radios structure / data / structure and data | `sql_structure_or_data` | `'structure_and_data'` | Controls `includeStructure/includeData`. |

Group `sql_structure` "Object creation options":

| Label | Param | Default | Effect |
|---|---|---|---|
| Add statements: (message) | `sql_add_statements` | – | header text only |
| Add `DROP DATABASE IF EXISTS` statement (server scope only) | `sql_drop_database` | `false` | `DROP DATABASE IF EXISTS `db`;` before CREATE DATABASE (only when structure included). |
| Add `CREATE DATABASE / USE` statement (database scope only) | `sql_create_database` | `false` | `CREATE DATABASE IF NOT EXISTS `db` DEFAULT CHARACTER SET <cs> COLLATE <coll>;` + `USE `db`;`. At server scope CREATE DATABASE/USE is **always** emitted; data-only exports emit just `USE`. |
| Add `DROP TABLE / VIEW / PROCEDURE / FUNCTION / EVENT / TRIGGER` statement (table scope: `DROP TABLE / TRIGGER` or `DROP VIEW / TRIGGER` depending on the object) | `sql_drop_table` | `false` | `DROP TABLE IF EXISTS `t`;` / `DROP VIEW IF EXISTS `v`;` (stand-in and real view), `DROP PROCEDURE|FUNCTION IF EXISTS `r`$$`, `DROP EVENT IF EXISTS `e`$$`, trigger `DROP TRIGGER IF EXISTS …;`. |
| Add `CREATE TABLE` statement (subgroup header) | `sql_create_table` | `true` | Without it no table structure (and no triggers' banner) is emitted for `create_table`. Forced on at database scope by JS. |
| `IF NOT EXISTS` *(less efficient as indexes will be generated during table creation)* | `sql_if_not_exists` | `false` | Rewrites `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`; keeps non-FULLTEXT keys and `AUTO_INCREMENT` column attribute inline instead of deferring them to `ALTER TABLE`. |
| `AUTO_INCREMENT` value | `sql_auto_increment` | `true` | Appends `, AUTO_INCREMENT=<n>` to the deferred `ALTER TABLE … MODIFY` statement when the table has an AUTO_INCREMENT option and (no table_data list or the table is in it). Disabled by JS when structure-only or no data box checked. |
| Add `CREATE VIEW` statement (subgroup header) | `sql_create_view` | `true` | Enables `create_view` and `stand_in` output. |
| Use simple view export | `sql_simple_view_export` | not in config (unchecked) | Removes `SQL SECURITY`, `INVOKER`, `ALGORITHM`, `DEFINER` options from the parsed CREATE VIEW. |
| Exclude definition of current user | `sql_view_current_user` | `false` | Removes `DEFINER` from CREATE VIEW (also removed globally when `Export/remove_definer_from_definitions`). |
| `OR REPLACE` view | `sql_or_replace_view` | `false` | `CREATE` → `CREATE OR REPLACE` on views. |
| Add `CREATE PROCEDURE / FUNCTION / EVENT` statement | `sql_procedure_function` | `true` | Enables `exportRoutines` and `exportEvents`. JS at DB scope ties it to "all structure + all data" selected. |
| Add `CREATE TRIGGER` statement | `sql_create_trigger` | `true` | Enables trigger blocks. |
| Enclose table and column names with backquotes *(Protects column and table names formed with special characters or keywords)* | `sql_backquotes` | `true` | `SET SQL_QUOTE_SHOW_CREATE = 1|0` before `SHOW CREATE TABLE`; parser mode `SQL_MODE_NO_ENCLOSING_QUOTES` when off. |

Group `sql_data` "Data creation options":

| Label | Param | Default | Effect |
|---|---|---|---|
| Truncate table before insert | `sql_truncate` | `false` | Banner "Truncate table before insert `t`" + `TRUNCATE TABLE `t`;` (only when function is INSERT). |
| Instead of `INSERT` statements, use: (message) → `INSERT DELAYED` statements (doc insert_delayed) | `sql_delayed` | `false` | `INSERT DELAYED INTO`. |
| `INSERT IGNORE` statements (doc insert) | `sql_ignore` | `false` | `INSERT IGNORE INTO` (only with INSERT), `UPDATE IGNORE` with UPDATE. |
| Function to use when dumping data: | `sql_type` (select INSERT/UPDATE/REPLACE) | `'INSERT'` | REPLACE → `REPLACE INTO …`; UPDATE → one `UPDATE `t` SET `c` = v, … WHERE <unique condition>` per row (`UniqueCondition`). |
| Syntax to use when inserting data: (message) → radios | `sql_insert_syntax` | `'both'` | `complete`: "include column names in every INSERT statement" (`INSERT INTO t (c…) VALUES (…)` one per row); `extended`: "insert multiple rows in every INSERT statement" (`INSERT INTO t VALUES\n(…),\n(…)`); `both`: columns + multi-row; `none`: `INSERT INTO t VALUES (…)` one per row. |
| Maximal length of created query | `sql_max_query_size` (number) | `50000` | For extended inserts: when accumulated length + next row would exceed it, the statement is closed with `;` and a new `INSERT … VALUES` begins. `0` disables splitting. |
| Dump binary columns in hexadecimal notation *(for example, "abc" becomes 0x616263)* | `sql_hex_for_binary` | `true` | Binary-flagged fields → `0x…`; empty binary → `''`. |
| Dump TIMESTAMP columns in UTC *(enables TIMESTAMP columns to be dumped and reloaded between servers in different time zones)* | `sql_utc_time` | `true` | Header `SET time_zone = "+00:00";`, connection `SET time_zone="+00:00"` (old value saved in `self::$oldTimezone` and restored in the footer). There is **no** separate "TIME columns in UTC" option. |

Value formatting in `exportData`: `NULL` → `NULL`; numeric → raw; binary+hex → `0x…` or `''`; BIT → `b'<bits>'` (`Util::printableBitValue`); GEOMETRY → `0x…`; metadata marker `@LAST_PAGE` passed through; `''` → `''`; else `quoteString`. First row prints banner "Dumping data for table `t`"; statements separated by `;\n` (or `,\n` for extended); a trailing `;\n` closes the table.

Header (`exportHeader`) exact shape with comments on:
```
-- phpMyAdmin SQL Dump
-- version <Version::VERSION>
-- https://www.phpmyadmin.net/
--
-- Host: <host>[:<port>]
-- Generation Time: <localised date>
-- Server version: <getVersionString>
-- PHP Version: <PHP_VERSION>
<blank>
[-- / -- custom lines / --]
[SET FOREIGN_KEY_CHECKS=0;]
[SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";]   (compat NONE only)
[START TRANSACTION;]
[SET time_zone = "+00:00";]
<blank>
(file output only:)
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES <mysql charset> */;
```
The `SET NAMES` value is `Charsets::$mysqlCharsetMap[Current::$charset]` (e.g. `windows-1252 → latin1`, `utf-8 → utf8`), default `utf8`, and `utf8` is replaced by the connection's default charset (`getDefaultCharset()`, i.e. `utf8mb4` on modern servers). Footer: `[SET FOREIGN_KEY_CHECKS=1;]`, `[COMMIT;]`, then the three `/*!40101 SET …=@OLD_… */;` restores if the charset block was sent.

Per-database block: `--\n-- Database: `db`\n--`. CREATE DATABASE per rules above. Routines: `\nDELIMITER $$\n`, banner "Procedures" then each `[DROP PROCEDURE IF EXISTS `p`$$]` + definition + `$$\n\n`, then banner "Functions" likewise, then `DELIMITER ;`. Definer is stripped from routines/events only when `Export/remove_definer_from_definitions`. If aliasing changed a routine body a warning comment "It appears your database uses routines; / alias export may not work reliably in all cases." is added (once per DB; same wording for views "uses views" and triggers "your table uses triggers").

Per-table structure (`create_table`): `\n-- ----…(56 dashes)\n\n--\n-- Table structure for table `t`\n--\n` + optional dates + `DROP …` + `SHOW CREATE TABLE` output post-processed by the SQL parser: constraints (`CONSTRAINT … FOREIGN KEY`) are removed and queued into `$sqlConstraints` as `ALTER TABLE `t`\n  ADD …,\n  ADD …;`; non-FULLTEXT keys are removed and queued into `$sqlIndexes` as `ALTER TABLE `t`\n  ADD PRIMARY KEY (…),\n  ADD KEY …;` (with `COMMENT='x'` rewritten to `COMMENT 'x'`); FULLTEXT keys are queued one `ALTER TABLE … ADD FULLTEXT KEY …;` each ("InnoDB supports one FULLTEXT index creation at a time"); `AUTO_INCREMENT` column attribute is removed and queued as `ALTER TABLE `t`\n  MODIFY `c` int NOT NULL AUTO_INCREMENT[, AUTO_INCREMENT=n];`; the table-level `AUTO_INCREMENT=` option is dropped. None of this is done for `ENGINE=ARCHIVE` tables. Deferred blocks are flushed in `exportDBFooter` in the order **indexes → auto-increments → views → constraints**, each with a once-per-dump banner ("Indexes for dumped tables", "AUTO_INCREMENT for dumped tables", "Constraints for dumped tables") and a per-table banner ("Indexes for table `t`", "AUTO_INCREMENT for table `t`", "Constraints for table `t`"). Views are therefore always emitted after all indexes ("in case the view uses USE INDEX syntax"). Then table comments (media types, relationships).

Views: in multi-table exports a **stand-in** `CREATE TABLE `v` (\n`col` type\n, …);` (banner "Stand-in structure for view `v`" / "(See below for the actual view)") is emitted in table order so dependents can be created; the real `create_view` block later emits "Structure for view `v`" + `DROP TABLE IF EXISTS `v`;` (not at table scope) + `CREATE [OR REPLACE] [ALGORITHM…] VIEW …` with the `db`.` prefix stripped by regex, buffered into `$sqlViews`. Line endings in SHOW CREATE output are normalised to `\n`.

Triggers (`triggers` mode): banner "Triggers `t`" then per trigger `[DROP TRIGGER IF EXISTS …;]`, `DELIMITER $$`, `CREATE TRIGGER …$$`, `DELIMITER ;`.

Events: `\nDELIMITER $$\n`, banner "Events", per event `[DROP EVENT IF EXISTS `e`$$]` + definition + `$$\n\n`, `DELIMITER ;`.

MSSQL compatibility (`makeCreateTableMSSQLCompatible`): strips `IF NOT EXISTS`, `date → datetime`, removes `unsigned`, removes display widths from `int/tinyint/smallint/bigint`, `float/double(p,s) → float`; ANSI quotes are used; comment notes `@todo remove indexes from CREATE TABLE`.

Metadata (`sql_metadata`): `\n\n--\n-- Metadata\n--\n` + `USE `<pmadb>`;` then for each table "Metadata for table t": rows from `column_info` (selected columns `db_name, table_name, column_name, comment, mimetype, transformation, transformation_options, input_transformation, input_transformation_options`), `table_uiprefs`, `tracking` (`SELECT *`), filtered by `db_name`/`table_name`; then "Metadata for database db": `bookmark` (`dbase, user, label, query` WHERE `dbase`), `relation` (WHERE `master_db`), `pdf_pages` (per page: INSERT of `db_name, page_descr`, then `SET @LAST_PAGE = LAST_INSERT_ID();`, then `table_coords` rows with `'@LAST_PAGE' AS pdf_page_number` emitted unquoted), `savedsearches` (`username, db_name, search_name, search_data`), `central_columns`. These are regular INSERTs produced by `exportData` using the current data options.

### CSV (`ExportCsv`, name `csv`, ext `csv`, MIME `text/comma-separated-values`)

Data only (hidden `csv_structure_or_data`, default `data`). No header/footer.

| Label | Param | Default | Effect |
|---|---|---|---|
| Columns separated with: | `csv_separator` | `,` | `\t` literal becomes TAB. |
| Columns enclosed with: | `csv_enclosed` | `"` | Fields are enclosed **only when they contain** the separator, the enclosure or the terminator (`strcspn` check); empty enclosure disables quoting. |
| Columns escaped with: | `csv_escaped` | `"` | If escape ≠ enclosure, escape chars are doubled first, then enclosure chars are prefixed with the escape; if equal, enclosure is doubled. |
| Lines terminated with: | `csv_terminated` | `AUTO` | `AUTO`/empty → `\n`; `\r`, `\n`, `\t` literals translated. |
| Replace NULL with: | `csv_null` | `NULL` | NULL cells. |
| Remove carriage return/line feed characters within columns | `csv_removeCRLF` | `false` | strips `\r` and `\n` inside values. |
| Put columns names in the first row | `csv_columns` | `true` | header row of (aliased) column names using the same quoting rule. |

Empty string cells are emitted as empty; binary/GEOMETRY → `0x…` (never quoted). Raw query supported.

### CSV for MS Excel (`ExportExcel`, name `excel`, ext `csv`, same MIME)

| Label | Param | Default | Effect |
|---|---|---|---|
| Replace NULL with: | `excel_null` | `NULL` | |
| Remove carriage return/line feed characters within columns | `excel_removeCRLF` | `false` | |
| Put columns names in the first row | `excel_columns` | `true` | |
| Excel edition: | `excel_edition` select `win` "Windows", `mac_excel2003` "Excel 2003 / Macintosh", `mac_excel2008` "Excel 2008 / Macintosh" | `win` | separator `;` for win/mac_excel2003, `,` for mac_excel2008. |

Fixed: terminator `\r\n`, enclosure `"`, escape `"`; **every non-empty field is enclosed**; `\r\n`/`\r` inside values are normalised to `\n` before optional CRLF removal. No hex for binary. JS auto-switches file charset to `windows-1252` when this format is selected.

### JSON (`ExportJson`, name `json`, ext `json`, MIME `application/json`)

| Label | Param | Default |
|---|---|---|
| Output pretty-printed JSON (Use human-readable formatting) | `json_pretty_print` | `false` |
| Output unicode characters unescaped | `json_unicode` | `true` |

Output is one JSON array: `[\n{"type":"header","version":"<ver>","comment":"Export to JSON plugin for phpMyAdmin"},\n` then per DB `{"type":"database","name":"db"},\n` then per table `{"type":"table","name":"t","database":"db","data":` `[` rows as objects keyed by (aliased) column name, `,\n` separated `]` `}` — tables separated by `,`; footer `]\n`. Raw query → `{"type":"raw","data":[…]}`. Blob/binary-charset (charsetnr 63) and GEOMETRY → `0x…`. `json_encode` failure throws `ExportException` ("Failure during header/data export.").

### LaTeX (`ExportLatex`, name `latex`, ext `tex`, MIME `application/x-tex`)

Default `structure_and_data`. Structure group hidden at table scope without `single_table`.

| Group | Label | Param | Default |
|---|---|---|---|
| general | Include table caption | `latex_caption` | `true` |
| Dump table | structure / data / structure and data | `latex_structure_or_data` | `structure_and_data` |
| Object creation options | Table caption: (FAQ 6.27) | `latex_structure_caption` | `strLatexStructure` → "Structure of table @TABLE@" |
| | Table caption (continued): | `latex_structure_continued_caption` | `strLatexStructure strLatexContinued` → "Structure of table @TABLE@ (continued)" |
| | Label key: | `latex_structure_label` | `tab:@TABLE@-structure` |
| | Display foreign key relationships (relation feature) | `latex_relation` | `true` |
| | Display comments | `latex_comments` | `true` |
| | Display media types (transformation feature) | `latex_mime` | `true` |
| Data dump options | Put columns names in the first row: | `latex_columns` | `true` |
| | Table caption: | `latex_data_caption` | `strLatexContent` → "Content of table @TABLE@" |
| | Table caption (continued): | `latex_data_continued_caption` | `strLatexContent strLatexContinued` |
| | Label key: | `latex_data_label` | `tab:@TABLE@-data` |
| | Replace NULL with: | `latex_null` | `\textit{NULL}` |

Caption/label strings pass through `getTranslatedText` (replaces `strLatexContent/Continued/Structure`) and `expandUserString` with `table`/`database` overrides and `texEscape` (`addcslashes` of `$%{}&#_^`). Header: `% phpMyAdmin LaTeX Dump / % version / % https://www.phpmyadmin.net/ / % / % Host: … / % Generation Time: … / % Server version: … / % PHP Version: …`. DB header `%\n% Database: 'db'\n%`. Data: `\begin{longtable}{|l|l|…}` with `\hline \endhead \hline \endfoot \hline`, optional `\caption{…} \label{…} \\`, header row of `\multicolumn{1}{|c|}{\textbf{col}}` + `\endfirsthead`, continued caption, `\endhead \endfoot`; rows `v & v \\ \hline`; `\end{longtable}`. Structure: columns Column | Type | Null | Default [| Links to] [| Comments] [| MIME]; primary key names in `\textit{}`, unique keys in `\textbf{}`; Null shows "Yes"/"No"; Default shows value, `NULL` when nullable with no default, else ''. Triggers are not exported.

### MediaWiki Table (`ExportMediawiki`, name `mediawiki`, ext `mediawiki`, MIME `text/plain`)

| Label | Param | Default |
|---|---|---|
| Dump table radios | `mediawiki_structure_or_data` | `data` |
| Export table names | `mediawiki_caption` | `true` |
| Export table headers | `mediawiki_headers` | `true` |

Structure: comment `<!--\nTable structure for `t`\n-->` then `{| class="wikitable" style="text-align:center;"`, optional `|+'''t'''`, optional header row (`|- style="background:#ffdead;"`, `! style="background:#ffffff" | ` then ` | col` per column), then rows `! Type`, `! Null` (YES/NO), `! Default`, `! Extra`, closing `|}`. Data: comment `Table data for `t`` (or "Query results" for raw), `{| class="wikitable sortable" style="text-align:center;"`, caption, header cells ` ! col`, rows `|-` + ` | value` (NULL → `NULL`, binary → hex), `|}`. Line terminator `\n`.

### Microsoft Word 2000 (`ExportHtmlword`, name `htmlword`, ext `doc`, MIME `application/vnd.ms-word`, forceFile)

| Group | Label | Param | Default |
|---|---|---|---|
| Dump table | radios | `htmlword_structure_or_data` | `structure_and_data` |
| Data dump options | Replace NULL with: | `htmlword_null` | `NULL` |
| | Put columns names in the first row | `htmlword_columns` | `false` |

`htmlword_relation/mime/comments` are read from the request but **not declared as options** (so unreachable from the UI). Output: Word-flavoured HTML header (`xmlns:o/x`, XHTML transitional doctype, `<meta charset=<file charset|utf-8>>`), `<h1>Database db</h1>`, `<h2>Table structure for table t</h2>` + `<table width="100%" cellspacing="1">` rows `print-category` with Column (`<em>` PK, `<strong>` unique) | Type | Null | Default; triggers table Name | Time | Event | Definition; views "Structure for view"/"Stand-in structure for view"; `<h2>Dumping data for table t</h2>` with optional bold header row; `</body></html>`.

### OpenDocument Spreadsheet (`ExportOds`, name `ods`, ext `ods`, MIME `application/vnd.oasis.opendocument.spreadsheet`, forceFile)

| Label | Param | Default |
|---|---|---|
| Replace NULL with: | `ods_null` | `NULL` |
| Put columns names in the first row | `ods_columns` | `true` |

Data only. Builds one `content.xml` in memory (`$buffer`) with automatic styles `N37` (date `MM/DD/YYYY`), `N43` (time with am/pm), `N50` (datetime), cell styles `DateCell/TimeCell/DateTimeCell`; one `<table:table table:name="t">` per table; typed cells: DATE → `office:value-type="date" office:date-value="Y-m-d"`, TIME → `time` `PTHHHMMMSSS`, DATETIME → `date` `Y-m-d\TH:i:s`, numeric → `float`, else `string`; binary BLOB → empty string. `exportFooter` zips via `OpenDocument::create(mime, content)` → ZIP with `mimetype`, `content.xml`, `meta.xml` (generator "phpMyAdmin <ver>", creation date), `styles.xml` (fixed Standard/Heading styles, A4 portrait page layout), `META-INF/manifest.xml`.

### OpenDocument Text (`ExportOdt`, name `odt`, ext `odt`, MIME `application/vnd.oasis.opendocument.text`, forceFile)

| Group | Label | Param | Default |
|---|---|---|---|
| Dump table | radios | `odt_structure_or_data` | `structure_and_data` |
| Object creation options (hidden at table scope w/o single_table) | Display foreign key relationships | `odt_relation` | `true` |
| | Display comments | `odt_comments` | `true` |
| | Display media types | `odt_mime` | `true` |
| Data dump options | Put columns names in the first row | `odt_columns` | `true` |
| | Replace NULL with: | `odt_null` | `NULL` |

Output: `<text:h outline-level=1>Database db</text:h>`; structure `<text:h outline-level=2>Table structure for table t</text:h>` + `<table:table table:name="t_structure">` header Column | Type | Null | Default [| Links to] [| Comments] [| Media type]; triggers table `t_triggers` (Name | Time | Event | Definition); views "Structure for view"/"Stand-in structure for view" (`t_data` table); data heading "Dumping data for table t" (or "Dumping data for query result") + table `t_structure` (sic) with typed float/string cells, binary BLOB blank, GEOMETRY hex. Zipped like ODS.

### PDF (`ExportPdf`, name `pdf`, ext `pdf`, MIME `application/pdf`, forceFile; requires TCPDF + curl)

| Group | Label | Param | Default |
|---|---|---|---|
| general | Report title: | `pdf_report_title` | `''` |
| Dump table | radios | `pdf_structure_or_data` | `data` |

`pdf_relation`/`pdf_mime` are read but not declared. Document: landscape, `pt`, **A3**, title font 18, top margin 30. Each page header prints the title centred, then "Database: <db>,  Table: <t>,  Purpose: <purpose>" (purposes: "Dumping data", "Query result data" with db/table `----`, "Table structure", "Triggers", "View structure", "Stand in"), then a grey column-title band. `mysqlReport` runs the query twice: pass 1 computes column widths (string width + 6; INT right-aligned; binary BLOB columns hidden; columns whose data stays under 3× the average width grow; overflow redistributed), pass 2 prints rows with `MultiCell`, `[BLOB]`/`[GEOMETRY]` placeholders, `NULL` for nulls, grid lines drawn per page. Structure table columns Column(90) Type(80) Null(40) Default(120) [Links to 120] Comments(120) [Media type 120]; triggers Name(90) Time(80) Event(40) Definition(240). Whole PDF emitted in `exportFooter`.

### PHP array (`ExportPhparray`, name `phparray`, ext `php`, MIME `text/plain`)

Data only (hidden `phparray_structure_or_data`, default `data`). Header `<?php\n/**\n * Export to PHP Array plugin for phpMyAdmin\n * @version <ver>\n */\n\n`; DB header `/**\n * Database `db`\n */` (`*/` in names replaced by `-`); per table `\n/* `db`.`t` */\n$<tableFixed> = array(` then `\n  array('col' => value, …)` rows comma-separated, `\n);\n`. Variable name: non-`[a-zA-Z0-9_\x7f-\xff]` → `_`, leading non-letter → prefixed `_`. Values via `var_export` (binary → hex string).

### Texy! text (`ExportTexytext`, name `texytext`, ext `txt`, MIME `text/plain`)

| Group | Label | Param | Default |
|---|---|---|---|
| Dump table | radios | `texytext_structure_or_data` | `structure_and_data` |
| Data dump options | Put columns names in the first row | `texytext_columns` | `false` |
| | Replace NULL with: | `texytext_null` | `NULL` |

`===Database db`, `== Table structure for table t` + `|------` table Column | Type | Null | Default (+ Links to / Comments / Media type when `texytext_relation/comments/mime` are posted — not declared as options), PK `//italic//`, unique `**bold**`; `== Triggers t`; `== Structure for view t`; `== Stand-in structure for view t`; `== Dumping data for table t` (or `==Dumping data for query result`) with `|------` header; cells `|value` with `|` → `&#124;`, empty → single space.

### TOON (`ExportToon`, name `toon`, ext `toon`, MIME `text/toon`, forceFile)

| Label | Param | Default |
|---|---|---|
| Columns separated with: | `toon_separator` | `,` (`\t` → TAB) |
| Indentation: | `toon_indent` | `2` (digits only) |

Data only (hidden `toon_structure_or_data`, default `structure_and_data` in config). Per table: `db.table[<rowCount><sep if not ','>]{col1,col2}:\n` then each row indented by `indent` spaces, values joined by the separator, `null` for NULL, hex for binary; a blank line after the last row. Buffered query (needs `numRows`).

### XML (`ExportXml`, name `xml`, ext `xml`, MIME `text/xml`; needs a current DB)

| Group | Label | Param | Default |
|---|---|---|---|
| general | (hidden) | `xml_structure_or_data` | `data` |
| Object creation options (all are recommended) | Events | `xml_export_events` | `true` |
| | Functions | `xml_export_functions` | `true` |
| | Procedures | `xml_export_procedures` | `true` |
| | Tables | `xml_export_tables` | `true` |
| | Triggers | `xml_export_triggers` | `true` |
| | Views | `xml_export_views` | `true` |
| Data dump options | Export contents | `xml_export_contents` | `true` |

Header: `<?xml version="1.0" encoding="<file charset|utf-8>"?>`, comment block (`- phpMyAdmin XML Dump / - version / - https://www.phpmyadmin.net / - / - Host: / - Generation Time: / - Server version: / - PHP Version:`), `<pma_xml_export version="1.0" [xmlns:pma="https://www.phpmyadmin.net/some_doc_url/"]>`. If any structure flag: `<pma:structure_schemas><pma:database name collation charset>` then per selected table `<pma:table|view name>` with the `SHOW CREATE` text + `;`, `<pma:trigger name>` blocks, then `<pma:function>`, `<pma:procedure>`, `<pma:event>` definitions, `</pma:database></pma:structure_schemas>`. Contents: `<!-- Database: 'db' --><database name="db">`, per table `<!-- Table t -->` and one `<table name="t">` per row containing `<column name="c">value</column>` (NULL → `NULL`, binary → hex, all `htmlspecialchars`); `</database>`; footer `</pma_xml_export>`. Merge tables' data is skipped.

### YAML (`ExportYaml`, name `yaml`, ext `yml`, MIME `text/yaml`, forceFile)

Data only (hidden, default `data`). Header `%YAML 1.1\n---\n`, footer `...\n`. First row of a table is preceded by `# db.table\n`; each row `-\n` then `  col: value` — `null` for NULL, bare numbers when numeric and the field is not a string type, otherwise double-quoted with `\`, `"`, newline and CR escaped.

### CodeGen (`ExportCodegen`, name `codegen`, ext `cs`, MIME `text/cs`)

| Label | Param | Default |
|---|---|---|
| Format: | `codegen_format` select `0` "NHibernate C# DO", `1` "NHibernate XML" | `0` |

Data-only plugin (hidden `codegen_structure_or_data`, default `data`) that actually emits structure code from `DESC db.t`: C# class in `namespace <Db>` with `#region Member Variables / Constructors / Public Properties` (`protected <type> _<name>;`, constructor over non-PK columns, virtual properties), or NHibernate mapping XML (`<id>` for PK with `<generator class="native"/>`, `<property>` otherwise with `not-null`, `unique`, `index`). Type mapping (`TableProperty`): `int*→int/Int32`, `longtext→string`, `long*→long/Long`, `char/varchar/text→string/String`, `tinyint→bool/Boolean`, `datetime→DateTime`, else `unknown/Unknown`. Identifiers: non-letters removed, leading non-letter prefixed `_`, `ucfirst`.

---

## Import UI

### Purpose

Upload (or pick from `UploadDir`) a possibly compressed file in one of 7 formats and execute it against the server / selected database / selected table, with chunked reading, optional time-limit interruption and resume, upload progress, charset conversion, and format-specific parsing. The same `/import` endpoint also executes queries typed in the SQL box and bookmarks (documented elsewhere; the branches are noted below because they share the controller).

### Entry points

| Route | Scope (`import_type`) | Title |
|---|---|---|
| `/server/import` | `server` | "Importing into the current server" |
| `/database/import` | `database` | "Importing into the database "%s"" (redirects with "No database selected." if DB missing) |
| `/table/import` | `table` | "Importing into the table "%s"" ("No table selected." if table missing) |
| `/import` | POST (multipart) | executes |
| `/import-status` | GET | `?id=<uploadId>&import_status=1` → JSON upload status; `?message=1` → blocks until `$_SESSION['Import_message']['message']` is set, then returns that HTML plus `import_status.twig` ("[ Back ]" to `go_back_url`) |
| `/import/simulate-dml` | POST | simulates single-table UPDATE/DELETE (SQL tab feature; see below) |

### Layout and every control (`import.twig`)

1. Title with `b_import` icon; page settings (`PageSettings::init('Import')` exposing `src/Config/Forms/User/ImportForm.php`: Import_defaults = `Import/format, Import/charset, Import/allow_interrupt, Import/skip_queries, enable_drag_drop_import`; Sql = `sql_compatibility, sql_no_auto_value_on_zero, sql_read_as_multibytes`; Csv group + "CSV using LOAD DATA" group; Open_Document group).
2. Hidden `<iframe id="import_upload_iframe" name="import_upload_iframe">` and `#import_form_status`; `#upload_progress_info` carries `data-upload-id` (16 hex chars from `random_bytes(8)`) and `data-handler` (FQCN of the chosen upload plugin).
3. Form `#import_file_form` → `/import`, `multipart/form-data`, class `disableAjax`; `target="import_upload_iframe"` **only when the handler is not `UploadNoplugin`** (so the page stays and polls progress). Hidden inputs: `<idKey> = uploadId` where idKey is `UPLOAD_IDENTIFIER` (uploadprogress ext), `noplugin` (fallback), or `session.upload_progress.name` (session plugin, currently disabled in `Ajax::uploadProgressSetup` — commented out "problematic"); `import_type`; `db`; `table`.
4. **File to import:** card
   - If any compression is available: "File may be compressed (gzip, bzip2, zip) or uncompressed." + "A compressed file's name must end in **.[format].[compression]**. Example: **.sql.zip**". List = `Import::getCompressions`: `gzip` (GZipDump && gzopen), `bzip2` (BZipDump && bzopen), `zip` (ZipDump && zip_open).
   - If uploads enabled (`file_uploads` ini) **and** `UploadDir` set: nav pills `#uploadFileTab` "Upload a file" / `#localFileTab` "Select file to import" (local tab active when `timeout_passed_global && local_import_file`). Upload pane: label "Browse your computer: (Max: 2,048KiB)" — `Util::getFormattedMaximumUploadSize(min(upload_max_filesize, post_max_size))` formatted as `(Max: %s%s)` — `<input type="file" name="import_file" id="input_import_file">`, hidden `#upload_form_status`, `#upload_form_status_info`, text "You may also drag and drop a file on any page.". Local pane: `"Select from the web server upload directory [strong]<userDir(UploadDir)>[/strong]:"` + `<select name="local_import_file" id="select_local_import_file">` with an empty option then `file_select_options.twig` (files matching `\.(<all plugin extensions joined by |>)(\.(gz|bz2|zip))?$`, sorted by `FileListing`, pre-selected if resuming); or error "The directory you set for upload work cannot be reached." (dir unreadable) / info "There are no files to import!".
   - Only uploads: the upload block alone. Only `UploadDir`: the select alone. Neither: notice "File uploads are not allowed on this server.".
   - "Character set of the file:" — if `Encoding::isSupported()`: `<select name="charset_of_file">` over `listEncodings()` (selected `Import/charset` or `utf-8`); else a select of **MySQL** charsets (`Charsets::getCharsets`) with empty first option and `utf8` selected (in this mode the server does `SET NAMES '<charset>'` instead of converting).
5. **Partial import:** card — when resuming (`timeout_passed`): hidden `skip=<offset>` and info "Previous import timed out, after resubmitting will continue from position %d."; switch `allow_interrupt=yes` "Allow the interruption of an import in case the script detects it is close to the PHP timeout limit." with help "This might be a good way to import large files, however it can break transactions." (checked via `Plugins::checkboxCheck(Import,'allow_interrupt')`, default `true`); "Skip this number of queries (for SQL) starting from the first one:" `<input type="number" name="skip_queries" min=0>` default `Import/skip_queries` (0) or request value — rendered hidden when resuming ("to avoid the risk of someone entering a value here that would interfere with skip").
6. **Other options** card — hidden `fk_checks=0` + switch `fk_checks=1` "Enable foreign key checks" (checked per `ForeignKey::isCheckEnabled()`: `DefaultForeignKeyChecks` `enable`/`disable`, or the server's current `FOREIGN_KEY_CHECKS`).
7. **Format** card — `<select id="plugins" name="format">` (plugins alphabetical: CSV, CSV using LOAD DATA, ESRI Shape File, MediaWiki Table, OpenDocument Spreadsheet, SQL, XML); default `Import/format` (default `sql`; config validator only accepts `csv|docsql|ldi` else `sql` — `docsql` is a legacy value with no plugin) validated against the list else `sql`. `#import_notification` shows, for CSV only, the info alert "Note: If the file contains multiple tables, they will be combined into one.".
8. **Format-specific options:** card (same renderer as export, `PluginType::Import`).
9. **Encoding Conversion:** (Japanese UI) same kanji form.
10. **Import** button `#buttonGo`.

### Client behaviour (`import.ts`)

- Submit validation: with tabs, upload tab active and empty file → focus + error "Please select the file you want to import:"; local tab active with no select → "No files available on server for import!"; empty selection → the file message. Without tabs: empty file → message; `#text_csv_new_tbl_name` whitespace-only → "Please enter a valid table name."; `#text_csv_new_db_name` whitespace-only → "Please enter a valid database name.". Then `#upload_form_status(_info)` shown.
- Choosing a file (either input) → `matchFile`: strips a trailing `gz|bz2|zip`, and if the remaining extension matches a format option, selects it and refreshes options.
- `#text_csv_enclosed` / `#text_csv_escaped` keyup: a 2-char value whose first char is not `\` is truncated to 1 char.
- Clicking Import with a progress handler: polls `/import-status?id=…&import_status=1` every second; first response hides `#importmain` and injects `.upload_progress` (outer bar, `#status` inner bar, `.percentage`, clock gif + "Uploading your import file…", `#statustext`); after >9 % or >2 MB shows "X of Y", "%s/sec.", "About %MIN min. %SEC sec. remaining." / "About %SEC sec. remaining."; window title prefixed with `NN% - `; `total=complete=percent=0` → "The file being uploaded is probably larger than the maximum allowed size."; on `finished` shows "The file is being processed, please be patient." then loads `/import-status?message=1…` into `#import_form_status` and `Navigation.reload()`. Without a handler: "Please be patient, the file is being uploaded. Details about the upload are not available.".

### Server-side flow (`ImportController`)

1. Reads `charset_of_file`, `format`, `import_type`, `message_to_show`, `skip_queries`, `local_import_file`, `show_as_php`. Resets `$_SESSION['Import_message']`.
2. SQL-box branch: `sql_query` present → parameter substitution (`parameterized` + `parameters[]`), `import_type='query'`, `format='sql'`, `$_SESSION['sql_from_query_box']`, `rollback_query` → `handleRollbackRequest` (every statement must be INSERT/UPDATE/DELETE/REPLACE/SET-without-options on a transactional engine — `INNODB, FALCON, NDB, INFINIDB, TOKUDB, XTRADB, SEQUENCE, ROCKSDB` — else error "Only INSERT, UPDATE, DELETE, REPLACE and SET (without options like GLOBAL) SQL queries containing transactional engine tables can be rolled back."; then `START TRANSACTION`), reload flags for `DROP/CREATE/ALTER VIEW|TABLE|DATABASE|SCHEMA` and `RENAME TABLE`. `id_bookmark` branch → `format='sql'`.
3. Empty GET+POST → error "You probably tried to upload a file that is too large. Please refer to %sdocumentation%s for a workaround for this limit." (FAQ 1.16) — this is how a `post_max_size` overflow (PHP drops the body) is detected.
4. `format` must be an `ImportFormat` enum value else "Incorrect format parameter".
5. `goto` per scope (`/table/import`, `/database/import`, `/server/import`, else structure/sql pages); `Import::$errorUrl`.
6. `Util::setTimeLimit(ExecTimeLimit)`, memory limit; `ImportSettings::$maximumTime = max_execution_time − 1` only when `allow_interrupt` posted and the ini value ≥ 1 (so with `max_execution_time=0` interruption never triggers). `checkTimeout()` flips `$timeoutPassed` when `time() − timestamp > maximumTime − 5`.
7. Bookmark handling `action_bookmark` 0 run (with `bookmark_variable[]` and `action_bookmark_all`), 1 show ("Showing bookmark"), 2 delete ("The bookmark has been deleted."). `show_as_php` → run disabled, `goSql`.
8. Read limit: `memory_limit` (0 → 2 MB, −1 → 10 MB) / 8 = `ImportSettings::$readLimit`.
9. File resolution: `$_FILES['import_file']` → `importFile`/`importFileName`; else `local_import_file` + `UploadDir` → `userDir(UploadDir) . securePath(name)` (symlinks rejected → 'none'); else 'none'. With a file: `File::checkUploadedFile()` (moves to `getUploadTempDir()` — `TempDir/upload`, `upload_tmp_dir`, or `sys_get_temp_dir()` — errors "Error moving the uploaded file, see [doc@faq1-11]FAQ 1.11[/doc].", "Cannot create temporary file.", "Error while moving uploaded file.", "Cannot read uploaded file."), `setDecompressContent(true)`, `open()` (detects by magic bytes: `1F 8B` gzip, `BZh` bzip2, `PK\003\004` zip; unsupported/disabled → "You attempted to load file with unsupported compression (%s). Either support for it is not implemented or disabled by your configuration."). Zip archives are fully read into memory (`ZipExtension::getContents` — assumes a single file, or a `specificEntry` regex). No file and no text → "No data was received to import. Either no file name was submitted, or the file size exceeded the maximum size permitted by your PHP configuration. See [doc@faq1-16]FAQ 1.16[/doc].".
10. Charset: if encoding engine supports it and `charset_of_file` ≠ `utf-8` and listed → chunks are converted with `Encoding::convertString(charset, 'utf-8')`; otherwise non-utf-8 → `SET NAMES '<charset>'`, the displayed SQL is disabled (`sqlQueryDisabled`) and charset is reset afterwards (`SET CHARACTER SET <default>`, default collation).
11. Resume: `skip` posted → reads and discards chunks of `min(skip, readLimit)` until `skip` bytes are consumed (`readMultiply` reset to 1 each time).
12. `ForeignKey::handleDisableCheckInit()` applies `fk_checks` (`SET FOREIGN_KEY_CHECKS OFF/ON`), plugin `setImportOptions(request)` then `doImport($importHandle)`; FK setting restored in `finally`.
13. Messages: finished and no error → success "Import has been successfully finished, %d query executed." / "…queries executed." (`executedQueries`) + `importNotice` HTML (the "The following structures have either been created or altered…" list from `buildSql`) + "(<file name>)". Timeout → `timeout_passed=1&offset=<n>[&local_import_file=…]` added to the goto URL and error "Script timeout passed, if you want to finish import, please %sresubmit the same file%s and import will resume." plus, if no progress since last run, "However on last run no data has been parsed, this usually means phpMyAdmin won't be able to finish this import unless you increase php time limits.". The message is copied to `$_SESSION['Import_message']['message']` for `/import-status`.
14. Failed queries (`ImportSettings::$failedQueries`) → `Generator::mysqlDie` output (first error aborts unless `IgnoreMultiSubmitErrors`).
15. `goSql` path (≤ 50 statements executed, or `show_as_php`): each statement is run through `Sql::executeQueryAndGetQueryResponse` (regular results page; DROP DATABASE blocked unless allowed: '"DROP DATABASE" statements are disabled.'); `bkm_label` stores a bookmark (`bkm_replace`, `bkm_all_users`). Otherwise JSON `message` success/error with `sql_query` summary; `rollback_query` → `ROLLBACK` + "[ROLLBACK occurred.]".

**Chunk reader** (`Import::getNextChunk`): size starts at 32 KiB × `readMultiply` (doubling up to ×8), capped at `readLimit`; returns `false` on timeout, `true` when finished; for text input (`importFile === 'none'`) slices `Import::$importText`; strips UTF-8/UTF-16 BOM from the first chunk; tracks `ImportSettings::$offset`.

**Query runner** (`Import::runQuery`): one-statement look-behind buffer (`importRunBuffer`); honours `skip_queries` (decrements per statement); counts `executedQueries`; if `runQuery && executedQueries < 50 && !forceExecute` the statement is **collected** for the `/sql` display path (`goSql`) instead of executed; from the 50th on (or when `forceExecute`) collected ones are executed, then each new one via `executeQuery` (`tryQuery`; error → `failedQueries`; message `# Rows: n` / affected-rows message / "MySQL returned an empty result set (i.e. zero rows)."; `USE db` tracked to switch `Current::$database`; `DROP/CREATE TABLE|DATABASE` set reload). Displayed SQL is dropped when > 50000 chars, > 50 queries or a statement > 1000 chars.

### Drag-and-drop import (`drag_drop_import.ts`, loaded when `enable_drag_drop_import`)

Markup in `navigation/main.twig`: `.pma_drop_handler` ("Drop files here") overlay and `.pma_sql_import_status` panel ("SQL upload ( <count> ) x -"). `dragenter/dragover` on the document (suppressed on pages containing `.noDragDrop`) show the overlay with "Select database first" when no DB is selected, else "Drop files here"; heuristics exclude browser-internal drags (`text/uri-list`, `text/html`, Firefox native image). Drop with a DB: each file listed with size in kb; accepted extensions `sql, xml, ldi, mediawiki, shp` optionally followed by `gz, bz2, zip` (note: `csv` and `ods` are **not** accepted); invalid ones get a notice icon. Accepted files are POSTed via XHR to `/import` with `import_file`, `noplugin=<random>`, `db`, `server`, `token`, `import_type=database`, `charset_of_file=utf-8`, `allow_interrupt=yes`, `skip_queries=0`, `format=<ext>`, `sql_compatibility=NONE`, `sql_no_auto_value_on_zero=something`, `ajax_request=true`, `hash`; a `<progress>` bar follows upload progress; "cancel" aborts (→ "Aborted"); result "Success" or underlined "Failed" (click opens draggable `.pma_drop_result` "Import status - <file>" with the error HTML). Counter decrements; the close button fades in when nothing is live.

### Simulate DML (`/import/simulate-dml`)

Parses `sql_query` with `sql_delimiter` (comments stripped); only single-table `UPDATE`/`DELETE` without joins ("Only single-table UPDATE and DELETE queries can be simulated."); for each statement returns `sql_query` (formatted), `matched_rows` (COUNT over `SELECT … FROM t WHERE … ORDER BY … LIMIT …` wrapped as `pma_tmp`; UPDATE additionally filters `WHERE NOT (old cols) <=> (new values)`), `matched_rows_url` (signed `/sql` link showing the matched rows).

### Import config directives (`$cfg['Import']`, `Settings/Import.php`)

`format` `'sql'`; `charset` `''`; `allow_interrupt` `true`; `skip_queries` `0`; `sql_compatibility` `'NONE'`; `sql_no_auto_value_on_zero` `true`; `sql_read_as_multibytes` `false` (exposed in preferences with label "Read as multibytes" but **not referenced by any import code**); `csv_replace` `false`; `csv_ignore` `false`; `csv_empty_as_null` `false`; `csv_terminated` `','`; `csv_enclosed` `'"'`; `csv_escaped` `'"'`; `csv_new_line` `'auto'`; `csv_columns` `''`; `csv_col_names` `false`; `ldi_replace` `false`; `ldi_ignore` `false`; `ldi_terminated` `';'`; `ldi_enclosed` `'"'`; `ldi_escaped` `'\\'`; `ldi_new_line` `'auto'`; `ldi_columns` `''`; `ldi_local_option` `'auto'` (resolved at render time from `SELECT @@local_infile`); `ods_col_names` `false`; `ods_empty_rows` `true`; `ods_recognize_percentages` `true`; `ods_recognize_currency` `true`.

---

## Import plugin catalog

Common contract (`ImportPlugin`): constructed with `Import`, DBI, Config; `init()`, `setProperties()`, `setImportOptions(request)`, `doImport(File|null): string[]` (returns the statements to hand to the `/sql` display path). Plugins read option values straight from the request (the defaults shown in the form come from config via `Plugins::getDefault`). `ImportFormat` enum fixes the class per format name.

### SQL (`ImportSql`, name `sql`, ext `sql`)

| Label | Param | Default |
|---|---|---|
| SQL compatibility mode: (doc sql-mode) | `sql_compatibility` select of `getCompatibilities()` | `NONE` |
| Do not use `AUTO_INCREMENT` for zero values (doc sqlmode_no_auto_value_on_zero) | `sql_no_auto_value_on_zero` | `true` |

`doImport`: `SET SQL_MODE="<compat>[,NO_AUTO_VALUE_ON_ZERO]"` if either set; uses `PhpMyAdmin\SqlParser\Utils\BufferedQuery` with optional `sql_delimiter` (from the SQL box); loop: `extract()` a full statement → `runQuery`; otherwise fetch the next chunk (false → rewind `offset` by the unparsed remainder and stop; true → finished), normalising lone `\r` to `\n`; afterwards drains remaining statements with `extract(true)`; finishes with `runQuery('')` to flush the look-behind buffer. Handles `DELIMITER` statements through BufferedQuery.

### CSV (`ImportCsv`, name `csv`, ext `csv`)

Shared general group (`AbstractImportCsv::getGeneralOptions`, names prefixed by plugin name):

| Label | Param | Default | Size |
|---|---|---|---|
| Update data when duplicate keys found on import (add ON DUPLICATE KEY UPDATE) | `csv_replace` | `false` | |
| Columns separated with: | `csv_terminated` | `,` | size 2 |
| Columns enclosed with: | `csv_enclosed` | `"` | size 2, maxlength 2 |
| Columns escaped with: | `csv_escaped` | `"` | size 2, maxlength 2 |
| Lines terminated with: | `csv_new_line` | `auto` | size 2 |

Then, when **not** at table scope: "Name of the new table (optional):" `csv_new_tbl_name`; (server scope only) "Name of the new database (optional):" `csv_new_db_name`; "Import these many number of rows (optional):" `csv_partial_import` (number); "The first line of the file contains the table column names *(if this is unchecked, the first line will become part of the data)*" `csv_col_names` (default `false`). At table scope: `csv_partial_import`; "Column names:" `csv_columns` with hint "If the data in each row of the file is not in the same order as in the database, list the corresponding column names here. Column names must be separated by commas and not enclosed in quotations." (default ''). Always: "Do not abort on INSERT error" `csv_ignore` (false); "Import empty values as NULL" `csv_empty_as_null` (false).

Parsing: `\n`, `\t`, `\r` literals translated; parameter validation errors "Invalid parameter for CSV import: %s" for empty separator ("Columns terminated with"), enclosure or escape longer than 1 ("Columns enclosed with"/"Columns escaped with"), newline not 1 char and not `auto` ("Lines terminated with") — reported immediately via `mysqlDie`. Hand-written state machine over the chunk buffer: handles multi-char separators, enclosure/escape (escape == enclosure doubles), `auto` newline accepting `\r`, `\n`, `\r\n`, a forced trailing newline at EOF, unquoted `NULL` → SQL NULL, `empty_as_null`; "Invalid format of CSV input on line %d." on deadlock or leftover values; table scope: value count must equal field count except the Excel hack (trailing `;` cell dropped) else "Invalid column count in CSV input on line %d."; each row → `INSERT [IGNORE] INTO `t` [(cols)] VALUES (…)` [+ `ON DUPLICATE KEY UPDATE c = VALUES(c), …` when `csv_replace`], executed via `runQuery`. `csv_columns` names are trimmed of whitespace and backquotes and must exist ("Invalid column (%s) specified! Ensure that columns names are spelled correctly, separated by commas, and not enclosed in quotes."). Non-table scope: rows accumulated, padded with `'NULL'` to the max column count, first row used as names when `csv_col_names` (names `rtrim`med; missing names → `COL 1`, `COL 2`, …), table name = `csv_new_tbl_name` or `getNextAvailableTableName(db, <file basename>)` (`TABLE` if empty; non-BMP chars → `_`; existing → `name_<n+1>`), then `analyzeTable` + `buildSql` (see below); without a current DB a database `csv_new_db_name` or `CSV_DB <count+1>` is created (`utf8`/`utf8_general_ci`). **Source quirk:** `$this->maxLines = min(0, (int) csv_partial_import)` is never positive, so "Import these many number of rows" is effectively a no-op in current master.

### CSV using LOAD DATA (`ImportLdi`, name `ldi`, ext `ldi`; available only at table scope)

Same general group (prefix `ldi_`, defaults `;`, `"`, `\`, `auto`, replace false) plus "Column names: " `ldi_columns`, "Do not abort on INSERT error" `ldi_ignore`, "Use LOCAL keyword" `ldi_local_option` (default from config `auto` → `true` iff `@@local_infile` is `ON`/`1`). Refuses compressed input or charset conversion ("This plugin does not support compressed imports!"). Builds `LOAD DATA [LOCAL] INFILE '<server path>' [REPLACE|IGNORE] INTO TABLE `t` [FIELDS TERMINATED BY '…'] [ENCLOSED BY '…'] [ESCAPED BY '…'] [LINES TERMINATED BY '…' (auto → PHP_EOL)] [IGNORE <skip_queries> LINES] [(cols)]` — note `skip_queries` is repurposed as the number of leading lines to ignore.

### ESRI Shape File (`ImportShp`, name `shp`, ext `shp`; no options)

Requires the `zip` extension object; reads the `.shp` stream through `ShapeFileImport` (`bsShapeFiles`) using `readFromBuffer` over import chunks. For a zip containing several files, the `.shp` entry is selected by regex; if the `dbase` extension is present and `TempDir` works, the `.dbf` is extracted to `TempDir/shp/` to load attribute columns (or, for an uncompressed `UploadDir` file, the sibling `.dbf` is used). Shape types → GIS: Point → `point`, PolyLine → `multilinestring`, Polygon → `multipolygon`, MultiPoint → `multipoint`; others → "MySQL Spatial Extension does not support ESRI type "%s"."; errors "There was an error importing the ESRI shape file: "%s"."; empty → "The imported file does not contain any data!". Rows: first column `SPATIAL` = `GeomFromText('<WKT>')` (marked `isFullyFormattedSql`, type `Geometry`), then DBF columns (empty → `NULL`). Table name from file basename (or `TBL_NAME` without DB); DB `SHP_DB` created when none selected.

### MediaWiki Table (`ImportMediawiki`, name `mediawiki`, ext `txt`, MIME `text/plain`; no options)

Line-oriented parser over `\n`: `<!-- … -->` comments; "Table data for `name`" sets the current table name (structure comments "Table structure for `…`" are skipped); `{|` starts a table, `|-`/`|+`/`|}` end a row (`|}` triggers import of the table), `!`/`|` cells split on `||` (`!!` normalised) while respecting `||` inside HTML tag attributes; `[[link|text]]` pipes are not treated as cell parameters. Unknown line shapes set the error flag. At non-table scope (`analyze`): headers or `COL n`, table name from file basename, DB `mediawiki_DB` if none, `analyzeTable` + `buildSql`. At table scope the plugin parses but **does not insert** (only `runQuery('')`).

### OpenDocument Spreadsheet (`ImportOds`, name `ods`, ext `ods`)

| Label | Param | Default |
|---|---|---|
| The first line of the file contains the table column names *(if this is unchecked, the first line will become part of the data)* | `ods_col_names` | `false` |
| Do not import empty rows | `ods_empty_rows` | `true` |
| Import percentages as proper decimals *(ex. 12.00% to .12)* | `ods_recognize_percentages` | `true` |
| Import currencies *(ex. $5.00 to 5.00)* | `ods_recognize_currency` | `true` |

Reads the whole (already-unzipped `content.xml`) buffer with SimpleXML; errors "The XML file specified was either malformed or incomplete. Please correct the issue and try again." / "Could not parse OpenDocument Spreadsheet!". Each `table:table` sheet becomes an `ImportTable` named after the sheet; cells honour `number-columns-repeated`, empty cells → `NULL`, trailing empty repeats skipped, percentage/currency use `office:value`, text paragraphs joined by `\n` (hyperlink text recovered); header row names or spreadsheet-style `A, B, …, AA` (`getColumnAlphaName`); rows padded to max columns; DB `ODS_DB` if none. All sheets analysed and inserted.

### XML (`ImportXml`, name `xml`, ext `xml`, MIME `text/xml`; no options)

Accepts phpMyAdmin's own XML export. With the `pma` namespace: database name/collation/charset from `pma:structure_schemas/pma:database`, and every `pma:*` child (table/view/trigger/function/procedure/event SQL) is collected as "additional SQL" prefixed with `USE `db``; `buildSql` rewrites `CREATE … TABLE` to `CREATE TABLE IF NOT EXISTS` and executes them. Data rows from `<database><table name><column name>` elements; table names deduplicated via `getNextAvailableTableName`; without structure the tables are analysed and created. A selected DB overrides the file's DB; otherwise `CREATE DATABASE IF NOT EXISTS` with the file's charset/collation (fallback `utf8`/`utf8_general_ci`). Malformed → error echoed and `finished=false`.

### Shared analysis & table builder (`Import::analyzeTable`, `Import::buildSql`)

Type detection per cell (`detectType`): `'NULL'` keeps the previous type; non-numeric → `Varchar`; numeric with exactly one `.` → `Decimal`; `abs(int) > 2147483647` → `BigInt`; otherwise `Int`. Column type is the max in the order None < Int < BigInt < Decimal < Varchar; size tracking (`detectSize`) keeps the max length (Varchar/Int) or `DecimalSize(precision, scale)` with conversions between kinds; columns that stay `None` become `varchar(10)`. `buildSql`: `CREATE TABLE IF NOT EXISTS `db`.`t` (`c` type(size), …)` — `varchar` over 16383 becomes `text` (no length), `geometry` has no length; then a multi-row `INSERT [IGNORE] INTO `db`.`t` (cols) VALUES (…),\n (…)` per table (values quoted when Varchar — or when not hex/int/float if no analysis — never for `NULL`; `isFullyFormattedSql` cells pasted raw); more than 50 rows sets `forceExecute` so the statement really runs instead of being deferred to `/sql`. Success notice: "The following structures have either been created or altered. Here you can:" + bullets "View a structure's contents by clicking on its name.", "Change any of its settings by clicking the corresponding "Options" link.", "Edit structure by following the "Structure" link." + DB link with "(Options)" + per table links "(Structure) (Options)" (views: plain link).

### Upload progress plugins (`src/Plugins/Import/Upload/*`, `Import\Ajax`)

Selection order in `uploadProgressSetup`: `UploadProgress` if `uploadprogress_get_info` exists (id key `UPLOAD_IDENTIFIER`), else `UploadNoplugin` (id key `noplugin`); `UploadSession` (`session.upload_progress.*`) exists but is commented out of the chain. Status payload: `{id, finished, percent, total, complete, plugin}` cached in `$_SESSION['__upload_status'][id]`; `UploadProgress` maps `bytes_uploaded/bytes_total`; when the extension has no info the plugin reports `finished=true, percent=100`. `/import-status?message=1` polls the session every 0.25 s (first wait 0.3 s) up to `max_execution_time`, then "Could not load the progress of the import.".

---

## Schema export

### Purpose

Render the relational schema of the tables currently shown on a Designer page to PDF, SVG, DIA or EPS, with table boxes at their Designer coordinates and lines for every relation (internal `pma__relation` rows and native foreign keys) between selected tables.

### Entry point and dialog

Designer toolbar "Export schema" → `DesignerController` dialog `export` → `Designer::getHtmlForSchemaExport(db, selected_page, format, export_type)` renders `database/designer/schema_export.twig` into a Bootstrap modal titled "Export relational schema" with a "Go" button (`move.ts`): form `#id_export_pages` → POST `/schema-export` (`disableAjax`), hidden `db`, `page_number=<selected page>`, label "Select export relational type:" + `<select id="plugins" name="export_type">` (plugins: Dia, EPS, PDF, SVG; default `Schema/format` = `pdf`; PDF only if TCPDF is installed), then `Plugins::getOptions(PluginType::Schema)` with the same per-plugin `#<name>_options` divs (JS shows the selected one). Before submit the JS appends hidden inputs for every table visible on the canvas from `getUrlPos(true)`: `t_x[i]`, `t_y[i]` (pixel position), `t_v[i]` (body collapsed), `t_h[i]` (visibility checkbox), `t_db[i]`, `t_tbl[i]` (URL-encoded) — and, when the Designer pmadb tables (`pdf_pages`/`table_coords`) are **not** configured, `offline_export=true`.

### Where coordinates come from

`TableStats::loadCoordinates` reads only the POSTed `t_h/t_db/t_tbl/t_x/t_y` arrays (so the diagram always reflects the live canvas, whether those positions originated from `pma__table_coords` for a saved page or from the Designer's default layout). `ExportRelationSchema::getTablesFromRequest` uses `t_tbl[]` (raw-url-decoded) as the table list; tables referenced by a relation but not selected are skipped. The page name for the file is looked up only when `page_number !== -1` and not offline: `SELECT page_descr FROM pma__pdf_pages WHERE page_nr = <n>` → `<page_descr>.<ext>`; otherwise `<db>.<ext>`. There is **no** "Automatic layout" option in current master; the Designer's own default placement is the fallback. Missing table → `dieSchema` page "SCHEMA ERROR: <type>" with "The %s table doesn't exist!" and a Back link to `/database/designer?page=…`. Relation line endpoints: `RelationStats` picks the closest pair of left/right table edges and the row `y = table.y + (fieldIndex + 1.5) * heightCell`.

### Controller

`/schema-export` requires `db` and `export_type` ("Missing parameter: db|export_type" with FAQ link). `Export::getExportSchemaInfo` validates the format (`^[a-zA-Z]+$`, else `pdf`), instantiates `Plugins::getPlugin('schema', format)` ("Bad type!" if unknown), `selectDb`, and streams `getExportInfo()` with `Core::downloadHeader(fileName, mediaType, length)`.

### Options per format (`Settings/Schema.php` defaults in parentheses)

Common (`SchemaPlugin::addCommonOptions`): "Show color" `<name>_show_color` (true for all four), "Only show keys" `<name>_show_keys` (false) — keys-only mode lists only indexed columns (`Index::getFromTable`).

| Plugin (`text`, ext, declared MIME → served MIME) | Options |
|---|---|
| PDF (`pdf`, `application/pdf`) | "Same width for all tables" `pdf_all_tables_same_width` (false); "Orientation" `pdf_orientation` `L` Landscape / `P` Portrait (`L`); "Paper size" `pdf_paper` from `PDFPageSizes` (`A4`); "Show grid" `pdf_show_grid` (false); "Data dictionary" `pdf_with_doc` (true); "Order of the tables" `pdf_table_order` `''` None / `name_asc` Name (Ascending) / `name_desc` Name (Descending) (`''`). |
| SVG (`svg`, declared `application/svg`, served `image/svg+xml`) | "Same width for all tables" `svg_all_tables_same_width` (false). |
| Dia (`dia`, declared `application/dia`, served `application/x-dia-diagram`) | "Orientation" `dia_orientation` (`L`); "Paper size" `dia_paper` (`A4`). |
| EPS (`eps`, declared `application/eps`, served `image/x-eps`) | "Same width for all tables" `eps_all_tables_same_width` (false); "Orientation" `eps_orientation` (`L`). |

"Show dimension of tables" (`<name>_show_table_dimension`, prefixes the box title with `WxH`) is read by the PDF/SVG/EPS classes but **is not declared as an option** in any plugin, so it is unreachable from the UI.

### Rendering details

- **PDF** (`PdfRelationSchema`, TCPDF in `mm`): title "Schema of the %s database"; tables sorted per `pdf_table_order`; scale = ceil(max((xMax−xMin)/innerWidth, (yMax−yMin)/innerHeight)×100)/100 with 10 mm margins (28 mm top/bottom with data dictionary); grid every 10 mm with coordinate labels when "Show grid"; relations drawn before tables; colours: title cell fill navy (0,0,128) with light text, primary-key rows (215,121,123), display-field row (142,159,224). "Data dictionary": a "Table of contents" page (per-table "Page number: {nn}" links and a "Relational schema" entry), then one page per table (bookmark, header `n table`, "Table comments:", "Creation:", "Last update:", "Last check:", then a column table Column | Type | Attributes | Null | Default | Extra | Links to | Comments | MIME with widths 25/20/20/10/20/25/45/67(A4; 50 otherwise)/45 landscape or 20/20/20/10/15/15/30/30/30 portrait; "Links to" shows `-> [db.]table.field` plus `ON UPDATE`/`ON DELETE` for native FKs; internal links from columns to referenced columns), and page headers showing the page description (or "PDF export page" offline) with footers.
- **SVG** (`SvgRelationSchema`): title "Schema of the %s database - Page %s", author "phpMyAdmin <ver>", font Arial 16, viewBox from min/max ± 15 border; same-width shares one width by reference.
- **EPS**: Verdana 10, title/author/date header, orientation applied, `endEpsDoc`.
- **Dia**: margins 2.8222 (= 1 cm in Dia units) all sides, paper + orientation in the document header, tables drawn before relations, object ids sequential.

---

## Micro-behaviours checklist

Export page
- [x] Format dropdown sorted case-insensitively by display text; invalid `format`/`what` falls back to `sql`. <!-- parity:test --> `p07-d147db` [export-import-checklist.test.ts:101](../../apps/server/test/int/export-import-checklist.test.ts#L101)
- [x] Choosing a `forceFile` format (ods, odt, pdf, toon, yaml, htmlword) forces "Save output to a file" and disables "View output as text". <!-- parity:test --> `p07-6c8c06` [export-import-checklist.e2e.ts:56](../../tests/e2e/export-import-checklist.e2e.ts#L56)
- [x] Choosing "CSV for MS Excel" sets file charset to `windows-1252`; any other format resets it to `utf-8`. <!-- parity:test --> `p07-736d72` [export-import-checklist.e2e.ts:69](../../tests/e2e/export-import-checklist.e2e.ts#L69)
- [x] Quick mode hides tables/rows/output/format-specific cards and shows only the quick save-on-server card (which exists only when `SaveDir` is set). <!-- parity:test --> `p07-d027c7` [export-import-checklist.e2e.ts:44](../../tests/e2e/export-import-checklist.e2e.ts#L44)
- [x] `Export/method = custom-no-form` removes the Quick/Custom radios and behaves as custom. <!-- parity:test --> `p07-6176b4` [export-import-checklist.test.ts:110](../../apps/server/test/int/export-import-checklist.test.ts#L110)
- [x] Database scope: per-plugin structure/data radio is replaced by hidden `structure_and_data` + `_default`; CREATE TABLE forced on; plugins without a radio disable the Structure/Data columns and set `structure_or_data_forced=1`. <!-- parity:test --> `p07-f237fe` [export-import-checklist.e2e.ts:123](../../tests/e2e/export-import-checklist.e2e.ts#L123)
- [x] Database scope: `sql_procedure_function` auto-checks only when both header "select all" boxes are fully checked. <!-- parity:test --> `p07-2cc81e` [export-import-checklist.e2e.ts:109](../../tests/e2e/export-import-checklist.e2e.ts#L109)
- [x] No data checkbox checked → data option group collapses and `sql_auto_increment` is disabled. <!-- parity:test --> `p07-e8a701` [export-import-checklist.e2e.ts:109](../../tests/e2e/export-import-checklist.e2e.ts#L109)
- [x] SQL `data` radio disables dates/relation/mime; `structure` disables auto-increment and hides the Rows card. <!-- parity:test --> `p07-c5982b` [export-import-checklist.e2e.ts:95](../../tests/e2e/export-import-checklist.e2e.ts#L95)
- [x] "Display comments" unchecked fades and disables header-comment, dates, relation, mime inputs. <!-- parity:test --> `p07-73ee1f` [export-import-checklist.e2e.ts:81](../../tests/e2e/export-import-checklist.e2e.ts#L81)
- [x] Separate-files checkbox forces `zip`; non-zip compression unchecks it; server-side separate files are ignored unless compression is `zip`. <!-- parity:test --> `p07-6c1430` [export-sql.parity.test.ts:143](../../tests/parity/export-sql.parity.test.ts#L143)
- [x] `LOCK TABLES` switch absent at server scope; locks are `READ` and always released in `finally`. <!-- parity:test --> `p07-35f358` [export-sql.parity.test.ts:155](../../tests/parity/export-sql.parity.test.ts#L155)
- [x] Rows card only for a non-MERGE single table; "Number of rows" prefilled with `unlim_num_rows` or `countRecords()`; sub-inputs disabled unless "Dump some row(s)"; LIMIT only applied when `allrows=0`, `limit_to>0`, `limit_from>=0`. <!-- parity:test --> `p07-d8b116` [export.test.ts:68](../../apps/server/test/int/export.test.ts#L68)
- [x] Rows export from results: `rows_to_delete[]` values become `WHERE (c1) OR (c2)…`; the SELECT's own `LIMIT` is stripped; `single_table` forced. <!-- parity:test --> `p07-91d400` [export.test.ts:80](../../apps/server/test/int/export.test.ts#L80)
- [x] `single_table` absent at table scope → SQL plugin exposes no options (unless `raw_query`); LaTeX/ODT hide their structure groups. <!-- parity:test --> `p07-c3ad37` [export.test.ts:68](../../apps/server/test/int/export.test.ts#L68)
- [x] Raw query export: filename is always `export.<ext>`; title "Exporting a raw query"; no tables/rows blocks. <!-- parity:test --> `p07-967550` [export-sql.parity.test.ts:194](../../tests/parity/export-sql.parity.test.ts#L194)
- [x] Filename template: `strftime` applied first, then `@SERVER@/@DATABASE@/@TABLE@/@HTTP_HOST@/@VERBOSE@/@VSERVER@/@PHPMYADMIN@/@COLUMNS@` and legacy `__SERVER__/__DB__/__TABLE__`; `.` and anything but letters/digits/`_`/`-` replaced by `_`; extension appended once (case-insensitive check); `.gz`/`.zip` appended after. <!-- parity:test --> `p07-b8f822` [export.test.ts:124](../../apps/server/test/int/export.test.ts#L124)
- [x] "Use this for future exports" persists the template per scope (user prefs + cookie `pma_<server|db|table>_filename_template`). <!-- parity:test --> `p07-b71369` [export-import-checklist.test.ts:122](../../apps/server/test/int/export-import-checklist.test.ts#L122)
- [x] Save on server: path `userDir(SaveDir)` with `/`/`\` in the file name replaced by `_`; distinct overwrite flags for quick vs custom; errors/success as flash messages and redirect back to the scope export page. <!-- parity:test --> `p07-49a9bb` [export.test.ts:143](../../apps/server/test/int/export.test.ts#L143)
- [x] Download removes `Content-Encoding`, sets `url_rewriter.tags` empty; gzip is skipped when the server already compresses (`zlib.output_compression` or `ob_gzhandler`) unless saving to file or the UA is Chrome. <!-- parity:test --> `p07-cf608f` [export-import-checklist.test.ts:157](../../apps/server/test/int/export-import-checklist.test.ts#L157)
- [x] `CompressOnFly` applies to gzip only: flush when buffered output exceeds `(memory_limit − 1.5 MB)/8`. <!-- parity:test --> `p07-95720d` [export-import-checklist.test.ts:157](../../apps/server/test/int/export-import-checklist.test.ts#L157)
- [x] Charset conversion only for file output, only when engine ≠ none and charset ∈ `listEncodings()` and ≠ `utf-8`; SQL header `SET NAMES` uses the MySQL name from `$mysqlCharsetMap`. <!-- parity:test --> `p07-65bcd4` [export-sql.parity.test.ts:150](../../tests/parity/export-sql.parity.test.ts#L150)
- [x] "Skip tables larger than N MiB" compares `data_length+index_length` and silently skips both structure and data of that table (checked only when structure is included). <!-- parity:test --> `p07-e2aaab` [export-sql.parity.test.ts:156](../../tests/parity/export-sql.parity.test.ts#L156)
- [x] View-as-text page: Back link re-posts scalar params with `repopulate=1` (restores aliases from session, forces "View output as text", ignores config defaults for checkboxes), Refresh re-posts the full form (F5 intercepted), Copy to clipboard. <!-- parity:test --> `p07-5f94e1` [export-import-checklist.e2e.ts:139](../../tests/e2e/export-import-checklist.e2e.ts#L139)
- [x] Time-out check: `ExecTimeLimit` seconds + 1 after clicking Export, GET `/export/check-time-out`; error toast on `timeout`. <!-- parity:test --> `p07-dba95e` [export-import-checklist.test.ts:115](../../apps/server/test/int/export-import-checklist.test.ts#L115)
- [x] Templates: CRUD scoped to current user and export type; unique (user, type, name); load applies `null` as "uncheck"; Create/Update/Delete via AJAX with the four toast messages. <!-- parity:test --> `p07-15847a` [export-import-checklist.test.ts:70](../../apps/server/test/int/export-import-checklist.test.ts#L70)
- [x] Aliases modal: DB/table/column pickers loaded lazily; empty rows pruned on close; switch reflects presence of aliases; column aliases keyed `[colums]` (source mismatch — decide whether to replicate). <!-- parity:test --> `p07-a32e1d` [export-import-checklist.e2e.ts:155](../../tests/e2e/export-import-checklist.e2e.ts#L155)

SQL output
- [x] Header banner lines exactly as listed; blank lines only when comments are on. <!-- parity:test --> `p07-ac34e1` [export-sql.parity.test.ts:49](../../tests/parity/export-sql.parity.test.ts#L49) +1
- [x] `SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";` only for compatibility `NONE`. <!-- parity:test --> `p07-8ea5f1` [export-sql.parity.test.ts:49](../../tests/parity/export-sql.parity.test.ts#L49) +1
- [x] `START TRANSACTION;`/`COMMIT;`, `SET FOREIGN_KEY_CHECKS=0/1;`, `SET time_zone = "+00:00";` per options; connection time zone restored. <!-- parity:test --> `p07-8d25af` [export-sql.parity.test.ts:49](../../tests/parity/export-sql.parity.test.ts#L49) +2
- [x] Charset preamble/restore only for file output. <!-- parity:test --> `p07-8cba02` [export-sql.parity.test.ts:54](../../tests/parity/export-sql.parity.test.ts#L54)
- [x] Routines before tables; events last; triggers right after each table's data; views after all tables with stand-ins first (single-file mode only). <!-- parity:test --> `p07-082881` [export-sql.parity.test.ts:49](../../tests/parity/export-sql.parity.test.ts#L49)
- [x] Keys, constraints and AUTO_INCREMENT split out into deferred `ALTER TABLE` blocks flushed at DB footer in order indexes → auto-increments → views → constraints, each with "for dumped tables"/"for table" banners; skipped for ARCHIVE engine; kept inline with `IF NOT EXISTS`. <!-- parity:test --> `p07-16d4c6` [export-sql.parity.test.ts:49](../../tests/parity/export-sql.parity.test.ts#L49) +1
- [x] FULLTEXT keys one `ALTER TABLE` each. <!-- parity:test --> `p07-b70b31` [export-import-checklist.test.ts:149](../../apps/server/test/int/export-import-checklist.test.ts#L149)
- [x] `AUTO_INCREMENT=<n>` appended only if the option is on, the table has the attribute and the table's data is being exported. <!-- parity:test --> `p07-e00e83` [export-sql.parity.test.ts:67](../../tests/parity/export-sql.parity.test.ts#L67)
- [x] Extended inserts split at `sql_max_query_size`; `0` disables. <!-- parity:test --> `p07-bf25c1` [export-sql.parity.test.ts:76](../../tests/parity/export-sql.parity.test.ts#L76) +2
- [x] UPDATE mode writes one statement per row with a unique-condition WHERE; REPLACE/IGNORE/DELAYED keyword placement as specified. <!-- parity:test --> `p07-0e07e2` [export-sql.parity.test.ts:103](../../tests/parity/export-sql.parity.test.ts#L103) +3
- [x] BIT → `b'…'`, GEOMETRY → `0x…`, binary → `0x…` only with hex option, empty binary → `''`. <!-- parity:test --> `p07-d565d2` [export-sql.parity.test.ts:92](../../tests/parity/export-sql.parity.test.ts#L92)
- [x] MSSQL: ANSI quotes, type rewrites, `SET IDENTITY_INSERT t ON ;`/`OFF;` around data. <!-- parity:test --> `p07-40938a` [export-sql.parity.test.ts:127](../../tests/parity/export-sql.parity.test.ts#L127)
- [x] DEFINER stripped from views when "Exclude definition of current user" or global `remove_definer_from_definitions`; routines/events only with the global flag. <!-- parity:test --> `p07-1c04ca` [export-sql.parity.test.ts:116](../../tests/parity/export-sql.parity.test.ts#L116)
- [x] Metadata block uses `USE pmadb;` and `@LAST_PAGE` for pdf_pages/table_coords. <!-- parity:test --> `p07-ab7ea3` [export-sql.parity.test.ts:225](../../tests/parity/export-sql.parity.test.ts#L225)

Import page
- [x] "Browse your computer: (Max: NNNKiB)" from `min(upload_max_filesize, post_max_size)`. <!-- parity:test --> `p07-e0cbaa` [export-import-checklist.test.ts:207](../../apps/server/test/int/export-import-checklist.test.ts#L207) +1
- [x] Tabs "Upload a file"/"Select file to import" only when both uploads and `UploadDir` are available; local tab pre-selected when resuming a local file. <!-- parity:test --> `p07-f1893a` [export-import-checklist.test.ts:213](../../apps/server/test/int/export-import-checklist.test.ts#L213) +1
- [x] UploadDir listing filtered by `\.(ext1|ext2…)(\.(gz|bz2|zip))?$`, excludes symlinks, "There are no files to import!" when empty, error when unreadable. <!-- parity:test --> `p07-e1518d` [import.test.ts:120](../../apps/server/test/int/import.test.ts#L120)
- [x] Charset select is encoding list when conversion is supported; else MySQL charsets with `utf8` default and `SET NAMES` behaviour. <!-- parity:test --> `p07-02628c` [import.parity.test.ts:162](../../tests/parity/import.parity.test.ts#L162)
- [x] Choosing a file auto-selects the matching format (ignoring a compression suffix). <!-- parity:test --> `p07-50895c` [import.test.ts:6](../../apps/web/src/features/import/import.test.ts#L6)
- [x] Enclosure/escape inputs capped at one char client-side (two allowed if first is `\`). <!-- parity:test --> `p07-22fafd` [import.test.ts:13](../../apps/web/src/features/import/import.test.ts#L13)
- [x] Allow-interrupt uses `max_execution_time − 1` with a 5 s safety margin; `0` means never interrupt. <!-- parity:test --> `p07-89e7c9` [export-import-checklist.test.ts:220](../../apps/server/test/int/export-import-checklist.test.ts#L220)
- [x] Skip-queries input hidden when resuming; `skip=<offset>` hidden field + info banner shown. <!-- parity:test --> `p07-ca9144` [export-import-checklist.test.ts:220](../../apps/server/test/int/export-import-checklist.test.ts#L220) +1
- [x] FK checks: hidden `fk_checks=0` + switch `1`; server sets/restores `FOREIGN_KEY_CHECKS`. <!-- parity:test --> `p07-abd2aa` [import.parity.test.ts:177](../../tests/parity/import.parity.test.ts#L177) +1
- [x] Oversized upload (empty POST) → FAQ 1.16 error; no file and no text → "No data was received to import…". <!-- parity:test --> `p07-797ff9` [import.parity.test.ts:308](../../tests/parity/import.parity.test.ts#L308)
- [x] Compression detected by magic bytes, not extension; zip is read fully into memory; bzip2/gzip streamed. <!-- parity:test --> `p07-85c45c` [import.test.ts:49](../../packages/import/test/import.test.ts#L49) +2
- [x] BOM stripped from the first chunk; chunk size grows ×2 up to ×8 of 32 KiB, capped by `memory_limit/8`. <!-- parity:test --> `p07-78ed9c` [import.test.ts:64](../../packages/import/test/import.test.ts#L64) +1
- [x] First 50 statements are deferred to the `/sql` results page unless `forceExecute`; beyond that executed directly; displayed SQL dropped when too long. <!-- parity:test --> `p07-2162b4` [import.parity.test.ts:126](../../tests/parity/import.parity.test.ts#L126) +1
- [x] Success message "Import has been successfully finished, N queries executed." + "(filename)" + created-structures list for CSV/ODS/XML/SHP/MediaWiki. <!-- parity:test --> `p07-b1fc0b` [import.parity.test.ts:189](../../tests/parity/import.parity.test.ts#L189)
- [x] Timeout message with resubmit link carrying `timeout_passed`, `offset`, `local_import_file`; extra sentence when no progress. <!-- parity:test --> `p07-5a8804` [export-import-checklist.test.ts:220](../../apps/server/test/int/export-import-checklist.test.ts#L220) +1
- [x] Progress bar only with the `uploadprogress` extension; otherwise "Please be patient…" text; form targets a hidden iframe only when a progress handler exists. <!-- parity:test --> `p07-573c56` [export-import-checklist.e2e.ts:233](../../tests/e2e/export-import-checklist.e2e.ts#L233)
- [x] Drag-and-drop requires a selected DB, accepts `sql|xml|ldi|mediawiki|shp` (+`gz|bz2|zip`), posts fixed defaults, shows per-file progress/cancel/result. <!-- parity:test --> `p07-ca06b4` [import.test.ts:21](../../apps/web/src/features/import/import.test.ts#L21)
- [x] CSV: separator validation messages; Excel trailing-`;` hack; `NULL` literal → NULL; `csv_partial_import` ineffective (source quirk). <!-- parity:test --> `p07-e0700d` [import.parity.test.ts:198](../../tests/parity/import.parity.test.ts#L198) +1
- [x] LDI: table scope only; rejects compressed/charset-converted input; `skip_queries` → `IGNORE n LINES`; LOCAL default from `@@local_infile`. <!-- parity:test --> `p07-d5749f` [import.parity.test.ts:253](../../tests/parity/import.parity.test.ts#L253) +2
- [x] ODS: sheet → table, `number-columns-repeated`, alpha column names, percentage/currency numeric values. <!-- parity:test --> `p07-3e1771` [import.parity.test.ts:272](../../tests/parity/import.parity.test.ts#L272)
- [x] XML: `pma:` structure executed as `CREATE TABLE IF NOT EXISTS`; selected DB overrides file DB. <!-- parity:test --> `p07-712f57` [import.parity.test.ts:295](../../tests/parity/import.parity.test.ts#L295)

Schema export
- [x] Dialog lists Dia/EPS/PDF/SVG with per-format options; PDF hidden without TCPDF. <!-- parity:test --> `p07-8281fd` [export-import-checklist.test.ts:174](../../apps/server/test/int/export-import-checklist.test.ts#L174)
- [x] Coordinates and table list always come from the posted canvas state (`t_x/t_y/t_tbl…`); `offline_export` when Designer tables are not configured. <!-- parity:test --> `p07-a8542e` [export-import-checklist.test.ts:195](../../apps/server/test/int/export-import-checklist.test.ts#L195)
- [x] File name = page description when a saved page is exported online, else `<db>`. <!-- parity:test --> `p07-164735` [export-import-checklist.test.ts:182](../../apps/server/test/int/export-import-checklist.test.ts#L182)
- [x] Only relations between selected tables are drawn; keys-only mode shows indexed columns only. <!-- parity:test --> `p07-9b4b39` [database-designer.parity.test.ts:502](../../tests/parity/database-designer.parity.test.ts#L502) +1
- [ ] PDF data dictionary pages, TOC, bookmarks, internal links; grid labels in scaled coordinates. <!-- parity:n/a: SchemaPdf needs TCPDF, which the reference build does not ship either (no PDF schema is offered) -->

---

## Rebuild notes

**Streaming export.** phpMyAdmin streams plain (uncompressed, non-separate) exports line by line through `OutputHandler::addLine` → `echo`, buffers everything for zip or for gzip-without-CompressOnFly, and buffers per object for separate files. In a modern stack: model the dump as an async generator of chunks produced by the same walk order (`exportHeader` → per DB: header/create/routines/tables(data,triggers)/views/footer/metadata/events → footer). Pipe it through optional transforms (charset transcoder, gzip stream) into the HTTP response with `Content-Disposition`; for zip use a streaming zip writer so "separate files" becomes one zip entry per object without holding the whole dump in memory (phpMyAdmin's `ZipExtension::createFile` builds the archive in memory with CRC32/deflate per entry). The SQL plugin's deferred `ALTER TABLE` blocks require per-database state (indexes, auto-increments, views, constraints) that is flushed at the DB footer — keep that as an explicit accumulator rather than globals. Run data queries unbuffered (cursor/streaming rows) and fetch `SELECT <non-generated columns>` as the source does. Save-to-server becomes a writable stream target with the same overwrite/permission/space error messages. Time-limit handling (`ExecTimeLimit`, shutdown flag, `/export/check-time-out`) should become either a cancellable job with progress or simply a streamed response with a server-side deadline; the "view as text" mode is just the same stream rendered into a `<textarea>` with Back/Refresh/Copy actions, and the repopulate contract (`repopulate=1` + original params, session-held aliases) must be preserved if you keep that page.

**Chunked upload and resumable import.** The PHP model is: one multipart POST, the whole file lands in a temp dir, then a time-boxed parse loop that may stop early and report `offset` for the user to resubmit the *same* file with `skip=<offset>`; progress is only for the upload phase and only with a PECL extension. A modern equivalent: (1) chunked/resumable upload (tus or multipart ranges) into object/temp storage keyed by an upload id, giving real upload progress for free (replaces `UploadProgress/UploadNoplugin` and the `/import-status` polling of `$_SESSION['__upload_status']`); (2) a background import job that reads the stored file with a bounded buffer (reproduce `getNextChunk`: growing chunk size, BOM strip, charset transcoding, magic-byte compression detection with streaming gzip/bzip2 and in-memory or streamed zip), applies `fk_checks`, `SET SQL_MODE` for SQL compatibility and `NO_AUTO_VALUE_ON_ZERO`, honours `skip_queries`, and persists its byte `offset` so a resume continues from the stored file without re-uploading — this subsumes "Allow the interruption of an import" and the "Previous import timed out, after resubmitting will continue from position %d." flow; (3) job status endpoint returning executed query count, failures (first error aborts unless an "ignore errors" flag, mirroring `IgnoreMultiSubmitErrors`), the final "Import has been successfully finished, N queries executed." message and the created-structures list. Keep the ≤50-statement "show results like the SQL tab" behaviour (`goSql`) as a mode of the SQL-box path, not of file import. CSV/ODS/XML/SHP/MediaWiki table creation should reuse one analyser implementing `detectType/detectSize/buildSql` exactly (type ladder None<Int<BigInt<Decimal<Varchar, `varchar(10)` fallback, `text` above 16383, `CREATE TABLE IF NOT EXISTS`, multi-row INSERT, naming `COL n`/`A..Z`, `TABLE`/`name_n` collision rule, `CSV_DB n`/`ODS_DB`/`SHP_DB`/`mediawiki_DB` fallback databases with `utf8_general_ci`). Decide explicitly about the two source quirks (`csv_partial_import` no-op, `[colums]` alias key) and the undeclared-but-read options (`htmlword_*`, `texytext_*`, `pdf_relation/mime`, `*_show_table_dimension`), since a strict clone would reproduce them while a faithful-intent clone would expose them.

## Corrections from the rebuild (phpMyAdmin wins)

Observed in the reference while porting (golden tests in `tests/parity/export-*.parity.test.ts`, `tests/parity/import.parity.test.ts`):

- **Database-scope format switch**: phpMyAdmin 6 renders the `*_structure_or_data` radios and `export.ts` turns them into hidden `structure_and_data` fields plus a disabled `<name>_default`. `setupTableStructureOrData` clears the data column for a `structure` default and the structure column for `data` (MediaWiki); its "re-tick the selected rows when a column is empty" branch never takes effect in Chromium, so a cleared column stays cleared across later format changes. `handleAddProcCheckbox` also runs on load: at server and table scope (no `#table_structure_all`) "Add CREATE PROCEDURE / FUNCTION / EVENT" starts unchecked.
- **XML export**: `exportStruct` (and so the `xmlns:pma` attribute and the structure section) ignores `xml_export_events`; a raw-query XML export writes nothing for the query.
- **PHP array**: the doc comment escaping (`strtr($s, '*/', '-')`) only replaces `*`.
- **ODS/ODT export** die with a `TypeError` (strict types) on a NULL geometry (`bin2hex(null)`) and, for ODS, on a TIME `strtotime()` cannot parse (`-838:59:59`); BetterMyAdmin writes `0x` and `PT00H00M00S` there.
- **PDF** is not offered: the reference build has no TCPDF, and BetterMyAdmin does not port it.
- **File import result page**: in the goSql path phpMyAdmin also shows "Import has been successfully finished, N queries executed." (the page header's `Current::$message`) unless a statement returned rows (`getQueryResponseForResultsReturned` resets it); with a failing statement the page is that message plus the error card. The "No data was received…" error appears twice (header + body); a CSV parameter error appears as the error card and again as the header message.
- **ESRI shape import** builds `GeomFromText(…)`, which MySQL 8 no longer has, so the INSERT fails there; without the `dbase` extension (the reference build) no `.dbf` attributes are read.
- **Drag and drop**: `DragDropImport.hasFiles` returns false for any drag without `application/x-moz-nativeimage` (inverted test), so the feature only works in Firefox; BetterMyAdmin applies the intended check.
- **Upload limit**: the file goes up in chunks to `…/import/uploads` (exception X9), so the "(Max: …)" label shows `$cfg['MaxUploadSize']`; progress and the result stream from `GET …/import/jobs/:id/events` (SSE).

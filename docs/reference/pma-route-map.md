# phpMyAdmin route map (source of truth for parity)

Extracted from the `#[Route]` attributes on every controller under `src/Controllers` of phpMyAdmin 6.0.0-dev (commit e3e877e, 2026-10-06). 195 routes. Routes are collected by `src/Routing/Routes.php` and dispatched with FastRoute; "GET, POST" routes are page routes that also accept form posts, "POST"-only routes are AJAX actions, "GET"-only routes are read-only pages or JSON feeds.

The right-hand column is the BetterMyAdmin route or API endpoint that replaces it (see [API reference](../architecture/05-api-reference.md) and [Frontend architecture](../architecture/03-frontend-architecture.md)).

| Methods | phpMyAdmin route | Controller | BetterMyAdmin equivalent |
|---|---|---|---|
| GET, POST | `/browse-foreigners` | `BrowseForeignersController` | API `/api/servers/:s/databases/:db/tables/:table/foreign-values` |
| GET | `/changelog` | `ChangeLogController` | UI `/about/*` (static) |
| GET, POST | `/check-relations` | `CheckRelationsController` | API `GET /api/servers/:s/metadata-storage/status` |
| POST | `/collation-connection` | `CollationConnectionController` | API `POST /api/servers/:s/session/collation` |
| POST | `/columns` | `ColumnController` | API `GET /api/servers/:s/databases[/:db/tables[/:table/columns]]` (name lists for pickers) |
| POST | `/console/bookmark/add` | `Console/Bookmark/AddController` | API `/api/console/*` (bookmarks, config) |
| GET | `/console/bookmark/refresh` | `Console/Bookmark/RefreshController` | API `/api/console/*` (bookmarks, config) |
| POST | `/console/update-config` | `Console/UpdateConfigController` | API `/api/console/*` (bookmarks, config) |
| GET, POST | `/database/central-columns` | `Database/CentralColumnsController` | UI `/s/:s/db/:db/central-columns` · API `/api/servers/:s/databases/:db/central-columns` |
| POST | `/database/central-columns/populate` | `Database/CentralColumns/PopulateColumnsController` | UI `/s/:s/db/:db/central-columns/populate` · API `/api/servers/:s/databases/:db/central-columns/populate` |
| GET | `/database/data-dictionary` | `Database/DataDictionaryController` | UI `/s/:s/db/:db/data-dictionary` · API `/api/servers/:s/databases/:db/data-dictionary` |
| GET, POST | `/database/designer` | `Database/DesignerController` | UI `/s/:s/db/:db/designer` · API `/api/servers/:s/databases/:db/designer` |
| GET, POST | `/database/events` | `Database/EventsController` | UI `/s/:s/db/:db/events` · API `/api/servers/:s/databases/:db/events` |
| GET, POST | `/database/export` | `Database/ExportController` | UI `/s/:s/db/:db/export` · API `/api/servers/:s/databases/:db/export` |
| GET, POST | `/database/import` | `Database/ImportController` | UI `/s/:s/db/:db/import` · API `/api/servers/:s/databases/:db/import` |
| GET | `/database/multi-table-query` | `Database/MultiTableQueryController` | UI `/s/:s/db/:db/multi-table-query` · API `/api/servers/:s/databases/:db/multi-table-query` |
| POST | `/database/multi-table-query/query` | `Database/MultiTableQuery/QueryController` | UI `/s/:s/db/:db/multi-table-query/query` · API `/api/servers/:s/databases/:db/multi-table-query/query` |
| GET | `/database/multi-table-query/tables` | `Database/MultiTableQuery/TablesController` | UI `/s/:s/db/:db/multi-table-query/tables` · API `/api/servers/:s/databases/:db/multi-table-query/tables` |
| GET, POST | `/database/operations` | `Operations/DatabaseController` | UI `/s/:s/db/:db/operations` · API `/api/servers/:s/databases/:db/operations` |
| POST | `/database/operations/collation` | `Operations/Database/CollationController` | UI `/s/:s/db/:db/operations/collation` · API `/api/servers/:s/databases/:db/operations/collation` |
| GET | `/database/privileges` | `Database/PrivilegesController` | UI `/s/:s/db/:db/privileges` · API `/api/servers/:s/databases/:db/privileges` |
| GET, POST | `/database/routines` | `Database/RoutinesController` | UI `/s/:s/db/:db/routines` · API `/api/servers/:s/databases/:db/routines` |
| GET, POST | `/database/search` | `Database/SearchController` | UI `/s/:s/db/:db/search` · API `/api/servers/:s/databases/:db/search` |
| GET, POST | `/database/sql` | `Database/SqlController` | UI `/s/:s/db/:db/sql` · API `/api/servers/:s/databases/:db/sql` |
| POST | `/database/sql/autocomplete` | `Database/SqlAutoCompleteController` | UI `/s/:s/db/:db/sql/autocomplete` · API `/api/servers/:s/databases/:db/sql/autocomplete` |
| POST | `/database/sql/format` | `Database/SqlFormatController` | UI `/s/:s/db/:db/sql/format` · API `/api/servers/:s/databases/:db/sql/format` |
| GET, POST | `/database/structure` | `Database/StructureController` | UI `/s/:s/db/:db/structure` · API `/api/servers/:s/databases/:db/structure` |
| POST | `/database/structure/add-prefix` | `Database/Structure/AddPrefixController` | UI `/s/:s/db/:db/structure/add-prefix` · API `/api/servers/:s/databases/:db/structure/add-prefix` |
| POST | `/database/structure/add-prefix-table` | `Database/Structure/AddPrefixTableController` | UI `/s/:s/db/:db/structure/add-prefix-table` · API `/api/servers/:s/databases/:db/structure/add-prefix-table` |
| POST | `/database/structure/central-columns/add` | `Database/Structure/CentralColumns/AddController` | UI `/s/:s/db/:db/structure/central-columns/add` · API `/api/servers/:s/databases/:db/structure/central-columns/add` |
| POST | `/database/structure/central-columns/make-consistent` | `Database/Structure/CentralColumns/MakeConsistentController` | UI `/s/:s/db/:db/structure/central-columns/make-consistent` · API `/api/servers/:s/databases/:db/structure/central-columns/make-consistent` |
| POST | `/database/structure/central-columns/remove` | `Database/Structure/CentralColumns/RemoveController` | UI `/s/:s/db/:db/structure/central-columns/remove` · API `/api/servers/:s/databases/:db/structure/central-columns/remove` |
| POST | `/database/structure/change-prefix-form` | `Database/Structure/ChangePrefixFormController` | UI `/s/:s/db/:db/structure/change-prefix-form` · API `/api/servers/:s/databases/:db/structure/change-prefix-form` |
| POST | `/database/structure/copy-form` | `Database/Structure/CopyFormController` | UI `/s/:s/db/:db/structure/copy-form` · API `/api/servers/:s/databases/:db/structure/copy-form` |
| POST | `/database/structure/copy-table` | `Database/Structure/CopyTableController` | UI `/s/:s/db/:db/structure/copy-table` · API `/api/servers/:s/databases/:db/structure/copy-table` |
| POST | `/database/structure/copy-table-with-prefix` | `Database/Structure/CopyTableWithPrefixController` | UI `/s/:s/db/:db/structure/copy-table-with-prefix` · API `/api/servers/:s/databases/:db/structure/copy-table-with-prefix` |
| POST | `/database/structure/drop-form` | `Database/Structure/DropFormController` | UI `/s/:s/db/:db/structure/drop-form` · API `/api/servers/:s/databases/:db/structure/drop-form` |
| POST | `/database/structure/drop-table` | `Database/Structure/DropTableController` | UI `/s/:s/db/:db/structure/drop-table` · API `/api/servers/:s/databases/:db/structure/drop-table` |
| POST | `/database/structure/empty-form` | `Database/Structure/EmptyFormController` | UI `/s/:s/db/:db/structure/empty-form` · API `/api/servers/:s/databases/:db/structure/empty-form` |
| POST | `/database/structure/empty-table` | `Database/Structure/EmptyTableController` | UI `/s/:s/db/:db/structure/empty-table` · API `/api/servers/:s/databases/:db/structure/empty-table` |
| POST | `/database/structure/favorite-table` | `Database/Structure/FavoriteTableController` | UI `/s/:s/db/:db/structure/favorite-table` · API `/api/servers/:s/databases/:db/structure/favorite-table` |
| GET, POST | `/database/structure/real-row-count` | `Database/Structure/RealRowCountController` | UI `/s/:s/db/:db/structure/real-row-count` · API `/api/servers/:s/databases/:db/structure/real-row-count` |
| POST | `/database/structure/replace-prefix` | `Database/Structure/ReplacePrefixController` | UI `/s/:s/db/:db/structure/replace-prefix` · API `/api/servers/:s/databases/:db/structure/replace-prefix` |
| POST | `/database/structure/show-create` | `Database/Structure/ShowCreateController` | UI `/s/:s/db/:db/structure/show-create` · API `/api/servers/:s/databases/:db/structure/show-create` |
| GET, POST | `/database/tracking` | `Database/TrackingController` | UI `/s/:s/db/:db/tracking` · API `/api/servers/:s/databases/:db/tracking` |
| POST | `/databases` | `DatabaseController` | API `GET /api/servers/:s/databases[/:db/tables[/:table/columns]]` (name lists for pickers) |
| GET, POST | `/error-report` | `ErrorReportController` | `POST /api/telemetry/error` (opt-in) |
| GET, POST | `/export` | `Export/ExportController` | API `/api/export/*` (streaming) |
| GET | `/export/check-time-out` | `Export/CheckTimeOutController` | API `/api/export/*` (streaming) |
| POST | `/export/tables` | `Export/TablesController` | API `/api/export/*` (streaming) |
| POST | `/export/template/create` | `Export/Template/CreateController` | API `/api/export/*` (streaming) |
| POST | `/export/template/delete` | `Export/Template/DeleteController` | API `/api/export/*` (streaming) |
| POST | `/export/template/load` | `Export/Template/LoadController` | API `/api/export/*` (streaming) |
| POST | `/export/template/update` | `Export/Template/UpdateController` | API `/api/export/*` (streaming) |
| GET, POST | `/gis-data-editor` | `GisDataEditorController` | client component `GisEditor` + `POST /api/gis/preview` |
| GET, POST | `/git-revision` | `GitInfoController` | `GET /api/meta/build` |
| GET, POST | `/import` | `Import/ImportController` | API `/api/import/*` (chunked upload + SSE progress) |
| GET, POST | `/import-status` | `Import/StatusController` | API `/api/import/*` (chunked upload + SSE progress) |
| POST | `/import/simulate-dml` | `Import/SimulateDmlController` | API `/api/import/*` (chunked upload + SSE progress) |
| GET | `/license` | `LicenseController` | UI `/about/*` (static) |
| GET, POST | `/lint` | `LintController` | client-side lint (SQL tokenizer in the browser) + `POST /api/sql/lint` fallback |
| GET, POST | `/logout` | `LogoutController` | `POST /api/auth/logout` |
| GET | `/messages` | `JavaScriptMessagesController` | not needed: i18n bundles are shipped with the SPA |
| GET, POST | `/navigation` | `NavigationController` | API `/api/servers/:s/navigation/*` (tree children, lazy) |
| POST | `/navigation/update-width` | `Navigation/UpdateNavWidthConfigController` | see API reference |
| GET, POST | `/normalization` | `Normalization/MainController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/1nf/step1` | `Normalization/FirstNormalForm/FirstStepController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/1nf/step2` | `Normalization/FirstNormalForm/SecondStepController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/1nf/step3` | `Normalization/FirstNormalForm/ThirdStepController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/1nf/step4` | `Normalization/FirstNormalForm/FourthStepController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/2nf/create-new-tables` | `Normalization/SecondNormalForm/CreateNewTablesController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/2nf/new-tables` | `Normalization/SecondNormalForm/NewTablesController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/2nf/step1` | `Normalization/SecondNormalForm/FirstStepController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/3nf/create-new-tables` | `Normalization/ThirdNormalForm/CreateNewTablesController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/3nf/new-tables` | `Normalization/ThirdNormalForm/NewTablesController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/3nf/step1` | `Normalization/ThirdNormalForm/FirstStepController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/add-new-primary` | `Normalization/AddNewPrimaryController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/create-new-column` | `Normalization/CreateNewColumnController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/get-columns` | `Normalization/GetColumnsController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/move-repeating-group` | `Normalization/MoveRepeatingGroup` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| POST | `/normalization/partial-dependencies` | `Normalization/PartialDependenciesController` | API `/api/servers/:s/databases/:db/tables/:table/normalization/*` |
| GET | `/phpinfo` | `PhpInfoController` | UI `/about/*` (static) |
| GET, POST | `/preferences/export` | `Preferences/ExportController` | UI `/settings/export` · API `/api/preferences` |
| GET, POST | `/preferences/features` | `Preferences/FeaturesController` | UI `/settings/features` · API `/api/preferences` |
| GET, POST | `/preferences/import` | `Preferences/ImportController` | UI `/settings/import` · API `/api/preferences` |
| GET, POST | `/preferences/main-panel` | `Preferences/MainPanelController` | UI `/settings/main-panel` · API `/api/preferences` |
| GET, POST | `/preferences/manage` | `Preferences/ManageController` | UI `/settings/manage` · API `/api/preferences` |
| GET, POST | `/preferences/navigation` | `Preferences/NavigationController` | UI `/settings/navigation` · API `/api/preferences` |
| GET, POST | `/preferences/sql` | `Preferences/SqlController` | UI `/settings/sql` · API `/api/preferences` |
| GET, POST | `/preferences/two-factor` | `Preferences/TwoFactorController` | UI `/settings/two-factor` · API `/api/preferences` |
| GET, POST | `/schema-export` | `SchemaExportController` | API `POST /api/servers/:s/databases/:db/schema-export` |
| GET, POST | `/server/binlog` | `Server/BinlogController` | UI `/s/:s/binlog` · API `/api/servers/:s/binlog` |
| GET | `/server/collations` | `Server/CollationsController` | UI `/s/:s/collations` · API `/api/servers/:s/collations` |
| GET, POST | `/server/databases` | `Server/DatabasesController` | UI `/s/:s/databases` · API `/api/servers/:s/databases` |
| POST | `/server/databases/create` | `Server/Databases/CreateController` | UI `/s/:s/databases/create` · API `/api/servers/:s/databases/create` |
| POST | `/server/databases/destroy` | `Server/Databases/DestroyController` | UI `/s/:s/databases/destroy` · API `/api/servers/:s/databases/destroy` |
| GET | `/server/engines` | `Server/EnginesController` | UI `/s/:s/engines` · API `/api/servers/:s/engines` |
| GET | `/server/engines/{engine}[/{page}]` | `Server/ShowEngineController` | UI `/s/:s/engines/{engine}[/{page}]` · API `/api/servers/:s/engines/{engine}[/{page}]` |
| GET, POST | `/server/export` | `Server/ExportController` | UI `/s/:s/export` · API `/api/servers/:s/export` |
| GET, POST | `/server/import` | `Server/ImportController` | UI `/s/:s/import` · API `/api/servers/:s/import` |
| GET | `/server/plugins` | `Server/PluginsController` | UI `/s/:s/plugins` · API `/api/servers/:s/plugins` |
| GET, POST | `/server/privileges` | `Server/PrivilegesController` | UI `/s/:s/privileges` · API `/api/servers/:s/privileges` |
| POST | `/server/privileges/account-lock` | `Server/Privileges/AccountLockController` | UI `/s/:s/privileges/account-lock` · API `/api/servers/:s/privileges/account-lock` |
| POST | `/server/privileges/account-unlock` | `Server/Privileges/AccountUnlockController` | UI `/s/:s/privileges/account-unlock` · API `/api/servers/:s/privileges/account-unlock` |
| GET, POST | `/server/replication` | `Server/ReplicationController` | UI `/s/:s/replication` · API `/api/servers/:s/replication` |
| GET, POST | `/server/sql` | `Server/SqlController` | UI `/s/:s/sql` · API `/api/servers/:s/sql` |
| GET | `/server/status` | `Server/Status/StatusController` | UI `/s/:s/status` · API `/api/servers/:s/status` |
| GET | `/server/status/advisor` | `Server/Status/AdvisorController` | UI `/s/:s/status/advisor` · API `/api/servers/:s/status/advisor` |
| GET | `/server/status/monitor` | `Server/Status/MonitorController` | `GET /api/servers/:s/status/monitor/*` (SSE stream for charts) |
| POST | `/server/status/monitor/chart` | `Server/Status/Monitor/ChartingDataController` | `GET /api/servers/:s/status/monitor/*` (SSE stream for charts) |
| POST | `/server/status/monitor/general-log` | `Server/Status/Monitor/GeneralLogController` | `GET /api/servers/:s/status/monitor/*` (SSE stream for charts) |
| POST | `/server/status/monitor/log-vars` | `Server/Status/Monitor/LogVarsController` | `GET /api/servers/:s/status/monitor/*` (SSE stream for charts) |
| POST | `/server/status/monitor/query` | `Server/Status/Monitor/QueryAnalyzerController` | `GET /api/servers/:s/status/monitor/*` (SSE stream for charts) |
| POST | `/server/status/monitor/slow-log` | `Server/Status/Monitor/SlowLogController` | `GET /api/servers/:s/status/monitor/*` (SSE stream for charts) |
| GET, POST | `/server/status/processes` | `Server/Status/ProcessesController` | UI `/s/:s/status/processes` · API `/api/servers/:s/status/processes` |
| POST | `/server/status/processes/kill/{id:\d+}` | `Server/Status/Processes/KillController` | `POST /api/servers/:s/processes/:id/kill` |
| POST | `/server/status/processes/refresh` | `Server/Status/Processes/RefreshController` | UI `/s/:s/status/processes/refresh` · API `/api/servers/:s/status/processes/refresh` |
| GET | `/server/status/queries` | `Server/Status/QueriesController` | UI `/s/:s/status/queries` · API `/api/servers/:s/status/queries` |
| GET, POST | `/server/status/variables` | `Server/Status/VariablesController` | UI `/s/:s/status/variables` · API `/api/servers/:s/status/variables` |
| GET, POST | `/server/user-groups` | `Server/UserGroupsController` | UI `/s/:s/user-groups` · API `/api/servers/:s/user-groups` |
| GET | `/server/user-groups/edit-form` | `Server/UserGroupsFormController` | UI `/s/:s/user-groups/edit-form` · API `/api/servers/:s/user-groups/edit-form` |
| GET | `/server/variables` | `Server/VariablesController` | UI `/s/:s/variables` · API `/api/servers/:s/variables` |
| GET | `/server/variables/get/{name}` | `Server/Variables/GetVariableController` | UI `/s/:s/variables/get/{name}` · API `/api/servers/:s/variables/get/{name}` |
| POST | `/server/variables/set/{name}` | `Server/Variables/SetVariableController` | UI `/s/:s/variables/set/{name}` · API `/api/servers/:s/variables/set/{name}` |
| GET, POST | `/sql` | `Sql/SqlController` | UI `/s/:s/sql` (+ db/table scopes) · API `POST /api/servers/:s/query` |
| GET | `/sql/get-default-fk-check-value` | `Sql/DefaultForeignKeyCheckValueController` | API `/api/servers/:s/sql/get-default-fk-check-value` |
| POST | `/sql/get-enum-values` | `Sql/EnumValuesController` | API `/api/servers/:s/sql/get-enum-values` |
| POST | `/sql/get-relational-values` | `Sql/RelationalValuesController` | API `/api/servers/:s/sql/get-relational-values` |
| POST | `/sql/get-set-values` | `Sql/SetValuesController` | API `/api/servers/:s/sql/get-set-values` |
| POST | `/sql/set-column-preferences` | `Sql/ColumnPreferencesController` | API `/api/servers/:s/sql/set-column-preferences` |
| POST | `/sync-favorite-tables` | `SyncFavoriteTablesController` | API `/api/servers/:s/favorites` (sync) |
| GET, POST | `/table/add-field` | `Table/AddFieldController` | UI `/s/:s/db/:db/t/:table/add-field` · API `/api/servers/:s/databases/:db/tables/:table/add-field` |
| GET, POST | `/table/change` | `Table/ChangeController` | UI `/s/:s/db/:db/t/:table/change` · API `/api/servers/:s/databases/:db/tables/:table/change` |
| POST | `/table/change/rows` | `Table/ChangeRowsController` | UI `/s/:s/db/:db/t/:table/change/rows` · API `/api/servers/:s/databases/:db/tables/:table/change/rows` |
| GET, POST | `/table/chart` | `Table/ChartController` | UI `/s/:s/db/:db/t/:table/chart` · API `/api/servers/:s/databases/:db/tables/:table/chart` |
| GET, POST | `/table/create` | `Table/CreateController` | UI `/s/:s/db/:db/t/:table/create` · API `/api/servers/:s/databases/:db/tables/:table/create` |
| POST | `/table/delete/confirm` | `Table/DeleteConfirmController` | UI `/s/:s/db/:db/t/:table/delete/confirm` · API `/api/servers/:s/databases/:db/tables/:table/delete/confirm` |
| POST | `/table/delete/rows` | `Table/DeleteRowsController` | UI `/s/:s/db/:db/t/:table/delete/rows` · API `/api/servers/:s/databases/:db/tables/:table/delete/rows` |
| GET, POST | `/table/export` | `Table/ExportController` | UI `/s/:s/db/:db/t/:table/export` · API `/api/servers/:s/databases/:db/tables/:table/export` |
| POST | `/table/export/rows` | `Table/ExportRowsController` | UI `/s/:s/db/:db/t/:table/export/rows` · API `/api/servers/:s/databases/:db/tables/:table/export/rows` |
| GET, POST | `/table/find-replace` | `Table/FindReplaceController` | UI `/s/:s/db/:db/t/:table/find-replace` · API `/api/servers/:s/databases/:db/tables/:table/find-replace` |
| GET, POST | `/table/get-field` | `Table/GetFieldController` | UI `/s/:s/db/:db/t/:table/get-field` · API `/api/servers/:s/databases/:db/tables/:table/get-field` |
| GET, POST | `/table/gis-visualization` | `Table/GisVisualizationController` | UI `/s/:s/db/:db/t/:table/gis-visualization` · API `/api/servers/:s/databases/:db/tables/:table/gis-visualization` |
| GET, POST | `/table/import` | `Table/ImportController` | UI `/s/:s/db/:db/t/:table/import` · API `/api/servers/:s/databases/:db/tables/:table/import` |
| GET, POST | `/table/indexes` | `Table/IndexesController` | UI `/s/:s/db/:db/t/:table/indexes` · API `/api/servers/:s/databases/:db/tables/:table/indexes` |
| GET, POST | `/table/indexes/rename` | `Table/IndexRenameController` | UI `/s/:s/db/:db/t/:table/indexes/rename` · API `/api/servers/:s/databases/:db/tables/:table/indexes/rename` |
| POST | `/table/maintenance/analyze` | `Table/Maintenance/AnalyzeController` | UI `/s/:s/db/:db/t/:table/maintenance/analyze` · API `/api/servers/:s/databases/:db/tables/:table/maintenance/analyze` |
| POST | `/table/maintenance/check` | `Table/Maintenance/CheckController` | UI `/s/:s/db/:db/t/:table/maintenance/check` · API `/api/servers/:s/databases/:db/tables/:table/maintenance/check` |
| POST | `/table/maintenance/checksum` | `Table/Maintenance/ChecksumController` | UI `/s/:s/db/:db/t/:table/maintenance/checksum` · API `/api/servers/:s/databases/:db/tables/:table/maintenance/checksum` |
| POST | `/table/maintenance/optimize` | `Table/Maintenance/OptimizeController` | UI `/s/:s/db/:db/t/:table/maintenance/optimize` · API `/api/servers/:s/databases/:db/tables/:table/maintenance/optimize` |
| POST | `/table/maintenance/repair` | `Table/Maintenance/RepairController` | UI `/s/:s/db/:db/t/:table/maintenance/repair` · API `/api/servers/:s/databases/:db/tables/:table/maintenance/repair` |
| GET, POST | `/table/operations` | `Operations/TableController` | UI `/s/:s/db/:db/t/:table/operations` · API `/api/servers/:s/databases/:db/tables/:table/operations` |
| POST | `/table/partition/analyze` | `Table/Partition/AnalyzeController` | UI `/s/:s/db/:db/t/:table/partition/analyze` · API `/api/servers/:s/databases/:db/tables/:table/partition/analyze` |
| POST | `/table/partition/check` | `Table/Partition/CheckController` | UI `/s/:s/db/:db/t/:table/partition/check` · API `/api/servers/:s/databases/:db/tables/:table/partition/check` |
| POST | `/table/partition/drop` | `Table/Partition/DropController` | UI `/s/:s/db/:db/t/:table/partition/drop` · API `/api/servers/:s/databases/:db/tables/:table/partition/drop` |
| POST | `/table/partition/optimize` | `Table/Partition/OptimizeController` | UI `/s/:s/db/:db/t/:table/partition/optimize` · API `/api/servers/:s/databases/:db/tables/:table/partition/optimize` |
| POST | `/table/partition/rebuild` | `Table/Partition/RebuildController` | UI `/s/:s/db/:db/t/:table/partition/rebuild` · API `/api/servers/:s/databases/:db/tables/:table/partition/rebuild` |
| POST | `/table/partition/repair` | `Table/Partition/RepairController` | UI `/s/:s/db/:db/t/:table/partition/repair` · API `/api/servers/:s/databases/:db/tables/:table/partition/repair` |
| POST | `/table/partition/truncate` | `Table/Partition/TruncateController` | UI `/s/:s/db/:db/t/:table/partition/truncate` · API `/api/servers/:s/databases/:db/tables/:table/partition/truncate` |
| GET | `/table/privileges` | `Table/PrivilegesController` | UI `/s/:s/db/:db/t/:table/privileges` · API `/api/servers/:s/databases/:db/tables/:table/privileges` |
| GET, POST | `/table/recent-favorite` | `Table/RecentFavoriteController` | UI `/s/:s/db/:db/t/:table/recent-favorite` · API `/api/servers/:s/databases/:db/tables/:table/recent-favorite` |
| GET, POST | `/table/relation` | `Table/RelationController` | UI `/s/:s/db/:db/t/:table/relation` · API `/api/servers/:s/databases/:db/tables/:table/relation` |
| GET, POST | `/table/replace` | `Table/ReplaceController` | UI `/s/:s/db/:db/t/:table/replace` · API `/api/servers/:s/databases/:db/tables/:table/replace` |
| GET, POST | `/table/search` | `Table/SearchController` | UI `/s/:s/db/:db/t/:table/search` · API `/api/servers/:s/databases/:db/tables/:table/search` |
| GET, POST | `/table/sql` | `Table/SqlController` | UI `/s/:s/db/:db/t/:table/sql` · API `/api/servers/:s/databases/:db/tables/:table/sql` |
| GET, POST | `/table/structure` | `Table/StructureController` | UI `/s/:s/db/:db/t/:table/structure` · API `/api/servers/:s/databases/:db/tables/:table/structure` |
| POST | `/table/structure/add-key` | `Table/Structure/AddKeyController` | UI `/s/:s/db/:db/t/:table/structure/add-key` · API `/api/servers/:s/databases/:db/tables/:table/structure/add-key` |
| POST | `/table/structure/browse` | `Table/Structure/BrowseController` | UI `/s/:s/db/:db/t/:table/structure/browse` · API `/api/servers/:s/databases/:db/tables/:table/structure/browse` |
| POST | `/table/structure/central-columns-add` | `Table/Structure/CentralColumnsAddController` | UI `/s/:s/db/:db/t/:table/structure/central-columns-add` · API `/api/servers/:s/databases/:db/tables/:table/structure/central-columns-add` |
| POST | `/table/structure/central-columns-remove` | `Table/Structure/CentralColumnsRemoveController` | UI `/s/:s/db/:db/t/:table/structure/central-columns-remove` · API `/api/servers/:s/databases/:db/tables/:table/structure/central-columns-remove` |
| GET, POST | `/table/structure/change` | `Table/Structure/ChangeController` | UI `/s/:s/db/:db/t/:table/structure/change` · API `/api/servers/:s/databases/:db/tables/:table/structure/change` |
| POST | `/table/structure/drop` | `Table/DropColumnController` | UI `/s/:s/db/:db/t/:table/structure/drop` · API `/api/servers/:s/databases/:db/tables/:table/structure/drop` |
| POST | `/table/structure/drop-confirm` | `Table/DropColumnConfirmationController` | UI `/s/:s/db/:db/t/:table/structure/drop-confirm` · API `/api/servers/:s/databases/:db/tables/:table/structure/drop-confirm` |
| POST | `/table/structure/fulltext` | `Table/Structure/FulltextController` | UI `/s/:s/db/:db/t/:table/structure/fulltext` · API `/api/servers/:s/databases/:db/tables/:table/structure/fulltext` |
| POST | `/table/structure/index` | `Table/Structure/AddIndexController` | UI `/s/:s/db/:db/t/:table/structure/index` · API `/api/servers/:s/databases/:db/tables/:table/structure/index` |
| POST | `/table/structure/move-columns` | `Table/Structure/MoveColumnsController` | UI `/s/:s/db/:db/t/:table/structure/move-columns` · API `/api/servers/:s/databases/:db/tables/:table/structure/move-columns` |
| POST | `/table/structure/partitioning` | `Table/Structure/PartitioningController` | UI `/s/:s/db/:db/t/:table/structure/partitioning` · API `/api/servers/:s/databases/:db/tables/:table/structure/partitioning` |
| POST | `/table/structure/primary` | `Table/Structure/PrimaryController` | UI `/s/:s/db/:db/t/:table/structure/primary` · API `/api/servers/:s/databases/:db/tables/:table/structure/primary` |
| POST | `/table/structure/reserved-word-check` | `Table/Structure/ReservedWordCheckController` | UI `/s/:s/db/:db/t/:table/structure/reserved-word-check` · API `/api/servers/:s/databases/:db/tables/:table/structure/reserved-word-check` |
| POST | `/table/structure/save` | `Table/Structure/SaveController` | UI `/s/:s/db/:db/t/:table/structure/save` · API `/api/servers/:s/databases/:db/tables/:table/structure/save` |
| POST | `/table/structure/spatial` | `Table/Structure/SpatialController` | UI `/s/:s/db/:db/t/:table/structure/spatial` · API `/api/servers/:s/databases/:db/tables/:table/structure/spatial` |
| POST | `/table/structure/unique` | `Table/Structure/UniqueController` | UI `/s/:s/db/:db/t/:table/structure/unique` · API `/api/servers/:s/databases/:db/tables/:table/structure/unique` |
| GET, POST | `/table/tracking` | `Table/TrackingController` | UI `/s/:s/db/:db/t/:table/tracking` · API `/api/servers/:s/databases/:db/tables/:table/tracking` |
| GET, POST | `/table/zoom-search` | `Table/ZoomSearchController` | UI `/s/:s/db/:db/t/:table/zoom-search` · API `/api/servers/:s/databases/:db/tables/:table/zoom-search` |
| POST | `/tables` | `TableController` | API `GET /api/servers/:s/databases[/:db/tables[/:table/columns]]` (name lists for pickers) |
| GET | `/themes` | `ThemesController` | client-side theme store (no server round trip) |
| POST | `/themes/set` | `ThemeSetController` | client-side theme store (no server round trip) |
| GET, POST | `/transformation/overview` | `Transformation/OverviewController` | API `/api/transformations` (overview) · `GET /api/.../cell` (wrapper: raw cell bytes) |
| GET, POST | `/transformation/wrapper` | `Transformation/WrapperController` | API `/api/transformations` (overview) · `GET /api/.../cell` (wrapper: raw cell bytes) |
| GET, POST | `/triggers` | `Triggers/IndexController` | UI `/s/:s/db/:db[/t/:table]/triggers` · API `.../triggers` |
| GET, POST | `/user-password` | `UserPasswordController` | `POST /api/servers/:s/account/password` |
| GET, POST | `/version-check` | `VersionCheckController` | `GET /api/meta/version-check` |
| GET, POST | `/view/create` | `View/CreateController` | UI `/s/:s/db/:db/view/*` · API `.../views` |
| GET, POST | `/view/operations` | `Operations/ViewController` | UI `/s/:s/db/:db/view/*` · API `.../views` |
| GET, POST | `[/]` | `HomeController` | UI `/s/:s` (home) |

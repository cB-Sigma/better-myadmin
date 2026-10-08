# Glossary

Terms used across the docs, with the phpMyAdmin origin where relevant.

| Term | Meaning |
|---|---|
| **pMA** | phpMyAdmin, the reference implementation. Pinned commit in `reference-commit.txt`. |
| **BMA** | BetterMyAdmin, this project. |
| **Scope** | One of Server / Database / Table. Each has its own tab bar and URL prefix. |
| **Tab** | A page within a scope (Browse, Structure, SQL, ...). Called "menu tab" in pMA (`Menu.php`). |
| **Nav panel / tree** | The left-hand database/table tree (`Navigation/*`). |
| **Console** | The bottom drawer with query input, history, options, bookmarks and Debug SQL tabs (`Console/*`). |
| **pmadb / configuration storage** | The 19 optional tables phpMyAdmin uses for metadata (`pma__bookmark`, `pma__relation`, ...). Same schema used by BMA. |
| **`*work` flags** | pMA's names for "is this pmadb feature usable" booleans: `relwork`, `displaywork`, `bookmarkwork`, `pdfwork`, `commwork`, `mimework`, `historywork`, `recentwork`, `favoritework`, `uiprefswork`, `trackingwork`, `userconfigwork`, `menuswork`, `navwork`, `savedsearcheswork`, `centralcolumnswork`, `designersettingswork`, `exporttemplateswork`. |
| **Control user** | `controluser`/`controlpass`: a MySQL account with rights on pmadb, used so regular users do not need them. |
| **Directive** | A configuration key (`$cfg['MaxRows']` in pMA; `MaxRows` in BMA config). See the [config reference](config-directives.md). |
| **User preference** | A directive the user may override, stored in `pma__userconfig` (or localStorage). `UserprefsDisallow` blocks overrides. |
| **Page settings** | The gear popup on a page offering the relevant preference subset (`Config/Forms/Page/*`). |
| **Internal relation** | A relation stored in `pma__relation` rather than as a FK constraint; used for engines without FK support or cross-db links. |
| **Display field / display column** | The column of a referenced table shown instead of (or next to) the key value (`pma__table_info.display_field`). Governed by `RelationalDisplay` K/D. |
| **FK traversal** | Clicking a foreign-key value in Browse to open the referenced table filtered to that key. |
| **Unique condition** | The `WHERE` clause that identifies a row for edit/delete, built from PK, else a unique key, else all columns (`Util::getUniqueCondition`). |
| **Signed query** | A `sql_query` in a URL accompanied by an HMAC (`sql_signature`) so a GET can safely re-run it. |
| **Grid editing** | In-place cell editing in Browse (`GridEditing` directive). |
| **Transformation** | A per-column plugin that changes how a value is displayed (output/browser transformation) or edited (input transformation), configured via MIME type in Structure and stored in `pma__column_info`. |
| **Central columns** | A per-database list of reusable column definitions (`pma__central_columns`). |
| **Tracking** | Versioned logging of DDL/DML for a table (`pma__tracking`). |
| **Designer** | The ER-diagram canvas for relations and layout pages (`pma__table_coords`, `pma__pdf_pages`). |
| **QBE / Query by example** | The multi-table visual query builder on the database "Query" tab. The classic `database_qbe` page is removed in pMA master. |
| **Zoom search** | Table search mode that plots two columns and lets you click points to edit rows. |
| **Export template** | A saved set of export options (`pma__export_templates`). |
| **Partial import** | Import that stops before a time limit and can resume at statement N (`skip_queries`). |
| **Advisor** | The rule-based tuning advice page under Status (55 rules in `Advisory/Rules.php`). |
| **Monitor** | Live status charts under Status (`server/status/monitor`). |
| **Approximate count** | Row count from table statistics instead of `COUNT(*)` when above `MaxExactCount`. |
| **Golden parity test** | A test that performs the same action in pMA and BMA and diffs the SQL (from the general log) or the output file. |
| **Micro-behaviours checklist** | The flat `- [ ]` list at the end of each feature doc; the acceptance criteria for parity. |
| **Allowed diff** | An entry in `tests/parity/allowed-diffs.yaml` documenting an accepted, justified difference from pMA. |
| **Reference commit** | The exact phpMyAdmin git commit the docs and golden files were derived from. |

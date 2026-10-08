# Parity exceptions register

Every intentional difference between BetterMyAdmin and phpMyAdmin (reference commit in `reference-commit.txt`). Anything not listed here is a bug. Each entry: what differs, why, and where it was decided. Source quirks found during the audits are listed separately at the bottom: these are phpMyAdmin behaviours that look like bugs; we reproduce them unless marked otherwise, and track upstream.

## Intentional differences

| # | Area | phpMyAdmin | BetterMyAdmin | Why | Decided in |
|---|---|---|---|---|---|
| X1 | Auth | Encrypted password stored in the browser cookie | Session id only in cookie; credentials encrypted in server-side session store | Leaked cookie yields nothing | [D10](../architecture/01-tech-stack.md) |
| X2 | Auth | Brute force mitigated only by optional captcha | Rate limiting on by default (`LoginRateLimit`) plus the same captcha directives | Modern baseline | [Security](../architecture/07-security.md) |
| X3 | Export | CSV cells never formula-escaped | Same by default; opt-in `Export.csv_escape_formulas` | Byte parity by default, safer option available | [Security](../architecture/07-security.md) |
| X4 | Transformations | `Text_Plain_External` can run allow-listed shell programs | No process execution; allow-listed in-process formatters | No shell-out from a web app | [Security](../architecture/07-security.md) |
| X5 | Charsets | `RecodingEngine=recode` supported | Only `iconv`/`mb` semantics via `iconv-lite` | `recode` is PHP-specific | [Tech stack](../architecture/01-tech-stack.md) |
| X6 | Config | `config.inc.php` (PHP) | `bettermyadmin.config.ts|json|yaml` + env; `bma import-pma-config` converts | No PHP runtime | [Data model](../architecture/06-data-and-metadata-model.md) |
| X7 | Setup | `public/setup` PHP script | First-run wizard generating our config | Same purpose, different format | Roadmap M4 |
| X8 | Metadata | No metadata without pmadb (localStorage only for prefs/favorites) | Additional SQLite fallback for per-user tables | Avoids a wall when no control user | [D11](../architecture/01-tech-stack.md) |
| X9 | Import | Partial import driven by PHP time limits | Streaming + resumable chunked upload; UI for partial import kept | Node has no execution time limit | [D12](../architecture/01-tech-stack.md) |
| X10 | Export | Buffered unless `CompressOnFly` | Always streamed | Memory | [D12](../architecture/01-tech-stack.md) |
| X11 | Status monitor | AJAX polling | SSE stream | Fewer requests, smoother charts; same UI | [Backend](../architecture/04-backend-architecture.md) |
| X12 | SQL formatting | `phpmyadmin/sql-parser` Formatter | *Withdrawn*: the Formatter is ported exactly (fixture-tested), no difference left | — | [D7](../architecture/01-tech-stack.md) |
| X13 | Browse | "Show all" refused above threshold | Same refusal and message; confirm to proceed uses virtualized rendering | Capability, not behaviour change | [Frontend](../architecture/03-frontend-architecture.md) |
| X14 | Query | No cancel | Cancel button issues `KILL QUERY` | Additive | [API](../architecture/05-api-reference.md) |
| X15 | phpinfo | `phpinfo()` page (`ShowPhpInfo`) | "Runtime info" page (Node version, platform, config summary) | No PHP | Shell doc |
| X16 | Themes | Theme CSS compiled per theme (`pmahomme`, `original`, `metro`, `bootstrap`) | Same four as token sets + dark variants | Implementation | [UI design](../architecture/09-ui-design-system.md) |
| X17 | Mobile | No responsive layout | Nav panel becomes a drawer below 1024 px | Additive, not a parity target | [UI design](../architecture/09-ui-design-system.md) |
| X18 | i18n | gettext `.po` at runtime | Same `.po` imported to Lingui at build | Implementation; identical msgids | [D13](../architecture/01-tech-stack.md) |
| X19 | Error reports | Sent to phpmyadmin.net | Sent to BetterMyAdmin's endpoint, same `SendErrorReports` semantics | Different project | Shell doc |
| X20 | Version check | phpmyadmin.net `version.json` | BetterMyAdmin release feed | Different project | Shell doc |
| X21 | Headers | No `X-Frame-Options` (CSP `frame-ancestors` + JS check) | Adds `X-Frame-Options` consistent with `AllowThirdPartyFraming` | Defence in depth | [Security](../architecture/07-security.md) |
| X22 | Config | `ForceSSL` documented as deprecated, not acted on | Honoured: redirects to HTTPS and sets HSTS | Useful behind TLS terminators | [Security](../architecture/07-security.md) |
| X23 | Themes | Colour mode chosen manually per theme | Defaults to `prefers-color-scheme`, manual override kept | Expected on modern desktops | [UI design](../architecture/09-ui-design-system.md) |
| X24 | Connections | A new MySQL connection per HTTP request, so `postConnect` (`SELECT @@version…`, `SET NAMES`, `SET lc_messages`, `SET collation_connection`) runs on every request | Pooled connections per (session, server); the same set-up statements run once per new connection | Latency; same session state. The parity harness compares session set-up as final state, not per request | [Backend](../architecture/04-backend-architecture.md#connection-manager) |
| X26 | Console | Console options saved through `/console/update-config` into the user preferences (pmadb or session) | Same endpoint and validation (`POST /console/config`), values kept in the session and in this browser's localStorage until pmadb user preferences are wired | The configuration-storage work owns user preferences | [Feature 09](../features/09-sql-editor-query-pipeline.md) |
| X27 | SQL tab | Card links (Explain, Create PHP code, Refresh, Edit inline Go) and console runs replace the whole main panel with the `/import` response | The results replace the SQL page's results area; the query box stays (collapsed after console runs) | Same requests and results, SPA layout | [Feature 09](../features/09-sql-editor-query-pipeline.md) |
| X25 | Config | Invalid directive values silently replaced by the default (`MaxRows = 0` → 25) | Startup fails with a readable error naming the directive | A typo should not silently change behaviour | `packages/config/README.md` |

## Source quirks found in phpMyAdmin master (reproduced unless noted)

| # | Area | Quirk | Our handling |
|---|---|---|---|
| Q1 | Browse | No `~` approximate marker and no exact-count link in the results header (`$preCount/$afterCount` empty); DB Structure still shows `~` | Reproduce both |
| Q2 | Browse | `DisplayBinaryAsHex` removed since 4.3.0 | Not implemented; directive accepted and ignored with a startup notice |
| Q3 | Query | Rollback path (fewer than 50 statements) issues `START TRANSACTION` but no explicit `ROLLBACK`; the transaction dies with PHP's connection; `[ROLLBACK occurred.]` appended from the flag | Confirmed against the reference: we send the same statements and discard the pooled connection afterwards (same effect, no extra statement); import mode sends `ROLLBACK` like phpMyAdmin |
| Q4 | SQL tab | No editor fullscreen toggle (only Designer has one) | Reproduce (no toggle) |
| Q5 | Database | Classic `/database/qbe` removed; Designer "build query" still posts to that dead route | Implement the multi-table builder; point the Designer's build-query at it (fix, recorded) |
| Q6 | Database | `pma__savedsearches` exists but is unused | Keep the table, no UI, until upstream restores |
| Q7 | Database | Structure `charset` sort header has no server mapping | Reproduce (sort ignored) or fix; decide at M3 |
| Q8 | Schema export | `*_show_table_dimension` read but no UI; no "Automatic layout" (coordinates come from posted canvas state) | Reproduce |
| Q9 | Central columns | No per-page "rows to display" control (global `MaxRows`) | Reproduce |
| Q10 | Export | `csv_partial_import` is a no-op (`min(0, …)`) | Reproduce |
| Q11 | Export | Aliases modal posts column aliases as `[colums]` while PHP reads `[columns]` (column aliases silently dropped) | Fix in ours (column aliases work); recorded as allowed diff |
| Q12 | Export | Options read but not declared in UI: `htmlword_relation/mime/comments`, `texytext_relation/mime/comments`, `pdf_relation/mime`, `Import/sql_read_as_multibytes` | Accept via API, no UI (reproduce) |
| Q13 | Export | No `allow_recoding` directive, no "Dump TIME columns in UTC" option | Reproduce |
| Q14 | Import | `UploadSession` progress plugin disabled in selection chain | N/A: we have SSE progress |
| Q15 | Status | Flush links in `Data::getLinks()` target root path, so flush POST lands on home; no "Flush status" link generated | Fix in ours: links target the flush endpoint; recorded |
| Q16 | Replication | `replica_sql_running`/`replica_io_running` passed swapped to the template | Fix in ours; recorded |
| Q17 | Status | `Key_buffer_fraction` alert key never matches synthetic `Key_buffer_fraction_%` (dead alert) | Fix in ours; recorded |
| Q18 | Status overview | No flush/refresh links in master | Reproduce |
| Q19 | Structure | `geomtrycollection` typo in spatial type lists | Fix spelling in ours (MySQL accepts `GEOMETRYCOLLECTION`); recorded |
| Q20 | Normalization | "moved to the table '%s'" message echoes source table name | Fix in ours; recorded |
| Q21 | Insert | "Show Function/Type" toggle marked not working for multi-row edits in source | Make it work; recorded |
| Q22 | Insert | `TextareaAutoSelect` listed in Edit page settings but only applied to the SQL box | Apply to SQL box only (reproduce) |
| Q23 | Settings | `Export/format` accepts `json/mediawiki/phparray` but UI select omits them; `toon_*` keys exist without `toon` format | Reproduce UI list; accept values |
| Q24 | Metadata | Internal relations override InnoDB FKs for the same column | Reproduce (documented precedence) |
| Q25 | Metadata | `column_info.comment` only holds the `(db_comment)` sentinel; column comments are native | Reproduce |
| Q26 | Shell | `scriptHandler.done()` skips the onload of the script at index 0 (`$.inArray` truthiness) | N/A in a bundled SPA |
| Q27 | Login | `login/footer.twig` checks `check_timeout`, which PHP never passes | N/A; our expiry message path is explicit |
| Q28 | Home | No "Protocol version" row in the server block in master | Reproduce |
| Q29 | Shell | No "Remember me" checkbox exists; persistence comes from `LoginCookieStore` | Reproduce |
| Q30 | SQL tab | "Without PHP code" and "Submit query" post the same `/import` request without `show_as_php`: both re-run the query; "Showing SQL query" only appears for `show_as_php=0`, which no link posts | Reproduce |
| Q31 | SQL tab | `ajax_reload` is always in the SQL tab's response, so the JS never reaches its `data.reload` (USE/DROP) branch; a typed `USE db` does not switch the page's database (only import mode's `lookForUse` does) | Reproduce |
| Q32 | SQL tab | From 50 statements on (import mode) the SQL tab shows only the last statement's `# Rows: n` / `# n rows affected.` message; the commented transcript card is sent as `sql_query` but not displayed; `[ROLLBACK occurred.]` is appended without a space | Reproduce |
| Q33 | SQL tab | The UPDATE confirmation regex `^(?=.*UPDATE\b)^((?!WHERE).)*$` asks for any single-line query containing a word ending in "update" without WHERE (`SELECT * FROM lastupdate`), never for multi-line ones | Reproduce |
| Q34 | SQL tab | The auto-saved query key at server scope is `autoSavedSql_undefined` (no `db` input) | Reproduce (keeps phpMyAdmin's saved queries readable) |
| Q35 | SQL tab | `DROP TABLE x` typed in the database SQL tab clears the transformation info of the whole database (`Transformations::clear(db, '')`) | Reproduce with the pmadb features |
| Q36 | SQL tab | `CALL` leaves further result sets pending in mysqli, so `SHOW WARNINGS` / `SHOW PROFILE` after it fail client-side and never reach the server | Reproduce: no warnings or profile for a CALL returning result sets |

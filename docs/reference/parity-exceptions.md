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
| X12 | SQL formatting | `phpmyadmin/sql-parser` Formatter | `sql-formatter` (npm) | Cosmetic only | [D7](../architecture/01-tech-stack.md) |
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

## Source quirks found in phpMyAdmin master (reproduced unless noted)

| # | Area | Quirk | Our handling |
|---|---|---|---|
| Q1 | Browse | No `~` approximate marker and no exact-count link in the results header (`$preCount/$afterCount` empty); DB Structure still shows `~` | Reproduce both |
| Q2 | Browse | `DisplayBinaryAsHex` removed since 4.3.0 | Not implemented; directive accepted and ignored with a startup notice |
| Q3 | Query | Rollback path issues `START TRANSACTION` but no explicit `ROLLBACK`; `[ROLLBACK occurred.]` appended from the flag | Verify on a live instance before M1; if confirmed a bug, we send an explicit `ROLLBACK` and record the diff here |
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

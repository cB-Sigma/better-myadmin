# Security review

A review of BetterMyAdmin against phpMyAdmin's security model, plus what our architecture adds: a
JSON API behind a single-page app, a Node server holding the MySQL links, and chunked uploads.
Reference: phpMyAdmin at the checkout in `docs/reference/reference-commit.txt`. October 2026.

Each finding has a severity, a reproduction, what phpMyAdmin does, the fix and its regression test.
The tests failed before their fix:

- the server side: `apps/server/test/int/security.test.ts`;
- the single-page app: `tests/e2e/security.e2e.ts`, run against the build before the fix.

Severity: **High** means a single action by a logged-in victim (opening a link) or a low-privileged user is enough;
**Medium** needs one more step from the victim, or weakens a protection; **Low** matches
phpMyAdmin or needs configuration an administrator chose.

## Summary

| # | Severity | Area | Status |
|---|---|---|---|
| S1 | High | Files: UploadDir path traversal (Insert/Edit "upload from the server") | fixed |
| S2 | High | Signed SQL: Browse, Display chart and GIS visualization ran an unsigned query of the URL | fixed |
| S3 | Medium | Signed SQL: the Edit form's "Go back" signed an unsigned query of the URL | fixed |
| S4 | Medium | Signed SQL: the Export page exported (ran) an unsigned `sql_query` of the URL | fixed |
| S5 | Medium | Auth: the login rate limit (X2) let concurrent attempts through | fixed |
| S6 | Medium | Import: decompression bombs (a zip entry inflated into memory, a gzip/bzip2 copy filling the disk) | fixed |
| S7 | Medium | Transformation wrapper: thumbnails decoded images of any claimed size (one cell blocked the process) | fixed |
| S8 | Medium | Import: an upload chunk was buffered whole before the size check | fixed |
| S9 | Low | Import: the upload of a job whose events were never requested stayed on disk | fixed |
| S10 | Low | Docker: decoded `PMA_SSL_*_BASE64` keys were world-readable, a bad value was echoed in the start-up error | fixed |
| L1 | Low | Auth: no limit on second-factor codes | verified as phpMyAdmin, kept |
| L2 | Low | Bookmarks: another user's private bookmark can be run by id (showing it is refused) | verified as phpMyAdmin, kept |
| L3 | Low | Setup: open without a login until a configuration file exists | verified as phpMyAdmin, kept; documented and warned at start |
| L4 | Low | Logging: passwords of `CREATE USER` in Debug SQL | phpMyAdmin shows them; ours are masked |

## High

### S1 UploadDir path traversal in Insert/Edit

**Area.** Files (UploadDir). `apps/server/src/insert-edit/save.ts` `readUploadDirFile`.

**Problem.** The "Or web server upload directory" file of a BLOB column (`uploadLocal`) was
cleaned with a single pass of `name.replace(/\.\.[/\\]/g, '')` and then `path.join`ed onto the
UploadDir. `....//secret` became `../secret` after the replace, and `join` resolved it outside the
directory. Any logged-in MySQL user could read any file the server process can read into a row,
and then read the row back.

**Repro.** With `UploadDir` set, POST `/api/servers/1/databases/<db>/tables/<t>/rows` with a field
`{ name: 'blb', uploadLocal: '....//....//etc/passwd' }` (`preview: true` is enough). The preview's
INSERT holds the file's bytes as hex.

**phpMyAdmin.** `File::setLocalSelectedFile` uses `Util::userDir(UploadDir) . Core::securePath($name)`,
and `securePath` collapses every run of dots into one dot (`preg_replace('@\.\.*@', '.', $path)`),
so no `..` segment can survive.

**Fix.** The same `securePath` and `userDir` (now shared from `apps/server/src/util/secure-path.ts`
with the import's UploadDir file and the export's SaveDir), concatenated without `join`.

**Test.** `security.test.ts` "S1": `../`, `....//`, `..././` and an absolute path are refused, and
a file inside the directory is still read.

### S2 Unsigned SQL in a URL ran in Browse, Display chart and GIS visualization

**Area.** Signed SQL. `apps/web/src/features/browse/BrowsePage.tsx`, `features/table/chart/ChartPage.tsx`,
`features/gis/GisVisualizationPage.tsx`, `apps/server/src/routes/table-visualization.ts`.

**Problem.** The API only checked a query's signature when the request carried one (`sig`). It
treats an unsigned query as one posted by a form, which the CSRF token protects. But the
single-page app read `sql` from the page URL and posted it with the CSRF token itself: without a
`sig` when the URL had none. A link opened by a logged-in user ran any SQL as that user, with the
browser's own session and token. The chart page runs the query as it is (`DROP DATABASE …` works).
GIS runs it only as a SELECT.

**Repro.** Log in, then open `/s/1/db/<db>/t/<t>/browse?sql=CREATE%20DATABASE%20x`, or
`/s/1/chart?sql=…` or `/s/1/db/<db>/t/<t>/chart?sql=…`. The database `x` is created.

**phpMyAdmin.** `sql_query` comes from the POST body only (`SqlQueryGlobalSetting`). A GET
`sql_query` is used only with a valid `sql_signature` (`SqlController`, `GisVisualizationController`,
`InsertEdit`), the HMAC of the query with the session secret and `blowfish_secret`.

**Fix.**
- The pages always send the signature of a query that comes from the URL, `''` when the URL has
  none, so an unsigned query never verifies.
- Browse then shows the table's default browse.
- The chart and GIS requests (`VisualizationPageRequest.sig`, `ChartDataRequest.sig`) are checked
  on the server ("No SQL query was set to fetch data."). The server also signs the form's own query
  (`RowsFieldset.sig`) for the chart's row requests.
- The results' "Display chart" and "Visualize GIS data" links carry the grid's signature.

**Tests.** `security.e2e.ts`: Browse, the table and server chart, and GIS. `security.test.ts` "S2":
the API refuses a wrong signature and signs the form query.

## Medium

### S3 The Edit form's "Go back" ran an unsigned query of the URL

**Area.** Signed SQL. The `/edit?…&sql=` route, `apps/server/src/insert-edit/save.ts`.

**Problem.** The Edit link carries the Browse query (`sql`) for "Go back to previous page". The
form sent it with the save, and the server answered with that query *signed*. The client then ran
it on the Browse page. A crafted Edit link ran its SQL once the victim saved the row.

**Repro.** Take a row's Edit link and replace its `sql` with `CREATE DATABASE x`, then click Go.
The database `x` is created.

**phpMyAdmin.** `InsertEdit::getFormParametersForInsertForm` uses a GET `sql_query` only with a
valid `sql_signature`.

**Fix.** The Edit links carry `sql_sig`, and the form sends `sqlQuerySig` (`''` when the URL has
none). The server keeps the Browse query for "Go back" only when that signature verifies; otherwise
"Go back" browses the table.

**Tests.** `security.e2e.ts` "Edit". `security.test.ts` "S3".

### S4 The Export page exported an unsigned `sql_query` of the URL

**Area.** Signed SQL. `apps/server/src/export/page.ts`, `apps/web/src/features/export/search.ts`.

**Problem.** `/export?raw_query=true&sql_query=…` put the URL's query into the export form. A raw
query export runs the statement, so a victim who clicked Go on a crafted link ran it.

**phpMyAdmin.** The export page reads `sql_query` from the POST body only.

**Fix.** A `sql_query` of the URL always goes with `sql_signature` (`''` when absent), and the
export page keeps the query only when the signature verifies. The results' Export link now sends
`sql_query` and `sql_signature`. It used to send `sql`, which the export page ignored, so exporting
a query result exported the whole table.

**Tests.** `security.e2e.ts` "Export". `security.test.ts` "S4".

### S5 The login rate limit let concurrent attempts through

**Area.** Auth. `apps/server/src/auth/rate-limit.ts`, `routes/auth.ts` (parity exception X2;
phpMyAdmin has no limit).

**Problem.** The lockout was checked before the attempt and the failure recorded after the MySQL
connect. Parallel requests all passed the check before the first failure was counted, so the
limit of 5 per 15 minutes did not bound a burst.

**Repro.** With `maxAttempts: 3`, send 10 concurrent logins with a wrong password: all 10 reached
MySQL.

**Fix.** The attempts of one (IP, username) pair run one after the other
(`LoginRateLimiter.serialize`), so each sees the failures before it. Other pairs are not
delayed.

**Test.** `security.test.ts` "S5": 3 attempts, then 7 lockouts.

## Re-audit (October 2026, the changes after S1–S5)

The changes since the first review were read: the streaming import, the `.ts` configuration
loader, the external transformation allow-list, SpecialSchemaLinks and the message cards, the
two-factor backends, the Docker image, the thumbnail resize and the translation and entity
decoding.

### S6 Decompression bombs in import

**Area.** `packages/import/src/file.ts`, `packages/export/src/zip.ts`.

**Problem.** phpMyAdmin inflates on the fly under PHP's `memory_limit` and `max_execution_time`.
Ours inflated a zip entry (all of them, in fact) into memory, and a gzip or bzip2 file into a
temporary copy, without a bound. A few hundred kilobytes of zip could exhaust the process's memory
for every user; a small `.bz2` could fill the disk.

**Fix.** A zip entry is inflated only when read, at most 1 GiB (`maxOutputLength`). A gzip or bzip2
copy stops at the free disk space less 1 GiB, and at `ExecTimeLimit` (phpMyAdmin's
`set_time_limit` ends its decompression too). Either says "File could not be read!" and leaves no
partial copy.

**Tests.** `packages/import/test/large.test.ts` "decompression bombs".

### S7 Image bombs in the thumbnail resize

**Area.** `apps/server/src/insert-edit/image.ts` (`resize=jpeg|png` of the transformation wrapper).

**Problem.** The decoders allocated whatever the header claimed: a 43-byte GIF claiming
12000 × 12000 took 1.1 GiB and seconds of the single server thread. GD under phpMyAdmin is bounded
by `memory_limit` per request.

**Fix.** Images above 30 megapixels (GD's truecolor at the default 128 MiB) are not images: the
PNG IHDR and GIF screen size are checked before decoding, JPEG through jpeg-js's
`maxResolutionInMP`.

**Test.** `apps/server/test/unit/gd-resize.test.ts` "untrusted images".

### S8 Upload chunks buffered before the size check

**Area.** `apps/server/src/routes/import.ts` (PATCH `…/import/uploads/:id`).

**Problem.** The chunk was read into memory whole, then compared with `MaxUploadSize`.

**Fix.** `bodyLimit(MaxUploadSize)`: a larger Content-Length is refused unread, a streamed body
stops at the limit.

**Test.** `apps/server/test/int/import.test.ts` "upload limits".

### S9 Abandoned job uploads

**Problem.** An upload registered with a job whose events were never requested was dropped from
memory after an hour but its file stayed in the temporary directory. **Fix.** The prune removes it.

### S10 Docker SSL files

**Area.** `packages/config/src/docker-env.ts`, `Dockerfile`.

**Problem.** The decoded certificates and keys were written with the default mode (0644), and a
value that was not base64 was quoted whole in the start-up error, so a key could land in the logs.
The default `PMA_SSL_DIR` (`/etc/phpmyadmin/ssl`) was not writable by the image's `node` user.

**Fix.** Files 0600 in a 0700 directory, the error names the file, and the image creates the
directory for `node`.

**Test.** `packages/config/test/docker-env.test.ts` "a decoded key is readable by its owner only".

### Re-audit: no finding

- **`.ts` configuration.** The file is the administrator's (like `config.inc.php`); esbuild
  bundles it in memory and it runs from a `data:` URL, nothing is written.
- **External transformations.** No shell (X4); the deprecated options field adds arguments only.
  The directive documents that the listed programs must not read or write files through
  arguments, as phpMyAdmin's source comment warns.
- **SpecialSchemaLinks and message cards.** The links carry names, never SQL; every action that
  runs a query posts it with the CSRF token, and a query from a URL runs only with its signature
  (the grid's `urlSql` is signed by the server, the SQL tab runs `?sql=` only with `sig`).
- **Two-factor.** Enforced for every server route; WebAuthn assertions need a valid signature by
  the registered key; TOTP window and the lack of an attempt limit are phpMyAdmin's (L1).
- **Translations and entities.** Decoded entities and translated strings are rendered as text
  nodes; markup still goes through `SafeHtml` only.

## Low (verified against phpMyAdmin)

Each of these was checked against a running phpMyAdmin. The check used a private instance of the
reference checkout, with its own pmadb and `$cfg['DBG']['sql']` on, and then against ours. The test
is `tests/parity/security-lows.parity.test.ts`, which runs both sides.

### L1 No limit on second-factor attempts

`POST /api/auth/two-factor` accepts any number of failed codes; an attacker who has the password can
try codes (a 6-digit TOTP).

**phpMyAdmin.** The same. Twenty failed second-factor submissions, then a good one, still log in:
`AuthenticationPlugin::checkTwoFactor` counts nothing. The reference has no `google2fa`, so its
debug `simple` backend was used; the flow is the backend-independent `checkTwoFactor`. We behave
the same (twenty wrong TOTP codes, then the right one logs in). Kept for parity. A limit through
the X2 rate limiter would be the improvement if it is ever wanted.

### L2 Another user's private bookmark by id

**phpMyAdmin.** User A asking to *show* user B's private bookmark (`action_bookmark=1`) is
refused: `get()` filters on A. But A can *run* it with `action_bookmark=0&action_bookmark_all=1`
(`get(null, $id)`), so the run discloses B's query and result. The query runs with A's own MySQL
privileges.

**Ours.** The same: `GET /bookmarks/:id` is refused for another user's bookmark, and
`POST /bookmarks/:id/run` with `allUsers` runs it. Kept for parity. It is a phpMyAdmin weakness
worth reporting upstream.

### L3 The setup script without a login

**phpMyAdmin.** `setup/` is open while `config.inc.php` does not exist (the instance started
without one serves it).

**Ours.** The same. `/api/setup` answers 404 ("Configuration already exists, setup is disabled!")
once a configuration file is loaded or written. The default install now documents it in
`README.md` and `docs/architecture/07-security.md`. The server also warns at start while setup is
open (`setupOpenWarning`, unit-tested in `apps/server/test/unit/setup-warning.test.ts`).

### L4 Passwords in Debug SQL

**phpMyAdmin.** With `$cfg['DBG']['sql']`, the JSON `debug` of an Add user request holds
`CREATE USER … BY '<the password>'` in plain text. `DBG/sqllog` logs the same statements to
syslog.

**Ours.** Stricter. The statement is recorded masked (`BY '***'`) in the request's statements, and
so in the SQL log; the statements shown on the page are masked too. Our privileges responses carry
no Debug SQL list at all. Kept: masking a secret is not a behaviour to copy back.

## Reviewed, no finding

- **CSRF.** Every non-GET `/api/*` request needs the `X-BMA-Token` header to match the session
  (`app.ts`), including the routes added recently. The session cookie is `SameSite=Strict` by
  default. The GET routes were read for side effects (row counts, central columns population,
  tracking snapshots, export and import jobs). They only read, and the jobs are bound to their
  session and server.
- **Sessions.** The id and the token are rotated at login (`Session::secure`). An unknown session
  id from a cookie is never adopted: a new id is made. Credentials are encrypted in the session
  store, and the inactivity logout follows `LoginCookieValidity`.
- **Auth types.** Config, cookie, http and signon. The signon cookie is encrypted with
  `blowfish_secret` (X43); the signon script is configured by the administrator. Two-factor is
  enforced for every server request (`resolveServer` needs `twoFactorOk`). `AllowRoot`,
  `AllowNoPassword`, `AllowDeny` and `ArbitraryServerRegexp` apply as in phpMyAdmin.
- **Signed where clauses.** Edit, grid edit, get-field (BLOB download), the transformation
  wrapper and zoom search check the `where_clause` signature.
- **XSS.** Markup goes through one component, `SafeHtml` (DOMPurify):
  - The message profile is `Sanitize::sanitizeMessage`'s tag set. Links are http(s), relative or
    in-page only.
  - The transformation profile adds `img` (http(s), relative or `data:image`) and `iframe` with
    `srcdoc` only, always sandboxed.
  - No other `innerHTML` exists in the web app.
  - The CSP has no `unsafe-inline` or `unsafe-eval` script source, and `object-src` is `'none'`.
- **SQL injection.** Identifiers go through `backquote` and values through `quoteString` or
  parameters; the golden tests compare both with phpMyAdmin. The few interpolated names are checked
  against `[a-zA-Z0-9_]` first (SET GLOBAL in Variables and the Monitor), or come from the user's
  own grants (`SHOW DATABASES LIKE`), as in phpMyAdmin.
- **Files.**
  - Static files: `serveStatic` refuses `..`, encoded `%2e%2e` and backslashes (probed).
  - Import: uploads are random-id files (mode 0600) bound to their session, and the UploadDir file
    goes through `securePath`.
  - SaveDir: the file name loses `/` and `\`.
  - `LOAD DATA LOCAL INFILE` may read only the file of the running import (`Conn.localInfile`), so
    a malicious server cannot ask for other files.
  - Setup Save writes into `config/` only.
- **SSRF.**
  - The version check and the error reports go to fixed URLs; error reports only go out when
    `BMA_ERROR_REPORT_URL` is set.
  - The proxy settings are the administrator's.
  - `AllowArbitraryServer` connects to the host the user names, limited by
    `ArbitraryServerRegexp`, as in phpMyAdmin (off by default).

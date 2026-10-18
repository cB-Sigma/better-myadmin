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
| L1 | Low | Auth: no limit on second-factor codes | open (as phpMyAdmin) |
| L2 | Low | Bookmarks: another user's private bookmark can be shown or run by id | open (as phpMyAdmin) |
| L3 | Low | Setup: open without a login until a configuration file exists | open (as phpMyAdmin) |
| L4 | Low | Logging: Debug SQL and `DBG/sqllog` hold the passwords of `CREATE USER` / `ALTER USER` | open (as phpMyAdmin) |

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

## Low (as phpMyAdmin)

### L1 No limit on second-factor codes

`POST /api/auth/two-factor` checks a 6-digit TOTP with no attempt limit. An attacker who has the
password can try codes. phpMyAdmin has no limit either. Recommendation: count failed codes in the
login rate limiter.

### L2 Other users' private bookmarks by id

`POST /bookmarks/:id/run` with `allUsers: true` and `GET /bookmarks/:id` read a bookmark by id
regardless of its owner. The query text of another user's private bookmark can be disclosed. It
runs with the caller's own MySQL privileges. This is phpMyAdmin's `action_bookmark_all`
(`ImportController`).

### L3 The setup script without a login

`/api/setup` is open while no configuration file exists, as phpMyAdmin's `setup/` is. It is closed
as soon as one exists (`setupDisabled`). Deployments should ship a configuration file.

### L4 Passwords in Debug SQL and the SQL log

With `$cfg['DBG']['sql']`, the statements of a request are returned to the browser and, with
`sqllog`, written to the server's error output. They include `CREATE USER … IDENTIFIED BY '…'` and
`ALTER USER … IDENTIFIED BY '…'` with the password in plain text, as in phpMyAdmin. The
`PASSWORD()` hashing queries are already masked as `'***'`. The displayed SQL of the privileges
and change-password pages is masked. The SQL history only records what the user typed in the SQL
box.

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

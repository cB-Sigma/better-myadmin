# Security

BetterMyAdmin is a tool that, by design, executes arbitrary SQL as whatever user logs in. Its security job is therefore: (1) make sure only the intended person can act as that user, (2) make sure the browser cannot be tricked into acting on their behalf, (3) never leak credentials, and (4) not add attack surface of its own. phpMyAdmin has a long record here and we copy its model deliberately, tightening where a modern stack lets us.

## Threat model

| Actor | Can | Must not be able to |
|---|---|---|
| Anonymous on the network | reach the login page | enumerate servers/users, brute-force without limits, learn versions |
| Authenticated user | anything their MySQL grants allow | act as another session, read another session's credentials, escape `only_db`/`hide_db` UI limits (these are UI-only in phpMyAdmin too and are documented as such), read server files outside `UploadDir`/`SaveDir` |
| Attacker-controlled web page in the same browser | nothing | CSRF a mutation, clickjack, read responses cross-origin |
| Attacker-controlled data inside the database (cell values, table names, comments) | be displayed | execute as HTML/JS (XSS), break out of SQL quoting, inject into generated SQL, inject into export files beyond what the format allows |
| Operator with the config file | configure anything | be surprised: no hidden network calls except opt-in version check and error reporting |

## Authentication

- Plugins mirror `auth_type`: `cookie`, `config`, `http`, `signon` ([tech stack D10](01-tech-stack.md#d10-auth-model-mirrors-phpmyadmins-auth_type-options)).
- **Credentials at rest**: encrypted (AES-256-GCM, key via HKDF from `blowfish_secret`) in the server-side session store only. The cookie is an opaque session id. phpMyAdmin encrypts the password into the cookie itself; we moved it server-side because a leaked cookie then yields nothing without the server's store.
- **Brute force**: login attempts are rate-limited per (IP, username): 5 failures within 900 s lock the pair out for 300 s (configurable) (phpMyAdmin relies on `CaptchaLogin*`; we support the same reCAPTCHA v2/v3/hCaptcha/Turnstile directives *and* add the limiter, on by default, directive `LoginRateLimit`).
- `AllowRoot` (default true), `AllowNoPassword` (default false), `AllowDeny` with `order` (`deny,allow` / `allow,deny` / `explicit`) and the rule syntax (`allow|deny <user> from <ip|cidr|localhost|localnetA|...|%>`) are enforced after successful MySQL auth exactly as `IpAllowDeny` does, with the same error texts.
- `AllowArbitraryServer` off by default; when on, `ArbitraryServerRegexp` restricts hosts and the connection is still made only with the submitted credentials. The arbitrary host never reaches the pmadb control connection.
- `TrustedProxies` for `X-Forwarded-For` evaluation in allow/deny rules, same semantics.
- Two-factor: TOTP (RFC 6238, `otpauth://` QR), WebAuthn (resident or roaming keys, same `webauthn` library semantics for challenge storage), and `simple`. Backend and secrets stored in `pmadb.userconfig` under `2fa` exactly like phpMyAdmin so they interoperate.
- Session expiry: sliding `LoginCookieValidity`, hard `LoginCookieStore`; expiry message and `LoginCookieRecall`. Logout invalidates server-side immediately.
- `http` auth: `WWW-Authenticate: Basic realm="<auth_http_realm>"` (default `BetterMyAdmin <host>`); the Basic credentials are read when a page loads, used for the connection and then held in the (encrypted) session like cookie auth (X45); logout goes to `/?old_usr=<user>`, which refuses the same user once.
- `signon`: `SignonURL` redirect; the hand-off is a cookie named `SignonSession` holding phpMyAdmin's `PMA_single_signon_*` keys, AES-GCM encrypted with a key derived from `blowfish_secret` (`encodeSignonSession`, `apps/server/examples/signon.ts`), or `SignonScript`, a JS/TS module exporting `getLoginCredentials(user)` (`apps/server/examples/signon-script.ts`) (X43). Login errors are written back into the cookie (`PMA_single_signon_error_message`). `SignonCookieParams` and `LogoutURL` honoured.

- **The setup script** (`/setup`) needs no login while no configuration file exists, like phpMyAdmin's `setup/`, and is closed (404) as soon as one is loaded or written. The server warns at start while it is open (`setup: no configuration file …`). A deployment ships a configuration file, or stays private until it has one.

## CSRF and request integrity

- Every state-changing request requires header `X-BMA-Token` equal to the `bma_token` cookie value (double submit); the token rotates on login. GET routes are side-effect free, enforced by a contract test. This is the equivalent of phpMyAdmin's `token` parameter and `TokenRequestParamChecking`.
- Cookies: `HttpOnly` (session), `SameSite=Lax`, `Secure` when the request is HTTPS or `ForceSSL` is on, `Path` scoped to `basePath`.
- **Signed SQL in URLs**: `sql`+`sig` (HMAC-SHA256 of the query with the session's secret and `blowfish_secret`) exactly as `Core::signSqlQuery`/`checkSqlQuerySignature`. A page that reads SQL from its URL (Browse, Display chart, GIS visualization, Edit's "Go back", Export's `sql_query`) always sends the signature, `''` when the URL has none, and the server drops a query whose signature does not verify; the SQL tab only prefills the editor. A link can therefore never run SQL through the app's own CSRF token ([security review](../reference/security-review.md) S2–S4).
- Redirects: only to relative paths within the app or to hosts in the `AllowedRedirect` allow-list (phpMyAdmin's `Core::isAllowedDomain` list for docs/MySQL/MariaDB sites); the `url.php`-style outbound link page is reproduced (`/goto?url=` shows the destination and opens in a new tab) so Referer never leaks the app URL.

## Headers

Set on every response (equivalent of `Core::headerJSON`/`Header::sendHttpHeaders`):

- `Content-Security-Policy`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' <CSPAllow>; style-src 'self' 'unsafe-inline' fonts.googleapis.com; img-src 'self' data: blob: <CSPAllow> tile.openstreetmap.org; connect-src 'self' <CSPAllow>; frame-ancestors 'self' <AllowThirdPartyFraming>; object-src 'none'; base-uri 'self'`. No inline scripts; the theme-preload script is a hashed external file.
- `X-Frame-Options: DENY` unless `AllowThirdPartyFraming` (`true` or `'sameorigin'`). phpMyAdmin master relies on CSP `frame-ancestors` plus the JS cross-framing check only; the extra header is an addition (see parity exceptions X21).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` minimal, `Strict-Transport-Security` when `ForceSSL` (a directive phpMyAdmin documents as deprecated and no longer acts on; we honour it, see X22).
- `Cache-Control: no-store` on all `/api` responses; immutable caching for hashed static assets only.

## Injection

- **SQL**: all identifiers go through `quoteIdentifier` (backtick, doubling inner backticks), all values through `mysql2.escape` with the connection charset or are sent as prepared-statement parameters. User-typed SQL (SQL tab, bookmark, import) is executed verbatim *as the user*, which is the product; it is never concatenated into app-generated SQL. Table/column names from URLs are validated against the live catalog before being quoted into generated SQL (defence in depth; quoting alone is sufficient).
- **XSS**: React escapes by default. The few places that render HTML (transformation output such as `Text_Plain_Formatted`, Markdown-ish comments) go through DOMPurify with an allow-list identical to phpMyAdmin's `Sanitize::sanitizeMessage` tags (`a[href=https?/./#]`, `b`, `i`, `em`, `strong`, `br`, `code`, `kbd`, `sup`, `sub`, `h1..h4`, `ul`, `ol`, `li`, `p`, `pre`, `span`, `table/tr/th/td`). `Text_Plain_External` is disabled unless its allow-list is configured, like phpMyAdmin.
- **Export file injection**: CSV/Excel cells beginning with `=`, `+`, `-`, `@` are escaped per the plugin's existing behaviour only (phpMyAdmin does not neutralize formulas; we add an opt-in `Export.csv_escape_formulas`, default off, to stay byte-compatible by default and document the risk).
- **Path traversal**: `UploadDir`/`SaveDir` listings and reads use `realpath` containment checks (`FileListing`, `File::checkUploadedFile` equivalents) and the import "select from server directory" accepts only basenames present in the listing.
- **Zip bombs / decompression**: decompression is streamed with a configurable output cap (`Import.MaxDecompressedSize`, default 10 × `MaxUploadSize`).
- **Shell**: none. phpMyAdmin's `RecodingEngine=recode` is replaced by in-process `iconv`. The `External` transformation runs only the programs an administrator lists in `TransformationsExternalPrograms` (empty by default, phpMyAdmin's shipped state), without a shell, with a timeout and an output cap (X4).

## Information disclosure

- Error messages to the client never include stack traces or file paths (phpMyAdmin's `ErrorHandler` equivalent); full detail goes to the server log. MySQL error messages are passed through because they are the feature.
- `ShowServerInfo`, `ShowPhpInfo` (we show a "Runtime info" page instead of `phpinfo()`), `ShowChgPassword`, `ShowCreateDb`, `ShowStats` honoured.
- Version check (`VersionCheck`, default true, only fetches `https://www.phpmyadmin.net/home_page/version.json`-equivalent for BetterMyAdmin releases) and error reporting (`SendErrorReports`, default `ask`) are the only outbound network calls, and both are user-visible on the home page.
- `hide_db`/`only_db` filter listings but are *not* a security boundary (documented, like phpMyAdmin).

## Secrets handling

- Config file permissions check (`CheckConfigurationPermissions`): warn when world-readable.
- `blowfish_secret` generated with `crypto.randomBytes(32)` when absent, written `0600`.
- No secret ever appears in logs, error reports, URLs, or the client-visible config subset (`/api/meta/config-public` is produced from an allow-list of directives, not a deny-list).
- Export of preferences (`/prefs/export`) strips nothing because preferences contain no secrets; server config is never exportable via the API.

## Dependency and supply chain

- Lockfile committed, `pnpm audit` in CI, Renovate for updates, `--ignore-scripts` install in the Docker build.
- No native addons (keeps Bun and single-binary builds and removes a class of CVEs).
- SBOM generated per release.

## Security test checklist (CI)

- [ ] Every mutating route rejects a missing/incorrect `X-BMA-Token`.
- [ ] Every GET route is side-effect free (route registry contract test + general-log assertion in e2e).
- [ ] Unsigned `sql` search param does not execute.
- [ ] Credentials absent from session cookie, logs, error payloads (grep in e2e).
- [ ] CSP has no `unsafe-inline` for scripts; app boots with CSP enforced.
- [ ] Allow/deny rule fixtures from phpMyAdmin's `IpAllowDenyTest` pass.
- [ ] Identifier quoting fuzz test (backticks, unicode, newlines in names).
- [ ] Path traversal attempts against `UploadDir` listing/read return 403.
- [ ] Rate limiter trips after N failed logins and resets.
- [ ] Transformation HTML output passes DOMPurify with the allow-list; XSS corpus renders inert.

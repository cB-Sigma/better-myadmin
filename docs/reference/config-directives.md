# phpMyAdmin configuration directive reference

Complete, source-derived reference of every `$cfg[...]` directive understood by phpMyAdmin (master, Oct 2026).

**Authoritative sources (in precedence order):**

| What | File |
|---|---|
| Defaults, types, allowed values, coercion rules | `src/Config/Settings.php` (top level), `src/Config/Settings/Server.php` (`Servers[$i]`), `src/Config/Settings/Export.php`, `Import.php`, `Schema.php`, `SqlQueryBox.php`, `Console.php`, `Transformations.php`, `Debug.php` |
| Prose descriptions, grouping, deprecations | `docs/config.rst` |
| Allowed-value lists shown as `<select>` in the Settings/Setup UI, validator assignments | `src/Config/ConfigFile.php::getAllowedValues()` |
| Human labels/descriptions shown in the Settings UI | `src/Config/Descriptions.php` |

Conventions used below:

* **Type** is the PHP type the `Settings` value object coerces the value to. Where the docblock carries a psalm narrowing (e.g. `positive-int`, `'ASC'|'DESC'|'SMART'`) it is given under *Allowed values*.
* **Default** is the literal value the setter returns when the key is absent (always equals the `$cfg[...] = ...;` example in the docblock).
* **Coercion** notes describe what the setter does with out-of-range values (most numeric setters fall back to the default when the value is `< 1` / `< 0`; most enum setters fall back to the default on any unknown value). Unless noted, bools are `(bool)` cast and strings `(string)` cast.
* **Used by** is the feature area that reads the directive.
* **UI** tells where the directive is editable: `user` = user preferences (Settings pages, `src/Config/Forms/User/*`), `setup` = setup script only (`src/Config/Forms/Setup/*`), `page` = also exposed in a page-settings gear popup (`src/Config/Forms/Page/*`), `file` = `config.inc.php` only (not in any form).
* Directives listed as *removed* are documented in `config.rst` with a `.. deprecated::` marker and are **not** present in `Settings.php`; they are ignored if present in `config.inc.php`.

The canonical key names in the generated `Settings::asArray()` are used (e.g. `AuthLog`, `ShowAll`, `MaxRows`, `LimitChars`, `RepeatCells`, `ZeroConf`, `DBG`, `MysqlMinVersion`, `maxRowPlotLimit`, `environment`, `blowfish_secret`, `enable_drag_drop_import`). Internally `Settings.php` property names differ in a few places (`authLog`, `showAll`, `maxRows`, `limitChars`, `repeatCells`, `zeroConf`, `debug`, `mysqlMinVersion`); only the array key matters for `config.inc.php` and for user-preference JSON.

---

## 1. Basic settings

(`docs/config.rst` "Basic settings", lines 31-223)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `PmaAbsoluteUri` | string | `''` | any URL; empty = auto-detect | Full URL (with `https://`, host, path) to the phpMyAdmin directory. Only needed when auto-detection fails (reverse proxies, etc.). Also used as the WebAuthn/U2F AppID source (`TwoFactorPlugin::getAppId`). | Core URL generation, redirects, 2FA AppID | file |
| `PmaNoRelation_DisableWarning` | bool | `false` | | Suppress the "configuration storage is not completely configured" notice on home page and DB Operations. | Home page, DB Operations | user (Features > Warnings) |
| `AuthLog` | string | `'auto'` | `'auto'`, `'syslog'`, `'php'`, `'sapi'`, or a filename | Where authentication attempts are logged. `auto` = syslog if available, else PHP error log. | Logging (`src/Logging.php`) | file |
| `AuthLogSuccess` | bool | `false` | | Also log successful logins. | Logging | file |
| `SuhosinDisableWarning` | bool | `false` | **removed 6.0.0** | Suhosin no longer supported. | - | - |
| `LoginCookieValidityDisableWarning` | bool | `false` | | Hide warning shown when `session.gc_maxlifetime` < `LoginCookieValidity`. | Home page warnings | user (Features > Warnings) |
| `ServerLibraryDifference_DisableWarning` | bool | `false` | **removed 4.7.0** | | - | - |
| `ReservedWordDisableWarning` | bool | `false` | | Hide warning on table Structure when a column name is a MySQL reserved word. | Table structure | user (Features > Warnings) |
| `TranslationWarningThreshold` | int | `80` | 0..100; `<0` -> 80; `>100` clamped to 100 | Show "incomplete translation" warning when a language is translated below this percentage. | Language manager | file |
| `SendErrorReports` | string | `'ask'` | `'ask'`, `'always'`, `'never'` | Whether to ask before sending JS error reports to the phpMyAdmin team. | Error reporting (`src/ErrorReport.php`, JS) | user (Features > General) |
| `ConsoleEnterExecutes` | bool | `false` | | Enter (instead of Ctrl+Enter) executes the query in the console. Superseded in practice by `Console/EnterExecutes` but still read. | Console | user (Features > General) |
| `AllowThirdPartyFraming` | bool\|string | `false` | `true`, `false`, `'sameorigin'` | Allow embedding phpMyAdmin in a frame from another document. `'sameorigin'` emits `X-Frame-Options: SAMEORIGIN`; `false` emits `DENY`; `true` disables the header (security hole). | HTTP headers (`Header.php`), JS frame-busting | setup (Features > Other core settings) |

## 2. Server connection settings (`$cfg['Servers'][$i]`)

(`docs/config.rst` lines 224-1591; `src/Config/Settings/Server.php`)

`$cfg['Servers']` is an array indexed from **1** (index 0 is ignored: `Settings::setServers` skips non-int keys and keys `< 1`). When absent, a single default `Server` is created at index 1. A server entry may be disabled by setting `host` to `''`. Each key below is read by `Server::__construct` from the per-server array.

### 2.1 Connection

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `host` | string | `'localhost'` | hostname or IP; empty disables the server entry | MySQL hostname/IP. `Config::getConnectionParams` substitutes `'localhost'` when empty for the user link. | DBI connect, login page server list, `@SERVER@` placeholder | setup (Servers > Basic settings) |
| `port` | string | `''` | numeric string; empty = default | MySQL port. Validated by `validatePortNumber` (1..65535) in setup. | DBI connect | setup |
| `socket` | string | `''` | path; empty = default | Unix socket path. | DBI connect | setup |
| `ssl` | bool | `false` | | Use SSL for the MySQL connection. | DBI connect (`DbiMysqli`) | setup |
| `ssl_key` | string\|null | `null` | path | Client private key file. | DBI connect | file |
| `ssl_cert` | string\|null | `null` | path | Client certificate file. | DBI connect | file |
| `ssl_ca` | string\|null | `null` | path | CA file. | DBI connect | file |
| `ssl_ca_path` | string\|null | `null` | dir | Directory of trusted CA certs (PEM). | DBI connect | file |
| `ssl_ciphers` | string\|null | `null` | cipher list | Allowed ciphers. | DBI connect | file |
| `ssl_verify` | bool | `true` | | Verify server certificate peer name (mysqlnd); set `false` for self-signed certs. | DBI connect | file |
| `connect_type` | string | `'tcp'` | **removed 4.7.0** (`'tcp'`/`'socket'`) | MySQL now decides based on `host`. | - | - |
| `compress` | bool | `false` | | Use compressed client/server protocol. | DBI connect | setup |
| `hide_connection_errors` | bool | `false` | | Hide detailed MySQL/MariaDB connection error text on the login page. | Login page / `DbiMysqli` error handling | file |

### 2.2 Control connection (configuration storage link)

The control connection is the link phpMyAdmin uses to read/write pmadb. `Config::getConnectionParams(ConnectionType::ControlUser)` builds it as: user=`controluser`, password=`controlpass`, host=`controlhost` or (if empty) `host`; if the resulting host equals `host`, the user link's `port`, `socket`, `compress`, `ssl*`, `hide_connection_errors` are copied; then `controlport` overrides port, and every non-null `control_*` key overrides the corresponding setting.

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `controlhost` | string | `''` | | Alternate host for the configuration storage. Legacy alias `control_host` is also read. | Control link | setup (Servers > Configuration storage) |
| `controlport` | string | `''` | | Alternate port for the control host. Alias `control_port`. | Control link | setup |
| `controluser` | string | `''` | | MySQL user with rights on pmadb (read-only on `mysql.user`/`mysql.db` historically). Alias `control_user`. Required for `pmadb` (validator `validatePMAStorage`). | Control link, all pmadb features | setup |
| `controlpass` | string | `''` | | Password for `controluser`. Aliases `control_pass`, `control_password`. | Control link | setup |
| `control_socket` | string\|null | `null` | | Override socket for the control link. | Control link | file |
| `control_ssl` | bool\|null | `null` | | Override `ssl` for control link. | Control link | file |
| `control_ssl_key` | string\|null | `null` | | | Control link | file |
| `control_ssl_cert` | string\|null | `null` | | | Control link | file |
| `control_ssl_ca` | string\|null | `null` | | | Control link | file |
| `control_ssl_ca_path` | string\|null | `null` | | | Control link | file |
| `control_ssl_ciphers` | string\|null | `null` | | | Control link | file |
| `control_ssl_verify` | bool\|null | `null` | | | Control link | file |
| `control_compress` | bool\|null | `null` | | | Control link | file |
| `control_hide_connection_errors` | bool\|null | `null` | | | Control link | file |

### 2.3 Authentication

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `auth_type` | string | `'cookie'` | `'config'`, `'http'`, `'signon'`, `'cookie'`; anything else -> `'cookie'` | Authentication plugin. `config` uses `user`/`password` from the file; `http` uses HTTP Basic; `signon` trusts an external session; `cookie` shows the login form and stores encrypted credentials in cookies. | `src/Plugins/Auth/*` | setup (Servers > Authentication) |
| `auth_http_realm` | string | `''` | | Realm string for HTTP Basic auth. | `AuthenticationHttp` | setup |
| `auth_swekey_config` | string | `''` | **removed 4.6.4** | Swekey hardware auth. | - | - |
| `user` | string | `'root'` | | MySQL user for `config` auth. Validator `validateServer` requires non-empty when `auth_type = config`. | `AuthenticationConfig` | setup |
| `password` | string | `''` | | MySQL password for `config` auth. | `AuthenticationConfig` | setup |
| `nopassword` | bool | `false` | **removed 4.7.0** | Fallback to no-password login. | - | - |
| `SignonSession` | string | `''` | | Session name of the external signon session. Required when `auth_type = signon` (validator). | `AuthenticationSignon` | setup |
| `SignonCookieParams` | array | `[]` -> normalised to `{lifetime:0,path:'/',domain:'',secure:false,httponly:false}` plus optional `samesite` (`'Lax'`/`'Strict'`) | must match `session_get_cookie_params()` of the other app | Cookie parameters used to locate the signon session. | `AuthenticationSignon` | file |
| `SignonScript` | string | `''` | PHP file path | Script that returns credentials for signon (alternative to session). | `AuthenticationSignon` | file |
| `SignonURL` | string | `''` | | Where to redirect for login under signon. Required when `auth_type = signon`. | `AuthenticationSignon` | setup |
| `LogoutURL` | string | `''` | | URL to redirect to after logout (all auth types). | `AuthenticationPlugin::logOut` | setup |

### 2.4 Server behaviour / visibility

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `only_db` | string\|string[] | `''` | db name(s), MySQL wildcards `%`/`_` allowed (escape literal with `\`); empty array -> `''` | Restrict the navigation DB list to these databases (order preserved). Also a user preference saved as `Server/only_db`. | `ListDatabase` | user (Features > Databases), setup (Servers > Server configuration) |
| `hide_db` | string | `''` | PCRE without delimiters (validator `validateRegex`) | Hide databases matching this regexp. Saved as user pref `Server/hide_db`. | `ListDatabase` | user, setup |
| `verbose` | string | `''` | | Friendly name of the server (used in server list, titles via `@VERBOSE@`/`@VSERVER@`; non-ASCII stripped under HTTP auth). | Server selector, titles | setup |
| `extension` | string | `'mysqli'` | **removed 4.2.0** | | - | - |
| `AllowRoot` | bool | `true` | | Allow login as `root`. | `AuthenticationPlugin::checkRules` | setup |
| `AllowNoPassword` | bool | `false` | | Allow login with empty password. | `AuthenticationPlugin::checkRules` | setup |
| `AllowDeny` | array `{order, rules}` | `{order:'', rules:[]}` | `order` in `''`, `'deny,allow'`, `'allow,deny'`, `'explicit'` (unknown -> `''`); `rules` string[] | Host/user based access rules. `order=''` disables. Rule grammar: `<'allow'|'deny'> <username|%> [from] <ipmask>`; ipmask shortcuts `all`, `localhost`, `localnetA/B/C`; supports exact IP, `[a-b]` last-octet ranges, CIDR, IPv6 equivalents. Empty rules = `allow % from all` for `deny,allow`, `deny % from all` otherwise. See `TrustedProxies` for client IP behind proxies. | `IpAllowDeny` | setup |
| `DisableIS` | bool | `false` | | Avoid `INFORMATION_SCHEMA` queries (use `SHOW ...`) on servers where IS is slow. | DBI (`getTablesFull`, `getColumns`...), `Relation::getChildReferences`, `UserPreferences::hasAccessToDatabase` | setup |
| `SessionTimeZone` | string | `''` | MySQL time zone spec | Issues `SET SESSION time_zone = ...` after connect. | DBI post-connect | setup |

### 2.5 Configuration storage (pmadb) tables

Each table directive is `string|false`. `''` (default) means "not configured, allow ZeroConf to fill in the default name `pma__*`"; `false` means "feature explicitly disabled, never auto-create or probe". `Relation::fixPmaTables` fills empty values with the default names when the table exists; `arePmadbTablesAllDisabled()` is true only when every one is `false`.

| Directive | Default | Suggested | Feature gated (RelationParameters flag) | Description |
|---|---|---|---|---|
| `pmadb` | `''` | `'phpmyadmin'` | everything below | Database holding the storage tables. If empty and `ZeroConf`, `phpmyadmin` is probed, then the current DB. |
| `bookmarktable` | `''` | `pma__bookmark` | `bookmarkwork` -> BookmarkFeature | SQL bookmarks (per user, optionally shared). |
| `relation` | `''` | `pma__relation` | `relwork` -> RelationFeature; with `table_info` -> `displaywork` | Internal (non-InnoDB) relations: clickable FK values, FK dropdowns, QBE auto-joins, PDF schema, Designer. `master_db` must equal `foreign_db`. |
| `table_info` | `''` | `pma__table_info` | `displaywork` -> DisplayFeature (needs `relation`) | "Display column" per table shown in tooltips/FK dropdowns. |
| `table_coords` | `''` | `pma__table_coords` | `pdfwork` -> PdfFeature (needs `pdf_pages`) | Table x/y positions per PDF page; also used by Designer. |
| `pdf_pages` | `''` | `pma__pdf_pages` | `pdfwork` | Named PDF schema pages per database. |
| `designer_coords` | - | - | **removed** (config.rst 918) | Designer coordinates are now stored in `table_coords`. |
| `column_info` | `''` | `pma__column_info` | `commwork` -> ColumnCommentsFeature (db comments via `(db_comment)` row); `mimework` -> BrowserTransformationFeature (only if the 4.3+ `input_transformation*` columns exist or can be auto-added) | Column comments (legacy), MIME types, browser display transformations and input transformations. Auto-upgrade runs `resources/sql/upgrade_column_info_4_3_0+.sql` through the control user (needs ALTER). |
| `history` | `''` | `pma__history` | `historywork` -> SqlHistoryFeature | Persistent SQL history (only used when `QueryHistoryDB = true`). |
| `recent` | `''` | `pma__recent` | `recentwork` -> RecentlyUsedTablesFeature | Recently used tables per user (JSON). |
| `favorite` | `''` | `pma__favorite` | `favoritework` -> FavoriteTablesFeature | Favorite tables per user (JSON). |
| `table_uiprefs` | `''` | `pma__table_uiprefs` | `uiprefswork` -> UiPreferencesFeature | Per-user per-table UI prefs (sort, column order, visibility). |
| `tracking` | `''` | `pma__tracking` | `trackingwork` -> TrackingFeature | Change tracking versions. |
| `userconfig` | `''` | `pma__userconfig` | `userconfigwork` -> UserPreferencesFeature | Persistent user preferences (and 2FA settings). |
| `users` | `''` | `pma__users` | `menuswork` -> ConfigurableMenusFeature (needs `usergroups`) | User -> user group mapping. |
| `usergroups` | `''` | `pma__usergroups` | `menuswork` | Allowed menu tabs per user group. |
| `navigationhiding` | `''` | `pma__navigationhiding` | `navwork` -> NavigationItemsHidingFeature | Hidden items in the navigation tree. |
| `savedsearches` | `''` | `pma__savedsearches` | `savedsearcheswork` -> SavedQueryByExampleSearchesFeature | Saved Query-by-example searches. |
| `central_columns` | `''` | `pma__central_columns` | `centralcolumnswork` -> CentralColumnsFeature | Central list of columns per database. |
| `designer_settings` | `''` | `pma__designer_settings` | `designersettingswork` -> DatabaseDesignerSettingsFeature | Designer UI settings per user. |
| `export_templates` | `''` | `pma__export_templates` | `exporttemplateswork` -> ExportTemplatesFeature | Saved export templates per user. |

All of these are editable in setup (Servers > Configuration storage), where the setup form pre-fills the suggested names via the "set value" pencil (`'bookmarktable' => 'pma__bookmark'` etc. in `ServersForm`).

### 2.6 Other per-server options

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `MaxTableUiprefs` | int | `100` | positive-int (`<1` -> 100) | Max rows kept in `table_uiprefs`; oldest (`last_update`) rows are deleted on save. | `Table::saveUiPrefsToDb` | setup |
| `tracking_version_auto_create` | bool | `false` | | Automatically create a tracking version when a table/view is created. | `Tracker` | setup (Servers > Changes tracking) |
| `tracking_default_statements` | string | `'CREATE TABLE,ALTER TABLE,DROP TABLE,RENAME TABLE,CREATE INDEX,DROP INDEX,INSERT,UPDATE,DELETE,TRUNCATE,REPLACE,CREATE VIEW,ALTER VIEW,DROP VIEW,CREATE DATABASE,ALTER DATABASE,DROP DATABASE'` | comma list of statement names (SET values of `pma__tracking.tracking`) | Statements tracked by auto-created versions. | `Tracker` | setup |
| `tracking_add_drop_view` | bool | `true` | | Prefix the log with `DROP VIEW IF EXISTS` when creating a view version. | `Tracker::createVersion` | setup |
| `tracking_add_drop_table` | bool | `true` | | Prefix with `DROP TABLE IF EXISTS`. | `Tracker` | setup |
| `tracking_add_drop_database` | bool | `true` | | Prefix with `DROP DATABASE IF EXISTS` when creating a database version. | `Tracker::createDatabaseVersion` | setup |

## 3. Generic settings

(`docs/config.rst` lines 1592-1923)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `DisableShortcutKeys` | bool | `false` | | Disable keyboard shortcuts (the `?` help, Ctrl+Alt+... bindings). | JS `shortcuts_handler` | user (Features > General) |
| `ServerDefault` | int | `1` | `0` or positive-int (`<0` -> 1) | Server auto-selected at start; `0` = show server list / login without server. | `Config::selectServer`, home page | setup (Config form on setup overview) |
| `VersionCheck` | bool | `true` (overridable by vendor constant `VERSION_CHECK_DEFAULT`) | | Fetch latest-version info on the home page. | Home page, `VersionInformation` | user (Features > General) |
| `ProxyUrl` | string | `''` | `host:port` | HTTP proxy for version check / error reports. | `HttpRequest` | setup (Features > Other core settings) |
| `ProxyUser` | string | `''` | | Basic-auth user for proxy. | `HttpRequest` | setup |
| `ProxyPass` | string | `''` | | Proxy password. | `HttpRequest` | setup |
| `MaxDbList` | int | `100` | positive-int | Max databases in DB list pages. User may not exceed the config value (`_userValidators` upper bound). | Server databases list, navigation | user (Features > Databases) |
| `MaxTableList` | int | `250` | positive-int | Max tables listed per page in DB structure. Upper-bounded for users. | DB structure | user (Features > Databases) |
| `MaxRoutineList` | int | `250` | positive-int | Max routines listed. Upper-bounded for users. | DB routines | file |
| `ShowHint` | bool | `true` | | Show tooltip hints. | Templates (`show_hint`) | user (Features > General) |
| `MaxCharactersInDisplayedSQL` | int | `1000` | positive-int | Truncate displayed SQL after N chars. | `Generator::getMessage`, console | user (SQL queries) |
| `PersistentConnections` | bool | `false` | | Use `p:` persistent mysqli connections. | DBI | setup (Features > Other core settings) |
| `ForceSSL` | bool | `false` | **removed 4.6.0** | | - | - |
| `MysqlSslWarningSafeHosts` | string[] | `['127.0.0.1', 'localhost']` | list of non-empty strings | Hosts for which no "connection is not using SSL" warning is shown. | Home page SSL warning | file |
| `ExecTimeLimit` | int | `300` | `0` = unlimited; `<0` -> 300 | `set_time_limit` seconds for the request. | `Core`/bootstrap, import/export | setup (Features > Other core settings) |
| `SessionSavePath` | string | `''` | path | `session_save_path`. | `Session` | file |
| `MemoryLimit` | string | `'-1'` | `-1`, `0`, or `\d+[kmg]?` (validator regex) | `memory_limit` to apply; `-1` unlimited, `0` leave unchanged. | Bootstrap | setup (Features > Other core settings) |
| `SkipLockedTables` | bool | `false` | | Mark used/locked tables (via `SHOW OPEN TABLES`) in DB structure. | DB structure | user (Features > General) |
| `ShowSQL` | bool | `true` | | Show the SQL phpMyAdmin executed with each result message. | `Generator::getMessage` | user (SQL queries) |
| `RetainQueryBox` | bool | `false` | | Keep the SQL query box visible after Ajax execution. | SQL page JS | user (SQL queries) |
| `CodemirrorEnable` | bool | `true` | | Use CodeMirror editor for SQL. | SQL editors (JS) | user (SQL queries) |
| `LintEnable` | bool | `true` | | Lint queries with the SQL parser before executing (needs CodeMirror). | `/lint` route, JS | user (SQL queries) |
| `DefaultForeignKeyChecks` | string | `'default'` | `'default'`, `'enable'`, `'disable'` | Initial state of the "Enable foreign key checks" checkbox on import/SQL. | `Util::getFKCheckbox`/`Sql` | user (SQL queries) |
| `AllowUserDropDatabase` | bool | `false` | | Show "Drop database" to users without global privileges (does not enforce anything in MySQL). | DB Operations, DB list | setup (Features > Security) |
| `Confirm` | bool | `true` | | Confirm destructive statements (DROP, DELETE, TRUNCATE...). | JS `confirmQuery` | user (SQL queries) |
| `UseDbSearch` | bool | `true` | | Enable the database Search tab. | DB menu | setup (Features > Other core settings) |
| `IgnoreMultiSubmitErrors` | bool | `false` | | Continue executing multi-statement input after an error. | `Sql`/import | user (SQL queries) |
| `enable_drag_drop_import` | bool | `true` | | Allow dropping a file on the page to import it. | JS drag-drop import | user (Import) |
| `URLQueryEncryption` | bool | `false` | | Encrypt sensitive URL query parameters (`db`, `table`, `sql_query`...). | `Url` | file |
| `URLQueryEncryptionSecretKey` | string | `''` | 32 bytes | Key for URL encryption; if empty, derived from `blowfish_secret`. | `Url`/`Crypto` | file |
| `maxRowPlotLimit` | int | `500` | positive-int | Max rows fetched for zoom-search / chart plotting. | Table zoom search | file |

## 4. Cookie authentication options

(`docs/config.rst` lines 1924-2176)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `blowfish_secret` | string | `''` | exactly 32 bytes (`SODIUM_CRYPTO_SECRETBOX_KEYBYTES`); setup generates one with `sodium_crypto_secretbox_keygen()` and writes it as `\sodium_hex2bin('...')` | Key encrypting the cookie-auth cookies (name kept for history; algorithm is Sodium secretbox). Required when any server uses `auth_type = cookie`; a random per-session one is generated (with a warning) when missing. | `AuthenticationCookie`, `Crypto` | setup (Features > Security) |
| `CookieSameSite` | string | `'Strict'` | `'Lax'`, `'Strict'`, `'None'` | `SameSite` attribute of all cookies. | `Config::setCookie` | file |
| `LoginCookieRecall` | bool | `true` | | Pre-fill the username from the last login. | Login form | setup (Features > Security) |
| `LoginCookieValidity` | int | `1440` | positive-int | Seconds of inactivity before the login cookie expires. Should not exceed `session.gc_maxlifetime`. Per-user override allowed (cached per server via `getLoginCookieValidityFromCache`). | `AuthenticationCookie` | user (Features > General) |
| `LoginCookieStore` | int | `0` | `0` = session only, else seconds | Browser lifetime of the login cookie. | `AuthenticationCookie` | setup (Features > Security) |
| `LoginCookieDeleteAll` | bool | `true` | | Logout deletes cookies for all servers, not just the current one. | `AuthenticationCookie::logOut` | setup (Features > Security) |
| `AllowArbitraryServer` | bool | `false` | | Show a "Server" field on the login form so any host can be entered. | Login form | setup (Features > Security) |
| `ArbitraryServerRegexp` | string | `''` | PCRE with delimiters | Restrict hosts accepted by `AllowArbitraryServer`. | Login validation | setup |
| `CaptchaMethod` | string | `'invisible'` | `'invisible'`, `'checkbox'` | reCAPTCHA v2 mode. | Login form | file |
| `CaptchaApi` | string | `'https://www.google.com/recaptcha/api.js'` | URL | reCAPTCHA-compatible API script. | Login form | file |
| `CaptchaCsp` | string | `'https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://ssl.gstatic.com/'` | | CSP allow-list snippet for the captcha. | `Header` CSP | file |
| `CaptchaRequestParam` | string | `'g-recaptcha'` | | Request parameter name. | Login form | file |
| `CaptchaResponseParam` | string | `'g-recaptcha-response'` | | Response parameter name. | Login form | file |
| `CaptchaLoginPublicKey` | string | `''` | | Site key; captcha enabled when both keys non-empty. | Login form | setup (Features > Security) |
| `CaptchaLoginPrivateKey` | string | `''` | | Secret key. | Login verification | setup |
| `CaptchaSiteVerifyURL` | string | `''` | URL | Override siteverify endpoint. | Login verification | setup |

## 5. Navigation panel setup

(`docs/config.rst` lines 2177-2431)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `ShowDatabasesNavigationAsTree` | bool | `true` | | `false` replaces the DB tree with a `<select>` database chooser. | Navigation | user/page (Navigation panel) |
| `FirstLevelNavigationItems` | int | `100` | positive-int | Page size of first-level (database) nodes. | Navigation tree paging | user/page |
| `MaxNavigationItems` | int | `50` | positive-int | Page size inside a branch (tables, columns...). | Navigation tree paging | user/page |
| `NavigationTreeEnableGrouping` | bool | `true` | | Group DBs/tables by separator prefix. | Navigation tree | user/page |
| `NavigationTreeDbSeparator` | string | `'_'` | short string | Separator used to group databases. | Navigation tree | user/page |
| `NavigationTreeTableSeparator` | string\|string[]\|false | `'__'` | string, list of strings, or `false` to disable | Separator(s) used to group tables. | Navigation tree | user/page |
| `NavigationTreeTableLevel` | int | `1` | positive-int | Nesting depth for table grouping. | Navigation tree | user/page |
| `NumRecentTables` | int | `10` | `0` disables | Number of recent tables in the "Recent" dropdown. | `RecentFavoriteTables` | user/page |
| `NumFavoriteTables` | int | `10` | `0` disables | Number of favorites in the "Favorites" dropdown. | `RecentFavoriteTables` | user/page |
| `ZeroConf` | bool | `true` | | Offer automatic creation of pmadb tables (home page / DB operations / `/check-relations`). | `Relation`, `CheckRelationsController`, home page | setup (Features > Other core settings) |
| `NavigationLinkWithMainPanel` | bool | `true` | | Highlight current DB/table in tree. | Navigation JS | user/page |
| `NavigationDisplayLogo` | bool | `true` | | Show logo above tree. | Navigation header | user/page |
| `NavigationLogoLink` | string | `'index.php'` | URL | Logo link target. | Navigation header | user/page |
| `NavigationLogoLinkWindow` | string | `'main'` | `'main'`, `'new'` | Open logo link in same or new window. | Navigation header | user/page |
| `NavigationTreeDisplayItemFilterMinimum` | int | `30` | positive-int | Show the JS filter box when a branch has at least N items. | Navigation tree | user/page |
| `NavigationTreeDisplayDbFilterMinimum` | int | `30` | positive-int | Show DB filter box at N databases. | Navigation tree | user/page |
| `NavigationDisplayServers` | bool | `true` | | Show server chooser at top of panel. | Navigation header | user/page |
| `DisplayServersList` | bool | `false` | | Server chooser as links instead of `<select>`. | Navigation header | user/page |
| `NavigationTreeDefaultTabTable` | string | `'/table/structure'` (docblock writes `'structure'`; the setter maps legacy words: `structure`->`/table/structure`, `sql`->`/table/sql`, `search`->`/table/search`, `insert`->`/table/change`, `browse`->`/sql`) | `/table/structure`, `/table/sql`, `/table/search`, `/table/change`, `/sql` | Route for the first quick-access icon on a table node. | Navigation tree | user/page |
| `NavigationTreeDefaultTabTable2` | string | `''` | same list plus `''` (no icon) | Second quick-access icon. | Navigation tree | user/page |
| `NavigationTreeEnableExpansion` | bool | `true` | | Allow expanding DB nodes. | Navigation tree | user/page |
| `NavigationTreeShowTables` | bool | `true` | | Show tables container. | Navigation tree | user/page |
| `NavigationTreeShowViews` | bool | `true` | | Show views container. | Navigation tree | user/page |
| `NavigationTreeShowFunctions` | bool | `true` | | Show functions container. | Navigation tree | user/page |
| `NavigationTreeShowProcedures` | bool | `true` | | Show procedures container. | Navigation tree | user/page |
| `NavigationTreeShowEvents` | bool | `true` | | Show events container. | Navigation tree | user/page |
| `NavigationTreeAutoexpandSingleDb` | bool | `true` | | Auto-expand when only one DB is visible. | Navigation tree | user/page |
| `NavigationWidth` | int | `240` | `0` = collapsed | Initial navigation panel width (px). | Navigation layout/JS resizer | user/page |

## 6. Main panel

(`docs/config.rst` lines 2432-2524)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `ShowStats` | bool | `true` | | Show space usage/statistics on DB structure and table structure. | DB/table structure | user (Main panel > Startup) |
| `ShowServerInfo` | bool\|string | `true` | `true`, `false`, `'database-server'`, `'web-server'` | Which info blocks appear on the home page. | Home page | user (Main panel > Startup) |
| `ShowPhpInfo` | bool | `false` | | Show `phpinfo()` link on home page. | Home page, `/phpinfo` route | setup (Main panel > Startup) |
| `ShowChgPassword` | bool | `true` | | Show "Change password" link (ignored for `config` auth). | Home page | setup (Main panel > Startup) |
| `ShowCreateDb` | bool | `true` | | Show "Create database" form on DB list/home. | Server databases, home | user (Main panel > Startup) |
| `ShowGitRevision` | bool | `true` | | Show Git revision on home page when running from a checkout. | Home page, `/git-revision` | file |
| `MysqlMinVersion` | array `{internal:int, human:string}` | `['internal' => 50500, 'human' => '5.5.0']` | | Minimum supported server version; lower versions are refused at connect. | DBI post-connect | file |

## 7. Database structure

(`docs/config.rst` lines 2525-2580)

| Directive | Type | Default | Description | Used by | UI |
|---|---|---|---|---|---|
| `ShowDbStructureCharset` | bool | `false` | Show "Collation" column in DB structure. | DB structure | user/page (Main panel > Database structure) |
| `ShowDbStructureComment` | bool | `false` | Show "Comment" column. | DB structure | user/page |
| `ShowDbStructureCreation` | bool | `false` | Show "Creation" timestamp column. | DB structure | user/page |
| `ShowDbStructureLastUpdate` | bool | `false` | Show "Last update" column. | DB structure | user/page |
| `ShowDbStructureLastCheck` | bool | `false` | Show "Last check" column. | DB structure | user/page |
| `HideStructureActions` | bool | `true` | Collapse extra per-column actions in table structure into a "More" dropdown. | Table structure | user/page (Main panel > Table structure) |
| `ShowColumnComments` | bool | `true` | Show column comments in table structure. | Table structure | user/page |

## 8. Browse mode

(`docs/config.rst` lines 2581-2677)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `TableNavigationLinksMode` | string | `'icons'` | `'icons'`, `'text'`, `'both'` | Rendering of the result-set paging bar. | `DisplayResults` | user/page (Main panel > Browse mode) |
| `ActionLinksMode` | string | `'both'` | `'icons'`, `'text'`, `'both'` | Rendering of action links (edit/copy/delete etc.). | `Generator::getIcon` | user/page |
| `RowActionType` | string | `'both'` | `'icons'`, `'text'`, `'both'` | Rendering of row action segment. | `DisplayResults` | file |
| `ShowAll` | bool | `false` | | Show the "Show all" button in browse mode. | `DisplayResults` | user/page |
| `MaxRows` | int | `25` | positive-int; UI select `25,50,100,250,500` | Rows per page. | `DisplayResults`, `Sql` | user/page |
| `Order` | string | `'SMART'` | `'ASC'`, `'DESC'`, `'SMART'` | Default sort direction on first click; SMART = DESC for temporal types. | `DisplayResults` | user/page |
| `DisplayBinaryAsHex` | bool | `true` | **removed 4.3.0** | | - | - |
| `GridEditing` | string | `'double-click'` | `'double-click'`, `'click'`, `'disabled'` | What triggers inline cell editing. | `DisplayResults`, JS `makegrid` | user/page |
| `RelationalDisplay` | string | `'K'` | `'K'` (key), `'D'` (display column) | Default of the "Relational key / display column" browse option. | `DisplayResults` | user/page |
| `SaveCellsAtOnce` | bool | `false` | | Grid editing saves all edited cells with one Save button instead of per cell. | JS `makegrid` | user/page |

## 9. Editing mode

(`docs/config.rst` lines 2678-2739)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `ProtectBinary` | string\|false | `'blob'` | `false`, `'blob'`, `'noblob'`, `'all'` | Which binary columns are not editable in insert/edit. | `InsertEdit` | user/page (Main panel > Edit mode) |
| `ShowFunctionFields` | bool | `true` | | Show the "Function" column in insert/edit. | `InsertEdit` | user/page |
| `ShowFieldTypesInDataEditView` | bool | `true` | | Show the "Type" column in insert/edit. | `InsertEdit` | user/page |
| `InsertRows` | int | `2` | positive-int | Rows offered on the Insert tab. | `InsertEdit` | user/page |
| `ForeignKeyMaxLimit` | int | `100` | positive-int | Use a dropdown for FK values when the foreign table has fewer rows; else the "Browse foreign values" popup. | `Relation::getForeignData` | user/page |
| `ForeignKeyDropdownOrder` | string[] | `['content-id', 'id-content']` | 1 or 2 of `'content-id'`, `'id-content'` | Ordering of the two sections in FK dropdowns. | `Relation::foreignDropdown` | user/page |

## 10. Export and import settings

(`docs/config.rst` lines 2740-2880; `src/Config/Settings/Export.php`, `Import.php`, `Schema.php`)

### 10.1 Compression and top-level

| Directive | Type | Default | Description | Used by | UI |
|---|---|---|---|---|---|
| `ZipDump` | bool | `true` | Offer zip compression (needs `zip`/`gzcompress`). | Export/import | setup (Features > Import / export) |
| `GZipDump` | bool | `true` | Offer gzip (needs zlib). | Export/import | setup |
| `BZipDump` | bool | `true` | Offer bzip2 (needs bz2). | Export/import | setup |
| `CompressOnFly` | bool | `true` | Stream gzip output instead of buffering. | Export | setup |

### 10.2 `$cfg['Export'][...]`

Default placeholders for filename templates follow FAQ 6.27 (`@SERVER@`, `@DATABASE@`, `@TABLE@`, plus `strftime` tokens). `StructureOrDataType` = `'structure' | 'data' | 'structure_and_data'` (unknown -> each key's own default). The Settings UI label mapping is in `Descriptions.php` (`Export_<key>_name`).

| Key | Type | Default | Allowed values | Description (UI label) | UI |
|---|---|---|---|---|---|
| `format` | string | `'sql'` | `codegen`, `csv`, `excel`, `htmlword`, `json`, `latex`, `mediawiki`, `ods`, `odt`, `pdf`, `phparray`, `sql`, `texytext`, `xml`, `yaml` (Settings UI `<select>` lists only `codegen,csv,excel,htmlword,latex,ods,odt,pdf,sql,texytext,xml,yaml`) | Default export format. | user/page (Export > Export defaults) |
| `method` | string | `'quick'` | `quick`, `custom`, `custom-no-form` | How the export form opens. | user/page |
| `compression` | string | `'none'` | `none`, `zip`, `gzip` | Default compression. | user/page |
| `lock_tables` | bool | `false` | | Use `LOCK TABLES` while exporting. | user/page |
| `as_separate_files` | bool | `false` | | Export each DB/table into its own file (zip). | user/page |
| `asfile` | bool | `true` | | "Save output to a file" (vs. display). | user/page |
| `charset` | string | `''` | `''` or any of `AvailableCharsets` | Output charset conversion. | user/page |
| `onserver` | bool | `false` | | Save to `SaveDir` on the server. | user/page |
| `onserver_overwrite` | bool | `false` | | Overwrite existing file in `SaveDir`. | user/page |
| `quick_export_onserver` | bool | `false` | | Same for quick method. | user/page |
| `quick_export_onserver_overwrite` | bool | `false` | | | user/page |
| `remember_file_template` | bool | `true` | | Remember last filename template (stored as user pref). | file |
| `file_template_table` | string | `'@TABLE@'` | | Filename template for table export. | user/page |
| `file_template_database` | string | `'@DATABASE@'` | | | user/page |
| `file_template_server` | string | `'@SERVER@'` | | | user/page |
| `remove_definer_from_definitions` | bool | `false` | | Strip `DEFINER` from view/routine/event/trigger definitions (5.2.0+). | file |
| `codegen_structure_or_data` | string | `'data'` | StructureOrData | | file |
| `codegen_format` | int | `0` | `0` = NHibernate C# DO, `1` = NHibernate XML | | user/page (Export > CodeGen) |
| `ods_columns` | bool | `true` | | Column names in first row. | user/page (Export > OpenDocument) |
| `ods_null` | string | `'NULL'` | | Replacement for NULL. | user/page |
| `ods_structure_or_data` | string | `'data'` | | | file |
| `odt_structure_or_data` | string | `'structure_and_data'` | | | user/page |
| `odt_columns` | bool | `true` | | | user/page |
| `odt_relation` | bool | `true` | | Include relations. | user/page |
| `odt_comments` | bool | `true` | | Include comments. | user/page |
| `odt_mime` | bool | `true` | | Include media types. | user/page |
| `odt_null` | string | `'NULL'` | | | user/page |
| `htmlword_structure_or_data` | string | `'structure_and_data'` | | | user/page (Export > Microsoft Office) |
| `htmlword_columns` | bool | `false` | | | user/page |
| `htmlword_null` | string | `'NULL'` | | | user/page |
| `texytext_structure_or_data` | string | `'structure_and_data'` | | | user/page (Export > Texy! text) |
| `texytext_columns` | bool | `false` | | | user/page |
| `texytext_null` | string | `'NULL'` | | | user/page |
| `csv_columns` | bool | `true` | | | user/page (Export > CSV) |
| `csv_structure_or_data` | string | `'data'` | | | file |
| `csv_null` | string | `'NULL'` | | | user/page |
| `csv_separator` | string | `','` | short string | "Columns terminated with". | user/page |
| `csv_enclosed` | string | `'"'` | | | user/page |
| `csv_escaped` | string | `'"'` | | | user/page |
| `csv_terminated` | string | `'AUTO'` | | Line terminator; `AUTO` = detect. | user/page |
| `csv_removeCRLF` | bool | `false` | | | user/page |
| `toon_indent` | int | `2` | | TOON format indent (new format; not in UI). | file |
| `toon_separator` | string | `','` | | | file |
| `toon_structure_or_data` | string | `'structure_and_data'` | | | file |
| `excel_columns` | bool | `true` | | | user/page (Export > CSV for MS Excel) |
| `excel_null` | string | `'NULL'` | | | user/page |
| `excel_edition` | string | `'win'` | `win`, `mac_excel2003`, `mac_excel2008` | | user/page |
| `excel_removeCRLF` | bool | `false` | | | user/page |
| `excel_structure_or_data` | string | `'data'` | | | file |
| `latex_structure_or_data` | string | `'structure_and_data'` | | | user/page (Export > LaTeX) |
| `latex_columns` | bool | `true` | | | user/page |
| `latex_relation` | bool | `true` | | | user/page |
| `latex_comments` | bool | `true` | | | user/page |
| `latex_mime` | bool | `true` | | | user/page |
| `latex_null` | string | `'\textit{NULL}'` | | | user/page |
| `latex_caption` | bool | `true` | | | user/page |
| `latex_structure_caption` | string | `'strLatexStructure'` | | Magic string, translated at export time. | user/page |
| `latex_structure_continued_caption` | string | `'strLatexStructure strLatexContinued'` | | | user/page |
| `latex_data_caption` | string | `'strLatexContent'` | | | user/page |
| `latex_data_continued_caption` | string | `'strLatexContent strLatexContinued'` | | | user/page |
| `latex_data_label` | string | `'tab:@TABLE@-data'` | | | user/page |
| `latex_structure_label` | string | `'tab:@TABLE@-structure'` | | | user/page |
| `mediawiki_structure_or_data` | string | `'data'` | | | file |
| `mediawiki_caption` | bool | `true` | | | file |
| `mediawiki_headers` | bool | `true` | | | file |
| `pdf_structure_or_data` | string | `'data'` | | | file |
| `pdf_report_title` | string | `''` | | | file |
| `phparray_structure_or_data` | string | `'data'` | | | file |
| `json_structure_or_data` | string | `'data'` | | | file |
| `json_pretty_print` | bool | `false` | | | file |
| `json_unicode` | bool | `true` | | Output unicode unescaped. | file |
| `sql_structure_or_data` | string | `'structure_and_data'` | | | user/page (Export > SQL) |
| `sql_compatibility` | string | `'NONE'` | `NONE`, `ANSI`, `DB2`, `MAXDB`, `MYSQL323`, `MYSQL40`, `MSSQL`, `ORACLE`, `TRADITIONAL` | | user/page |
| `sql_include_comments` | bool | `true` | | Header comments. | user/page |
| `sql_disable_fk` | bool | `false` | | Wrap in `SET FOREIGN_KEY_CHECKS=0`. | user/page |
| `sql_views_as_tables` | bool | `false` | | | user/page |
| `sql_metadata` | bool | `false` | | Also export pmadb metadata for the objects. | user/page |
| `sql_use_transaction` | bool | `true` | | | user/page |
| `sql_create_database` | bool | `false` | | Add `CREATE DATABASE / USE`. | user/page |
| `sql_drop_database` | bool | `false` | | | user/page |
| `sql_drop_table` | bool | `false` | | Add `DROP TABLE / VIEW / PROCEDURE / FUNCTION / EVENT / TRIGGER`. | user/page |
| `sql_if_not_exists` | bool | `false` | | | user/page |
| `sql_view_current_user` | bool | `false` | | Exclude `DEFINER=current user` from views. | user/page |
| `sql_or_replace_view` | bool | `false` | | `CREATE OR REPLACE VIEW`. | user/page |
| `sql_procedure_function` | bool | `true` | | Add routines/events. | user/page |
| `sql_create_table` | bool | `true` | | | user/page |
| `sql_create_view` | bool | `true` | | | user/page |
| `sql_create_trigger` | bool | `true` | | | user/page |
| `sql_auto_increment` | bool | `true` | | Keep `AUTO_INCREMENT=` value. | user/page |
| `sql_backquotes` | bool | `true` | | | user/page |
| `sql_dates` | bool | `false` | | Creation/update/check dates in comments. | user/page |
| `sql_relation` | bool | `false` | | Relations in comments. | user/page |
| `sql_truncate` | bool | `false` | | `TRUNCATE` before insert. | file |
| `sql_delayed` | bool | `false` | | `INSERT DELAYED`. | user/page |
| `sql_ignore` | bool | `false` | | `INSERT IGNORE`. | user/page |
| `sql_utc_time` | bool | `true` | | `SET time_zone = "+00:00"`. | user/page |
| `sql_hex_for_binary` | bool | `true` | | | user/page |
| `sql_type` | string | `'INSERT'` | `INSERT`, `UPDATE`, `REPLACE` | | user/page |
| `sql_max_query_size` | int | `50000` | `0`.. (validator `validatePositiveNumber`) | Max length of generated extended INSERT. | user/page |
| `sql_mime` | bool | `false` | | Media types in comments. | user/page |
| `sql_header_comment` | string | `''` | `\n` = newline | Custom header. | file |
| `sql_insert_syntax` | string | `'both'` | `complete`, `extended`, `both`, `none` | | user/page |
| `xml_structure_or_data` | string | `'data'` | | | file |
| `xml_export_struc` | bool | `true` | | | file |
| `xml_export_events` | bool | `true` | | | file |
| `xml_export_functions` | bool | `true` | | | file |
| `xml_export_procedures` | bool | `true` | | | file |
| `xml_export_tables` | bool | `true` | | | file |
| `xml_export_triggers` | bool | `true` | | | file |
| `xml_export_views` | bool | `true` | | | file |
| `xml_export_contents` | bool | `true` | | | file |
| `yaml_structure_or_data` | string | `'data'` | | | file |

### 10.3 `$cfg['Import'][...]`

| Key | Type | Default | Allowed values / validator | Description (UI label) | UI |
|---|---|---|---|---|---|
| `format` | string | `'sql'` | `csv`, `docsql`, `ldi`, `sql` | Default import format (list depends on context; SQL always available). | user/page (Import > Import defaults) |
| `charset` | string | `''` | `''` or `AvailableCharsets` | Charset of the file. | user/page |
| `allow_interrupt` | bool | `true` | | Partial import: stop near the time limit and offer to continue. | user/page |
| `skip_queries` | int | `0` | non-negative | Partial import: skip N queries. | user/page |
| `sql_compatibility` | string | `'NONE'` | as export | | user/page (Import > SQL) |
| `sql_no_auto_value_on_zero` | bool | `true` | | `SET SQL_MODE=NO_AUTO_VALUE_ON_ZERO`. | user/page |
| `sql_read_as_multibytes` | bool | `false` | | | user/page |
| `csv_replace` | bool | `false` | | Add `ON DUPLICATE KEY UPDATE`. | user/page (Import > CSV) |
| `csv_ignore` | bool | `false` | | Do not abort on INSERT error. | user/page |
| `csv_empty_as_null` | bool | `false` | | | user/page |
| `csv_terminated` | string | `','` | exactly 1 char (`/^.$/`) | Columns terminated with. | user/page |
| `csv_enclosed` | string | `'"'` | 0-1 char (`/^.?$/`) | | user/page |
| `csv_escaped` | string | `'"'` | 1 char | | user/page |
| `csv_new_line` | string | `'auto'` | | Line terminator. | file |
| `csv_columns` | string | `''` | | Column list. | file |
| `csv_col_names` | bool | `false` | | First line contains column names. | user/page |
| `ldi_replace` | bool | `false` | | | user/page (Import > CSV using LOAD DATA) |
| `ldi_ignore` | bool | `false` | | | user/page |
| `ldi_terminated` | string | `';'` | 1 char | | user/page |
| `ldi_enclosed` | string | `'"'` | 0-1 char | | user/page |
| `ldi_escaped` | string | `'\\'` | 1 char | | user/page |
| `ldi_new_line` | string | `'auto'` | | | file |
| `ldi_columns` | string | `''` | | | file |
| `ldi_local_option` | string\|bool | `'auto'` | `'auto'`, `true`, `false` | Use `LOCAL` keyword. | user/page |
| `ods_col_names` | bool | `false` | | | user/page (Import > OpenDocument Spreadsheet) |
| `ods_empty_rows` | bool | `true` | | Do not import empty rows. | user/page |
| `ods_recognize_percentages` | bool | `true` | | | user/page |
| `ods_recognize_currency` | bool | `true` | | | user/page |

### 10.4 `$cfg['Schema'][...]` (relational schema export)

| Key | Type | Default | Allowed values | Description |
|---|---|---|---|---|
| `format` | string | `'pdf'` | `pdf`, `eps`, `dia`, `svg` | Default schema export format. |
| `pdf_show_color` | bool | `true` | | Colour relations. |
| `pdf_show_keys` | bool | `false` | | Only show keys. |
| `pdf_all_tables_same_width` | bool | `false` | | |
| `pdf_orientation` | string | `'L'` | `L`, `P` | |
| `pdf_paper` | string | `'A4'` | | |
| `pdf_show_grid` | bool | `false` | | |
| `pdf_with_doc` | bool | `true` | | Include data dictionary. |
| `pdf_table_order` | string | `''` | `''`, `name_asc`, `name_desc` | |
| `dia_show_color` | bool | `true` | | |
| `dia_show_keys` | bool | `false` | | |
| `dia_orientation` | string | `'L'` | `L`, `P` | |
| `dia_paper` | string | `'A4'` | | |
| `eps_show_color` | bool | `true` | | |
| `eps_show_keys` | bool | `false` | | |
| `eps_all_tables_same_width` | bool | `false` | | |
| `eps_orientation` | string | `'L'` | `L`, `P` | |
| `svg_show_color` | bool | `true` | | |
| `svg_show_keys` | bool | `false` | | |
| `svg_all_tables_same_width` | bool | `false` | | |

All `Schema` keys are `file` only (they seed the schema export dialog defaults).

## 11. Tabs display settings

(`docs/config.rst` lines 2881-2940)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `TabsMode` | string | `'both'` | `'icons'`, `'text'`, `'both'` | Menu tab rendering. | `Menu`, `get_icon` | user (Main panel > Tabs) |
| `PropertiesNumColumns` | int | `1` | positive-int | Number of columns used to lay out the DB structure table list (>1 hides some info). | DB structure | file |
| `DefaultTabServer` | string | `'/'` (docblock `'welcome'`; legacy words mapped: `welcome`->`/`, `databases`->`/server/databases`, `status`->`/server/status`, `variables`->`/server/variables`, `privileges`->`/server/privileges`) | `/`, `/server/databases`, `/server/status`, `/server/variables`, `/server/privileges` | Landing route after choosing a server. | Routing/home | user (Main panel > Tabs) |
| `DefaultTabDatabase` | string | `'/database/structure'` (legacy `structure`, `sql`, `search`, `operations`) | `/database/structure`, `/database/sql`, `/database/search`, `/database/operations` | Landing route for a database. | Navigation links, `SpecialSchemaLinks` | user |
| `DefaultTabTable` | string | `'/sql'` (docblock `'browse'`; legacy `structure`->`/table/structure`, `sql`->`/table/sql`, `search`->`/table/search`, `insert`->`/table/change`, `browse`->`/sql`) | `/table/structure`, `/table/sql`, `/table/search`, `/table/change`, `/sql` | Landing route for a table. | Navigation links, `SpecialSchemaLinks` | user |

## 12. PDF options

| Directive | Type | Default | Description | Used by | UI |
|---|---|---|---|---|---|
| `PDFPageSizes` | string[] | `['A3', 'A4', 'A5', 'letter', 'legal']` | Paper sizes offered for PDF schema. | Schema export | file |
| `PDFDefaultPageSize` | string | `'A4'` | Default paper size (UI select from the list above). | Schema export | user (Main panel > Display relational schema) |

## 13. Languages

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `DefaultLang` | string | `'en'` | language code | Fallback language when browser/user give none. | `LanguageManager` | setup (Config form) |
| `DefaultConnectionCollation` | string | `'utf8mb4_unicode_ci'` | collation | `SET collation_connection` after connect (user pref). | `UserPreferencesHandler::setConnectionCollation` | user (Features > Databases) |
| `Lang` | string | `''` | language code | Force this language, disabling selection. | `LanguageManager` | file |
| `FilterLanguages` | string | `''` | PCRE | Restrict offered languages (e.g. `^(cs|en)`). | `LanguageManager` | file |
| `RecodingEngine` | string | `'auto'` | `'auto'`, `'iconv'`, `'mbstring'`, `'none'` (UI list also shows legacy `'mb'`) | Charset conversion backend for import/export. | `Encoding` | setup (Features > Import / export) |
| `IconvExtraParams` | string | `'//TRANSLIT'` | iconv flags | Appended to iconv target charset. | `Encoding` | setup |
| `AvailableCharsets` | string[] | `['iso-8859-1', 'iso-8859-2', 'iso-8859-3', 'iso-8859-4', 'iso-8859-5', 'iso-8859-6', 'iso-8859-7', 'iso-8859-8', 'iso-8859-9', 'iso-8859-10', 'iso-8859-11', 'iso-8859-12', 'iso-8859-13', 'iso-8859-14', 'iso-8859-15', 'windows-1250', 'windows-1251', 'windows-1252', 'windows-1256', 'windows-1257', 'koi8-r', 'big5', 'gb2312', 'utf-16', 'utf-8', 'utf-7', 'x-user-defined', 'euc-jp', 'ks_c_5601-1987', 'tis-620', 'SHIFT_JIS', 'SJIS', 'SJIS-win']` | list | Charsets offered for import/export conversion (order preserved). | Import/export forms | file |

## 14. Web server settings

(`docs/config.rst` lines 3050-3152)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `OBGzip` | string\|bool | `'auto'` | **removed 6.0.0** | | - | - |
| `TrustedProxies` | array `ip => header` | `[]` | validator `validateTrustedProxies`: each line `IP: HEADER` with valid IPv4/IPv6; UI edits as textarea lines | Proxies whose forwarded-for header is trusted for `AllowDeny` IP matching. Invalid lines are kept under keys `-0`, `-1`... so the user can fix them. | `Core::getIp` | setup (Features > Security) |
| `GD2Available` | string | `'auto'` | `'auto'`, `'yes'`, `'no'` | Whether GD2 is available (for inline image transformations / QR). | `Config::isGd2Available` | file |
| `CheckConfigurationPermissions` | bool | `true` | | Refuse to run if `config.inc.php` is world-writable (skipped on Windows). | `Config::checkPermissions` | setup (Features > Security) |
| `LinkLengthLimit` | int | `1000` | positive-int | Links whose URL exceeds this become POST forms with a button. | `Generator::linkOrButton` | file |
| `CSPAllow` | string | `''` | CSP source list | Extra sources appended to `Content-Security-Policy`. | `Header` | file |
| `DisableMultiTableMaintenance` | bool | `false` | | Hide mass OPTIMIZE/REPAIR/etc. in DB structure "With selected". | DB structure | user (Features > General) |

## 15. Theme settings / Theme manager

(`docs/config.rst` lines 3153-3158 and 3683-3718)

| Directive | Type | Default | Description | Used by | UI |
|---|---|---|---|---|---|
| `ThemeManager` | bool | `true` | Allow users to pick a theme (themes under `public/themes/`). | `ThemeManager`, home page theme selector | file |
| `ThemeDefault` | string | `'pmahomme'` | Default theme id. Also stored as user pref `ThemeDefault` when the user changes theme (`UserPreferencesHandler::loadUserPreferences`). | `ThemeManager` | file (pref written implicitly) |
| `ThemePerServer` | bool | `false` | Remember a different theme per server (cookie name suffixed by server id). | `ThemeManager::getThemeCookieName` | file |
| `FontSize` | string | `'82%'` | **removed 5.0.0** | - | - |

## 16. Design customization

(`docs/config.rst` lines 3159-3259)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `NavigationTreePointerEnable` | bool | `true` | | Highlight navigation item under cursor. | Navigation CSS/JS | user/page (Navigation panel) |
| `BrowsePointerEnable` | bool | `true` | | Highlight hovered row in browse. | `DisplayResults` | user/page (Browse mode) |
| `BrowseMarkerEnable` | bool | `true` | | Highlight checked rows. | `DisplayResults` | user/page |
| `LimitChars` | int | `50` | positive-int | Truncate non-numeric cell text in browse to N chars ("Partial texts"). | `DisplayResults`, FK dropdown labels | user/page |
| `RowActionLinks` | string | `'left'` | `'left'`, `'right'`, `'both'`, `'none'` | Position of edit/copy/delete links. | `DisplayResults` | user/page |
| `RowActionLinksWithoutUnique` | bool | `false` | | Show row links/checkboxes even without a unique key. | `DisplayResults` | user/page |
| `RememberSorting` | bool | `true` | | Persist sort per table (`table_uiprefs` or session). | `Table` ui prefs | user/page |
| `TablePrimaryKeyOrder` | string | `'NONE'` | `'NONE'`, `'ASC'`, `'DESC'` | Default ORDER BY primary key when browsing without sort. | `Sql` | user/page |
| `ShowBrowseComments` | bool | `true` | | Column comments in browse headers. | `DisplayResults` | file |
| `ShowPropertyComments` | bool | `true` | | Column comments in table structure. | Table structure | file |
| `FirstDayOfCalendar` | int | `0` | `0`..`7`, `0` = locale default, `1`=Monday..`7`=Sunday | First weekday of the date picker. | JS datepicker | user (Features > General) |

## 17. Text fields

(`docs/config.rst` lines 3260-3347)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `CharEditing` | string | `'input'` | `'input'`, `'textarea'` | Widget for CHAR/VARCHAR editing. | `InsertEdit` | user/page (Features > Text fields; Edit page settings) |
| `MinSizeForInputField` | int | `4` | non-negative | Min `size` of char inputs. | `InsertEdit` | user/page |
| `MaxSizeForInputField` | int | `60` | positive-int | Max `size`. | `InsertEdit` | user/page |
| `TextareaCols` | int | `40` | positive-int | Textarea cols (x2 for SQL boxes). | `InsertEdit`, SQL query box | user/page |
| `TextareaRows` | int | `15` | positive-int | Textarea rows. | same | user/page |
| `CharTextareaCols` | int | `40` | positive-int | Cols when `CharEditing = textarea`. | `InsertEdit` | user/page |
| `CharTextareaRows` | int | `7` | positive-int | | `InsertEdit` | user/page |
| `LongtextDoubleTextarea` | bool | `true` | | Double textarea size for LONGTEXT. | `InsertEdit` | user/page |
| `TextareaAutoSelect` | bool | `false` | | Select all text on click in SQL textarea. | SQL query box JS | file |
| `EnableAutocompleteForTablesAndColumns` | bool | `true` | | CodeMirror autocomplete of table/column names. | SQL editor JS | user (SQL queries) |

## 18. SQL query box settings

| Directive | Type | Default | Description | Used by | UI |
|---|---|---|---|---|---|
| `SQLQuery/Edit` | bool | `true` | Show "Edit" link under results. | `Sql` results links | user/page (SQL queries > SQL Query box) |
| `SQLQuery/Explain` | bool | `true` | Show "Explain SQL". | same | user/page |
| `SQLQuery/ShowAsPHP` | bool | `true` | Show "Create PHP code". | same | user/page |
| `SQLQuery/Refresh` | bool | `true` | Show "Refresh". | same | user/page |

## 19. Web server upload/save/import directories

| Directive | Type | Default | Description | Used by | UI |
|---|---|---|---|---|---|
| `UploadDir` | string | `''` | Server directory from which files can be imported (web-server-readable); `%u` is replaced by the MySQL username. Empty disables. | Import "web server upload directory" select | setup (Features > Import / export) |
| `SaveDir` | string | `''` | Server directory to save exports to; `%u` supported. | Export "Save on server" | setup |
| `TempDir` | string | `'./tmp/'` (resolved to `ROOT_PATH.'tmp/'` or vendor `TEMP_DIR`) | Writable temp dir for Twig cache, uploads, routing cache, etc. Sub-dirs created on demand (`Config::getTempDir`). | Many | file |

## 20. Various display settings

(`docs/config.rst` lines 3492-3655)

| Directive | Type | Default | Allowed values / coercion | Description | Used by | UI |
|---|---|---|---|---|---|---|
| `RepeatCells` | int | `100` | `0` disables | Repeat header row every N rows in browse. | `DisplayResults` | user/page (Browse mode) |
| `EditInWindow`, `QueryWindowWidth`, `QueryWindowHeight`, `QueryWindowDefTab` | - | - | **removed 4.3.0** | | - | - |
| `QueryHistoryDB` | bool | `false` | | Store SQL history in `pma__history` instead of browser/session. | `Console\History` | setup (SQL queries) |
| `QueryHistoryMax` | int | `25` | positive-int; user may not exceed config value | History entries kept (DB rows purged beyond this per user; session list truncated). | `Console\History` | user (SQL queries) |
| `AllowSharedBookmarks` | bool | `true` | | Allow bookmarks with empty `user` (visible to all). | `BookmarkRepository` | setup (SQL queries) |
| `BrowseMIME` | bool | `true` | | Apply browser transformations (from `column_info`) when browsing. | `DisplayResults` | file |
| `MaxExactCount` | int | `50000` | positive-int | If the approximate row count is below this, run `SELECT COUNT(*)` for exact count (InnoDB). | `Table::countRecords` | file |
| `MaxExactCountViews` | int | `0` | `0` = never count views | Row count limit used for views. | `Table::countRecords` | file |
| `NaturalOrder` | bool | `true` | | Natural sort of DB/table names. | Lists, FK dropdowns | user (Features > General) |
| `InitialSlidersState` | string | `'closed'` | `'open'`, `'closed'`, `'disabled'` | Initial state of collapsible "sliders". | `Generator::getDivForSliderEffect` | user (Features > General) |
| `UserprefsDisallow` | string[] | `[]` | any user-pref path (e.g. `MaxRows`, `Export/format`, `Servers/1/hide_db`) | Settings users may **not** override; shown disabled in the Settings UI. Edited in setup via the per-field "Allow users to customize this value" checkbox. | `UserPreferences::apply`, `FormDisplay` | setup (per-field checkbox) |
| `UserprefsDeveloperTab` | bool | `false` | | Show the Developer form (`DBG/sql`) in user Settings > Features. | `FeaturesForm` | setup (Features > Developer) |

## 21. Page titles

Placeholders (FAQ 6.27): `@HTTP_HOST@`, `@SERVER@`, `@VERBOSE@`, `@VSERVER@`, `@DATABASE@`, `@TABLE@`, `@COLUMNS@`, `@PHPMYADMIN@` plus PHP `strftime` tokens (`%Y`, `%m`...). Expansion in `Util::expandUserString`.

| Directive | Type | Default | Description | UI |
|---|---|---|---|---|
| `TitleTable` | string | `'@HTTP_HOST@ / @VSERVER@ / @DATABASE@ / @TABLE@ \| @PHPMYADMIN@'` | Window title when a table is selected. | user (Features > Page titles) |
| `TitleDatabase` | string | `'@HTTP_HOST@ / @VSERVER@ / @DATABASE@ \| @PHPMYADMIN@'` | Title when a database is selected. | user |
| `TitleServer` | string | `'@HTTP_HOST@ / @VSERVER@ \| @PHPMYADMIN@'` | Title when a server is selected. | user |
| `TitleDefault` | string | `'@HTTP_HOST@ \| @PHPMYADMIN@'` | Title otherwise (login page title is not customisable). | user |

## 22. Default queries

| Directive | Type | Default | Description | UI |
|---|---|---|---|---|
| `DefaultQueryTable` | string | `'SELECT * FROM @TABLE@ WHERE 1'` | Query pre-filled in the table SQL box. Placeholders as FAQ 6.27 (notably `@TABLE@`, `@COLUMNS@`, `@DATABASE@`). | file |
| `DefaultQueryDatabase` | string | `''` | Query pre-filled in the database SQL box. | file |

## 23. MySQL settings

| Directive | Type | Default | Description | UI |
|---|---|---|---|---|
| `DefaultFunctions` | array<string,string> | `['FUNC_CHAR' => '', 'FUNC_DATE' => '', 'FUNC_NUMBER' => '', 'FUNC_SPATIAL' => 'GeomFromText', 'FUNC_UUID' => 'UUID', 'first_timestamp' => 'NOW']` | Function pre-selected in the insert form per type class (`first_timestamp` applies to the first TIMESTAMP column). Unknown keys are dropped. | file |

## 24. Default options for Transformations (`$cfg['DefaultTransformations']`)

These seed the "Transformation options" field in Structure > Change column when none are stored in `column_info`. All are `user/page` (Main panel > Table structure > Default transformations), edited as line-separated lists.

| Key | Type | Default | Semantics |
|---|---|---|---|
| `Substring` | `[int, int\|'all', string]` | `[0, 'all', '…']` | skip N chars, return M chars (`all`), suffix on truncation. |
| `Bool2Text` | `[string, string]` | `['T', 'F']` | text for true / false. |
| `External` | `[int, string, int, int]` | `[0, '-f /dev/null -i -wrap -q', 1, 1]` | program index (in `ExternalTransformationsPlugin` allow-list), legacy, htmlspecialchars output, no-wrap. |
| `PreApPend` | `[string, string]` | `['', '']` | prefix, suffix. |
| `Hex` | `[int]` | `['2']` | insert a space every N nibbles. |
| `DateFormat` | `[int, string, 'local'\|'utc']` | `[0, '', 'local']` | hour offset, format string, local vs UTC. |
| `Inline` | `{0:int, 1:int, wrapper_link:?string, wrapper_params:array}` | `['100', 100]` | thumbnail max width/height, optional link wrapper. |
| `TextImageLink` | `[?string, int, int]` | `[null, 100, 50]` | URL prefix, width, height. |
| `TextLink` | `[?string, ?string, ?bool]` | `[null, null, null]` | URL prefix, link title, (legacy) new window. |

## 25. Console settings (`$cfg['Console']`)

Mostly changed from the console UI itself (persisted as user prefs through `setUserValue`).

| Key | Type | Default | Allowed values | Description | UI |
|---|---|---|---|---|---|
| `StartHistory` | bool | `false` | | Show history on open. | user (Features > Console) |
| `AlwaysExpand` | bool | `false` | | Expand query messages. | user |
| `CurrentQuery` | bool | `true` | | Show the query of the current page. | user |
| `EnterExecutes` | bool | `false` | | Enter runs, Shift+Enter newline. | user |
| `DarkTheme` | bool | `false` | | Dark console. | user |
| `Mode` | string | `'info'` | `'info'`, `'show'`, `'collapse'` | Initial console state. | user |
| `Height` | int | `92` | positive-int (validator non-negative) | Console height px. | user |
| `GroupQueries` | bool | `false` | | Group identical queries in history. | user |
| `OrderBy` | string | `'exec'` | `'exec'`, `'time'`, `'count'` | History ordering key. | user |
| `Order` | string | `'asc'` | `'asc'`, `'desc'` | History order direction. | user |

## 26. Developer

| Directive | Type | Default | Allowed values | Description | UI |
|---|---|---|---|---|---|
| `environment` | string | `'production'` | `'production'`, `'development'` | Development mode shows debug info, disables some caches. | file |
| `DBG/sql` | bool | `false` | | Collect executed queries + timings and show them in the console "Debug SQL" tab. | user (Features > Developer, only if `UserprefsDeveloperTab`) / setup |
| `DBG/sqllog` | bool | `false` | | Also log queries to syslog. | file |
| `DBG/demo` | bool | `false` | | Demo-server mode (disables setup connection test, shows demo banner, allows setup with existing config). | file |
| `DBG/simple2fa` | bool | `false` | | Enable the "Simple" two-factor backend (testing only). | file |

---

## Appendix A. Directives per Settings-UI form (quick index)

Derived from `src/Config/Forms/User/*.php` (what users can change) and `Setup/*.php` (setup-only additions):

* **Features**: General (`VersionCheck`, `NaturalOrder`, `InitialSlidersState`, `LoginCookieValidity`, `SkipLockedTables`, `DisableMultiTableMaintenance`, `ShowHint`, `SendErrorReports`, `ConsoleEnterExecutes`, `DisableShortcutKeys`, `FirstDayOfCalendar`); Databases (`Servers/1/only_db`, `Servers/1/hide_db`, `MaxDbList`, `MaxTableList`, `DefaultConnectionCollation`); Text fields (`CharEditing`, `MinSizeForInputField`, `MaxSizeForInputField`, `CharTextareaCols`, `CharTextareaRows`, `TextareaCols`, `TextareaRows`, `LongtextDoubleTextarea`); Page titles (`TitleDefault`, `TitleTable`, `TitleDatabase`, `TitleServer`); Warnings (`PmaNoRelation_DisableWarning`, `LoginCookieValidityDisableWarning`, `ReservedWordDisableWarning`); Console (all `Console/*`); Developer (`DBG/sql`, only with `UserprefsDeveloperTab`). Setup adds: Import / export (`UploadDir`, `SaveDir`, `RecodingEngine`, `IconvExtraParams`, `ZipDump`, `GZipDump`, `BZipDump`, `CompressOnFly`), Security (`blowfish_secret`, `CheckConfigurationPermissions`, `TrustedProxies`, `AllowUserDropDatabase`, `AllowArbitraryServer`, `ArbitraryServerRegexp`, `LoginCookieRecall`, `LoginCookieStore`, `LoginCookieDeleteAll`, `CaptchaLoginPublicKey`, `CaptchaLoginPrivateKey`, `CaptchaSiteVerifyURL`), Developer (`UserprefsDeveloperTab`, `DBG/sql`), Other core settings (`PersistentConnections`, `ExecTimeLimit`, `MemoryLimit`, `UseDbSearch`, `ProxyUrl`, `ProxyUser`, `ProxyPass`, `AllowThirdPartyFraming`, `ZeroConf`).
* **SQL queries**: SQL queries (`ShowSQL`, `Confirm`, `QueryHistoryMax`, `IgnoreMultiSubmitErrors`, `MaxCharactersInDisplayedSQL`, `RetainQueryBox`, `CodemirrorEnable`, `LintEnable`, `EnableAutocompleteForTablesAndColumns`, `DefaultForeignKeyChecks`; setup adds `QueryHistoryDB`, `AllowSharedBookmarks`); SQL Query box (`SQLQuery/Edit`, `Explain`, `ShowAsPHP`, `Refresh`).
* **Navigation panel**: Navigation panel, Navigation tree, Servers, Databases, Tables groups (see section 5 and 16).
* **Main panel**: Startup (`ShowCreateDb`, `ShowStats`, `ShowServerInfo`; setup adds `ShowPhpInfo`, `ShowChgPassword`), Database structure, Table structure (+ `DefaultTransformations/*`), Browse mode, Edit mode, Tabs (`TabsMode`, `DefaultTabServer`, `DefaultTabDatabase`, `DefaultTabTable`), Display relational schema (`PDFDefaultPageSize`).
* **Export** / **Import**: see 10.2 / 10.3.
* **Setup only**: Servers form (Basic settings, Authentication, Server configuration, Configuration storage, Changes tracking) and the overview "Configuration file" form (`DefaultLang`, `ServerDefault`, end-of-line).

## Appendix B. Directives that are never exposed in any form

`PmaAbsoluteUri`, `AuthLog`, `AuthLogSuccess`, `TranslationWarningThreshold`, `Servers/*/ssl_*`, `Servers/*/control_*`, `Servers/*/SignonCookieParams`, `Servers/*/SignonScript`, `Servers/*/hide_connection_errors`, `MaxRoutineList`, `MysqlSslWarningSafeHosts`, `SessionSavePath`, `CookieSameSite`, `URLQueryEncryption*`, `Captcha{Method,Api,Csp,RequestParam,ResponseParam}`, `maxRowPlotLimit`, `ShowGitRevision`, `MysqlMinVersion`, `PropertiesNumColumns`, `RowActionType`, `PDFPageSizes`, `Lang`, `FilterLanguages`, `AvailableCharsets`, `GD2Available`, `LinkLengthLimit`, `CSPAllow`, `TempDir`, `ThemeManager`, `ThemeDefault`, `ThemePerServer`, `ShowBrowseComments`, `ShowPropertyComments`, `TextareaAutoSelect`, `BrowseMIME`, `MaxExactCount`, `MaxExactCountViews`, `DefaultQueryTable`, `DefaultQueryDatabase`, `DefaultFunctions`, `Schema/*`, `Export/{remember_file_template,remove_definer_from_definitions,*_structure_or_data (non-UI ones),sql_truncate,sql_header_comment,toon_*,json_*,xml_*,mediawiki_*,pdf_report_title}`, `Import/{csv_new_line,csv_columns,ldi_new_line,ldi_columns}`, `environment`, `DBG/{sqllog,demo,simple2fa}`.

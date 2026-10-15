# 08 - Settings, user preferences and the configuration storage (pmadb)

## Scope & source map

This document covers three layers of phpMyAdmin configuration and the metadata store that backs most "advanced" features:

1. **Server configuration** (`config.inc.php`, the setup script, Docker env vars) - the complete directive list lives in `docs/reference/config-directives.md`; this document covers the *mechanics* (loading, precedence, file formats).
2. **User preferences** - the Settings pages (`index.php?route=/preferences/*`), the per-page gear popups, how preferences are validated, stored (pmadb / session / browser localStorage), exported and imported, and the two-factor-authentication tab.
3. **phpMyAdmin configuration storage (pmadb)** - the 19 `pma__*` tables, what each column means, which feature each table unlocks, how the "works" flags are computed, ZeroConf auto-creation, and how foreign keys / display fields / comments / MIME transformations are resolved from the mix of `information_schema`, `SHOW CREATE TABLE` and pmadb.

| Concern | Source files (phpMyAdmin master, Oct 2026) |
|---|---|
| Typed config value object + defaults | `src/Config/Settings.php`, `src/Config/Settings/{Server,Export,Import,Schema,SqlQueryBox,Console,Transformations,Debug}.php` |
| Loading `config.inc.php`, permissions, cookies, control connection params | `src/Config.php`, `app/constants.php`, `app/vendor_config.php` |
| Form definitions (which directive appears in which tab/group) | `src/Config/Forms/BaseForm.php`, `BaseFormList.php`, `Forms/User/*.php`, `Forms/Setup/*.php`, `Forms/Page/*.php` |
| Form engine (type inference, rendering, POST processing, validation hooks) | `src/Config/Form.php`, `FormDisplay.php`, `FormDisplayTemplate.php`, `Descriptions.php`, `resources/templates/config/form_display/*.twig` |
| Allowed-value lists + validator table | `src/Config/ConfigFile.php::getAllowedValues()` |
| Validators | `src/Config/Validator.php`, JS mirror in `resources/js/modules/config.ts` |
| Working copy of config during editing (session-backed) | `src/Config/ConfigFile.php` |
| Load/save/apply user prefs | `src/Config/UserPreferences.php`, `src/Config/UserPreferencesHandler.php` |
| Settings controllers | `src/Controllers/Preferences/{Manage,TwoFactor,Features,Sql,Navigation,MainPanel,Export,Import}Controller.php` |
| Settings templates | `resources/templates/preferences/{header,autoload}.twig`, `preferences/forms/main.twig`, `preferences/manage/{main,error}.twig`, `preferences/two_factor/{main,configure,confirm}.twig` |
| Page settings gear | `src/Config/PageSettings.php`, `resources/js/modules/page_settings.ts`, call sites listed in section "Page settings forms matrix" |
| Two-factor | `src/TwoFactor.php`, `src/Plugins/TwoFactorPlugin.php`, `src/Plugins/TwoFactor/{Application,Key,WebAuthn,Simple,Invalid}.php`, `resources/templates/login/twofactor/*.twig`, `src/Plugins/AuthenticationPlugin.php::checkTwoFactor`, `src/Http/Middleware/Authentication.php` |
| pmadb DDL | `resources/sql/create_tables.sql`, `upgrade_column_info_4_3_0+.sql`, `upgrade_tables_4_7_0+.sql`, `upgrade_tables_mysql_4_1_2+.sql` |
| Relation parameters / feature gating | `src/ConfigStorage/Relation.php`, `RelationParameters.php`, `Features/*.php` |
| Storage check page and auto-create | `src/Controllers/CheckRelationsController.php`, `resources/templates/relation/check_relations.twig`, `src/Controllers/HomeController.php` (notice), `src/Controllers/Operations/DatabaseController.php` (notice) |
| Setup script | `src/Controllers/Setup/*.php`, `src/Setup/{ConfigGenerator,Index,SetupHelper}.php`, `src/Config/ServerConfigChecks.php`, `resources/templates/setup/**` |
| Special links for `mysql`/`information_schema` columns | `src/Config/SpecialSchemaLinks.php` |
| Docs | `docs/config.rst`, `docs/settings.rst`, `docs/setup.rst` (`linked-tables`, `zeroconf`, Docker env vars), `docs/faq.rst` 6.27 |

### Configuration layering (what overrides what)

```
Settings defaults (Settings.php)                     <- compiled-in
  <- config.inc.php  ($cfg array, loaded by Config::load(); mtime recorded as sourceMtime)
     <- Docker image: generated config.inc.php from PMA_* env vars, config.user.inc.php
  <- per-user preferences (pma__userconfig.config_data JSON, or $_SESSION['userconfig'])
       applied via UserPreferences::apply() -> array_replace_recursive() over $cfg,
       filtered by the UserFormList field allow-list and $cfg['UserprefsDisallow']
       (Servers/1/hide_db & only_db are stored as Server/hide_db, Server/only_db
        and merged into the *selected* server)
  <- cookies for a few things when no pmadb ("pma_lang", theme cookie, console state...)
  <- request-time overrides (set_theme, lang POST/GET) which are then persisted as prefs
```

`Config::$baseSettings` keeps the pre-user-pref array so the Settings UI can tell "config.inc.php default" from "phpMyAdmin default" (see `ConfigFile::set()`).

Environment variables: the PHP application itself reads **no** `PMA_*` environment variables (the only `getenv` uses are `Core::getEnv()` for `$_SERVER`-style keys such as `HTTP_HOST`, and `http_proxy` in `Utils/HttpRequest.php`). All `PMA_HOST`, `PMA_PMADB`, `PMA_CONTROLUSER`, ... variables documented in `docs/setup.rst` (section "docker-vars") are consumed by the official Docker image's entrypoint which *writes* a `config.inc.php`. The full list in `setup.rst`: `PMA_ARBITRARY`, `PMA_HOST(S)`, `PMA_VERBOSE(S)`, `PMA_USER`, `PMA_PASSWORD`, `PMA_PORT(S)`, `PMA_SOCKET(S)`, `PMA_ABSOLUTE_URI`, `PMA_QUERYHISTORYDB`, `PMA_QUERYHISTORYMAX`, `PMA_CONTROLHOST`, `PMA_CONTROLUSER`, `PMA_CONTROLPASS`, `PMA_CONTROLPORT`, `PMA_PMADB`, `HIDE_PHP_VERSION`, `UPLOAD_LIMIT`, `MEMORY_LIMIT`, `MAX_EXECUTION_TIME`, `PMA_CONFIG_BASE64`, `PMA_USER_CONFIG_BASE64`, `PMA_UPLOADDIR`, `PMA_SAVEDIR`, `APACHE_PORT`, `PMA_SSL_DIR`, `PMA_SSL(S)`, `PMA_SSL_VERIFY/VERIFIES`, `PMA_SSL_CA(S)[_BASE64]`, `PMA_SSL_CERT(S)[_BASE64]`, `PMA_SSL_KEY(S)[_BASE64]`.

### Config file formats

* **`config.inc.php`** - plain PHP that assigns into `$cfg`; path is `ROOT_PATH.'config.inc.php'` (vendor-overridable via `app/vendor_config.php::configFile`, constant `CONFIG_FILE`). Loaded with `@require` inside output buffering; a `Throwable` becomes `ConfigException('Failed to load phpMyAdmin configuration.')`. If the result is not an array it is ignored. `Config::checkPermissions()` throws `Wrong permissions on configuration file, should not be world writable!` when `CheckConfigurationPermissions` is on, the file is world-writable and the OS is not Windows/OS2. Companion files `config.header.inc.php` / `config.footer.inc.php` (custom HTML) and `config.sample.inc.php` (shipped template; sets `blowfish_secret=''`, one server with `auth_type='cookie'`, `host='localhost'`, `compress=false`, `AllowNoPassword=false`, commented pmadb block with every table name, `UploadDir`/`SaveDir` empty, and commented examples for `RowActionType`, `ShowAll`, `MaxRows`, `ProtectBinary`, `DefaultLang`, `PropertiesNumColumns`, `QueryHistoryDB`, `QueryHistoryMax`, `SendErrorReports`, `URLQueryEncryption*`).
* **Setup-script output** (`Setup/ConfigGenerator::getConfigFile`): header comment `Generated configuration file / Generated by: phpMyAdmin <version> setup script / Date: <RFC1123>`, then `/* Servers configuration */ $i = 0;` and per server `/* Server: <name> [<id>] */ $i++;` followed by `$cfg['Servers'][$i]['key'] = var_export(...)`, then `/* End of servers configuration */`, then every other key as `$cfg['k'] = ...;` (nested string-keyed arrays become `$cfg['k']['sub'] = ...;`, lists are exported inline if <= 4 items else one per line). `blowfish_secret` is always written as `\sodium_hex2bin('<64 hex>')`, generating a fresh 32-byte key if the stored value is not exactly 32 bytes. EOL is `\n` or `\r\n` according to the "End of line" choice stored in `$_SESSION['eol']`. Only non-default values are kept (`ConfigFile::set` drops values equal to the default), except "persist keys".
* **User-preference export "Save as PHP file"** (`ManageController`): `/* phpMyAdmin configuration snippet */ /* Paste it to your config.inc.php */` followed by one `$cfg['a']['b'] = var_export(value);` per flat pref path (path `a/b` -> `['a']['b']`). File name `phpMyAdmin-config-<HTTP_HOST>.php`, MIME `application/php`.
* **User-preference export JSON**: `json_encode($config_data, JSON_PRETTY_PRINT)` of the flat map `{ "MaxRows": 50, "Export/format": "csv", "Server/hide_db": "...", "ThemeDefault": "pmahomme", "lang": "cs", "2fa": {...} }`, file `phpMyAdmin-config-<HTTP_HOST>.json`.

---

## Settings UI (every tab/form/field, mapped to directive; validators)

### Entry points and chrome

* Routes: `/preferences/manage`, `/preferences/two-factor`, `/preferences/features`, `/preferences/sql`, `/preferences/navigation`, `/preferences/main-panel`, `/preferences/export`, `/preferences/import` (all `GET|POST`). The top menu "Settings" tab links to `/preferences/manage`.
* `preferences/header.twig` renders a pill nav with, in order: **Manage your settings**, **Two-factor authentication**, **Features** (icon `b_tblops`), **SQL queries** (`b_sql`), **Navigation panel** (`b_select`), **Main panel** (`b_props`), **Export** (`b_export`), **Import** (`b_import`). Icons/text follow `TabsMode`. All links have `disableAjax`.
* Below the pills: if `?saved=1` -> success message **"Configuration has been saved."**; if the user-preferences feature is *not* available (`relationParameters->userPreferencesFeature === null`) -> notice **"Your preferences will be saved for current session only. Storing them permanently requires phpMyAdmin configuration storage."** with a link to the `linked-tables` docs.
* While on any preferences page the navigation-panel gear is hidden (`Navigation::$isSettingsEnabled = false`; for Ajax responses the JSON flag `disableNaviSettings: true` is sent).

### The form engine (shared by Settings, page-settings popups and the setup script)

1. A form class (`BaseForm` subclass) returns `getForms(): array<formName, fieldList>`. Field list entries are:
   * `'Path/To/Directive'` - a field (path uses `/` for nesting; `Servers/1/x` is the canonical server path).
   * `':group:' . __('Label')` ... `':group:end'` - a visual group (header row + indented rows; `:group:end` gets a unique suffix).
   * `'Path' => ':group'` - the field itself is a group *header* (a checkbox whose group of dependants follows until `:group:end`).
   * `'Path' => 'value'` - field with a "Set value" pencil that fills the suggested value (used in setup for pmadb table names and `MaxTableUiprefs => 100`).
2. `Form::readTypes()` infers each field's input type: if `ConfigFile::getDbEntry(path)` (i.e. `getAllowedValues()`) has an array -> `select`; a string there (`'integer'`, `'short_string'`, `'array'`) -> that type; otherwise `gettype(default)` (`boolean` -> checkbox, `integer`/`double` -> `<input type=number>`, `string` -> text, `array` -> list textarea). A field with no default and no db entry logs `Field X has no type`.
3. Text fields whose translated id ends in `-password`, `pass` or `Pass` render as `<input type=password>`.
4. Each rendered row (`config/form_display/input.twig`): label (`Descriptions::get(path)`), optional doc icon linking to `config.html#cfg_<path with Servers/1/ -> Servers_ and / -> _>` (not for `Import*`/`Export*` paths), optional description (`_desc`), the input, in setup an optional comment icon (`_cmt`, e.g. *Users cannot set a higher value*), the hidden **Set value** pencil, the hidden **Restore default value** reload icon (`.restore-default`, revealed by JS when value != default, opacity .25 until hover), inline `<dl class="inline_errors">`, and in setup a third column **"Allow users to customize this value"** checkbox (`<path>-userprefs-allow`) which drives `UserprefsDisallow`.
5. A field is rendered with class `custom` when its value differs from the default; in user mode, a field present in `UserprefsDisallow` is rendered with `disabled-field` and a **"Disabled"** badge (title *This setting is disabled, it will not be applied to your configuration.*). Select options whose value is `true`/`false` display as *Yes*/*No*; an empty value displays with label *None*.
6. The whole form (`display.twig`) is one `<form method=post class="config-form disableAjax">` with Bootstrap tabs, one tab per form group; each tab has an **Apply** (`submit_save`) and **Reset** (`submit_reset`, JS resets every field in the fieldset to default) button. Hidden `tab_hash` keeps the active tab across the redirect; hidden `check_page_refresh` lets JS detect browser form-restoration after refresh and re-run validation. `#configInlineParamsData` carries `data-field-validators` and `data-default-values` JSON for the JS layer.
7. POST processing (`FormDisplay::save`): missing non-boolean field -> error *Missing data for <field>*; booleans default to false; `integer`/`boolean` cast with `settype`; `select` validated against the allowed list (type-aware so `0 != 'string'`), error *Incorrect value!*; `array` fields split on newlines, empty lines dropped; `TrustedProxies` lines parsed as `IP: HEADER`, bad lines kept under `-N` keys. Values are written into the session-backed `ConfigFile` through `set()`, which **removes** the key when it equals the default (user mode: only if `config.inc.php` also has the default - so a user can explicitly restore a phpMyAdmin default that the admin changed).
8. Server-side `Validator::validate()` then runs over all registered validators for the form's paths and form names; results are keyed by field (inline) or by form name (shown in the tab's `<dl class="errors">`). In user mode `FormDisplay::process(false)` is used: any error aborts the save and the page re-renders with a red box **"Cannot save settings, submitted form contains errors!"** plus per-field errors; a hidden `revert` POST (`fixErrors()`) resets the erroneous fields to defaults.
9. JS (`config.ts`): registers the same validators client-side (`validatePositiveNumber`, `validateNonNegativeNumber`, `validatePortNumber`, `validateByRegex` (converts the PCRE string), `validateUpperBound`), runs them on `change`, on `keyup` for text inputs, and on page load when the refresh marker is set; marks fields `custom`/`field-error`; implements Restore default / Set value / Reset.

### Validators (complete list, `src/Config/Validator.php`)

| Validator | Signature / rule | Error text |
|---|---|---|
| `validateServer` (form `Server`) | `auth_type` must be set; `config` auth requires `user`; `signon` requires `SignonSession` and `SignonURL`; if `config` auth and no other error, attempts a real `mysqli_connect` to host/port/socket/user/password (skipped when `DBG/demo`). | *Invalid authentication type!*, *Empty username while using [kbd]config[/kbd] authentication method!*, *Empty signon session name while using [kbd]signon[/kbd] authentication method!*, *Empty signon URL while using [kbd]signon[/kbd] authentication method!*, *Could not connect to the database server!* ( + PHP error) |
| `validatePMAStorage` (form `Server_pmadb`) | if `pmadb` non-empty: `controluser` and `controlpass` required, then test connection as control user. | *Empty phpMyAdmin control user while using phpMyAdmin configuration storage!*, *Empty phpMyAdmin control user password while using phpMyAdmin configuration storage!*, connection error |
| `validateRegex` (`Servers/1/hide_db`) | `@preg_match('/' . value . '/', '')` must not raise. | the `preg_match()` message |
| `validateTrustedProxies` (`TrustedProxies`) | each line `^(.+):(?:[ ]?)\w+$`, left side valid IPv4/IPv6. | *Incorrect value: <line>*, *Incorrect IP address: <ip>* |
| `validatePortNumber` (`Servers/1/port`) | integer 1..65535 (empty allowed). | *Not a valid port number!* |
| `validatePositiveNumber` | integer > 0 (empty allowed). | *Not a positive number!* |
| `validateNonNegativeNumber` | integer >= 0. | *Not a non-negative number!* |
| `validateByRegex(regex)` | `preg_match(regex, value) === 1`. | *Incorrect value!* |
| `validateUpperBound(max)` | value <= max; `_userValidators` substitute `value:<path>` with the **config.inc.php** value, so users cannot raise `MaxDbList`, `MaxTableList`, `MaxRoutineList`, `QueryHistoryMax` above the admin's value. | *Value must be less than or equal to %s!* |

Assignments (`ConfigFile::getAllowedValues()['_validators']`): `Console/Height` non-negative; `CharTextareaCols`, `CharTextareaRows`, `Export/sql_max_query_size`, `FirstLevelNavigationItems`, `ForeignKeyMaxLimit`, `InsertRows`, `LimitChars`, `LoginCookieValidity`, `MaxDbList`, `MaxNavigationItems`, `MaxCharactersInDisplayedSQL`, `MaxRows`, `MaxSizeForInputField`, `MaxTableList`, `MaxRoutineList`, `NavigationTreeDisplayItemFilterMinimum`, `NavigationTreeTableLevel`, `QueryHistoryMax`, `TextareaCols`, `TextareaRows` positive; `ExecTimeLimit`, `Import/skip_queries`, `NumRecentTables`, `NumFavoriteTables`, `LoginCookieStore`, `MinSizeForInputField`, `NavigationWidth`, `RepeatCells` non-negative; `Import/csv_enclosed`, `Import/ldi_enclosed` regex `/^.?$/`; `Import/csv_escaped`, `csv_terminated`, `ldi_escaped`, `ldi_terminated` regex `/^.$/`; `MemoryLimit` regex `/^(-1|(\d+(?:[kmg])?))$/i`; `Server` -> validateServer; `Server_pmadb` -> validatePMAStorage; `Servers/1/port` -> validatePortNumber; `Servers/1/hide_db` -> validateRegex; `TrustedProxies` -> validateTrustedProxies. `_userValidators` (only outside setup): `MaxDbList`, `MaxTableList`, `MaxRoutineList`, `QueryHistoryMax` -> `validateUpperBound value:<same>`.

Extra per-field comments (`FormDisplay::setComments`): `RecodingEngine` marks `iconv (unavailable)` if the extension is missing; `ZipDump`/`GZipDump`/`BZipDump` warn *Compressed import will not work due to missing function %s.* / *Compressed export will not work due to missing function %s.* (`zip_open`/`gzcompress`, `gzopen`/`gzencode`, `bzopen`/`bzcompress`); in user mode `MaxDbList`, `MaxTableList`, `QueryHistoryMax` show *maximum %s* with the admin's value.

### Tab: Manage your settings (`/preferences/manage`, `preferences/manage/main.twig`)

Two columns:

**Import** card (form `prefs_import`, multipart):
* radio **Import from file** (`import_type=text_file`, default) -> file input *Browse your computer:* (`import_file`; max upload size passed as `max_upload_size`).
* radio **Import from browser's storage** (`import_type=local_storage`; disabled until JS enables it) -> text *Settings will be imported from your browser's local storage.*, then either *Saved on: <date>* (`localStorage.configMtimeLocal`) or notice *You have no saved settings!*; if localStorage unsupported: *This feature is not supported by your web browser*.
* checkbox **Merge with current configuration** (`import_merge`).
* **Go** (`submit_import`).
* Processing (`ManageController`): JSON comes from the uploaded file (`File::checkUploadedFile`) or from the hidden `json` field (filled by JS from `localStorage.config`). Sets `$_SESSION['userprefs_autoload']=true` (hides the autoload banner). Non-array JSON -> *Could not import configuration*. Otherwise: start from flat defaults (`getFlatDefaultConfig()`), optionally merge the current prefs (`import_merge`), overlay the imported keys, push everything into `$_POST` (`/` -> `-`), run `UserFormList::process(true,false)` so every value is sanitised exactly like a form submit. On validation errors it renders `manage/error.twig`: *Configuration contains incorrect data for some fields.*, the error list, and *Do you want to import remaining settings?* with **Yes** (`submit_import` + `fix_errors=1`, which calls `fixErrors()` and continues) / **No**. On success: if `ThemeDefault` present and valid -> activate theme + cookie; if `lang` differs -> redirect with `lang=`; save; redirect to `return_url` (minus `token`) or `/preferences/manage` with `saved=1`.

**"More settings"** card (only when `setup/index.php` exists and `config.inc.php` does not): *You can set more settings by modifying config.inc.php, eg. by using Setup script.* + doc link.

**Export** card (form `prefs_export`):
* radio **Save as JSON file** (`export_type=text_file`, default), **Save as PHP file** (`php_file`), **Save to browser's storage** (`local_storage`, JS-enabled) with text *Settings will be saved in your browser's local storage.* and bold *Existing settings will be overwritten!* when something is already stored.
* **Go** (`submit_export`). JSON/PHP are server downloads (formats above). Browser storage is done by JS: POST `submit_get_json` -> `{prefs, mtime}`; JS writes `localStorage.config`, `configMtime`, `configMtimeLocal`, hides the form and shows *Configuration has been saved.* (click to show the form again).

**Reset** card (form `prefs_reset`): *You can reset all your settings and restore them to default values.* + **Reset** (`submit_clear`) -> `UserPreferences::save([])`, deletes cookie `pma_lang`, redirects with `saved=1`.

**Autoload banner** (`preferences/autoload.twig`, injected by `Header.php` when `storageType === 'session'` and `$_SESSION['userprefs_autoload']` is not set, shown by JS only if `localStorage.config` exists): *Your browser has phpMyAdmin configuration for this domain. Would you like to import it for current session?* with **Yes** (submits hidden form `submit_import` + `json` + `return_url` to `/preferences/manage`), **No** (POST `prefs_autoload=hide` to `index.php` -> sets `$_SESSION['userprefs_autoload']=true`), **Delete settings** (`localStorage.clear()` + hide).

### Tabs backed by forms (Features, SQL queries, Navigation panel, Main panel, Export, Import)

Each controller: builds `ConfigFile(baseSettings)`, `UserPreferences::pageInit()` (reset, allow only `UserFormList::getFields()`, map `Server/hide_db`<->`Servers/1/hide_db`, `Server/only_db`<->`Servers/1/only_db`, load current `$cfg`), instantiates the form with server id 1, handles `revert`, and on valid `submit_save`: loads `TwoFactor` for the current user, `UserPreferences::save(getConfigArray())`, `TwoFactor::save()` (re-persists the `2fa` key so a form save never drops it), reloads prefs, redirects to the same route with `saved=1#<tab_hash>`.

Field labels below are `Descriptions::get(path)`; group labels are `Form_<name>_name` / `_desc`.

#### Features (`FeaturesForm`)

| Tab (group) | Description | Fields (label -> directive) |
|---|---|---|
| General | *Set some commonly used options.* | Version check -> `VersionCheck`; Natural order -> `NaturalOrder`; Initial state for sliders -> `InitialSlidersState` (Open/Closed/Disabled); Login cookie validity -> `LoginCookieValidity`; Skip locked tables -> `SkipLockedTables`; Disable multi table maintenance -> `DisableMultiTableMaintenance`; Show hint -> `ShowHint`; Send error reports -> `SendErrorReports` (Ask before sending error reports / Always send error reports / Never send error reports); Enter executes queries in console -> `ConsoleEnterExecutes`; Disable shortcut keys -> `DisableShortcutKeys`; First day of calendar -> `FirstDayOfCalendar` (Monday..Sunday) |
| Databases | | Show only listed databases -> `Servers/1/only_db` (list textarea; MySQL wildcards note); Hide databases -> `Servers/1/hide_db` (PCRE); Maximum databases -> `MaxDbList` (comment *maximum N*); Maximum tables -> `MaxTableList`; Server connection collation -> `DefaultConnectionCollation` |
| Text fields | *Customize text input fields.* | CHAR columns editing -> `CharEditing` (input/textarea); Minimum size for input field -> `MinSizeForInputField`; Maximum size for input field -> `MaxSizeForInputField`; CHAR textarea columns -> `CharTextareaCols`; CHAR textarea rows -> `CharTextareaRows`; Textarea columns -> `TextareaCols`; Textarea rows -> `TextareaRows`; Bigger textarea for LONGTEXT -> `LongtextDoubleTextarea` |
| Page titles | *Specify browser's title bar text. Refer to documentation for magic strings...* | Default title -> `TitleDefault`; Table -> `TitleTable`; Database -> `TitleDatabase`; Server -> `TitleServer` |
| Warnings | *Disable some of the warnings shown by phpMyAdmin.* | Missing phpMyAdmin configuration storage tables -> `PmaNoRelation_DisableWarning`; Login cookie validity warning -> `LoginCookieValidityDisableWarning`; MySQL reserved word warning -> `ReservedWordDisableWarning` |
| Console | | Console mode -> `Console/Mode` (info/show/collapse); Show query history at start -> `Console/StartHistory`; Always expand query messages -> `Console/AlwaysExpand`; Show current browsing query -> `Console/CurrentQuery`; Execute queries on Enter and insert new line with Shift+Enter -> `Console/EnterExecutes`; Switch to dark theme -> `Console/DarkTheme`; Console height -> `Console/Height`; Group queries -> `Console/GroupQueries`; Order by -> `Console/OrderBy` (exec/time/count); Order -> `Console/Order` (asc/desc) |
| Developer (only when `$cfg['UserprefsDeveloperTab']`) | *Settings for phpMyAdmin developers.* | Debug SQL -> `DBG/sql` |

#### SQL queries (`SqlForm`)

| Tab | Fields |
|---|---|
| SQL queries (*SQL queries settings.*) | Show SQL queries -> `ShowSQL`; Confirm DROP queries -> `Confirm`; Query history length -> `QueryHistoryMax` (comment *maximum N*); Ignore multiple statement errors -> `IgnoreMultiSubmitErrors`; Maximum displayed SQL length -> `MaxCharactersInDisplayedSQL`; Retain query box -> `RetainQueryBox`; Enable CodeMirror -> `CodemirrorEnable`; Enable linter -> `LintEnable`; Enable autocomplete for table and column names -> `EnableAutocompleteForTablesAndColumns`; Foreign key checks -> `DefaultForeignKeyChecks` (Server default/Enable/Disable) |
| SQL Query box (*Customize links shown in SQL Query boxes.*) | Edit -> `SQLQuery/Edit`; Explain SQL -> `SQLQuery/Explain`; Create PHP code -> `SQLQuery/ShowAsPHP`; Refresh -> `SQLQuery/Refresh` |

#### Navigation panel (`NaviForm`)

| Tab | Fields |
|---|---|
| Navigation panel (*Customize appearance of the navigation panel.*) | Show databases navigation as tree -> `ShowDatabasesNavigationAsTree`; Link with main panel -> `NavigationLinkWithMainPanel`; Display logo -> `NavigationDisplayLogo`; Logo link URL -> `NavigationLogoLink`; Logo link target -> `NavigationLogoLinkWindow` (main/new); Enable highlighting -> `NavigationTreePointerEnable`; Maximum items on first level -> `FirstLevelNavigationItems`; Minimum number of items to display the filter box -> `NavigationTreeDisplayItemFilterMinimum`; Recently used tables -> `NumRecentTables`; Favorite tables -> `NumFavoriteTables`; Navigation panel width -> `NavigationWidth` |
| Navigation tree (*Customize the navigation tree.*) | Maximum items in branch -> `MaxNavigationItems`; Group items in the tree -> `NavigationTreeEnableGrouping`; Enable navigation tree expansion -> `NavigationTreeEnableExpansion`; Show tables in tree -> `NavigationTreeShowTables`; Show views in tree -> `NavigationTreeShowViews`; Show functions in tree -> `NavigationTreeShowFunctions`; Show procedures in tree -> `NavigationTreeShowProcedures`; Show events in tree -> `NavigationTreeShowEvents`; Expand single database -> `NavigationTreeAutoexpandSingleDb` |
| Servers (*Servers display options.*) | Display servers selection -> `NavigationDisplayServers`; Display servers as a list -> `DisplayServersList` |
| Databases (*Databases display options.*) | Minimum number of databases to display the database filter box -> `NavigationTreeDisplayDbFilterMinimum`; Database tree separator -> `NavigationTreeDbSeparator` |
| Tables (*Tables display options.*) | Target for quick access icon -> `NavigationTreeDefaultTabTable` (Structure/SQL/Search/Insert/Browse); Target for second quick access icon -> `NavigationTreeDefaultTabTable2` (same + none); Table tree separator -> `NavigationTreeTableSeparator`; Maximum table tree depth -> `NavigationTreeTableLevel` |

#### Main panel (`MainForm`)

| Tab | Fields |
|---|---|
| Startup (*Customize startup page.*) | Show create database form -> `ShowCreateDb`; Show statistics -> `ShowStats`; Show detailed MySQL server information -> `ShowServerInfo` (setup adds Show phpinfo() link -> `ShowPhpInfo`, Show password change form -> `ShowChgPassword`) |
| Database structure (*Choose which details to show in the database structure (list of tables).*) | Show table charset -> `ShowDbStructureCharset`; Show table comments -> `ShowDbStructureComment`; Show creation timestamp -> `ShowDbStructureCreation`; Show last update timestamp -> `ShowDbStructureLastUpdate`; Show last check timestamp -> `ShowDbStructureLastCheck` |
| Table structure (*Settings for the table structure (list of columns).*) | Hide table structure actions -> `HideStructureActions`; Show column comments -> `ShowColumnComments`; group *Default transformations*: Default transformations for Hex/Substring/Bool2Text/External/PreApPend/DateFormat/Inline/TextImageLink/TextLink -> `DefaultTransformations/<name>` (list textareas) |
| Browse mode (*Customize browse mode.*) | Table navigation bar -> `TableNavigationLinksMode`; How to display various action links -> `ActionLinksMode`; Allow to display all the rows -> `ShowAll`; Maximum number of rows to display -> `MaxRows` (25/50/100/250/500); Default sorting order -> `Order`; Highlight pointer -> `BrowsePointerEnable`; Row marker -> `BrowseMarkerEnable`; Grid editing: trigger action -> `GridEditing`; Grid editing: save all edited cells at once -> `SaveCellsAtOnce`; Repeat headers -> `RepeatCells`; Limit column characters -> `LimitChars`; Where to show the table row links -> `RowActionLinks` (Nowhere/Left/Right/Both); Show row links anyway -> `RowActionLinksWithoutUnique`; Primary key default sort order -> `TablePrimaryKeyOrder` (None/Ascending/Descending); Remember table's sorting -> `RememberSorting`; Relational display -> `RelationalDisplay` (key/display column) |
| Edit mode (*Customize edit mode.*) | Protect binary columns -> `ProtectBinary` (No/blob/noblob/all); Show function fields -> `ShowFunctionFields`; Show field types -> `ShowFieldTypesInDataEditView`; Number of inserted rows -> `InsertRows`; Foreign key dropdown order -> `ForeignKeyDropdownOrder` (list); Foreign key limit -> `ForeignKeyMaxLimit` |
| Tabs (*Choose how you want tabs to work.*) | How to display the menu tabs -> `TabsMode`; Default server tab -> `DefaultTabServer` (Welcome/Databases/Status/Variables/Privileges); Default database tab -> `DefaultTabDatabase` (Structure/SQL/Search/Operations); Default table tab -> `DefaultTabTable` (Structure/SQL/Search/Insert/Browse) |
| Display relational schema | Paper size -> `PDFDefaultPageSize` (A3/A4/A5/letter/legal) |

#### Export (`ExportForm`)

| Tab | Fields |
|---|---|
| Export defaults (*Customize default export options.*) | Export method -> `Export/method`; group *Quick*: Save on server -> `Export/quick_export_onserver`, Overwrite existing file(s) -> `Export/quick_export_onserver_overwrite`; group *Custom*: Format -> `Export/format`, Compression -> `Export/compression`, Character set of the file -> `Export/charset`, Use LOCK TABLES statement -> `Export/lock_tables`, Export as separate files -> `Export/as_separate_files`, Save as file (group header) -> `Export/asfile` with Save on server -> `Export/onserver`, Overwrite existing file(s) -> `Export/onserver_overwrite`; Table name template -> `Export/file_template_table`; Database name template -> `Export/file_template_database`; Server name template -> `Export/file_template_server` |
| SQL (*Customize default options.*) | Comments (group header) -> `Export/sql_include_comments` with Creation/Update/Check dates -> `sql_dates`, Relationships -> `sql_relation`, Media type -> `sql_mime`; Enclose export in a transaction -> `sql_use_transaction`; Disable foreign key checks -> `sql_disable_fk`; Export views as tables -> `sql_views_as_tables`; Export related metadata from phpMyAdmin configuration storage -> `sql_metadata`; SQL compatibility mode -> `sql_compatibility`; Dump table -> `sql_structure_or_data`; group *Structure*: Add DROP DATABASE -> `sql_drop_database`, Add CREATE DATABASE / USE -> `sql_create_database`, Add DROP TABLE / VIEW / PROCEDURE / FUNCTION / EVENT / TRIGGER -> `sql_drop_table`, Add CREATE TABLE (header) -> `sql_create_table` with Add IF NOT EXISTS -> `sql_if_not_exists`, Add AUTO_INCREMENT value -> `sql_auto_increment`; Add CREATE VIEW (header) -> `sql_create_view` with Exclude definition of current user -> `sql_view_current_user`, OR REPLACE view -> `sql_or_replace_view`; Add CREATE PROCEDURE / FUNCTION / EVENT -> `sql_procedure_function`; Add CREATE TRIGGER -> `sql_create_trigger`; Enclose table and column names with backquotes -> `sql_backquotes`; group *Data*: Use delayed inserts -> `sql_delayed`, Use ignore inserts -> `sql_ignore`, Export type -> `sql_type`, Syntax to use when inserting data -> `sql_insert_syntax`, Maximal length of created query -> `sql_max_query_size`, Use hexadecimal for BINARY & BLOB -> `sql_hex_for_binary`, Export time in UTC -> `sql_utc_time` |
| CodeGen | Format -> `Export/codegen_format` (NHibernate C# DO / NHibernate XML) |
| CSV | group *CSV*: Columns terminated with -> `csv_separator`, Columns enclosed with -> `csv_enclosed`, Columns escaped with -> `csv_escaped`, Lines terminated with -> `csv_terminated`, Replace NULL with -> `csv_null`, Remove CRLF characters within columns -> `csv_removeCRLF`, Put columns names in the first row -> `csv_columns`; group *CSV for MS Excel*: Replace NULL with -> `excel_null`, Remove CRLF... -> `excel_removeCRLF`, Put columns names... -> `excel_columns`, Excel edition -> `excel_edition` |
| LaTeX | Include table caption -> `latex_caption`; Dump table -> `latex_structure_or_data`; group *Structure*: Table caption -> `latex_structure_caption`, Continued table caption -> `latex_structure_continued_caption`, Label key -> `latex_structure_label`, Relationships -> `latex_relation`, Comments -> `latex_comments`, Media type -> `latex_mime`; group *Data*: Put columns names in the first row -> `latex_columns`, Table caption -> `latex_data_caption`, Continued table caption -> `latex_data_continued_caption`, Label key -> `latex_data_label`, Replace NULL with -> `latex_null` |
| Microsoft Office | group *Microsoft Word 2000*: Dump table -> `htmlword_structure_or_data`, Replace NULL with -> `htmlword_null`, Put columns names in the first row -> `htmlword_columns` |
| OpenDocument | group *OpenDocument Spreadsheet*: Put columns names... -> `ods_columns`, Replace NULL with -> `ods_null`; group *OpenDocument Text*: Dump table -> `odt_structure_or_data`, group *Structure*: Relationships -> `odt_relation`, Comments -> `odt_comments`, Media type -> `odt_mime`; group *Data*: Put columns names... -> `odt_columns`, Replace NULL with -> `odt_null` |
| Texy! text | Dump table -> `texytext_structure_or_data`; group *Data*: Replace NULL with -> `texytext_null`, Put columns names... -> `texytext_columns` |

#### Import (`ImportForm`)

| Tab | Fields |
|---|---|
| Import defaults (*Customize default common import options.*) | Format of imported file -> `Import/format`; Character set of the file -> `Import/charset`; Partial import: allow interrupt -> `Import/allow_interrupt`; Partial import: skip queries -> `Import/skip_queries`; Enable drag and drop import -> `enable_drag_drop_import` |
| SQL | SQL compatibility mode -> `Import/sql_compatibility`; Do not use AUTO_INCREMENT for zero values -> `Import/sql_no_auto_value_on_zero`; Read as multibytes -> `Import/sql_read_as_multibytes` |
| CSV | group *CSV*: Add ON DUPLICATE KEY UPDATE -> `csv_replace`, Do not abort on INSERT error -> `csv_ignore`, Import empty values as NULL -> `csv_empty_as_null`, Columns terminated with -> `csv_terminated`, Columns enclosed with -> `csv_enclosed`, Columns escaped with -> `csv_escaped`, Lines terminated with (sic; label of `csv_col_names`) -> `csv_col_names`; group *CSV using LOAD DATA*: Add ON DUPLICATE KEY UPDATE -> `ldi_replace`, Do not abort on INSERT error -> `ldi_ignore`, Columns terminated with -> `ldi_terminated`, Columns enclosed with -> `ldi_enclosed`, Columns escaped with -> `ldi_escaped`, Use LOCAL keyword -> `ldi_local_option` (auto/Yes/No) |
| OpenDocument | group *OpenDocument Spreadsheet*: Column names in first row -> `ods_col_names`, Do not import empty rows -> `ods_empty_rows`, Import percentages as proper decimals (12.00% to .12) -> `ods_recognize_percentages`, Import currencies ($5.00 to 5.00) -> `ods_recognize_currency` |

### Storage of user preferences (`UserPreferences`, `UserPreferencesHandler`)

* `load()` -> `{config_data, mtime, type}`; `type` is `'db'` when `userPreferencesFeature` exists, else `'session'` (`$_SESSION['userconfig'] = {db:[], ts:int}`). DB read: `SELECT config_data, UNIX_TIMESTAMP(timevalue) FROM pmadb.userconfig WHERE username = <selectedServer user>` through the **control** connection; `config_data` is JSON.
* `save(array)` -> smart-merge: if the array lacks `2fa` but stored prefs have it, copy it over (protects 2FA from page-settings partial saves). DB write: `UPDATE ... SET timevalue = NOW(), config_data = json` or `INSERT`. Failure -> `Message::error('Could not save configuration')` + MySQL error + (if the control user cannot see the db) *The phpMyAdmin configuration storage database could not be accessed.* Cache `$_SESSION['cache']['server_N']['userprefs']` is invalidated.
* `apply(config_data)` filters to `UserFormList::getFields()` plus special keys `ThemeDefault`, `lang`, `Server/hide_db`, `Server/only_db`, `2fa`, minus `UserprefsDisallow`, expanding `a/b` paths into a nested array.
* `UserPreferencesHandler::loadUserPreferences()` runs on every request (when a server is selected): caches prefs per server keyed by `config.inc.php` mtime, applies `Server/*` to `selectedServer`, `array_replace_recursive` into `$cfg`, rebuilds `Settings`. Then theme (`set_theme` request or theme cookie -> persist `ThemeDefault` pref with default `'original'`; else activate pref's theme and set cookie), language (`pma_lang` cookie / `lang` POST -> persist `lang` pref with default `'en'`; else activate pref language), and `DefaultConnectionCollation`.
* `setUserValue(path, value, default, cookieName)` is the single-setting API used by UI toggles (console settings, theme, lang, `NavigationWidth` resize, `RememberSorting`...): writes the pref when any storage exists (db or session); falls back to a cookie when storage is not `db` and a cookie name is given. `persistOption` deletes the key when `value === default`.
* `getUrlToRedirect(file, params, hash)` appends `saved=1` (used for the *Configuration has been saved.* banner).

---

## Page settings forms matrix

`PageSettings::init($formGroupName, $elemId = 'page_settings_modal')` embeds a hidden form (`<div id="page_settings_modal"><div class="page_settings">...</div></div>`) built from `PageFormList::get(name)` and processes `submit_save=<name>` POSTs with `FormDisplay::process(false)`; a successful save calls `UserPreferences::save()` then **redirects to the same URL** (so the page re-renders with the new settings). Errors render *Cannot save settings, submitted configuration form contains errors!* above the page. Nothing is rendered in print view (`printview=1`). JS (`page_settings.ts`): the gear icon `#page_settings_icon` is shown only when `#page_settings_modal` exists; clicking opens a Bootstrap modal titled **Page-related settings** with **Apply** (submits `.config-form`) and **Cancel** (restores a clone of the form). The navigation panel has its own gear `#pma_navigation_settings_icon` opening `#pma_navigation_settings` (hidden when `Navigation::$isSettingsEnabled` is false).

| Page (controller) | Form group | Fields shown (same labels/validators as the Settings tabs) |
|---|---|---|
| Navigation panel (every page via `Navigation::getDisplay`, and `/navigation` Ajax) | `Navi` (full `NaviForm`: Navigation panel, Navigation tree, Servers, Databases, Tables tabs) | all 29 navigation directives |
| Browse / any SQL result (`Sql/SqlController`) | `Browse` | `MainForm` *Browse mode* group: `TableNavigationLinksMode`, `ActionLinksMode`, `ShowAll`, `MaxRows`, `Order`, `BrowsePointerEnable`, `BrowseMarkerEnable`, `GridEditing`, `SaveCellsAtOnce`, `RepeatCells`, `LimitChars`, `RowActionLinks`, `RowActionLinksWithoutUnique`, `TablePrimaryKeyOrder`, `RememberSorting`, `RelationalDisplay` |
| Database structure (`Database/StructureController`) | `DbStructure` | `ShowDbStructureCharset`, `ShowDbStructureComment`, `ShowDbStructureCreation`, `ShowDbStructureLastUpdate`, `ShowDbStructureLastCheck` |
| Table structure (`Table/StructureController`, `Table/Structure/PartitioningController`) | `TableStructure` | `HideStructureActions`, `ShowColumnComments`, `DefaultTransformations/*` (9 lists) |
| Insert / edit row (`Table/ChangeController`) | `Edit` | *Edit mode*: `ProtectBinary`, `ShowFunctionFields`, `ShowFieldTypesInDataEditView`, `InsertRows`, `ForeignKeyDropdownOrder`, `ForeignKeyMaxLimit`; plus *Text fields*: `CharEditing`, `MinSizeForInputField`, `MaxSizeForInputField`, `CharTextareaCols`, `CharTextareaRows`, `TextareaCols`, `TextareaRows`, `LongtextDoubleTextarea` |
| SQL tab (server / database / table `SqlController`) | `Sql` | full `SqlForm` (SQL queries + SQL Query box tabs) |
| Export (server / database / table `ExportController`) | `Export` | full `ExportForm` (all export tabs) |
| Import (server / database / table `ImportController`) | `Import` | full `ImportForm` |

Not offered: a page-settings popup for Features (General/Databases/Page titles/Warnings/Console) or for Main panel Startup/Tabs - those exist only in the Settings pages.

---

## Two-factor authentication

Storage: the `2fa` key inside the user's preferences JSON: `{"backend": "<id>", "settings": {...}}`. `TwoFactor::isWritable()` is true only when preferences are stored in **pmadb** (`type === 'db'`); with session storage the tab says *Two-factor authentication is not available, enable phpMyAdmin configuration storage to use it.* and nothing can be configured.

Backends (`TwoFactor::getAvailableBackends()`, in display order):

| id | Class | Name / description | Availability | `settings` payload |
|---|---|---|---|---|
| `''` | `TwoFactorPlugin` | *No Two-Factor Authentication* - *Login using password only.* | always (default radio) | `[]` |
| `simple` | `Simple` | *Simple two-factor authentication* - *For testing purposes only!* | only when `$cfg['DBG']['simple2fa']` | none; login form posts hidden `2fa_confirm=1` |
| `application` | `Application` | *Authentication Application (2FA)* - *Provides authentication using HOTP and TOTP applications such as FreeOTP, Google Authenticator or Authy.* | `pragmarx/google2fa-qrcode` + `bacon/bacon-qr-code` + (`XMLWriter` or imagick) | `{secret: <base32>}`; TOTP verification window 8 |
| `WebAuthn` | `WebAuthn` | *Hardware Security Key (WebAuthn/FIDO2)* - *Provides authentication using hardware security tokens supporting the WebAuthn/FIDO2 protocol, such as a YubiKey.* | always (uses `web-auth/webauthn-lib` if installed, else a built-in `CustomServer`) | `{userHandle: base64, credentials: {<base64 id>: {publicKeyCredentialId, type, userHandle, ...}}}` |
| `key` | `Key` | *Hardware Security Key (FIDO U2F)* - deprecated banner *The FIDO U2F API has been deprecated in favor of the Web Authentication API (WebAuthn).* | `code-lts/u2f-php-server` | `{registrations: [{keyHandle, publicKey, certificate, counter}]}` |
| `invalid` | `Invalid` | *Invalid two-factor authentication* | fallback when the stored backend id is unavailable | login shows *The configured two factor authentication is not available, please install missing dependencies.* and never passes |

`getMissingDeps()` lists `pragmarx/google2fa-qrcode`, `bacon/bacon-qr-code` (for Application) and `code-lts/u2f-php-server` (for Key) when absent.

Tab `/preferences/two-factor` (`two_factor/main.twig`):
* Card **Two-factor authentication status** (+ doc link): if not writable -> the "enable configuration storage" sentence; if no backend besides none -> *Two-factor authentication is not available, please install optional dependencies to enable authentication backends.* + *Following composer packages are missing:* list; else *Two-factor authentication is available and configured for this account.* or *... available, but not configured for this account.* plus the optional missing-deps hint *Please install optional dependencies to enable more authentication backends.*
* If a backend is configured: card titled with the backend name, *You have enabled two factor authentication.*, its description, the U2F deprecation alert for `key`, and **Disable two-factor authentication** (`2fa_remove=1`). Removal requires re-verification: `TwoFactor::check($request, skipSession=true)` must pass, otherwise `confirm.twig` renders *Confirm disabling two-factor authentication* with notice *By disabling two factor authentication you will be again able to login using password only.*, the backend's challenge form, and the **Disable two-factor authentication** button. Success -> `configure('')` and notice *Two-factor authentication has been removed.*
* If not configured: card **Configure two-factor authentication** with one radio per backend (`2fa_configure=<id>`, none checked by default) and button **Configure two-factor authentication**. Posting with a non-empty id runs `configure()`: the backend's `configure()` returns false on the first pass (nothing submitted yet) so `configure.twig` renders **Configure two-factor authentication** with the backend `setup()` form and **Enable two-factor authentication** button (hidden `2fa_configure` keeps the id). Second POST verifies and saves; notice *Two-factor authentication has been configured.*
  * Application setup: *Please scan following QR code into the two-factor authentication app on your device and enter authentication code it generates.*, inline QR (`<img>` when imagick, else inline SVG), *Secret/key:* `<secret>`, input *Authentication code:* (`2fa_code`). The secret is generated once per session (`$_SESSION['2fa_application_key']`) so a wrong code keeps the same QR; label `phpMyAdmin (<host>)`, account = MySQL user.
  * WebAuthn setup: *Please connect your WebAuthn/FIDO2 device. Then confirm registration on the device.* with hidden `webauthn_creation_response` carrying `data-creation-options` (challenge stored in `$_SESSION['WebAuthnCredentialCreationOptions']`), script `webauthn.js`. User id = 32 random bytes; rp id = request host.
  * U2F setup: HTTPS warning *You are not using https to access phpMyAdmin, therefore FIDO U2F device will most likely refuse to authenticate you.* when not HTTPS, deprecation alert, *Please connect your FIDO U2F device into your computer's USB port. Then confirm registration on the device.*, hidden `u2f_registration_response` with `data-request`/`data-signatures`; AppID = `PmaAbsoluteUri` or scheme://host[:port].

Login flow (`Authentication` middleware -> `AuthenticationPlugin::checkTwoFactor`): after password auth succeeds, `TwoFactor::check()` is consulted; result cached in `$_SESSION['two_factor_check']`. If false, the login page is shown with notice *You have enabled two factor authentication, please confirm your login.* and the backend's `render()` form (`login/twofactor.twig`; submit button hidden for `Invalid`). Application: input *Authentication code:* with hint *Open the two-factor authentication app on your device to view your authentication code and verify your identity.* WebAuthn: *Please connect your WebAuthn/FIDO2 device. Then confirm login on the device.* (`webauthn_request_response`). Key: *Please connect your FIDO U2F device into your computer's USB port. Then confirm login on the device.* (`u2f_authentication_response`). Failed attempts show *Two-factor authentication failed.* or *Two-factor authentication failed: <reason>*. WebAuthn/U2F success also re-saves settings (sign counter update).

---

## Configuration storage (pmadb): per-table DDL + semantics + which features it gates

`resources/sql/create_tables.sql` creates database `phpmyadmin` (`DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`) and 19 tables, all `utf8mb4_bin` unless a column says otherwise. The optional grant is `GRANT SELECT, INSERT, DELETE, UPDATE, ALTER ON phpmyadmin.* TO 'pma'@localhost` (ALTER is needed only for the automatic `column_info` upgrade). Upgrade scripts: `upgrade_tables_mysql_4_1_2+.sql` (convert pre-4.1 tables to utf8/utf8_bin), `upgrade_column_info_4_3_0+.sql` (rename transformation plugin files `__`->`_`, `inc.php`->`class.php`, prefix `output/`, `octet-stream`->`octetstream`, add `input_transformation` + `input_transformation_options`), `upgrade_tables_4_7_0+.sql` (`pma__bookmark.id` -> `int(10) unsigned`).

Every table below is accessed exclusively through the **control connection** (`ConnectionType::ControlUser`) and is enabled only when (a) `Servers[$i][<directive>]` is a non-empty string, (b) the table exists in `pmadb` (`SHOW TABLES` match by exact name), and (c) `SELECT NULL FROM <table> LIMIT 0` succeeds for the control user (`Relation::canAccessStorageTable`).

### pma__bookmark - directive `bookmarktable` - flag `bookmarkwork` - `BookmarkFeature`

```sql
CREATE TABLE IF NOT EXISTS `pma__bookmark` (
  `id` int(10) unsigned NOT NULL auto_increment,
  `dbase` varchar(255) NOT NULL default '',
  `user` varchar(255) NOT NULL default '',
  `label` varchar(255) COLLATE utf8mb4_general_ci NOT NULL default '',
  `query` text NOT NULL,
  PRIMARY KEY  (`id`)
) COMMENT='Bookmarks' DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
```
`dbase` = database the bookmark belongs to; `user` = MySQL user (`''` = shared bookmark, allowed only when `AllowSharedBookmarks`); `label` = name (case-insensitive collation); `query` = SQL, may contain `/*[VARIABLE1]*/` placeholders. Features: SQL page bookmark box, "Bookmark this SQL query", bookmarks list on DB SQL tab, console bookmarks, `executing bookmark by label` from the browse URL (`bookmark_id`/`label`), export "SQL bookmarks" in metadata export.

### pma__column_info - directive `column_info` - flags `commwork` (ColumnCommentsFeature) + `mimework` (BrowserTransformationFeature)

```sql
CREATE TABLE IF NOT EXISTS `pma__column_info` (
  `id` int(5) unsigned NOT NULL auto_increment,
  `db_name` varchar(64) NOT NULL default '',
  `table_name` varchar(64) NOT NULL default '',
  `column_name` varchar(64) NOT NULL default '',
  `comment` varchar(255) COLLATE utf8mb4_general_ci NOT NULL default '',
  `mimetype` varchar(255) COLLATE utf8mb4_general_ci NOT NULL default '',
  `transformation` varchar(255) NOT NULL default '',
  `transformation_options` varchar(255) NOT NULL default '',
  `input_transformation` varchar(255) NOT NULL default '',
  `input_transformation_options` varchar(255) NOT NULL default '',
  PRIMARY KEY  (`id`),
  UNIQUE KEY `db_name` (`db_name`,`table_name`,`column_name`)
) COMMENT='Column information for phpMyAdmin' ...;
```
* `comment`: historically column comments; today native column comments are used for columns and this field is used for the **database comment** stored in the row `(db_name, table_name='', column_name='(db_comment)')` (`Relation::getDbComment/setDbComment`, shown/edited on DB Operations). `commwork` is set as soon as the table is accessible.
* `mimetype` (e.g. `image/jpeg`, `text/plain`), `transformation` (plugin file name relative to `src/Plugins/Transformations/`, e.g. `output/Text_Plain_Dateformat.php`), `transformation_options` (the comma separated options string), `input_transformation` / `input_transformation_options` (same for input plugins such as `Input/Text_Plain_FileUpload.php`). `Transformations::getMime()` returns all rows of a table with any non-empty MIME column; `setMime()` upserts; `clear()` deletes per db/table/column. `mimework` is true only when the two `input_transformation*` columns exist (`tryUpgradeTransformations` runs the 4.3 upgrade script silently; failure -> `mimework=false` and the check page says *Please see the documentation on how to update your column_info table.*). Features: browser transformations in browse view (`BrowseMIME`), input transformations in insert/edit, "Media type"/"Browser display transformation"/"Input transformation" fields in Structure > Change column, export of MIME info in SQL/LaTeX/ODT comments, metadata export.

### pma__history - `history` - `historywork` - `SqlHistoryFeature`

```sql
CREATE TABLE IF NOT EXISTS `pma__history` (
  `id` bigint(20) unsigned NOT NULL auto_increment,
  `username` varchar(64) NOT NULL default '',
  `db` varchar(64) NOT NULL default '',
  `table` varchar(64) NOT NULL default '',
  `timevalue` timestamp NOT NULL default CURRENT_TIMESTAMP,
  `sqlquery` text NOT NULL,
  PRIMARY KEY  (`id`),
  KEY `username` (`username`,`db`,`table`,`timevalue`)
) COMMENT='SQL history for phpMyAdmin' ...;
```
Written by `Console\History::setHistory()`, called by the `StatementHistory` middleware after every request with a non-empty `Current::$sqlQuery` and no `no_history` parameter. For the SQL box that is the **last statement the import loop ran** as split (trimmed, `;` appended: `SELECT * FROM t;`, the failing one when an error stopped the run) with `Current::$database` / `Current::$table` as `ParseAnalyze` left them (the posted table, replaced by each statement's own table). Statements longer than `MaxCharactersInDisplayedSQL` (`mb_strlen`) are skipped. Every entry goes to `$_SESSION['sql_history']` (capped at `QueryHistoryMax`); with `$cfg['QueryHistoryDB']` it is also inserted (`timevalue = NOW()`), then `purgeHistory()` reads the `timevalue` of the user's `QueryHistoryMax`-th newest row (`ORDER BY timevalue DESC LIMIT QueryHistoryMax, 1`) and deletes every row `<=` it (rows written in the same second as that one go too). `getHistory()` returns `false` when the history table is unavailable, the session list (newest first) when `QueryHistoryDB` is off, else the table ordered by `id DESC`. Read by the console "History" panel. *Master quirk*: `History` is constructed (via the console of the response renderer) before the Authentication middleware initialises the storage, so it captures `sqlHistoryFeature = null` and neither writes `pma__history` nor returns any history; see parity exception Q37.

### pma__pdf_pages - `pdf_pages` - `pdfwork` (with `table_coords`) - `PdfFeature`

```sql
CREATE TABLE IF NOT EXISTS `pma__pdf_pages` (
  `db_name` varchar(64) NOT NULL default '',
  `page_nr` int(10) unsigned NOT NULL auto_increment,
  `page_descr` varchar(50) COLLATE utf8mb4_general_ci NOT NULL default '',
  PRIMARY KEY  (`page_nr`),
  KEY `db_name` (`db_name`)
) COMMENT='PDF relation pages for phpMyAdmin' ...;
```
A named layout page per database (`Relation::createPage` inserts with description defaulting to *no description*). Used by Designer (page chooser, save/load/delete page) and the relational schema export (choose page).

### pma__recent / pma__favorite - `recent` / `favorite` - `recentwork` / `favoritework`

```sql
CREATE TABLE IF NOT EXISTS `pma__recent` (
  `username` varchar(64) NOT NULL,
  `tables` text NOT NULL,
  PRIMARY KEY (`username`)
) COMMENT='Recently accessed tables' ...;
CREATE TABLE IF NOT EXISTS `pma__favorite` ( ... identical ... ) COMMENT='Favorite tables' ...;
```
`tables` is a JSON array `[{"db":"...","table":"..."}, ...]` (PHP `json_encode`: `/` and non-ASCII escaped), most recent first, trimmed to `NumRecentTables`/`NumFavoriteTables`; written with `REPLACE INTO` (`RecentFavoriteTables::saveToDb`) after every change. The list is read from the table once per session and then lives in `$_SESSION['tmpval']['recentTables'|'favoriteTables'][server]` (the only copy without pmadb). `remove()` unsets the entry, so the save right after a removal that leaves a gap stores a JSON *object* keyed by the remaining positions (`{"1":{"db":...}}`); the session copy is re-indexed at the end of the request. A table is added only if `SELECT 1 FROM db.table LIMIT 1;` succeeds on the user's link (`DbTableExists`). Every request carrying `db` and `table` parameters adds the table to the recent list (`RecentTableHandling`, off when `NumRecentTables = 0`). Features: navigation "Recent"/"Favorites" dropdowns, star toggle in DB structure, sync of favourites to browser localStorage.

### pma__table_uiprefs - `table_uiprefs` - `uiprefswork` - `UiPreferencesFeature`

```sql
CREATE TABLE IF NOT EXISTS `pma__table_uiprefs` (
  `username` varchar(64) NOT NULL,
  `db_name` varchar(64) NOT NULL,
  `table_name` varchar(64) NOT NULL,
  `prefs` text NOT NULL,
  `last_update` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`username`,`db_name`,`table_name`)
) COMMENT='Tables'' UI preferences' ...;
```
`prefs` JSON with keys, in insertion order, `CREATE_TIME` (the table's `information_schema.TABLES.CREATE_TIME` when `col_order`/`col_visib` were saved; not set for views), `sorted_col` (`"`col` ASC"` style ORDER BY fragment, kept only if `RememberSorting`), `col_order` (JSON array of column indexes; posted as a comma list to `/sql/set-column-preferences`), `col_visib` (JSON array of 0/1). `col_order`/`col_visib` are refused unless the posted `table_create_time` equals the current one (*Cannot save UI property "%s". The changes made will not be persistent after you refresh this page. Please check if the table structure has been changed.*), and dropped when read after the table was altered; `sorted_col` is dropped when its column no longer exists. An empty set of prefs is stored as `[]`. `Table::saveUiPrefsToDb` does `REPLACE INTO` and then deletes the oldest rows beyond `Servers[$i]['MaxTableUiprefs']` (error *Failed to cleanup table UI preferences...*). Cached in `$_SESSION['tmpval']['table_uiprefs'][server][db][table]`. Renamed with the table (`Relation::renameTable`).

### pma__relation - `relation` - `relwork` (RelationFeature); with `table_info` -> `displaywork`

```sql
CREATE TABLE IF NOT EXISTS `pma__relation` (
  `master_db` varchar(64) NOT NULL default '',
  `master_table` varchar(64) NOT NULL default '',
  `master_field` varchar(64) NOT NULL default '',
  `foreign_db` varchar(64) NOT NULL default '',
  `foreign_table` varchar(64) NOT NULL default '',
  `foreign_field` varchar(64) NOT NULL default '',
  PRIMARY KEY  (`master_db`,`master_table`,`master_field`),
  KEY `foreign_field` (`foreign_db`,`foreign_table`)
) COMMENT='Relation table' ...;
```
"Internal relations" - one row per referencing column (so a column can have at most one internal relation). `master_*` = referencing side, `foreign_*` = referenced side; docs note `master_db` must equal `foreign_db`. Maintained from Structure > Relation view ("Internal relations" column dropdowns) and Designer; `renameField`/`renameTable` keep both sides in sync. Consumers: browse view (clickable FK values with display-field tooltip), insert/edit FK dropdown and "Browse foreign values", QBE auto-join, Designer lines (style distinguishes internal vs InnoDB), PDF/SVG/DIA/EPS schema, "Check referential integrity" links in table structure, SQL/LaTeX/ODT export relation comments, metadata export.

### pma__table_coords - `table_coords` - `pdfwork` (with `pdf_pages`)

```sql
CREATE TABLE IF NOT EXISTS `pma__table_coords` (
  `db_name` varchar(64) NOT NULL default '',
  `table_name` varchar(64) NOT NULL default '',
  `pdf_page_number` int(11) NOT NULL default '0',
  `x` float unsigned NOT NULL default '0',
  `y` float unsigned NOT NULL default '0',
  PRIMARY KEY  (`db_name`,`table_name`,`pdf_page_number`)
) COMMENT='Table coordinates for phpMyAdmin PDF output' ...;
```
Position of each table on a given `pdf_pages.page_nr` (Designer canvas coordinates and PDF schema). Deleted when a table is moved to another database; renamed with the table otherwise.

### pma__table_info - `table_info` - `displaywork` (requires `relation` too) - `DisplayFeature`

```sql
CREATE TABLE IF NOT EXISTS `pma__table_info` (
  `db_name` varchar(64) NOT NULL default '',
  `table_name` varchar(64) NOT NULL default '',
  `display_field` varchar(64) NOT NULL default '',
  PRIMARY KEY  (`db_name`,`table_name`)
) COMMENT='Table information for phpMyAdmin' ...;
```
The "display column" of a table: the human-readable column shown next to a key when this table is the target of a relation (browse tooltips, `RelationalDisplay = 'D'`, FK dropdown `content-id`/`id-content` halves, Designer "Choose column to display"). Set from Structure > Relation view ("Choose column to display") and Designer; `renameField` updates it.

### pma__tracking - `tracking` - `trackingwork` - `TrackingFeature`

```sql
CREATE TABLE IF NOT EXISTS `pma__tracking` (
  `db_name` varchar(64) NOT NULL,
  `table_name` varchar(64) NOT NULL,
  `version` int(10) unsigned NOT NULL,
  `date_created` datetime NOT NULL,
  `date_updated` datetime NOT NULL,
  `schema_snapshot` text NOT NULL,
  `schema_sql` text,
  `data_sql` longtext,
  `tracking` set('UPDATE','REPLACE','INSERT','DELETE','TRUNCATE','CREATE DATABASE','ALTER DATABASE','DROP DATABASE','CREATE TABLE','ALTER TABLE','RENAME TABLE','DROP TABLE','CREATE INDEX','DROP INDEX','CREATE VIEW','ALTER VIEW','DROP VIEW') default NULL,
  `tracking_active` int(1) unsigned NOT NULL default '1',
  PRIMARY KEY  (`db_name`,`table_name`,`version`)
) COMMENT='Database changes tracking for phpMyAdmin' ...;
```
One row per (table, version). `schema_snapshot` = PHP `serialize(['COLUMNS' => [...SHOW COLUMNS-like rows...], 'INDEXES' => [...]])`; `schema_sql` = DDL log (optional `DROP TABLE/VIEW IF EXISTS` per `tracking_add_drop_*`, then `CREATE ...`, each statement preceded by `# log <Y-m-d H:i:s> <user>\n`); `data_sql` = DML log appended with `CONCAT()` through `/*NOTRACK*/`-prefixed updates; `tracking` = set of tracked statement types (from `tracking_default_statements` for auto-created versions or the checkboxes in the Tracking tab); `tracking_active` 1/0 (activate/deactivate). A row with `table_name=''` tracks database-level statements. Features: Table > Tracking tab (create version, activate/deactivate, report, snapshot, SQL dump/export, delete), DB > Tracking overview, `Tracker` hooks in `DatabaseInterface::query`, auto-create (`tracking_version_auto_create`).

### pma__userconfig - `userconfig` - `userconfigwork` - `UserPreferencesFeature`

```sql
CREATE TABLE IF NOT EXISTS `pma__userconfig` (
  `username` varchar(64) NOT NULL,
  `timevalue` timestamp NOT NULL default CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `config_data` text NOT NULL,
  PRIMARY KEY  (`username`)
) COMMENT='User preferences storage for phpMyAdmin' ...;
```
`config_data` = flat JSON map of preference paths (`"Export/format"`, `"Server/hide_db"`, `"ThemeDefault"`, `"lang"`, `"2fa"`, `"Console/Mode"`, `"NavigationWidth"`...). Gates: persistent Settings, 2FA, theme/language memory across browsers, the "Saved on" info in Manage settings (via `timevalue`).

### pma__users / pma__usergroups - `users` / `usergroups` - `menuswork` - `ConfigurableMenusFeature`

```sql
CREATE TABLE IF NOT EXISTS `pma__users` (
  `username` varchar(64) NOT NULL,
  `usergroup` varchar(64) NOT NULL,
  PRIMARY KEY (`username`)
) COMMENT='Users and their assignments to user groups' ...;
CREATE TABLE IF NOT EXISTS `pma__usergroups` (
  `usergroup` varchar(64) NOT NULL,
  `tab` varchar(64) NOT NULL,
  `allowed` enum('Y','N') NOT NULL DEFAULT 'N',
  PRIMARY KEY (`usergroup`,`tab`,`allowed`)
) COMMENT='User groups with configured menu items' ...;
```
`tab` values are `server_<tab>`, `db_<tab>`, `table_<tab>` (e.g. `server_sql`, `db_structure`, `table_browse`; the tab names are the menu tab ids of `Menu.php`). A user's menu shows only tabs with `allowed='Y'` for their group. Both tables are required; either set to `false` disables the feature. Managed from Server > Privileges ("User groups" sub-page, assign group when editing a user).

### pma__navigationhiding - `navigationhiding` - `navwork` - `NavigationItemsHidingFeature`

```sql
CREATE TABLE IF NOT EXISTS `pma__navigationhiding` (
  `username` varchar(64) NOT NULL,
  `item_name` varchar(64) NOT NULL,
  `item_type` varchar(64) NOT NULL,
  `db_name` varchar(64) NOT NULL,
  `table_name` varchar(64) NOT NULL,
  PRIMARY KEY (`username`,`item_name`,`item_type`,`db_name`,`table_name`)
) COMMENT='Hidden items of navigation tree' ...;
```
`item_type` is the node type (`table`, `view`, `function`, `procedure`, `event`, `column`, `index`, `trigger`...), `db_name` the database, `table_name` the parent table for column/index/trigger items (else `''`). Features: the "hide" eye icon per navigation node, "Show hidden items" dialog on the database node, rename sync.

### pma__savedsearches - `savedsearches` - `savedsearcheswork`

```sql
CREATE TABLE IF NOT EXISTS `pma__savedsearches` (
  `id` int(5) unsigned NOT NULL auto_increment,
  `username` varchar(64) NOT NULL default '',
  `db_name` varchar(64) NOT NULL default '',
  `search_name` varchar(64) NOT NULL default '',
  `search_data` text NOT NULL,
  PRIMARY KEY  (`id`),
  UNIQUE KEY `u_savedsearches_username_dbname` (`username`,`db_name`,`search_name`)
) COMMENT='Saved searches' ...;
```
`search_data` = JSON of the Query-by-example form criteria (`criteriaColumn`, `criteriaSort`, `criteriaShow`, `criteria`, `criteriaAndOrRow`, `criteriaAndOrColumn`, `rows`, `TableList`...). Features: DB > Query "Saved searches" select with Create/Update/Delete/Load.

### pma__central_columns - `central_columns` - `centralcolumnswork`

```sql
CREATE TABLE IF NOT EXISTS `pma__central_columns` (
  `db_name` varchar(64) NOT NULL,
  `col_name` varchar(64) NOT NULL,
  `col_type` varchar(64) NOT NULL,
  `col_length` text,
  `col_collation` varchar(64) NOT NULL,
  `col_isNull` boolean NOT NULL,
  `col_extra` varchar(255) default '',
  `col_default` text,
  PRIMARY KEY (`db_name`,`col_name`)
) COMMENT='Central list of columns' ...;
```
A reusable column definition per database (`col_extra` holds attributes such as `on update CURRENT_TIMESTAMP,auto_increment` comma-joined; `col_default` literal or `NULL`/`CURRENT_TIMESTAMP`). Features: DB > Central columns page (add/edit/delete, add from table), "Pick from Central Columns" in table create/alter column forms, "Add to central columns" from table structure.

### pma__designer_settings - `designer_settings` - `designersettingswork`

```sql
CREATE TABLE IF NOT EXISTS `pma__designer_settings` (
  `username` varchar(64) NOT NULL,
  `settings_data` text NOT NULL,
  PRIMARY KEY (`username`)
) COMMENT='Settings related to Designer' ...;
```
`settings_data` JSON of Designer toggles (`angular_direct`, `snap_to_grid`, `relation_lines`, `small_big_all`, `side_menu`, `pin_text`...). Read on Designer load; `Designer\Common::saveSetting` upserts.

### pma__export_templates - `export_templates` - `exporttemplateswork`

```sql
CREATE TABLE IF NOT EXISTS `pma__export_templates` (
  `id` int(5) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL,
  `export_type` varchar(10) NOT NULL,
  `template_name` varchar(64) NOT NULL,
  `template_data` text NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `u_user_type_template` (`username`,`export_type`,`template_name`)
) COMMENT='Saved export templates' ...;
```
`export_type` in `server` / `database` / `table` (`raw` for raw-query export); `template_data` JSON of the export form field values. Features: "Export templates" box on the export pages (create/update/delete/load), routes `/export/template/{create,update,delete,load}`.

### Feature-gating summary (`Relation::checkRelationsParam` -> `RelationParameters`)

| Flag | Requires tables | Feature object | Unlocks |
|---|---|---|---|
| `relwork` | relation | `relationFeature` | internal relations |
| `displaywork` | relation + table_info | `displayFeature` | display columns |
| `bookmarkwork` | bookmarktable | `bookmarkFeature` | bookmarks |
| `pdfwork` | table_coords + pdf_pages | `pdfFeature` | Designer persistence, schema export pages |
| `commwork` | column_info | `columnCommentsFeature` | database comments |
| `mimework` | column_info with 4.3 columns | `browserTransformationFeature` | MIME/transformations |
| `historywork` | history | `sqlHistoryFeature` | DB SQL history |
| `recentwork` / `favoritework` | recent / favorite | `recentlyUsedTablesFeature` / `favoriteTablesFeature` | persistent recent/favorite |
| `uiprefswork` | table_uiprefs | `uiPreferencesFeature` | persistent sort/column order |
| `trackingwork` | tracking | `trackingFeature` | tracking |
| `userconfigwork` | userconfig | `userPreferencesFeature` | persistent prefs, 2FA |
| `menuswork` | users + usergroups | `configurableMenusFeature` | configurable menus |
| `navwork` | navigationhiding | `navigationItemsHidingFeature` | hide nav items |
| `savedsearcheswork` | savedsearches | `savedQueryByExampleSearchesFeature` | saved QBE |
| `centralcolumnswork` | central_columns | `centralColumnsFeature` | central columns |
| `designersettingswork` | designer_settings | `databaseDesignerSettingsFeature` | designer settings |
| `exporttemplateswork` | export_templates | `exportTemplatesFeature` | export templates |
| `allworks` | every one of the 18 features above (a directive set to `false` therefore keeps it false) | `hasAllFeatures()` | suppresses the "not completely configured" notice |

Algorithm: if no server selected, or `pmadb` empty, or `USE pmadb` fails as control user -> `pmadb` is cleared and everything is off. Otherwise list tables of `pmadb` and match each against the configured name; then `checkTableAccess` probes each matched table. Probe order: `table_info` (only when `relation` and `table_info` were both found), `table_coords` then `pdf_pages`, `column_info` (+ the `input_transformation` columns check / upgrade), `users` then `usergroups`, then `export_templates`, `designer_settings`, `central_columns`, `savedsearches`, `navigationhiding`, `bookmark`, `userconfig`, `tracking`, `table_uiprefs`, `favorite`, `recent`, `history`, `relation`, each `SELECT NULL FROM <table> LIMIT 0` in the selected pmadb. `checkRelationsParam` also computes an `allworks` that skips `false` directives, but `RelationParameters::fromArray` discards it: the `allworks` of `toArray()` is `hasAllFeatures()`. The result is cached statically per request (`Relation::$cache`), reset by `createPmaDatabase` / `fixPmaTables`; a table the control user cannot see is not listed by `SHOW TABLES` and so not even probed (its directive stays empty).

### ZeroConf and the storage check page

* **Early probe** (`Relation::initRelationParamsCache`, run during bootstrap): `fixPmaTables(pmadb ?: 'phpmyadmin', create=false)` - if the database contains any default-named (or configured-named) table, fill the empty directives with the default `pma__*` names and set `pmadb`. If still nothing, probe the **current database** the same way (this is how a shared-hosting user who created the tables inside their own DB gets them picked up). Directives set to `false` are never filled.
* **Notice**: home page (when `arePmadbTablesAllDisabled()` is false and `!hasAllFeatures()` and `!PmaNoRelation_DisableWarning`): *The phpMyAdmin configuration storage is not completely configured, some extended features have been deactivated. %sFind out why%s.* (+ *Or alternately go to 'Operations' tab of any database to set it up there.* when `ZeroConf`). Shown as an **error** if `pmadb` is configured in `config.inc.php`, as a notice otherwise. DB Operations shows *The phpMyAdmin configuration storage has been deactivated. %sFind out why%s.* under the same conditions (without the `arePmadbTablesAllDisabled()` check), same severity rule.
* **`/check-relations` page** (`relation/check_relations.twig`), titled *phpMyAdmin configuration storage*: if `pmadb` unusable: *Configuration of pmadb… not OK*, *General relation features Disabled*, and with `ZeroConf`: either *%sCreate%s a database named '<phpmyadmin>' and setup the phpMyAdmin configuration storage there.* (POST `create_pmadb=1`; `createPmaDatabase` runs `CREATE DATABASE IF NOT EXISTS` as control user, error 1044 -> *You do not have necessary privileges to create a database named '%s'. You may go to 'Operations' tab of any database to set up the phpMyAdmin configuration storage there.*, then `fixPmaTables(db, create=true)`) or, when a database is selected, *%sCreate%s the phpMyAdmin configuration storage in the current database.* (POST `fixall_pmadb=1`). If `pmadb` works but not all features: *%sCreate%s missing phpMyAdmin configuration storage tables.* (POST `fix_pmadb=1`, only when `ZeroConf` and all table directives are non-empty). Then a table listing every `$cfg['Servers'][$i]['<table>']` with **OK**/**not OK** and each feature line *General relation features / Display features / Designer and creation of PDFs / Displaying column comments / Browser transformation / Bookmarked SQL query / SQL history / Persistent recently used tables / Persistent favorite tables / Persistent tables' UI preferences / Tracking / User preferences / Configurable menus / Hide/show navigation items / Saving Query-By-Example searches / Managing central list of columns / Remembering designer settings / Saving export templates* as **Enabled**/**Disabled**. When not all work, *Quick steps to set up advanced features:* (1) *Create the needed tables with the `<sql_dir>create_tables.sql`.* (2) *Create a pma user and give access to these tables.* (3) *Enable advanced features in configuration file (config.inc.php), for example by starting from config.sample.inc.php.* (4) *Re-login to phpMyAdmin to load the updated configuration file.*
* **`fixPmaTables(db, create)`**: parses `create_tables.sql` into per-table `CREATE TABLE IF NOT EXISTS` statements, substitutes custom table names from config, runs the missing ones (as control user, inside `USE db`), fills empty directives with default names, sets `pmadb = db`, resets the relation cache. Tracking is temporarily disabled during the operation.

---

## Relation/metadata resolution (how FKs, display fields, comments, MIME are read & merged)

### Foreign keys: `Relation::getForeigners(db, table, column='') : Foreigners`

Returns an object with two halves:

1. **`data`** (`getForeignersInternal`) - internal relations keyed by `master_field` -> `{foreign_db, foreign_table, foreign_field}` from `pma__relation` (control connection), only when `relationFeature` exists. For `information_schema` and `mysql` databases, hard-coded `InternalRelations::INFORMATION_SCHEMA` / `::MYSQL` maps are merged in for fields not already present (so system tables get clickable links without any pmadb).
2. **`keysData`** (`getForeignKeysData`) - real constraints parsed from `SHOW CREATE TABLE` with the SQL parser (`CreateStatement::getForeignKeys()`): each entry has `constraint`, `indexList`, `refDbName`, `refTableName`, `refIndexList`, `onUpdate`, `onDelete`. (`information_schema.KEY_COLUMN_USAGE` is *not* used here; it is used by `getChildReferences()` to find tables referencing a column, unless `DisableIS`.)

Lookup (`searchColumnInForeigners`): internal relation first, else the first FK whose `indexList` contains the column -> `{foreign_field, foreign_db (refDbName ?? current db), foreign_table, constraint, on_update ('RESTRICT' default), on_delete}`. Consequence: an internal relation **overrides** an InnoDB constraint for the same column in browse/insert UI. `Foreigners::isEmpty()` is true when both halves are empty.

`checkChildForeignReferences()` marks a column non-editable in Structure (`isEditable=false`) when it is part of an FK or referenced by other tables (`isReferenced`, list of `db.table`).

### Display field: `Relation::getDisplayField(db, table) : string`

1. `pma__table_info.display_field` for (db, table) if `displayFeature`.
2. Hard-coded for `information_schema.CHARACTER_SETS` -> `DESCRIPTION`, `information_schema.TABLES` -> `TABLE_COMMENT`.
3. Otherwise the **first column whose type class is CHAR** (char/varchar/text...) via `dbi->getColumns`; `''` if none.

### Foreign values for a cell: `Relation::getForeignData(foreigners, field, overrideTotal, filter, limit, getTotal)`

Finds the foreigner for `field`; if the foreign table has fewer than `ForeignKeyMaxLimit` rows (or `overrideTotal`), selects `foreign_field` (+ display field if any) with optional `LIKE %filter%` on both, `ORDER BY display`, and returns `dispRow` for a dropdown; else (or when the select fails/returns nothing) returns `foreignLink=true` so the UI shows an input plus the "Browse foreign values" popup. `foreignDropdown()` builds the `<option>`s: an empty option, the `ForeignKeyDropdownOrder[0]` block (`content-id` = "display - key", `id-content` = "key - display"), a blank separator, then the `[1]` block; without a display field only keys (`id-only`). Non-UTF-8 keys/values render as `0x<hex>`; values longer than `LimitChars` are truncated with `...`. Sorting honours `NaturalOrder`.

### Comments

* **Column comments**: `Relation::getComments(db, table)` reads **native** column comments (`dbi->getColumns()->comment`); pmadb is not consulted for column comments any more (the `comment` column of `column_info` survives for the DB comment and legacy data). Used by browse headers (`ShowBrowseComments`), structure (`ShowPropertyComments`/`ShowColumnComments`), exports.
* **Database comment**: `getDbComment/setDbComment` through `column_info` row `('<db>', '', '(db_comment)')` - upsert with `ON DUPLICATE KEY UPDATE`, delete when emptied.
* **Table comments** come from `SHOW TABLE STATUS`/`information_schema.TABLES.TABLE_COMMENT` (not pmadb).

### MIME / transformations

`Transformations::getMime(db, table, strict=false, fullName=false)` -> rows keyed by column (or `db.table.column` with `fullName`) with `mimetype`, `transformation`, `transformation_options`, `input_transformation`, `input_transformation_options`, only when `browserTransformationFeature`; `strict=true` limits to rows with a non-empty `mimetype`. Browse applies `transformation` plugins when `BrowseMIME`; insert/edit applies `input_transformation` plugins; defaults for option strings come from `$cfg['DefaultTransformations']`.

### Special schema links (`SpecialSchemaLinks`)

Independent of pmadb: a static map for `mysql.*` and `information_schema.*` tables making specific columns clickable (`user` -> `/server/privileges?username=..&hostname=..`, `table_name` -> `DefaultTabTable` route with `db` from the sibling column, `column_name` -> `/table/structure/change?change_column=1`, routine/event names -> `/database/routines|events?edit_item=1`, `schema_name` -> `DefaultTabDatabase` route). Each entry: `link_param` (query param fed with the cell value), `link_dependancy_params` (`[{param_info, column_name}]` - extra params taken from other columns of the same row), `default_page`.

### Rename/move propagation

`Relation::renameField` updates `table_info.display_field` and both sides of `relation`. `Relation::renameTable` updates `column_info`, `table_info`, `relation` (master and foreign), `table_coords` (delete when moving across databases), `table_uiprefs`, `navigationhiding` (both the rows *inside* the table and the table's own hidden row). `RelationCleanup` (not detailed here) deletes metadata when columns/tables/databases/users are dropped.

---

## Micro-behaviours checklist

Settings pages
- [ ] Eight pill tabs in fixed order; icons follow `TabsMode`; current tab highlighted; all links non-Ajax.
- [x] Banner *Configuration has been saved.* appears only when `?saved=1` is in the URL (after a redirect), on every settings tab. <!-- parity:test --> `p08-a8211e` [preferences.e2e.ts:46](../../tests/e2e/preferences.e2e.ts#L46)
- [x] Notice about session-only storage appears whenever `pma__userconfig` is unavailable, including on the 2FA tab. <!-- parity:test --> `p08-3ef43d` [preferences.test.ts:157](../../apps/server/test/int/preferences.test.ts#L157) +1
- [ ] Navigation gear hidden while on a settings page.
- [x] Each tab of a form has its own Apply/Reset; Apply saves **all** tabs of that form (whole `FormDisplay`), not just the visible one; active tab restored via `tab_hash` after redirect. <!-- parity:test --> `p08-ee115b` [preferences.test.ts:71](../../apps/server/test/int/preferences.test.ts#L71) +4
- [x] A field equal to the phpMyAdmin default is not stored (key removed from the JSON) unless `config.inc.php` overrides the default - then the user's explicit default *is* stored. <!-- parity:test --> `p08-9b4f97` [preferences.test.ts:59](../../apps/server/test/unit/preferences.test.ts#L59) +1
- [x] Restore-default icon visible only when value differs from default; hover raises opacity; click sets value and fires `change` (re-validates, unmarks `custom`). <!-- parity:test --> `p08-779a14` [configForm.test.ts:48](../../apps/web/src/features/preferences/configForm.test.ts#L48) +1
- [x] Fields in `UserprefsDisallow` are rendered disabled with a "Disabled" badge and are ignored on save/apply even if posted. <!-- parity:test --> `p08-8fd8fd` [preferences.test.ts:181](../../apps/server/test/int/preferences.test.ts#L181) +1
- [ ] Setup shows a third column with "Allow users to customize this value" checkboxes; unchecking adds the path to `UserprefsDisallow` in the generated file.
- [x] Numeric validators run on keyup for text inputs; selects/checkboxes on change; whole form re-validated after a browser refresh restores values (`check_page_refresh`). <!-- parity:test --> `p08-d2dece` [preferences.test.ts:13](../../apps/server/test/unit/preferences.test.ts#L13) +1
- [x] Upper-bound validators for `MaxDbList`, `MaxTableList`, `MaxRoutineList`, `QueryHistoryMax` use the admin's `config.inc.php` value, shown as comment *maximum N*. <!-- parity:test --> `p08-8ef8d5` [preferences.test.ts:21](../../apps/server/test/unit/preferences.test.ts#L21) +1
- [x] `hide_db` validated as a PCRE body (delimiter `/` added); `MemoryLimit` must match `-1|\d+[kmg]?`. <!-- parity:test --> `p08-84b620` [preferences.test.ts:28](../../apps/server/test/unit/preferences.test.ts#L28) +1
- [ ] Save failure keeps the posted values on screen with inline errors and a red summary; a `revert` POST resets only erroneous fields.
- [x] `Servers/1/only_db` and `Servers/1/hide_db` are persisted as `Server/only_db` / `Server/hide_db` and re-applied to whichever server is currently selected. <!-- parity:test --> `p08-5102df` [preferences.test.ts:66](../../apps/server/test/unit/preferences.test.ts#L66) +2
- [x] Saving any form re-persists the `2fa` block (never lost by a partial save). <!-- parity:test --> `p08-0b1f72` [preferences.test.ts:71](../../apps/server/test/int/preferences.test.ts#L71) +1
- [ ] Theme changes and language changes made anywhere are silently stored as prefs `ThemeDefault` / `lang` (deleted when back to `original` / `en`).
- [x] Console toggles, `NavigationWidth` drags etc. persist via `setUserValue`; with session storage they additionally fall back to cookies when a cookie name is provided. <!-- parity:test --> `p08-1383bd` [preferences.parity.test.ts:384](../../tests/parity/preferences.parity.test.ts#L384)

Manage your settings
- [ ] Import-from-browser and Save-to-browser radios are disabled until JS enables them; unsupported localStorage shows the unsupported notice and disables submit.
- [x] Import shows *Saved on: <local date>* from `localStorage.configMtimeLocal` or *You have no saved settings!*; submit disabled when importing from an empty storage. <!-- parity:test --> `p08-10a75c` [configForm.test.ts:97](../../apps/web/src/features/preferences/configForm.test.ts#L97)
- [x] Imported JSON is sanitised as if posted field by field; bad values trigger the two-step *Do you want to import remaining settings?* flow (Yes = fix errors and import rest). <!-- parity:test --> `p08-f18efc` [preferences.test.ts:258](../../apps/server/test/int/preferences.test.ts#L258) +1
- [x] Merge checkbox keeps existing prefs under imported ones; otherwise import starts from defaults (prefs not in the file are reset). <!-- parity:test --> `p08-d20c19` [preferences.test.ts:258](../../apps/server/test/int/preferences.test.ts#L258)
- [ ] Import applies `ThemeDefault` immediately (theme cookie) and redirects with `lang=` when the language differs.
- [x] Export JSON is pretty-printed; PHP export emits `$cfg['a']['b'] = ...;` lines; both named `phpMyAdmin-config-<host>.<ext>`. <!-- parity:test --> `p08-1c37f1` [preferences.test.ts:227](../../apps/server/test/int/preferences.test.ts#L227) +1
- [ ] Save-to-browser is an Ajax round-trip (`submit_get_json`), stores `config`, `configMtime`, `configMtimeLocal`, hides the form and shows a click-to-dismiss success message.
- [x] Reset wipes all prefs (`save([])`) and deletes the `pma_lang` cookie. <!-- parity:test --> `p08-e23faa` [preferences.test.ts:295](../../apps/server/test/int/preferences.test.ts#L295) +1
- [x] Autoload banner shown once per session when prefs are session-based and `localStorage.config` exists; Yes imports with `return_url` back to the current page; No/Delete hide it for the session (`prefs_autoload=hide`). <!-- parity:test --> `p08-5de125` [preferences.test.ts:157](../../apps/server/test/int/preferences.test.ts#L157)
- [ ] "More settings" card only when `setup/index.php` exists and `config.inc.php` does not.

Page settings
- [x] Gear icon appears only on pages that called `PageSettings::init`; hidden in print view. <!-- parity:test --> `p08-8abc69` [preferences.e2e.ts:71](../../tests/e2e/preferences.e2e.ts#L71)
- [x] Modal "Page-related settings" with Apply (submits) and Cancel (restores DOM clone, discarding edits). <!-- parity:test --> `p08-4eeac3` [preferences.e2e.ts:71](../../tests/e2e/preferences.e2e.ts#L71)
- [x] Successful save redirects to the same URL; errors render above the page content. <!-- parity:test --> `p08-69a15f` [preferences.test.ts:199](../../apps/server/test/int/preferences.test.ts#L199) +1
- [x] Edit popup shows both Edit-mode and Text-fields groups; Browse popup shows the Browse-mode group only. <!-- parity:test --> `p08-6f0e6e` [preferences.test.ts:199](../../apps/server/test/int/preferences.test.ts#L199)

Two-factor
- [ ] Tab unusable without pmadb (explicit message).
- [x] Backend list: none, (simple if DBG), application if deps, WebAuthn always, key (U2F) if dep; missing deps listed with composer package names. <!-- parity:test --> `p08-47e665` [webauthn.test.ts:62](../../apps/server/test/unit/webauthn.test.ts#L62) +1
- [x] Configure is a two-step POST (choose -> setup form -> verify); failure re-renders the setup form with *Two-factor authentication failed[: reason]*. <!-- parity:test --> `p08-38b5dc` [preferences.test.ts:98](../../apps/server/test/int/preferences.test.ts#L98) +1
- [x] Application secret stable within the session until verified; QR label `phpMyAdmin (<host>)`. <!-- parity:test --> `p08-3db3a5` [preferences.test.ts:97](../../apps/server/test/unit/preferences.test.ts#L97)
- [ ] Disabling requires passing the current challenge; U2F pages show the deprecation alert and HTTPS warning.
- [x] Login shows the 2FA step after password success; the check result is cached in session; `Invalid` backend blocks login. <!-- parity:test --> `p08-71a0b1` [preferences.test.ts:98](../../apps/server/test/int/preferences.test.ts#L98) +1

Configuration storage
- [ ] Table directives: `''` = auto (ZeroConf fills default name if table exists), `false` = disabled (never probed; `allworks` stays false), string = explicit name.
- [ ] Probe order at bootstrap: configured `pmadb` or `phpmyadmin`, then the current database.
- [ ] Each table individually probed with `SELECT NULL ... LIMIT 0` as control user; a missing/unreadable table disables only its feature(s).
- [ ] `displaywork` needs both relation and table_info; `pdfwork` both table_coords and pdf_pages; `menuswork` both users and usergroups.
- [ ] `mimework` requires the 4.3 columns; auto-upgrade attempted silently; failure flagged on the check page.
- [ ] Home/DB-Operations notice severity: error when `pmadb` set in config, notice otherwise; suppressed by `PmaNoRelation_DisableWarning`; extra ZeroConf hint line.
- [ ] `/check-relations` offers exactly one of: create database `phpmyadmin`, create in current database, create missing tables - depending on state and `ZeroConf`. A configured but missing `pmadb` is cleared by the failing discovery before the page reads it, so the database offered (and created) is `phpmyadmin`.
- [ ] Creating tables uses `create_tables.sql` parsed at runtime with configured custom names substituted; only missing tables are created; disabled (`false`) features skipped.
- [ ] `table_uiprefs` trimmed to `MaxTableUiprefs` newest rows on every save.
- [ ] Recent/favorite lists stored as JSON `[{db,table}]` via `REPLACE INTO`; the save right after a removal that leaves a gap stores `{"<pos>":{db,table}}`.
- [ ] History rows per user purged beyond `QueryHistoryMax`; only written when `QueryHistoryDB`.
- [ ] Shared bookmarks have `user=''` and are visible to everyone; disallowed when `AllowSharedBookmarks=false`.
- [ ] Database comment stored as `column_info` row with `table_name=''`, `column_name='(db_comment)'`.
- [ ] Internal relation beats InnoDB FK for the same column in browse/insert.
- [ ] Display field fallback: first CHAR-class column.
- [ ] FK dropdown only when foreign table has `< ForeignKeyMaxLimit` rows; otherwise browse-foreign-values popup.
- [ ] Renames propagate to relation (both sides), table_info, column_info, table_coords (delete on cross-db move), table_uiprefs, navigationhiding.

Config file
- [ ] `config.inc.php` optional; missing file = defaults (cookie auth to localhost) + setup allowed; existing file disables the setup script (*Configuration already exists, setup is disabled!*) except in demo mode.
- [ ] World-writable config refused (non-Windows) unless `CheckConfigurationPermissions=false`.
- [ ] `Servers[0]` ignored; `$i` numbering must start at 1.
- [ ] Legacy control aliases accepted: `control_host`, `control_port`, `control_user`, `control_pass`, `control_password`.
- [ ] Legacy tab words (`structure`, `browse`, `welcome`...) accepted for `DefaultTab*` / `NavigationTreeDefaultTabTable*` and mapped to routes.
- [ ] Setup generator writes `blowfish_secret` as `\sodium_hex2bin(...)`, drops default-valued keys, honours EOL choice, groups servers under `$i++`.
- [ ] Setup overview: language selector, hidden/old messages toggle, servers table (id, name, auth type, DSN with `***` password, Edit/Delete), New server, Configuration file form (Default language, Default server with "let the user choose" when >1 server, End of line, Display/Download/Clear), footer links incl. *Check for latest version*.
- [ ] Setup security checks produce notices: blowfish secret missing/weak with cookie auth, `AllowArbitraryServer` enabled, `LoginCookieValidity` vs `session.gc_maxlifetime`, `SaveDir`/`TempDir` set (directory exposure warning), `AllowNoPassword`, missing zip/gzip/bzip2 functions, insecure (non-HTTPS) connection.

---

## Rebuild notes

### Three stores, three lifetimes

| Layer | phpMyAdmin today | Model it as |
|---|---|---|
| **Server/deployment config** | `config.inc.php` (PHP), optionally generated by setup or Docker env | An immutable, typed `ServerConfig` document loaded at boot (JSON/YAML/env), validated against a schema generated from `Settings.php` types (`positive-int`, enum lists, nullable strings). Keep `Servers[]` 1-based *only* at the import/export boundary; internally use a list of server profiles with ids. Provide a converter that ingests an existing `config.inc.php` (it is plain `$cfg[...] = ...;` assignments - a tiny PHP-subset parser or running it in a sandbox is enough) and emits the new format, and an exporter back to `config.inc.php` so admins can round-trip. Mirror the Docker `PMA_*` variables for drop-in compatibility. |
| **Per-user preferences** | `pma__userconfig.config_data` JSON keyed by MySQL username, or `$_SESSION['userconfig']` | A `UserPreferences` document per (server, MySQL user) in the metadata store with the *same flat path keys* (`Export/format`, `Server/hide_db`, `Console/Mode`, `ThemeDefault`, `lang`, `2fa`). Keeping the key names means the JSON export/import of the old UI stays importable and you can read/write existing `pma__userconfig` rows unchanged. Enforce the allow-list (`UserFormList::getFields()` + specials) and `UserprefsDisallow` server-side exactly as `UserPreferences::apply` does; store nothing equal to the effective default. Keep the "smart merge" that protects `2fa`. Session fallback when the store is unavailable, plus the browser-localStorage export/import/autoload offer (it is the only way session users carry settings across logins). |
| **Per-browser state** | cookies (`pma_lang`, theme, console), localStorage (`config`, favorites, console history) | Treat as cache/fallback only; on first contact with a user that has stored prefs, prefer the store and clear the cookie (as `getUserValue` does). |

Effective config resolution should stay: defaults <- server config <- user prefs (filtered) <- request overrides, with the server block (`only_db`/`hide_db`) merged into the *selected* server. Expose `baseSettings` (pre-prefs) so the UI can show "default from server config" vs "phpMyAdmin default" and so the upper-bound validators can read the admin's limits.

### Form metadata as data, not code

The whole Settings UI is derivable from three tables: field list per form (`Forms/User/*` + setup additions + page subsets), allowed values + input type per path (`getAllowedValues`), and labels/descriptions/comments (`Descriptions`). Model these as a single JSON schema-like registry: `{path, type, default, enum?, label, description, comment?, validators[], forms: {user: [tab, group], setup: [...], page: [...]}, userOverridable: bool}`. Generate the Settings pages, the page-settings popups, the setup pages, the client-side validators and the directive reference from it. Keep the `:group` semantics (header checkbox + dependants, labelled groups) because users recognise the layout.

### pmadb compatibility strategy

* **Read/write the existing `pma__*` tables as-is** when they are present and `ZeroConf`/explicit config points at them: every table is small, keyed naturally, and the semantics above are stable. This is the cheapest path to "works with my existing phpmyadmin database" and lets both tools coexist on one server.
* Hide the 19 tables behind a `MetadataStore` interface with one repository per feature (`BookmarkRepository`, `RelationRepository`, `DisplayFieldRepository`, `ColumnInfoRepository` (comments+mime), `HistoryRepository`, `RecentFavoriteRepository`, `TableUiPrefsRepository`, `TrackingRepository`, `UserConfigRepository`, `UserGroupRepository`, `NavigationHidingRepository`, `SavedSearchRepository`, `CentralColumnsRepository`, `DesignerSettingsRepository`, `ExportTemplateRepository`). Provide two drivers: `PmaDbDriver` (legacy schema, through a dedicated control connection, exactly the SQL phpMyAdmin issues) and a native driver (your own schema, e.g. SQLite/Postgres/local JSON). Feature availability becomes a capability bitmap identical to the `*work` flags so UI gating logic stays one-to-one.
* Keep the **control connection** concept: a separate credential set (`controluser`/`controlpass`, host/port/socket/SSL overrides with `control_*` precedence) used for every metadata read/write, never the end user's connection.
* Preserve data formats where other tools might read them: `recent`/`favorite` JSON `[{db,table}]`; `table_uiprefs.prefs` JSON `{CREATE_TIME,sorted_col,col_order,col_visib}`; `userconfig.config_data` flat JSON; `tracking.schema_snapshot` as PHP `serialize()` (write a decoder; when writing natively you may store JSON but keep a serialize writer for the legacy driver); `tracking.schema_sql/data_sql` log format with `# log <ts> <user>` lines; `usergroups.tab` ids `server_*`/`db_*`/`table_*`; `column_info` transformation plugin file names (`output/Text_Plain_Dateformat.php` style) - map them to your transformation ids but accept the legacy names on read.
* Reimplement the **auto-provisioning** flow: probe configured db -> `phpmyadmin` -> current db; detect tables by name; per-table access probe; "Create" actions for (a) new database, (b) in current database, (c) missing tables; status page listing every table/feature with OK/not OK; the same `column_info` 4.3 column upgrade. Honour `false` = disabled per table.
* **Relations**: always merge three sources in this order of precedence - internal relation (`pma__relation`), parsed `SHOW CREATE TABLE` foreign keys, hard-coded system-schema relations for `information_schema`/`mysql`. Display field: `table_info` -> hard-coded IS cases -> first char-class column. Keep `ForeignKeyMaxLimit`/`ForeignKeyDropdownOrder` semantics for dropdown vs. browse popup.
* **Comments**: native column comments only; database comment via the `(db_comment)` sentinel row if you keep the legacy driver (natively, store it as a proper db-level record but still read/write the sentinel through the pmadb driver).

### Two-factor

Store 2FA config inside the user-preferences document under `2fa` to remain compatible; refuse to enable 2FA when the preference store is session-only. Reimplement backends: TOTP (window 8, base32 secret, QR with label `phpMyAdmin (<host>)` or your product name), WebAuthn (userHandle + credentials map, rp id = request host, AppID fallback `PmaAbsoluteUri`), optionally U2F for reading legacy registrations (deprecated; at minimum detect `backend: key` and prompt to re-enrol). Keep the two-step configure flow and the re-verification before disable.

### Setup script equivalent

Reuse the same form registry to produce a first-run wizard: servers (basic, auth, server config, storage, tracking tabs), feature/security/import-export/developer/other-core tabs, and a "Configuration file" view/download with EOL choice. Port the `ServerConfigChecks` warnings (blowfish secret, arbitrary server, cookie validity, directories, zip functions, HTTPS) - they are the only guidance many admins get.

## Corrections from the rebuild (phpMyAdmin wins)

Observed in the reference while porting (golden tests in `tests/parity/preferences.parity.test.ts`: `pma__userconfig.config_data` byte for byte, the control-link writes and the serialised forms):

- **What a form save stores**: `UserPreferences::pageInit` loads every user-form field from the effective settings, so a save of one tab re-stores every value that differs from phpMyAdmin's default *or* from `config.inc.php`, plus browser artefacts: `FirstDayOfCalendar` has default `0` but its select starts at Monday, so the browser posts `1` and every Features save stores `"FirstDayOfCalendar":1`; the Main panel's `DefaultTransformations/*` textareas post strings, so a save stores `["0","all","…"]` for `[0,'all','…']` (and `TextImageLink` becomes `["100","50",50]` after a reload, array_replace_recursive keeping index 2 of the default). Keys outside the forms (`ThemeDefault`, `lang`) are dropped by a form save. Each save is followed by `TwoFactor::save`, which adds `"2fa":{"backend":"","settings":[],"type":"db"}` (with the read-back `type`). Page settings saves skip TwoFactor (the smart merge keeps an existing `2fa`). The mapped keys `Server/hide_db`, `Server/only_db` always come last.
- **hide_db / validateRegex** runs (PHP's error handler returns false, so `error_get_last()` sees the warning); the message is PCRE2's (`Compilation failed: missing closing parenthesis at offset 3`, `Unknown modifier 'b'`). It is not a JS validator: the client never checks it.
- **Server validators skip empty values**: `validateNumber` returns early on `empty()`, so `0` passes `validatePositiveNumber` server-side; the JS one rejects it. Integer fields are cast first (`settype`): `1.5` becomes `1` and passes.
- **JS validation runs on change only**: `setupValidation` tests `$el.attr('tagName')`, which is undefined, so the keyup validators are never bound; `registerFieldValidator` keeps only the first validator of a field (MaxDbList checks "positive", never the upper bound, in the browser).
- **Default marking compares strictly**: `data-default-values` holds the PHP default (`[25]` for MaxRows, `[0]` for FirstDayOfCalendar), the select's value is a string, so numeric selects are always marked `custom` with a visible restore link; restoring such a select leaves no option selected and the browser falls back to the first one.
- **Reset button** re-validates only: `$(this).closest('fieldset')` from the card footer finds no fields.
- **Page settings forms other than Navi** get no marking, restore links or client validation: config.ts reads `#configInlineParamsData` by id, i.e. the navigation settings' copy that comes first in the page.
- **Select labels**: Twig autoescapes the concatenated ` label="None"`, so an empty option's label is `"None"` with the quotes.
- **Manage › Import is broken in 6.0-dev**: every import ends in "Internal error: TypeError" (`FormDisplay::validateSelect(string|bool &$value)` receives the integer defaults that ManageController posts for every field). BetterMyAdmin implements the intended flow (sanitised as a post, merge, the two-step "Do you want to import remaining settings?"), processes every form instead of stopping at the first failing one, and does not count the defaults posted for absent keys (`FirstDayOfCalendar` 0, the split `TextImageLink` list) as errors of the file. Covered by `apps/server/test/int/preferences.test.ts`.
- **Export file name**: `Core::downloadHeader` sanitises the name, so `phpMyAdmin-config-127.0.0.1%3A8081.json` arrives as `phpMyAdmin-config-127.0.0.1_3A8081.json`.
- **Two-factor**: the reference checkout lacks `pragmarx/google2fa-qrcode`, `bacon/bacon-qr-code` and `code-lts/u2f-php-server`, so it offers none / WebAuthn (+ simple with `DBG.simple2fa`) and lists the missing packages. BetterMyAdmin has the Application backend (RFC 6238 TOTP like Google2FA, window 8, 16-char base32 secret kept in the session until verified, otpauth label `phpMyAdmin (<HTTP_HOST>)`, the QR matrix of bacon's encoder: byte mode, level L, minimal version, lowest-penalty mask) and WebAuthn (CustomServer: `none` attestation only; an assertion needs a valid signature by the registered COSE key). U2F (`key`) is not offered (the FIDO U2F JS API is gone from browsers) and stays in the missing list. The login step asks for the second factor after the password (`AuthState.twoFactorPending`); a session holds `twoFactorOk` per server.
- **Unclosed markup**: `preferences/header.twig` leaves `div.container-fluid` open, so the footer's `#selflink` ends up inside `#page_content` on these pages.

BetterMyAdmin additions: preferences in the local metadata store (`DataDir`) count as permanent storage (no session notice, two-factor enabled); `/api/meta/config-public` returns the configuration with the current server's applied preferences.

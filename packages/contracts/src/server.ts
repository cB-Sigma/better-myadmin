import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// Tab keys — phpMyAdmin's keys verbatim (src/Menu.php, Util::getMenuTabList); user groups store
// them as `<level>_<key>` in pma__usergroups.tab.
// ---------------------------------------------------------------------------------------------

export const ServerTabKey = z.enum([
  'databases',
  'sql',
  'status',
  'rights',
  'export',
  'import',
  'settings',
  'binlog',
  'replication',
  'vars',
  'charset',
  'engine',
  'plugins',
])
export type ServerTabKey = z.infer<typeof ServerTabKey>

export const DbTabKey = z.enum([
  'structure',
  'sql',
  'search',
  'query',
  'export',
  'import',
  'operation',
  'privileges',
  'routines',
  'events',
  'triggers',
  'tracking',
  'designer',
  'central_columns',
])
export type DbTabKey = z.infer<typeof DbTabKey>

export const TableTabKey = z.enum([
  'browse',
  'structure',
  'sql',
  'search',
  'insert',
  'export',
  'import',
  'privileges',
  'operation',
  'tracking',
  'triggers',
])
export type TableTabKey = z.infer<typeof TableTabKey>

/** A visible tab; `warning` is the data-only "Database seems to be empty!" of Menu::getDbTabs. */
export const Tab = <K extends z.ZodTypeAny>(key: K) => z.object({ key, warning: z.string().optional() })

// ---------------------------------------------------------------------------------------------
// GET /api/servers/:s — server scope payload for the shell (breadcrumb, title, tabs)
// ---------------------------------------------------------------------------------------------

export const ServerCapabilities = z.object({
  /** DatabaseInterface::isSuperUser (`SELECT 1 FROM mysql.user LIMIT 1`) */
  isSuperUser: z.boolean(),
  /** DatabaseInterface::isGrantUser */
  isGrantUser: z.boolean(),
  /** DatabaseInterface::isCreateUser (only evaluated when isGrantUser is false, like Menu.php) */
  isCreateUser: z.boolean(),
  /** `SHOW BINARY LOGS` returned rows */
  hasBinaryLogs: z.boolean(),
  /** Tracker::isActive() */
  trackerActive: z.boolean(),
  /** relation parameters: central columns / column comments / configurable menus configured */
  centralColumns: z.boolean(),
  columnComments: z.boolean(),
  configurableMenus: z.boolean(),
  /** `CURRENT_USER()` split at '@' */
  currentUser: z.tuple([z.string(), z.string()]),
})
export type ServerCapabilities = z.infer<typeof ServerCapabilities>

export const ServerScope = z.object({
  index: z.number().int().positive(),
  /** Breadcrumb name: `verbose` or `host`, then `:port` when a port is configured (Menu::getBreadcrumbs). */
  name: z.string(),
  host: z.string(),
  verbose: z.string(),
  authType: z.enum(['cookie', 'config', 'http', 'signon']),
  version: z.string(),
  versionInt: z.number().int(),
  versionComment: z.string(),
  isMariaDb: z.boolean(),
  capabilities: ServerCapabilities,
  /** Visible server tabs after privilege checks and user-group filtering, in phpMyAdmin's order. */
  tabs: z.array(Tab(ServerTabKey)),
  /** BetterMyAdmin version for `@PHPMYADMIN@` in page titles. */
  appVersion: z.string(),
})
export type ServerScope = z.infer<typeof ServerScope>

// ---------------------------------------------------------------------------------------------
// GET /api/servers/:s/databases/:db — database scope (tab bar, breadcrumb comment)
// ---------------------------------------------------------------------------------------------

export const DatabaseScope = z.object({
  db: z.string(),
  /** pmadb `(db_comment)` when the column-comments feature is configured, else '' */
  comment: z.string(),
  /** Utilities::isSystemSchema (information_schema, performance_schema, sys — not mysql) */
  isSystemSchema: z.boolean(),
  numTables: z.number().int(),
  tabs: z.array(Tab(DbTabKey)),
})
export type DatabaseScope = z.infer<typeof DatabaseScope>

// ---------------------------------------------------------------------------------------------
// GET /api/servers/:s/databases/:db/tables/:t/capabilities — table scope
// ---------------------------------------------------------------------------------------------

export const TableScope = z.object({
  db: z.string(),
  table: z.string(),
  isView: z.boolean(),
  isUpdatableView: z.boolean(),
  /** Table comment with `; InnoDB free: …` stripped; '' for views */
  comment: z.string(),
  isSystemSchema: z.boolean(),
  tabs: z.array(Tab(TableTabKey)),
})
export type TableScope = z.infer<typeof TableScope>

// ---------------------------------------------------------------------------------------------
// GET /api/servers/:s/home — the blocks of HomeController
// ---------------------------------------------------------------------------------------------

export const Collation = z.object({ name: z.string(), description: z.string() })
export const CharsetWithCollations = z.object({
  name: z.string(),
  description: z.string(),
  collations: z.array(Collation),
})

export const HomeWarning = z.object({
  severity: z.enum(['warning', 'notice']),
  /** BBCode as phpMyAdmin stores it ([a@url@target], [doc@page], [code]); the client sanitises it. */
  message: z.string(),
})
export type HomeWarning = z.infer<typeof HomeWarning>

/** A commit's author or committer (pma: Git::extractDataFormTextBody). */
export const GitUser = z.object({ name: z.string(), email: z.string(), date: z.string() })
export type GitUser = z.infer<typeof GitUser>

export const HomeResponse = z.object({
  /** `Select::render` in the General settings card (ServerDefault = 0, or several servers + NavigationDisplayServers) */
  hasServerSelection: z.boolean(),
  /** DisplayServersList: the selection is a list of links instead of a select */
  displayServersList: z.boolean(),
  /** auth_type !== 'config' && ShowChgPassword */
  hasChangePasswordLink: z.boolean(),
  collation: z.object({
    /** The `selected` option: DatabaseInterface::getDefaultCollation() (quirk Q42) */
    selected: z.string(),
    /** The connection collation actually in effect (DefaultConnectionCollation) */
    current: z.string(),
    charsets: z.array(CharsetWithCollations),
  }),
  databaseServer: z
    .object({
      host: z.string(),
      hostname: z.string(),
      type: z.string(),
      connection: z.object({ message: z.string(), danger: z.boolean() }),
      version: z.string(),
      user: z.string(),
      charset: z.string(),
    })
    .nullable(),
  webServer: z
    .object({
      software: z.string().nullable(),
      database: z.string(),
      modules: z.array(z.object({ name: z.string(), url: z.string() })),
      runtimeVersion: z.string(),
    })
    .nullable(),
  showPhpInfo: z.boolean(),
  versionCheck: z.boolean(),
  app: z.object({
    name: z.string(),
    version: z.string(),
    git: z
      .object({
        hash: z.string(),
        branch: z.string().nullable(),
        message: z.string().nullable(),
        /** home/git_info.twig "committed on %s by %s" / "authored on %s by %s" (loose commit objects) */
        author: GitUser.nullable(),
        committer: GitUser.nullable(),
      })
      .nullable(),
  }),
  warnings: z.array(HomeWarning),
  /** "The phpMyAdmin configuration storage is not completely configured…" (error when pmadb is set) */
  configStorageMessage: z.object({ type: z.enum(['notice', 'error']), zeroConf: z.boolean() }).nullable(),
  /** "You were logged out from one server, …" once after a partial logout */
  partialLogout: z.boolean(),
})
export type HomeResponse = z.infer<typeof HomeResponse>

// ---------------------------------------------------------------------------------------------
// POST /api/servers/:s/session/collation   (pma: /collation-connection)
// ---------------------------------------------------------------------------------------------

export const SetCollationRequest = z.object({ collation_connection: z.string() })
export const SetCollationResponse = z.object({ ok: z.literal(true), collation: z.string() })
export type SetCollationResponse = z.infer<typeof SetCollationResponse>

// ---------------------------------------------------------------------------------------------
// GET/POST /api/servers/:s/account/password   (pma: /user-password)
// ---------------------------------------------------------------------------------------------

export const PasswordForm = z.object({
  username: z.string(),
  /** Privileges::getCurrentAuthenticationPlugin('', '') — the preselected hashing option */
  origAuthPlugin: z.string(),
  /** `not is_new or (is_new and has_more_auth_plugins)` → the "Password Hashing:" row */
  showHashing: z.boolean(),
  /** sha256 SSL notice block exists (is_new and has_more_auth_plugins) */
  showSslNotice: z.boolean(),
  authPlugins: z.array(z.object({ name: z.string(), description: z.string() })),
  allowNoPassword: z.boolean(),
})
export type PasswordForm = z.infer<typeof PasswordForm>

export const ChangePasswordRequest = z.object({
  /** nopass=1 → "No Password" */
  nopass: z.boolean(),
  pma_pw: z.string().default(''),
  pma_pw2: z.string().default(''),
  authentication_plugin: z.string().optional(),
})
export type ChangePasswordRequest = z.input<typeof ChangePasswordRequest>

export const ChangePasswordResponse = z.object({
  ok: z.literal(true),
  /** "The profile has been updated." */
  message: z.string(),
  /** The statement shown under the message, password masked as '***' */
  sql: z.string(),
})
export type ChangePasswordResponse = z.infer<typeof ChangePasswordResponse>

// ---------------------------------------------------------------------------------------------
// POST /api/telemetry/error   (pma: /error-report)
// ---------------------------------------------------------------------------------------------

export const ErrorReportRequest = z.object({
  exception_type: z.enum(['js', 'php']),
  get_settings: z.boolean().optional(),
  send_error_report: z.boolean().optional(),
  automatic: z.boolean().optional(),
  always_send: z.boolean().optional(),
  description: z.string().optional(),
  exception: z.unknown().optional(),
  url: z.string().optional(),
})
export type ErrorReportRequest = z.input<typeof ErrorReportRequest>

export const ErrorReportResponse = z.object({
  report_setting: z.enum(['ask', 'always', 'never']).optional(),
  /** The report payload shown in the modal ("You may examine the data in the error report:") */
  report: z.record(z.unknown()).optional(),
  message: z.object({ type: z.enum(['notice', 'error']), text: z.string() }).optional(),
})
export type ErrorReportResponse = z.infer<typeof ErrorReportResponse>

// ---------------------------------------------------------------------------------------------
// GET /api/meta/version-check
// ---------------------------------------------------------------------------------------------

export const VersionCheckResponse = z.union([
  z.object({}).strict(),
  z.object({ version: z.string(), date: z.string() }),
])
export type VersionCheckResponse = z.infer<typeof VersionCheckResponse>

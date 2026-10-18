/**
 * Every `$cfg` directive understood by phpMyAdmin, under its phpMyAdmin name, plus the
 * BetterMyAdmin additions (flagged `bma`).
 *
 * pma: src/Config/Settings.php::asArray (order of keys below follows it)
 * Reference: docs/reference/config-directives.md
 *
 * Validation is stricter than phpMyAdmin: its setters silently replace invalid values by the
 * default (e.g. `MaxRows = 0` -> 25, unknown `GridEditing` -> 'double-click'); we reject them
 * with a readable error instead. Legacy spellings that phpMyAdmin *maps* (e.g.
 * `DefaultTabTable = 'browse'` -> `/sql`, `RecodingEngine = 'mb'` -> `mbstring`,
 * `TablePrimaryKeyOrder = 'asc'` -> `ASC`) are accepted and normalised the same way.
 */
import { z } from 'zod'
import {
  type AnyNode,
  type GroupNode,
  type In,
  type Out,
  assignPaths,
  bool,
  cBool,
  cInt,
  cStr,
  custom,
  eBool,
  eJson,
  group,
  int,
  isIntKeyedObject,
  leaves,
  list,
  nbool,
  nstr,
  oneOf,
  optional,
  port,
  record,
  servers,
  str,
  table,
  toZod,
  tuple,
} from './nodes.ts'

// ---------------------------------------------------------------------------
// Shared value lists
// ---------------------------------------------------------------------------

const STRUCTURE_OR_DATA = ['structure', 'data', 'structure_and_data'] as const
const SQL_COMPATIBILITY = [
  'NONE',
  'ANSI',
  'DB2',
  'MAXDB',
  'MYSQL323',
  'MYSQL40',
  'MSSQL',
  'ORACLE',
  'TRADITIONAL',
] as const
const LINK_MODES = ['icons', 'text', 'both'] as const
const ORIENTATION = ['L', 'P'] as const

// pma: src/Config/Settings.php::setDefaultTabTable / setNavigationTreeDefaultTabTable
const TABLE_TABS = ['/table/structure', '/table/sql', '/table/search', '/table/change', '/sql'] as const
const TABLE_TAB_LEGACY = {
  structure: '/table/structure',
  'tbl_structure.php': '/table/structure',
  sql: '/table/sql',
  'tbl_sql.php': '/table/sql',
  search: '/table/search',
  'tbl_select.php': '/table/search',
  insert: '/table/change',
  'tbl_change.php': '/table/change',
  browse: '/sql',
  'sql.php': '/sql',
} as const

const structureOrData = (def: (typeof STRUCTURE_OR_DATA)[number]) => oneOf(STRUCTURE_OR_DATA, def)

const boolOrString = (raw: string): unknown => {
  try {
    return eBool(raw)
  } catch {
    return raw
  }
}

// ---------------------------------------------------------------------------
// Servers[$i]
// pma: src/Config/Settings/Server.php
// ---------------------------------------------------------------------------

export const serverNode = group({
  // Connection
  host: str('localhost'),
  port: port(''),
  socket: str(''),
  ssl: bool(false),
  ssl_key: nstr(),
  ssl_cert: nstr(),
  ssl_ca: nstr(),
  ssl_ca_path: nstr(),
  ssl_ciphers: nstr(),
  ssl_verify: bool(true),
  compress: bool(false),
  // Control connection (pma: Server.php::setControlHost etc. accept the legacy aliases)
  controlhost: str('', { aliases: ['control_host'] }),
  controlport: port('', { aliases: ['control_port'] }),
  controluser: str('', { aliases: ['control_user'] }),
  controlpass: str('', { secret: true, aliases: ['control_pass', 'control_password'] }),
  control_socket: nstr(),
  control_ssl: nbool(),
  control_ssl_key: nstr(),
  control_ssl_cert: nstr(),
  control_ssl_ca: nstr(),
  control_ssl_ca_path: nstr(),
  control_ssl_ciphers: nstr(),
  control_ssl_verify: nbool(),
  control_compress: nbool(),
  control_hide_connection_errors: nbool(),
  // Authentication
  auth_type: oneOf(['cookie', 'config', 'http', 'signon'], 'cookie'),
  auth_http_realm: str(''),
  user: str('root'),
  password: str('', { secret: true }),
  SignonSession: str(''),
  // pma: Server.php::setSignonCookieParams
  SignonCookieParams: group({
    lifetime: int(0, { min: 0 }),
    path: str('/'),
    domain: str(''),
    secure: bool(false),
    httponly: bool(false),
    samesite: optional('enum', z.enum(['Lax', 'Strict']), { values: ['Lax', 'Strict'], fromEnv: (r) => r }),
  }),
  SignonScript: str(''),
  SignonURL: str(''),
  LogoutURL: str(''),
  // Visibility
  // pma: Server.php::setOnlyDb (an empty array means '')
  only_db: custom('mixed', z.union([z.string(), z.array(z.string())]), '', {
    coerce: (v) => (Array.isArray(v) ? (v.length === 0 ? '' : v.map(cStr)) : cStr(v)),
    fromEnv: (raw) => (raw.trim().startsWith('[') ? eJson(raw) : raw),
    description: 'a database name pattern or a list of them',
  }),
  hide_db: str(''),
  verbose: str(''),
  // Configuration storage
  pmadb: str(''),
  bookmarktable: table(),
  relation: table(),
  table_info: table(),
  table_coords: table(),
  pdf_pages: table(),
  column_info: table(),
  history: table(),
  recent: table(),
  favorite: table(),
  table_uiprefs: table(),
  tracking: table(),
  userconfig: table(),
  users: table(),
  usergroups: table(),
  navigationhiding: table(),
  savedsearches: table(),
  central_columns: table(),
  designer_settings: table(),
  export_templates: table(),
  MaxTableUiprefs: int(100, { min: 1 }),
  SessionTimeZone: str(''),
  AllowRoot: bool(true),
  AllowNoPassword: bool(false),
  // pma: Server.php::setAllowDeny
  AllowDeny: group({
    order: oneOf(['', 'deny,allow', 'allow,deny', 'explicit'], ''),
    rules: list([]),
  }),
  DisableIS: bool(false),
  tracking_version_auto_create: bool(false),
  tracking_default_statements: str(
    'CREATE TABLE,ALTER TABLE,DROP TABLE,RENAME TABLE,CREATE INDEX,DROP INDEX,INSERT,UPDATE,DELETE,TRUNCATE,REPLACE,CREATE VIEW,ALTER VIEW,DROP VIEW,CREATE DATABASE,ALTER DATABASE,DROP DATABASE',
  ),
  tracking_add_drop_view: bool(true),
  tracking_add_drop_table: bool(true),
  tracking_add_drop_database: bool(true),
  hide_connection_errors: bool(false),
  // BetterMyAdmin: mysql2 pool connectionLimit per (session, server)
  max_connections: int(4, { min: 1, bma: true }),
})

// ---------------------------------------------------------------------------
// $cfg['Export']  pma: src/Config/Settings/Export.php
// ---------------------------------------------------------------------------

const exportNode = group({
  format: oneOf(
    [
      'sql',
      'codegen',
      'csv',
      'excel',
      'htmlword',
      'json',
      'latex',
      'mediawiki',
      'ods',
      'odt',
      'pdf',
      'phparray',
      'texytext',
      'xml',
      'yaml',
    ],
    'sql',
  ),
  method: oneOf(['quick', 'custom', 'custom-no-form'], 'quick'),
  compression: oneOf(['none', 'zip', 'gzip'], 'none'),
  lock_tables: bool(false),
  as_separate_files: bool(false),
  asfile: bool(true),
  charset: str(''),
  onserver: bool(false),
  onserver_overwrite: bool(false),
  quick_export_onserver: bool(false),
  quick_export_onserver_overwrite: bool(false),
  remember_file_template: bool(true),
  file_template_table: str('@TABLE@'),
  file_template_database: str('@DATABASE@'),
  file_template_server: str('@SERVER@'),
  codegen_structure_or_data: structureOrData('data'),
  codegen_format: custom('enum', z.union([z.literal(0), z.literal(1)]), 0, {
    values: [0, 1],
    coerce: cInt,
    fromEnv: (r) => Number(r),
  }),
  ods_columns: bool(true),
  ods_null: str('NULL'),
  odt_structure_or_data: structureOrData('structure_and_data'),
  odt_columns: bool(true),
  odt_relation: bool(true),
  odt_comments: bool(true),
  odt_mime: bool(true),
  odt_null: str('NULL'),
  htmlword_structure_or_data: structureOrData('structure_and_data'),
  htmlword_columns: bool(false),
  htmlword_null: str('NULL'),
  texytext_structure_or_data: structureOrData('structure_and_data'),
  texytext_columns: bool(false),
  texytext_null: str('NULL'),
  csv_columns: bool(true),
  csv_structure_or_data: structureOrData('data'),
  csv_null: str('NULL'),
  csv_separator: str(','),
  csv_enclosed: str('"'),
  csv_escaped: str('"'),
  csv_terminated: str('AUTO'),
  csv_removeCRLF: bool(false),
  toon_indent: int(2),
  toon_separator: str(','),
  toon_structure_or_data: structureOrData('structure_and_data'),
  excel_columns: bool(true),
  excel_null: str('NULL'),
  excel_edition: oneOf(['win', 'mac_excel2003', 'mac_excel2008'], 'win'),
  excel_removeCRLF: bool(false),
  excel_structure_or_data: structureOrData('data'),
  latex_structure_or_data: structureOrData('structure_and_data'),
  latex_columns: bool(true),
  latex_relation: bool(true),
  latex_comments: bool(true),
  latex_mime: bool(true),
  latex_null: str('\\textit{NULL}'),
  latex_caption: bool(true),
  latex_structure_caption: str('strLatexStructure'),
  latex_structure_continued_caption: str('strLatexStructure strLatexContinued'),
  latex_data_caption: str('strLatexContent'),
  latex_data_continued_caption: str('strLatexContent strLatexContinued'),
  latex_data_label: str('tab:@TABLE@-data'),
  latex_structure_label: str('tab:@TABLE@-structure'),
  mediawiki_structure_or_data: structureOrData('data'),
  mediawiki_caption: bool(true),
  mediawiki_headers: bool(true),
  ods_structure_or_data: structureOrData('data'),
  pdf_structure_or_data: structureOrData('data'),
  phparray_structure_or_data: structureOrData('data'),
  json_structure_or_data: structureOrData('data'),
  json_pretty_print: bool(false),
  json_unicode: bool(true),
  sql_structure_or_data: structureOrData('structure_and_data'),
  sql_compatibility: oneOf(SQL_COMPATIBILITY, 'NONE'),
  sql_include_comments: bool(true),
  sql_disable_fk: bool(false),
  sql_views_as_tables: bool(false),
  sql_metadata: bool(false),
  sql_use_transaction: bool(true),
  sql_create_database: bool(false),
  sql_drop_database: bool(false),
  sql_drop_table: bool(false),
  sql_if_not_exists: bool(false),
  sql_view_current_user: bool(false),
  sql_or_replace_view: bool(false),
  sql_procedure_function: bool(true),
  sql_create_table: bool(true),
  sql_create_view: bool(true),
  sql_create_trigger: bool(true),
  sql_auto_increment: bool(true),
  sql_backquotes: bool(true),
  sql_dates: bool(false),
  sql_relation: bool(false),
  sql_truncate: bool(false),
  sql_delayed: bool(false),
  sql_ignore: bool(false),
  sql_utc_time: bool(true),
  sql_hex_for_binary: bool(true),
  sql_type: oneOf(['INSERT', 'UPDATE', 'REPLACE'], 'INSERT'),
  sql_max_query_size: int(50000, { min: 0 }),
  sql_mime: bool(false),
  sql_header_comment: str(''),
  sql_insert_syntax: oneOf(['both', 'complete', 'extended', 'none'], 'both'),
  pdf_report_title: str(''),
  xml_structure_or_data: structureOrData('data'),
  xml_export_struc: bool(true),
  xml_export_events: bool(true),
  xml_export_functions: bool(true),
  xml_export_procedures: bool(true),
  xml_export_tables: bool(true),
  xml_export_triggers: bool(true),
  xml_export_views: bool(true),
  xml_export_contents: bool(true),
  yaml_structure_or_data: structureOrData('data'),
  remove_definer_from_definitions: bool(false),
  // BetterMyAdmin (parity exception X3): prefix CSV/Excel cells starting with = + - @
  csv_escape_formulas: bool(false, { bma: true }),
})

// ---------------------------------------------------------------------------
// $cfg['Import']  pma: src/Config/Settings/Import.php
// ---------------------------------------------------------------------------

const importNode = group({
  format: oneOf(['sql', 'csv', 'docsql', 'ldi'], 'sql'),
  charset: str(''),
  allow_interrupt: bool(true),
  skip_queries: int(0, { min: 0 }),
  sql_compatibility: oneOf(SQL_COMPATIBILITY, 'NONE'),
  sql_no_auto_value_on_zero: bool(true),
  sql_read_as_multibytes: bool(false),
  csv_replace: bool(false),
  csv_ignore: bool(false),
  csv_empty_as_null: bool(false),
  csv_terminated: str(','),
  csv_enclosed: str('"'),
  csv_escaped: str('"'),
  csv_new_line: str('auto'),
  csv_columns: str(''),
  csv_col_names: bool(false),
  ldi_replace: bool(false),
  ldi_ignore: bool(false),
  ldi_terminated: str(';'),
  ldi_enclosed: str('"'),
  ldi_escaped: str('\\'),
  ldi_new_line: str('auto'),
  ldi_columns: str(''),
  // pma: Import.php::setLdiLocalOption ('auto' or a bool)
  ldi_local_option: custom('mixed', z.union([z.literal('auto'), z.boolean()]), 'auto', {
    values: ['auto', true, false],
    coerce: (v) => (v === 'auto' ? v : cBool(v)),
    fromEnv: boolOrString,
  }),
  ods_col_names: bool(false),
  ods_empty_rows: bool(true),
  ods_recognize_percentages: bool(true),
  ods_recognize_currency: bool(true),
  // BetterMyAdmin: streamed decompression output cap in bytes; 0 = 10 x MaxUploadSize
  MaxDecompressedSize: int(0, { min: 0, bma: true }),
})

// ---------------------------------------------------------------------------
// $cfg['Schema']  pma: src/Config/Settings/Schema.php
// ---------------------------------------------------------------------------

const schemaNode = group({
  format: oneOf(['pdf', 'eps', 'dia', 'svg'], 'pdf'),
  pdf_show_color: bool(true),
  pdf_show_keys: bool(false),
  pdf_all_tables_same_width: bool(false),
  pdf_orientation: oneOf(ORIENTATION, 'L'),
  pdf_paper: str('A4'),
  pdf_show_grid: bool(false),
  pdf_with_doc: bool(true),
  pdf_table_order: oneOf(['', 'name_asc', 'name_desc'], ''),
  dia_show_color: bool(true),
  dia_show_keys: bool(false),
  dia_orientation: oneOf(ORIENTATION, 'L'),
  dia_paper: str('A4'),
  eps_show_color: bool(true),
  eps_show_keys: bool(false),
  eps_all_tables_same_width: bool(false),
  eps_orientation: oneOf(ORIENTATION, 'L'),
  svg_show_color: bool(true),
  svg_show_keys: bool(false),
  svg_all_tables_same_width: bool(false),
})

// ---------------------------------------------------------------------------
// $cfg['DefaultTransformations']  pma: src/Config/Settings/Transformations.php
// ---------------------------------------------------------------------------

const nonNegInt = z.number().int().min(0)
const allOrInt = (v: unknown): unknown => (v === 'all' ? v : cInt(v))

const transformationsNode = group({
  Substring: tuple(
    z.tuple([z.number().int(), z.union([z.literal('all'), z.number().int()]), z.string()]),
    [0, 'all', '…'],
    [cInt, allOrInt, cStr],
  ),
  Bool2Text: tuple(z.tuple([z.string(), z.string()]), ['T', 'F'], [cStr, cStr]),
  External: tuple(
    z.tuple([z.number().int(), z.string(), z.number().int(), z.number().int()]),
    [0, '-f /dev/null -i -wrap -q', 1, 1],
    [cInt, cStr, cInt, cInt],
  ),
  PreApPend: tuple(z.tuple([z.string(), z.string()]), ['', ''], [cStr, cStr]),
  Hex: tuple(z.tuple([nonNegInt]), [2], [cInt]),
  DateFormat: tuple(
    z.tuple([nonNegInt, z.string(), z.enum(['local', 'utc'])]),
    [0, '', 'local'],
    [cInt, cStr, cStr],
  ),
  // pma: Transformations.php::setInline (mixed int/string keys)
  Inline: group({
    0: int(100, { min: 0 }),
    1: int(100, { min: 0 }),
    wrapper_link: nstr(),
    wrapper_params: record({}),
  }),
  TextImageLink: tuple(
    z.tuple([z.string().nullable(), nonNegInt, nonNegInt]),
    [null, 100, 50],
    [cStr, cInt, cInt],
  ),
  TextLink: tuple(
    z.tuple([z.string().nullable(), z.string().nullable(), z.boolean().nullable()]),
    [null, null, null],
    [cStr, cStr, cBool],
  ),
})

// ---------------------------------------------------------------------------
// Top level  pma: src/Config/Settings.php
// ---------------------------------------------------------------------------

export const configNode = group({
  PmaAbsoluteUri: str(''),
  AuthLog: str('auto'),
  AuthLogSuccess: bool(false),
  PmaNoRelation_DisableWarning: bool(false),
  LoginCookieValidityDisableWarning: bool(false),
  ReservedWordDisableWarning: bool(false),
  TranslationWarningThreshold: int(80, { min: 0, max: 100 }),
  AllowThirdPartyFraming: custom('mixed', z.union([z.boolean(), z.literal('sameorigin')]), false, {
    values: [true, false, 'sameorigin'],
    coerce: (v) => (v === 'sameorigin' ? v : cBool(v)),
    fromEnv: boolOrString,
  }),
  blowfish_secret: str('', { secret: true, aliases: ['secret'] }),
  Servers: servers(serverNode),
  ServerDefault: int(1, { min: 0 }),
  VersionCheck: bool(true),
  ProxyUrl: str(''),
  ProxyUser: str(''),
  ProxyPass: str('', { secret: true }),
  MaxDbList: int(100, { min: 1 }),
  MaxTableList: int(250, { min: 1 }),
  MaxRoutineList: int(250, { min: 1 }),
  ShowHint: bool(true),
  MaxCharactersInDisplayedSQL: int(1000, { min: 1 }),
  PersistentConnections: bool(false),
  ExecTimeLimit: int(300, { min: 0 }),
  SessionSavePath: str(''),
  MysqlSslWarningSafeHosts: list(['127.0.0.1', 'localhost']),
  MemoryLimit: str('-1'),
  SkipLockedTables: bool(false),
  ShowSQL: bool(true),
  RetainQueryBox: bool(false),
  CodemirrorEnable: bool(true),
  LintEnable: bool(true),
  AllowUserDropDatabase: bool(false),
  Confirm: bool(true),
  CookieSameSite: oneOf(['Strict', 'Lax', 'None'], 'Strict'),
  LoginCookieRecall: bool(true),
  LoginCookieValidity: int(1440, { min: 1 }),
  LoginCookieStore: int(0, { min: 0 }),
  LoginCookieDeleteAll: bool(true),
  UseDbSearch: bool(true),
  IgnoreMultiSubmitErrors: bool(false),
  URLQueryEncryption: bool(false),
  URLQueryEncryptionSecretKey: str('', { secret: true }),
  AllowArbitraryServer: bool(false),
  ArbitraryServerRegexp: str(''),
  CaptchaMethod: oneOf(['invisible', 'checkbox'], 'invisible'),
  CaptchaApi: str('https://www.google.com/recaptcha/api.js'),
  CaptchaCsp: str(
    'https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://ssl.gstatic.com/',
  ),
  CaptchaRequestParam: str('g-recaptcha'),
  CaptchaResponseParam: str('g-recaptcha-response'),
  CaptchaLoginPublicKey: str(''),
  CaptchaLoginPrivateKey: str('', { secret: true }),
  CaptchaSiteVerifyURL: str(''),
  enable_drag_drop_import: bool(true),
  ShowDatabasesNavigationAsTree: bool(true),
  FirstLevelNavigationItems: int(100, { min: 1 }),
  MaxNavigationItems: int(50, { min: 1 }),
  NavigationTreeEnableGrouping: bool(true),
  NavigationTreeDbSeparator: str('_'),
  // pma: Settings.php::setNavigationTreeTableSeparator (false | string | non-empty string[])
  NavigationTreeTableSeparator: custom(
    'mixed',
    z.union([z.literal(false), z.string(), z.array(z.string()).min(1)]),
    '__',
    {
      coerce: (v) =>
        Array.isArray(v)
          ? v.length === 0
            ? '__'
            : v.map(cStr)
          : isIntKeyedObject(v)
            ? Object.values(v).map(cStr)
            : v === false
              ? v
              : cStr(v),
      fromEnv: (raw) => (raw.trim() === 'false' ? false : raw.trim().startsWith('[') ? eJson(raw) : raw),
      description: 'false, a string or a non-empty list of strings',
    },
  ),
  NavigationTreeTableLevel: int(1, { min: 1 }),
  NavigationLinkWithMainPanel: bool(true),
  NavigationDisplayLogo: bool(true),
  NavigationLogoLink: str('index.php'),
  NavigationLogoLinkWindow: oneOf(['main', 'new'], 'main'),
  NumRecentTables: int(10, { min: 0 }),
  NumFavoriteTables: int(10, { min: 0 }),
  NavigationTreeDisplayItemFilterMinimum: int(30, { min: 1 }),
  NavigationDisplayServers: bool(true),
  DisplayServersList: bool(false),
  NavigationTreeDisplayDbFilterMinimum: int(30, { min: 1 }),
  NavigationTreeDefaultTabTable: oneOf(TABLE_TABS, '/table/structure', { legacy: TABLE_TAB_LEGACY }),
  NavigationTreeDefaultTabTable2: oneOf(['', ...TABLE_TABS], '', { legacy: TABLE_TAB_LEGACY }),
  NavigationTreeEnableExpansion: bool(true),
  NavigationTreeShowTables: bool(true),
  NavigationTreeShowViews: bool(true),
  NavigationTreeShowFunctions: bool(true),
  NavigationTreeShowProcedures: bool(true),
  NavigationTreeShowEvents: bool(true),
  NavigationWidth: int(240, { min: 0 }),
  NavigationTreeAutoexpandSingleDb: bool(true),
  ShowStats: bool(true),
  ShowPhpInfo: bool(false),
  ShowServerInfo: custom('mixed', z.union([z.boolean(), z.enum(['database-server', 'web-server'])]), true, {
    values: [true, false, 'database-server', 'web-server'],
    coerce: (v) => (typeof v === 'string' && v !== '0' && v !== '1' && v !== '' ? v : cBool(v)),
    fromEnv: boolOrString,
  }),
  ShowChgPassword: bool(true),
  ShowCreateDb: bool(true),
  ShowDbStructureCharset: bool(false),
  ShowDbStructureComment: bool(false),
  ShowDbStructureCreation: bool(false),
  ShowDbStructureLastUpdate: bool(false),
  ShowDbStructureLastCheck: bool(false),
  HideStructureActions: bool(true),
  ShowColumnComments: bool(true),
  TableNavigationLinksMode: oneOf(LINK_MODES, 'icons'),
  ShowAll: bool(false),
  MaxRows: int(25, { min: 1 }),
  Order: oneOf(['SMART', 'ASC', 'DESC'], 'SMART'),
  SaveCellsAtOnce: bool(false),
  GridEditing: oneOf(['double-click', 'click', 'disabled'], 'double-click'),
  RelationalDisplay: oneOf(['K', 'D'], 'K'),
  ProtectBinary: custom('mixed', z.union([z.literal(false), z.enum(['blob', 'noblob', 'all'])]), 'blob', {
    values: [false, 'blob', 'noblob', 'all'],
    coerce: (v) => (v === 0 || v === '0' || v === '' ? false : v),
    fromEnv: (raw) => (raw.trim().toLowerCase() === 'false' || raw.trim() === '0' ? false : raw),
  }),
  ShowFunctionFields: bool(true),
  ShowFieldTypesInDataEditView: bool(true),
  CharEditing: oneOf(['input', 'textarea'], 'input'),
  MinSizeForInputField: int(4, { min: 0 }),
  MaxSizeForInputField: int(60, { min: 1 }),
  InsertRows: int(2, { min: 1 }),
  // pma: Settings.php::setForeignKeyDropdownOrder (one or two entries)
  ForeignKeyDropdownOrder: custom(
    'string-list',
    z
      .array(z.enum(['content-id', 'id-content']))
      .min(1)
      .max(2),
    ['content-id', 'id-content'],
    {
      values: ['content-id', 'id-content'],
      fromEnv: (raw) => (raw.trim().startsWith('[') ? eJson(raw) : raw.split(',').map((s) => s.trim())),
    },
  ),
  ForeignKeyMaxLimit: int(100, { min: 1 }),
  DefaultForeignKeyChecks: oneOf(['default', 'enable', 'disable'], 'default'),
  ZipDump: bool(true),
  GZipDump: bool(true),
  BZipDump: bool(true),
  CompressOnFly: bool(true),
  TabsMode: oneOf(LINK_MODES, 'both'),
  ActionLinksMode: oneOf(LINK_MODES, 'both'),
  PropertiesNumColumns: int(1, { min: 1 }),
  // pma: Settings.php::setDefaultTabServer
  DefaultTabServer: oneOf(
    ['/', '/server/databases', '/server/status', '/server/variables', '/server/privileges'],
    '/',
    {
      legacy: {
        welcome: '/',
        'index.php': '/',
        databases: '/server/databases',
        'server_databases.php': '/server/databases',
        status: '/server/status',
        'server_status.php': '/server/status',
        variables: '/server/variables',
        'server_variables.php': '/server/variables',
        privileges: '/server/privileges',
        'server_privileges.php': '/server/privileges',
      },
    },
  ),
  // pma: Settings.php::setDefaultTabDatabase
  DefaultTabDatabase: oneOf(
    ['/database/structure', '/database/sql', '/database/search', '/database/operations'],
    '/database/structure',
    {
      legacy: {
        structure: '/database/structure',
        'db_structure.php': '/database/structure',
        sql: '/database/sql',
        'db_sql.php': '/database/sql',
        search: '/database/search',
        'db_search.php': '/database/search',
        operations: '/database/operations',
        'db_operations.php': '/database/operations',
      },
    },
  ),
  DefaultTabTable: oneOf(TABLE_TABS, '/sql', { legacy: TABLE_TAB_LEGACY }),
  RowActionType: oneOf(LINK_MODES, 'both'),
  Export: exportNode,
  Import: importNode,
  Schema: schemaNode,
  PDFPageSizes: custom('string-list', z.array(z.string()).min(1), ['A3', 'A4', 'A5', 'letter', 'legal'], {
    coerce: (v) => (Array.isArray(v) ? v.map(cStr) : v),
    fromEnv: (raw) => (raw.trim().startsWith('[') ? eJson(raw) : raw.split(',').map((s) => s.trim())),
  }),
  PDFDefaultPageSize: str('A4'),
  DefaultLang: str('en'),
  DefaultConnectionCollation: str('utf8mb4_unicode_ci'),
  Lang: str(''),
  FilterLanguages: str(''),
  // pma: Settings.php::setRecodingEngine ('mb' is stored as 'mbstring')
  RecodingEngine: oneOf(['auto', 'iconv', 'mbstring', 'none'], 'auto', { legacy: { mb: 'mbstring' } }),
  IconvExtraParams: str('//TRANSLIT'),
  AvailableCharsets: list([
    'iso-8859-1',
    'iso-8859-2',
    'iso-8859-3',
    'iso-8859-4',
    'iso-8859-5',
    'iso-8859-6',
    'iso-8859-7',
    'iso-8859-8',
    'iso-8859-9',
    'iso-8859-10',
    'iso-8859-11',
    'iso-8859-12',
    'iso-8859-13',
    'iso-8859-14',
    'iso-8859-15',
    'windows-1250',
    'windows-1251',
    'windows-1252',
    'windows-1256',
    'windows-1257',
    'koi8-r',
    'big5',
    'gb2312',
    'utf-16',
    'utf-8',
    'utf-7',
    'x-user-defined',
    'euc-jp',
    'ks_c_5601-1987',
    'tis-620',
    'SHIFT_JIS',
    'SJIS',
    'SJIS-win',
  ]),
  NavigationTreePointerEnable: bool(true),
  BrowsePointerEnable: bool(true),
  BrowseMarkerEnable: bool(true),
  TextareaCols: int(40, { min: 1 }),
  TextareaRows: int(15, { min: 1 }),
  LongtextDoubleTextarea: bool(true),
  TextareaAutoSelect: bool(false),
  CharTextareaCols: int(40, { min: 1 }),
  CharTextareaRows: int(7, { min: 1 }),
  LimitChars: int(50, { min: 1 }),
  RowActionLinks: oneOf(['left', 'right', 'both', 'none'], 'left'),
  RowActionLinksWithoutUnique: bool(false),
  // pma: Settings.php::setTablePrimaryKeyOrder (strtoupper)
  TablePrimaryKeyOrder: oneOf(['NONE', 'ASC', 'DESC'], 'NONE', { legacy: { asc: 'ASC', desc: 'DESC' } }),
  RememberSorting: bool(true),
  ShowBrowseComments: bool(true),
  ShowPropertyComments: bool(true),
  RepeatCells: int(100, { min: 0 }),
  QueryHistoryDB: bool(false),
  QueryHistoryMax: int(25, { min: 1 }),
  AllowSharedBookmarks: bool(true),
  BrowseMIME: bool(true),
  MaxExactCount: int(50000, { min: 1 }),
  MaxExactCountViews: int(0, { min: 0 }),
  NaturalOrder: bool(true),
  InitialSlidersState: oneOf(['closed', 'open', 'disabled'], 'closed'),
  UserprefsDisallow: list([]),
  UserprefsDeveloperTab: bool(false),
  TitleTable: str('@HTTP_HOST@ / @VSERVER@ / @DATABASE@ / @TABLE@ | @PHPMYADMIN@'),
  TitleDatabase: str('@HTTP_HOST@ / @VSERVER@ / @DATABASE@ | @PHPMYADMIN@'),
  TitleServer: str('@HTTP_HOST@ / @VSERVER@ | @PHPMYADMIN@'),
  TitleDefault: str('@HTTP_HOST@ | @PHPMYADMIN@'),
  ThemeManager: bool(true),
  ThemeDefault: str('pmahomme'),
  ThemePerServer: bool(false),
  DefaultQueryTable: str('SELECT * FROM @TABLE@ WHERE 1'),
  DefaultQueryDatabase: str(''),
  // pma: src/Config/Settings/SqlQueryBox.php
  SQLQuery: group({
    Edit: bool(true),
    Explain: bool(true),
    ShowAsPHP: bool(true),
    Refresh: bool(true),
  }),
  EnableAutocompleteForTablesAndColumns: bool(true),
  UploadDir: str(''),
  SaveDir: str(''),
  // pma: Settings.php::setTempDir (ROOT_PATH . 'tmp/')
  TempDir: str('./tmp/'),
  GD2Available: oneOf(['auto', 'yes', 'no'], 'auto'),
  TrustedProxies: record({}),
  CheckConfigurationPermissions: bool(true),
  LinkLengthLimit: int(1000, { min: 1 }),
  CSPAllow: str(''),
  DisableMultiTableMaintenance: bool(false),
  SendErrorReports: oneOf(['ask', 'always', 'never'], 'ask'),
  ConsoleEnterExecutes: bool(false),
  ZeroConf: bool(true),
  // pma: src/Config/Settings/Debug.php
  DBG: group({
    sql: bool(false),
    sqllog: bool(false),
    demo: bool(false),
    simple2fa: bool(false),
  }),
  environment: oneOf(['production', 'development'], 'production'),
  // pma: Settings.php::setDefaultFunctions (array_replace over the defaults)
  DefaultFunctions: record(
    {
      FUNC_CHAR: '',
      FUNC_DATE: '',
      FUNC_NUMBER: '',
      FUNC_SPATIAL: 'GeomFromText',
      FUNC_UUID: 'UUID',
      first_timestamp: 'NOW',
    },
    { merge: 'shallow' },
  ),
  maxRowPlotLimit: int(500, { min: 1 }),
  ShowGitRevision: bool(true),
  MysqlMinVersion: group({
    internal: int(50500),
    human: str('5.5.0'),
  }),
  DisableShortcutKeys: bool(false),
  // pma: src/Config/Settings/Console.php
  Console: group({
    StartHistory: bool(false),
    AlwaysExpand: bool(false),
    CurrentQuery: bool(true),
    EnterExecutes: bool(false),
    DarkTheme: bool(false),
    Mode: oneOf(['info', 'show', 'collapse'], 'info'),
    Height: int(92, { min: 1 }),
    GroupQueries: bool(false),
    OrderBy: oneOf(['exec', 'time', 'count'], 'exec'),
    Order: oneOf(['asc', 'desc'], 'asc'),
  }),
  DefaultTransformations: transformationsNode,
  FirstDayOfCalendar: int(0, { min: 0, max: 7 }),

  // -------------------------------------------------------------------------
  // BetterMyAdmin additions (docs/architecture/06, 07; parity exceptions X2, X22)
  // -------------------------------------------------------------------------
  /** Generated secret, SQLite session store, local metadata fallback. `~` = home directory. */
  DataDir: str('~/.bettermyadmin', { bma: true }),
  SessionStore: oneOf(['sqlite', 'redis'], 'sqlite', { bma: true }),
  /** May embed credentials (`redis://:pass@host`), hence secret. */
  RedisUrl: str('', { bma: true, secret: true }),
  Listen: group(
    {
      host: str('127.0.0.1', { bma: true }),
      port: int(8080, { min: 0, max: 65535, bma: true }),
      basePath: str('/', { bma: true }),
    },
    { bma: true },
  ),
  /** Per (IP, username) failed-login limiter: maxAttempts failures within windowSeconds lock the pair out for lockoutSeconds; on by default. */
  LoginRateLimit: group(
    {
      enabled: bool(true, { bma: true }),
      maxAttempts: int(5, { min: 1, bma: true }),
      windowSeconds: int(900, { min: 1, bma: true }),
      lockoutSeconds: int(300, { min: 0, bma: true }),
    },
    { bma: true },
  ),
  /** Removed from phpMyAdmin in 4.6.0; honoured by BetterMyAdmin (HTTPS redirect + HSTS). */
  ForceSSL: bool(false, { bma: true }),
  /** Upload size limit in bytes (phpMyAdmin uses PHP's `upload_max_filesize`). */
  MaxUploadSize: int(536870912, { min: 1, bma: true }),
  /**
   * MySQL connections kept between requests (X24; phpMyAdmin connects per request): an idle
   * connection closes after idleTimeout seconds, every pool of the process together holds at most
   * maxTotal, and a request waits up to waitTimeout seconds for one when they are all in use.
   */
  ConnectionPool: group(
    {
      idleTimeout: int(10, { min: 0, bma: true }),
      maxTotal: int(50, { min: 1, bma: true }),
      waitTimeout: int(30, { min: 0, bma: true }),
    },
    { bma: true },
  ),
})

// ---------------------------------------------------------------------------
// Metadata lists
// ---------------------------------------------------------------------------

/**
 * Directives a user may override in their preferences.
 * pma: src/Config/Forms/User/UserFormList.php::getFields (with UserprefsDeveloperTab on, which
 * adds `DBG/sql`) plus the custom-handled keys in src/Config/UserPreferences.php::apply
 * (`ThemeDefault`, `Server/hide_db`, `Server/only_db`; `lang` and `2fa` are not directives).
 * Verified against test/fixtures/pma-userpref-fields.json.
 */
export const USERPREF_PATHS: readonly string[] = [
  'VersionCheck',
  'NaturalOrder',
  'InitialSlidersState',
  'LoginCookieValidity',
  'SkipLockedTables',
  'DisableMultiTableMaintenance',
  'ShowHint',
  'SendErrorReports',
  'ConsoleEnterExecutes',
  'DisableShortcutKeys',
  'FirstDayOfCalendar',
  'Servers/*/only_db',
  'Servers/*/hide_db',
  'MaxDbList',
  'MaxTableList',
  'DefaultConnectionCollation',
  'CharEditing',
  'MinSizeForInputField',
  'MaxSizeForInputField',
  'CharTextareaCols',
  'CharTextareaRows',
  'TextareaCols',
  'TextareaRows',
  'LongtextDoubleTextarea',
  'TitleDefault',
  'TitleTable',
  'TitleDatabase',
  'TitleServer',
  'PmaNoRelation_DisableWarning',
  'LoginCookieValidityDisableWarning',
  'ReservedWordDisableWarning',
  'Console/Mode',
  'Console/StartHistory',
  'Console/AlwaysExpand',
  'Console/CurrentQuery',
  'Console/EnterExecutes',
  'Console/DarkTheme',
  'Console/Height',
  'Console/GroupQueries',
  'Console/OrderBy',
  'Console/Order',
  'DBG/sql',
  'ShowSQL',
  'Confirm',
  'QueryHistoryMax',
  'IgnoreMultiSubmitErrors',
  'MaxCharactersInDisplayedSQL',
  'RetainQueryBox',
  'CodemirrorEnable',
  'LintEnable',
  'EnableAutocompleteForTablesAndColumns',
  'DefaultForeignKeyChecks',
  'SQLQuery/Edit',
  'SQLQuery/Explain',
  'SQLQuery/ShowAsPHP',
  'SQLQuery/Refresh',
  'ShowDatabasesNavigationAsTree',
  'NavigationLinkWithMainPanel',
  'NavigationDisplayLogo',
  'NavigationLogoLink',
  'NavigationLogoLinkWindow',
  'NavigationTreePointerEnable',
  'FirstLevelNavigationItems',
  'NavigationTreeDisplayItemFilterMinimum',
  'NumRecentTables',
  'NumFavoriteTables',
  'NavigationWidth',
  'MaxNavigationItems',
  'NavigationTreeEnableGrouping',
  'NavigationTreeEnableExpansion',
  'NavigationTreeShowTables',
  'NavigationTreeShowViews',
  'NavigationTreeShowFunctions',
  'NavigationTreeShowProcedures',
  'NavigationTreeShowEvents',
  'NavigationTreeAutoexpandSingleDb',
  'NavigationDisplayServers',
  'DisplayServersList',
  'NavigationTreeDisplayDbFilterMinimum',
  'NavigationTreeDbSeparator',
  'NavigationTreeDefaultTabTable',
  'NavigationTreeDefaultTabTable2',
  'NavigationTreeTableSeparator',
  'NavigationTreeTableLevel',
  'ShowCreateDb',
  'ShowStats',
  'ShowServerInfo',
  'ShowDbStructureCharset',
  'ShowDbStructureComment',
  'ShowDbStructureCreation',
  'ShowDbStructureLastUpdate',
  'ShowDbStructureLastCheck',
  'HideStructureActions',
  'ShowColumnComments',
  'DefaultTransformations/Hex',
  'DefaultTransformations/Substring',
  'DefaultTransformations/Bool2Text',
  'DefaultTransformations/External',
  'DefaultTransformations/PreApPend',
  'DefaultTransformations/DateFormat',
  'DefaultTransformations/Inline',
  'DefaultTransformations/TextImageLink',
  'DefaultTransformations/TextLink',
  'TableNavigationLinksMode',
  'ActionLinksMode',
  'ShowAll',
  'MaxRows',
  'Order',
  'BrowsePointerEnable',
  'BrowseMarkerEnable',
  'GridEditing',
  'SaveCellsAtOnce',
  'RepeatCells',
  'LimitChars',
  'RowActionLinks',
  'RowActionLinksWithoutUnique',
  'TablePrimaryKeyOrder',
  'RememberSorting',
  'RelationalDisplay',
  'ProtectBinary',
  'ShowFunctionFields',
  'ShowFieldTypesInDataEditView',
  'InsertRows',
  'ForeignKeyDropdownOrder',
  'ForeignKeyMaxLimit',
  'TabsMode',
  'DefaultTabServer',
  'DefaultTabDatabase',
  'DefaultTabTable',
  'PDFDefaultPageSize',
  'Export/method',
  'Export/quick_export_onserver',
  'Export/quick_export_onserver_overwrite',
  'Export/format',
  'Export/compression',
  'Export/charset',
  'Export/lock_tables',
  'Export/as_separate_files',
  'Export/asfile',
  'Export/onserver',
  'Export/onserver_overwrite',
  'Export/file_template_table',
  'Export/file_template_database',
  'Export/file_template_server',
  'Export/sql_include_comments',
  'Export/sql_dates',
  'Export/sql_relation',
  'Export/sql_mime',
  'Export/sql_use_transaction',
  'Export/sql_disable_fk',
  'Export/sql_views_as_tables',
  'Export/sql_metadata',
  'Export/sql_compatibility',
  'Export/sql_structure_or_data',
  'Export/sql_drop_database',
  'Export/sql_create_database',
  'Export/sql_drop_table',
  'Export/sql_create_table',
  'Export/sql_if_not_exists',
  'Export/sql_auto_increment',
  'Export/sql_create_view',
  'Export/sql_view_current_user',
  'Export/sql_or_replace_view',
  'Export/sql_procedure_function',
  'Export/sql_create_trigger',
  'Export/sql_backquotes',
  'Export/sql_delayed',
  'Export/sql_ignore',
  'Export/sql_type',
  'Export/sql_insert_syntax',
  'Export/sql_max_query_size',
  'Export/sql_hex_for_binary',
  'Export/sql_utc_time',
  'Export/codegen_format',
  'Export/csv_separator',
  'Export/csv_enclosed',
  'Export/csv_escaped',
  'Export/csv_terminated',
  'Export/csv_null',
  'Export/csv_removeCRLF',
  'Export/csv_columns',
  'Export/excel_null',
  'Export/excel_removeCRLF',
  'Export/excel_columns',
  'Export/excel_edition',
  'Export/latex_caption',
  'Export/latex_structure_or_data',
  'Export/latex_structure_caption',
  'Export/latex_structure_continued_caption',
  'Export/latex_structure_label',
  'Export/latex_relation',
  'Export/latex_comments',
  'Export/latex_mime',
  'Export/latex_columns',
  'Export/latex_data_caption',
  'Export/latex_data_continued_caption',
  'Export/latex_data_label',
  'Export/latex_null',
  'Export/htmlword_structure_or_data',
  'Export/htmlword_null',
  'Export/htmlword_columns',
  'Export/ods_columns',
  'Export/ods_null',
  'Export/odt_structure_or_data',
  'Export/odt_relation',
  'Export/odt_comments',
  'Export/odt_mime',
  'Export/odt_columns',
  'Export/odt_null',
  'Export/texytext_structure_or_data',
  'Export/texytext_null',
  'Export/texytext_columns',
  'Import/format',
  'Import/charset',
  'Import/allow_interrupt',
  'Import/skip_queries',
  'enable_drag_drop_import',
  'Import/sql_compatibility',
  'Import/sql_no_auto_value_on_zero',
  'Import/sql_read_as_multibytes',
  'Import/csv_replace',
  'Import/csv_ignore',
  'Import/csv_empty_as_null',
  'Import/csv_terminated',
  'Import/csv_enclosed',
  'Import/csv_escaped',
  'Import/csv_col_names',
  'Import/ldi_replace',
  'Import/ldi_ignore',
  'Import/ldi_terminated',
  'Import/ldi_enclosed',
  'Import/ldi_escaped',
  'Import/ldi_local_option',
  'Import/ods_col_names',
  'Import/ods_empty_rows',
  'Import/ods_recognize_percentages',
  'Import/ods_recognize_currency',
  // pma: src/Config/UserPreferences.php::apply ("allow some additional fields which are custom handled")
  'ThemeDefault',
]

/**
 * Directives sent to the SPA (`/api/meta/config-public`) in addition to the user-preference
 * directives (which a user can see and change anyway). This endpoint may be reachable before
 * login, so nothing under `Servers`, no filesystem paths, no network/proxy settings and no
 * secrets. Allow-list, never a deny-list (docs/architecture/07-security.md).
 */
export const CLIENT_VISIBLE_EXTRA_PATHS: readonly string[] = [
  'AllowThirdPartyFraming', // JS cross-framing check
  'ServerDefault',
  'ShowPhpInfo',
  'ShowChgPassword',
  'ShowGitRevision',
  'DBG/demo', // the demo server banner (Footer::getDisplay is_demo)
  'AllowUserDropDatabase',
  'UseDbSearch',
  'RowActionType',
  'PropertiesNumColumns',
  'PDFPageSizes',
  'ShowBrowseComments',
  'ShowPropertyComments',
  'TextareaAutoSelect',
  'QueryHistoryDB',
  'AllowSharedBookmarks',
  'UserprefsDisallow',
  'UserprefsDeveloperTab',
  'ThemeManager',
  'ThemePerServer',
  'DefaultQueryTable',
  'DefaultQueryDatabase',
  'LinkLengthLimit',
  'GD2Available', // the Inline transformation (Config::isGd2Available)
  'maxRowPlotLimit',
  'MaxRoutineList',
  'ZipDump',
  'GZipDump',
  'BZipDump',
  'Schema', // schema export dialog defaults
  'DefaultLang',
  'Lang',
  // login page
  'AllowArbitraryServer',
  'LoginCookieRecall',
  'CaptchaMethod',
  'CaptchaApi',
  'CaptchaRequestParam',
  'CaptchaResponseParam',
  'CaptchaLoginPublicKey', // reCAPTCHA *site* key, public by design
  // BetterMyAdmin
  'Listen/basePath',
  'MaxUploadSize',
]

/**
 * Directives documented as removed (docs/config.rst `.. deprecated::`), absent from Settings.php.
 * phpMyAdmin ignores them; we accept and ignore them with a warning (parity exception Q2).
 */
export const REMOVED_DIRECTIVES: Readonly<Record<string, string>> = {
  SuhosinDisableWarning: '6.0.0',
  ServerLibraryDifference_DisableWarning: '4.7.0',
  DisplayBinaryAsHex: '4.3.0',
  OBGzip: '6.0.0',
  EditInWindow: '4.3.0',
  QueryWindowWidth: '4.3.0',
  QueryWindowHeight: '4.3.0',
  QueryWindowDefTab: '4.3.0',
  FontSize: '5.0.0',
  'Servers/*/connect_type': '4.7.0',
  'Servers/*/auth_swekey_config': '4.6.4',
  'Servers/*/nopassword': '4.7.0',
  'Servers/*/extension': '4.2.0',
  'Servers/*/designer_coords': '4.3.0',
}

// ---------------------------------------------------------------------------
// Finalisation: paths and flags
// ---------------------------------------------------------------------------

function matchesPathList(path: string, listed: ReadonlySet<string>): boolean {
  if (listed.has(path)) return true
  // a listed group covers its descendants
  for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
    if (listed.has(path.slice(0, i))) return true
  }
  return false
}

function finalize(root: GroupNode): void {
  assignPaths(root, '')
  const userPref = new Set(USERPREF_PATHS)
  const extra = new Set(CLIENT_VISIBLE_EXTRA_PATHS)
  const walk = (n: AnyNode, inherited: { bma: boolean; secret: boolean }): void => {
    const bma = inherited.bma || n.opts.bma === true
    const secret = inherited.secret || n.opts.secret === true
    const isUserPref = matchesPathList(n.path, userPref)
    const underServers = n.path === 'Servers' || n.path.startsWith('Servers/')
    n.flags = {
      secret,
      bma,
      userPref: isUserPref,
      clientVisible: !secret && !underServers && (isUserPref || matchesPathList(n.path, extra)),
    }
    if (n.kind === 'group')
      for (const c of Object.values(n.fields as Record<string, AnyNode>)) walk(c, { bma, secret })
    else if (n.kind === 'servers') walk(n.server, { bma, secret })
  }
  walk(root, { bma: false, secret: false })
  // groups are client-visible when any descendant is (publicConfig keeps only visible leaves)
  const up = (n: AnyNode): boolean => {
    if (n.kind === 'leaf') return n.flags.clientVisible
    const kids = n.kind === 'group' ? Object.values(n.fields as Record<string, AnyNode>) : [n.server]
    let any = false
    for (const k of kids) any = up(k) || any
    n.flags.clientVisible = any
    return any
  }
  up(root)
  root.path = ''
}

finalize(configNode)

// ---------------------------------------------------------------------------
// Public types and schemas
// ---------------------------------------------------------------------------

/** Fully resolved configuration (every directive present, defaults applied). */
export type ResolvedConfig = Out<typeof configNode>
/** One resolved `Servers[i]` entry. */
export type ServerConfig = Out<typeof serverNode>

type ServerInputBase = In<typeof serverNode>
/** One `Servers[i]` entry as written in a config file. */
export type ServerInput = ServerInputBase & {
  control_host?: string | null
  control_port?: string | number | null
  control_user?: string | null
  control_pass?: string | null
  control_password?: string | null
}

/**
 * Configuration as written by the user (`bettermyadmin.config.*`): every directive optional,
 * `Servers` as an array (element 0 = server 1) or a 1-based record.
 */
export type ConfigInput = Omit<In<typeof configNode>, 'Servers'> & {
  /** Alias of `blowfish_secret`. */
  secret?: string | null
  Servers?: ServerInput[] | Record<number, ServerInput> | null
}

/** Zod schema validating a resolved configuration (strict: unknown keys rejected). */
export const resolvedConfigSchema = toZod(configNode)

/** Every leaf directive with its path (`Servers/*` for per-server directives). */
export const directives = leaves(configNode)

/** Number of leaf directives, phpMyAdmin + BetterMyAdmin. */
export const directiveCount = directives.length

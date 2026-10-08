import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import type { ServerConfig } from '../config.ts'
import type { Conn } from '../db/connection.ts'

/**
 * Read-only discovery of the phpMyAdmin configuration storage (pmadb), the part of
 * `Relation::getRelationParameters()` the shell needs (tab visibility, home notice, breadcrumb
 * comment, user groups). The full pmadb layer lives in packages/metadata; this module keeps the
 * same answers until it can delegate there.
 * pma: src/ConfigStorage/Relation.php, src/ConfigStorage/RelationParameters.php
 */

/** pma__* default table name → Servers[i] directive (Relation::fixPmaTables). */
export const TABLES_TO_FEATURES = {
  pma__bookmark: 'bookmarktable',
  pma__relation: 'relation',
  pma__table_info: 'table_info',
  pma__table_coords: 'table_coords',
  pma__pdf_pages: 'pdf_pages',
  pma__column_info: 'column_info',
  pma__history: 'history',
  pma__recent: 'recent',
  pma__favorite: 'favorite',
  pma__table_uiprefs: 'table_uiprefs',
  pma__tracking: 'tracking',
  pma__userconfig: 'userconfig',
  pma__users: 'users',
  pma__usergroups: 'usergroups',
  pma__navigationhiding: 'navigationhiding',
  pma__savedsearches: 'savedsearches',
  pma__central_columns: 'central_columns',
  pma__designer_settings: 'designer_settings',
  pma__export_templates: 'export_templates',
} as const

export type StorageDirective = (typeof TABLES_TO_FEATURES)[keyof typeof TABLES_TO_FEATURES]

export interface StorageInfo {
  /** The pmadb in use, '' when none */
  db: string
  /** Directive → table name, for accessible tables only */
  tables: Partial<Record<StorageDirective, string>>
  features: {
    bookmark: boolean
    relation: boolean
    display: boolean
    pdf: boolean
    columnComments: boolean
    browserTransformation: boolean
    history: boolean
    recent: boolean
    favorite: boolean
    uiPreferences: boolean
    tracking: boolean
    userPreferences: boolean
    configurableMenus: boolean
    navigationHiding: boolean
    savedSearches: boolean
    centralColumns: boolean
    designerSettings: boolean
    exportTemplates: boolean
  }
  /** Relation::arePmadbTablesAllDisabled */
  allDisabled: boolean
}

type TableSetting = string | false

function setting(server: ServerConfig, d: StorageDirective): TableSetting {
  return (server as unknown as Record<string, TableSetting>)[d] ?? ''
}

/** Relation::arePmadbTablesAllDisabled — every table directive set to false. */
export function arePmadbTablesAllDisabled(server: ServerConfig): boolean {
  return Object.values(TABLES_TO_FEATURES).every((d) => setting(server, d) === false)
}

async function showTables(conn: Conn, db: string): Promise<string[] | null> {
  try {
    const rows = await conn.query(`SHOW TABLES FROM ${backquote(db)};`, 'pmadb.tables')
    return (rows.resultSets[0]?.rows ?? []).map((r) => r[0]?.toString('utf8') ?? '')
  } catch {
    return null
  }
}

async function canAccess(conn: Conn, db: string, table: string): Promise<boolean> {
  try {
    await conn.query(`SELECT NULL FROM ${backquote(db)}.${backquote(table)} LIMIT 0`, 'pmadb.access')
    return true
  } catch {
    return false
  }
}

const emptyFeatures = (): StorageInfo['features'] => ({
  bookmark: false,
  relation: false,
  display: false,
  pdf: false,
  columnComments: false,
  browserTransformation: false,
  history: false,
  recent: false,
  favorite: false,
  uiPreferences: false,
  tracking: false,
  userPreferences: false,
  configurableMenus: false,
  navigationHiding: false,
  savedSearches: false,
  centralColumns: false,
  designerSettings: false,
  exportTemplates: false,
})

/**
 * Relation::initRelationParamsCache + checkRelationsParam on the control connection.
 *
 * 1. fixPmaTables(pmadb || 'phpmyadmin', create=false): directives left empty take the default
 *    `pma__*` names of the tables that exist, and pmadb is set when one is found.
 * 2. checkRelationsParam: the configured names that exist in pmadb are probed with
 *    `SELECT NULL FROM … LIMIT 0`; a feature works when all its tables are accessible.
 *
 * The ZeroConf probe of the *current* database (fixPmaTables(Current::$database)) is not done:
 * the shell discovers storage once per session, not per database (recorded in the feature doc).
 */
export async function discoverStorage(conn: Conn | null, server: ServerConfig): Promise<StorageInfo> {
  const none: StorageInfo = {
    db: '',
    tables: {},
    features: emptyFeatures(),
    allDisabled: arePmadbTablesAllDisabled(server),
  }
  if (conn === null || none.allDisabled) return none

  const names: Record<string, TableSetting> = {}
  for (const d of Object.values(TABLES_TO_FEATURES)) names[d] = setting(server, d)
  let pmadb = server.pmadb
  const probeDb = pmadb !== '' ? pmadb : 'phpmyadmin'
  const existing = await showTables(conn, probeDb)
  if (existing !== null) {
    let foundOne = false
    for (const [table, d] of Object.entries(TABLES_TO_FEATURES)) {
      if (names[d] === false) continue
      const wanted = names[d] !== '' && names[d] !== table ? (names[d] as string) : table
      if (!existing.includes(wanted)) continue
      foundOne = true
      if (names[d] === '') names[d] = table
    }
    if (foundOne && pmadb === '') pmadb = probeDb
  }
  if (pmadb === '') return none

  const tables = await showTables(conn, pmadb)
  if (tables === null || tables.length === 0) return { ...none, db: '' }

  const present: Partial<Record<StorageDirective, string>> = {}
  for (const t of tables) {
    for (const d of Object.values(TABLES_TO_FEATURES)) {
      if (names[d] !== false && names[d] !== '' && t === names[d]) present[d] = t
    }
  }
  const accessible: Partial<Record<StorageDirective, string>> = {}
  for (const [d, t] of Object.entries(present) as Array<[StorageDirective, string]>) {
    if (await canAccess(conn, pmadb, t)) accessible[d] = t
  }
  const has = (...ds: StorageDirective[]) => ds.every((d) => accessible[d] !== undefined)
  const f = emptyFeatures()
  f.bookmark = has('bookmarktable')
  f.relation = has('relation')
  f.display = has('relation', 'table_info')
  f.pdf = has('table_coords', 'pdf_pages')
  f.columnComments = has('column_info')
  f.browserTransformation =
    f.columnComments && (await hasInputTransformationColumns(conn, pmadb, accessible.column_info))
  f.history = has('history')
  f.recent = has('recent')
  f.favorite = has('favorite')
  f.uiPreferences = has('table_uiprefs')
  f.tracking = has('tracking')
  f.userPreferences = has('userconfig')
  f.configurableMenus = has('users', 'usergroups')
  f.navigationHiding = has('navigationhiding')
  f.savedSearches = has('savedsearches')
  f.centralColumns = has('central_columns')
  f.designerSettings = has('designer_settings')
  f.exportTemplates = has('export_templates')
  return { db: pmadb, tables: accessible, features: f, allDisabled: false }
}

/** Relation::tryUpgradeTransformations, read-only: the 4.3+ columns are present. */
async function hasInputTransformationColumns(
  conn: Conn,
  db: string,
  table: string | undefined,
): Promise<boolean> {
  if (table === undefined) return false
  try {
    const r = await conn.query(
      `SHOW COLUMNS FROM ${backquote(db)}.${backquote(table)} WHERE Field IN ('input_transformation', 'input_transformation_options')`,
      'pmadb.transformations',
    )
    return (r.resultSets[0]?.rows.length ?? 0) === 2
  } catch {
    return false
  }
}

/** RelationParameters::hasAllFeatures */
export function hasAllFeatures(info: StorageInfo): boolean {
  const f = info.features
  return (
    f.bookmark &&
    f.browserTransformation &&
    f.centralColumns &&
    f.columnComments &&
    f.configurableMenus &&
    f.designerSettings &&
    f.display &&
    f.exportTemplates &&
    f.favorite &&
    f.navigationHiding &&
    f.pdf &&
    f.recent &&
    f.relation &&
    f.savedSearches &&
    f.history &&
    f.tracking &&
    f.uiPreferences &&
    f.userPreferences
  )
}

/**
 * Relation::getDbComment: the `(db_comment)` row of column_info.
 */
export async function getDbComment(conn: Conn | null, info: StorageInfo, db: string): Promise<string> {
  const table = info.tables.column_info
  if (conn === null || !info.features.columnComments || table === undefined) return ''
  try {
    const v = await conn.value(
      `SELECT \`comment\` FROM ${backquote(info.db)}.${backquote(table)} WHERE db_name = ${quoteString(db)} AND table_name  = '' AND column_name = '(db_comment)'`,
      'pmadb.dbComment',
    )
    return v ?? ''
  } catch {
    return ''
  }
}

/**
 * Tabs a user group forbids at a level (`server`, `db`, `table`), as tab keys without the prefix.
 * pma: src/Menu.php::getAllowedTabs
 */
export async function deniedTabs(
  conn: Conn | null,
  info: StorageInfo,
  username: string,
  level: 'server' | 'db' | 'table',
): Promise<string[]> {
  const groups = info.tables.usergroups
  const users = info.tables.users
  if (conn === null || !info.features.configurableMenus || groups === undefined || users === undefined)
    return []
  const sql =
    `SELECT \`tab\` FROM ${backquote(info.db)}.${backquote(groups)}` +
    ` WHERE \`allowed\` = 'N' AND \`tab\` LIKE '${level}%' AND \`usergroup\` = (SELECT usergroup FROM ` +
    `${backquote(info.db)}.${backquote(users)} WHERE \`username\` = ${quoteString(username)})`
  try {
    const rows = await conn.rows(sql, 'pmadb.menus')
    return rows.map((r) => {
      const tab = r.tab ?? ''
      return tab.slice(tab.indexOf('_') + 1)
    })
  } catch {
    return []
  }
}

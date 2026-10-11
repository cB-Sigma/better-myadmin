import {
  type MetaConn,
  type RelationParameters,
  getDbComment as metaDbComment,
  hasAllFeatures as metaHasAllFeatures,
} from '@bettermyadmin/metadata'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import type { ServerConfig } from '../config.ts'

/**
 * What the shell reads from the configuration storage (tab visibility, the home notice, the breadcrumb
 * comment, user groups), answered by the metadata layer (packages/metadata): the RelationParameters
 * discovered once per session by apps/server/src/metadata/service.ts and its control link.
 * pma: src/ConfigStorage/Relation.php, src/ConfigStorage/RelationParameters.php, src/Menu.php
 */
export interface StorageInfo {
  /** The pmadb in use, '' when none */
  db: string
  features: {
    columnComments: boolean
    configurableMenus: boolean
    userPreferences: boolean
    tracking: boolean
    centralColumns: boolean
  }
  /** RelationParameters::hasAllFeatures */
  allFeatures: boolean
  rp: RelationParameters
}

export function storageInfo(rp: RelationParameters): StorageInfo {
  return {
    db: rp.db ?? '',
    features: {
      columnComments: rp.columnCommentsFeature !== null,
      configurableMenus: rp.configurableMenusFeature !== null,
      userPreferences: rp.userPreferencesFeature !== null,
      tracking: rp.trackingFeature !== null,
      centralColumns: rp.centralColumnsFeature !== null,
    },
    allFeatures: metaHasAllFeatures(rp),
    rp,
  }
}

const TABLE_DIRECTIVES = [
  'bookmarktable',
  'relation',
  'table_info',
  'table_coords',
  'pdf_pages',
  'column_info',
  'history',
  'recent',
  'favorite',
  'table_uiprefs',
  'tracking',
  'userconfig',
  'users',
  'usergroups',
  'navigationhiding',
  'savedsearches',
  'central_columns',
  'designer_settings',
  'export_templates',
] as const

/** Relation::arePmadbTablesAllDisabled — every table directive set to false. */
export function arePmadbTablesAllDisabled(server: ServerConfig): boolean {
  return TABLE_DIRECTIVES.every((d) => (server as unknown as Record<string, unknown>)[d] === false)
}

/** RelationParameters::hasAllFeatures */
export function hasAllFeatures(info: StorageInfo): boolean {
  return info.allFeatures
}

/** Relation::getDbComment: the `(db_comment)` row of column_info, on the control link. */
export async function getDbComment(conn: MetaConn | null, info: StorageInfo, db: string): Promise<string> {
  return metaDbComment(conn, info.rp, db)
}

/**
 * Tabs a user group forbids at a level (`server`, `db`, `table`), as tab keys without the prefix.
 * pma: src/Menu.php::getAllowedTabs
 */
export async function deniedTabs(
  conn: MetaConn | null,
  info: StorageInfo,
  username: string,
  level: 'server' | 'db' | 'table',
): Promise<string[]> {
  const f = info.rp.configurableMenusFeature
  if (conn === null || f === null) return []
  const sql =
    `SELECT \`tab\` FROM ${backquote(f.database)}.${backquote(f.userGroups)}` +
    ` WHERE \`allowed\` = 'N' AND \`tab\` LIKE '${level}%' AND \`usergroup\` = (SELECT usergroup FROM ` +
    `${backquote(f.database)}.${backquote(f.users)} WHERE \`username\` = ${quoteString(username)})`
  const r = await conn.tryQuery(sql)
  if (r === false) return []
  return r.rows.map((row) => {
    const tab = String(row.tab ?? '')
    return tab.slice(tab.indexOf('_') + 1)
  })
}

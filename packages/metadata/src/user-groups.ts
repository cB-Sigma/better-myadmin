import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import { type MetaConn, fetchValue, firstColumn } from './conn.ts'
import type { RelationParameters } from './relation-parameters.ts'

/**
 * User groups (configurable menus) and the account clean-up of the configuration storage, all
 * through the control link: `pma__usergroups` (usergroup, tab, allowed) and `pma__users`
 * (username, usergroup).
 * pma: src/ConfigStorage/UserGroups.php, src/Server/Privileges.php (setUserGroup, getUserGroupCount,
 *      getUserGroupForUser), src/Controllers/Server/UserGroupsFormController.php,
 *      src/ConfigStorage/RelationCleanup.php::user
 */

export type MenusFeature = NonNullable<RelationParameters['configurableMenusFeature']>
export type UserGroupLevel = 'server' | 'db' | 'table'

/** Util::getMenuTabList — tab key → label msgid (translated by the caller), per level, in phpMyAdmin's order. */
export const MENU_TAB_LIST: Record<UserGroupLevel, ReadonlyArray<{ tab: string; msgid: string }>> = {
  server: [
    { tab: 'databases', msgid: 'Databases' },
    { tab: 'sql', msgid: 'SQL' },
    { tab: 'status', msgid: 'Status' },
    { tab: 'rights', msgid: 'Users' },
    { tab: 'export', msgid: 'Export' },
    { tab: 'import', msgid: 'Import' },
    { tab: 'settings', msgid: 'Settings' },
    { tab: 'binlog', msgid: 'Binary log' },
    { tab: 'replication', msgid: 'Replication' },
    { tab: 'vars', msgid: 'Variables' },
    { tab: 'charset', msgid: 'Charsets' },
    { tab: 'plugins', msgid: 'Plugins' },
    { tab: 'engine', msgid: 'Engines' },
  ],
  db: [
    { tab: 'structure', msgid: 'Structure' },
    { tab: 'sql', msgid: 'SQL' },
    { tab: 'search', msgid: 'Search' },
    { tab: 'query', msgid: 'Query' },
    { tab: 'export', msgid: 'Export' },
    { tab: 'import', msgid: 'Import' },
    { tab: 'operation', msgid: 'Operations' },
    { tab: 'privileges', msgid: 'Privileges' },
    { tab: 'routines', msgid: 'Routines' },
    { tab: 'events', msgid: 'Events' },
    { tab: 'triggers', msgid: 'Triggers' },
    { tab: 'tracking', msgid: 'Tracking' },
    { tab: 'designer', msgid: 'Designer' },
    { tab: 'central_columns', msgid: 'Central columns' },
  ],
  table: [
    { tab: 'browse', msgid: 'Browse' },
    { tab: 'structure', msgid: 'Structure' },
    { tab: 'sql', msgid: 'SQL' },
    { tab: 'search', msgid: 'Search' },
    { tab: 'insert', msgid: 'Insert' },
    { tab: 'export', msgid: 'Export' },
    { tab: 'import', msgid: 'Import' },
    { tab: 'privileges', msgid: 'Privileges' },
    { tab: 'operation', msgid: 'Operations' },
    { tab: 'tracking', msgid: 'Tracking' },
    { tab: 'triggers', msgid: 'Triggers' },
  ],
}

export const USER_GROUP_LEVELS: readonly UserGroupLevel[] = ['server', 'db', 'table']

const groupsTable = (f: MenusFeature) => `${backquote(f.database)}.${backquote(f.userGroups)}`
const usersTable = (f: MenusFeature) => `${backquote(f.database)}.${backquote(f.users)}`

/** Privileges::getUserGroupCount */
export async function userGroupCount(conn: MetaConn, f: MenusFeature): Promise<number> {
  const v = await fetchValue(conn, `SELECT COUNT(*) FROM ${groupsTable(f)}`)
  return v === false || v === null ? 0 : Number.parseInt(v, 10) || 0
}

/** Privileges::getUserGroupForUser (null when the user has no group) */
export async function userGroupOfUser(
  conn: MetaConn,
  f: MenusFeature,
  username: string,
): Promise<string | null> {
  const v = await fetchValue(
    conn,
    `SELECT \`usergroup\` FROM ${usersTable(f)} WHERE \`username\` = ${quoteString(username)} LIMIT 1`,
  )
  return v === false ? null : v
}

/** Privileges::setUserGroup: INSERT when unassigned, DELETE for the empty group, UPDATE when changed. */
export async function setUserGroup(
  conn: MetaConn,
  f: MenusFeature,
  username: string,
  userGroup: string,
): Promise<void> {
  const old = await fetchValue(
    conn,
    `SELECT \`usergroup\` FROM ${usersTable(f)} WHERE \`username\` = ${quoteString(username)}`,
  )
  let sql: string
  if (old === false) {
    sql = `INSERT INTO ${usersTable(f)}(\`username\`, \`usergroup\`) VALUES (${quoteString(username)}, ${quoteString(userGroup)})`
  } else if (userGroup === '') {
    sql = `DELETE FROM ${usersTable(f)} WHERE \`username\`=${quoteString(username)}`
  } else if (old !== userGroup) {
    sql = `UPDATE ${usersTable(f)} SET \`usergroup\`=${quoteString(userGroup)} WHERE \`username\`=${quoteString(username)}`
  } else {
    return
  }
  await conn.query(sql)
}

/** getUsersOverview: `SELECT * FROM <users>` as username → usergroup (empty on error). */
export async function userGroupAssignments(conn: MetaConn, f: MenusFeature): Promise<Map<string, string>> {
  const r = await conn.tryQuery(`SELECT * FROM ${usersTable(f)}`)
  const out = new Map<string, string>()
  if (r !== false) for (const row of r.rows) out.set(row.username ?? '', row.usergroup ?? '')
  return out
}

/** UserGroups::getAllowedTabNames: a tab is listed unless its row exists with `allowed` other than 'Y'. */
export function allowedTabNames(
  tabs: Readonly<Record<string, string>>,
  level: UserGroupLevel,
  translate: (msgid: string) => string,
): string {
  const names: string[] = []
  for (const { tab, msgid: label } of MENU_TAB_LIST[level]) {
    const v = tabs[`${level}_${tab}`]
    if (v !== undefined && v !== 'Y') continue
    names.push(translate(label))
  }
  return names.join(', ')
}

/**
 * UserGroups::getHtmlForUserGroupsTable: the groups with their tab rows (`SELECT * … ORDER BY
 * usergroup ASC`), in first-seen order; null when the query fails.
 */
export async function userGroupsTable(
  conn: MetaConn,
  f: MenusFeature,
): Promise<Array<{ name: string; tabs: Record<string, string> }>> {
  const r = await conn.tryQuery(`SELECT * FROM ${groupsTable(f)} ORDER BY \`usergroup\` ASC`)
  const groups = new Map<string, Record<string, string>>()
  if (r !== false) {
    for (const row of r.rows) {
      const name = row.usergroup ?? ''
      let tabs = groups.get(name)
      if (tabs === undefined) {
        tabs = {}
        groups.set(name, tabs)
      }
      tabs[row.tab ?? ''] = row.allowed ?? ''
    }
  }
  return [...groups].map(([name, tabs]) => ({ name, tabs }))
}

/** UserGroups::getHtmlForListingUsersofAGroup */
export async function usersOfUserGroup(
  conn: MetaConn,
  f: MenusFeature,
  userGroup: string,
): Promise<string[]> {
  const r = await conn.tryQuery(
    `SELECT \`username\` FROM ${usersTable(f)} WHERE \`usergroup\`=${quoteString(userGroup)}`,
  )
  return r === false ? [] : firstColumn(r)
}

/** UserGroups::delete: the assignments, then the group. */
export async function deleteUserGroup(conn: MetaConn, f: MenusFeature, userGroup: string): Promise<void> {
  await conn.query(`DELETE FROM ${usersTable(f)} WHERE \`usergroup\`=${quoteString(userGroup)}`)
  await conn.query(`DELETE FROM ${groupsTable(f)} WHERE \`usergroup\`=${quoteString(userGroup)}`)
}

/** UserGroups::getHtmlToEditUserGroup: the allowed tabs of a group per level (keys without prefix). */
export async function userGroupAllowedTabs(
  conn: MetaConn,
  f: MenusFeature,
  userGroup: string,
): Promise<Record<UserGroupLevel, string[]>> {
  const allowed: Record<UserGroupLevel, string[]> = { server: [], db: [], table: [] }
  const r = await conn.tryQuery(
    `SELECT * FROM ${groupsTable(f)} WHERE \`usergroup\`=${quoteString(userGroup)}`,
  )
  if (r === false) return allowed
  for (const row of r.rows) {
    const key = row.tab ?? ''
    if (row.allowed !== 'Y') continue
    if (key.startsWith('server_')) allowed.server.push(key.slice(7))
    else if (key.startsWith('db_')) allowed.db.push(key.slice(3))
    else if (key.startsWith('table_')) allowed.table.push(key.slice(6))
  }
  return allowed
}

/**
 * UserGroups::edit: (edit only) DELETE the group's rows, then one INSERT with a row per tab of every
 * level, `'Y'` when `isAllowed('<level>_<tab>')`.
 */
export async function editUserGroup(
  conn: MetaConn,
  f: MenusFeature,
  userGroup: string,
  isNew: boolean,
  isAllowed: (tabName: string) => boolean,
): Promise<void> {
  if (!isNew) await conn.query(`DELETE FROM ${groupsTable(f)} WHERE \`usergroup\`=${quoteString(userGroup)};`)
  const values: string[] = []
  for (const level of USER_GROUP_LEVELS) {
    for (const { tab } of MENU_TAB_LIST[level]) {
      const tabName = `${level}_${tab}`
      values.push(`(${quoteString(userGroup)}, ${quoteString(tabName)}, '${isAllowed(tabName) ? 'Y' : 'N'}')`)
    }
  }
  await conn.query(
    `INSERT INTO ${groupsTable(f)}(\`usergroup\`, \`tab\`, \`allowed\`) VALUES ${values.join(', ')};`,
  )
}

/** UserGroupsFormController::getHtmlToChooseUserGroup: the user's group and every group name. */
export async function chooseUserGroup(
  conn: MetaConn,
  f: MenusFeature,
  username: string,
): Promise<{ userGroup: string | null; userGroups: string[] }> {
  const v = await fetchValue(
    conn,
    `SELECT \`usergroup\` FROM ${usersTable(f)} WHERE \`username\` = ${quoteString(username)}`,
  )
  const r = await conn.tryQuery(`SELECT DISTINCT \`usergroup\` FROM ${groupsTable(f)}`)
  return { userGroup: v === false ? null : v, userGroups: r === false ? [] : firstColumn(r) }
}

/** RelationCleanup::user — the account's rows in every storage table that is configured. */
export async function cleanupUserStorage(
  conn: MetaConn,
  rp: RelationParameters,
  username: string,
): Promise<void> {
  if (rp.db === null) return
  const user = quoteString(username)
  const del = (f: { database: string } | null, table: string | undefined, column = 'username') =>
    f === null || table === undefined
      ? null
      : `DELETE FROM ${backquote(f.database)}.${backquote(table)} WHERE \`${column}\` = ${user}`
  const statements = [
    del(rp.bookmarkFeature, rp.bookmarkFeature?.bookmark, 'user'),
    del(rp.sqlHistoryFeature, rp.sqlHistoryFeature?.history),
    del(rp.recentlyUsedTablesFeature, rp.recentlyUsedTablesFeature?.recent),
    del(rp.favoriteTablesFeature, rp.favoriteTablesFeature?.favorite),
    del(rp.uiPreferencesFeature, rp.uiPreferencesFeature?.tableUiPrefs),
    del(rp.userPreferencesFeature, rp.userPreferencesFeature?.userConfig),
    del(rp.configurableMenusFeature, rp.configurableMenusFeature?.users),
    del(rp.navigationItemsHidingFeature, rp.navigationItemsHidingFeature?.navigationHiding),
    del(rp.savedQueryByExampleSearchesFeature, rp.savedQueryByExampleSearchesFeature?.savedSearches),
    del(rp.databaseDesignerSettingsFeature, rp.databaseDesignerSettingsFeature?.designerSettings),
  ]
  for (const sql of statements) if (sql !== null) await conn.query(sql)
}

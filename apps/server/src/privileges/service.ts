import type {
  AddUserForm,
  DbPrivilegesResponse,
  ExportPrivilegesResponse,
  PrivActionResponse,
  PrivForm,
  PrivGate,
  PrivMessage,
  UserProperties,
  UsersOverviewResponse,
  ValidateUsernameResponse,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { accountLockQuery, escapeGrantWildcards, isDatabaseNameWildcard } from '@bettermyadmin/sql-gen'
import type { Context } from 'hono'
import { MysqlError } from '../http/errors.ts'
import { withMeta } from '../metadata/service.ts'
import { getPrivileges } from '../navigation/privileges.ts'
import type { ServerEnv } from '../routes/server.ts'
import { mysqlDocuUrl, withAdmin } from '../server-admin/context.ts'
import { PasswordUpdateFailure, type PrivStorage, Privileges } from './privileges.ts'

/**
 * Server → User accounts: PrivilegesController (gate, then the actions in phpMyAdmin's order, then
 * the page), AccountLock/UnlockController and Table → Privileges.
 * pma: src/Controllers/Server/PrivilegesController.php, src/Controllers/Server/Privileges/*,
 *      src/Controllers/Table/PrivilegesController.php
 */

/** Runs `fn` with a Privileges instance for the request (`post` = $_POST, `get` = $_GET). */
export function withPrivileges<T>(
  // biome-ignore lint/suspicious/noExplicitAny: any route path/input
  c: Context<ServerEnv, any, any>,
  post: PrivForm,
  get: PrivForm,
  fn: (p: Privileges) => Promise<T>,
): Promise<T> {
  return withMeta(c, {}, (meta) =>
    withAdmin(c, async (ctx) => {
      const rp = await meta.relationParameters()
      const storage: PrivStorage | null = rp.db !== null ? { conn: meta.control, rp } : null
      const p = new Privileges(ctx, storage, post, get)
      const req = p.request
      // getUsernameParam / getHostnameParam: `$request->has()` (body or query)
      if (req.username !== undefined) p.username = typeof req.username === 'string' ? req.username : ''
      if (req.hostname !== undefined) p.hostname = typeof req.hostname === 'string' ? req.hostname : ''
      return fn(p)
    }),
  )
}

/** The access gate: isSuperUser (+ selectDb('mysql')), isGrantUser, isCreateUser. */
export async function privilegesGate(p: Privileges): Promise<PrivGate> {
  const superUser = await p.isSuperUser()
  if (superUser) await p.ctx.conn.query('USE `mysql`', 'privileges.selectDb').catch(() => undefined)
  const grant = await p.isGrantUser()
  const create = await p.isCreateUser()
  return {
    noPrivileges: !superUser && !grant && !create,
    notice:
      !grant && !create
        ? p.ctx.tr.gettext('You do not have the privileges to administrate the users!')
        : null,
    isSuperUser: superUser,
    isGrantUser: grant,
    isCreateUser: create,
    menusWork: p.menus !== null,
  }
}

const str = (v: string | readonly string[] | undefined): string => (typeof v === 'string' ? v : '')

/** pma: Privileges::getDbname — `pred_dbname[]` (non-empty strings), else `dbname` (string or list). */
export function requestDbname(p: Privileges): string | string[] | null {
  let db: string | string[] | null = null
  const pred = p.post.pred_dbname
  if (Array.isArray(pred) && pred.every((x) => x !== '')) db = pred.length === 1 ? String(pred[0]) : [...pred]
  const given = p.request.dbname
  if (db === null && given !== undefined) {
    if (Array.isArray(given)) {
      if (given.every((x) => x !== '')) db = [...given]
    } else if (typeof given === 'string' && given !== '') db = given
  }
  return db
}

/** pma: Privileges::getTablename (null when none) */
export function requestTablename(p: Privileges): string | null {
  const pred = str(p.post.pred_tablename)
  if (pred !== '') return pred
  const t = p.request.tablename
  return typeof t === 'string' && t !== '' ? t : null
}

/** pma: Privileges::getRoutinename */
export function requestRoutinename(p: Privileges): string {
  const pred = str(p.post.pred_routinename)
  if (pred !== '') return pred
  const r = p.request.routinename
  return typeof r === 'string' && r !== '' ? r : ''
}

const DOCS = (v: number) => ({
  problemsConnecting: mysqlDocuUrl('problems-connecting', '', v),
  privReload: mysqlDocuUrl('privileges-provided', 'priv_reload', v),
})

/** The overview (getHtmlForUserOverview). pma: PrivilegesController without username */
export async function usersOverview(p: Privileges): Promise<UsersOverviewResponse> {
  const privileges = await getPrivileges(p.ctx.dbi)
  const gate = await privilegesGate(p)
  const base: UsersOverviewResponse = {
    gate,
    error: null,
    emptyUserNotice: false,
    initials: null,
    selectedInitial: null,
    users: null,
    userGroupCount: 0,
    hasAccountLocking: p.hasAccountLocking,
    flushNote: null,
    docs: DOCS(p.ctx.versionInt),
  }
  if (gate.noPrivileges) return base
  await routineTypeOfRequest(p)
  const initial = typeof p.get.initial === 'string' ? p.get.initial : null
  const o = await p.overview(initial, p.get.showall !== undefined)
  if (o.error !== null) return { ...base, error: o.error }
  return {
    ...base,
    emptyUserNotice: o.emptyUserNotice ?? false,
    initials: o.initials ?? null,
    selectedInitial: initial,
    users: o.users ?? null,
    userGroupCount: o.groupCount ?? 0,
    flushNote: privileges.isReload ? 'reload' : 'noReload',
  }
}

/** `$itemType`: the routine's PROCEDURE/FUNCTION when a routine is addressed (every request does it). */
async function routineTypeOfRequest(p: Privileges): Promise<string> {
  const routine = requestRoutinename(p)
  const db = requestDbname(p)
  if (routine !== '' && typeof db === 'string') return p.routineType(db, routine)
  return ''
}

/** pma: Privileges::getHtmlForAddUser (`?adduser=1`) */
export async function addUserForm(p: Privileges): Promise<AddUserForm> {
  const gate = await privilegesGate(p)
  await routineTypeOfRequest(p)
  const db = requestDbname(p)
  const isGrantUser = gate.isGrantUser
  const login = await p.loginInformation()
  const privilegesTable = isGrantUser ? await p.privilegesTable('*', '*', false) : null
  return {
    gate,
    database: escapeGrantWildcards(typeof db === 'string' ? db : ''),
    login,
    isGrantUser,
    privilegesTable,
  }
}

/** Util::getTitleForTarget + the SPA path of a DefaultTabDatabase/DefaultTabTable route */
function tabOf(route: string, t: (s: string) => string): { path: string; title: string } {
  const title: Record<string, string> = {
    '/table/structure': 'Structure',
    '/database/structure': 'Structure',
    '/table/sql': 'SQL',
    '/database/sql': 'SQL',
    '/table/search': 'Search',
    '/database/search': 'Search',
    '/table/change': 'Insert',
    '/sql': 'Browse',
    '/database/operations': 'Operations',
  }
  const path =
    {
      '/database/structure': 'structure',
      '/database/sql': 'sql',
      '/database/search': 'search',
      '/database/operations': 'operations',
      '/sql': 'browse',
      '/table/structure': 'structure',
      '/table/sql': 'sql',
      '/table/search': 'search',
      '/table/change': 'insert',
    }[route] ?? ''
  return { path, title: title[route] !== undefined ? t(title[route] as string) : '' }
}

/** pma: Privileges::getHtmlForUserProperties / getHtmlForRoutineSpecificPrivileges */
export async function userProperties(p: Privileges): Promise<UserProperties> {
  const gate = await privilegesGate(p)
  const t = (s: string) => p.ctx.tr.gettext(s)
  const username = p.username ?? ''
  const hostname = p.hostname ?? ''
  const database = requestDbname(p)
  const table = requestTablename(p) ?? ''
  const routine = requestRoutinename(p)
  const isWildcard = isDatabaseNameWildcard(database)
  await routineTypeOfRequest(p)
  const urlDbname =
    typeof database === 'string' ? escapeGrantWildcards(database.replace(/\\([_%])/g, '$1')) : ''
  const base: UserProperties = {
    gate,
    username,
    hostname,
    database: database ?? '',
    dbname: urlDbname,
    table,
    isDatabases: isWildcard || (Array.isArray(database) && database.length > 1),
    isWildcard,
    userDoesNotExist: false,
    isCurrentUser: false,
    login: null,
    privilegesTable: null,
    rights: [],
    changePassword: null,
    changeLogin: null,
    userGroup: null,
    databaseTab: tabOf(p.ctx.cfg.DefaultTabDatabase, t),
    tableTab: tabOf(p.ctx.cfg.DefaultTabTable, t),
    routine: null,
  }
  if (gate.noPrivileges) return base
  if (routine !== '') {
    const db = typeof database === 'string' ? database : ''
    const privileges = await p.routinePrivileges(username, hostname, db, routine)
    const current = await p.currentUser()
    return {
      ...base,
      database: db,
      isCurrentUser: current === `${username}@${hostname}`,
      routine: { name: routine, privileges },
    }
  }
  const db = database ?? ''
  const userDoesNotExist = !(await p.userExists(username, hostname))
  const login = userDoesNotExist ? await p.loginInformation() : null
  const privilegesTable = await p.privilegesTable(
    typeof db === 'string' && db !== '' ? db : Array.isArray(db) ? String(db[0]) : '*',
    table !== '' ? table : '*',
  )
  const rights = []
  if (!Array.isArray(db) && table === '' && !isWildcard) {
    if (db === '') rights.push(await p.specificRights(username, hostname, 'database'))
    else {
      const unescaped = db.replace(/\\([_%])/g, '$1')
      rights.push(await p.specificRights(username, hostname, 'table', unescaped))
      rights.push(await p.specificRights(username, hostname, 'routine', unescaped))
    }
  }
  let changePassword = null
  let userGroup = null
  let changeLogin = null
  if (db === '' && !userDoesNotExist) {
    changePassword = await p.changePasswordFields(username, hostname)
    userGroup = await p.userGroupForUser(username)
    changeLogin = await p.loginInformation(username, hostname)
  }
  const current = await p.currentUser()
  return {
    ...base,
    userDoesNotExist,
    isCurrentUser: current === `${username}@${hostname}`,
    login,
    privilegesTable,
    rights,
    changePassword,
    changeLogin,
    userGroup,
  }
}

/** pma: getExportUserDefinitionTextarea + getExportPageTitle */
export async function exportPrivileges(
  p: Privileges,
  selected: string[] | null,
): Promise<ExportPrivilegesResponse> {
  const gate = await privilegesGate(p)
  if (gate.noPrivileges) return { title: '', grants: '' }
  await routineTypeOfRequest(p)
  await p.updateMessageForReload()
  const user = p.username ?? ''
  const host = p.hostname ?? ''
  const title =
    selected !== null ? p.ctx.tr.gettext('Privileges') : `${p.ctx.tr.gettext('User')} \`${user}\`@\`${host}\``
  return { title, grants: await p.exportUserDefinition(user, host, selected) }
}

/** `?validate_username=1&username=` (the Add user form's exists-warning) */
export async function validateUsername(p: Privileges): Promise<ValidateUsernameResponse> {
  const gate = await privilegesGate(p)
  if (gate.noPrivileges) return { userExists: false }
  await routineTypeOfRequest(p)
  await p.updateMessageForReload()
  const extra = await p.ajaxExtraData()
  return { userExists: extra.userExists ?? false }
}

/**
 * POST /server/privileges (AJAX): the actions of PrivilegesController in its order — change/copy
 * part I, add user, copy part III, update privileges, user group, revoke, password, delete,
 * copy part V, reload — and the AJAX extra data.
 */
export async function privilegesAction(p: Privileges): Promise<PrivActionResponse> {
  const t = (s: string) => p.ctx.tr.gettext(s)
  const post = p.post
  const gate = await privilegesGate(p)
  const answer = (
    message: PrivMessage,
    sql = '',
    extra: Partial<PrivActionResponse> = {},
  ): PrivActionResponse => ({
    success: message.type === 'success',
    message,
    sql,
    account: null,
    addUserError: false,
    reload: false,
    ...extra,
  })
  if (gate.noPrivileges) return answer({ type: 'error', text: t('No Privileges') })
  const has = (k: string) => post[k] !== undefined
  const database = requestDbname(p)
  const tablename = requestTablename(p)
  const routinename = requestRoutinename(p)
  let changeCopy = has('change_copy')
  if (changeCopy && p.username === str(post.old_username) && p.hostname === str(post.old_hostname)) {
    return answer({
      type: 'error',
      text: t(
        "Username and hostname didn't change. If you only want to change the password, 'Change password' tab should be used.",
      ),
    })
  }
  let message: PrivMessage | null = null
  let sql = ''
  let reload = false
  let addUserError = false
  let account: PrivActionResponse['account'] = null
  let password: string | null = null
  let notice: PrivMessage | null = null
  if (changeCopy) {
    const r = await p.dataForChangeOrCopyUser(str(post.old_username), str(post.old_hostname))
    if (typeof r === 'object' && r !== null) {
      notice = r
      password = null
      changeCopy = false
    } else password = r
  }
  let queries: string[] = []
  let display: Record<number, string> | null = null
  if (has('adduser_submit') || changeCopy) {
    const hostname = await p.hostnameFor(str(post.pred_hostname), p.hostname ?? '')
    const r = await p.addUser(
      typeof database === 'string' ? database : '',
      p.username ?? '',
      hostname,
      password,
      p.menus !== null,
      changeCopy,
    )
    if (r.message !== null) message = r.message
    queries = r.queries
    display = r.display
    sql = r.sql
    addUserError = r.error
    reload ||= r.reload
    if (!r.error)
      account = { username: (post.pred_username ?? '') === 'any' ? '' : (p.username ?? ''), hostname }
  }
  if (changeCopy && p.username !== null && p.hostname !== null) {
    queries = await p.copyGrantQueries(
      queries,
      p.username,
      p.hostname,
      str(post.old_username),
      str(post.old_hostname),
    )
  }
  let itemType = ''
  if (routinename !== '' && typeof database === 'string')
    itemType = await p.routineType(database, routinename)
  if (has('update_privs')) {
    if (Array.isArray(database)) {
      const statements: string[] = []
      for (const db of database) {
        const r = await p.updatePrivileges(
          p.username ?? '',
          p.hostname ?? '',
          tablename ?? routinename,
          db,
          itemType,
        )
        statements.push(r.sql)
        message = r.message
      }
      sql = statements.join('\n')
    } else {
      const r = await p.updatePrivileges(
        p.username ?? '',
        p.hostname ?? '',
        tablename ?? routinename,
        database ?? '',
        itemType,
      )
      sql = r.sql
      message = r.message
    }
  }
  if (has('changeUserGroup') && p.menus !== null && gate.isSuperUser && gate.isCreateUser) {
    await p.setUserGroup(p.username ?? '', str(post.userGroup))
    message = { type: 'success', text: t('Your SQL query has been executed successfully.') }
  }
  if (has('revokeall')) {
    const r = await p.revoke(
      typeof database === 'string' ? database : '',
      tablename ?? routinename,
      p.username ?? '',
      p.hostname ?? '',
      itemType,
    )
    message = r.message
    sql = r.sql
  }
  if (has('change_pw')) {
    try {
      message = await p.updatePassword(p.username ?? '', p.hostname ?? '')
    } catch (e) {
      if (e instanceof PasswordUpdateFailure) return answer({ type: 'error', text: e.message }, e.sql)
      throw e
    }
  }
  if (has('delete') || (changeCopy && modeBelow4(post.mode))) {
    const r = await p.dataForDeleteUsers(queries, changeCopy)
    queries = r.queries
    reload ||= r.reload
    if (!changeCopy) {
      const d = await p.deleteUser(queries)
      sql = d.sql
      message = d.message
    }
  }
  if (changeCopy) {
    queries = await p.runQueries(queries, display)
    message = { type: 'success', text: t('Your SQL query has been executed successfully.') }
    sql = queries.join('\n')
    account = { username: p.username ?? '', hostname: p.hostname ?? '' }
  }
  const reloadMessage = await p.updateMessageForReload()
  if (reloadMessage !== null) message = reloadMessage
  await p.ajaxExtraData()
  const final = message ??
    notice ?? { type: 'success' as const, text: t('Your SQL query has been executed successfully.') }
  return answer(final, sql, { account, addUserError, reload })
}

/** `$request->getParsedBodyParam('mode') < 4` (PHP: a missing value is null, null < 4) */
function modeBelow4(v: string | readonly string[] | undefined): boolean {
  if (v === undefined) return true
  if (typeof v !== 'string') return false
  const n = Number(v.trim())
  return Number.isNaN(n) ? v < '4' : n < 4
}

/** pma: AccountLockController / AccountUnlockController (+ AccountLocking) */
export async function accountLock(
  p: Privileges,
  user: string,
  host: string,
  lock: boolean,
): Promise<PrivMessage> {
  if (!p.hasAccountLocking) {
    return { type: 'error', text: p.ctx.tr.gettext('Account locking is not supported.') }
  }
  try {
    await p.ctx.conn.query(accountLockQuery(user, host, lock), lock ? 'privileges.lock' : 'privileges.unlock')
  } catch (e) {
    if (e instanceof MysqlError) return { type: 'error', text: `#${e.extra.errno ?? 0} - ${e.message}` }
    throw e
  }
  return {
    type: 'success',
    text: sprintf(
      p.ctx.tr.gettext(
        lock
          ? 'The account %s@%s has been successfully locked.'
          : 'The account %s@%s has been successfully unlocked.',
      ),
      user,
      host,
    ),
  }
}

/**
 * The users of a database, or of a table: Database\PrivilegesController and
 * Table\PrivilegesController (getAllPrivileges with the table). Like them it only validates the
 * names; it neither selects the database nor checks the table.
 */
export async function dbPrivileges(
  p: Privileges,
  db0: string,
  table0?: string,
): Promise<DbPrivilegesResponse> {
  let db = db0
  let table = table0
  if ((await p.ctx.dbi.getLowerCaseNames()) === 1) {
    db = db.toLowerCase()
    table = table?.toLowerCase()
  }
  const grant = await p.isGrantUser()
  const create = await p.isCreateUser()
  const superUser = await p.isSuperUser()
  const gate: PrivGate = {
    noPrivileges: !superUser && !grant && !create,
    notice:
      !grant && !create
        ? p.ctx.tr.gettext('You do not have the privileges to administrate the users!')
        : null,
    isSuperUser: superUser,
    isGrantUser: grant,
    isCreateUser: create,
    menusWork: p.menus !== null,
  }
  const named = table === undefined ? { gate, db } : { gate, db, table }
  if (gate.noPrivileges) return { ...named, accounts: [] }
  const accounts = superUser ? await p.allPrivileges(db, table ?? null) : []
  return { ...named, accounts }
}

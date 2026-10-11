import type {
  AccountPrivileges,
  ChangePasswordFields,
  LoginInformation,
  PrivForm,
  PrivItem,
  PrivMessage,
  PrivilegesTable,
  SpecificRight,
  SpecificRights,
  UserOverviewRow,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import {
  type MenusFeature,
  type MetaConn,
  type RelationParameters,
  cleanupUserStorage,
  setUserGroup as storeUserGroup,
  userGroupAssignments,
  userGroupCount,
  userGroupOfUser,
} from '@bettermyadmin/metadata'
import {
  NO_SSL,
  type PrivRow,
  type SslRequirement,
  accountName,
  addUserNeedsHash,
  addUserQueries,
  backquote,
  copyDbGrantQuery,
  copyTableGrantQuery,
  createUserDatabaseQueries,
  dropDatabaseIfExistsQuery,
  dropUserQuery,
  escapeGrantWildcards,
  extractPrivInfo as extractPrivItems,
  fillInTablePrivileges,
  oldPasswordsQuery,
  parseProcPriv,
  quoteString,
  rangeOfUsers,
  revokeAllQuery,
  revokeGrantOptionQuery,
  showGrantsQuery,
  tablePrivSetMembers,
  unescapeGrantWildcards,
  updatePrivilegesQueries,
  userHostCondition,
  wildcardEscapeForGrant,
} from '@bettermyadmin/sql-gen'
import { MysqlError } from '../http/errors.ts'
import { strnatcasecmp } from '../navigation/php.ts'
import { type AdminCtx, isSuperUser } from '../server-admin/context.ts'
import { databaseList } from '../server-admin/databases.ts'
import { PrivilegeProbe } from '../shell/privileges.ts'

/** The configuration storage of the request: the control link and the discovered features. */
export interface PrivStorage {
  conn: MetaConn
  rp: RelationParameters
}

type Row = Record<string, string | null>
/** a user@host of the overview: its row and, for mysql.user rows, the extracted privileges */
type OverviewEntry = { row: PrivRow; privs: PrivItem[] | null }
/** a row of getUserSpecificRights with the defaults phpMyAdmin merges in (Column_priv => true, can_delete) */
type RightsEntry = { row: PrivRow; columnDefault: boolean; canDelete: boolean }

/** Plugins::getTranslatedDescription msgids */
const PLUGIN_DESCRIPTIONS = new Set([
  'Native MySQL authentication',
  'SHA256 password authentication',
  'Caching sha2 authentication',
  'Unix Socket based authentication',
  'Old MySQL-4.0 authentication',
])

/** A failure of updatePassword (UpdateAuthPluginFailure / UserPasswordUpdateFailure): Generator::mysqlDie. */
export class PasswordUpdateFailure extends Error {
  readonly sql: string
  constructor(message: string, sql: string) {
    super(message)
    this.sql = sql
  }
}

const isset = (v: unknown) => v !== undefined && v !== null
const str = (v: string | readonly string[] | undefined): string => (typeof v === 'string' ? v : '')

/**
 * PHP array keys: canonical decimal integers become int keys, which `ksort` (SORT_REGULAR) orders
 * numerically and before/among strings by PHP 8 comparison; other keys compare as strings.
 */
function phpKeyCompare(a: string, b: string): number {
  const ia = /^(0|-?[1-9]\d*)$/.test(a)
  const ib = /^(0|-?[1-9]\d*)$/.test(b)
  if (ia && ib) return Number(a) - Number(b)
  return a < b ? -1 : a > b ? 1 : 0
}
const ksortKeys = (keys: Iterable<string>) => [...keys].sort(phpKeyCompare)

/**
 * The account administration of Server → User accounts: the overview, the user editor at every
 * level, Add user, Copy user, passwords, revoke, delete, export. One instance per request, like
 * phpMyAdmin's (`post` is `$_POST`, `get` is `$_GET`; `username`/`hostname` the request's).
 * pma: src/Server/Privileges.php
 */
export class Privileges {
  readonly ctx: AdminCtx
  readonly storage: PrivStorage | null
  readonly post: PrivForm
  readonly get: PrivForm
  username: string | null = null
  hostname: string | null = null
  #ssl: SslRequirement = NO_SSL
  readonly #probe: PrivilegeProbe

  constructor(ctx: AdminCtx, storage: PrivStorage | null, post: PrivForm, get: PrivForm) {
    this.ctx = ctx
    this.storage = storage
    this.post = post
    this.get = get
    this.#probe = new PrivilegeProbe(ctx.conn, ctx.server, ctx.dbi.cache)
  }

  get #f() {
    return { versionInt: this.ctx.versionInt, isMariaDb: this.ctx.isMariaDb }
  }
  get #isMySql() {
    return !this.ctx.isMariaDb
  }
  get #v() {
    return this.ctx.versionInt
  }
  #t(msgid: string): string {
    return this.ctx.tr.gettext(msgid)
  }
  /** `$_REQUEST` (request_order "GP": POST wins) */
  get request(): PrivForm {
    return { ...this.get, ...this.post }
  }
  get menus(): MenusFeature | null {
    return this.storage?.rp.configurableMenusFeature ?? null
  }

  // ---------------------------------------------------------------- DatabaseInterface subset

  /** DatabaseInterface::query — throws on error. */
  async #query(sql: string, label: string): Promise<{ fields: string[]; rows: Row[] }> {
    const r = await this.ctx.conn.query(sql, label)
    const set = r.resultSets[0]
    if (set === undefined) return { fields: [], rows: [] }
    const fields = set.fields.map((f) => f.name)
    return {
      fields,
      rows: set.rows.map((row) =>
        Object.fromEntries(
          fields.map((f, i) => [
            f,
            row[i] === null || row[i] === undefined ? null : (row[i] as Buffer).toString('utf8'),
          ]),
        ),
      ),
    }
  }
  /** DatabaseInterface::tryQuery — null on error. */
  async #try(sql: string, label: string): Promise<{ fields: string[]; rows: Row[] } | null> {
    const r = await this.ctx.dbi.tryQuery(sql, label)
    if (r === null) return null
    return {
      fields: r.fields,
      rows: r.rows.map((row) => Object.fromEntries(r.fields.map((f, i) => [f, row[i] ?? null]))),
    }
  }
  async #value(sql: string, label: string): Promise<string | null | false> {
    const r = await this.#try(sql, label)
    if (r === null) return false
    const f = r.fields[0]
    const row = r.rows[0]
    if (row === undefined || f === undefined) return false
    return row[f] ?? null
  }
  async #singleRow(sql: string, label: string): Promise<Row | null> {
    return (await this.#try(sql, label))?.rows[0] ?? null
  }
  async #column(sql: string, label: string): Promise<string[]> {
    const r = await this.#try(sql, label)
    if (r === null) return []
    const f = r.fields[0] as string
    return r.rows.map((row) => row[f] ?? '')
  }

  isSuperUser(): Promise<boolean> {
    return isSuperUser(this.ctx.dbi)
  }
  isGrantUser(): Promise<boolean> {
    return this.#probe.isGrantUser(this.#v, this.ctx.isMariaDb)
  }
  isCreateUser(): Promise<boolean> {
    return this.#probe.isCreateUser(this.#v, this.ctx.isMariaDb)
  }
  currentUser(): Promise<string> {
    return this.ctx.dbi.getCurrentUser()
  }

  #msg(type: PrivMessage['type'], msgid: string, ...params: string[]): PrivMessage {
    return { type, text: params.length > 0 ? sprintf(this.#t(msgid), ...params) : this.#t(msgid) }
  }

  // ---------------------------------------------------------------- privilege lists

  /** extractPrivInfo; a row with `Table_priv` reads the available table grants first (fillInTablePrivileges). */
  async extractPrivInfo(row: PrivRow | null, tablePrivs = false): Promise<PrivItem[]> {
    let r = row
    if (r !== null && isset(r.Table_priv)) r = fillInTablePrivileges(r, await this.#tablePrivMembers())
    return this.#translate(extractPrivItems(r, this.post, tablePrivs, this.request))
  }
  #translate(items: PrivItem[]): PrivItem[] {
    return items.map((p) => ({ ...p, title: this.#t(p.title) }))
  }
  /** `SHOW COLUMNS FROM `mysql`.`tables_priv` LIKE 'Table_priv';` — run each time like phpMyAdmin. */
  async #tablePrivMembers(): Promise<string[]> {
    const row = await this.#singleRow(
      "SHOW COLUMNS FROM `mysql`.`tables_priv` LIKE 'Table_priv';",
      'privileges.tablePrivSet',
    )
    return tablePrivSetMembers(row?.Type ?? '')
  }

  // ---------------------------------------------------------------- forms

  /** pma: Privileges::getSqlQueryForDisplayPrivTable */
  #displayPrivTableQuery(db: string, table: string, user: string, host: string): string {
    if (db === '*') return `SELECT * FROM \`mysql\`.\`user\`${userHostCondition(user, host)};`
    if (table === '*')
      return `SELECT * FROM \`mysql\`.\`db\`${userHostCondition(user, host)} AND \`Db\` = ${quoteString(db)}`
    return (
      `SELECT \`Table_priv\` FROM \`mysql\`.\`tables_priv\`${userHostCondition(user, host)}` +
      ` AND \`Db\` = ${quoteString(unescapeGrantWildcards(db))} AND \`Table_name\` = ${quoteString(table)};`
    )
  }

  /** pma: Privileges::getHtmlToDisplayPrivilegesTable */
  async privilegesTable(db0 = '*', table0 = '*', submit = true): Promise<PrivilegesTable> {
    const db = db0
    const table = db === '*' ? '*' : table0
    let user = ''
    let host = ''
    let row: PrivRow = {}
    if (this.username !== null) {
      user = this.username
      host = this.hostname ?? ''
      row =
        (await this.#singleRow(this.#displayPrivTableQuery(db, table, user, host), 'privileges.privTable')) ??
        {}
    }
    if (Object.keys(row).length === 0) {
      if (table === '*' && (await this.isSuperUser())) {
        row = {}
        const res = await this.#query(
          `SHOW COLUMNS FROM \`mysql\`.${db === '*' ? '`user`' : '`db`'};`,
          'privileges.defaults',
        )
        for (const r of res.rows) {
          const col = r[res.fields[0] as string] ?? ''
          if (col.startsWith('max_')) row[col] = '0'
          else if (col.startsWith('x509_') || col.startsWith('ssl_')) row[col] = ''
          else row[col] = 'N'
        }
      } else if (table === '*') {
        row = {}
      } else {
        row = { Table_priv: '' }
      }
    }
    let columns: PrivilegesTable['columns'] = null
    if (isset(row.Table_priv)) {
      row = fillInTablePrivileges(row, await this.#tablePrivMembers())
      const res = await this.#try(
        `SHOW COLUMNS FROM ${backquote(unescapeGrantWildcards(db))}.${backquote(table)};`,
        'privileges.tableColumns',
      )
      if (res !== null) {
        const f = res.fields[0] as string
        columns = res.rows.map((r) => ({
          name: r[f] ?? '',
          Select: false,
          Insert: false,
          Update: false,
          References: false,
        }))
      }
    }
    if (columns !== null && columns.length > 0) {
      const res = await this.#query(
        `SELECT \`Column_name\`, \`Column_priv\` FROM \`mysql\`.\`columns_priv\`${userHostCondition(user, host)}` +
          ` AND \`Db\` = ${quoteString(unescapeGrantWildcards(db))} AND \`Table_name\` = ${quoteString(table)};`,
        'privileges.columnPrivs',
      )
      for (const r of res.rows) {
        const col = columns.find((c) => c.name === r.Column_name)
        if (col === undefined) continue
        for (const p of (r.Column_priv ?? '').split(',')) {
          if (p === 'Select' || p === 'Insert' || p === 'Update' || p === 'References') col[p] = true
        }
      }
    }
    if (columns !== null && columns.length === 0) columns = null
    return {
      isGlobal: db === '*',
      isDatabase: table === '*',
      // only what the template reads (never the stored password hash)
      row: Object.fromEntries(
        Object.entries(row)
          .filter(([k]) => /_priv$|^(max_|ssl_|x509_)/.test(k))
          .map(([k, v]) => [k, v ?? null]),
      ),
      columns,
      hasSubmit: submit,
      supportsReferencesPrivilege: !this.ctx.isMariaDb && this.#v >= 50622,
      isMariaDb: this.ctx.isMariaDb,
    }
  }

  /** pma: Privileges::getUsernameAndHostnameLength */
  async #nameLengths(): Promise<[string, string]> {
    let user = '16'
    let host = '41'
    const rows = await this.ctx.dbi.fetchResultSimple(
      "SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH FROM information_schema.columns WHERE table_schema = 'mysql' AND table_name = 'user' AND COLUMN_NAME IN ('User', 'Host')",
    )
    for (const r of rows) {
      if (r.COLUMN_NAME === 'User') user = r.CHARACTER_MAXIMUM_LENGTH ?? ''
      else if (r.COLUMN_NAME === 'Host') host = r.CHARACTER_MAXIMUM_LENGTH ?? ''
    }
    return [user, host]
  }

  /** pma: Privileges::getCurrentAuthenticationPlugin */
  async currentAuthPlugin(user: string, host: string): Promise<string> {
    const v = await this.#value(
      `SELECT \`plugin\` FROM \`mysql\`.\`user\`${userHostCondition(user, host)} LIMIT 1`,
      'privileges.plugin',
    )
    return typeof v === 'string' ? v : 'mysql_native_password'
  }

  /** pma: Privileges::getDefaultAuthenticationPlugin */
  async #defaultAuthPlugin(): Promise<string | null> {
    if (this.#v >= 50702) {
      const v = await this.#value('SELECT @@default_authentication_plugin', 'privileges.defaultPlugin')
      return typeof v === 'string' ? v : null
    }
    return 'mysql_native_password'
  }

  /** pma: Plugins::getAuthentication (minus mysql_old_password, as every caller does) */
  async #authPlugins(): Promise<Array<{ name: string; description: string }>> {
    const res = await this.#query(
      "SELECT `PLUGIN_NAME`, `PLUGIN_DESCRIPTION` FROM `information_schema`.`PLUGINS` WHERE `PLUGIN_TYPE` = 'AUTHENTICATION';",
      'privileges.authPlugins',
    )
    const out = new Map<string, string>()
    for (const r of res.rows) {
      const d = r.PLUGIN_DESCRIPTION ?? ''
      out.set(r.PLUGIN_NAME ?? '', PLUGIN_DESCRIPTIONS.has(d) ? this.#t(d) : d)
    }
    out.delete('mysql_old_password')
    return [...out].map(([name, description]) => ({ name, description }))
  }

  /** pma: Privileges::getHtmlForLoginInformationFields */
  async loginInformation(user: string | null = null, host: string | null = null): Promise<LoginInformation> {
    const [usernameLength, hostnameLength] = await this.#nameLengths()
    const predefinedUsername = this.username === '' ? 'any' : 'userdefined'
    const current = await this.#value('SELECT USER();', 'privileges.user')
    let thisHost: string | null = null
    if (typeof current === 'string' && current !== '') {
      thisHost = current.slice(current.lastIndexOf('@') + 1).replaceAll("'", '')
    }
    let predefinedHostname: LoginInformation['predefinedHostname'] = 'any'
    if (this.hostname !== null) {
      const h = this.hostname.toLowerCase()
      predefinedHostname =
        h === 'localhost' || h === '127.0.0.1' ? 'localhost' : h === '%' ? 'any' : 'userdefined'
    }
    const authPlugin =
      user !== null && host !== null
        ? await this.currentAuthPlugin(user, host)
        : await this.#defaultAuthPlugin()
    const isNew = (this.#isMySql && this.#v >= 50507) || (this.ctx.isMariaDb && this.#v >= 50200)
    const authPlugins = isNew
      ? await this.#authPlugins()
      : [{ name: 'mysql_native_password', description: this.#t('Native MySQL authentication') }]
    return {
      predefinedUsername,
      predefinedHostname,
      usernameLength,
      hostnameLength,
      username: this.username,
      hostname: this.hostname,
      thisHost,
      isChange: user !== null && host !== null,
      authPlugin,
      authPlugins,
      isNew,
    }
  }

  /** pma: Privileges::getFormForChangePassword (inside the user editor: editOthers) */
  async changePasswordFields(user: string, host: string): Promise<ChangePasswordFields> {
    const origAuthPlugin = await this.currentAuthPlugin(user, host)
    const isNew = (this.#isMySql && this.#v >= 50507) || (this.ctx.isMariaDb && this.#v >= 50200)
    const hasMore = (this.#isMySql && this.#v >= 50706) || (await this.isSuperUser())
    const authPlugins =
      isNew && hasMore
        ? await this.#authPlugins()
        : [{ name: 'mysql_native_password', description: this.#t('Native MySQL authentication') }]
    return {
      username: user,
      hostname: host,
      isNew,
      hasMoreAuthPlugins: hasMore,
      authPlugins,
      origAuthPlugin,
      allowNoPassword: this.ctx.server.AllowNoPassword,
    }
  }

  // ---------------------------------------------------------------- overview

  /** pma: Privileges::getDbRightsForUserOverview — users of every privilege table, by user then host. */
  async #dbRightsForOverview(initial: string | null): Promise<Map<string, Map<string, OverviewEntry>>> {
    const mysqlTables = await this.#column('SHOW TABLES FROM `mysql`', 'privileges.mysqlTables')
    const where = rangeOfUsers(initial)
    const sqls = ['user', 'db', 'tables_priv', 'columns_priv', 'procs_priv']
      .filter((t) => mysqlTables.includes(t))
      .map((t) => `(SELECT DISTINCT \`User\`, \`Host\` FROM \`mysql\`.\`${t}\` ${where})`)
    const res = await this.#query(
      `${sqls.join(' UNION ')} ORDER BY \`User\` ASC, \`Host\` ASC`,
      'privileges.overviewUsers',
    )
    const rights = new Map<string, Map<string, OverviewEntry>>()
    for (const r of res.rows) {
      const user = r.User ?? ''
      let hosts = rights.get(user)
      if (hosts === undefined) {
        hosts = new Map()
        rights.set(user, hosts)
      }
      hosts.set(r.Host ?? '', {
        row: { User: '', Host: '%', Password: '?', Grant_priv: 'N', ...r },
        privs: null,
      })
    }
    return new Map(ksortKeys(rights.keys()).map((k) => [k, rights.get(k) as Map<string, OverviewEntry>]))
  }

  /** pma: Privileges::getHtmlForInitials (null: not shown) */
  async #initials(): Promise<Array<{ initial: string; available: boolean }> | null> {
    const count = await this.#value('SELECT COUNT(*) FROM `mysql`.`user`', 'privileges.userCount')
    if (count === false || count === null || Number(count) <= 20) return null
    const res = await this.#try('SELECT DISTINCT UPPER(LEFT(`User`, 1)) FROM `user`', 'privileges.initials')
    if (res === null) return null
    const map = new Map<string, boolean>()
    for (const r of res.rows) map.set(r[res.fields[0] as string] ?? '', true)
    for (let c = 65; c <= 90; c++)
      if (!map.has(String.fromCharCode(c))) map.set(String.fromCharCode(c), false)
    return [...map]
      .sort(([a], [b]) => strnatcasecmp(a, b))
      .map(([initial, available]) => ({ initial, available }))
  }

  /** Compatibility::hasAccountLocking */
  get hasAccountLocking(): boolean {
    return this.ctx.isMariaDb ? this.#v >= 100402 : this.#v >= 50706
  }

  /** pma: Privileges::getUserPrivileges — the mysql.user row (prepared), MariaDB's lock from global_priv. */
  async #userPrivileges(user: string, host: string): Promise<Row | null> {
    const rows = await this.ctx.conn
      .execute(
        'SELECT * FROM `mysql`.`user` WHERE `User` = ? AND `Host` = ?;',
        [user, host],
        'privileges.userRow',
      )
      .catch((e) => {
        if (e instanceof MysqlError) return null
        throw e
      })
    if (rows === null) return null
    const row = rows[0]
    if (row === undefined) return null
    if (!this.hasAccountLocking || !this.ctx.isMariaDb) return row
    row.account_locked = 'N'
    const g = await this.ctx.conn
      .execute(
        'SELECT * FROM `mysql`.`global_priv` WHERE `User` = ? AND `Host` = ?;',
        [user, host],
        'privileges.globalPriv',
      )
      .catch(() => null)
    const priv = g?.[0]?.Priv
    if (priv === undefined || priv === null) return row
    try {
      const parsed = JSON.parse(priv) as unknown
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as Record<string, unknown>).account_locked
      ) {
        row.account_locked = 'Y'
      }
    } catch {
      // invalid JSON: unlocked
    }
    return row
  }

  /**
   * pma: Privileges::getHtmlForUserOverview (+ getUsersOverview): the users rows, the initials, the
   * notices. `users` is null when the list is deferred (≥ 50 users without initial/showall).
   */
  async overview(initial: string | null, showAll: boolean) {
    const passwordColumn = this.#isMySql && this.#v >= 50706 ? 'authentication_string' : 'Password'
    const sql = `SELECT *, IF(\`${passwordColumn}\` = _latin1 '', 'N', 'Y') AS \`Password\` FROM \`mysql\`.\`user\` ${rangeOfUsers(initial)} ORDER BY \`User\` ASC, \`Host\` ASC`
    const res = await this.#try(sql, 'privileges.overview')
    if (res === null) {
      // checkStructureOfPrivilegeTable
      if ((await this.#try('SELECT 1 FROM `mysql`.`user`', 'privileges.structure')) === null) {
        return { error: this.#msg('error', 'Not enough privilege to view users.'), structureError: false }
      }
      return {
        error: {
          type: 'error' as const,
          text: 'Your privilege table structure seems to be older than this MySQL version!<br>Please run the <code>mysql_upgrade</code> command that should be included in your MySQL server distribution to solve this problem!',
          html: true,
        },
        structureError: true,
      }
    }
    const rights = await this.#dbRightsForOverview(initial)
    let emptyUserNotice = false
    for (const [user, hosts] of rights)
      for (const host of hosts.keys()) if (user === '' && host === 'localhost') emptyUserNotice = true
    const initials = await this.#initials()
    let users: UserOverviewRow[] | null = null
    let groupCount = 0
    if (initial !== null || showAll || res.rows.length < 50) {
      for (const row of res.rows) {
        const user = row.User ?? ''
        let hosts = rights.get(user)
        if (hosts === undefined) {
          hosts = new Map()
          rights.set(user, hosts)
        }
        hosts.set(row.Host ?? '', { row, privs: await this.extractPrivInfo(row) })
      }
      let groups = new Map<string, string>()
      const menus = this.menus
      if (menus !== null && this.storage !== null) {
        groups = await userGroupAssignments(this.storage.conn, menus)
        groupCount = await userGroupCount(this.storage.conn, menus)
      }
      users = []
      for (const hosts of rights.values()) {
        for (const hostKey of ksortKeys(hosts.keys())) {
          const { row: h, privs } = hosts.get(hostKey) as OverviewEntry
          const r = await this.#userPrivileges(h.User ?? '', h.Host ?? '')
          const hasPassword =
            (isset(r?.authentication_string) && r?.authentication_string !== '') ||
            (isset(r?.Password) && r?.Password !== '')
          users.push({
            user: h.User ?? '',
            host: h.Host ?? '',
            hasPassword,
            hasSelectPriv: isset(h.Select_priv),
            privileges: privs ?? [{ name: 'USAGE', title: '', columns: null }],
            group: groups.get(h.User ?? '') ?? '',
            hasGrant: h.Grant_priv === 'Y',
            isAccountLocked: r?.account_locked === 'Y',
          })
        }
      }
    }
    return { error: null, structureError: false, emptyUserNotice, initials, users, groupCount }
  }

  // ---------------------------------------------------------------- user editor

  /** pma: Privileges::userExists */
  async userExists(user: string, host: string): Promise<boolean> {
    const v = await this.#value(
      `SELECT '1' FROM \`mysql\`.\`user\`${userHostCondition(user, host)};`,
      'privileges.userExists',
    )
    return v !== false && v !== null && v !== '' && v !== '0'
  }

  /** pma: Privileges::getUserSpecificRights */
  async #userSpecificRights(
    user: string,
    host: string,
    type: 'database' | 'table' | 'routine',
    dbname: string,
  ) {
    let cond = userHostCondition(user, host)
    let tables: string[]
    let key: string
    if (type === 'database') {
      tables = ['tables_priv', 'columns_priv', 'procs_priv']
      key = 'Db'
    } else if (type === 'table') {
      cond += ` AND \`Db\` LIKE ${quoteString(dbname)}`
      tables = ['columns_priv']
      key = 'Table_name'
    } else {
      cond += ` AND \`Db\` LIKE ${quoteString(dbname)}`
      tables = ['procs_priv']
      key = 'Routine_name'
    }
    const mysqlTables = await this.#column('SHOW TABLES FROM `mysql`;', 'privileges.mysqlTables')
    const sqls = tables
      .filter((t) => mysqlTables.includes(t))
      .map((t) => `SELECT DISTINCT \`${key}\` FROM \`mysql\`.${backquote(t)}${cond}`)
    const rights = new Map<string, RightsEntry>()
    const res = await this.#query(
      `(${sqls.join(') UNION (')}) ORDER BY \`${key}\` ASC`,
      'privileges.specificRights',
    )
    for (const r of res.rows) {
      // $userDefaults: [key => '', 'Grant_priv' => 'N', 'privs' => ['USAGE'], 'Column_priv' => true]
      const row: PrivRow = { [key]: '', Grant_priv: 'N', ...r }
      if (type === 'database') row.Db = escapeGrantWildcards(row.Db ?? '')
      rights.set(row[key] ?? '', { row, columnDefault: true, canDelete: false })
    }
    const sql =
      type === 'database'
        ? `SELECT * FROM \`mysql\`.\`db\`${cond} ORDER BY \`Db\` ASC`
        : type === 'table'
          ? `SELECT \`Table_name\`, \`Table_priv\`, IF(\`Column_priv\` = _latin1 '', 0, 1) AS 'Column_priv' FROM \`mysql\`.\`tables_priv\`${cond} ORDER BY \`Table_name\` ASC;`
          : `SELECT \`Routine_name\`, \`Proc_priv\` FROM \`mysql\`.\`procs_priv\`${cond} ORDER BY \`Routine_name\``
    const res2 = await this.#query(sql, 'privileges.specificRights')
    for (const r of res2.rows) {
      const k = r[key] ?? ''
      const old = rights.get(k)
      rights.set(
        k,
        old !== undefined
          ? { ...old, row: { ...old.row, ...r } }
          : { row: { ...r }, columnDefault: false, canDelete: false },
      )
      if (type === 'database') {
        const db = rights.get(r.Db ?? '')
        if (db !== undefined) db.canDelete = true
      }
    }
    return rights
  }

  /** Routines::getDetails (QueryGenerator::getInformationSchemaRoutinesRequest) */
  async #routines(db: string, name: string | null = null): Promise<Array<{ name: string; type: string }>> {
    let sql =
      'SELECT `SPECIFIC_NAME` AS `Name`, `ROUTINE_TYPE` AS `Type`, `DEFINER` AS `Definer`, `DTD_IDENTIFIER`' +
      ` FROM \`information_schema\`.\`ROUTINES\` WHERE \`ROUTINE_SCHEMA\` ${await this.ctx.dbi.collateForIS()} = ${quoteString(db)}`
    if (name !== null) sql += ` AND \`SPECIFIC_NAME\` = ${quoteString(name)}`
    sql += ' ORDER BY `SPECIFIC_NAME`'
    const rows = await this.ctx.dbi.fetchResultSimple(sql)
    return rows.map((r) => ({ name: r.Name ?? '', type: r.Type ?? '' }))
  }

  /** pma: Privileges::getHtmlForAllTableSpecificRights */
  async specificRights(
    user: string,
    host: string,
    type: 'database' | 'table' | 'routine',
    dbname = '',
  ): Promise<SpecificRights> {
    const rights = await this.#userSpecificRights(user, host, type, dbname)
    const found: string[] = []
    const rows: SpecificRight[] = []
    const grantUser = await this.isGrantUser()
    for (const k of ksortKeys(rights.keys())) {
      const { row: plain, columnDefault: colDefault, canDelete } = rights.get(k) as RightsEntry
      let name: string
      let grant: boolean
      let sub: boolean
      let privileges: PrivItem[]
      const link = { dbname: '', tablename: '', routinename: '' }
      const columnPriv = isset(plain.Column_priv) ? plain.Column_priv : colDefault === true ? '1' : undefined
      const notEmpty = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== '0'
      if (type === 'database') {
        name = plain.Db ?? ''
        grant = plain.Grant_priv === 'Y'
        sub = notEmpty(plain.Table_priv) || notEmpty(columnPriv)
        const { Column_priv: _c, ...forPrivs } = plain
        privileges = await this.extractPrivInfo(forPrivs)
        link.dbname = plain.Db ?? ''
      } else if (type === 'table') {
        name = plain.Table_name ?? ''
        grant = (plain.Table_priv ?? '').split(',').includes('Grant')
        sub = notEmpty(columnPriv)
        const { Column_priv: _c, ...forPrivs } = plain
        privileges = await this.extractPrivInfo(forPrivs)
        link.dbname = escapeGrantWildcards(dbname)
        link.tablename = plain.Table_name ?? ''
      } else {
        name = plain.Routine_name ?? ''
        grant = (plain.Proc_priv ?? '').split(',').includes('Grant')
        sub = false
        privileges = await this.extractPrivInfo(parseProcPriv(plain.Proc_priv ?? ''))
        link.dbname = escapeGrantWildcards(dbname)
        link.routinename = plain.Routine_name ?? ''
      }
      found.push(name)
      rows.push({
        name,
        grant,
        sub,
        privileges,
        edit: grantUser ? { ...link } : null,
        revoke: type !== 'database' || canDelete === true ? { ...link } : null,
      })
    }
    const out: SpecificRights = {
      type,
      rows,
      database: dbname,
      escapedDatabase: escapeGrantWildcards(dbname),
      databases: [],
      tables: [],
      routines: [],
    }
    if (type === 'database') {
      for (const db of await databaseList(this.ctx)) {
        if (db === 'information_schema' || db === 'performance_schema') continue
        const escaped = escapeGrantWildcards(db)
        if (found.includes(escaped)) continue
        out.databases.push({ name: db, value: escaped })
      }
    } else if (type === 'table') {
      const res = await this.#try(`SHOW TABLES FROM ${backquote(dbname)}`, 'privileges.tables')
      if (res !== null) {
        const f = res.fields[0] as string
        for (const r of res.rows) if (!found.includes(r[f] ?? '')) out.tables.push(r[f] ?? '')
      }
    } else {
      for (const r of await this.#routines(dbname)) if (!found.includes(r.name)) out.routines.push(r.name)
    }
    return out
  }

  /** pma: Privileges::getUserGroupForUser */
  async userGroupForUser(username: string): Promise<string | null> {
    const menus = this.menus
    if (menus === null || this.storage === null) return null
    return userGroupOfUser(this.storage.conn, menus, username)
  }

  /** pma: Privileges::getRoutineType */
  async routineType(db: string, routine: string): Promise<string> {
    return (await this.#routines(db, routine))[0]?.type ?? ''
  }

  /** pma: Privileges::getRoutinePrivileges */
  async routinePrivileges(
    user: string,
    host: string,
    db: string,
    routine: string,
  ): Promise<Record<string, string>> {
    const v = await this.#value(
      `SELECT \`Proc_priv\` FROM \`mysql\`.\`procs_priv\`${userHostCondition(user, host)} AND \`Db\` = ${quoteString(unescapeGrantWildcards(db))} AND \`Routine_name\` LIKE ${quoteString(routine)};`,
      'privileges.routine',
    )
    return parseProcPriv(typeof v === 'string' ? v : '')
  }

  // ---------------------------------------------------------------- export

  /** pma: Privileges::getGrants */
  async #grants(user: string, host: string): Promise<string> {
    return (await this.#column(showGrantsQuery(user, host), 'privileges.showGrants'))
      .map((g) => `${g};\n\n`)
      .join('')
  }

  /** pma: Privileges::getExportUserDefinitionTextarea (the textarea's text) */
  async exportUserDefinition(user: string, host: string, selected: string[] | null): Promise<string> {
    let out = ''
    if (selected !== null) {
      for (const each of [...new Set(selected)]) {
        const amp = each.indexOf('&')
        const exportUser = each.slice(0, amp === -1 ? 0 : amp)
        // mb_strrpos() + 1: false + 1 is 1
        const semi = each.lastIndexOf(';')
        const exportHost = each.slice(semi === -1 ? 1 : semi + 1)
        out += `# ${sprintf(this.#t('Privileges for %s'), `\`${exportUser}\`@\`${exportHost}\``)}\n\n`
        out += `${await this.#grants(exportUser, exportHost)}\n`
      }
    } else {
      out += await this.#grants(user, host)
    }
    return phpTrim(out)
  }

  // ---------------------------------------------------------------- table → privileges

  /** pma: Privileges::getAllPrivileges (users of a database, and of a table when given) */
  async allPrivileges(db: string, table: string | null): Promise<AccountPrivileges[]> {
    const list = `\`Select_priv\`,
            \`Insert_priv\`,
            \`Update_priv\`,
            \`Delete_priv\`,
            \`Create_priv\`,
            \`Drop_priv\`,
            \`Grant_priv\`,
            \`Index_priv\`,
            \`Alter_priv\`,
            \`References_priv\`,
            \`Create_tmp_table_priv\`,
            \`Lock_tables_priv\`,
            \`Create_view_priv\`,
            \`Show_view_priv\`,
            \`Create_routine_priv\`,
            \`Alter_routine_priv\`,
            \`Execute_priv\`,
            \`Event_priv\`,
            \`Trigger_priv\`,`
    const compared = [
      'Select_priv',
      'Insert_priv',
      'Update_priv',
      'Delete_priv',
      'Create_priv',
      'Drop_priv',
      'Grant_priv',
      'References_priv',
      'Create_tmp_table_priv',
      'Lock_tables_priv',
      'Create_view_priv',
      'Show_view_priv',
      'Create_routine_priv',
      'Alter_routine_priv',
      'Execute_priv',
      'Event_priv',
      'Trigger_priv',
    ]
      .map((c) => `BINARY \`${c}\` = 'N'`)
      .join(' AND\n            ')
    // the layout of getGlobalAndDatabasePrivileges (statements are compared whitespace-collapsed)
    const global = await this.#query(
      `
            (
                SELECT \`User\`, \`Host\`, ${list} '*' AS \`Db\`, 'g' AS \`Type\`
                FROM \`mysql\`.\`user\`
                WHERE NOT (${compared})
            )
            UNION
            (
                SELECT \`User\`, \`Host\`, ${list} \`Db\`, 'd' AS \`Type\`
                FROM \`mysql\`.\`db\`
                WHERE ${quoteString(db)} LIKE \`Db\` AND NOT (${compared})
            )
            ORDER BY \`User\` ASC, \`Host\` ASC, \`Db\` ASC;
        `,
      'privileges.allPrivileges',
    )
    let tables: Row[] = []
    if (table !== null) {
      tables = await this.ctx.conn
        .execute(
          "SELECT `User`, `Host`, `Db`, 't' AS `Type`, `Table_name`, `Table_priv` FROM `mysql`.`tables_priv` WHERE ? LIKE `Db` AND ? LIKE `Table_name` AND NOT (`Table_priv` = '' AND Column_priv = '') ORDER BY `User` ASC, `Host` ASC, `Db` ASC, `Table_priv` ASC;",
          [db, table],
          'privileges.tablePrivileges',
        )
        .catch(() => [])
    }
    const routines = await this.#query(
      `SELECT *, 'r' AS \`Type\` FROM \`mysql\`.\`procs_priv\` WHERE Db = ${quoteString(db)};`,
      'privileges.routinePrivileges',
    )
    const out = new Map<string, AccountPrivileges>()
    for (const r of [...global.rows, ...tables, ...routines.rows]) {
      const key = `${r.User ?? ''}@${r.Host ?? ''}`
      let a = out.get(key)
      if (a === undefined) {
        a = { user: r.User ?? '', host: r.Host ?? '', privileges: [] }
        out.set(key, a)
      }
      if (r.Type === 'r') {
        a.privileges.push({
          type: 'r',
          database: r.Db ?? '',
          table: null,
          routine: r.Routine_name ?? '',
          hasGrant: (r.Proc_priv ?? '').includes('Grant'),
          privileges: (r.Proc_priv ?? '').split(',').map((p) => ({ name: p, title: '', columns: null })),
        })
      } else if (r.Type === 't') {
        const set = (r.Table_priv ?? '').split(',')
        const specific: PrivRow = {}
        for (const [k] of [
          ['Delete'],
          ['Create'],
          ['Drop'],
          ['Index'],
          ['Alter'],
          ['Create View'],
          ['Show view'],
          ['Trigger'],
        ] as const)
          specific[k] = set.includes(k) ? 'Y' : 'N'
        a.privileges.push({
          type: 't',
          database: r.Db ?? '',
          table: r.Table_name ?? '',
          routine: null,
          hasGrant: (r.Table_priv ?? '').includes('Grant'),
          privileges: await this.extractPrivInfo(specific, true),
        })
      } else {
        a.privileges.push({
          type: r.Type === 'g' ? 'g' : 'd',
          database: r.Db ?? '',
          table: null,
          routine: null,
          hasGrant: r.Grant_priv === 'Y',
          privileges: await this.extractPrivInfo(r),
        })
      }
    }
    return [...out.values()]
  }

  // ---------------------------------------------------------------- actions

  /** pma: Privileges::getHostname */
  async hostnameFor(pred: string, given: string): Promise<string> {
    switch (pred) {
      case 'any':
        return '%'
      case 'localhost':
        return 'localhost'
      case 'hosttable':
        return ''
      case 'thishost': {
        const v = await this.#value('SELECT USER()', 'privileges.user')
        if (typeof v === 'string') return v.slice(v.lastIndexOf('@') + 1)
      }
    }
    return given
  }

  /** pma: Privileges::setUserGroup */
  async setUserGroup(username: string, userGroup: string): Promise<void> {
    const menus = this.menus
    if (menus === null || this.storage === null) return
    await storeUserGroup(this.storage.conn, menus, username, userGroup)
  }

  /** pma: Privileges::getUserGroupCount (0 without the feature) */
  async userGroupCount(): Promise<number> {
    const menus = this.menus
    if (menus === null || this.storage === null) return 0
    return userGroupCount(this.storage.conn, menus)
  }

  /** pma: Privileges::updatePassword (throws PasswordUpdateFailure like UpdateAuthPluginFailure / UserPasswordUpdateFailure) */
  async updatePassword(user: string, host: string): Promise<PrivMessage> {
    const p = this.post
    if (isset(p.pma_pw) && isset(p.pma_pw2) && empty(p.nopass)) {
      if (looseNotEqual(str(p.pma_pw), str(p.pma_pw2)))
        return this.#msg('error', "The passwords aren't the same!")
      if (empty(p.pma_pw) || empty(p.pma_pw2)) return this.#msg('error', 'The password is empty!')
    }
    const pw = str(p.pma_pw)
    const plugin =
      typeof p.authentication_plugin === 'string'
        ? p.authentication_plugin
        : await this.currentAuthPlugin(user, host)
    const who = accountName(user, host)
    let sqlQuery: string
    let localQuery: string
    let origValue: string | null = null
    // preg_replace('@.@s', '*'): one star per byte
    const masked = pw === '' ? "''" : `PASSWORD('${'*'.repeat(Buffer.byteLength(pw, 'utf8'))}')`
    if (this.#isMySql && this.#v >= 50706) {
      const prefix =
        plugin !== 'mysql_old_password'
          ? `ALTER USER ${who} IDENTIFIED WITH ${plugin} BY `
          : `ALTER USER ${who} IDENTIFIED BY `
      sqlQuery = `${prefix}'*'`
      localQuery = prefix + quoteString(pw)
    } else if (this.ctx.isMariaDb && this.#v >= 10000) {
      sqlQuery = `SET PASSWORD FOR ${who} = PASSWORD (${quoteString(pw)})`
      localQuery = sqlQuery
    } else if (this.ctx.isMariaDb && this.#v >= 50200 && (await this.isSuperUser())) {
      if (plugin === 'mysql_native_password')
        await this.#try('SET old_passwords = 0;', 'privileges.oldPasswords')
      else if (plugin === 'sha256_password')
        await this.#try('SET `old_passwords` = 2;', 'privileges.oldPasswords')
      const hashed = await this.#hashedPassword(pw)
      sqlQuery = `SET PASSWORD FOR ${who} = ${masked}`
      localQuery = `UPDATE \`mysql\`.\`user\` SET  \`authentication_string\` = '${hashed}', \`Password\` = '',  \`plugin\` = '${plugin}'${userHostCondition(user, host)};`
    } else {
      const row = await this.#singleRow('SELECT @@old_passwords;', 'privileges.oldPasswords')
      origValue = row?.['@@old_passwords'] ?? null
      const updatePlugin = `UPDATE \`mysql\`.\`user\` SET \`plugin\` = '${plugin}'${userHostCondition(user, host)};`
      if ((await this.#try(updatePlugin, 'privileges.updatePlugin')) === null) {
        throw new PasswordUpdateFailure(this.ctx.dbi.lastError, updatePlugin)
      }
      await this.#try('FLUSH PRIVILEGES;', 'privileges.flush')
      if (plugin === 'mysql_native_password')
        await this.#try('SET old_passwords = 0;', 'privileges.oldPasswords')
      else if (plugin === 'sha256_password')
        await this.#try('SET `old_passwords` = 2;', 'privileges.oldPasswords')
      sqlQuery = `SET PASSWORD FOR ${who} = ${masked}`
      localQuery = `SET PASSWORD FOR ${who} = ${pw === '' ? "''" : `PASSWORD(${quoteString(pw)})`}`
    }
    const ok = (await this.#try(localQuery, 'privileges.password')) !== null
    // never keep the clear-text password in the statement log (Debug SQL)
    for (const e of this.ctx.conn.log) if (e.sql === localQuery) e.sql = sqlQuery
    if (!ok) throw new PasswordUpdateFailure(this.ctx.dbi.lastError, sqlQuery)
    await this.#try('FLUSH PRIVILEGES;', 'privileges.flush')
    const message = this.#msg(
      'success',
      'The password for %s was changed successfully.',
      `'${user}'@'${host}'`,
    )
    if (origValue !== null)
      await this.#try(`SET \`old_passwords\` = ${origValue};`, 'privileges.oldPasswords')
    return message
  }

  /** pma: Privileges::getHashedPassword */
  async #hashedPassword(pw: string): Promise<string> {
    const v = await this.#value(`SELECT PASSWORD(${quoteString(pw)});`, 'privileges.hash')
    for (const e of this.ctx.conn.log) if (e.label === 'privileges.hash') e.sql = "SELECT PASSWORD('***');"
    return typeof v === 'string' ? v : ''
  }

  /** pma: Privileges::getMessageAndSqlQueryForPrivilegesRevoke */
  async revoke(
    db: string,
    table: string,
    user: string,
    host: string,
    itemType: string,
  ): Promise<{ message: PrivMessage; sql: string }> {
    const target = wildcardEscapeForGrant(db, table)
    const q0 = revokeAllQuery(itemType, target, user, host)
    let q1 = revokeGrantOptionQuery(itemType, target, user, host)
    await this.#query(q0, 'privileges.revoke')
    if ((await this.#try(q1, 'privileges.revokeGrant')) === null) q1 = ''
    return {
      message: this.#msg('success', 'You have revoked the privileges for %s.', `'${user}'@'${host}'`),
      sql: `${q0} ${q1}`,
    }
  }

  /** pma: Privileges::updatePrivileges */
  async updatePrivileges(
    user: string,
    host: string,
    table: string,
    db: string,
    itemType: string,
  ): Promise<{ message: PrivMessage; sql: string }> {
    const target = wildcardEscapeForGrant(db, table)
    let q0 = revokeAllQuery(itemType, target, user, host)
    let q1 = this.post.Grant_priv !== 'Y' ? revokeGrantOptionQuery(itemType, target, user, host) : ''
    let grant: string | null = null
    let alter: string | null = null
    const privs = await this.extractPrivInfo(null)
    if (!(table !== '' && privs.map((p) => p.name).join('') === 'USAGE')) {
      const q = updatePrivilegesQueries(this.post, this.#f, privs, itemType, target, user, host, db)
      grant = q.grant
      alter = q.alter
    }
    if ((await this.#try(q0, 'privileges.revoke')) === null) q0 = ''
    if (q1 !== '' && (await this.#try(q1, 'privileges.revokeGrant')) === null) q1 = ''
    if (grant !== null) await this.#query(grant, 'privileges.grant')
    if (alter !== null) await this.#query(alter, 'privileges.alterUser')
    return {
      message: this.#msg('success', 'You have updated the privileges for %s.', `'${user}'@'${host}'`),
      sql: `${q0} ${q1} ${grant ?? ''} ${alter ?? ''}`,
    }
  }

  /** pma: Privileges::getDataForChangeOrCopyUser — the old account's stored password, or the "No user found." notice. */
  async dataForChangeOrCopyUser(oldUser: string, oldHost: string): Promise<string | null | PrivMessage> {
    const row = await this.#singleRow(
      `SELECT * FROM \`mysql\`.\`user\` ${userHostCondition(oldUser, oldHost)};`,
      'privileges.oldUser',
    )
    if (row === null) return this.#msg('notice', 'No user found.')
    this.#ssl = {
      sslType: row.ssl_type ?? null,
      sslCipher: row.ssl_cipher ?? null,
      x509Issuer: row.x509_issuer ?? null,
      x509Subject: row.x509_subject ?? null,
    }
    const r: Record<string, string | null | undefined> = { ...row }
    const v = this.#v
    if (!isset(r.password) && isset(r.Password)) r.password = r.Password
    if (
      this.#isMySql &&
      v >= 50606 &&
      v < 50706 &&
      ((isset(r.authentication_string) && empty(r.password)) ||
        (isset(r.plugin) && r.plugin === 'sha256_password'))
    ) {
      r.password = r.authentication_string
    }
    if (this.ctx.isMariaDb && v >= 50500 && isset(r.authentication_string) && empty(r.password)) {
      r.password = r.authentication_string
    }
    if (this.#isMySql && v >= 50706 && isset(r.authentication_string)) r.password = r.authentication_string
    return r.password ?? null
  }

  /** pma: Privileges::checkIfMariaDBPwdCheckPluginActive */
  async #mariaPwdCheckActive(): Promise<boolean> {
    if (!(this.ctx.isMariaDb && this.#v >= 100002)) return false
    const res = await this.#try("SHOW PLUGINS SONAME LIKE '%_password_check%'", 'privileges.pwdCheck')
    if (res === null) return false
    return res.rows.some((r) => r.Status === 'ACTIVE')
  }

  /** pma: Privileges::getSqlQueriesForDisplayAndAddUser (with the queries it runs on the way) */
  async #addUserQueries(user: string, host: string, password: string) {
    const pwdActive = await this.#mariaPwdCheckActive()
    const privs = await this.extractPrivInfo(null)
    const plugin =
      typeof this.post.authentication_plugin === 'string' ? this.post.authentication_plugin : null
    if (plugin !== null) await this.#try(oldPasswordsQuery(plugin), 'privileges.oldPasswords')
    const hashed = addUserNeedsHash(this.post, this.#f, pwdActive)
      ? await this.#hashedPassword(str(this.post.pma_pw))
      : null
    return addUserQueries({
      user,
      host,
      password,
      post: this.post,
      flavour: this.#f,
      pwdCheckPluginActive: pwdActive,
      isGrantUser: await this.isGrantUser(),
      privs,
      hashed,
      ssl: this.#ssl,
    })
  }

  /**
   * pma: Privileges::addUser (+ addUserAndCreateDatabase): runs Add user, or queues the CREATE
   * USER / GRANT of Copy user (`queries` with their masked display versions).
   */
  async addUser(
    dbname: string,
    user0: string,
    host: string,
    password: string | null,
    isMenuwork: boolean,
    isChangeCopy: boolean,
  ) {
    let user = user0
    if ((this.post.pred_username ?? '') === 'any') user = ''
    if (await this.userExists(user, host)) {
      return {
        message: {
          type: 'error' as const,
          text: sprintf(
            this.#t('The user %s already exists!'),
            `<em>'${escapeHtml(user)}'@'${escapeHtml(host)}'</em>`,
          ),
          html: true,
        },
        queries: [] as string[],
        display: null,
        sql: '',
        error: true,
        reload: false,
      }
    }
    const q = await this.#addUserQueries(user, host, password ?? '')
    if (!isChangeCopy) {
      let error = false
      // the clear-text password never stays in the statement log
      const real = q.createUserReal
      if ((await this.#try(real, 'privileges.createUser')) === null) error = true
      for (const e of this.ctx.conn.log) if (e.sql === real) e.sql = q.createUserShow
      let sqlQuery = q.sqlQuery
      const plugin =
        typeof this.post.authentication_plugin === 'string' ? this.post.authentication_plugin : null
      if (plugin !== null && q.passwordSetReal !== '') {
        await this.#try(oldPasswordsQuery(plugin), 'privileges.oldPasswords')
        const ok = (await this.#try(q.passwordSetReal, 'privileges.setPassword')) !== null
        for (const e of this.ctx.conn.log) if (e.sql === q.passwordSetReal) e.sql = q.passwordSetShow
        if (ok) sqlQuery += q.passwordSetShow
      }
      sqlQuery = q.createUserShow + sqlQuery
      // addUserAndCreateDatabase
      let createDb = [this.post['createdb-1'], this.post['createdb-2'], this.post['createdb-3']].map(isset)
      let message: PrivMessage
      let reload = false
      if (
        error ||
        (q.realSqlQuery !== '' && (await this.#try(q.realSqlQuery, 'privileges.grant')) === null)
      ) {
        createDb = [false, false, false]
        message = { type: 'error', text: this.ctx.dbi.lastError }
      } else if (
        q.alterRealSqlQuery !== '' &&
        (await this.#try(q.alterRealSqlQuery, 'privileges.alterUser')) === null
      ) {
        createDb = [false, false, false]
        message = { type: 'error', text: this.ctx.dbi.lastError }
      } else {
        sqlQuery += q.alterSqlQuery
        message = this.#msg('success', 'You have added a new user.')
      }
      const dbq = createUserDatabaseQueries(user, host, dbname, {
        sameName: createDb[0] === true,
        wildcard: createDb[1] === true,
        database: createDb[2] === true,
      })
      const run = async (sql: string) => {
        sqlQuery += sql
        if ((await this.#try(sql, 'privileges.userDatabase')) === null)
          message = { type: 'error', text: this.ctx.dbi.lastError }
      }
      if (dbq.createDatabase !== null) {
        await run(dbq.createDatabase)
        reload = true
      }
      for (const g of dbq.grants) await run(g)
      if (!empty(this.post.userGroup) && isMenuwork)
        await this.setUserGroup(this.username ?? '', str(this.post.userGroup))
      return { message, queries: [] as string[], display: null, sql: sqlQuery, error, reload }
    }
    // Copy the user group while copying a user
    await this.setUserGroup(str(this.post.username), str(this.post.old_usergroup))
    const queries = [q.createUserReal, q.realSqlQuery]
    const plugin =
      typeof this.post.authentication_plugin === 'string' ? this.post.authentication_plugin : null
    if (plugin !== null && q.passwordSetReal !== '') {
      await this.#try(oldPasswordsQuery(plugin), 'privileges.oldPasswords')
      queries.push(q.passwordSetReal)
    }
    const n = queries.length
    const display: Record<number, string> = { [n - 2]: q.createUserShow }
    if (q.passwordSetReal !== '') {
      display[n - 3] = q.createUserShow
      display[n - 2] = q.sqlQuery
      display[n - 1] = q.passwordSetShow
    } else {
      display[n - 1] = q.sqlQuery
    }
    return { message: null, queries, display, sql: q.sqlQuery, error: false, reload: false }
  }

  /** pma: Privileges::getDbSpecificPrivsQueriesForChangeOrCopyUser (+ getTablePrivsQueriesForChangeOrCopyUser) */
  async copyGrantQueries(
    queries: string[],
    user: string,
    host: string,
    oldUser: string,
    oldHost: string,
  ): Promise<string[]> {
    const cond = userHostCondition(oldUser, oldHost)
    const out = [...queries]
    const dbRows = await this.#query(`SELECT * FROM \`mysql\`.\`db\`${cond};`, 'privileges.copyDb')
    for (const row of dbRows.rows)
      out.push(copyDbGrantQuery(row, await this.extractPrivInfo(row), user, host))
    const tableRows = await this.#query(
      `SELECT \`Db\`, \`Table_name\`, \`Table_priv\` FROM \`mysql\`.\`tables_priv\`${cond};`,
      'privileges.copyTables',
    )
    for (const row of tableRows.rows) {
      const cols = await this.#query(
        `SELECT \`Column_name\`, \`Column_priv\` FROM \`mysql\`.\`columns_priv\`${cond} AND \`Db\` = ${quoteString(row.Db ?? '')} AND \`Table_name\` = ${quoteString(row.Table_name ?? '')};`,
        'privileges.copyColumns',
      )
      const privs = await this.extractPrivInfo(row)
      out.push(
        copyTableGrantQuery(
          row,
          privs,
          cols.rows.map((c) => ({ Column_name: c.Column_name ?? '', Column_priv: c.Column_priv ?? '' })),
          user,
          host,
        ),
      )
    }
    return out
  }

  /** pma: Privileges::getDataForDeleteUsers */
  async dataForDeleteUsers(
    queries0: string[],
    isChangeCopy: boolean,
  ): Promise<{ queries: string[]; reload: boolean }> {
    let queries = queries0
    let selected: readonly string[] | string | undefined
    if (isChangeCopy) selected = [`${str(this.post.old_username)}&amp;#27;${str(this.post.old_hostname)}`]
    else {
      selected = this.post.selected_usr
      queries = []
    }
    if (!Array.isArray(selected)) return { queries: [], reload: false }
    let reload = false
    for (const each of selected as string[]) {
      const [user = '', host = ''] = each.split('&amp;#27;')
      queries.push(`# ${sprintf(this.#t('Deleting %s'), `'${user}'@'${host}'`)} ...`)
      queries.push(dropUserQuery(user, host))
      if (this.storage !== null) await cleanupUserStorage(this.storage.conn, this.storage.rp, user)
      if (!isset(this.post.drop_users_db)) continue
      queries.push(dropDatabaseIfExistsQuery(user))
      reload = true
    }
    return { queries, reload }
  }

  /** pma: Privileges::deleteUser */
  async deleteUser(queries0: string[]): Promise<{ message: PrivMessage; sql: string }> {
    if (queries0.length === 0)
      return { message: this.#msg('error', 'No users selected for deleting!'), sql: '' }
    const queries = [...queries0]
    if (looseEq(this.post.mode, 3)) {
      queries.push(`# ${this.#t('Reloading the privileges')} …`)
      queries.push('FLUSH PRIVILEGES;')
    }
    let errors = ''
    for (const sql of queries) {
      if (sql.startsWith('#')) continue
      if ((await this.#try(sql, 'privileges.delete')) !== null) continue
      errors += `${this.ctx.dbi.lastError}\n`
    }
    return {
      message:
        errors !== ''
          ? { type: 'error', text: errors }
          : this.#msg('success', 'The selected users have been deleted successfully.'),
      sql: queries.join('\n'),
    }
  }

  /** pma: Privileges::getDataForQueries — runs the queued copy-user queries, the masked ones shown. */
  async runQueries(queries: string[], display: Record<number, string> | null): Promise<string[]> {
    const out = [...queries]
    for (let i = 0; i < queries.length; i++) {
      const sql = queries[i] as string
      if (!sql.startsWith('#')) {
        try {
          await this.#query(sql, 'privileges.copy')
        } finally {
          const shown = display?.[i]
          if (shown !== undefined) for (const e of this.ctx.conn.log) if (e.sql === sql) e.sql = shown
        }
      }
      const shown = display?.[i]
      if (shown !== undefined) out[i] = shown
    }
    return out
  }

  /** pma: Privileges::updateMessageForReload */
  async updateMessageForReload(): Promise<PrivMessage | null> {
    let message: PrivMessage | null = null
    if (isset(this.get.flush_privileges)) {
      await this.#try('FLUSH PRIVILEGES;', 'privileges.flush')
      message = this.#msg('success', 'The privileges were reloaded successfully.')
    }
    if (isset(this.get.validate_username))
      return this.#msg('success', 'Your SQL query has been executed successfully.')
    return message
  }

  /** getExtraDataForAjaxBehavior: the user-group count (control link) and the username check. */
  async ajaxExtraData(): Promise<{ userExists?: boolean }> {
    await this.userGroupCount()
    if (isset(this.get.validate_username)) {
      const res = await this.#query(
        `SELECT * FROM \`mysql\`.\`user\` WHERE \`User\` = ${quoteString(str(this.get.username))};`,
        'privileges.validateUsername',
      )
      return { userExists: res.rows.length > 0 }
    }
    return {}
  }
}

/** PHP `trim()` (spaces, \t, \n, \r, NUL, \v) */
function phpTrim(s: string): string {
  const ws = new Set([' ', '\t', '\n', '\r', String.fromCharCode(0), String.fromCharCode(11)])
  let a = 0
  let b = s.length
  while (a < b && ws.has(s[a] as string)) a++
  while (b > a && ws.has(s[b - 1] as string)) b--
  return s.slice(a, b)
}

/** PHP `empty()` of a posted value */
function empty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || v === '0' || (Array.isArray(v) && v.length === 0)
}

function isNumeric(s: string): boolean {
  return /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(s)
}

/** PHP 8 `$a != $b` for two posted strings */
function looseNotEqual(a: string, b: string): boolean {
  if (isNumeric(a) && isNumeric(b)) return Number(a) !== Number(b)
  return a !== b
}

/** PHP 8 `$posted == $n` */
function looseEq(v: unknown, n: number): boolean {
  return typeof v === 'string' && isNumeric(v) && Number(v) === n
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c] as string,
  )
}

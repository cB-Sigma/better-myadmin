import { quoteString } from '@bettermyadmin/sql-gen'
import type { ServerConfig } from '../config.ts'
import type { Conn } from '../db/connection.ts'

/**
 * The privilege probes phpMyAdmin runs to decide which tabs to show, with its exact SQL and its
 * SessionCache semantics (the cache object lives in the session, per server, and is dropped on
 * login like Util::clearUserCache).
 * pma: src/Dbal/DatabaseInterface.php::isSuperUser/isGrantUser/isCreateUser/getCurrentUser/
 *      getCurrentRoles, src/Query/Generator.php, src/Util.php::currentUserHasPrivilege
 */
export class PrivilegeProbe {
  readonly #conn: Conn
  readonly #server: ServerConfig
  readonly #cache: Record<string, unknown>
  #userAndHost: [string, string] | null = null
  #rolesAndHost: Array<[string, string]> | null = null

  constructor(conn: Conn, server: ServerConfig, cache: Record<string, unknown>) {
    this.#conn = conn
    this.#server = server
    this.#cache = cache
  }

  /** DatabaseInterface::fetchValue — first column (or `col`) of the first row, false on error / no row. */
  async #fetchValue(sql: string, label: string, col = 0): Promise<string | false | null> {
    try {
      const r = await this.#conn.query(sql, label)
      const row = r.resultSets[0]?.rows[0]
      if (row === undefined) return false
      const v = row[col]
      return v === null || v === undefined ? null : v.toString('utf8')
    } catch {
      return false
    }
  }

  async #fetchColumn(sql: string, label: string): Promise<string[]> {
    try {
      const r = await this.#conn.query(sql, label)
      return (r.resultSets[0]?.rows ?? []).map((row) => row[0]?.toString('utf8') ?? '')
    } catch {
      return []
    }
  }

  /** `SELECT CURRENT_USER();`, cached as mysql_cur_user; '@' when it cannot be read. */
  async currentUser(): Promise<string> {
    const cached = this.#cache.mysql_cur_user
    if (typeof cached === 'string') return cached
    const user = await this.#fetchValue('SELECT CURRENT_USER();', 'priv.currentUser')
    if (typeof user === 'string') {
      this.#cache.mysql_cur_user = user
      return user
    }
    return '@'
  }

  /**
   * getCurrentUserAndHost: CURRENT_USER() split at its last '@' (parity exception X55). phpMyAdmin
   * explodes at every '@', so a user named by an email ('a@b.com'@'%') was read as 'a'@'b.com' and
   * lost every privilege-dependent tab (Triggers, Events, …); a host never contains '@'.
   */
  async currentUserAndHost(): Promise<[string, string]> {
    if (this.#userAndHost === null) this.#userAndHost = splitUserHost(await this.currentUser())
    return this.#userAndHost
  }

  /** getCurrentRoles: MySQL 8.0+ / MariaDB 10.5+; 'NONE' and failures give no roles and are not cached. */
  async currentRoles(versionInt: number, isMariaDb: boolean): Promise<string[]> {
    if ((isMariaDb && versionInt < 100500) || versionInt < 80000) return []
    const cached = this.#cache.mysql_cur_role
    if (Array.isArray(cached)) return cached as string[]
    const role = await this.#fetchValue('SELECT CURRENT_ROLE();', 'priv.currentRole')
    if (role === false || role === null || role === 'NONE') return []
    const roles = role
      .replaceAll('`', '')
      .split(',')
      .map((r) => r.trim())
    this.#cache.mysql_cur_role = roles
    return roles
  }

  async #currentRolesAndHost(versionInt: number, isMariaDb: boolean): Promise<Array<[string, string]>> {
    if (this.#rolesAndHost === null) {
      this.#rolesAndHost = (await this.currentRoles(versionInt, isMariaDb)).map((r) => {
        if (!r.includes('@')) return [r, '']
        return splitUserHost(r)
      })
    }
    return this.#rolesAndHost
  }

  /** `SELECT 1 FROM mysql.user LIMIT 1` */
  async isSuperUser(): Promise<boolean> {
    if (typeof this.#cache.is_superuser === 'boolean') return this.#cache.is_superuser
    const v = Boolean(phpBool(await this.#fetchValue('SELECT 1 FROM mysql.user LIMIT 1', 'priv.superuser')))
    this.#cache.is_superuser = v
    return v
  }

  async #grants(): Promise<string[]> {
    return this.#fetchColumn('SHOW GRANTS FOR CURRENT_USER();', 'priv.grants')
  }

  /** `SHOW SESSION VARIABLES LIKE 'collation_connection';` (getVariable, second column) */
  async #collation(): Promise<string> {
    const v = await this.#fetchValue(
      "SHOW SESSION VARIABLES LIKE 'collation_connection';",
      'priv.collation',
      1,
    )
    return typeof v === 'string' ? v : ''
  }

  async isGrantUser(versionInt: number, isMariaDb: boolean): Promise<boolean> {
    if (typeof this.#cache.is_grantuser === 'boolean') return this.#cache.is_grantuser
    let has = false
    if (this.#server.DisableIS) {
      has = (await this.#grants()).some((g) => g.includes('WITH GRANT OPTION'))
      this.#cache.is_grantuser = has
      return has
    }
    const collation = await this.#collation()
    const [user, host] = await this.currentUserAndHost()
    has = phpBool(await this.#fetchValue(granteeRequest(user, host, collation), 'priv.grant'))
    if (!has) {
      for (const [role, roleHost] of await this.#currentRolesAndHost(versionInt, isMariaDb)) {
        has = phpBool(await this.#fetchValue(granteeRequest(role, roleHost, collation), 'priv.grant'))
        if (has) break
      }
    }
    this.#cache.is_grantuser = has
    return has
  }

  async isCreateUser(versionInt: number, isMariaDb: boolean): Promise<boolean> {
    if (typeof this.#cache.is_createuser === 'boolean') return this.#cache.is_createuser
    let has = false
    if (this.#server.DisableIS) {
      has = (await this.#grants()).some(
        (g) => g.includes('ALL PRIVILEGES ON *.*') || g.includes('CREATE USER'),
      )
      this.#cache.is_createuser = has
      return has
    }
    const collation = await this.#collation()
    const [user, host] = await this.currentUserAndHost()
    has = phpBool(await this.#fetchValue(createRequest(user, host, collation), 'priv.create'))
    if (!has) {
      for (const [role, roleHost] of await this.#currentRolesAndHost(versionInt, isMariaDb)) {
        has = phpBool(await this.#fetchValue(createRequest(role, roleHost, collation), 'priv.create'))
        if (has) break
      }
    }
    this.#cache.is_createuser = has
    return has
  }

  /** `$isSuperUser || isGrantUser() || isCreateUser()` with PHP's short-circuit (Menu.php). */
  async canManageUsers(
    versionInt: number,
    isMariaDb: boolean,
  ): Promise<{ superUser: boolean; grant: boolean; create: boolean }> {
    const superUser = await this.isSuperUser()
    const grant = await this.isGrantUser(versionInt, isMariaDb)
    const create = grant ? false : await this.isCreateUser(versionInt, isMariaDb)
    return { superUser, grant, create }
  }

  /** `SHOW BINARY LOGS`, cached as binary_logs (an error counts as no logs). */
  async hasBinaryLogs(): Promise<boolean> {
    if (typeof this.#cache.binary_logs === 'boolean') return this.#cache.binary_logs
    const logs = await this.#fetchColumn('SHOW BINARY LOGS', 'priv.binlogs')
    this.#cache.binary_logs = logs.length > 0
    return logs.length > 0
  }

  /**
   * Util::currentUserHasPrivilege: global privilege first, then schema-wise, then table-wise.
   * `--skip-grant-tables` (empty user) has every privilege.
   */
  async hasPrivilege(priv: string, db?: string, table?: string): Promise<boolean> {
    const [user, host] = await this.currentUserAndHost()
    if (user === '') return true
    const username = `''${user.replaceAll("'", "''")}''@''${host.replaceAll("'", "''")}''`
    const base = (t: string) =>
      `SELECT \`PRIVILEGE_TYPE\` FROM \`INFORMATION_SCHEMA\`.\`${t}\` WHERE GRANTEE='${username}' AND PRIVILEGE_TYPE='${priv}'`
    if (phpBool(await this.#fetchValue(base('USER_PRIVILEGES'), 'priv.user'))) return true
    if (db === undefined) return false
    const schema = `${base('SCHEMA_PRIVILEGES')} AND ${quoteString(db)} LIKE \`TABLE_SCHEMA\``
    if (phpBool(await this.#fetchValue(schema, 'priv.schema'))) return true
    if (table !== undefined) {
      const tbl = `${base('TABLE_PRIVILEGES')} AND ${quoteString(db)} LIKE \`TABLE_SCHEMA\` AND TABLE_NAME=${quoteString(table)}`
      if (phpBool(await this.#fetchValue(tbl, 'priv.table'))) return true
    }
    return false
  }
}

/** 'user@host' → [user, host], at the last '@' (a user name may contain '@', a host may not). */
export function splitUserHost(userHost: string): [string, string] {
  const at = userHost.lastIndexOf('@')
  return at === -1 ? [userHost, ''] : [userHost.slice(0, at), userHost.slice(at + 1)]
}

/** PHP `(bool)` of a fetchValue result. */
function phpBool(v: string | false | null): boolean {
  return v !== false && v !== null && v !== '' && v !== '0'
}

/** QueryGenerator::getInformationSchemaDataForGranteeRequest (user and host are not escaped, as in PHP). */
export function granteeRequest(user: string, host: string, collation: string): string {
  return (
    'SELECT 1 FROM (' +
    'SELECT `GRANTEE`, `IS_GRANTABLE` FROM `INFORMATION_SCHEMA`.`COLUMN_PRIVILEGES` UNION ' +
    'SELECT `GRANTEE`, `IS_GRANTABLE` FROM `INFORMATION_SCHEMA`.`TABLE_PRIVILEGES` UNION ' +
    'SELECT `GRANTEE`, `IS_GRANTABLE` FROM `INFORMATION_SCHEMA`.`SCHEMA_PRIVILEGES` UNION ' +
    'SELECT `GRANTEE`, `IS_GRANTABLE` FROM `INFORMATION_SCHEMA`.`USER_PRIVILEGES`) t ' +
    `WHERE \`IS_GRANTABLE\` = 'YES' AND '''${user}''@''${host}''' LIKE \`GRANTEE\`  UNION ` +
    `SELECT 1 FROM mysql.user WHERE \`create_user_priv\` = 'Y' COLLATE ${collation} AND '${user}' LIKE \`User\` AND '' LIKE \`Host\` LIMIT 1`
  )
}

/** QueryGenerator::getInformationSchemaDataForCreateRequest */
export function createRequest(user: string, host: string, collation: string): string {
  return (
    "SELECT 1 FROM `INFORMATION_SCHEMA`.`USER_PRIVILEGES` WHERE `PRIVILEGE_TYPE` = 'CREATE USER' AND " +
    `'''${user}''@''${host}''' LIKE \`GRANTEE\` UNION ` +
    `SELECT 1 FROM mysql.user WHERE \`create_user_priv\` = 'Y' COLLATE ${collation} AND '${user}' LIKE \`User\` AND '' LIKE \`Host\` LIMIT 1`
  )
}

/** Utilities::isSystemSchema($name) — `mysql` only counts with $testForMysqlSchema, which Menu does not pass. */
export function isSystemSchema(name: string, testForMysqlSchema = false): boolean {
  const n = name.toLowerCase()
  return (
    n === 'information_schema' ||
    n === 'performance_schema' ||
    (n === 'mysql' && testForMysqlSchema) ||
    n === 'sys'
  )
}

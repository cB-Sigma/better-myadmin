/**
 * Statements of Server → User accounts: account names, wildcard escaping, the privilege lists
 * (`extractPrivInfo`), REQUIRE / WITH clauses, CREATE USER (every server flavour), GRANT / REVOKE,
 * ALTER USER and the copy-user grants. Pure functions: the posted form is passed in (phpMyAdmin
 * reads `$_POST`), as are the facts phpMyAdmin queries on the way (hashed password, password-check
 * plugin, available table grants).
 *
 * pma: src/Server/Privileges.php
 */

import { N_ } from '@bettermyadmin/i18n'
import { backquote, escapeMysqlWildcards, quoteString } from './quote.ts'

/** The posted form, PHP-style: `name[]` fields are arrays, a missing key is `isset() === false`. */
export type PrivForm = Readonly<Record<string, string | readonly string[] | undefined>>

/** A row of mysql.user / mysql.db / tables_priv (null = SQL NULL, missing = no such column). */
export type PrivRow = Record<string, string | null | undefined>

export interface Flavour {
  versionInt: number
  isMariaDb: boolean
}

const isMySql = (f: Flavour) => !f.isMariaDb

/** `'user'@'host'` with both parts quoted like DatabaseInterface::quoteString. */
export function accountName(user: string, host: string): string {
  return `${quoteString(user)}@${quoteString(host)}`
}

/** pma: Privileges::escapeGrantWildcards — `_` → `\_`, `%` → `\%` (backslashes untouched). */
export function escapeGrantWildcards(name: string): string {
  return name.replace(/[_%]/g, (c) => `\\${c}`)
}

/** pma: Privileges::unescapeGrantWildcards — `\_` → `_`, `\%` → `%`. */
export function unescapeGrantWildcards(name: string): string {
  return name.replace(/\\([_%])/g, '$1')
}

/** pma: Privileges::isDatabaseNameWildcard — an unescaped `_` or `%`. */
export function isDatabaseNameWildcard(db: unknown): boolean {
  return typeof db === 'string' && /(?<!\\)(?:_|%)/.test(db)
}

/**
 * The `db.table` part of GRANT / REVOKE: `*.*`, `` `db`.* `` (wildcards kept), or
 * `` `db`.`table` `` (wildcards unescaped: they are not accepted at table level).
 * pma: Privileges::wildcardEscapeForGrant
 */
export function wildcardEscapeForGrant(db: string, table: string): string {
  if (db === '') return '*.*'
  if (table === '') return `${backquote(db)}.*`
  return `${backquote(unescapeGrantWildcards(db))}.${backquote(table)}`
}

/**
 * The user-name condition of the overview (`?initial=`): none, `WHERE User = ''` for the empty
 * initial, else both case variants with LIKE (the column may be BINARY).
 * pma: Privileges::rangeOfUsers
 */
export function rangeOfUsers(initial: string | null): string {
  if (initial === null) return ''
  if (initial === '') return "WHERE `User` = ''"
  const like = `${escapeMysqlWildcards(initial)}%`
  return `WHERE \`User\` LIKE ${quoteString(like)} OR \`User\` LIKE ${quoteString(like.toLowerCase())}`
}

/** pma: Privileges::getUserHostCondition */
export function userHostCondition(user: string, host: string): string {
  return ` WHERE \`User\` = ${quoteString(user)} AND \`Host\` = ${quoteString(host)}`
}

/** [column/key, SQL privilege, description msgid] — pma: Privileges::getGrantsArray */
export const GRANTS: ReadonlyArray<readonly [string, string, string]> = [
  ['Select_priv', 'SELECT', N_('Allows reading data.')],
  ['Insert_priv', 'INSERT', N_('Allows inserting and replacing data.')],
  ['Update_priv', 'UPDATE', N_('Allows changing data.')],
  ['Delete_priv', 'DELETE', N_('Allows deleting data.')],
  ['Create_priv', 'CREATE', N_('Allows creating new databases and tables.')],
  ['Drop_priv', 'DROP', N_('Allows dropping databases and tables.')],
  ['Reload_priv', 'RELOAD', N_("Allows reloading server settings and flushing the server's caches.")],
  ['Shutdown_priv', 'SHUTDOWN', N_('Allows shutting down the server.')],
  ['Process_priv', 'PROCESS', N_('Allows viewing processes of all users.')],
  ['File_priv', 'FILE', N_('Allows importing data from and exporting data into files.')],
  ['References_priv', 'REFERENCES', N_('Has no effect in this MySQL version.')],
  ['Index_priv', 'INDEX', N_('Allows creating and dropping indexes.')],
  ['Alter_priv', 'ALTER', N_('Allows altering the structure of existing tables.')],
  ['Show_db_priv', 'SHOW DATABASES', N_('Gives access to the complete list of databases.')],
  [
    'Super_priv',
    'SUPER',
    N_(
      'Allows connecting, even if maximum number of connections is reached; required for most administrative operations like setting global variables or killing threads of other users.',
    ),
  ],
  ['Create_tmp_table_priv', 'CREATE TEMPORARY TABLES', N_('Allows creating temporary tables.')],
  ['Lock_tables_priv', 'LOCK TABLES', N_('Allows locking tables for the current thread.')],
  ['Repl_slave_priv', 'REPLICATION SLAVE', N_('Needed for the replication replicas.')],
  [
    'Repl_client_priv',
    'REPLICATION CLIENT',
    N_('Allows the user to ask where the replicas / primaries are.'),
  ],
  ['Create_view_priv', 'CREATE VIEW', N_('Allows creating new views.')],
  ['Event_priv', 'EVENT', N_('Allows to set up events for the event scheduler.')],
  ['Trigger_priv', 'TRIGGER', N_('Allows creating and dropping triggers.')],
  // for table privs:
  ['Create View_priv', 'CREATE VIEW', N_('Allows creating new views.')],
  ['Show_view_priv', 'SHOW VIEW', N_('Allows performing SHOW CREATE VIEW queries.')],
  // for table privs:
  ['Show view_priv', 'SHOW VIEW', N_('Allows performing SHOW CREATE VIEW queries.')],
  ['Delete_history_priv', 'DELETE HISTORY', N_('Allows deleting historical rows.')],
  ['Delete versioning rows_priv', 'DELETE HISTORY', N_('Allows deleting historical rows.')],
  ['Create_routine_priv', 'CREATE ROUTINE', N_('Allows creating stored routines.')],
  ['Alter_routine_priv', 'ALTER ROUTINE', N_('Allows altering and dropping stored routines.')],
  ['Create_user_priv', 'CREATE USER', N_('Allows creating, dropping and renaming user accounts.')],
  ['Execute_priv', 'EXECUTE', N_('Allows executing stored routines.')],
]

/** pma: Privileges::getTableGrantsArray (keyed by the `Table_priv` SET member) */
export const TABLE_GRANTS: ReadonlyArray<readonly [string, string, string]> = [
  ['Delete', 'DELETE', N_('Allows deleting data.')],
  ['Create', 'CREATE', N_('Allows creating new tables.')],
  ['Drop', 'DROP', N_('Allows dropping tables.')],
  ['Index', 'INDEX', N_('Allows creating and dropping indexes.')],
  ['Alter', 'ALTER', N_('Allows altering the structure of existing tables.')],
  ['Create View', 'CREATE_VIEW', N_('Allows creating new views.')],
  ['Show view', 'SHOW_VIEW', N_('Allows performing SHOW CREATE VIEW queries.')],
  ['Trigger', 'TRIGGER', N_('Allows creating and dropping triggers.')],
]

/** One entry of extractPrivInfo: the privilege, its description msgid, the backquoted column list. */
export interface PrivItem {
  name: string
  /** msgid of the `<dfn title>` (translated by the caller) */
  title: string
  /** `` `a`, `b` `` when granted on some columns only */
  columns: string | null
}

export const USAGE_TITLE = N_('No privileges.')
export const ALL_PRIVILEGES_TITLE = N_('Includes all privileges except GRANT.')

/**
 * The SET members of `mysql.tables_priv.Table_priv` from `SHOW COLUMNS … LIKE 'Table_priv'`'s Type,
 * e.g. `set('Select','Insert',…)` → `['Select', 'Insert', …]`.
 * pma: Privileges::fillInTablePrivileges (the mb_substr/explode part)
 */
export function tablePrivSetMembers(type: string): string[] {
  const open = type.indexOf('(')
  const close = type.indexOf(')')
  return type.slice(open + 2, open + 2 + (close - open - 3)).split("','")
}

/**
 * Expands `Table_priv` into one `<Member>_priv` Y/N entry per available grant and drops it.
 * pma: Privileges::fillInTablePrivileges
 */
export function fillInTablePrivileges(row: PrivRow, available: readonly string[]): PrivRow {
  const granted = (row.Table_priv ?? '').split(',')
  const out: PrivRow = { ...row }
  for (const g of available) out[`${g}_priv`] = granted.includes(g) ? 'Y' : 'N'
  delete out.Table_priv
  return out
}

const isset = (v: unknown) => v !== undefined && v !== null
/** PHP `empty()` for a posted value */
const empty = (v: unknown) =>
  v === undefined || v === null || v === '' || v === '0' || (Array.isArray(v) && v.length === 0)
/** PHP `(int)` of a posted value */
export function phpInt(v: unknown): number {
  if (typeof v !== 'string') return Array.isArray(v) ? (v.length > 0 ? 1 : 0) : 0
  const m = /^[ \t\n\r\v\f]*([+-]?\d+)/.exec(v)
  if (m === null) return 0
  const n = Number.parseInt(m[1] as string, 10)
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  if (n < Number.MIN_SAFE_INTEGER) return Number.MIN_SAFE_INTEGER
  return n
}

/**
 * The privileges of a row (`row` given) or of the posted form (`row === null`): `USAGE` when none,
 * `ALL PRIVILEGES` when every listed grant is set (and the form's `grant_count` agrees), column
 * lists for the posted `*_priv[]` arrays. `row` must already have `Table_priv` expanded
 * ({@link fillInTablePrivileges}). `request` is `$_REQUEST` (for `column_count`).
 * pma: Privileges::extractPrivInfo
 */
export function extractPrivInfo(
  row: PrivRow | null,
  post: PrivForm,
  tablePrivs = false,
  request: PrivForm = post,
): PrivItem[] {
  const grants = tablePrivs ? TABLE_GRANTS : GRANTS
  const privs: PrivItem[] = []
  let all = true
  for (const [key, name, title] of grants) {
    let value: string | readonly string[]
    if (row !== null && isset(row[key])) value = row[key] as string
    else if (row === null && isset(post[key])) value = post[key] as string | readonly string[]
    else continue
    if (
      value === 'Y' ||
      (row === null &&
        Array.isArray(value) &&
        value.length === phpInt(request.column_count) &&
        empty(post[`${key}_none`]))
    ) {
      privs.push({ name, title, columns: null })
    } else if (Array.isArray(value) && value.length > 0 && empty(post[`${key}_none`])) {
      // Required for proper escaping of ` (backtick) in a column name
      privs.push({ name, title, columns: (value as string[]).map((c) => backquote(c)).join(', ') })
    } else {
      all = false
    }
  }
  if (privs.length === 0) return [{ name: 'USAGE', title: USAGE_TITLE, columns: null }]
  if (all && (!isset(post.grant_count) || privs.length === phpInt(post.grant_count))) {
    return [{ name: 'ALL PRIVILEGES', title: ALL_PRIVILEGES_TITLE, columns: null }]
  }
  return privs
}

/** extractPrivInfo without HTML: `SELECT`, `INSERT (`a`, `b`)`, … */
export function privText(items: readonly PrivItem[]): string[] {
  return items.map((p) => (p.columns === null ? p.name : `${p.name} (${p.columns})`))
}

/** pma: Privileges::parseProcPriv — `Proc_priv` SET → Alter_routine_priv / Execute_priv / Grant_priv. */
export function parseProcPriv(privs: string): Record<string, string> {
  const result: Record<string, string> = { Alter_routine_priv: 'N', Execute_priv: 'N', Grant_priv: 'N' }
  for (const p of privs.split(',')) {
    if (p === 'Alter Routine') result.Alter_routine_priv = 'Y'
    else result[`${p}_priv`] = 'Y'
  }
  return result
}

/** The SSL requirement of an account (copied from the old row by "Copy user", else the form). */
export interface SslRequirement {
  sslType: string | null
  sslCipher: string | null
  x509Issuer: string | null
  x509Subject: string | null
}

export const NO_SSL: SslRequirement = { sslType: null, sslCipher: null, x509Issuer: null, x509Subject: null }

const postedString = (v: string | readonly string[] | undefined): string | null | undefined =>
  v === undefined ? undefined : typeof v === 'string' ? v : null

/** pma: Privileges::getRequireClause (`$_POST[...] ?? $this->ssl…`) */
export function requireClause(post: PrivForm, fallback: SslRequirement = NO_SSL): string {
  const sslType = postedString(post.ssl_type) ?? fallback.sslType
  const cipher = postedString(post.ssl_cipher) ?? fallback.sslCipher
  const issuer = postedString(post.x509_issuer) ?? fallback.x509Issuer
  const subject = postedString(post.x509_subject) ?? fallback.x509Subject
  if (sslType === 'SPECIFIED') {
    const require: string[] = []
    if (typeof cipher === 'string' && cipher !== '') require.push(`CIPHER ${quoteString(cipher)}`)
    if (typeof issuer === 'string' && issuer !== '') require.push(`ISSUER ${quoteString(issuer)}`)
    if (typeof subject === 'string' && subject !== '') require.push(`SUBJECT ${quoteString(subject)}`)
    return require.length > 0 ? ` REQUIRE ${require.join(' AND ')}` : ' REQUIRE NONE'
  }
  if (sslType === 'X509') return ' REQUIRE X509'
  if (sslType === 'ANY') return ' REQUIRE SSL'
  return ' REQUIRE NONE'
}

/** MySQL/Percona ≥ 8.0.11: limits, REQUIRE and GRANT OPTION move to ALTER USER / GRANT … WITH GRANT OPTION */
export const needsAlterUser = (f: Flavour) => isMySql(f) && f.versionInt >= 80011

/** pma: Privileges::getWithClauseForAddUserAndUpdatePrivs */
export function withClause(post: PrivForm, f: Flavour): string {
  let sql = ''
  if (post.Grant_priv === 'Y' && !needsAlterUser(f)) sql += ' GRANT OPTION'
  const limit = (key: string, kw: string) => {
    if (isset(post[key])) sql += ` ${kw} ${Math.max(0, phpInt(post[key]))}`
  }
  limit('max_questions', 'MAX_QUERIES_PER_HOUR')
  limit('max_connections', 'MAX_CONNECTIONS_PER_HOUR')
  limit('max_updates', 'MAX_UPDATES_PER_HOUR')
  limit('max_user_connections', 'MAX_USER_CONNECTIONS')
  return sql !== '' ? ` WITH${sql}` : ''
}

/** `REVOKE ALL PRIVILEGES ON [PROCEDURE|FUNCTION] target FROM 'u'@'h';` */
export function revokeAllQuery(itemType: string, dbAndTable: string, user: string, host: string): string {
  return `REVOKE ALL PRIVILEGES ON ${itemType} ${dbAndTable} FROM ${accountName(user, host)};`
}

/** `REVOKE GRANT OPTION ON [type] target FROM 'u'@'h';` */
export function revokeGrantOptionQuery(
  itemType: string,
  dbAndTable: string,
  user: string,
  host: string,
): string {
  return `REVOKE GRANT OPTION ON ${itemType} ${dbAndTable} FROM ${accountName(user, host)};`
}

/** The suffix of exception X40 (see updatePrivilegesQueries). */
export const grantOptionFix = ' WITH GRANT OPTION'

/**
 * The GRANT (+ ALTER USER on MySQL ≥ 8.0.11) of "Update user privileges"; `dbname === ''` is the
 * global level (REQUIRE clause, resource limits).
 * pma: Privileges::generateQueriesForUpdatePrivileges
 *
 * Exception X40 (docs/reference/parity-exceptions.md): on MySQL/Percona ≥ 8.0.11 phpMyAdmin moves
 * the WITH clause to ALTER USER, which drops GRANT OPTION, and never adds `WITH GRANT OPTION` to the
 * GRANT (phpmyadmin/phpmyadmin#19605): the requested grant option is silently lost, at every level
 * (global, database, table, routine). With Grant_priv=Y we end the GRANT with ` WITH GRANT OPTION`
 * (as the add-user path does); the ALTER USER stays byte-identical to phpMyAdmin's. MariaDB and
 * MySQL < 8.0.11 are unchanged.
 */
export function updatePrivilegesQueries(
  post: PrivForm,
  f: Flavour,
  privs: readonly PrivItem[],
  itemType: string,
  dbAndTable: string,
  user: string,
  host: string,
  dbname: string,
): { grant: string; alter: string | null } {
  let grant = `GRANT ${privText(privs).join(', ')} ON ${itemType} ${dbAndTable} TO ${accountName(user, host)}`
  const alterNeeded = needsAlterUser(f)
  let alter: string | null = alterNeeded ? `ALTER USER ${accountName(user, host)} ` : null
  if (dbname === '') {
    if (alter !== null) alter += requireClause(post)
    else grant += requireClause(post)
  }
  const limits =
    isset(post.max_questions) ||
    isset(post.max_connections) ||
    isset(post.max_updates) ||
    isset(post.max_user_connections)
  if (post.Grant_priv === 'Y' || (dbname === '' && limits)) {
    if (alter !== null) alter += withClause(post, f)
    else grant += withClause(post, f)
  }
  if (alter !== null && post.Grant_priv === 'Y') grant += grantOptionFix
  grant += ';'
  if (alter !== null) alter += ';'
  return { grant, alter }
}

/** The statements of "Add user account" (real and with the password masked). */
export interface AddUserQueries {
  createUserReal: string
  createUserShow: string
  realSqlQuery: string
  sqlQuery: string
  passwordSetReal: string
  passwordSetShow: string
  alterRealSqlQuery: string
  alterSqlQuery: string
}

/** Uses `CREATE USER … AS|USING|BY` (MySQL ≥ 5.7.6, MariaDB ≥ 5.2) instead of a separate SET PASSWORD. */
const createWithPassword = (f: Flavour) =>
  (isMySql(f) && f.versionInt >= 50706) || (f.isMariaDb && f.versionInt >= 50200)

/**
 * Whether getSqlQueriesForDisplayAndAddUser hashes the posted password with `SELECT PASSWORD(…)`
 * (MySQL < 8.0.11, MariaDB without a password-check plugin), so the caller can run that query first.
 */
export function addUserNeedsHash(post: PrivForm, f: Flavour, pwdCheckPluginActive: boolean): boolean {
  const pred = post.pred_password
  if (pred === 'keep' || pred === 'none') return false
  if (!createWithPassword(f)) return true
  return !((f.isMariaDb && pwdCheckPluginActive) || (isMySql(f) && f.versionInt >= 80011))
}

const posted = (v: string | readonly string[] | undefined): string => (typeof v === 'string' ? v : '')

/**
 * CREATE USER, the global GRANT, the pre-5.7.6 SET PASSWORD and the 8.0.11+ ALTER USER of "Add user
 * account" / "Copy user". `password` is the copied account's stored hash (copy with "Do not change
 * the password"); `hashed` the result of `SELECT PASSWORD(pma_pw)` when {@link addUserNeedsHash}.
 * pma: Privileges::getSqlQueriesForDisplayAndAddUser
 */
export function addUserQueries(opts: {
  user: string
  host: string
  password: string
  post: PrivForm
  flavour: Flavour
  pwdCheckPluginActive: boolean
  isGrantUser: boolean
  privs: readonly PrivItem[]
  hashed: string | null
  ssl?: SslRequirement
}): AddUserQueries {
  const { user, host, post, flavour: f, pwdCheckPluginActive: pwdActive } = opts
  const slashedUser = quoteString(user)
  const slashedHost = quoteString(host)
  const slashedPassword = quoteString(opts.password)
  const plugin = typeof post.authentication_plugin === 'string' ? post.authentication_plugin : undefined
  let stmt = `CREATE USER ${slashedUser}@${slashedHost}`
  if (isMySql(f) && f.versionInt >= 50507 && plugin !== undefined) stmt += ` IDENTIFIED WITH ${plugin}`
  if (f.isMariaDb && f.versionInt >= 50200 && plugin !== undefined && !pwdActive) {
    stmt += ` IDENTIFIED VIA ${plugin}`
  }
  let createUserReal = stmt
  let createUserShow = stmt
  const setPassword = (value: string) => `SET PASSWORD FOR ${slashedUser}@${slashedHost} = ${value}`
  let passwordSetShow = setPassword("'***'")
  const grantStmt = `GRANT ${privText(opts.privs).join(', ')} ON *.* TO ${slashedUser}@${slashedHost}`
  let realSqlQuery = grantStmt
  let sqlQuery = grantStmt
  const pred = post.pred_password
  const hashedOrPlain = () => (opts.hashed !== null ? opts.hashed : posted(post.pma_pw))
  let passwordSetReal = ''
  if (createWithPassword(f)) {
    let suffix: string
    if (f.isMariaDb && !pwdActive && plugin !== undefined) suffix = ' USING '
    else if (f.isMariaDb) suffix = ' IDENTIFIED BY '
    else if (f.versionInt >= 80011) suffix = stmt.includes('IDENTIFIED') ? ' BY ' : ' IDENTIFIED BY '
    else suffix = ' AS '
    if (pred === 'keep') createUserReal = stmt + suffix + slashedPassword
    else if (pred === 'none') createUserReal = `${stmt}${suffix}''`
    else createUserReal = stmt + suffix + quoteString(hashedOrPlain())
    createUserShow = `${stmt}${suffix}'***'`
  } else if (pred === 'keep') {
    passwordSetReal = setPassword(slashedPassword)
  } else if (pred === 'none') {
    passwordSetReal = setPassword("''")
  } else {
    passwordSetReal = setPassword(quoteString(hashedOrPlain()))
  }
  let alterRealSqlQuery = ''
  let alterSqlQuery = ''
  if (needsAlterUser(f)) {
    const grantOption = post.Grant_priv === 'Y' ? ' WITH GRANT OPTION' : ''
    realSqlQuery += grantOption
    sqlQuery += grantOption
    alterRealSqlQuery = `ALTER USER ${slashedUser}@${slashedHost}`
    alterSqlQuery = alterRealSqlQuery
  }
  const require = requireClause(post, opts.ssl)
  const withPart = withClause(post, f)
  if (needsAlterUser(f)) {
    alterRealSqlQuery += require + withPart
    alterSqlQuery += require + withPart
  } else {
    realSqlQuery += require + withPart
    sqlQuery += require + withPart
  }
  if (alterRealSqlQuery !== '') {
    alterRealSqlQuery += ';'
    alterSqlQuery += ';'
  }
  createUserReal += ';'
  createUserShow += ';'
  realSqlQuery += ';'
  sqlQuery += ';'
  if (!opts.isGrantUser) {
    realSqlQuery = ''
    sqlQuery = ''
  }
  if (createWithPassword(f)) {
    passwordSetReal = ''
    passwordSetShow = ''
  } else {
    if (passwordSetReal !== '') passwordSetReal += ';'
    passwordSetShow += ';'
  }
  return {
    createUserReal,
    createUserShow,
    realSqlQuery,
    sqlQuery,
    passwordSetReal,
    passwordSetShow,
    alterRealSqlQuery,
    alterSqlQuery,
  }
}

/** pma: Privileges::setProperPasswordHashing */
export function oldPasswordsQuery(plugin: string): string {
  if (plugin === 'sha256_password') return 'SET `old_passwords` = 2;'
  if (plugin === 'mysql_old_password') return 'SET `old_passwords` = 1;'
  return 'SET `old_passwords` = 0;'
}

/** "Database for user account": createdb-1, createdb-2, createdb-3. pma: Privileges::addUserAndCreateDatabase */
export function createUserDatabaseQueries(
  user: string,
  host: string,
  dbname: string,
  opts: { sameName: boolean; wildcard: boolean; database: boolean },
): { createDatabase: string | null; grants: string[] } {
  const to = accountName(user, host)
  const grants: string[] = []
  let createDatabase: string | null = null
  if (opts.sameName) {
    createDatabase = `CREATE DATABASE IF NOT EXISTS ${backquote(user)};`
    grants.push(`GRANT ALL PRIVILEGES ON ${backquote(escapeGrantWildcards(user))}.* TO ${to};`)
  }
  if (opts.wildcard)
    grants.push(`GRANT ALL PRIVILEGES ON ${backquote(`${escapeGrantWildcards(user)}\\_%`)}.* TO ${to};`)
  if (opts.database) grants.push(`GRANT ALL PRIVILEGES ON ${backquote(dbname)}.* TO ${to};`)
  return { createDatabase, grants }
}

/** `DROP USER 'u'@'h';` */
export function dropUserQuery(user: string, host: string): string {
  return `DROP USER ${accountName(user, host)};`
}

/** `DROP DATABASE IF EXISTS `u`;` (Remove users: "Drop the databases that have the same names as the users.") */
export function dropDatabaseIfExistsQuery(db: string): string {
  return `DROP DATABASE IF EXISTS ${backquote(db)};`
}

/** pma: AccountLocking::lock / unlock */
export function accountLockQuery(user: string, host: string, lock: boolean): string {
  return `ALTER USER ${accountName(user, host)} ACCOUNT ${lock ? 'LOCK' : 'UNLOCK'};`
}

/** `SHOW GRANTS FOR 'u'@'h'` (export) */
export function showGrantsQuery(user: string, host: string): string {
  return `SHOW GRANTS FOR ${accountName(user, host)}`
}

/** "Copy user": the database-level GRANT of a mysql.db row. pma: getDbSpecificPrivsQueriesForChangeOrCopyUser */
export function copyDbGrantQuery(
  row: PrivRow,
  privs: readonly PrivItem[],
  user: string,
  host: string,
): string {
  return `GRANT ${privText(privs).join(', ')} ON ${backquote(row.Db ?? '')}.* TO ${accountName(user, host)}${row.Grant_priv === 'Y' ? ' WITH GRANT OPTION;' : ';'}`
}

/**
 * "Copy user": the table-level GRANT of a tables_priv row plus its columns_priv column lists
 * (`SELECT (`a`, `b`)` unless the table-level privilege already covers it).
 * pma: Privileges::getTablePrivsQueriesForChangeOrCopyUser
 */
export function copyTableGrantQuery(
  row: PrivRow,
  privs: readonly PrivItem[],
  columns: ReadonlyArray<{ Column_name: string; Column_priv: string }>,
  user: string,
  host: string,
): string {
  const list = privText(privs)
  const byPriv: Record<string, string[]> = { Select: [], Insert: [], Update: [], References: [] }
  for (const c of columns) {
    const set = c.Column_priv.split(',')
    for (const p of ['Select', 'Insert', 'Update', 'References'])
      if (set.includes(p)) byPriv[p]?.push(c.Column_name)
  }
  for (const p of ['Select', 'Insert', 'Update', 'References']) {
    const cols = byPriv[p] as string[]
    const upper = p.toUpperCase()
    if (cols.length > 0 && !list.includes(upper)) list.push(`${upper} (\`${cols.join('`, `')}\`)`)
  }
  const grant = (row.Table_priv ?? '').split(',').includes('Grant')
  return `GRANT ${list.join(', ')} ON ${backquote(row.Db ?? '')}.${backquote(row.Table_name ?? '')} TO ${accountName(user, host)}${grant ? ' WITH GRANT OPTION;' : ';'}`
}

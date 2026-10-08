import { backquote } from '@bettermyadmin/sql-gen'
import type { NavDbi } from './dbi.ts'

/** pma: src/UserPrivileges.php */
export interface UserPrivileges {
  database: boolean
  table: boolean
  column: boolean
  routines: boolean
  isReload: boolean
  isCreateDatabase: boolean
  databaseToCreate: string
  /** Database name patterns from the grants, or false when the user has a global privilege. */
  databasesToTest: string[] | false
}

const newPrivileges = (o: Partial<UserPrivileges> = {}): UserPrivileges => ({
  database: false,
  table: false,
  column: false,
  routines: false,
  isReload: false,
  isCreateDatabase: false,
  databaseToCreate: '',
  databasesToTest: false,
  ...o,
})

/** pma: src/Query/Utilities.php::getSystemSchemas (isSystemSchema with the mysql schema) */
const SYSTEM_SCHEMAS = ['information_schema', 'performance_schema', 'mysql', 'sys']

/** pma: src/Util.php::unQuote with one quote character */
function unQuote(s: string, quote: string): string {
  if (s.startsWith(quote) && s.endsWith(quote)) {
    return [...s]
      .slice(1, -1)
      .join('')
      .replaceAll(quote + quote, quote)
  }
  return s
}

const mbIndexOf = (s: string, needle: string, from = 0): number | false => {
  const cps = [...s]
  const joined = cps.join('')
  // translate code-point offset to UTF-16 index and back
  const startUnits = cps.slice(0, from).join('').length
  const i = joined.indexOf(needle, startUnits)
  if (i < 0) return false
  return [...joined.slice(0, i)].length
}

/** pma: src/ShowGrants.php — `GRANT <grants> ON <db>.<table> TO …` */
export function parseShowGrants(line: string): { grants: string; dbName: string; tableName: string } {
  const cps = [...line]
  const sub = (start: number, len: number) => cps.slice(start, len < 0 ? len : start + len).join('')
  const dbNameOffset = Number(mbIndexOf(line, ' ON ') || 0) + 4
  const tableNameEndOffset = Number(mbIndexOf(line, ' TO ') || 0)
  const t = mbIndexOf(line, '`.', dbNameOffset)
  const tableNameStartOffset =
    t !== false && t !== 0 && t < tableNameEndOffset ? t + 1 : Number(mbIndexOf(line, '.', dbNameOffset) || 0)
  const onPos = Number(mbIndexOf(line, ' ON ') || 0)
  const grants = sub(6, onPos - 6)
  const tableName = unQuote(sub(tableNameStartOffset + 1, tableNameEndOffset - tableNameStartOffset - 1), '`')
  const dbName = unQuote(sub(dbNameOffset, tableNameStartOffset - dbNameOffset), '`')
  return { grants, dbName, tableName }
}

/** pma: UserPrivilegesFactory::checkRequiredPrivilegesForAdjust */
function checkRequiredPrivilegesForAdjust(p: UserPrivileges, g: ReturnType<typeof parseShowGrants>): void {
  if (
    g.grants !== 'ALL' &&
    g.grants !== 'ALL PRIVILEGES' &&
    !g.grants.includes('SELECT, INSERT, UPDATE, DELETE')
  ) {
    return
  }
  if (g.dbName === '*' && g.tableName === '*') {
    p.column = true
    p.database = true
    p.routines = true
    p.table = true
    if (g.grants === 'ALL PRIVILEGES' || g.grants === 'ALL') p.isReload = true
  }
  if (g.dbName !== 'mysql') return
  switch (g.tableName) {
    case 'columns_priv':
      p.column = true
      break
    case 'db':
      p.database = true
      break
    case 'procs_priv':
      p.routines = true
      break
    case 'tables_priv':
      p.table = true
      break
    case '*':
      p.column = true
      p.database = true
      p.routines = true
      p.table = true
      break
  }
}

const CACHE_KEYS = {
  isCreateDatabase: 'is_create_db_priv',
  isReload: 'is_reload_priv',
  databaseToCreate: 'db_to_create',
  databasesToTest: 'dbs_to_test',
  routines: 'proc_priv',
  table: 'table_priv',
  column: 'col_priv',
  database: 'db_priv',
} as const

// non-escaped wildcards / escaped wildcards (UserPrivilegesFactory::analyseShowGrant $re0 / $re1)
const RE0 = '(^|(\\\\\\\\)+|[^\\\\])'
const RE1 = '(^|[^\\\\])(\\\\)+'

/** pma: UserPrivilegesFactory::analyseShowGrant (result kept in the session cache) */
async function analyseShowGrant(dbi: NavDbi): Promise<UserPrivileges> {
  const c = dbi.cache
  if (Object.hasOwn(c, CACHE_KEYS.isCreateDatabase)) {
    return newPrivileges({
      database: c[CACHE_KEYS.database] as boolean,
      table: c[CACHE_KEYS.table] as boolean,
      column: c[CACHE_KEYS.column] as boolean,
      routines: c[CACHE_KEYS.routines] as boolean,
      isReload: c[CACHE_KEYS.isReload] as boolean,
      isCreateDatabase: c[CACHE_KEYS.isCreateDatabase] as boolean,
      databaseToCreate: c[CACHE_KEYS.databaseToCreate] as string,
      databasesToTest: c[CACHE_KEYS.databasesToTest] as string[] | false,
    })
  }
  const result = await dbi.tryQuery('SHOW GRANTS')
  const p = newPrivileges({ databasesToTest: [...SYSTEM_SCHEMAS] })
  if (result === null) return p

  for (const row of result.rows) {
    const line = row[0]
    // while ($showGrants = $showGrantsResult->fetchValue())
    if (line === null || line === undefined || line === '' || line === '0') break
    const g = parseShowGrants(line)
    if (g.dbName === '*') {
      if (g.grants !== 'USAGE') p.databasesToTest = false
    } else if (p.databasesToTest !== false) {
      p.databasesToTest.push(g.dbName)
    }
    if (g.grants.includes('RELOAD')) p.isReload = true
    checkRequiredPrivilegesForAdjust(p, g)
    if (
      g.grants !== 'ALL' &&
      g.grants !== 'ALL PRIVILEGES' &&
      g.grants !== 'CREATE' &&
      !g.grants.includes('CREATE,')
    ) {
      continue
    }
    if (g.dbName === '*') {
      // a global CREATE privilege
      p.isCreateDatabase = true
      p.isReload = true
      p.databaseToCreate = ''
      break
    }
    if (p.isCreateDatabase) continue
    const dbNameToTest = backquote(g.dbName)
    // does this db exist?
    const noWildcard = !new RegExp(`${RE0}%|_`).test(g.dbName)
    const escapedWildcard = /\\%|\\_/.test(g.dbName)
    if (noWildcard || escapedWildcard) {
      const used = await dbi.tryQuery(`USE ${dbNameToTest.replace(new RegExp(`${RE1}(%|_)`, 'g'), '$1$3')}`)
      if (used !== null || Number.parseInt(dbi.lastError.slice(1, 5), 10) === 1044) continue
    }
    // Do not handle the underscore wildcard (this case must be rare anyway)
    p.databaseToCreate = g.dbName
      .replace(new RegExp(`${RE0}%`, 'g'), '$1')
      .replace(new RegExp(`${RE1}(%|_)`, 'g'), '$1$3')
    p.isCreateDatabase = true
  }

  c[CACHE_KEYS.isCreateDatabase] = p.isCreateDatabase
  c[CACHE_KEYS.isReload] = p.isReload
  c[CACHE_KEYS.databaseToCreate] = p.databaseToCreate
  c[CACHE_KEYS.databasesToTest] = p.databasesToTest
  c[CACHE_KEYS.routines] = p.routines
  c[CACHE_KEYS.table] = p.table
  c[CACHE_KEYS.column] = p.column
  c[CACHE_KEYS.database] = p.database
  return p
}

/** pma: UserPrivilegesFactory::getPrivileges */
export async function getPrivileges(dbi: NavDbi): Promise<UserPrivileges> {
  const [username = ''] = (await dbi.getCurrentUser()).split('@')
  // If MySQL is started with --skip-grant-tables
  if (username === '') {
    return newPrivileges({
      database: true,
      table: true,
      column: true,
      routines: true,
      isReload: true,
      isCreateDatabase: true,
    })
  }
  return analyseShowGrant(dbi)
}

/** NavigationController `reload`: SessionCache::set('dbs_to_test', false) (#14252). */
export function forgetDatabasesToTest(dbi: NavDbi): void {
  dbi.cache[CACHE_KEYS.databasesToTest] = false
}

import type {
  CreateDatabaseResponse,
  DatabaseRow,
  DatabasesResponse,
  DropDatabasesResponse,
} from '@bettermyadmin/contracts'
import { formatByteDown, formatNumber, sprintf } from '@bettermyadmin/i18n'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import { listNavigator } from '../navigation/list-navigator.ts'
import { strcasecmp, strnatcasecmp } from '../navigation/php.ts'
import { getPrivileges } from '../navigation/privileges.ts'
import { findCollation, loadCharsets, loadCollations } from './charsets.ts'
import { type AdminCtx, isSuperUser, isSystemSchema, mysqlDocuUrl } from './context.ts'
import { ReplicationInfo } from './replication-info.ts'

const SORT_BY_ALLOWED_LIST = [
  'SCHEMA_NAME',
  'DEFAULT_COLLATION_NAME',
  'SCHEMA_TABLES',
  'SCHEMA_TABLE_ROWS',
  'SCHEMA_DATA_LENGTH',
  'SCHEMA_INDEX_LENGTH',
  'SCHEMA_LENGTH',
  'SCHEMA_DATA_FREE',
]

const STAT_KEYS = [
  ['SCHEMA_TABLES', 'Tables', 'number'],
  ['SCHEMA_TABLE_ROWS', 'Rows', 'number'],
  ['SCHEMA_DATA_LENGTH', 'Data', 'byte'],
  ['SCHEMA_INDEX_LENGTH', 'Indexes', 'byte'],
  ['SCHEMA_LENGTH', 'Total', 'byte'],
  ['SCHEMA_DATA_FREE', 'Overhead', 'byte'],
] as const

const lists = new WeakMap<AdminCtx, Promise<string[]>>()

/**
 * DatabaseInterface::getDatabaseList: built once per request (ListDatabase's constructor), `fresh`
 * rebuilds it (ListDatabase::build).
 */
export function databaseList(ctx: AdminCtx, fresh = false): Promise<string[]> {
  let list = lists.get(ctx)
  if (list === undefined || fresh) {
    list = buildDatabaseList(ctx)
    lists.set(ctx, list)
  }
  return list
}

/**
 * ListDatabase::build — retrieve (+ only_db, hide_db): the databases the user may see.
 * pma: src/ListDatabase.php
 */
async function buildDatabaseList(ctx: AdminCtx): Promise<string[]> {
  const { server, cfg, dbi } = ctx
  const privileges = await getPrivileges(dbi)
  const onlyDb = (server as unknown as { only_db: string | string[] }).only_db
  let list: string[]
  const sort = (xs: string[]) => (cfg.NaturalOrder ? xs.sort(strnatcasecmp) : xs.sort())
  const retrieve = async (like: string | null): Promise<string[]> => {
    let command = ''
    let out: string[] = []
    if (!server.DisableIS) {
      command = 'SELECT `SCHEMA_NAME` FROM `INFORMATION_SCHEMA`.`SCHEMATA`'
      if (like !== null) command += ` WHERE \`SCHEMA_NAME\` LIKE '${like}'`
    } else if (privileges.databasesToTest === false || like !== null) {
      command = 'SHOW DATABASES'
      if (like !== null) command += ` LIKE '${like}'`
    } else {
      for (const db of privileges.databasesToTest) out = out.concat(await retrieve(db))
    }
    if (command !== '') out = (await dbi.fetchSingleColumn(command)).map((v) => v ?? '')
    return sort(out)
  }
  const only =
    typeof onlyDb === 'string' ? (onlyDb === '' ? null : [onlyDb]) : Array.isArray(onlyDb) ? onlyDb : null
  if (only !== null) {
    // ListDatabase::checkOnlyDatabase
    list = []
    for (const each of only) {
      // a name with a non-escaped `_` or `%` is a LIKE pattern, anything else is taken as is
      if (!/(^|[^\\])(_|%)/.test(each)) {
        list.push(each.replace(/\\\\|\\_|\\%/g, (m) => m.slice(1)))
        continue
      }
      list = list.concat(await retrieve(each))
    }
  } else {
    list = await retrieve(null)
  }
  const hide = (server as unknown as { hide_db: string }).hide_db
  if (typeof hide === 'string' && hide !== '') {
    const re = new RegExp(hide)
    list = list.filter((db) => !re.test(db))
  }
  return list
}

/**
 * The databases list with optional statistics, replication flags, create and drop forms.
 * pma: src/Controllers/Server/DatabasesController.php, DatabaseInterface::getDatabasesFull,
 *      Query/Generator::getInformationSchemaDatabasesFullRequest
 */
export async function databasesPage(
  ctx: AdminCtx,
  q: { statistics: boolean; pos: number; sortBy: string; sortOrder: string },
): Promise<DatabasesResponse> {
  const { tr, cfg, dbi } = ctx
  const privileges = await getPrivileges(dbi)
  const hasStatistics = q.statistics
  const position = Math.trunc(q.pos)
  // SORT_BY_ALLOWED_LIST[array_search(...)]: not found (false) → index 0
  const sortBy = SORT_BY_ALLOWED_LIST.includes(q.sortBy) ? q.sortBy : 'SCHEMA_NAME'
  const sortOrder = q.sortOrder.toLowerCase() !== 'desc' ? 'asc' : 'desc'

  const replication = await new ReplicationInfo(dbi, ctx.versionInt, ctx.isMariaDb).load()
  const primary = replication.primaryInfo
  const replica = replication.replicaInfo

  let rows: Array<Record<string, string | null>> = []
  let error: DatabasesResponse['error'] = null
  const upperOrder = sortOrder.toUpperCase()
  if (!ctx.server.DisableIS) {
    // NaturalOrder: no LIMIT in SQL, sorted and sliced afterwards
    const limit = !cfg.NaturalOrder ? ` LIMIT ${cfg.MaxDbList} OFFSET ${position}` : ''
    let sql = 'SELECT *, CAST(BIN_NAME AS CHAR CHARACTER SET utf8) AS SCHEMA_NAME FROM ('
    sql += 'SELECT BINARY s.SCHEMA_NAME AS BIN_NAME, s.DEFAULT_COLLATION_NAME'
    if (hasStatistics) {
      sql +=
        ', COUNT(t.TABLE_SCHEMA)  AS SCHEMA_TABLES, SUM(t.TABLE_ROWS)      AS SCHEMA_TABLE_ROWS, SUM(t.DATA_LENGTH)     AS SCHEMA_DATA_LENGTH, SUM(t.MAX_DATA_LENGTH) AS SCHEMA_MAX_DATA_LENGTH, SUM(t.INDEX_LENGTH)    AS SCHEMA_INDEX_LENGTH, SUM(t.DATA_LENGTH + t.INDEX_LENGTH) AS SCHEMA_LENGTH,' +
        " SUM(IF(t.ENGINE <> 'InnoDB', t.DATA_FREE, 0)) AS SCHEMA_DATA_FREE"
    }
    sql += ' FROM `information_schema`.SCHEMATA s '
    if (hasStatistics)
      sql += ' LEFT JOIN `information_schema`.TABLES t ON BINARY t.TABLE_SCHEMA = BINARY s.SCHEMA_NAME'
    sql += ' GROUP BY BINARY s.SCHEMA_NAME, s.DEFAULT_COLLATION_NAME ORDER BY '
    if (sortBy === 'SCHEMA_NAME' || sortBy === 'DEFAULT_COLLATION_NAME') sql += 'BINARY '
    sql += `${backquote(sortBy)} ${upperOrder}${limit}) a`
    const r = await dbi.tryQuery(sql, 'databases.full')
    if (r === null) {
      error = { message: dbi.lastError, sql }
    } else {
      // fetchResult keyed by SCHEMA_NAME
      const byName = new Map<string, Record<string, string | null>>()
      for (const row of r.rows) {
        const rec = Object.fromEntries(r.fields.map((f, i) => [f, row[i] ?? null]))
        byName.set(rec.SCHEMA_NAME ?? '', rec)
      }
      // display only databases also in official database list (hide_db, only_db)
      const visible = new Set(await databaseList(ctx))
      rows = [...byName.values()].filter((rec) => visible.has(rec.SCHEMA_NAME ?? ''))
    }
  } else {
    for (const name of await databaseList(ctx)) {
      const rec: Record<string, string | null> = { SCHEMA_NAME: name }
      // getDbCollation
      rec.DEFAULT_COLLATION_NAME = await dbCollation(ctx, name)
      if (hasStatistics) {
        const stats = {
          SCHEMA_TABLES: 0,
          SCHEMA_TABLE_ROWS: 0,
          SCHEMA_DATA_LENGTH: 0,
          SCHEMA_MAX_DATA_LENGTH: 0,
          SCHEMA_INDEX_LENGTH: 0,
          SCHEMA_LENGTH: 0,
          SCHEMA_DATA_FREE: 0,
        }
        for (const t of await ctx.conn.rows(
          `SHOW TABLE STATUS FROM ${backquote(name)};`,
          'databases.tableStatus',
        )) {
          const n = (k: string) => Number(t[k] ?? 0) || 0
          stats.SCHEMA_TABLES++
          stats.SCHEMA_TABLE_ROWS += n('Rows')
          stats.SCHEMA_DATA_LENGTH += n('Data_length')
          stats.SCHEMA_MAX_DATA_LENGTH += n('Max_data_length')
          stats.SCHEMA_INDEX_LENGTH += n('Index_length')
          if (t.Engine !== 'InnoDB') stats.SCHEMA_DATA_FREE += n('Data_free')
          stats.SCHEMA_LENGTH += n('Data_length') + n('Index_length')
        }
        for (const [k, v] of Object.entries(stats)) rec[k] = String(v)
      }
      rows.push(rec)
    }
  }
  if (cfg.NaturalOrder || ctx.server.DisableIS) {
    // Utilities::usortComparisonCallback
    rows.sort((a, b) => {
      const x = a[sortBy]
      const y = b[sortBy]
      if (x === undefined || x === null || y === undefined || y === null) return 0
      const c = cfg.NaturalOrder ? strnatcasecmp(x, y) : strcasecmp(x, y)
      return (upperOrder === 'ASC' ? 1 : -1) * c
    })
    rows = rows.slice(position, position + cfg.MaxDbList)
  }
  const databaseCount = error === null ? (await databaseList(ctx)).length : 0

  const collations = await loadCollations(ctx)
  const headerStatistics = STAT_KEYS.map(([key, title, format]) => ({
    key,
    title: tr.gettext(title),
    format,
  }))
  const totals = new Map<string, bigint>(STAT_KEYS.map(([k]) => [k, 0n]))
  const stat = (key: string, format: 'number' | 'byte', raw: bigint) => {
    if (format === 'byte') {
      const [value, unit] = formatByteDown(tr, raw.toString(), 3, 1)!
      return { key, raw: raw.toString(), format, value, unit }
    }
    return { key, raw: raw.toString(), format, value: formatNumber(tr, raw.toString(), 0) }
  }
  const replicated = (info: { status: boolean; doDb: string[]; ignoreDb: string[] }, name: string) => {
    if (!info.status) return null
    if (info.ignoreDb.includes(name)) return false
    return info.doDb.includes(name) || info.doDb.length === 0
  }
  const pmadb = ctx.server.pmadb
  const databases: DatabaseRow[] = rows.map((rec) => {
    const name = rec.SCHEMA_NAME ?? ''
    const statistics = hasStatistics
      ? STAT_KEYS.map(([key, , format]) => {
          const raw = intCast(rec[key] ?? '0')
          totals.set(key, totals.get(key)! + raw)
          return stat(key, format, raw)
        })
      : []
    const c = findCollation(collations, rec.DEFAULT_COLLATION_NAME ?? '')
    return {
      name,
      collation: c === null ? null : { name: c.name, description: c.description },
      statistics,
      primaryReplicated: replicated(primary, name),
      replicaReplicated: replicated(replica, name),
      isSystemSchema: isSystemSchema(name, true),
      isPmadb: name === pmadb,
    }
  })

  const charsets: DatabasesResponse['charsets'] = []
  if (cfg.ShowCreateDb && privileges.isCreateDatabase) {
    const list = await loadCharsets(ctx)
    const all = await loadCollations(ctx)
    const serverCollation = String((await dbi.fetchValue('SELECT @@collation_server')) || '')
    for (const cs of list) {
      charsets.push({
        name: cs.name,
        description: cs.description,
        collations: (all.get(cs.name) ?? []).map((k) => ({
          name: k.name,
          description: k.description,
          isSelected: k.name === serverCollation,
        })),
      })
    }
  }

  return {
    error,
    hasStatistics,
    isCreateDatabaseShown: cfg.ShowCreateDb,
    hasCreateDatabasePrivileges: privileges.isCreateDatabase,
    databaseToCreate: privileges.databaseToCreate,
    charsets,
    databaseCount,
    pos: position,
    sortBy,
    sortOrder,
    maxDbList: cfg.MaxDbList,
    pager: listNavigator([], databaseCount, position, cfg.MaxDbList, 'pos'),
    headerStatistics,
    databases,
    totalStatistics: hasStatistics
      ? STAT_KEYS.map(([key, , format]) => stat(key, format, totals.get(key)!))
      : [],
    hasPrimaryReplication: primary.status,
    hasReplicaReplication: replica.status,
    isDropAllowed: (await isSuperUser(dbi)) || cfg.AllowUserDropDatabase,
    defaultTabDatabase: cfg.DefaultTabDatabase,
    createDatabaseDocUrl: mysqlDocuUrl('CREATE_DATABASE', '', ctx.versionInt),
  }
}

/** (int) of a numeric column value (SUM() results are decimals) */
function intCast(s: string): bigint {
  const m = /^\s*([+-]?\d+)/.exec(s)
  return m === null ? 0n : BigInt(m[1]!)
}

/**
 * DatabaseInterface::getDbCollation with DisableIS: selects the database and reads
 * @@collation_database (phpMyAdmin then re-selects the current database, none on a server page).
 */
async function dbCollation(ctx: AdminCtx, db: string): Promise<string | null> {
  await ctx.dbi.tryQuery(`USE ${backquote(db)}`, 'databases.selectDb')
  const v = await ctx.dbi.fetchValue('SELECT @@collation_database')
  return typeof v === 'string' ? v : null
}

/**
 * CREATE DATABASE `name` [DEFAULT CHARSET=… COLLATE …]; the collation applies only when the server
 * knows it.
 * pma: src/Controllers/Server/Databases/CreateController.php, Util::getCharsetQueryPart
 */
export async function createDatabase(
  ctx: AdminCtx,
  newDb0: string,
  collation: string | undefined,
): Promise<CreateDatabaseResponse> {
  const { tr, cfg, dbi } = ctx
  if (newDb0 === '') return { message: { type: 'error', text: tr.gettext('Error') } }
  const newDb = (await dbi.getLowerCaseNames()) === 1 ? newDb0.toLowerCase() : newDb0
  let sql = `CREATE DATABASE ${backquote(newDb)}`
  if (collation !== undefined && collation !== '') {
    const [charset = ''] = collation.split('_')
    const charsets = await loadCharsets(ctx)
    const collations = await loadCollations(ctx)
    if (
      charsets.some((c) => c.name === charset) &&
      (collations.get(charset) ?? []).some((c) => c.name === collation)
    ) {
      sql += ` DEFAULT CHARSET=${charset}${charset === collation ? '' : ` COLLATE ${collation}`}`
    }
  }
  sql += ';'
  const r = await dbi.tryQuery(sql, 'databases.create')
  if (r === null) return { message: { type: 'error', text: dbi.lastError } }
  return {
    message: { type: 'success', text: sprintf(tr.gettext('Database %1$s has been created.'), newDb) },
    sqlQuery: { message: { type: 'success', text: '' }, sql },
    db: newDb,
    route: cfg.DefaultTabDatabase,
  }
}

/**
 * DROP DATABASE for each selected database, skipping system schemas and the pmadb.
 * pma: src/Controllers/Server/Databases/DestroyController.php
 */
export async function dropDatabases(ctx: AdminCtx, selected: unknown[]): Promise<DropDatabasesResponse> {
  const { tr, cfg, dbi } = ctx
  await getPrivileges(dbi)
  if (!(await isSuperUser(dbi)) && !cfg.AllowUserDropDatabase) {
    return { success: false, message: { type: 'error', text: tr.gettext('Error') } }
  }
  const pmadb = ctx.server.pmadb
  const dbs = selected.filter(
    (d): d is string => typeof d === 'string' && !isSystemSchema(d, true) && d !== pmadb,
  )
  if (dbs.length === 0) {
    return { success: false, message: { type: 'error', text: tr.gettext('No databases selected.') } }
  }
  for (const db of dbs) {
    // RelationCleanup::database / Transformations::clear: the pmadb layer's (control connection)
    await ctx.conn.query(`DROP DATABASE ${backquote(db)}`, 'databases.drop')
  }
  // getDatabaseList()->build(): constructs the list, then builds it again
  await databaseList(ctx)
  await databaseList(ctx, true)
  return {
    success: true,
    message: {
      type: 'success',
      text: sprintf(
        tr.ngettext(
          '%1$d database has been dropped successfully.',
          '%1$d databases have been dropped successfully.',
          dbs.length,
        ),
        dbs.length,
      ),
    },
  }
}

import { backquote, escapeMysqlWildcards } from '@bettermyadmin/sql-gen'
import { strnatcasecmp } from '../navigation/php.ts'
import type { DbCtx } from './context.ts'

export type TableRow = Record<string, string | null>

/**
 * DatabaseInterface's table cache (Cache::cacheTableData / getCachedTableContent) for one request:
 * getTablesFull fills it, Table::isView / countRecords read it.
 */
export class TableCache {
  readonly #rows = new Map<string, TableRow>()
  readonly #exact = new Map<string, number>()

  key(db: string, table: string): string {
    return `${db}\u0000${table}`
  }

  set(db: string, rows: TableRow[]): void {
    for (const r of rows) this.#rows.set(this.key(db, r.Name ?? r.TABLE_NAME ?? ''), r)
  }

  get(db: string, table: string): TableRow | undefined {
    return this.#rows.get(this.key(db, table))
  }

  exact(db: string, table: string): number | undefined {
    return this.#exact.get(this.key(db, table))
  }

  setExact(db: string, table: string, n: number): void {
    this.#exact.set(this.key(db, table), n)
  }

  forget(db: string, table?: string): void {
    for (const k of [...this.#rows.keys()]) {
      if (table === undefined ? k.startsWith(`${db}\u0000`) : k === this.key(db, table)) this.#rows.delete(k)
    }
    this.#exact.clear()
  }
}

const caches = new WeakMap<DbCtx, TableCache>()
export function tableCache(ctx: DbCtx): TableCache {
  let c = caches.get(ctx)
  if (c === undefined) {
    c = new TableCache()
    caches.set(ctx, c)
  }
  return c
}

/** Query\Generator::getSqlForTablesFull */
export function sqlForTablesFull(collate: string, quotedDb: string, where: string): string {
  return (
    'SELECT *, `TABLE_SCHEMA`       AS `Db`, `TABLE_NAME`         AS `Name`, `TABLE_TYPE`         AS `TABLE_TYPE`,' +
    ' `ENGINE`             AS `Engine`, `ENGINE`             AS `Type`, `VERSION`            AS `Version`,' +
    ' `ROW_FORMAT`         AS `Row_format`, `TABLE_ROWS`         AS `Rows`, `AVG_ROW_LENGTH`     AS `Avg_row_length`,' +
    ' `DATA_LENGTH`        AS `Data_length`, `MAX_DATA_LENGTH`    AS `Max_data_length`,' +
    ' `INDEX_LENGTH`       AS `Index_length`, `DATA_FREE`          AS `Data_free`,' +
    ' `AUTO_INCREMENT`     AS `Auto_increment`, `CREATE_TIME`        AS `Create_time`,' +
    ' `UPDATE_TIME`        AS `Update_time`, `CHECK_TIME`         AS `Check_time`,' +
    ' `TABLE_COLLATION`    AS `Collation`, `CHECKSUM`           AS `Checksum`,' +
    ' `CREATE_OPTIONS`     AS `Create_options`, `TABLE_COMMENT`      AS `Comment`' +
    ` FROM \`information_schema\`.\`TABLES\` t WHERE \`TABLE_SCHEMA\` ${collate} = ${quotedDb} ${where}`
  )
}

const num = (v: string | null | undefined) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** DatabaseInterface::sortTables */
function sortTables(ctx: DbCtx, tables: TableRow[], sortBy: string, sortOrder: string): TableRow[] {
  const dir = sortOrder === 'DESC' ? -1 : 1
  const natural = sortBy === 'Name' && ctx.cfg.NaturalOrder
  const cmp = (a: TableRow, b: TableRow): number => {
    if (natural) return strnatcasecmp(a.Name ?? '', b.Name ?? '')
    if (sortBy === 'Data_length') {
      const x = num(a.Data_length) + num(a.Index_length)
      const y = num(b.Data_length) + num(b.Index_length)
      return x < y ? -1 : x > y ? 1 : 0
    }
    const x = String(a[sortBy] ?? '').toLowerCase()
    const y = String(b[sortBy] ?? '').toLowerCase()
    // PHP 8 `<=>` on numeric strings compares numerically
    if (x !== '' && y !== '' && !Number.isNaN(Number(x)) && !Number.isNaN(Number(y))) {
      return Math.sign(Number(x) - Number(y))
    }
    return x < y ? -1 : x > y ? 1 : 0
  }
  return [...tables].sort((a, b) => dir * cmp(a, b))
}

/**
 * DatabaseInterface::getTablesFull (information_schema, then SHOW TABLE STATUS when it returned
 * nothing). `table` is one name, a list of names, or '' for all; `tableGroup` a name prefix.
 */
export async function getTablesFull(
  ctx: DbCtx,
  db: string,
  opts: {
    table?: string | string[]
    tableGroup?: string
    limitOffset?: number
    limitCount?: number
    sortBy?: string
    sortOrder?: string
    tableType?: 'table' | 'view' | null
  } = {},
): Promise<TableRow[]> {
  const table = opts.table ?? ''
  const tableGroup = opts.tableGroup ?? ''
  const limitOffset = opts.limitOffset ?? 0
  const limitCount = opts.limitCount ?? 0
  const sortBy = opts.sortBy ?? 'Name'
  const sortOrder = opts.sortOrder ?? 'ASC'
  const tableType = opts.tableType ?? null
  const q = (s: string) => ctx.dbi.quoteString(s)
  let tables: TableRow[] = []
  if (!ctx.server.DisableIS) {
    const collate = await ctx.dbi.collateForIS()
    let where = ''
    const hasTable = Array.isArray(table) ? table.length > 0 : table !== ''
    if (hasTable) {
      if (Array.isArray(table)) {
        where = `AND t.\`TABLE_NAME\` ${collate} IN (${table.map(q).join(', ')})`
      } else if (tableGroup !== '') {
        where = `AND (t.\`TABLE_NAME\` LIKE ${q(`${escapeMysqlWildcards(tableGroup)}%`)} OR t.\`TABLE_NAME\` ${collate} = ${q(table)})`
      } else {
        where = `AND t.\`TABLE_NAME\` ${collate} = ${q(table)}`
      }
    }
    if (tableType === 'view') where += " AND t.`TABLE_TYPE` NOT IN ('BASE TABLE', 'SYSTEM VERSIONED')"
    if (tableType === 'table') where += " AND t.`TABLE_TYPE` IN ('BASE TABLE', 'SYSTEM VERSIONED')"
    let sql = sqlForTablesFull(collate, q(db), where)
    if (Array.isArray(table) || table === '' || tableGroup !== '') sql += ` ORDER BY ${sortBy} ${sortOrder}`
    if (limitCount !== 0) sql += ` LIMIT ${limitCount} OFFSET ${limitOffset}`
    tables = await ctx.dbi.fetchResultSimple(sql)
    if ((sortBy === 'Name' && ctx.cfg.NaturalOrder) || sortBy === 'Data_length') {
      tables = sortTables(ctx, tables, sortBy, sortOrder)
    }
  }
  if (tables.length === 0) {
    const conds: string[] = []
    const hasTable = Array.isArray(table) ? table.length > 0 : table !== ''
    if (hasTable) {
      if (Array.isArray(table)) conds.push(`\`Name\` IN (${table.map(q).join(', ')})`)
      else if (tableGroup !== '')
        conds.push(`(\`Name\` LIKE ${q(`${escapeMysqlWildcards(tableGroup)}%`)} OR \`Name\` = ${q(table)})`)
      else conds.push(`\`Name\` = ${q(table)}`)
    }
    if (tableType === 'view') conds.push("`Comment` = 'VIEW'")
    if (tableType === 'table') conds.push("`Comment` != 'VIEW'")
    const rows = await ctx.dbi.fetchResultSimple(
      `SHOW TABLE STATUS FROM ${backquote(db)}${conds.length === 0 ? '' : ` WHERE ${conds.join(' AND ')}`}`,
    )
    tables = sortTables(ctx, rows, sortBy, sortOrder)
    if (limitCount !== 0) tables = tables.slice(limitOffset, limitOffset + limitCount)
    // Compatibility::getISCompatForGetTablesFull
    tables = tables.map((r) => ({
      ...r,
      TABLE_CATALOG: null,
      TABLE_SCHEMA: db,
      TABLE_NAME: r.Name ?? '',
      TABLE_TYPE: r.Engine === null && (r.Comment ?? '').toUpperCase() === 'VIEW' ? 'VIEW' : 'BASE TABLE',
      ENGINE: r.Engine ?? null,
      TABLE_ROWS: r.Rows ?? null,
      DATA_LENGTH: r.Data_length ?? null,
      INDEX_LENGTH: r.Index_length ?? null,
      DATA_FREE: r.Data_free ?? null,
      TABLE_COLLATION: r.Collation ?? null,
      TABLE_COMMENT: r.Comment ?? '',
    }))
  }
  if (tables.length > 0) tableCache(ctx).set(db, tables)
  return tables
}

/** Table::getStatusInfo: the cached row, else one getTablesFull for the table. */
export async function statusInfo(ctx: DbCtx, db: string, table: string): Promise<TableRow | null> {
  const cache = tableCache(ctx)
  let row = cache.get(db, table)
  if (row === undefined) {
    await getTablesFull(ctx, db, { table })
    row = cache.get(db, table)
  }
  return row ?? null
}

/** Table::isView */
export async function isView(ctx: DbCtx, db: string, table: string): Promise<boolean> {
  if (db === '' || table === '') return false
  const row = await statusInfo(ctx, db, table)
  if (row !== null) return row.TABLE_TYPE === 'VIEW' || row.TABLE_TYPE === 'SYSTEM VIEW'
  // information_schema tables are views
  return db === 'information_schema'
}

/** Table::isEngine(['MERGE', 'MRG_MYISAM']) on the cached status */
export async function isMerge(ctx: DbCtx, db: string, table: string): Promise<boolean> {
  const e = ((await statusInfo(ctx, db, table))?.ENGINE ?? '').toUpperCase()
  return e === 'MERGE' || e === 'MRG_MYISAM'
}

/** Table::countRecords */
export async function countRecords(
  ctx: DbCtx,
  db: string,
  table: string,
  forceExact = false,
): Promise<number> {
  const cache = tableCache(ctx)
  const view = await isView(ctx, db, table)
  const cached = cache.exact(db, table)
  if (cached !== undefined) return cached
  let rowCount: number | null = null
  if (!forceExact) {
    if (cache.get(db, table)?.Rows === undefined && !view) await getTablesFull(ctx, db, { table })
    const r = cache.get(db, table)?.Rows
    rowCount = r === undefined || r === null ? null : Number(r)
  }
  if (rowCount !== null && rowCount >= ctx.cfg.MaxExactCount) return rowCount
  if (!view) {
    const v = await ctx.dbi.fetchValue(`SELECT COUNT(*) FROM ${backquote(db)}.${backquote(table)}`)
    rowCount = v === false || v === null ? null : Number(v)
  } else if (ctx.cfg.MaxExactCountViews === 0) {
    return -1
  } else {
    const r = await ctx.dbi.tryQuery(
      `SELECT 1 FROM ${backquote(db)}.${backquote(table)} LIMIT ${ctx.cfg.MaxExactCountViews}`,
    )
    if (r !== null) {
      rowCount = r.rows.length
      if (rowCount === ctx.cfg.MaxExactCountViews) return -1
    }
  }
  if (rowCount !== null && Number.isFinite(rowCount)) {
    cache.setExact(db, table, rowCount)
    return rowCount
  }
  return -1
}

/** Table::getRealRowCountTable */
export async function realRowCount(ctx: DbCtx, db: string, table: string): Promise<number> {
  const v = await ctx.dbi.fetchValue(`SELECT COUNT(*) FROM ${backquote(db)}.${backquote(table)}`)
  return Number(v || 0)
}

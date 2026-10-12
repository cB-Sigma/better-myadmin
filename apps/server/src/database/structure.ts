import type {
  DbPager,
  DbStructureResponse,
  DbStructureTable,
  RealRowCountResponse,
} from '@bettermyadmin/contracts'
import { formatByteDown, formatNumber, localisedDate } from '@bettermyadmin/i18n'
import { trackedTables } from '@bettermyadmin/metadata'
import { backquote, escapeMysqlWildcards } from '@bettermyadmin/sql-gen'
import { pageselectorPages } from '../navigation/list-navigator.ts'
import { strnatcasecmp } from '../navigation/php.ts'
import { ReplicationInfo } from '../server-admin/replication-info.ts'
import { type DbCtx, getDbCollation, isSystemSchema, listTables } from './context.ts'
import { type TableRow, countRecords, getTablesFull, isMerge, realRowCount, tableCache } from './tables.ts'

/**
 * The database Structure tab.
 * pma: src/Controllers/Database/StructureController.php, templates/database/structure/*.twig
 */

const SORT_MAP: Record<string, string> = {
  table: 'Name',
  records: 'Rows',
  type: 'Engine',
  collation: 'Collation',
  size: 'Data_length',
  overhead: 'Data_free',
  creation: 'Create_time',
  last_update: 'Update_time',
  last_check: 'Check_time',
  comment: 'Comment',
}

const num = (v: unknown) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** StructureController::getTableListPosition ($_SESSION['tmpval']['table_limit_offset']) */
function tableListPosition(ctx: DbCtx, pos: string | undefined): number {
  const t = ctx.tmpval
  if (t.table_limit_offset === undefined || t.table_limit_offset_db !== ctx.db) {
    t.table_limit_offset = 0
    t.table_limit_offset_db = ctx.db
  }
  if (pos !== undefined && pos.trim() !== '' && !Number.isNaN(Number(pos))) {
    t.table_limit_offset = Math.max(0, Math.trunc(Number(pos)))
  }
  return t.table_limit_offset as number
}

/** pma: Generator::getListNavigator */
export function pager(total: number, pos: number, maxCount: number): DbPager | null {
  if (!(maxCount < total)) return null
  const lastPos = Math.floor(total / maxCount) * maxCount
  const hasNext = pos + maxCount < total
  return {
    pos,
    total,
    maxCount,
    begin: pos > 0 ? 0 : null,
    prev: pos > 0 ? pos - maxCount : null,
    next: hasNext ? pos + maxCount : null,
    end: hasNext ? (lastPos === total ? total - maxCount : lastPos) : null,
    pages: pageselectorPages(maxCount, Math.floor(pos / maxCount) + 1, Math.ceil(total / maxCount)),
  }
}

/** Util::localisedDate(new DateTimeImmutable($s)) — '-' when unset */
function date(ctx: DbCtx, s: string | null | undefined): { text: string; epoch: number } | null {
  if (s === null || s === undefined || s === '') return null
  const epoch = Date.parse(`${s.replace(' ', 'T')}Z`) / 1000
  if (!Number.isFinite(epoch)) return null
  return { text: localisedDate(ctx.tr, epoch, '', 'UTC'), epoch }
}

/** StructureController::getDbInfo */
async function getDbInfo(
  ctx: DbCtx,
  sortParam: string | undefined,
  sortOrderParam: string | undefined,
  groupParam: string | undefined,
  typeParam: string | undefined,
  position: number,
): Promise<[TableRow[], number]> {
  const mapped = sortParam !== undefined ? SORT_MAP[sortParam] : undefined
  const sortOrder = mapped !== undefined && sortOrderParam === 'DESC' ? 'DESC' : 'ASC'
  const sort = mapped ?? 'Name'
  const group = groupParam !== undefined && groupParam !== '' ? groupParam : null
  const type = typeParam === 'table' || typeParam === 'view' ? typeParam : null
  if (group === null && type === null) {
    let names = await listTables(ctx)
    let limitCount = ctx.cfg.MaxTableList
    const total = names.length
    if (sort === 'Name') {
      names = (sortOrder === 'DESC' ? [...names].reverse() : names).slice(position, position + limitCount)
      limitCount = 0
    }
    const tables = await getTablesFull(ctx, ctx.db, {
      table: names,
      limitOffset: position,
      limitCount,
      sortBy: sort,
      sortOrder,
    })
    return [tables, total]
  }
  if (group === null) {
    const tables = await getTablesFull(ctx, ctx.db, { table: [], sortBy: sort, sortOrder, tableType: type })
    return [tables, tables.length]
  }
  const sep = ctx.cfg.NavigationTreeTableSeparator
  const sepStr = typeof sep === 'string' ? sep : Array.isArray(sep) ? String(sep[0] ?? '') : ''
  const tables = await getTablesFull(ctx, ctx.db, {
    table: group,
    tableGroup: group + sepStr,
    sortBy: sort,
    sortOrder,
    tableType: type,
  })
  return [tables, tables.length]
}

/**
 * `SkipLockedTables`: the tables in use (`SHOW OPEN TABLES … In_use > 0`) are listed without their
 * status, the others with getTablesFull; no table in use lists nothing, like phpMyAdmin.
 * pma: src/Controllers/Database/StructureController.php::getTablesWhenOpen
 */
async function getTablesWhenOpen(
  ctx: DbCtx,
  groupParam: string | undefined,
  typeParam: string | undefined,
): Promise<[TableRow[], number]> {
  const { db } = ctx
  const open = await ctx.dbi.fetchResultSimple(`SHOW OPEN TABLES FROM ${backquote(db)} WHERE In_use > 0;`)
  const openNames = open.map((r) => r.Table ?? '')
  if (openNames.length === 0) return [[], 0]
  const q = (v: string) => ctx.dbi.quoteString(v)
  const column = backquote(`Tables_in_${db}`)
  let where = ''
  const group = groupParam ?? ''
  if (group !== '') {
    const sep = ctx.cfg.NavigationTreeTableSeparator
    const sepStr = typeof sep === 'string' ? sep : Array.isArray(sep) ? String(sep[0] ?? '') : ''
    where += ` WHERE (${column} LIKE ${q(`${escapeMysqlWildcards(group + sepStr)}%`)} OR ${column} LIKE ${q(escapeMysqlWildcards(group))})`
  }
  if (typeParam === 'table' || typeParam === 'view') {
    where += where !== '' ? ' AND' : ' WHERE'
    where +=
      typeParam === 'view'
        ? " `Table_type` NOT IN ('BASE TABLE', 'SYSTEM VERSIONED')"
        : " `Table_type` IN ('BASE TABLE', 'SYSTEM VERSIONED')"
  }
  const names = (await ctx.dbi.fetchResultSimple(`SHOW FULL TABLES FROM ${backquote(db)}${where}`)).map(
    (r) => Object.values(r)[0] ?? '',
  )
  const tables = new Map<string, TableRow>()
  const rest: string[] = []
  for (const name of names) {
    if (name === '' || name === '0') break // while ($tableName = fetchValue()): a falsy name ends it
    if (!openNames.includes(name)) rest.push(name)
    else
      tables.set(name, { TABLE_NAME: name, ENGINE: '', TABLE_TYPE: '', TABLE_ROWS: '0', TABLE_COMMENT: '' })
  }
  if (rest.length > 0)
    for (const row of await getTablesFull(ctx, db, { table: rest }))
      if (!tables.has(row.TABLE_NAME ?? '')) tables.set(row.TABLE_NAME ?? '', row)
  let out = [...tables]
  if (ctx.cfg.NaturalOrder) out = out.sort(([a], [b]) => strnatcasecmp(a, b))
  return [out.map(([, r]) => r), out.length]
}

export async function structurePage(
  ctx: DbCtx,
  q: {
    pos?: string | undefined
    sort?: string | undefined
    sort_order?: string | undefined
    tbl_group?: string | undefined
    tbl_type?: string | undefined
  },
): Promise<DbStructureResponse> {
  const { cfg, tr, db } = ctx
  const position = tableListPosition(ctx, q.pos)
  // StructureController::getDatabaseInfo
  const [rawTables, total] = cfg.SkipLockedTables
    ? await getTablesWhenOpen(ctx, q.tbl_group, q.tbl_type)
    : await getDbInfo(ctx, q.sort, q.sort_order, q.tbl_group, q.tbl_type, position)
  const system = isSystemSchema(db)
  const isShowStats = cfg.ShowStats && !system
  const isShowDbDetails = cfg.PropertiesNumColumns < 2
  const base = {
    db,
    isSystemSchema: system,
    sort: q.sort ?? '',
    sortOrder: q.sort_order ?? '',
    config: {
      showStats: isShowStats,
      showDbDetails: isShowDbDetails,
      numFavoriteTables: cfg.NumFavoriteTables,
      showCharset: cfg.ShowDbStructureCharset,
      showComment: cfg.ShowDbStructureComment,
      showCreation: cfg.ShowDbStructureCreation,
      showLastUpdate: cfg.ShowDbStructureLastUpdate,
      showLastCheck: cfg.ShowDbStructureLastCheck,
      limitChars: cfg.LimitChars,
      disableMultiTableMaintenance: cfg.DisableMultiTableMaintenance,
      propertiesNumColumns: cfg.PropertiesNumColumns,
      centralColumns: ctx.rp.centralColumnsFeature !== null,
    },
  }
  if (total > 0 && position >= total) {
    return {
      ...base,
      tables: [],
      pager: null,
      replicaStatus: false,
      overheadCheck: false,
      summary: null,
      redirectPos: Math.max(0, total - cfg.MaxTableList),
    }
  }
  const replication = await new ReplicationInfo(
    ctx.dbi,
    ctx.conn.serverInfo?.versionInt ?? 0,
    ctx.conn.serverInfo?.isMariaDb ?? false,
  ).load()
  const replica = replication.replicaInfo
  if (rawTables.length === 0) {
    return {
      ...base,
      tables: [],
      pager: null,
      replicaStatus: replica.status,
      overheadCheck: false,
      summary: null,
    }
  }
  const tracked = await trackedTables(ctx.control, ctx.rp, ctx.db)
  const metadata = await ctx.meta.meta()
  const favorites = await metadata.recentFavorite('favorite')
  metadata.storeRecentFavorite(favorites)

  let sumEntries = 0
  let sumSize = 0
  let overheadSize = 0
  let overheadCheck = false
  let overallApprox = false
  let createAll: { text: string; epoch: number } | null = null
  let updateAll: { text: string; epoch: number } | null = null
  let checkAll: { text: string; epoch: number } | null = null
  const tables: DbStructureTable[] = []
  const fmtBytes = (n: number, comma: number) => formatByteDown(tr, n, 3, comma) ?? ['0', 'B']

  for (const cur of rawTables) {
    const name = cur.TABLE_NAME ?? cur.Name ?? ''
    let rowsValue: number | null =
      cur.TABLE_ROWS === null || cur.TABLE_ROWS === undefined ? null : num(cur.TABLE_ROWS)
    let counted = false
    let size: DbStructureTable['size'] = { text: '-' }
    let overhead: DbStructureTable['overhead'] = null
    let bytes = 0
    const engine = cur.ENGINE ?? null
    // getStuffForEngineTypeTable
    switch (engine) {
      case 'MyISAM':
      case 'ISAM':
      case 'HEAP':
      case 'MEMORY':
      case 'ARCHIVE':
      case 'Aria':
      case 'Maria': {
        if (system) rowsValue = await countRecords(ctx, db, name)
        if (isShowStats) {
          bytes = num(cur.Data_length) + num(cur.Index_length)
          sumSize += bytes
          const [v, u] = fmtBytes(bytes, bytes > 0 ? 1 : 0)
          size = { value: v, unit: u }
          if (num(cur.Data_free) > 0) {
            const [ov, ou] = fmtBytes(num(cur.Data_free), 1)
            overhead = { value: ov, unit: ou }
            overheadSize += num(cur.Data_free)
          }
        }
        break
      }
      case 'InnoDB':
      case 'PBMS':
      case 'TokuDB':
      case 'ROCKSDB': {
        if (
          ((engine === 'InnoDB' || engine === 'TokuDB') && num(cur.TABLE_ROWS) < cfg.MaxExactCount) ||
          cur.TABLE_ROWS === null ||
          cur.TABLE_ROWS === undefined
        ) {
          counted = true
          rowsValue = await countRecords(ctx, db, name, true)
        }
        if (isShowStats) {
          bytes = num(cur.Data_length) + num(cur.Index_length)
          sumSize += bytes
          const [v, u] = fmtBytes(bytes, bytes > 0 ? 1 : 0)
          size = { value: v, unit: u }
        }
        break
      }
      case 'CSV': {
        rowsValue = await countRecords(ctx, db, name, true)
        if (isShowStats) {
          const cols = await ctx.dbi.fetchResultSimple(
            `SELECT COLUMN_NAME, NUMERIC_SCALE IS NULL AS HAS_QUOTES FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ${ctx.dbi.quoteString(db)} AND TABLE_NAME = ${ctx.dbi.quoteString(name)};`,
          )
          const list = cols.map((c) => backquote(c.COLUMN_NAME ?? '')).join(',')
          await ctx.conn.query('SET SESSION group_concat_max_len = 10 * 1024 * 1024', 'structure.csv')
          const dl = await ctx.dbi.fetchValue(`
                SELECT SUM(LENGTH(REPLACE(
                    REPLACE(
                        REPLACE(CONCAT(${list}), '\\n', 'nl'),
                        '"',
                        'qu'
                    ),
                    '\\\\',
                    'bs'
                ))) FROM ${backquote(db)}.${backquote(name)}`)
          const quoted = cols.reduce((s, c) => s + num(c.HAS_QUOTES), 0)
          bytes = num(dl) + (rowsValue ?? 0) * (quoted * 2 + cols.length)
          sumSize += bytes
          const [v, u] = fmtBytes(bytes, bytes > 0 ? 1 : 0)
          size = { value: v, unit: u }
        }
        break
      }
      case 'MRG_MyISAM':
      case 'MRG_MYISAM':
      case 'MERGE':
        if (isShowStats) size = { text: ' - ' }
        break
      case null:
      case 'SYSTEM VIEW':
        break
      default:
        if (isShowStats) size = { text: tr.gettext('unknown') }
    }
    let view = false
    if (cur.TABLE_TYPE === 'VIEW' || cur.TABLE_TYPE === 'SYSTEM VIEW') {
      rowsValue = await countRecords(ctx, db, name, true)
      view = true
    }
    const merge = await isMerge(ctx, db, name)
    if (!merge) sumEntries += rowsValue ?? 0

    let collation: DbStructureTable['collation'] = null
    let charset = ''
    if (cur.Collation !== null && cur.Collation !== undefined) {
      const c = await ctx.reader.findCollation(cur.Collation)
      if (c !== null) {
        collation = c
        charset = c.name.split('_')[0] ?? ''
      }
    }
    if (isShowStats && overhead !== null) overheadCheck = true
    const createTime = cfg.ShowDbStructureCreation ? date(ctx, cur.Create_time) : null
    if (createTime !== null && (createAll === null || createTime.epoch < createAll.epoch))
      createAll = createTime
    const updateTime = cfg.ShowDbStructureLastUpdate ? date(ctx, cur.Update_time) : null
    if (updateTime !== null && (updateAll === null || updateTime.epoch > updateAll.epoch))
      updateAll = updateTime
    const checkTime = cfg.ShowDbStructureLastCheck ? date(ctx, cur.Check_time) : null
    if (checkTime !== null && (checkAll === null || checkTime.epoch > checkAll.epoch)) checkAll = checkTime

    // isRowCountApproximated
    let approx = false
    let viewHint = false
    if (rowsValue !== null && (engine !== null || view)) {
      approx = !view && (engine === 'InnoDB' || engine === 'TokuDB') && !counted
      if (view && rowsValue >= cfg.MaxExactCountViews) {
        approx = true
        viewHint = true
      }
    }
    overallApprox = overallApprox || approx
    // the cells are rendered when TABLE_ROWS is set and (ENGINE or a view)
    const regular = rowsValue !== null && (engine !== null || view)
    const trackedState = tracked.get(name)
    tables.push({
      name,
      isView: view,
      comment: cur.TABLE_COMMENT ?? '',
      rows: regular ? rowsValue : null,
      rowsText: regular ? formatNumber(tr, rowsValue ?? 0, 0) : '',
      approx,
      viewHint,
      mayHaveRows: (rowsValue ?? 0) > 0 || view,
      engine: engine ?? '',
      collation,
      charset,
      size,
      overhead,
      bytes,
      dataFree: overhead !== null ? num(cur.Data_free) : 0,
      isMerge: merge,
      createTime: createTime?.text ?? '-',
      updateTime: updateTime?.text ?? '-',
      checkTime: checkTime?.text ?? '-',
      favorite: favorites.contains({ db, table: name }),
      tracking: trackedState === undefined ? null : trackedState ? 'active' : 'inactive',
      replication: replicationStatus(replica, db, name),
      inUse:
        regular || view
          ? null
          : cur.Comment !== null && cur.Comment !== ''
            ? (cur.Comment ?? '')
            : tr.gettext('in use'),
    })
  }

  const dbColl = await ctx.reader.findCollation(await getDbCollation(ctx))
  let defaultEngine = ''
  if (isShowDbDetails) {
    const v = await ctx.dbi.fetchValue(
      `SELECT ${(ctx.conn.serverInfo?.versionInt ?? 0) >= 50503 ? '@@default_storage_engine' : '@@storage_engine'};`,
    )
    defaultEngine = typeof v === 'string' ? v : ''
  }
  const sum = fmtBytes(sumSize, 1)
  const ov = fmtBytes(overheadSize, 1)
  return {
    ...base,
    tables,
    pager: pager(total, position, cfg.MaxTableList),
    replicaStatus: replica.status,
    overheadCheck,
    summary: {
      numTables: tables.length,
      rowsText: formatNumber(tr, sumEntries, 0),
      approx: overallApprox,
      defaultStorageEngine: defaultEngine,
      collation: dbColl,
      charset: dbColl?.name.split('_')[0] ?? '',
      size: [sum[0], sum[1]],
      overhead: [ov[0], ov[1]],
      createTime: createAll?.text ?? '-',
      updateTime: updateAll?.text ?? '-',
      checkTime: checkAll?.text ?? '-',
    },
  }
}

/** StructureController::getReplicationStatus (database lists only) */
function replicationStatus(
  replica: { status: boolean; doDb: string[]; ignoreDb: string[] },
  db: string,
  table: string,
): { do: boolean; ignored: boolean } {
  if (!replica.status) return { do: false, ignored: false }
  const ignored = replica.ignoreDb.includes(db)
  const doIt =
    !ignored &&
    (replica.doDb.includes(table) ||
      replica.doDb.includes(db) ||
      (replica.doDb.length === 0 && replica.ignoreDb.length === 0))
  return { do: doIt, ignored }
}

/** pma: Database\Structure\RealRowCountController */
export async function realRowCountAction(
  ctx: DbCtx,
  q: { table?: string; all?: boolean },
): Promise<RealRowCountResponse> {
  if (q.all !== true) {
    return { realRowCount: formatNumber(ctx.tr, await realRowCount(ctx, ctx.db, q.table ?? ''), 0) }
  }
  const out: Array<{ table: string; rowCount: string }> = []
  for (const table of await listTables(ctx)) {
    out.push({ table, rowCount: formatNumber(ctx.tr, await realRowCount(ctx, ctx.db, table), 0) })
  }
  return { realRowCountAll: out }
}

export { tableCache }

/**
 * The Operations tab of a table and of a view, the table maintenance pages and the /sql links of
 * the page. Statements and their order follow phpMyAdmin's controllers.
 *
 * pma: src/Controllers/Operations/TableController.php, ViewController.php, src/Operations.php,
 *      src/Table/TableMover.php, src/Table/Table.php::rename, src/Table/Maintenance.php,
 *      src/Controllers/Table/Maintenance/*, resources/templates/table/operations/index.twig
 */
import type {
  MaintenanceRequest,
  MaintenanceResult,
  MoveCopyRequest,
  OperationsPageResponse,
  OperationsResponse,
  OrderByRequest,
  PartitionOpsRequest,
  RenameViewRequest,
  SqlActionRequest,
  SqlMessage,
  TableOptionsRequest,
} from '@bettermyadmin/contracts'
import { type Translator, sprintf } from '@bettermyadmin/i18n'
import {
  type MetaConn,
  type RelationParameters,
  type TableUiPrefs,
  cleanupTableInStorage,
  duplicateTableInfo,
  getForeignKeysData,
  getForeignersInternal,
  renameTableInStorage,
} from '@bettermyadmin/metadata'
import { getCharsetQueryPart } from '@bettermyadmin/mysql-types'
import { backquote, findDuplicateIndexes } from '@bettermyadmin/sql-gen'
import { AlterStatement, Context as Ctx, Expression, Parser, parseAnalyze } from '@bettermyadmin/sql-lexer'
import type { z } from 'zod'
import type { ServerConfig } from '../config.ts'
import { MysqlError } from '../http/errors.ts'
import { strnatcasecmp } from '../navigation/php.ts'
import { getPrivileges } from '../navigation/privileges.ts'
import type { DdlCtx } from './ddl.ts'
import { isSystemSchema } from './structure-page.ts'
import { getTableDef } from './table-def.ts'

type Out<T extends z.ZodTypeAny> = z.output<T>

/** The configuration storage of the request (null without pmadb). */
export interface OpsMeta {
  rp: RelationParameters
  control: MetaConn | null
  /** Table::getUiProp / removeUiProp of a table (pma__table_uiprefs or the session) */
  uiPrefs?: (db: string, table: string) => Promise<TableUiPrefs>
}

export interface OpsCtx extends DdlCtx {
  meta: OpsMeta | null
  /** Core::signSqlQuery */
  sign: (sql: string) => string
  /** $_SESSION['pma_switch_to_new'] */
  session: { switchToNew?: boolean | undefined }
  /** $cfg['Servers'][$i] of the current server */
  server: ServerConfig
  /** the logged-in MySQL user ($cfg['Server']['user']) */
  user: string
}

const msg = (type: SqlMessage['type'], text: string, sql?: string): SqlMessage =>
  sql === undefined || sql === '' ? { type, text } : { type, text, sql }

const errText = (e: MysqlError) => `#${e.extra.errno ?? 0} - ${e.message}`

async function tryQuery(ctx: DdlCtx, sql: string, label: string): Promise<string | null> {
  try {
    await ctx.reader.conn.query(sql, label)
    return null
  } catch (e) {
    if (e instanceof MysqlError) return errText(e)
    throw e
  }
}

const query = async (ctx: DdlCtx, sql: string, label: string) => {
  await ctx.reader.conn.query(sql, label)
}

/** pma: DatabaseInterface::getWarnings (SHOW WARNINGS → "Level: #Code Message") */
async function getWarnings(ctx: DdlCtx): Promise<Array<{ level: string; code: number; message: string }>> {
  const rows = await ctx.reader.dbi.fetchResultSimple('SHOW WARNINGS')
  return rows.map((r) => ({ level: r.Level ?? '', code: Number(r.Code ?? 0), message: r.Message ?? '' }))
}
const warningText = (w: { level: string; code: number; message: string }) =>
  `${w.level}: #${w.code} ${w.message}`

/** pma: DatabaseInterface::getDatabaseList (the databases the user can see) */
async function databaseList(ctx: DdlCtx): Promise<string[]> {
  const list = (
    await ctx.reader.dbi.fetchSingleColumn('SELECT `SCHEMA_NAME` FROM `INFORMATION_SCHEMA`.`SCHEMATA`')
  ).map((d) => d ?? '')
  return ctx.cfg.NaturalOrder ? list.sort(strnatcasecmp) : list.sort()
}

/** pma: Table::getCreateOptions */
export function parseCreateOptions(raw: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const each of raw !== null && raw !== undefined && raw !== '' ? raw.split(' ') : []) {
    const parts = each.split('=')
    if (parts[1] === undefined) continue
    out[parts[0] ?? ''] = parts[1]
  }
  out.pack_keys = out.pack_keys !== undefined && out.pack_keys !== '' ? out.pack_keys : 'DEFAULT'
  return out
}

/** pma: Operations::getPossibleRowFormat */
async function possibleRowFormats(ctx: DdlCtx): Promise<Record<string, string[]>> {
  const formats: Record<string, string[]> = {
    ARCHIVE: ['COMPRESSED'],
    ARIA: ['FIXED', 'DYNAMIC', 'PAGE'],
    MARIA: ['FIXED', 'DYNAMIC', 'PAGE'],
    MYISAM: ['FIXED', 'DYNAMIC'],
    PBXT: ['FIXED', 'DYNAMIC'],
    INNODB: ['COMPACT', 'REDUNDANT'],
  }
  // Innodb::getInnodbFileFormat: '' on MySQL ≥ 8 / MariaDB ≥ 10.3 (variable removed)
  const v = ctx.reader.server
  let fileFormat = ''
  if (!(v.vendor === 'mariadb' ? v.version >= 100300 : v.version >= 80000)) {
    const r = await ctx.reader.dbi.tryQuery("SHOW GLOBAL VARIABLES LIKE 'innodb_file_format';")
    fileFormat = r?.rows[0]?.[1] ?? ''
  }
  if (
    fileFormat.toLowerCase() === 'barracuda' ||
    (fileFormat === '' && (await ctx.reader.innodbFilePerTable()))
  ) {
    formats.INNODB?.push('DYNAMIC', 'COMPRESSED')
  }
  return formats
}

const isEngine = (engine: string, list: string[]) => list.includes(engine.toUpperCase())

/** Table comment without the `; InnoDB free: …` suffix. pma: TableController */
function userComment(show: string): string {
  if (!show.includes('; InnoDB free')) return show.includes('InnoDB free') ? '' : show
  return show.replace(/; InnoDB free:.*?$/, '')
}

// ---------------------------------------------------------------- page

export async function operationsPage(ctx: OpsCtx): Promise<OperationsPageResponse> {
  const { reader, cfg, db, table } = ctx
  const privs = await getPrivileges(reader.dbi)
  await reader.selectDb(db)
  const status = (await reader.getStatus(db, table)) ?? {}
  const isView = await reader.isView(db, table)
  const engine = isView ? ctx.tr.gettext('View') : (status.ENGINE ?? '').toUpperCase()
  const comment = isView ? '' : userComment(status.TABLE_COMMENT ?? '')
  const createOptions = parseCreateOptions(status.CREATE_OPTIONS)
  if (engine === 'ARIA') {
    createOptions.transactional = (createOptions.transactional ?? '') === '0' ? '0' : '1'
    createOptions.page_checksum ??= ''
  }
  const autoIncrement = status.AUTO_INCREMENT ?? ''
  const columns = (await reader.getColumns(db, table)).map((c) => c.Field)

  let hideOrderTable = false
  if (engine === 'INNODB') {
    for (const idx of await reader.getIndexes(db, table)) {
      if (idx.name === 'PRIMARY') {
        hideOrderTable = true
        break
      }
      if (idx.nonUnique) continue
      if (idx.columns.every((c) => c.null !== 'YES')) {
        hideOrderTable = true
        break
      }
    }
  }

  const collations = await reader.getCollations()
  const charsets = (await reader.getCharsets()).map((cs) => ({
    ...cs,
    collations: [...(collations.get(cs.name)?.values() ?? [])],
  }))
  const formats = await possibleRowFormats(ctx)
  const dbs = await databaseList(ctx)
  const fks = getForeignKeysData(await reader.showCreate(db, table))

  let partitions: string[] = []
  let partitionChoices: OperationsPageResponse['partitionChoices'] = []
  const prows = await reader.getPartitionRows(db, table)
  if (prows.length > 0 && prows[0]?.PARTITION_NAME !== null && prows[0]?.PARTITION_NAME !== undefined) {
    partitions = [...new Set(prows.map((r) => r.PARTITION_NAME ?? ''))]
    const method = prows[0]?.PARTITION_METHOD ?? ''
    const tr = ctx.tr
    partitionChoices = [
      { value: 'ANALYZE', label: tr.gettext('Analyze') },
      { value: 'CHECK', label: tr.gettext('Check') },
      { value: 'OPTIMIZE', label: tr.gettext('Optimize') },
      { value: 'REBUILD', label: tr.gettext('Rebuild') },
      { value: 'REPAIR', label: tr.gettext('Repair') },
      { value: 'TRUNCATE', label: tr.gettext('Truncate') },
      ['RANGE', 'RANGE COLUMNS', 'LIST', 'LIST COLUMNS'].includes(method)
        ? { value: 'DROP', label: tr.gettext('Drop') }
        : { value: 'COALESCE', label: tr.gettext('Coalesce') },
    ]
  }

  return {
    db,
    table,
    isView,
    isSystemSchema: isSystemSchema(db),
    columns,
    hideOrderTable,
    comment,
    storageEngine: engine,
    storageEngines: await reader.getEngineOptions(),
    charsets,
    collation: status.TABLE_COLLATION ?? '',
    rowFormats: formats[engine] ?? [],
    rowFormatCurrent: status.ROW_FORMAT ?? '',
    hasAutoIncrement:
      autoIncrement !== '' && isEngine(engine, ['MYISAM', 'ARIA', 'INNODB', 'PBXT', 'ROCKSDB']),
    autoIncrement,
    hasPackKeys: createOptions.pack_keys !== undefined && isEngine(engine, ['MYISAM', 'ARIA', 'ISAM']),
    packKeys: createOptions.pack_keys ?? '',
    hasChecksumAndDelayKeyWrite: isEngine(engine, ['MYISAM', 'ARIA']),
    checksum: php_empty(createOptions.checksum) ? '0' : '1',
    delayKeyWrite: php_empty(createOptions.delay_key_write) ? '0' : '1',
    hasTransactionalAndPageChecksum: engine === 'ARIA',
    transactional: (createOptions.transactional ?? '') === '0' ? '0' : '1',
    pageChecksum: createOptions.page_checksum ?? '',
    // ListDatabase::getList leaves the system schemas out
    databaseList: dbs.length <= cfg.MaxDbList ? dbs.filter((d) => !isSystemSchema(d)) : null,
    hasForeignKeys: fks.length > 0,
    hasPrivileges: privs.table && privs.column && privs.isReload,
    switchToNew: ctx.session.switchToNew === true,
    partitions,
    partitionChoices,
    foreigners: await referentialIntegrity(ctx),
  }
}

const php_empty = (v: string | undefined) => v === undefined || v === '' || v === '0'

/** pma: Operations::getForeignersForReferentialIntegrityCheck */
async function referentialIntegrity(ctx: OpsCtx): Promise<OperationsPageResponse['foreigners']> {
  if (ctx.meta === null || ctx.meta.rp.relationFeature === null) return []
  const { table } = ctx
  await ctx.reader.selectDb(ctx.db)
  const foreign = await getForeignersInternal(ctx.meta.control, ctx.meta.rp, ctx.db, table)
  const out: OperationsPageResponse['foreigners'] = []
  for (const [master, arr] of Object.entries(foreign)) {
    let join = `SELECT ${backquote(table)}.* FROM ${backquote(table)} LEFT JOIN ${backquote(arr.foreign_db)}.${backquote(arr.foreign_table)}`
    let foreignTable = arr.foreign_table
    if (arr.foreign_table === table) {
      foreignTable = `${table}1`
      join += ` AS ${backquote(foreignTable)}`
    }
    const ref = `${backquote(arr.foreign_db)}.${backquote(foreignTable)}.${backquote(arr.foreign_field)}`
    join += ` ON ${backquote(table)}.${backquote(master)} = ${ref} WHERE ${ref} IS NULL AND ${backquote(table)}.${backquote(master)} IS NOT NULL`
    out.push({
      master,
      db: arr.foreign_db,
      table: arr.foreign_table,
      field: arr.foreign_field,
      sql: join,
      sig: ctx.sign(join),
    })
  }
  return out
}

// ---------------------------------------------------------------- alter table order by / partitions

/** pma: QueryGenerator::getQueryForReorderingTable */
export async function orderBy(ctx: OpsCtx, req: Out<typeof OrderByRequest>) {
  await ctx.reader.selectDb(ctx.db)
  const sql = `ALTER TABLE ${backquote(ctx.table)} ORDER BY ${backquote(req.field)}${req.order === 'desc' ? ' DESC;' : ' ASC;'}`
  await query(ctx, sql, 'operations.order')
  ctx.reader.invalidate()
  return done(ctx, sql)
}

/** "Your SQL query has been executed successfully." with the query. */
function done(ctx: OpsCtx, sql: string): OperationsResponse {
  return { messages: [msg('success', ctx.tr.gettext('Your SQL query has been executed successfully.'), sql)] }
}

/** pma: QueryGenerator::getQueryForPartitioningTable */
export async function partitionOps(ctx: OpsCtx, req: Out<typeof PartitionOpsRequest>) {
  await ctx.reader.selectDb(ctx.db)
  const head = `ALTER TABLE ${backquote(ctx.table)} ${req.operation} PARTITION `
  const sql =
    req.operation === 'COALESCE'
      ? head + String(req.partitions.length)
      : `${head}${req.partitions.join(', ')};`
  await query(ctx, sql, 'operations.partition')
  ctx.reader.invalidate()
  return done(ctx, sql)
}

// ---------------------------------------------------------------- rename

/** pma: Table::isValidName(…, true) */
function isValidName(name: string): boolean {
  return name === name.replace(/\s+$/, '') && name !== ''
}

/**
 * pma: Table::rename — RENAME TABLE (triggers dropped/recreated across databases), then the
 * configuration storage. Returns the message or the error.
 */
async function renameTable(
  ctx: OpsCtx,
  newNameIn: string,
  newDbIn: string | null,
): Promise<
  { ok: true; message: string; name: string; db: string; sql: string } | { ok: false; error: string }
> {
  const { reader, tr, db, table } = ctx
  let newName = newNameIn
  if ((await reader.dbi.getLowerCaseNames()) === 1) newName = newName.toLowerCase()
  let newDb = db
  if (newDbIn !== null && newDbIn !== db) {
    if (!(await databaseList(ctx)).includes(newDbIn)) {
      return { ok: false, error: `${tr.gettext('Invalid database:')} ${newDbIn}` }
    }
    newDb = newDbIn
  }
  const full = (d: string, t: string) => `${backquote(d)}.${backquote(t)}`
  if (full(db, table) === full(newDb, newName))
    return { ok: true, message: '', name: newName, db: newDb, sql: '' }
  if (!isValidName(newName)) {
    return { ok: false, error: `${tr.gettext('Invalid table name:')} ${full(newDb, newName)}` }
  }
  const triggers = await getTriggers(ctx, db, table)
  const handleTriggers = db !== newDb && triggers.length > 0
  if (handleTriggers) {
    for (const t of triggers) {
      await query(ctx, `DROP TRIGGER IF EXISTS ${backquote(db)}.${backquote(t.name)};`, 'rename.trigger-drop')
    }
  }
  const sql = `RENAME TABLE ${full(db, table)} TO ${full(newDb, newName)};`
  const error = await tryQuery(ctx, sql, 'rename')
  if (error !== null) {
    if (handleTriggers) {
      await reader.selectDb(db)
      for (const t of triggers) await query(ctx, createTriggerSql(t, ''), 'rename.trigger-restore')
    }
    return { ok: false, error }
  }
  reader.invalidate()
  if (ctx.meta !== null) {
    await renameTableInStorage(ctx.meta.control, ctx.meta.rp, db, newDb, table, newName)
  }
  return {
    ok: true,
    message: sprintf(tr.gettext('Table %1$s has been renamed to %2$s.'), table, newName),
    name: newName,
    db: newDb,
    sql,
  }
}

export interface TriggerRow {
  name: string
  timing: string
  event: string
  table: string
  statement: string
  definer: string
}

/** pma: Triggers::getDetails (information_schema), sorted by name */
export async function getTriggers(ctx: DdlCtx, db: string, table = ''): Promise<TriggerRow[]> {
  const collate = await ctx.reader.dbi.collateForIS()
  const q = (s: string) => ctx.reader.dbi.quoteString(s)
  let sql =
    'SELECT TRIGGER_SCHEMA, TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING, ACTION_STATEMENT, EVENT_OBJECT_SCHEMA, EVENT_OBJECT_TABLE, DEFINER' +
    ` FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA ${collate}= ${q(db)}`
  if (table !== '') sql += ` AND EVENT_OBJECT_TABLE ${collate} = ${q(table)};`
  const rows = await ctx.reader.dbi.fetchResultSimple(sql)
  return rows
    .map((r) => ({
      name: r.TRIGGER_NAME ?? '',
      timing: r.ACTION_TIMING ?? '',
      event: r.EVENT_MANIPULATION ?? '',
      table: r.EVENT_OBJECT_TABLE ?? '',
      statement: r.ACTION_STATEMENT ?? '',
      definer: r.DEFINER ?? '',
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** pma: QueryGenerator::getCreateTrigger */
export function createTriggerSql(t: TriggerRow, delimiter: string): string {
  return `CREATE TRIGGER ${backquote(t.name)} ${t.timing} ${t.event} ON ${backquote(t.table)}\n FOR EACH ROW ${t.statement}\n${delimiter}\n`
}

// ---------------------------------------------------------------- privileges

/** pma: Operations::adjustPrivilegesRenameOrMoveTable */
async function adjustPrivilegesMove(
  ctx: OpsCtx,
  oldDb: string,
  oldTable: string,
  newDb: string,
  newTable: string,
) {
  const p = await getPrivileges(ctx.reader.dbi)
  if (!p.table || !p.column || !p.isReload) return
  const q = (s: string) => ctx.reader.dbi.quoteString(s)
  await ctx.reader.selectDb('mysql')
  for (const t of ['tables_priv', 'columns_priv']) {
    await query(
      ctx,
      `UPDATE ${backquote(t)}SET Db = ${q(newDb)}, Table_name = ${q(newTable)} where Db = ${q(oldDb)} AND Table_name = ${q(oldTable)};`,
      'operations.privileges',
    )
  }
  await tryQuery(ctx, 'FLUSH PRIVILEGES;', 'operations.flush-privileges')
}

/** pma: Operations::adjustPrivilegesCopyTable (fetchResult keyed by Host: one row per host) */
async function adjustPrivilegesCopy(
  ctx: OpsCtx,
  oldDb: string,
  oldTable: string,
  newDb: string,
  newTable: string,
) {
  const p = await getPrivileges(ctx.reader.dbi)
  if (!p.table || !p.column || !p.isReload) return
  await ctx.reader.selectDb('mysql')
  const byHost = async (t: string) => {
    const r = await ctx.reader.dbi.tryQuery(
      `SELECT * FROM ${backquote(t)} ${t === 'tables_priv' ? 'where' : 'WHERE'} Db = "${oldDb}" AND Table_name = "${oldTable}";`,
    )
    const m = new Map<string, Array<string | null>>()
    for (const row of r?.rows ?? []) m.set(row[0] ?? '', row)
    return [...m.values()]
  }
  for (const o of await byHost('tables_priv')) {
    await query(
      ctx,
      `INSERT INTO ${backquote('tables_priv')} VALUES("${o[0]}", "${newDb}", "${o[2]}", "${newTable}", "${o[4]}", "${o[5]}", "${o[6]}", "${o[7]}");`,
      'operations.privileges',
    )
  }
  for (const o of await byHost('columns_priv')) {
    await query(
      ctx,
      `INSERT INTO ${backquote('columns_priv')} VALUES("${o[0]}", "${newDb}", "${o[2]}", "${newTable}", "${o[4]}", "${o[5]}", "${o[6]}");`,
      'operations.privileges',
    )
  }
  await tryQuery(ctx, 'FLUSH PRIVILEGES;', 'operations.flush-privileges')
}

// ---------------------------------------------------------------- move / copy

/** pma: Operations::moveOrCopyTable + TableMover::moveCopy (MoveMode::SingleTable) */
export async function moveCopy(ctx: OpsCtx, req: Out<typeof MoveCopyRequest>) {
  const { reader, tr, db, table } = ctx
  const move = req.op === 'move'
  await reader.selectDb(db)
  const targetDb = req.targetDb === '' ? db : req.targetDb
  if (req.newName === '') return fail(tr.gettext('The table name is empty!'))
  if (db === targetDb && table === req.newName) {
    return fail(tr.gettext(move ? "Can't move table to same one!" : "Can't copy table to same one!"))
  }
  if (!move) ctx.session.switchToNew = req.switchToNew
  const sqlLog: string[] = []
  const what = move ? 'move' : req.what
  let renamed = false
  if (move) {
    const r = await renameTable(ctx, req.newName, targetDb)
    if (r.ok) {
      renamed = true
      sqlLog.push(r.sql)
    }
  }
  if (!renamed) {
    const dbs = await databaseList(ctx)
    if (!dbs.includes(db)) return fail(sprintf(tr.gettext('Source database `%s` was not found!'), db))
    if (!dbs.includes(targetDb))
      return fail(sprintf(tr.gettext('Target database `%s` was not found!'), targetDb))
    await reader.selectDb(targetDb)
    let maintainRelations = false
    if (what !== 'dataonly') {
      maintainRelations = await handleStructureCreation(ctx, targetDb, req.newName, req, what, sqlLog)
    }
    if (what !== 'structure' && !(await reader.isView(targetDb, req.newName))) {
      await copyData(ctx, targetDb, req.newName, sqlLog)
    }
    if (move) {
      await reader.selectDb(db)
      const drop = `${(await reader.isView(db, table)) ? 'DROP VIEW ' : 'DROP TABLE '}${backquote(db)}.${backquote(table)}`
      await query(ctx, drop, 'move.drop')
      sqlLog.push(`${drop};`)
      if (ctx.meta !== null) {
        await renameTableInStorage(ctx.meta.control, ctx.meta.rp, db, targetDb, table, req.newName)
      }
    } else if (what !== 'dataonly' && !maintainRelations && ctx.meta !== null) {
      await duplicateTableInfo(ctx.meta.control, ctx.meta.rp, db, table, targetDb, req.newName)
    }
  }
  reader.invalidate()
  let text: string
  if (req.adjustPrivileges) {
    if (move) await adjustPrivilegesMove(ctx, db, table, targetDb, req.newName)
    else await adjustPrivilegesCopy(ctx, db, table, targetDb, req.newName)
    text = move
      ? tr.gettext('Table %s has been moved to %s. Privileges have been adjusted.')
      : tr.gettext('Table %s has been copied to %s. Privileges have been adjusted.')
  } else {
    text = move ? tr.gettext('Table %s has been moved to %s.') : tr.gettext('Table %s has been copied to %s.')
  }
  let newName = req.newName
  if ((await reader.dbi.getLowerCaseNames()) === 1) newName = newName.toLowerCase()
  return {
    messages: [
      msg(
        'success',
        sprintf(text, `${backquote(db)}.${backquote(table)}`, `${backquote(targetDb)}.${backquote(newName)}`),
      ),
    ],
    db: move || req.switchToNew ? targetDb : db,
    table: move || req.switchToNew ? newName : table,
  } satisfies OperationsResponse
}

const fail = (text: string): OperationsResponse => ({ messages: [msg('error', text)] })

/** pma: TableMover::handleStructureCreation */
async function handleStructureCreation(
  ctx: OpsCtx,
  targetDb: string,
  targetTable: string,
  req: Out<typeof MoveCopyRequest>,
  what: string,
  sqlLog: string[],
): Promise<boolean> {
  const { reader, db, table } = ctx
  const context = reader.conn.serverInfo?.context
  const isView = await reader.isView(db, table)
  const def = await getTableDef(ctx, db, table, isView, req.autoIncrement)
  const destination = new Expression(targetDb, targetTable, '')
  const build = <T>(fn: () => T) => Ctx.run(context, fn)
  let maintainRelations = false
  if (req.dropIfExists && what !== 'move') {
    const targetIsView = await reader.isView(targetDb, targetTable)
    const drop = build(() => `DROP ${targetIsView ? 'VIEW' : 'TABLE'} IF EXISTS ${destination.build()};`)
    await query(ctx, drop, 'copy.drop-if-exists')
    sqlLog.push(drop)
    maintainRelations = true
  }
  // Phase 2: the new structure
  const create = build(() => {
    const st = new Parser(def.create).statements[0] as
      | { name: Expression | null; build(): string }
      | undefined
    if (st === undefined) return null
    st.name = destination
    return `${st.build()};`
  })
  if (create !== null) {
    if (what === 'move') await reader.selectDb(targetDb)
    await query(ctx, create, 'copy.create')
    sqlLog.push(create)
  }
  // Phase 3: constraints (moves only), names removed
  if (what === 'move' && def.constraints !== '') {
    const c = build(() => {
      const st = new Parser(def.constraints).statements[0]
      if (!(st instanceof AlterStatement)) return def.constraints
      st.table = destination
      for (const a of st.altered ?? []) if (a.options?.has('CONSTRAINT') === true) a.field = null
      return `${st.build()};`
    })
    sqlLog.push(c)
    await query(ctx, c, 'move.constraints')
  }
  // Phase 4: indexes
  if (def.indexes !== null) {
    const statements = build(() =>
      new Parser(def.indexes).statements.map((st) => {
        if (st instanceof AlterStatement) {
          st.table = destination
          for (const a of st.altered ?? []) if (a.options?.has('CONSTRAINT') === true) a.field = null
        }
        return `${st.build()};`
      }),
    )
    for (const s of statements) await query(ctx, s, 'copy.indexes')
    sqlLog.push(statements.join(''))
  }
  // Phase 5: AUTO_INCREMENT
  if (def.autoIncrements !== null) {
    const a = build(() => {
      const st = new Parser(def.autoIncrements ?? '').statements[0]
      if (!(st instanceof AlterStatement)) return null
      st.table = destination
      return `${st.build()};`
    })
    if (a !== null) {
      await query(ctx, a, 'copy.auto-increment')
      sqlLog.push(a)
    }
  }
  return maintainRelations
}

/** pma: TableMover::copyData */
async function copyData(ctx: OpsCtx, targetDb: string, targetTable: string, sqlLog: string[]) {
  const { reader, db, table } = ctx
  await query(ctx, "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'", 'copy.sql-mode')
  sqlLog.push("SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';")
  // Table::getNonGeneratedColumns
  const cols = (await reader.dbi.fetchResultSimple(`SHOW COLUMNS FROM ${backquote(db)}.${backquote(table)}`))
    .filter((c) => {
      const extra = c.Extra ?? ''
      return !(
        (extra.includes('GENERATED') || extra.includes('VIRTUAL')) &&
        !extra.includes('DEFAULT_GENERATED')
      )
    })
    .map((c) => backquote(c.Field ?? ''))
  if (cols.length === 0) return
  const sql = `INSERT INTO ${backquote(targetDb)}.${backquote(targetTable)}(${cols.join(', ')}) SELECT ${cols.join(', ')} FROM ${backquote(db)}.${backquote(table)}`
  await query(ctx, sql, 'copy.data')
  sqlLog.push(`${sql};`)
}

// ---------------------------------------------------------------- table options

/** pma: TableController (submitoptions) + Operations::getTableAltersArray */
export async function tableOptions(ctx: OpsCtx, req: Out<typeof TableOptionsRequest>) {
  const { reader, tr, db } = ctx
  const messages: SqlMessage[] = []
  await reader.selectDb(db)
  const status = (await reader.getStatus(db, ctx.table)) ?? {}
  const isView = await reader.isView(db, ctx.table)
  const tableEngine = isView ? tr.gettext('View') : (status.ENGINE ?? '').toUpperCase()
  const currentEngine = (status.ENGINE ?? '').toUpperCase()
  const tableCollation = status.TABLE_COLLATION ?? ''
  const autoIncrement = status.AUTO_INCREMENT ?? ''
  const createOptions = parseCreateOptions(status.CREATE_OPTIONS)
  if (currentEngine === 'ARIA') {
    createOptions.transactional = (createOptions.transactional ?? '') === '0' ? '0' : '1'
    createOptions.page_checksum ??= ''
  }
  let table = ctx.table
  let newMessage = ''
  let result: boolean | null = null
  let lastSql = ''
  if (req.newName !== undefined) {
    let newName = req.newName
    if ((await reader.dbi.getLowerCaseNames()) === 1) newName = newName.toLowerCase()
    const r = await renameTable(ctx, newName, null)
    if (r.ok) {
      if (req.adjustPrivileges) await adjustPrivilegesMove(ctx, db, table, db, newName)
      await reader.selectDb(db)
      newMessage += r.message
      lastSql = r.sql
      result = true
      table = r.name
    } else {
      newMessage += r.error
      result = false
    }
  }
  const alters: string[] = []
  const q = (s: string) => reader.dbi.quoteString(s)
  const newEngine = req.engine.toUpperCase()
  const engineChange = newEngine !== '' && newEngine !== tableEngine ? newEngine : ''
  if (req.comment !== undefined && req.prevComment !== req.comment) alters.push(`COMMENT = ${q(req.comment)}`)
  if (engineChange !== '' && engineChange.toLowerCase() !== tableEngine.toLowerCase()) {
    alters.push(`ENGINE = ${engineChange}`)
  }
  if (req.collation !== '' && req.collation !== tableCollation) {
    alters.push(`DEFAULT ${getCharsetQueryPart(req.collation)}`)
  }
  const eng = (l: string[]) => isEngine(currentEngine, l)
  if (
    eng(['MYISAM', 'ARIA', 'ISAM']) &&
    req.packKeys !== undefined &&
    req.packKeys !== createOptions.pack_keys
  ) {
    alters.push(`pack_keys = ${req.packKeys}`)
  }
  const bit = (b: boolean) => (b ? '1' : '0')
  if (eng(['MYISAM', 'ARIA']) && bit(req.checksum) !== (php_empty(createOptions.checksum) ? '0' : '1')) {
    alters.push(`checksum = ${bit(req.checksum)}`)
  }
  const transactional =
    createOptions.transactional !== undefined && createOptions.transactional === '0' ? '0' : '1'
  if (eng(['ARIA']) && bit(req.transactional) !== transactional)
    alters.push(`TRANSACTIONAL = ${bit(req.transactional)}`)
  if (eng(['ARIA']) && bit(req.pageChecksum) !== (createOptions.page_checksum ?? '')) {
    alters.push(`PAGE_CHECKSUM = ${bit(req.pageChecksum)}`)
  }
  if (
    eng(['MYISAM', 'ARIA']) &&
    bit(req.delayKeyWrite) !== (php_empty(createOptions.delay_key_write) ? '0' : '1')
  ) {
    alters.push(`delay_key_write = ${bit(req.delayKeyWrite)}`)
  }
  const ai = req.autoIncrement ?? ''
  if (
    eng(['MYISAM', 'ARIA', 'INNODB', 'PBXT', 'ROCKSDB']) &&
    ai !== '' &&
    ai !== '0' &&
    ai !== autoIncrement &&
    ai !== (req.hiddenAutoIncrement ?? '')
  ) {
    alters.push(`auto_increment = ${Number.parseInt(ai, 10) || 0}`)
  }
  const rf = req.rowFormat ?? ''
  if (rf !== '' && rf !== '0') {
    const rowFormat = createOptions.row_format ?? status.ROW_FORMAT ?? ''
    if (
      eng(['MYISAM', 'ARIA', 'INNODB', 'PBXT']) &&
      (rowFormat === '' || rf.toLowerCase() !== rowFormat.toLowerCase()) &&
      ['DEFAULT', 'DYNAMIC', 'FIXED', 'COMPRESSED', 'REDUNDANT', 'COMPACT'].includes(rf)
    ) {
      alters.push(`ROW_FORMAT = ${rf}`)
    }
  }
  let warnings: string[] = []
  if (alters.length > 0) {
    lastSql = `ALTER TABLE ${backquote(table)}\r\n${alters.join('\r\n')};`
    await query(ctx, lastSql, 'operations.options')
    result = true
    warnings = (await getWarnings(ctx))
      .filter((w) => !(newEngine === 'MYISAM' && w.code === 1478 && w.level === 'Error'))
      .map(warningText)
  }
  if (req.collation !== '' && req.changeAllCollations) {
    await reader.selectDb(db)
    const [charset = ''] = req.collation.split('_')
    const sql = `ALTER TABLE ${backquote(table)} CONVERT TO CHARACTER SET ${charset}${charset === req.collation ? '' : ` COLLATE ${req.collation}`}`
    await query(ctx, sql, 'operations.convert')
  }
  reader.invalidate()
  if (req.collation === '') {
    return { messages: [msg('error', tr.gettext('No collation provided.'))], table }
  }
  if (result !== null) {
    if (newMessage === '') {
      if (lastSql === '') messages.push(msg('success', tr.gettext('No change')))
      else
        messages.push(
          result
            ? msg('success', tr.gettext('Your SQL query has been executed successfully.'), lastSql)
            : msg('error', tr.gettext('Error'), lastSql),
        )
    } else {
      messages.push(msg(result ? 'success' : 'error', newMessage, lastSql))
    }
    if (warnings.length > 0) messages.splice(0, messages.length, msg('error', warnings.join('\n'), lastSql))
  }
  return { messages, db, table } satisfies OperationsResponse
}

// ---------------------------------------------------------------- view rename

/** pma: Operations\ViewController (submitoptions) */
export async function renameView(ctx: OpsCtx, req: Out<typeof RenameViewRequest>) {
  const { tr } = ctx
  const r = await renameTable(ctx, req.newName, null)
  const text = r.ok ? r.message : r.error
  const warnings = (await getWarnings(ctx)).map(warningText)
  let m: SqlMessage = msg(
    r.ok ? 'success' : 'error',
    text.trim() === '' ? tr.gettext(r.ok ? 'Your SQL query has been executed successfully.' : 'Error') : text,
    r.ok ? r.sql : '',
  )
  if (warnings.length > 0) m = { ...m, type: 'error', text: [m.text, ...warnings].join('\n') }
  return { messages: [m], table: r.ok ? r.name : ctx.table } satisfies OperationsResponse
}

// ---------------------------------------------------------------- maintenance

const MAINT_TITLES: Record<string, string> = {
  analyze: 'Analyze table',
  check: 'Check table',
  checksum: 'Checksum table',
  optimize: 'Optimize table',
  repair: 'Repair table',
}

/** pma: src/Controllers/Table/Maintenance/*Controller.php + src/Table/Maintenance.php */
export async function maintenance(ctx: OpsCtx, req: Out<typeof MaintenanceRequest>) {
  const { reader, tr, cfg } = ctx
  const tables = req.tables ?? [ctx.table]
  if (tables.length === 0 || tables.some((t) => t === '')) return fail(tr.gettext('No table selected.'))
  if (cfg.DisableMultiTableMaintenance && tables.length > 1) {
    return fail(tr.gettext('Maintenance operations on multiple tables are disabled.'))
  }
  const sql = `${req.op.toUpperCase()} TABLE ${tables.map((t) => backquote(t)).join(', ')};`
  await reader.selectDb(ctx.db)
  const rows = await reader.dbi.fetchResultSimple(sql)
  reader.invalidate()
  const result: MaintenanceResult = { op: req.op, title: tr.gettext(MAINT_TITLES[req.op] ?? ''), rows: [] }
  if (req.op === 'checksum') {
    result.checksums = rows.map((r) => ({ table: r.Table ?? '', checksum: r.Checksum ?? null }))
    result.notices = (await getWarnings(ctx)).map(warningText)
  } else {
    result.rows = rows.map((r) => ({
      table: r.Table ?? '',
      op: r.Op ?? '',
      msgType: r.Msg_type ?? '',
      msgText: r.Msg_text ?? '',
    }))
  }
  if (req.op === 'check') {
    const notices: string[] = []
    for (const t of tables) {
      const dup = findDuplicateIndexes(await reader.getIndexes(ctx.db, t))
      if (dup.length === 0) continue
      notices.push(sprintf(tr.gettext('Problems with indexes of table `%s`'), t))
      for (const [a, b] of dup) {
        notices.push(
          sprintf(
            tr.gettext(
              'The indexes %1$s and %2$s seem to be equal and one of them could possibly be removed.',
            ),
            a,
            b,
          ),
        )
      }
    }
    result.notices = notices
  }
  return {
    messages: [msg('success', tr.gettext('Your SQL query has been executed successfully.'), sql)],
    maintenance: result,
  } satisfies OperationsResponse
}

// ---------------------------------------------------------------- /sql links

/**
 * The /sql links of the page: Defragment, Flush, Truncate, Delete, Drop table, Drop view.
 * Like Sql::executeQueryAndGetQueryResponse: USE, fk_checks (when posted), the query, warnings,
 * FOREIGN_KEY_CHECKS restored, then the configuration-storage purge after a DROP.
 */
export async function sqlAction(ctx: OpsCtx, req: Out<typeof SqlActionRequest>) {
  const { reader, tr, db, table } = ctx
  const full = `${backquote(db)}.${backquote(table)}`
  const isView = await reader.isView(db, table)
  const def: Record<typeof req.action, { sql: string; message: string; purge?: boolean }> = {
    defragment: { sql: `ALTER TABLE ${backquote(table)} ENGINE = InnoDB;`, message: '' },
    flush: {
      sql: `FLUSH TABLE ${backquote(table)}`,
      message: sprintf(tr.gettext('Table %s has been flushed.'), table),
    },
    truncate: {
      sql: `TRUNCATE TABLE ${full}`,
      message: sprintf(tr.gettext('Table %s has been emptied.'), table),
    },
    delete: { sql: `DELETE FROM ${full}`, message: sprintf(tr.gettext('Table %s has been emptied.'), table) },
    drop: {
      sql: `DROP TABLE ${full}`,
      message: sprintf(
        tr.gettext(isView ? 'View %s has been dropped.' : 'Table %s has been dropped.'),
        table,
      ),
      purge: true,
    },
    dropView: {
      sql: `DROP VIEW ${backquote(table)}`,
      message: sprintf(tr.gettext('View %s has been dropped.'), table),
      purge: true,
    },
  }
  const a = def[req.action]
  const r = await runSqlLink(ctx, a.sql, a.message, {
    fkChecks: req.fkChecks,
    purge: a.purge === true,
    deleted: req.action === 'delete',
  })
  return {
    ...r,
    dropped: r.messages[0]?.type === 'success' && (req.action === 'drop' || req.action === 'dropView'),
  }
}

/**
 * A `/sql` link (data-post + getJsConfirmCommonParam): USE, fk_checks when posted, the query,
 * the configuration-storage purge and Transformations::clear after a DROP, warnings,
 * FOREIGN_KEY_CHECKS restored. pma: Sql::executeQueryAndGetQueryResponse
 */
export async function runSqlLink(
  ctx: OpsCtx,
  sql: string,
  messageToShow: string,
  opts: { fkChecks?: boolean | undefined; purge?: boolean; deleted?: boolean } = {},
): Promise<OperationsResponse> {
  const { reader, tr, db, table } = ctx
  const current = await reader.dbi.fetchValue('SELECT DATABASE()')
  if (current !== db) await reader.selectDb(db)
  // ForeignKey::handleDisableCheckInit
  const fkDefault = (await reader.getSessionVariable('FOREIGN_KEY_CHECKS')) === 'ON'
  if (opts.fkChecks !== undefined) await setVariable(ctx, 'FOREIGN_KEY_CHECKS', opts.fkChecks ? 'ON' : 'OFF')
  let ms = 0
  let affected = 0
  try {
    const r = await reader.conn.query(sql, 'operations.sql')
    ms = r.ms
    affected = r.header?.affectedRows ?? 0
  } catch (e) {
    if (e instanceof MysqlError) {
      await setVariable(ctx, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
      return { messages: [msg('error', errText(e), sql)] }
    }
    throw e
  }
  const isDrop = /^DROP\s/i.test(sql)
  if (opts.purge === true && ctx.meta !== null) {
    await cleanupTableInStorage(ctx.meta.control, ctx.meta.rp, db, table)
  }
  // Sql::deleteTransformationInfo → Transformations::clear (user link) after a DROP
  const bt = ctx.meta?.rp.browserTransformationFeature ?? null
  if (bt !== null && !isDrop && /^ALTER\s/i.test(sql)) {
    const lexCtx = reader.conn.serverInfo?.context
    const st = parseAnalyze(sql, db, true, lexCtx !== undefined ? { context: lexCtx } : {})[0]?.statement
    const op = st instanceof AlterStatement ? st.altered?.[0] : undefined
    const field = op?.field
    const column = field !== null && typeof field === 'object' ? (field?.column ?? '') : ''
    if (op?.options?.has('DROP') === true && column !== '' && column !== '0') {
      await reader.dbi.tryQuery(
        `DELETE FROM ${backquote(bt.database)}.${backquote(bt.columnInfo)} WHERE \`db_name\` = '${db}' AND \`table_name\` = '${table}' AND \`column_name\` = '${column}' `,
        'operations.transformation-clear',
      )
    }
  }
  if (bt !== null && isDrop) {
    await reader.dbi.tryQuery(
      `DELETE FROM ${backquote(bt.database)}.${backquote(bt.columnInfo)} WHERE \`db_name\` = '${db}' AND \`table_name\` = '${table}' `,
      'operations.transformation-clear',
    )
  }
  const warnings = (await getWarnings(ctx)).map(warningText)
  await setVariable(ctx, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
  reader.invalidate()
  // Sql::getMessageForNoRowsReturned
  let text = messageToShow
  if (opts.deleted === true) {
    text = sprintf(tr.ngettext('%1$d row deleted.', '%1$d rows deleted.', affected), affected)
  } else if (text === '') {
    text = tr.gettext('MySQL returned an empty result set (i.e. zero rows).')
  }
  if (ms > 0) text += ` ${sprintf(`(${tr.gettext('Query took %01.4f seconds.')})`, ms / 1000)}`
  return { messages: [msg('success', text, sql), ...warnings.map((w) => msg('notice', w))] }
}

/** DatabaseInterface::setVariable: SET only when the value differs */
async function setVariable(ctx: DdlCtx, name: string, value: string): Promise<void> {
  if ((await ctx.reader.getSessionVariable(name)) === value) return
  await ctx.reader.conn.query(`SET ${name} = ${value};`, 'var.set')
}

/**
 * Write side of the Structure tab, the column definition form, the index editor and partitions.
 * Each function sends the statements phpMyAdmin's controller sends, in the same order, and answers
 * with the same messages (msgids, translated).
 *
 * pma: src/Controllers/Table/Structure/*, src/Controllers/Table/{AddField,Create,DropColumn,Indexes,
 *      IndexRename}Controller.php, src/Controllers/Table/Partition/*, src/Sql.php (the /sql links)
 */

import type {
  AddColumnsRequest,
  AddKeyRequest,
  ChangeColumnsRequest,
  ColumnDef,
  ColumnMime,
  CreateTableRequest,
  DdlResponse,
  DropColumnsRequest,
  DropIndexRequest,
  FormIndex,
  MoveColumnsRequest,
  PartitionDefT,
  PartitionMaintenanceRequest,
  Partitioning,
  PartitioningRequest,
  RenameIndexRequest,
  SaveIndexRequest,
  SqlMessage,
} from '@bettermyadmin/contracts'
import { N_, type Translator, sprintf } from '@bettermyadmin/i18n'
import { renameField, setMime } from '@bettermyadmin/metadata'
import { php } from '@bettermyadmin/mysql-types'
import { looseEquals } from '@bettermyadmin/sql-gen'
import {
  type ChangeColumnInput,
  type ColumnDefinition,
  type IndexDefinition,
  type IndexSet,
  type PartitionDefinition,
  type PartitioningInput,
  backquote,
  getAddKeyQuery,
  getAdjustColumnPrivilegesQuery,
  getChangeColumnsQuery,
  getChangeRevertQuery,
  getCollationBlobConversions,
  getColumnCreationQuery,
  getColumnsWithIndex,
  getDropColumnQuery,
  getDropColumnsQuery,
  getDropIndexQuery,
  getMoveColumnsQuery,
  getPartitionMaintenanceQuery,
  getPartitioningQuery,
  getPrimaryKeyQuery,
  getRemovePartitioningQuery,
  getSqlQueryForIndexCreateOrEdit,
  getSqlQueryForRename,
  getTableCreationQuery,
  indexInputFromTableIndex,
} from '@bettermyadmin/sql-gen'
import { AlterStatement, parseAnalyze } from '@bettermyadmin/sql-lexer'
import type { z } from 'zod'
import type { AppConfig } from '../config.ts'
import { MysqlError, ValidationError } from '../http/errors.ts'
import { getPrivileges } from '../navigation/privileges.ts'
import type { OpsMeta } from './operations.ts'
import type { TableReader } from './read.ts'
import { type StructureFeatures, structureFeatures } from './structure-page.ts'

export interface DdlCtx {
  reader: TableReader
  cfg: AppConfig
  tr: Translator
  db: string
  table: string
  /** the configuration-storage features of the request (RelationParameters); none when absent */
  features?: StructureFeatures
  /** the configuration storage (control link, ui prefs); absent for internal callers */
  meta?: OpsMeta | null
}

type Out<T extends z.ZodTypeAny> = z.output<T>

const errorText = (e: MysqlError) => `#${e.extra.errno ?? 0} - ${e.message}`

/** DatabaseInterface::tryQuery: the error as phpMyAdmin formats it, or null. */
async function tryQuery(
  ctx: DdlCtx,
  sql: string,
  label: string,
): Promise<{ error: string | null; ms: number }> {
  try {
    const r = await ctx.reader.conn.query(sql, label)
    return { error: null, ms: r.ms }
  } catch (e) {
    if (e instanceof MysqlError) return { error: errorText(e), ms: 0 }
    throw e
  }
}

/** DatabaseInterface::query: a MySQL error ends the request (error envelope with the SQL). */
async function query(ctx: DdlCtx, sql: string, label: string): Promise<void> {
  await ctx.reader.conn.query(sql, label)
}

const msg = (type: SqlMessage['type'], text: string, sql?: string): SqlMessage =>
  sql === undefined ? { type, text } : { type, text, sql }

/** Indexes::hasPrimaryKey / PrimaryController::hasPrimaryKey: selectDb + SHOW KEYS */
async function hasPrimaryKey(ctx: DdlCtx): Promise<boolean> {
  await ctx.reader.selectDb(ctx.db)
  const rows = await ctx.reader.dbi.fetchResultSimple(`SHOW KEYS FROM ${backquote(ctx.table)}`)
  return rows.some((r) => r.Key_name === 'PRIMARY')
}

/**
 * The /sql links of the Structure page (drop column, drop index, remove partitioning), posted
 * with `is_js_confirmed=1&fk_checks=0`: select the database, switch FOREIGN_KEY_CHECKS off, run,
 * read warnings, drop transformation info of a dropped column, restore FOREIGN_KEY_CHECKS.
 *
 * pma: src/Sql.php::executeQueryAndGetQueryResponse, ::executeTheQuery, ::deleteTransformationInfo,
 *      ::getMessageForNoRowsReturned; src/Utils/ForeignKey.php::handleDisableCheckInit/Cleanup
 */
async function runViaSql(ctx: DdlCtx, sql: string, messageToShow: string): Promise<DdlResponse> {
  const { reader, tr } = ctx
  const current = await reader.dbi.fetchValue('SELECT DATABASE()')
  if (current !== ctx.db) await reader.selectDb(ctx.db)
  const fkDefault = (await reader.getSessionVariable('FOREIGN_KEY_CHECKS')) === 'ON'
  await setVariable(ctx, 'FOREIGN_KEY_CHECKS', 'OFF')
  const r = await tryQuery(ctx, sql, 'structure.sql')
  if (r.error !== null) {
    // Sql::handleQueryExecuteError → Generator::mysqlDie: the error card with the SQL
    throw new MysqlErrorText(r.error, sql)
  }
  await reader.dbi.tryQuery('SHOW WARNINGS')
  const features = await structureFeatures(ctx.db, ctx.table, ctx.features)
  await deleteTransformationInfo(ctx, features, sql)
  await setVariable(ctx, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
  reader.invalidate()
  let text = messageToShow
  if (r.ms > 0) text += ` ${sprintf(`(${tr.gettext('Query took %01.4f seconds.')})`, r.ms / 1000)}`
  return { messages: [msg('success', text, sql)] }
}

/** A MySQL error already formatted by phpMyAdmin's rules (`#errno - message`). */
export class MysqlErrorText extends MysqlError {
  constructor(text: string, sql: string) {
    const m = /^#(\d+) - ([\s\S]*)$/.exec(text)
    super({ errno: Number(m?.[1] ?? 0), message: m?.[2] ?? text, sqlMessage: m?.[2] ?? text }, sql)
  }
}

/** DatabaseInterface::setVariable: SET only when the value differs */
async function setVariable(ctx: DdlCtx, name: string, value: string): Promise<void> {
  const current = await ctx.reader.getSessionVariable(name)
  if (current === value) return
  await ctx.reader.conn.query(`SET ${name} = ${value};`, 'var.set')
}

/**
 * Sql::deleteTransformationInfo + Transformations::clear (user connection, values unescaped like
 * phpMyAdmin) when the browser transformation feature is configured.
 */
async function deleteTransformationInfo(
  ctx: DdlCtx,
  features: StructureFeatures,
  sql: string,
): Promise<void> {
  const bt = features.browserTransformation
  if (bt === undefined || bt === null) return
  const ctxLexer = ctx.reader.conn.serverInfo?.context
  const [info] = parseAnalyze(sql, ctx.db, true, ctxLexer !== undefined ? { context: ctxLexer } : {})
  const st = info.statement
  if (!(st instanceof AlterStatement)) return
  const op = st.altered?.[0]
  if (op === undefined || op.options === null || !op.options.has('DROP')) return
  const field = op.field
  const column = field !== null && typeof field === 'object' ? (field.column ?? '') : ''
  if (column === '' || column === '0') return
  await ctx.reader.dbi.tryQuery(
    `DELETE FROM ${backquote(bt.database)}.${backquote(bt.columnInfo)} WHERE ` +
      `\`db_name\` = '${ctx.db}' AND \`table_name\` = '${ctx.table}' AND \`column_name\` = '${column}' `,
    'structure.transformation-clear',
  )
}

// ---------------------------------------------------------------- columns

/**
 * Row actions (add-key) and bulk buttons. The bulk "Primary" asks for confirmation when the table
 * already has a primary key.
 *
 * pma: AddKeyController, AbstractIndexController::handleIndexCreation, PrimaryController
 */
export async function addKey(ctx: DdlCtx, req: Out<typeof AddKeyRequest>): Promise<DdlResponse> {
  const { tr, table } = ctx
  if (req.type === 'PRIMARY' && req.source === 'bulk') {
    const has = await hasPrimaryKey(ctx)
    if (has && !req.confirmed) {
      const display =
        `ALTER TABLE ${backquote(table)}\n  DROP PRIMARY KEY,\n   ADD PRIMARY KEY(\n` +
        req.columns.map((c, i) => `     ${backquote(c)}${i + 1 < req.columns.length ? ',' : ''}`).join('\n') +
        '\n   );'
      return {
        messages: [],
        confirm: { question: tr.gettext('Do you really want to execute the following query?'), sql: display },
      }
    }
    const sql = getPrimaryKeyQuery(table, req.columns, has)
    if (req.dryRun) return { messages: [], preview: sql }
    await ctx.reader.selectDb(ctx.db)
    const r = await tryQuery(ctx, sql, 'structure.primary')
    ctx.reader.invalidate()
    return {
      messages: [
        r.error !== null
          ? msg('error', r.error, sql)
          : msg('success', tr.gettext('Your SQL query has been executed successfully.'), sql),
      ],
    }
  }
  const has = req.type === 'PRIMARY' ? await hasPrimaryKey(ctx) : false
  const sql = getAddKeyQuery(req.type, table, req.columns, has)
  if (req.dryRun) return { messages: [], preview: sql }
  // Indexes::executeAddIndexSql
  await ctx.reader.selectDb(ctx.db)
  const r = await tryQuery(ctx, sql, 'structure.add-key')
  ctx.reader.invalidate()
  return {
    messages: [
      r.error !== null
        ? msg('error', r.error, sql)
        : msg('success', tr.gettext('Your SQL query has been executed successfully.'), sql),
    ],
  }
}

/**
 * Drop: the row link goes through /sql, the bulk button through the Yes/No page.
 *
 * pma: display_structure.twig (drop_column_anchor), DropColumnController
 */
export async function dropColumns(ctx: DdlCtx, req: Out<typeof DropColumnsRequest>): Promise<DdlResponse> {
  const { tr, table } = ctx
  if (req.source === 'row') {
    const column = req.columns[0] ?? ''
    const sql = getDropColumnQuery(table, column)
    if (req.dryRun) return { messages: [], preview: sql }
    return runViaSql(ctx, sql, sprintf(tr.gettext('Column %s has been dropped.'), column))
  }
  const sql = getDropColumnsQuery(table, req.columns)
  if (req.dryRun) return { messages: [], preview: sql }
  await ctx.reader.selectDb(ctx.db)
  const r = await tryQuery(ctx, sql, 'structure.drop')
  ctx.reader.invalidate()
  if (r.error !== null) return { messages: [msg('error', r.error)] }
  const n = req.columns.length
  return {
    messages: [
      msg(
        'success',
        sprintf(
          tr.ngettext(
            '%1$d column has been dropped successfully.',
            '%1$d columns have been dropped successfully.',
            n,
          ),
          n,
        ),
      ),
    ],
  }
}

/** pma: MoveColumnsController */
export async function moveColumns(ctx: DdlCtx, req: Out<typeof MoveColumnsRequest>): Promise<DdlResponse> {
  const { reader, tr } = ctx
  await reader.selectDb(ctx.db)
  const create = await reader.showCreate(ctx.db, ctx.table)
  const r = getMoveColumnsQuery(create, req.order, reader.conn.serverInfo?.context)
  if (r.sql === null) throw new ValidationError(tr.gettext(r.error))
  if (req.dryRun) return { messages: [], preview: r.sql }
  const q = await tryQuery(ctx, r.sql, 'structure.move-columns')
  reader.invalidate()
  if (q.error !== null) return { messages: [msg('error', q.error)] }
  return {
    messages: [msg('success', tr.gettext('The columns have been moved successfully.'))],
    columns: [...req.order],
  }
}

/** ColumnDef → the CreateAddField row (field_null 'YES' when ticked, field_extra AUTO_INCREMENT) */
function toColumnDefinition(c: Out<typeof ColumnDef>): ColumnDefinition {
  return {
    name: c.name,
    type: c.type,
    length: c.length,
    attribute: c.attribute,
    collation: c.collation ?? '',
    null: c.null ? 'YES' : 'NO',
    defaultType: c.defaultType,
    defaultValue: c.defaultValue,
    extra: c.autoIncrement ? 'AUTO_INCREMENT' : '',
    comment: c.comments,
    virtuality: c.virtuality ?? '',
    expression: c.expression ?? '',
  }
}

/** the five JSON buckets (primary_indexes, indexes, unique_indexes, fulltext_indexes, spatial_indexes) */
function toIndexSet(indexes: ReadonlyArray<Out<typeof FormIndex>>): IndexSet {
  const def = (i: (typeof indexes)[number]): IndexDefinition => ({
    keyName: i.keyName,
    comment: i.comment,
    choice: i.choice,
    keyBlockSize: i.keyBlockSize,
    parser: i.parser,
    type: i.type,
    columns: i.columns.map((c) => ({ colIndex: c.colIndex, size: c.size })),
  })
  const of = (choice: string) => indexes.filter((i) => i.choice === choice).map(def)
  return {
    primary: of('PRIMARY'),
    index: of('INDEX'),
    unique: of('UNIQUE'),
    fulltext: of('FULLTEXT'),
    spatial: of('SPATIAL'),
  }
}

/**
 * Transformations::setMime for every posted row with a name ("Update comment table for mime
 * types [MIME]"), when the form had the MIME columns and $cfg['BrowseMIME'] is on.
 */
async function updateMimeTypes(
  ctx: Pick<DdlCtx, 'cfg' | 'meta'>,
  db: string,
  table: string,
  columns: ReadonlyArray<{ name: string; mime?: Out<typeof ColumnMime> | undefined }>,
): Promise<void> {
  const meta = ctx.meta
  if (!ctx.cfg.BrowseMIME || meta == null || meta.control === null) return
  for (const c of columns) {
    if (c.mime === undefined || c.name === '') continue
    await setMime(meta.control, meta.rp, db, table, c.name, c.mime)
  }
}

/** SaveController::updateColumns after the ALTER: Relation::renameField, then the MIME types */
async function afterColumnsSaved(
  ctx: DdlCtx,
  columns: ReadonlyArray<{
    name: string
    orig: { field: string }
    mime?: Out<typeof ColumnMime> | undefined
  }>,
): Promise<void> {
  const meta = ctx.meta
  if (meta != null && meta.control !== null) {
    for (const c of columns) {
      if (looseEquals(c.name, c.orig.field)) continue
      await renameField(meta.control, meta.rp, ctx.db, ctx.table, c.orig.field, c.name)
    }
  }
  await updateMimeTypes(ctx, ctx.db, ctx.table, columns)
}

/** pma: AddFieldController (do_save_data) */
export async function addColumns(ctx: DdlCtx, req: Out<typeof AddColumnsRequest>): Promise<DdlResponse> {
  const { reader, tr } = ctx
  const sql = getColumnCreationQuery(
    {
      table: ctx.table,
      columns: req.columns.map(toColumnDefinition),
      indexes: toIndexSet(req.indexes),
      position: { where: req.where, afterField: req.afterField },
      onlineTransaction: req.onlineTransaction,
    },
    { server: reader.server },
  )
  if (req.dryRun) return { messages: [], preview: sql }
  // CreateAddField::tryColumnCreationQuery
  await reader.selectDb(ctx.db)
  const r = await tryQuery(ctx, sql, 'structure.add-field')
  reader.invalidate()
  if (r.error !== null) throw new MysqlErrorText(r.error, sql)
  // Update comment table for mime types [MIME]
  await updateMimeTypes(ctx, ctx.db, ctx.table, req.columns)
  return {
    messages: [
      msg('success', sprintf(tr.gettext('Table %1$s has been altered successfully.'), ctx.table), sql),
    ],
  }
}

/** pma: SaveController::updateColumns */
export async function changeColumns(
  ctx: DdlCtx,
  req: Out<typeof ChangeColumnsRequest>,
): Promise<DdlResponse> {
  const { reader, tr, table } = ctx
  const indexes = await reader.getIndexes(ctx.db, table)
  const columns: ChangeColumnInput[] = req.columns.map((c) => ({
    orig: c.orig.field,
    name: c.name,
    type: c.type,
    length: c.length,
    attribute: c.attribute,
    collation: c.collation,
    null: c.null ? 'YES' : null,
    defaultType: c.defaultType,
    defaultValue: c.defaultValue,
    extra: c.autoIncrement ? 'AUTO_INCREMENT' : null,
    comments: c.comments,
    virtuality: c.virtuality,
    expression: c.expression,
    moveTo: c.moveTo,
    adjustPrivileges: c.adjustPrivileges,
    origValues: {
      type: c.orig.type,
      length: c.orig.length,
      defaultValue: c.orig.defaultValue,
      defaultType: c.orig.defaultType,
      collation: c.orig.collation,
      attribute: c.orig.attribute,
      null: c.orig.null,
      extra: c.orig.extra,
      comments: c.orig.comments,
      virtuality: c.orig.virtuality,
      expression: c.orig.expression,
    },
  }))
  const built = getChangeColumnsQuery(
    {
      table,
      columns,
      columnsWithPrimaryOrUnique: getColumnsWithIndex(indexes, ['PRIMARY', 'UNIQUE']),
      onlineTransaction: req.onlineTransaction,
    },
    { server: reader.server },
  )
  // a changed column that is part of the remembered sort expression deletes it (before the
  // preview: phpMyAdmin does it while collecting the changes)
  const ui = await ctx.meta?.uiPrefs?.(ctx.db, table)
  if (ui !== undefined) {
    for (const i of built.changedIndexes) {
      const sortedCol = await ui.getUiProp('sorted_col')
      if (String(sortedCol === false ? '' : sortedCol).includes(backquote(columns[i]?.orig ?? ''))) {
        await ui.removeUiProp('sorted_col')
      }
    }
  }
  if (req.dryRun) return { messages: [], preview: built.sql ?? '' }
  // columns renamed with "Adjust privileges" ticked
  const adjust = new Map<string, string>()
  for (const i of built.changedIndexes) {
    const c = columns[i]
    if (c === undefined || c.adjustPrivileges !== true || looseEquals(c.orig, c.name)) continue
    adjust.set(c.orig, c.name)
  }
  if (built.sql === null) {
    await afterColumnsSaved(ctx, req.columns)
    return { messages: [] }
  }

  if (!(await reader.selectDb(ctx.db))) {
    throw new MysqlErrorText(reader.dbi.lastError, `USE ${backquote(ctx.db)};`)
  }
  const anyIndex = getColumnsWithIndex(indexes, ['PRIMARY', 'UNIQUE', 'INDEX', 'SPATIAL', 'FULLTEXT'])
  const changedToBlob = new Set<number>()
  // While changing the column collation, first change to BLOB, MEDIUMBLOB or LONGBLOB
  for (const conv of getCollationBlobConversions(table, columns, anyIndex)) {
    await query(ctx, conv.sql, 'structure.collation-blob')
    changedToBlob.add(conv.index)
  }
  const r = await tryQuery(ctx, built.sql, 'structure.save')
  reader.invalidate()
  if (r.error === null) {
    const privs = await getPrivileges(reader.dbi)
    let changedPrivileges = false
    if (privs.column && privs.isReload) {
      await reader.selectDb('mysql')
      for (const [oldCol, newCol] of adjust) {
        await query(
          ctx,
          getAdjustColumnPrivilegesQuery(ctx.db, table, oldCol, newCol),
          'structure.adjust-privileges',
        )
        changedPrivileges = true
      }
      if (changedPrivileges) await tryQuery(ctx, 'FLUSH PRIVILEGES;', 'structure.flush-privileges')
    }
    const text = changedPrivileges
      ? tr.gettext('Table %1$s has been altered successfully. Privileges have been adjusted.')
      : tr.gettext('Table %1$s has been altered successfully.')
    await afterColumnsSaved(ctx, req.columns)
    return { messages: [msg('success', sprintf(text, table), built.sql)] }
  }
  // An error happened: change the BLOB columns back to their original definition
  await query(
    ctx,
    getChangeRevertQuery(table, columns, changedToBlob, { server: reader.server }),
    'structure.revert',
  )
  await afterColumnsSaved(ctx, req.columns)
  return { messages: [msg('error', `${tr.gettext('Query error')}:\n${r.error}`, built.sql)] }
}

/** pma: CreateController (do_save_data) */
export async function createTable(
  ctx: Omit<DdlCtx, 'table'>,
  req: Out<typeof CreateTableRequest>,
): Promise<DdlResponse & { db: string; table: string }> {
  const { reader, tr } = ctx
  let db = ctx.db
  let table = req.table
  if (!(await reader.selectDb(db))) {
    throw new ValidationError(sprintf(tr.gettext("'%s' database does not exist."), db))
  }
  if ((await reader.getColumns(db, table)).length > 0) {
    throw new ValidationError(sprintf(tr.gettext('Table %s already exists!'), table))
  }
  if ((await reader.dbi.getLowerCaseNames()) === 1) {
    db = db.toLowerCase()
    table = table.toLowerCase()
  }
  const engines = (await reader.getStorageEngines()).map((e) => e.Engine)
  const sql = getTableCreationQuery(
    {
      db,
      table,
      columns: req.columns.map(toColumnDefinition),
      indexes: toIndexSet(req.indexes),
      storageEngine: req.engine,
      collation: req.collation,
      connection: req.connection,
      comment: req.comment,
      partitioning: toPartitioningInput(req.partitioning),
    },
    { server: reader.server, storageEngines: engines },
  )
  if (req.dryRun) return { messages: [], preview: sql, db, table }
  const r = await tryQuery({ ...ctx, table }, sql, 'structure.create')
  if (r.error !== null) throw new MysqlErrorText(r.error, sql)
  await updateMimeTypes(ctx, db, table, req.columns)
  return {
    messages: [msg('success', tr.gettext('Your SQL query has been executed successfully.'), sql)],
    db,
    table,
  }
}

// ---------------------------------------------------------------- indexes

/** pma: IndexesController (do_save_data) */
export async function saveIndex(ctx: DdlCtx, req: Out<typeof SaveIndexRequest>): Promise<DdlResponse> {
  const { reader, tr } = ctx
  const engine = (await reader.getEngine(ctx.db, ctx.table)).toUpperCase()
  const r = getSqlQueryForIndexCreateOrEdit(
    req.oldIndex,
    {
      name: req.index.name,
      choice: req.index.choice,
      type: req.index.type,
      keyBlockSize: req.index.keyBlockSize,
      parser: req.index.parser,
      comment: req.index.comment,
      columns: req.index.columns.map((c) => ({ name: c.name, subPart: c.subPart, collation: c.collation })),
    },
    ctx.db,
    ctx.table,
    { isTokuDb: engine === 'TOKUDB' },
  )
  if (req.dryRun) return { messages: [], preview: r.sql }
  if (r.error !== null) throw new ValidationError(tr.gettext(r.error))
  await query(ctx, r.sql, 'index.save')
  reader.invalidate()
  return {
    messages: [
      msg('success', sprintf(tr.gettext('Table %1$s has been altered successfully.'), ctx.table), r.sql),
    ],
  }
}

/** pma: IndexRenameController */
export async function renameIndex(ctx: DdlCtx, req: Out<typeof RenameIndexRequest>): Promise<DdlResponse> {
  const { reader, tr } = ctx
  const existing = (await reader.getIndexes(ctx.db, ctx.table)).find((i) => i.name === req.oldIndex)
  const index =
    existing !== undefined
      ? indexInputFromTableIndex(existing, req.name)
      : { name: req.name, choice: 'INDEX', columns: [] }
  const engine = (await reader.getEngine(ctx.db, ctx.table)).toUpperCase()
  const r = getSqlQueryForRename(req.oldIndex, index, ctx.db, ctx.table, reader.server, {
    isTokuDb: engine === 'TOKUDB',
  })
  if (req.dryRun) return { messages: [], preview: r.sql }
  if (r.error !== null) throw new ValidationError(tr.gettext(r.error))
  await query(ctx, r.sql, 'index.rename')
  reader.invalidate()
  return {
    messages: [
      msg('success', sprintf(tr.gettext('Table %1$s has been altered successfully.'), ctx.table), r.sql),
    ],
  }
}

/** The index "Drop" link (via /sql). pma: indexes.twig */
export async function dropIndex(ctx: DdlCtx, req: Out<typeof DropIndexRequest>): Promise<DdlResponse> {
  const { tr } = ctx
  const sql = getDropIndexQuery(ctx.table, req.name)
  if (req.dryRun) return { messages: [], preview: sql }
  const message =
    req.name === 'PRIMARY'
      ? tr.gettext('The primary key has been dropped.')
      : sprintf(tr.gettext('Index %s has been dropped.'), req.name)
  return runViaSql(ctx, sql, message)
}

// ---------------------------------------------------------------- partitions

function toPartitionDefinition(p: PartitionDefT): PartitionDefinition {
  const out: PartitionDefinition = { name: p.name }
  const set = (k: keyof PartitionDefinition, v: string | undefined) => {
    if (v !== undefined) (out as unknown as Record<string, string>)[k] = v
  }
  set('valueType', p.valueType)
  set('value', p.value)
  set('engine', p.engine)
  set('comment', p.comment)
  set('dataDirectory', p.dataDirectory)
  set('indexDirectory', p.indexDirectory)
  set('maxRows', p.maxRows)
  set('minRows', p.minRows)
  set('tablespace', p.tablespace)
  set('nodeGroup', p.nodeGroup)
  if (p.subpartitions !== undefined) out.subpartitions = p.subpartitions.map(toPartitionDefinition)
  return out
}

function toPartitioningInput(p: Out<typeof Partitioning>): PartitioningInput {
  return {
    partitionBy: p.partitionBy,
    partitionExpr: p.partitionExpr,
    partitionCount: p.partitionCount,
    subpartitionBy: p.subpartitionBy,
    subpartitionExpr: p.subpartitionExpr,
    subpartitionCount: p.subpartitionCount,
    partitions: p.partitions.map(toPartitionDefinition),
  }
}

/** pma: PartitioningController::updatePartitioning */
export async function savePartitioning(
  ctx: DdlCtx,
  req: Out<typeof PartitioningRequest>,
): Promise<DdlResponse> {
  const { reader, tr } = ctx
  const sql = getPartitioningQuery(ctx.table, toPartitioningInput(req.partitioning))
  if (req.dryRun) return { messages: [], preview: sql }
  await reader.selectDb(ctx.db)
  const r = await tryQuery(ctx, sql, 'partition.alter')
  reader.invalidate()
  if (r.error !== null) return { messages: [msg('error', `${tr.gettext('Query error')}:\n${r.error}`)] }
  return {
    messages: [
      msg('success', sprintf(tr.gettext('Table %1$s has been altered successfully.'), ctx.table), sql),
    ],
  }
}

/** The "Remove partitioning" button (via /sql) */
export async function removePartitioning(ctx: DdlCtx): Promise<DdlResponse> {
  return runViaSql(ctx, getRemovePartitioningQuery(ctx.table), '')
}

const MAINTENANCE_TITLES: Record<string, string> = {
  ANALYZE: N_('Analyze partition'),
  CHECK: N_('Check partition'),
  OPTIMIZE: N_('Optimize partition'),
  REBUILD: N_('Rebuild partition'),
  REPAIR: N_('Repair partition'),
  TRUNCATE: N_('Truncate partition'),
  DROP: N_('Drop partition'),
}

/** pma: src/Controllers/Table/Partition/*Controller.php + src/Partitioning/Maintenance.php */
export async function partitionMaintenance(
  ctx: DdlCtx,
  req: Out<typeof PartitionMaintenanceRequest>,
): Promise<DdlResponse> {
  const { reader, tr } = ctx
  if (req.partition === '')
    throw new ValidationError(tr.gettext('The partition name must be a non-empty string.'))
  const title = tr.gettext(MAINTENANCE_TITLES[req.operation] ?? '')
  if (req.operation === 'TRUNCATE' && (await reader.isView(ctx.db, ctx.table))) {
    return { messages: [msg('error', tr.gettext('This table is a view, it can not be truncated.'))] }
  }
  const sql = getPartitionMaintenanceQuery(ctx.table, req.operation, req.partition)
  await reader.selectDb(ctx.db)
  if (
    req.operation === 'ANALYZE' ||
    req.operation === 'CHECK' ||
    req.operation === 'OPTIMIZE' ||
    req.operation === 'REPAIR'
  ) {
    // fetchResultSimple: the statement returns Table/Op/Msg_type/Msg_text rows
    const r = await ctx.reader.conn.query(sql, 'partition.maintenance')
    const set = r.resultSets[0]
    const rows = (set?.rows ?? []).map((row) => {
      const o: Record<string, string> = {}
      set?.fields.forEach((f, i) => {
        o[f.name] = row[i]?.toString('utf8') ?? ''
      })
      return { table: o.Table ?? '', op: o.Op ?? '', msgType: o.Msg_type ?? '', msgText: o.Msg_text ?? '' }
    })
    reader.invalidate()
    return {
      messages: [msg('success', tr.gettext('Your SQL query has been executed successfully.'), sql)],
      maintenance: { title, op: req.operation.toLowerCase(), partition: req.partition, rows },
    }
  }
  const r = await tryQuery(ctx, sql, 'partition.maintenance')
  reader.invalidate()
  return {
    messages: [
      r.error === null
        ? msg('success', tr.gettext('Your SQL query has been executed successfully.'), sql)
        : msg('error', tr.gettext('Error'), sql),
    ],
    maintenance: { title, op: req.operation.toLowerCase(), partition: req.partition, rows: [] },
  }
}

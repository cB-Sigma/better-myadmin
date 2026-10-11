/**
 * The Relation view: FOREIGN KEY constraints, internal relations (pma__relation) and the display
 * column (pma__table_info).
 *
 * pma: src/Controllers/Table/RelationController.php, src/Table/Table.php::updateForeignKeys,
 *      ::updateInternalRelations, ::updateDisplayField, ::getUniqueColumns, ::getIndexedColumns,
 *      src/ConfigStorage/Relation.php::getTables, src/Utils/ForeignKey.php::isSupported,
 *      resources/templates/table/relation/common_form.twig, foreign_key_row.twig
 */
import type {
  DropForeignKeyRequest,
  OperationsResponse,
  RelationDropdownResponse,
  RelationPageResponse,
  RelationSaveRequest,
  RelationSaveResponse,
  SqlMessage,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import {
  type ForeignKey,
  getDisplayField,
  getForeignKeysData,
  getForeignersInternal,
  updateDisplayField,
  updateInternalRelations,
} from '@bettermyadmin/metadata'
import {
  FK_ACTIONS,
  backquote,
  fkActionSql,
  getCreateForeignKeyQuery,
  getDropForeignKeyForUpdateQuery,
  getDropForeignKeyQuery,
} from '@bettermyadmin/sql-gen'
import type { z } from 'zod'
import { strnatcasecmp, strnatcmpEx } from '../navigation/php.ts'
import { type OpsCtx, runSqlLink } from './operations.ts'

type Out<T extends z.ZodTypeAny> = z.output<T>

/** pma: ForeignKey::isSupported */
async function fkSupported(ctx: OpsCtx, engine: string): Promise<boolean> {
  const e = engine.toUpperCase()
  if (e === 'INNODB' || e === 'PBXT') return true
  if (e === 'NDBCLUSTER' || e === 'NDB') {
    let v = String((await ctx.reader.dbi.fetchValue('SELECT @@ndb_version_string')) || '').toLowerCase()
    if (v.startsWith('ndb-')) v = v.slice(4)
    const [a = 0, b = 0] = v.split('.').map(Number)
    return a > 7 || (a === 7 && b >= 3)
  }
  return false
}

const q = (ctx: OpsCtx, s: string) => ctx.reader.dbi.quoteString(s)

/** pma: Relation::getTables (same engine) */
async function getTables(ctx: OpsCtx, db: string, engine: string): Promise<string[]> {
  const t = (
    await ctx.reader.dbi.fetchSingleColumn(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ${q(ctx, db)} AND ENGINE = ${q(ctx, engine)}`,
    )
  ).map((x) => x ?? '')
  return ctx.cfg.NaturalOrder ? t.sort(strnatcasecmp) : t
}

/** pma: DatabaseInterface::getTables */
async function allTables(ctx: OpsCtx, db: string): Promise<string[]> {
  return (await ctx.reader.dbi.fetchSingleColumn(`SHOW TABLES FROM ${backquote(db)};`)).map((x) => x ?? '')
}

/** Query\Generator::getTableIndexesSql */
function indexesSql(ctx: OpsCtx, db: string, table: string, where?: string): string {
  return `SHOW INDEXES FROM ${backquote(db)}.${backquote(table)}${where !== undefined ? ` WHERE (${where})` : ''}`
}

/** pma: Table::getUniqueColumns(false, false) */
async function uniqueColumns(ctx: OpsCtx, db: string, table: string): Promise<string[]> {
  const rows = await ctx.reader.dbi.fetchResultSimple(indexesSql(ctx, db, table, 'Non_unique = 0'))
  const byKey = new Map<string, string[]>()
  for (const r of rows)
    byKey.set(r.Key_name ?? '', [...(byKey.get(r.Key_name ?? '') ?? []), r.Column_name ?? ''])
  const out: string[] = []
  for (const cols of byKey.values()) {
    if (cols.length > 1) continue
    const c = cols[0] ?? ''
    if (!out.includes(c)) out.push(c)
  }
  return out
}

/** pma: Relation::getForeignKeysData, natural-sorted by constraint name (NaturalOrder) */
async function foreignKeys(ctx: OpsCtx): Promise<ForeignKey[]> {
  const fks = getForeignKeysData(await ctx.reader.showCreate(ctx.db, ctx.table))
  if (ctx.cfg.NaturalOrder) fks.sort((a, b) => strnatcmpEx(a.constraint ?? '', b.constraint ?? '', false))
  return fks
}

export async function relationPage(ctx: OpsCtx): Promise<RelationPageResponse> {
  const { reader, db, table, cfg, tr } = ctx
  const engine = await reader.getEngine(db, table)
  const supported = await fkSupported(ctx, engine)
  const rp = ctx.meta?.rp ?? null
  const relations =
    rp?.relationFeature !== null && rp !== null
      ? await getForeignersInternal(ctx.meta?.control ?? null, rp, db, table)
      : {}
  const fks = supported ? await foreignKeys(ctx) : []
  await reader.selectDb(db)
  const cols = await reader.getColumns(db, table)
  let columns = ['', ...cols.filter((c) => engine === 'InnoDB' || c.Key !== '').map((c) => c.Field)]
  if (cfg.NaturalOrder) columns = columns.sort(strnatcasecmp)
  // ListDatabase (SCHEMATA, natural order)
  const databases = (
    await reader.dbi.fetchSingleColumn('SELECT `SCHEMA_NAME` FROM `INFORMATION_SCHEMA`.`SCHEMATA`')
  ).map((d) => d ?? '')
  if (cfg.NaturalOrder) databases.sort(strnatcasecmp)
  else databases.sort()
  const foreignKeysOut: RelationPageResponse['foreignKeys'] = []
  for (const k of fks) {
    const refDb = k.refDbName ?? db
    const refTable = refDb !== '' ? (k.refTableName ?? '') : ''
    foreignKeysOut.push({
      constraint: k.constraint,
      indexList: k.indexList,
      refDb,
      refTable,
      refIndexList: k.refIndexList,
      onDelete: k.onDelete ?? 'RESTRICT',
      onUpdate: k.onUpdate ?? 'RESTRICT',
      tables: await getTables(ctx, refDb !== '' ? refDb : db, engine),
      uniqueColumns: refDb !== '' && refTable !== '' ? await uniqueColumns(ctx, refDb, refTable) : [],
    })
  }
  const internal: RelationPageResponse['internal'] = []
  if (rp?.relationFeature !== null && rp !== null) {
    for (const c of cols) {
      const rel = relations[c.Field]
      const foreignDb = rel?.foreign_db ?? db
      const foreignTable = rel?.foreign_table ?? ''
      internal.push({
        field: c.Field,
        foreignDb,
        foreignTable,
        foreignColumn: rel?.foreign_field ?? '',
        tables: foreignDb !== '' ? await allTables(ctx, foreignDb) : [],
        uniqueColumns:
          foreignDb !== '' && foreignTable !== '' ? await uniqueColumns(ctx, foreignDb, foreignTable) : [],
      })
    }
  }
  const displayFeature = rp?.displayFeature !== null && rp !== null
  return {
    engine,
    isForeignKeySupported: supported,
    columns,
    allColumns: cols.map((c) => c.Field),
    databases,
    actions: FK_ACTIONS.map(([value, label]) => ({ value, label })),
    foreignKeys: foreignKeysOut,
    newRowTables: await getTables(ctx, db, engine),
    relationFeature: rp?.relationFeature !== null && rp !== null,
    internal,
    displayFeature,
    displayField:
      displayFeature && rp !== null
        ? await getDisplayField(ctx.meta?.control ?? null, rp, db, table, async () =>
            cols.map((c) => ({ field: c.Field, type: c.Type })),
          )
        : '',
    slidersState: cfg.InitialSlidersState as 'open' | 'closed' | 'disabled',
  }
}

/** pma: RelationController::getDropdownValueForTable / ::getDropdownValueForDatabase */
export async function relationDropdown(
  ctx: OpsCtx,
  p: { foreignDb: string; foreignTable?: string | undefined; foreign: boolean },
): Promise<RelationDropdownResponse> {
  const { reader, cfg } = ctx
  if (p.foreignTable !== undefined) {
    const isView = await reader.isView(p.foreignDb, p.foreignTable)
    let columns: string[]
    if (isView) {
      columns = (await reader.getColumns(p.foreignDb, p.foreignTable)).map((c) => c.Field)
    } else {
      const rows = await reader.dbi.fetchResultSimple(indexesSql(ctx, p.foreignDb, p.foreignTable))
      columns = [...new Set(rows.map((r) => r.Column_name ?? ''))]
    }
    if (cfg.NaturalOrder) columns.sort(strnatcasecmp)
    const primary = (await reader.getIndexes(p.foreignDb, p.foreignTable)).find((i) => i.name === 'PRIMARY')
    return { columns, ...(primary !== undefined ? { primary: primary.columns.map((c) => c.key) } : {}) }
  }
  const engine = await reader.getEngine(ctx.db, ctx.table)
  return { tables: p.foreign ? await getTables(ctx, p.foreignDb, engine) : await allTables(ctx, p.foreignDb) }
}

/** pma: RelationController (POST) */
export async function relationSave(
  ctx: OpsCtx,
  req: Out<typeof RelationSaveRequest>,
): Promise<RelationSaveResponse> {
  const { reader, tr, db, table } = ctx
  const messages: SqlMessage[] = []
  const rp = ctx.meta?.rp ?? null
  const control = ctx.meta?.control ?? null
  const engine = await reader.getEngine(db, table)
  const relations =
    rp?.relationFeature !== null && rp !== null ? await getForeignersInternal(control, rp, db, table) : {}
  const existing = (await fkSupported(ctx, engine)) ? await foreignKeys(ctx) : []
  await reader.selectDb(db)

  // internal relations (written even for Preview SQL, like phpMyAdmin)
  if (req.internal !== undefined && rp !== null && rp.relationFeature !== null && control !== null) {
    const updated = await updateInternalRelations(
      control,
      rp,
      db,
      table,
      req.internal.map((r) => ({
        masterField: r.field,
        foreignDb: r.db,
        foreignTable: r.table,
        foreignField: r.column,
      })),
      relations,
    )
    if (updated)
      messages.push({
        type: 'success',
        text: tr.gettext('Internal relationships were successfully updated.'),
      })
  }

  let preview = ''
  let display = ''
  let seenError = false
  for (const [i, row] of (req.foreignKeys ?? []).entries()) {
    let create = false
    let drop = false
    const ex = existing[i]
    const refDbName = ex?.refDbName ?? db
    // pairs with one side empty mark the row as incomplete; pairs empty on both sides are removed
    let emptyFields = false
    const master: string[] = []
    const foreign: string[] = []
    const n = Math.max(row.columns.length, row.refColumns.length)
    for (let k = 0; k < n; k++) {
      const one = row.columns[k]
      const f = row.refColumns[k]
      if (
        (one !== undefined && one !== '' && (f === undefined || f === '')) ||
        ((one === undefined || one === '') && f !== undefined && f !== '')
      ) {
        emptyFields = true
      }
      if ((one ?? '') === '' && (f ?? '') === '') continue
      if (one !== undefined) master.push(one)
      if (f !== undefined) foreign.push(f)
    }
    const same = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length && a.every((x, j) => x === b[j])
    if (row.refDb !== '' && row.refTable !== '' && !emptyFields) {
      if (ex !== undefined) {
        const onDelete = ex.onDelete !== null && ex.onDelete !== '' ? ex.onDelete : 'RESTRICT'
        const onUpdate = ex.onUpdate !== null && ex.onUpdate !== '' ? ex.onUpdate : 'RESTRICT'
        if (
          refDbName !== row.refDb ||
          ex.refTableName !== row.refTable ||
          !same(ex.refIndexList, foreign) ||
          !same(ex.indexList, master) ||
          row.constraintName !== (ex.constraint ?? '') ||
          row.onDelete !== onDelete ||
          row.onUpdate !== onUpdate
        ) {
          drop = true
          create = true
        }
      } else {
        create = true
      }
    } else if (ex !== undefined) {
      drop = true
    }
    if (drop && ex !== undefined) {
      const dropQuery = getDropForeignKeyForUpdateQuery(table, ex.constraint ?? '')
      if (req.preview) preview += `${dropQuery}\n`
      else {
        display += `${dropQuery}\n`
        const err = await tryRun(ctx, dropQuery)
        if (err !== null) {
          seenError = true
          messages.push({ type: 'error', text: err, sql: dropQuery })
          continue
        }
      }
    }
    if (!create) continue
    const createQuery = getCreateForeignKeyQuery(
      db,
      table,
      master,
      row.refDb,
      row.refTable,
      foreign,
      row.constraintName,
      fkActionSql(row.onDelete),
      fkActionSql(row.onUpdate),
    )
    let createError: string | null = null
    if (req.preview) preview += `${createQuery}\n`
    else {
      display += `${createQuery}\n`
      createError = await tryRun(ctx, createQuery)
      if (createError !== null) {
        seenError = true
        messages.push(
          createError.slice(1, 5) === '1005'
            ? {
                type: 'error',
                text: sprintf(
                  tr.gettext('Error creating foreign key on %1$s (check data types)'),
                  master.join(', '),
                ),
              }
            : { type: 'error', text: createError, sql: createQuery },
        )
      }
    }
    // the old constraint was dropped and the new one failed: restore it
    if (!drop || createError === null || ex === undefined) continue
    const recreate = `# Restoring the dropped constraint...\n${getCreateForeignKeyQuery(
      db,
      table,
      ex.indexList,
      ex.refDbName ?? db,
      ex.refTableName ?? '',
      ex.refIndexList,
      ex.constraint,
      fkActionSql(ex.onDelete ?? ''),
      fkActionSql(ex.onUpdate ?? ''),
    )}`
    display += `${recreate}\n`
    await tryRun(ctx, recreate)
  }
  if (req.preview) return { messages: [], preview }
  if (display !== '' && !seenError) {
    messages.push({
      type: 'success',
      text: tr.gettext('Your SQL query has been executed successfully.'),
      sql: display.trimEnd(),
    })
  }
  if (rp !== null && rp.displayFeature !== null && control !== null && req.displayField !== undefined) {
    await updateDisplayField(control, rp, db, table, req.displayField)
    messages.push({ type: 'success', text: tr.gettext('Display column was successfully updated.') })
  }
  reader.invalidate()
  return { messages }
}

async function tryRun(ctx: OpsCtx, sql: string): Promise<string | null> {
  const r = await ctx.reader.dbi.tryQuery(sql, 'relation.fk')
  return r === null ? ctx.reader.dbi.lastError : null
}

/** The "Drop" link of a constraint row (/sql, fk_checks=0) */
export async function dropForeignKey(
  ctx: OpsCtx,
  req: Out<typeof DropForeignKeyRequest>,
): Promise<OperationsResponse> {
  return runSqlLink(
    ctx,
    getDropForeignKeyQuery(ctx.db, ctx.table, req.constraint),
    sprintf(ctx.tr.gettext('Foreign key constraint %s has been dropped'), req.constraint),
    { fkChecks: false },
  )
}

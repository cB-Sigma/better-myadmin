/**
 * The normalization wizard's server side: the columns and primary key the steps show, the
 * partial dependency finder, and the statements of 1NF (move a repeating group), 2NF and 3NF
 * (split the table). Splitting a column and adding a primary key use the Structure endpoints
 * (add columns, drop a column, the index editor), as normalization.js uses /table/add-field,
 * /sql and the index dialog.
 *
 * pma: src/Normalization.php, src/Controllers/Normalization/**
 */
import type {
  CreateTables2NFRequest,
  CreateTables3NFRequest,
  MoveRepeatingGroupRequest,
  NewTables2NFResponse,
  NewTables3NFResponse,
  Normalization3NFStepResponse,
  NormalizationResult,
  NormalizationTableResponse,
  PartialDependenciesResponse,
  SqlMessage,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { extractColumnSpec, getColumns as getTypeCatalog, typeGroupLabel } from '@bettermyadmin/mysql-types'
import {
  type NewTables3NF,
  backquote,
  get2NFNewTables,
  get2NFQueries,
  get3NFNewTables,
  get3NFQueries,
  getAllCombinationPartialKeys,
  getDistinctValuesCountQuery,
  getMoveRepeatingGroupQueries,
  getPartialDependencyQuery,
  getSampleRowCountQuery,
} from '@bettermyadmin/sql-gen'
import type { z } from 'zod'
import { MysqlError } from '../http/errors.ts'
import type { DdlCtx } from './ddl.ts'

type In<T extends z.ZodTypeAny> = z.output<T>

/** Index::getPrimary(...)->getColumns() names */
async function primaryKey(ctx: DdlCtx, table: string): Promise<string[]> {
  const indexes = await ctx.reader.getIndexes(ctx.db, table)
  return indexes.find((i) => i.choice === 'PRIMARY')?.columns.map((c) => c.name) ?? []
}

/** DatabaseInterface::getColumnNames */
async function columnNames(ctx: DdlCtx, table: string): Promise<string[]> {
  return (await ctx.reader.getColumns(ctx.db, table)).map((c) => c.Field)
}

/** Normalization::getHtmlForColumnsList (data): `$colTypeCategory` all or String */
async function columnsList(ctx: DdlCtx, category: 'all' | 'String') {
  let allowed: string[] | null = null
  if (category !== 'all') {
    // pma: $types->getColumns()[_pgettext('string types', 'String')] (translated keys on both sides)
    const pg = (c: string, m: string) => ctx.tr.pgettext(c, m)
    const key = pg('string types', 'String')
    const group = getTypeCatalog(ctx.reader.server).find(
      (e): e is { group: string; types: string[] } =>
        typeof e === 'object' && e.group === category && typeGroupLabel(e.group, pg) === key,
    )
    allowed = group?.types ?? []
  }
  await ctx.reader.selectDb(ctx.db)
  const out: Array<{ name: string; type: string }> = []
  for (const c of await ctx.reader.getColumns(ctx.db, ctx.table)) {
    if (allowed !== null && !allowed.includes(extractColumnSpec(c.Type).type.toUpperCase())) continue
    out.push({ name: c.Field, type: c.Type })
  }
  return out
}

/** the columns and primary key the 1NF/2NF steps show */
export async function normalizationTable(ctx: DdlCtx): Promise<NormalizationTableResponse> {
  return {
    columns: await columnsList(ctx, 'all'),
    stringColumns: await columnsList(ctx, 'String'),
    primaryKey: await primaryKey(ctx, ctx.table),
  }
}

/** pma: Normalization::getHtmlFor3NFstep1 (data) */
export async function normalization3NFStep(
  ctx: DdlCtx,
  tables: readonly string[],
): Promise<Normalization3NFStepResponse> {
  await ctx.reader.selectDb(ctx.db)
  const out: Normalization3NFStepResponse['tables'] = []
  for (const table of tables) {
    const pk = await primaryKey(ctx, table)
    const columns = await columnNames(ctx, table)
    if (columns.length - pk.length <= 1) continue
    out.push({ table, primaryKey: pk, nonPk: columns.filter((c) => !pk.includes(c)) })
  }
  return { tables: out }
}

/** fetchValue on the user link: the first column of the first row */
async function fetchRow(ctx: DdlCtx, sql: string): Promise<Record<string, string | null> | null> {
  const rows = await ctx.reader.dbi.fetchResultSimple(sql)
  return (rows[0] as Record<string, string | null> | undefined) ?? null
}

/** pma: Normalization::findPartialDependencies */
export async function partialDependencies(ctx: DdlCtx): Promise<PartialDependenciesResponse> {
  const { table } = ctx
  await ctx.reader.selectDb(ctx.db)
  const columns = (await columnNames(ctx, table)).map((c) => backquote(c))
  const totalRow = await fetchRow(ctx, getSampleRowCountQuery(table))
  const totalRows = Number(Object.values(totalRow ?? {})[0] ?? 0)
  const pk = (await primaryKey(ctx, table)).map((c) => backquote(c))
  const partialKeys = getAllCombinationPartialKeys(pk)
  const all = [...new Set([...columns, ...partialKeys])]
  const res = await fetchRow(ctx, getDistinctValuesCountQuery(all, table))
  const distinct = new Map<string, number>()
  for (const c of all) if (c !== '') distinct.set(c, Number(res?.[`${c}_cnt`] ?? 0))
  const list = new Map<string, string[]>()
  for (const column of columns) {
    if (pk.includes(column)) continue
    for (const partialKey of partialKeys) {
      if (partialKey === '') continue
      // Normalization::checkPartialDependency
      const pkCnt = distinct.get(partialKey) ?? 0
      const colCnt = distinct.get(column) ?? 0
      const row = await fetchRow(ctx, getPartialDependencyQuery(partialKey, column, table))
      const pkColCnt = Number(row?.pkColCnt ?? 0)
      const depends =
        (pkCnt !== 0 && pkCnt === colCnt && colCnt === pkColCnt) || (totalRows !== 0 && totalRows === pkCnt)
      if (!depends) continue
      list.set(partialKey, [...(list.get(partialKey) ?? []), column])
    }
  }
  const strip = (s: string) => s.replaceAll('`', '')
  return {
    dependencies: [...list].map(([determinants, cols]) => ({
      determinants: strip(determinants),
      dependents: cols.map(strip),
    })),
  }
}

/** runs the statements in order; the first failure stops ("Error in processing!" + the error) */
async function runAll(
  ctx: DdlCtx,
  queries: readonly string[],
  success: SqlMessage | null,
): Promise<NormalizationResult> {
  await ctx.reader.selectDb(ctx.db)
  for (const q of queries) {
    try {
      await ctx.reader.conn.query(q, 'normalization')
    } catch (e) {
      if (!(e instanceof MysqlError)) throw e
      ctx.reader.invalidate()
      return {
        queryError: true,
        messages: [
          {
            type: 'error',
            text: `${ctx.tr.gettext('Error in processing!')}\n\n#${e.extra.errno ?? 0} - ${e.message}`,
          },
        ],
      }
    }
  }
  ctx.reader.invalidate()
  return { queryError: false, messages: success === null ? [] : [success] }
}

/** pma: Normalization::moveRepeatingGroup (the message names the source table, as upstream) */
export function moveRepeatingGroup(ctx: DdlCtx, req: In<typeof MoveRepeatingGroupRequest>) {
  const queries = getMoveRepeatingGroupQueries(
    req.repeatingColumns,
    req.primaryColumns,
    req.newTable,
    req.newColumn,
    ctx.table,
  )
  return runAll(ctx, queries, {
    type: 'success',
    text: sprintf(ctx.tr.gettext("Selected repeating group has been moved to the table '%s'"), ctx.table),
  })
}

/** pma: Normalization::getHtmlForNewTables2NF (data) */
export function newTables2NF(ctx: DdlCtx, pd: Array<[string, string[]]>): NewTables2NFResponse {
  return { tables: get2NFNewTables(pd, ctx.table) }
}

/** pma: Normalization::createNewTablesFor2NF */
export function createTables2NF(ctx: DdlCtx, req: In<typeof CreateTables2NFRequest>) {
  return runAll(ctx, get2NFQueries(req.pd, req.newTablesName, ctx.table), null)
}

/** pma: Normalization::getHtmlForNewTables3NF (data) */
export async function newTables3NF(
  ctx: DdlCtx,
  pd: Record<string, string[]>,
  tables: Array<[string, string[]]>,
): Promise<NewTables3NFResponse> {
  const pks: Record<string, string[]> = {}
  for (const [table, arr] of tables) if (new Set(arr).size > 1) pks[table] = await primaryKey(ctx, table)
  return { newTables: get3NFNewTables(pd, tables, pks) }
}

/** pma: Normalization::createNewTablesFor3NF */
export async function createTables3NF(ctx: DdlCtx, req: In<typeof CreateTables3NFRequest>) {
  const newTables = req.newTables as NewTables3NF
  if (newTables.length === 0) return { queryError: false, messages: [] }
  await ctx.reader.selectDb(ctx.db)
  // getColumnNames runs while the statements are built (before any of them is executed)
  const columns = new Map<string, string[]>()
  for (const [original, list] of newTables) {
    if (list.some(([name]) => name === original)) columns.set(original, await columnNames(ctx, original))
  }
  return runAll(
    ctx,
    get3NFQueries(newTables, (t) => columns.get(t) ?? []),
    null,
  )
}

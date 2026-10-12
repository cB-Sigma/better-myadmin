import type { MultiTableFormResponse, MultiTableKeysResponse } from '@bettermyadmin/contracts'
import type { DbCtx } from './context.ts'

/**
 * The multi-table query builder's data.
 * pma: src/Controllers/Database/MultiTableQueryController.php, src/Database/MultiTableQuery.php,
 *      src/Controllers/Database/MultiTableQuery/TablesController.php,
 *      Query/Generator::getInformationSchemaForeignKeyConstraintsRequest
 */

/** MultiTableQuery::getColumnsInTables */
export async function multiTableForm(ctx: DbCtx): Promise<MultiTableFormResponse> {
  const rows = await ctx.dbi.fetchResultSimple(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns WHERE table_schema = ${ctx.dbi.quoteString(ctx.db)}`,
  )
  const tables: MultiTableFormResponse['tables'] = []
  for (const r of rows) {
    const name = r.TABLE_NAME ?? ''
    let t = tables.find((x) => x.name === name)
    if (t === undefined) {
      t = { name, columns: [] }
      tables.push(t)
    }
    t.columns.push(r.COLUMN_NAME ?? '')
  }
  return { tables, defaultColumns: 3 }
}

/** TablesController: the foreign keys between the used tables */
export async function multiTableKeys(ctx: DbCtx, tables: string[]): Promise<MultiTableKeysResponse> {
  const list = tables.map((t) => ctx.dbi.quoteString(t)).join(',')
  const rows = await ctx.dbi.fetchResultSimple(
    'SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.key_column_usage' +
      ` WHERE referenced_table_name IS NOT NULL AND TABLE_SCHEMA = ${ctx.dbi.quoteString(ctx.db)}` +
      ` AND TABLE_NAME IN (${list}) AND REFERENCED_TABLE_NAME IN (${list});`,
  )
  return {
    foreignKeyConstrains: rows.map((r) => ({
      TABLE_NAME: r.TABLE_NAME ?? '',
      COLUMN_NAME: r.COLUMN_NAME ?? '',
      REFERENCED_TABLE_NAME: r.REFERENCED_TABLE_NAME ?? '',
      REFERENCED_COLUMN_NAME: r.REFERENCED_COLUMN_NAME ?? '',
    })),
  }
}

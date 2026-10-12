/**
 * Table Structure → "Add to central columns" / "Remove from central columns" (row links and the
 * With-selected buttons) and the central list the page marks, on the pma__central_columns
 * repository (packages/metadata/src/central-columns.ts) shared with Database → Central columns.
 *
 * pma: src/Controllers/Table/Structure/CentralColumnsAddController.php,
 *      src/Controllers/Table/Structure/CentralColumnsRemoveController.php,
 *      src/Controllers/Table/StructureController.php ($centralList),
 *      src/Database/CentralColumns.php::syncUniqueColumns / ::deleteColumnsFromList / ::findExistingColNames
 */
import type { DdlResponse } from '@bettermyadmin/contracts'
import {
  type CentralResult,
  deleteColumnsFromList,
  findExistingColNames,
  syncUniqueColumns,
} from '@bettermyadmin/metadata'
import { centralMessage } from '../database/central-columns.ts'
import type { DdlCtx } from './ddl.ts'

/** CentralColumns::findExistingColNames($db, getColumnNames($db, $table)) */
export async function centralList(ctx: DdlCtx): Promise<string[]> {
  const meta = ctx.meta ?? null
  if (meta === null || meta.rp.centralColumnsFeature === null) return []
  const names = (await ctx.reader.getColumns(ctx.db, ctx.table)).map((c) => c.Field)
  return findExistingColNames(meta.control, meta.rp, ctx.db, names)
}

const noColumn = (ctx: DdlCtx): DdlResponse => ({
  messages: [{ type: 'error', text: ctx.tr.gettext('No column selected.') }],
})

/** Current::$message ?? Message::success() */
const result = (ctx: DdlCtx, r: CentralResult): DdlResponse => ({
  messages: [
    centralMessage(ctx, r) ?? {
      type: 'success',
      text: ctx.tr.gettext('Your SQL query has been executed successfully.'),
    },
  ],
})

/** CentralColumnsAddController: syncUniqueColumns($db, $selected, false, $table) */
export async function centralColumnsAdd(ctx: DdlCtx, columns: string[]): Promise<DdlResponse> {
  if (columns.length === 0) return noColumn(ctx)
  const meta = ctx.meta ?? null
  if (meta === null) return result(ctx, { ok: false, kind: 'storage' })
  const r = await syncUniqueColumns(meta.control, meta.rp, ctx.db, {
    columns,
    // DatabaseInterface::getColumn($db, $table, $column, true)
    getColumn: async (column) => {
      const c = (await ctx.reader.getColumns(ctx.db, ctx.table)).find((x) => x.Field === column)
      return c === undefined
        ? null
        : {
            field: c.Field,
            type: c.Type,
            collation: c.Collation,
            isNull: c.Null === 'YES',
            extra: c.Extra,
            default: c.Default,
          }
    },
  })
  return result(ctx, r)
}

/** CentralColumnsRemoveController: deleteColumnsFromList($db, $selected, false) */
export async function centralColumnsRemove(ctx: DdlCtx, columns: string[]): Promise<DdlResponse> {
  if (columns.length === 0) return noColumn(ctx)
  const meta = ctx.meta ?? null
  if (meta === null) return result(ctx, { ok: false, kind: 'storage' })
  const r = await deleteColumnsFromList(meta.control, meta.rp, ctx.db, { columns })
  return result(ctx, r)
}

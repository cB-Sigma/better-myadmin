import type { DataDictionaryResponse } from '@bettermyadmin/contracts'
import { getDbComment, getForeigners, getMime, searchColumnInForeigners } from '@bettermyadmin/metadata'
import { extractColumnSpec } from '@bettermyadmin/mysql-types'
import { type DbCtx, listTables, selectDb } from './context.ts'
import { getTablesFull } from './tables.ts'

/**
 * The data dictionary (print view of every table).
 * pma: src/Controllers/Database/DataDictionaryController.php, templates/database/data_dictionary/index.twig
 */
export async function dataDictionary(ctx: DbCtx): Promise<DataDictionaryResponse> {
  const { tr, db, rp } = ctx
  const comment = await getDbComment(ctx.control, rp, db)
  await selectDb(ctx, db)
  const names = await listTables(ctx)
  const full = await getTablesFull(ctx, db)
  const tables: DataDictionaryResponse['tables'] = []
  for (const name of names) {
    const indexes = await ctx.reader.getIndexes(db, name)
    const primary = indexes.find((i) => i.name === 'PRIMARY')
    const foreigners =
      rp.relationFeature !== null
        ? await getForeigners(ctx.control, rp, db, name, '', () => ctx.reader.showCreate(db, name))
        : null
    const hasRelation =
      foreigners !== null && (Object.keys(foreigners.data).length > 0 || foreigners.keysData.length > 0)
    const mime =
      rp.browserTransformationFeature !== null ? await getMime(ctx.control, rp, db, name, true) : null
    const columns = (await ctx.reader.getColumns(db, name)).map((c) => {
      const spec = extractColumnSpec(c.Type)
      let relation = ''
      if (foreigners !== null && hasRelation) {
        const f = searchColumnInForeigners(foreigners, c.Field, db)
        if (f !== false && f.foreign_table !== null && f.foreign_field !== undefined) {
          relation = `${f.foreign_table} -> ${f.foreign_field}`
        }
      }
      return {
        name: c.Field,
        isPrimary: primary?.columns.some((x) => x.name === c.Field) ?? false,
        type: spec.type,
        printType: spec.print_type,
        isNullable: c.Null === 'YES',
        default: c.Default,
        comment: c.Comment,
        relation,
        mime: (mime?.[c.Field]?.mimetype ?? '').replaceAll('_', '/'),
      }
    })
    tables.push({
      name,
      comment: full.find((r) => r.TABLE_NAME === name)?.TABLE_COMMENT ?? '',
      hasRelation,
      hasMime: rp.browserTransformationFeature !== null,
      columns,
      indexes: indexes.map((index) => ({
        name: index.name,
        type: index.type !== '' ? index.type : index.choice,
        unique: !index.nonUnique,
        packed: index.packed === null ? tr.gettext('No') : index.packed,
        comments: index.remarks + (index.remarks !== '' ? '\n' : '') + index.comment,
        columns: index.columns.map((c) => ({
          name: c.name,
          subPart: c.subPart,
          cardinality: c.cardinality,
          collation: c.collation,
          null: c.null === '' || c.null === 'NO' ? tr.gettext('No') : tr.gettext('Yes'),
        })),
      })),
    })
  }
  return { db, comment, tables }
}

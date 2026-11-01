import type { ErColumn, ErDiagramResponse, ErRelation, ErTable } from '@bettermyadmin/contracts'
import { type DbInternalRelation, getDbInternalRelations } from '@bettermyadmin/metadata'
import { strnatcasecmp } from '../navigation/php.ts'
import type { DbCtx } from './context.ts'

/**
 * Database → Diagram (BetterMyAdmin-only, X63): the whole database in four information_schema reads
 * (tables, columns, index columns, FOREIGN KEY columns) plus one configuration-storage read for the
 * internal relations, whatever the number of tables. information_schema lists only the tables and
 * columns the user has a privilege on, so the diagram shows exactly what the user can see.
 */

type Row = Record<string, string | null>

/** The rows of the four reads, as {@link erDiagram} fetches them. */
export interface ErSource {
  tables: Row[]
  columns: Row[]
  indexes: Row[]
  foreignKeys: Row[]
  internal: DbInternalRelation[]
  /** `db\0table` of the other databases' tables the user can see that internal relations point to */
  externalVisible: ReadonlySet<string>
}

const key = (...parts: string[]) => parts.join('\u0000')

/** The response from the rows (pure: unit-tested in test/unit/er-diagram.test.ts). */
export function buildErDiagram(db: string, src: ErSource): ErDiagramResponse {
  const tables = new Map<string, ErTable>()
  for (const r of src.tables) {
    const name = r.TABLE_NAME ?? ''
    const type = (r.TABLE_TYPE ?? '').toUpperCase()
    const view = type === 'VIEW' || type === 'SYSTEM VIEW'
    tables.set(name, {
      name,
      view,
      engine: r.ENGINE ?? '',
      comment: view ? '' : (r.TABLE_COMMENT ?? ''),
      columns: [],
    })
  }

  // index columns: PRIMARY → pk; a single-column UNIQUE index → unique
  const indexCols = new Map<string, { table: string; unique: boolean; primary: boolean; cols: string[] }>()
  for (const r of src.indexes) {
    const table = r.TABLE_NAME ?? ''
    const index = r.INDEX_NAME ?? ''
    const k = key(table, index)
    let ix = indexCols.get(k)
    if (ix === undefined) {
      ix = { table, unique: r.NON_UNIQUE === '0', primary: index === 'PRIMARY', cols: [] }
      indexCols.set(k, ix)
    }
    ix.cols.push(r.COLUMN_NAME ?? '')
  }
  const pk = new Set<string>()
  const unique = new Set<string>()
  for (const ix of indexCols.values()) {
    if (ix.primary) for (const c of ix.cols) pk.add(key(ix.table, c))
    else if (ix.unique && ix.cols.length === 1) unique.add(key(ix.table, ix.cols[0] ?? ''))
  }

  const columnsOf = new Map<string, Set<string>>()
  for (const r of src.columns) {
    const table = tables.get(r.TABLE_NAME ?? '')
    if (table === undefined) continue
    const name = r.COLUMN_NAME ?? ''
    const col: ErColumn = {
      name,
      type: r.COLUMN_TYPE ?? '',
      nullable: r.IS_NULLABLE === 'YES',
      pk: pk.has(key(table.name, name)),
      unique: unique.has(key(table.name, name)),
    }
    table.columns.push(col)
    const set = columnsOf.get(table.name) ?? new Set<string>()
    columnsOf.set(table.name, set)
    set.add(name)
  }

  // FOREIGN KEY columns grouped by constraint, in ORDINAL_POSITION order
  const relations: ErRelation[] = []
  const fks = new Map<string, ErRelation>()
  const fkPairs = new Set<string>()
  for (const r of src.foreignKeys) {
    const table = r.TABLE_NAME ?? ''
    if (!tables.has(table)) continue
    const name = r.CONSTRAINT_NAME ?? ''
    const k = key(table, name)
    let rel = fks.get(k)
    if (rel === undefined) {
      rel = {
        kind: 'fk',
        name,
        table,
        columns: [],
        refDb: r.REFERENCED_TABLE_SCHEMA ?? db,
        refTable: r.REFERENCED_TABLE_NAME ?? '',
        refColumns: [],
      }
      fks.set(k, rel)
      relations.push(rel)
    }
    const col = r.COLUMN_NAME ?? ''
    const refCol = r.REFERENCED_COLUMN_NAME ?? ''
    rel.columns.push(col)
    rel.refColumns.push(refCol)
    fkPairs.add(key(table, col, rel.refDb, rel.refTable, refCol))
  }

  // internal relations whose ends the user can see, unless a FOREIGN KEY already draws them
  for (const r of src.internal) {
    if (!(columnsOf.get(r.master_table)?.has(r.master_field) ?? false)) continue
    const refDb = r.foreign_db !== '' ? r.foreign_db : db
    if (refDb === db) {
      if (!(columnsOf.get(r.foreign_table)?.has(r.foreign_field) ?? false)) continue
    } else if (!src.externalVisible.has(key(refDb, r.foreign_table))) continue
    if (fkPairs.has(key(r.master_table, r.master_field, refDb, r.foreign_table, r.foreign_field))) continue
    relations.push({
      kind: 'internal',
      name: '',
      table: r.master_table,
      columns: [r.master_field],
      refDb,
      refTable: r.foreign_table,
      refColumns: [r.foreign_field],
    })
  }

  return {
    db,
    tables: [...tables.values()].sort((a, b) => strnatcasecmp(a.name, b.name)),
    relations,
  }
}

/** GET …/databases/:db/er-diagram */
export async function erDiagram(ctx: DbCtx): Promise<ErDiagramResponse> {
  const { db } = ctx
  const collate = await ctx.dbi.collateForIS()
  const where = `\`TABLE_SCHEMA\` ${collate} = ${ctx.dbi.quoteString(db)}`
  const tables = await ctx.conn.rows(
    `SELECT \`TABLE_NAME\`, \`TABLE_TYPE\`, \`ENGINE\`, \`TABLE_COMMENT\` FROM \`information_schema\`.\`TABLES\` WHERE ${where}`,
    'erDiagram.tables',
  )
  const columns = await ctx.conn.rows(
    `SELECT \`TABLE_NAME\`, \`COLUMN_NAME\`, \`COLUMN_TYPE\`, \`IS_NULLABLE\` FROM \`information_schema\`.\`COLUMNS\` WHERE ${where} ORDER BY \`TABLE_NAME\`, \`ORDINAL_POSITION\``,
    'erDiagram.columns',
  )
  const indexes = await ctx.conn.rows(
    `SELECT \`TABLE_NAME\`, \`INDEX_NAME\`, \`NON_UNIQUE\`, \`COLUMN_NAME\` FROM \`information_schema\`.\`STATISTICS\` WHERE ${where} ORDER BY \`TABLE_NAME\`, \`INDEX_NAME\`, \`SEQ_IN_INDEX\``,
    'erDiagram.indexes',
  )
  const foreignKeys = await ctx.conn.rows(
    `SELECT \`TABLE_NAME\`, \`CONSTRAINT_NAME\`, \`COLUMN_NAME\`, \`REFERENCED_TABLE_SCHEMA\`, \`REFERENCED_TABLE_NAME\`, \`REFERENCED_COLUMN_NAME\` FROM \`information_schema\`.\`KEY_COLUMN_USAGE\` WHERE ${where} AND \`REFERENCED_TABLE_NAME\` IS NOT NULL ORDER BY \`TABLE_NAME\`, \`CONSTRAINT_NAME\`, \`ORDINAL_POSITION\``,
    'erDiagram.foreignKeys',
  )
  const internal = await getDbInternalRelations(ctx.control, ctx.rp, db)
  // other databases' tables of internal relations: shown only when the user can see them
  const external = [
    ...new Map(
      internal
        .filter((r) => r.foreign_db !== '' && r.foreign_db !== db)
        .map((r) => [key(r.foreign_db, r.foreign_table), r]),
    ).values(),
  ]
  const externalVisible = new Set<string>()
  if (external.length > 0) {
    const q = (s: string) => ctx.dbi.quoteString(s)
    const pairs = external.map((r) => `(${q(r.foreign_db)}, ${q(r.foreign_table)})`).join(', ')
    const rows = await ctx.conn.rows(
      `SELECT \`TABLE_SCHEMA\`, \`TABLE_NAME\` FROM \`information_schema\`.\`TABLES\` WHERE (\`TABLE_SCHEMA\`, \`TABLE_NAME\`) IN (${pairs})`,
      'erDiagram.externalTables',
    )
    for (const r of rows) externalVisible.add(key(r.TABLE_SCHEMA ?? '', r.TABLE_NAME ?? ''))
  }
  return buildErDiagram(db, { tables, columns, indexes, foreignKeys, internal, externalVisible })
}

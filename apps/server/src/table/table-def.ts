/**
 * The table definition the SQL export plugin produces for a table copy / cross-database move:
 * the CREATE statement without constraints, indexes and AUTO_INCREMENT, plus the three ALTER
 * statements that add them back.
 *
 * pma: src/Plugins/Export/ExportSql.php::getTableDef (useSqlBackquotes, no comments/dates,
 *      compatibility NONE, no IF NOT EXISTS, $updateIndexesIncrements = true)
 */
import { backquote } from '@bettermyadmin/sql-gen'
import {
  type Context,
  type CreateDefinition,
  CreateStatement,
  Context as Ctx,
  type OptionsArray,
  Parser,
} from '@bettermyadmin/sql-lexer'
import type { TableReader } from './read.ts'

export interface TableDef {
  /** CREATE statement (no trailing semicolon: getTableDef(…, $addSemicolon = false)) */
  create: string
  /** `ALTER TABLE t\n  ADD CONSTRAINT …;\n` ('' when none) */
  constraints: string
  /** index ALTERs (null when none) */
  indexes: string | null
  /** AUTO_INCREMENT MODIFY (null when none) */
  autoIncrements: string | null
}

export async function getTableDef(
  reader: TableReader,
  db: string,
  table: string,
  isView: boolean,
  autoIncrement: boolean,
): Promise<TableDef> {
  const context: Context | undefined = reader.conn.serverInfo?.context
  // Whether to quote table and column names or not
  await reader.conn.query('SET SQL_QUOTE_SHOW_CREATE = 1', 'export.quote')
  await reader.dbi.tryQuery(`USE ${backquote(db)}`, 'export.use')
  const r = await reader.dbi.tryQuery(
    `SHOW CREATE TABLE ${backquote(db)}.${backquote(table)}`,
    'export.create',
  )
  if (r === null) throw new Error(`Error reading structure for table ${db}.${table}: ${reader.dbi.lastError}`)
  let createQuery = r.rows[0]?.[1] ?? ''
  const out: TableDef = { create: '', constraints: '', indexes: null, autoIncrements: null }
  if (createQuery === '') return out

  if (createQuery.includes('(\r\n ')) createQuery = createQuery.replaceAll('\r\n', '\n')
  else if (createQuery.includes('(\r ')) createQuery = createQuery.replaceAll('\r', '\n')

  return Ctx.run(context, () => {
    if (isView) {
      // Drop database name from VIEW creation
      createQuery = createQuery.replaceAll(`${backquote(db)}.`, '')
      const st = new Parser(createQuery).statements[0]
      if (st instanceof CreateStatement) createQuery = st.build()
    }
    const parser = new Parser(createQuery)
    const statement = parser.statements[0]
    if (!(statement instanceof CreateStatement)) {
      out.create = createQuery
      return out
    }
    const entity = statement.entityOptions as OptionsArray | null
    const engine =
      entity !== null && typeof entity === 'object' && 'get' in entity ? entity.get('ENGINE') : ''
    const fields = statement.fields
    if (
      Array.isArray(fields) &&
      fields.length > 0 &&
      (engine === '' || String(engine).toUpperCase() !== 'ARCHIVE')
    ) {
      const constraints: string[] = []
      const indexes: string[] = []
      const fulltext: string[] = []
      const autoInc: string[] = []
      const keep: CreateDefinition[] = []
      for (const field of fields as CreateDefinition[]) {
        let removed = false
        if (field.isConstraint) {
          constraints.push(field.build())
          removed = true
        } else if (field.key !== null) {
          if (field.key.type === 'FULLTEXT KEY') fulltext.push(field.build())
          else indexes.push(field.build().replaceAll("COMMENT='", "COMMENT '"))
          removed = true
        }
        if (field.key !== null && field.key.type === 'FOREIGN KEY' && field.name !== null) removed = true
        if (field.options?.has('AUTO_INCREMENT')) {
          autoInc.push(field.build())
          field.options.remove('AUTO_INCREMENT')
        }
        if (!removed) keep.push(field)
      }
      statement.fields = keep
      const alterHeader = `ALTER TABLE ${backquote(table)}`
      const alterFooter = ';\n'
      if (constraints.length > 0) {
        out.constraints = `${alterHeader}\n  ADD ${constraints.join(',\n  ADD ')}${alterFooter}`
      }
      let indexesQuery = ''
      if (indexes.length > 0)
        indexesQuery += `${alterHeader}\n  ADD ${indexes.join(',\n  ADD ')}${alterFooter}`
      if (fulltext.length > 0) {
        indexesQuery += `${alterHeader} ADD ${fulltext.join(`${alterFooter}${alterHeader} ADD `)}${alterFooter}`
      }
      if (indexesQuery !== '') out.indexes = indexesQuery
      if (autoInc.length > 0) {
        let q = `${alterHeader}\n  MODIFY ${autoInc.join(',\n  MODIFY ')}`
        if (autoIncrement && entity?.has('AUTO_INCREMENT') === true) {
          q += `, AUTO_INCREMENT=${String(entity.get('AUTO_INCREMENT'))}`
        }
        out.autoIncrements = `${q};\n`
      }
      entity?.remove('AUTO_INCREMENT')
      createQuery = statement.build()
    }
    out.create = createQuery
    return out
  })
}

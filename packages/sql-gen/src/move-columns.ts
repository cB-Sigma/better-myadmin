/**
 * The "Move columns" dialog: re-states every moved column with its full definition from
 * SHOW CREATE TABLE and FIRST/AFTER, simulating the moves in order.
 *
 * pma: src/Controllers/Table/Structure/MoveColumnsController.php::generateAlterTableSql
 */

import { Context, type CreateDefinition, CreateStatement, Parser } from '@bettermyadmin/sql-lexer'
import { backquote } from './quote.ts'

export type MoveColumnsResult =
  | { sql: string; error: null }
  /** msgid of the error message (untranslated) */
  | { sql: null; error: string }

/**
 * @param createTableSql the second column of `SHOW CREATE TABLE`
 * @param moveColumns the column names in their new order (`move_columns[]`)
 * @param context the parser context of the connection (keywords and sql_mode, for quoting)
 */
export function getMoveColumnsQuery(
  createTableSql: string,
  moveColumns: readonly string[],
  context?: Context,
): MoveColumnsResult {
  const parser = new Parser(createTableSql, context !== undefined ? { context } : {})
  const statement = parser.statements[0]
  if (!(statement instanceof CreateStatement)) {
    throw new TypeError('SHOW CREATE TABLE did not return a CREATE TABLE statement')
  }
  const fields = (Array.isArray(statement.fields) ? statement.fields : []) as CreateDefinition[]
  const columns = new Map<string, CreateDefinition>()
  const columnNames: string[] = []
  for (const field of fields) {
    if (field.name === null || field.isConstraint === true || field.key !== null) continue
    const name = String(field.name)
    columns.set(name, field)
    columnNames.push(name)
  }

  // ensure the columns from the client match the columns of the table
  const moveSet = new Set(moveColumns)
  if (columnNames.length !== moveColumns.length || columnNames.some((c) => !moveSet.has(c))) {
    return { sql: null, error: 'The selected columns do not match the columns in the table.' }
  }

  const build = (def: CreateDefinition): string =>
    context === undefined ? def.build() : Context.run(context, () => def.build())

  const changes: string[] = []
  moveColumns.forEach((columnName, i) => {
    // is this column already correctly placed?
    if (columnNames[i] === columnName) return
    const def = columns.get(columnName) as CreateDefinition
    changes.push(
      `CHANGE ${backquote(columnName)} ${build(def)}${i === 0 ? ' FIRST' : ` AFTER ${backquote(columnNames[i - 1] ?? '')}`}`,
    )
    // move the column to its new position
    const j = columnNames.indexOf(columnName)
    columnNames.splice(j, 1)
    columnNames.splice(i, 0, columnName)
  })

  if (changes.length === 0) {
    return { sql: null, error: 'The selected columns are already in the correct order.' }
  }
  const table = statement.name?.table ?? ''
  return { sql: `ALTER TABLE ${backquote(table)}\n  ${changes.join(',\n  ')}`, error: null }
}

import type { AutocompleteResponse } from '@bettermyadmin/contracts'
import { quoteString } from '@bettermyadmin/sql-gen'
import type { Conn } from '../db/connection.ts'

/**
 * The lookups of the SQL tab's form and autocompletion (routes/sql.ts stays free of SQL text).
 * pma: src/Controllers/Table/SqlController.php, src/SqlQueryForm.php, src/Database/Autocomplete…
 */

/** SqlQueryForm::getHtml autocompletion: every column of `db`, `| Primary` / `| Unique` hinted. */
export async function autocompleteTables(conn: Conn, db: string): Promise<AutocompleteResponse['tables']> {
  const tables: AutocompleteResponse['tables'] = {}
  const rows = await conn.rows(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY FROM information_schema.columns WHERE table_schema = ${quoteString(db)}`,
    'sql.autocomplete',
  )
  for (const r of rows) {
    const key = r.COLUMN_KEY === 'PRI' ? ' | Primary' : r.COLUMN_KEY === 'UNI' ? ' | Unique' : ''
    const name = r.TABLE_NAME ?? ''
    tables[name] ??= []
    tables[name].push({ field: r.COLUMN_NAME ?? '', columnHint: (r.COLUMN_TYPE ?? '') + key })
  }
  return tables
}

/** DbTableExists::selectDatabase */
export async function databaseExists(conn: Conn, db: string): Promise<boolean> {
  const v = await conn.value(
    `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${quoteString(db)}`,
    'sql.form.db-exists',
  )
  return v !== null
}

/** DbTableExists::hasTable */
export async function tableExists(conn: Conn, db: string, table: string): Promise<boolean> {
  const v = await conn.value(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quoteString(db)} AND TABLE_NAME = ${quoteString(table)}`,
    'sql.form.table-exists',
  )
  return v !== null
}

/** DatabaseInterface::getColumnNames + comments, matched with lower_case_table_names' collation. */
export async function tableColumnComments(
  conn: Conn,
  db: string,
  table: string,
): Promise<Array<{ field: string; comment: string }>> {
  const lower = Number((await conn.value('SELECT @@lower_case_table_names', 'sql.form.lctn')) ?? 0)
  const collate = lower === 0 ? 'COLLATE utf8_bin' : lower === 2 ? 'COLLATE utf8_general_ci' : ''
  const rows = await conn.rows(
    `SELECT \`COLUMN_NAME\` AS \`Field\`, \`COLUMN_COMMENT\` AS \`Comment\` FROM \`information_schema\`.\`COLUMNS\` WHERE \`TABLE_SCHEMA\` ${collate} = ${quoteString(db)} AND \`TABLE_NAME\` ${collate} = ${quoteString(table)} ORDER BY \`ORDINAL_POSITION\``,
    'sql.form.columns',
  )
  return rows.map((r) => ({ field: r.Field ?? '', comment: r.Comment ?? '' }))
}

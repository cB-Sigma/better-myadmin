/**
 * The SQL of the multi-table query builder ("Update query"), a port of phpMyAdmin's generator.
 * pma: resources/js/database/query_generator.ts, resources/js/database/multi_table_query.ts
 *      (#update_query_button), resources/js/modules/functions/escape.ts
 */

export interface ForeignKey {
  TABLE_NAME: string
  COLUMN_NAME: string
  REFERENCED_TABLE_NAME: string
  REFERENCED_COLUMN_NAME: string
}

export interface QueryColumn {
  table: string
  column: string
  tableAlias: string
  columnAlias: string
  show: boolean
  /** "Use this column in criteria" */
  useCriteria: boolean
  criteria: {
    /** AND / OR (logical_op) */
    logicalOp: string
    /** the criteria column (opColumn) */
    column: string
    op: string
    rhs: 'text' | 'anotherColumn'
    text: string
    /** IN (...) values / BETWEEN bounds */
    values: string[]
    rhsTable: string
    rhsColumn: string
  }
}

export const OPERATORS = [
  '=',
  '>',
  '>=',
  '<',
  '<=',
  '!=',
  'LIKE',
  'LIKE %...%',
  'NOT LIKE',
  'NOT LIKE %...%',
  'IN (...)',
  'NOT IN (...)',
  'BETWEEN',
  'NOT BETWEEN',
  'IS NULL',
  'IS NOT NULL',
  'REGEXP',
  'REGEXP ^...$',
  'NOT REGEXP',
]

const FORMATS: Record<string, string> = {
  '=': " = '%s'",
  '>': " > '%s'",
  '>=': " >= '%s'",
  '<': " < '%s'",
  '<=': " <= '%s'",
  '!=': " != '%s'",
  LIKE: " LIKE '%s'",
  'LIKE %...%': " LIKE '%%%s%%'",
  'NOT LIKE': " NOT LIKE '%s'",
  'NOT LIKE %...%': " NOT LIKE '%%%s%%'",
  'IN (...)': ' IN (%s)',
  'NOT IN (...)': ' NOT IN (%s)',
  BETWEEN: " BETWEEN '%s' AND '%s'",
  'NOT BETWEEN': " NOT BETWEEN '%s' AND '%s'",
  REGEXP: " REGEXP '%s'",
  'REGEXP ^...$': " REGEXP '^%s$'",
  'NOT REGEXP': " NOT REGEXP '%s'",
}

export const isOpWithoutArg = (op: string) => op === 'IS NULL' || op === 'IS NOT NULL'
export const acceptsMultipleValues = (op: string) => op === 'IN (...)' || op === 'NOT IN (...)'
export const acceptsTwoValues = (op: string) => op === 'BETWEEN' || op === 'NOT BETWEEN'

export const escapeBacktick = (s: string) => s.replaceAll('`', '``')
export const escapeSingleQuote = (s: string) => s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")

/** locutus sprintf for the `%s` / `%%` formats above */
function sprintf(format: string, ...args: string[]): string {
  let i = 0
  return format.replace(/%%|%s/g, (m) => (m === '%%' ? '%' : (args[i++] ?? '')))
}

const bq = (s: string) => `\`${escapeBacktick(s)}\``

function generateCondition(c: QueryColumn): string {
  const k = c.criteria
  let query = `${bq(c.tableAlias === '' ? c.table : c.tableAlias)}.${bq(k.column)}`
  if (k.rhs === 'text') {
    if (isOpWithoutArg(k.op)) query += ` ${k.op}`
    else if (acceptsMultipleValues(k.op)) {
      const values: string[] = []
      for (const v of k.values) {
        const e = escapeSingleQuote(v)
        if (!values.includes(e)) values.push(e)
      }
      query += sprintf(FORMATS[k.op] ?? '', values.map((v) => `'${v}'`).join(','))
    } else if (acceptsTwoValues(k.op)) {
      query += sprintf(FORMATS[k.op] ?? '', k.values[0] ?? '', k.values[1] ?? '')
    } else {
      query += sprintf(FORMATS[k.op] ?? '', k.text)
    }
  } else {
    query += ` ${k.op} ${bq(k.rhsTable)}.${bq(k.rhsColumn)}`
  }
  return query
}

/** query_generator.ts::generateWhereBlock */
function generateWhereBlock(columns: QueryColumn[]): string {
  let count = 0
  let query = ''
  for (const c of columns) {
    if (c.table === '' || !c.useCriteria) continue
    if (count > 0) query += ` ${c.criteria.logicalOp} `
    query += generateCondition(c)
    count++
  }
  return query
}

function generateJoin(newTable: string, aliases: Map<string, string[]>, fk: ForeignKey): string {
  let query = ` \n\tLEFT JOIN ${bq(newTable)}`
  // phpMyAdmin tests the alias of fk.TABLE_NAME before writing `AS <alias of newTable>`
  if ((aliases.get(fk.TABLE_NAME)?.[0] ?? '') !== '') {
    query += ` AS ${bq(aliases.get(newTable)?.[0] ?? '')}`
    query += ` ON ${bq(aliases.get(fk.TABLE_NAME)?.[0] ?? '')}`
  } else {
    query += ` ON ${bq(fk.TABLE_NAME)}`
  }
  query += `.\`${fk.COLUMN_NAME}\``
  const refAlias = aliases.get(fk.REFERENCED_TABLE_NAME)?.[0] ?? ''
  query += refAlias !== '' ? ` = ${bq(refAlias)}` : ` = ${bq(fk.REFERENCED_TABLE_NAME)}`
  query += `.\`${fk.REFERENCED_COLUMN_NAME}\``
  return query
}

function generateFromBlock(aliases: Map<string, string[]>, fks: ForeignKey[]): string {
  const used: string[] = []
  let query = ''
  for (const table of aliases.keys()) {
    const fk = fks.find(
      (f) =>
        (f.TABLE_NAME === table && used.includes(f.REFERENCED_TABLE_NAME)) ||
        (f.REFERENCED_TABLE_NAME === table && used.includes(f.TABLE_NAME)),
    )
    if (fk !== undefined) query += generateJoin(table, aliases, fk)
    else {
      if (used.length > 0) query += '\n\t, '
      query += bq(table)
      const a = aliases.get(table)?.[0] ?? ''
      if (a !== '') query += ` AS ${bq(a)}`
    }
    used.push(table)
  }
  return query
}

/** The tables the query uses, with their aliases in the order they were met. */
export function tableAliases(columns: QueryColumn[]): Map<string, string[]> {
  const aliases = new Map<string, string[]>()
  for (const c of columns) {
    if (c.table === '' || !c.show) continue
    const list = aliases.get(c.table)
    if (list === undefined) aliases.set(c.table, [c.tableAlias])
    else if (!list.includes(c.tableAlias)) list.push(c.tableAlias)
  }
  return aliases
}

/** #update_query_button: null when nothing is selected ("Nothing selected") */
export function generateQuery(columns: QueryColumn[], fks: ForeignKey[]): string | null {
  const shown = columns.filter((c) => c.table !== '' && c.show)
  const aliases = tableAliases(columns)
  if (aliases.size === 0) return null
  const col = (c: QueryColumn) =>
    `${bq(c.tableAlias !== '' ? c.tableAlias : c.table)}.${c.column === '*' ? '*' : bq(c.column)}${c.columnAlias !== '' ? ` AS ${bq(c.columnAlias)}` : ''}`
  let query = `SELECT ${shown.map(col).join(', ')}`
  query += '\nFROM '
  query += generateFromBlock(aliases, fks)
  if (columns.some((c) => c.useCriteria)) {
    query += '\nWHERE '
    query += generateWhereBlock(columns)
  }
  return `${query};`
}

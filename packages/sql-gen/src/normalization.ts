/**
 * The statements of the normalization wizard: move a repeating group (1NF), split a table on its
 * partial (2NF) and transitive (3NF) dependencies, and the probes of the partial dependency
 * finder. Inputs are the wizard's own strings (comma lists, `a, b` determinants), as phpMyAdmin
 * receives them from normalization.js.
 *
 * pma: src/Normalization.php (moveRepeatingGroup, createNewTablesFor2NF, getHtmlForNewTables3NF,
 *      createNewTablesFor3NF, findPartialDependencies, checkPartialDependency,
 *      findDistinctValuesCount, getAllCombinationPartialKeys)
 */
import { backquote } from './quote.ts'

/** PHP trim($s, $chars) */
function trimChars(s: string, chars: string): string {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a] as string)) a++
  while (b > a && chars.includes(s[b - 1] as string)) b--
  return s.slice(a, b)
}

/** pma: Normalization::moveRepeatingGroup — `CREATE TABLE … SELECT … UNION …` and the DROPs */
export function getMoveRepeatingGroupQueries(
  repeatingColumns: string,
  primaryColumns: string,
  newTable: string,
  newColumn: string,
  table: string,
): [string, string] {
  const pk = primaryColumns
    .split(',')
    .map((c) => backquote(c))
    .join(',')
  let q1 = `CREATE TABLE ${backquote(newTable)}`
  let q2 = `ALTER TABLE ${backquote(table)}`
  let first = true
  for (const col of repeatingColumns.split(', ')) {
    if (!first) q1 += ' UNION '
    first = false
    q1 += ` SELECT ${pk},${backquote(col)} as ${backquote(newColumn)} FROM ${backquote(table)}`
    q2 += ` DROP ${backquote(col)},`
  }
  return [q1, trimChars(q2, ',')]
}

/** One determinant (`a, b`) and the columns it determines, in the wizard's order. */
export type Dependencies = Array<[determinant: string, dependents: string[]]>

/**
 * pma: Normalization::createNewTablesFor2NF — empty when only the primary key group exists.
 * `names` maps each determinant to the table name typed for it (loose `!=` against `table`).
 */
export function get2NFQueries(pd: Dependencies, names: Record<string, string>, table: string): string[] {
  if (pd.length === 1) return []
  const queries: string[] = []
  let dropCols = false
  const nonPk: string[] = []
  for (const [key, dependents] of pd) {
    const name = names[key] ?? ''
    if (name !== table) {
      const k = key
        .split(', ')
        .map((x) => backquote(x))
        .join(', ')
      queries.push(
        `CREATE TABLE ${backquote(name)} SELECT DISTINCT ${k}${dependents.length > 0 ? ', ' : ''}${dependents.map((d) => backquote(d)).join(',')} FROM ${backquote(table)};`,
      )
      queries.push(`ALTER TABLE ${backquote(name)} ADD PRIMARY KEY(${k});`)
      nonPk.push(...dependents)
    } else {
      dropCols = true
    }
  }
  if (dropCols) {
    let q = `ALTER TABLE ${backquote(table)}`
    for (const c of nonPk) q += ` DROP ${backquote(c)},`
    queries.push(`${trimChars(q, ', ')};`)
  } else {
    queries.push(`DROP TABLE ${backquote(table)}`)
  }
  return queries
}

/** The tables proposed for 2NF: the first keeps the table's name, then table2, table3… */
export function get2NFNewTables(
  pd: Dependencies,
  table: string,
): Array<{ key: string; dependents: string[]; name: string }> {
  let name = table
  let i = 1
  return pd.map(([key, dependents]) => {
    const out = { key, dependents, name }
    i++
    name = `table${i}`
    return out
  })
}

export interface NewTable3NF {
  /** the determinant, or the primary key list for the table's own group */
  pk: string
  nonpk: string
}

/** newTables[originalTable][newTable] = {pk, nonpk}, in insertion order */
export type NewTables3NF = Array<[original: string, tables: Array<[name: string, cols: NewTable3NF]>]>

/**
 * pma: Normalization::getHtmlForNewTables3NF (the data part). `tables` is normalization.js'
 * tablesTds (each table's list starts with the table itself, with repeats); `pd` maps each
 * determinant to its dependents; `primaryKeys` the PRIMARY KEY columns of each table.
 */
export function get3NFNewTables(
  pd: Record<string, string[]>,
  tables: Array<[table: string, dependsOn: string[]]>,
  primaryKeys: Record<string, string[]>,
): NewTables3NF {
  return get3NFProposals(pd, tables, primaryKeys).newTables
}

/**
 * Both parts of getHtmlForNewTables3NF: `rows`, every `<p><input name=…>( pk, nonpk )` the HTML
 * shows (a repeated name, e.g. `table2` for the table and its first new table, shows twice), and
 * `newTables`, the JSON where a repeated name overwrites the earlier entry.
 */
export function get3NFProposals(
  pd: Record<string, string[]>,
  tables: Array<[table: string, dependsOn: string[]]>,
  primaryKeys: Record<string, string[]>,
): { newTables: NewTables3NF; rows: NewTables3NF } {
  const out: NewTables3NF = []
  const rows: NewTables3NF = []
  let i = 1
  for (const [table, arr] of tables) {
    if (new Set(arr).size === 1) continue
    const pk = primaryKeys[table] ?? []
    let tableName = table
    const columnList: string[] = []
    const list: Array<[string, NewTable3NF]> = []
    const shown: Array<[string, NewTable3NF]> = []
    for (const k of arr) {
      const dependents = pd[k] ?? []
      const key = k === table ? pk.join(', ') : k
      // PHP sort() of strings, then in_array on the sorted lists
      const cols = [...key.split(', '), ...dependents].sort()
      const sig = JSON.stringify(cols)
      if (columnList.includes(sig)) continue
      columnList.push(sig)
      // a repeated name overwrites the entry, as the PHP array assignment does
      const existing = list.findIndex(([n]) => n === tableName)
      const entry: [string, NewTable3NF] = [tableName, { pk: key, nonpk: dependents.join(', ') }]
      shown.push(entry)
      if (existing >= 0) list[existing] = entry
      else list.push(entry)
      i++
      tableName = `table${i}`
    }
    out.push([table, list])
    rows.push([table, shown])
  }
  return { newTables: out, rows }
}

/**
 * pma: Normalization::createNewTablesFor3NF — `columnsOf` gives the current column names of an
 * original table (DatabaseInterface::getColumnNames, read when its statement is built).
 */
export function get3NFQueries(newTables: NewTables3NF, columnsOf: (table: string) => string[]): string[] {
  const queries: string[] = []
  for (const [original, list] of newTables) {
    let dropCols: NewTable3NF | null = null
    for (const [name, cols] of list) {
      if (name !== original) {
        const pk = cols.pk
          .split(', ')
          .map((x) => backquote(x))
          .join(', ')
        const nonpk = cols.nonpk
          .split(', ')
          .map((x) => backquote(x))
          .join(', ')
        queries.push(
          `CREATE TABLE ${backquote(name)} SELECT DISTINCT ${pk}, ${nonpk} FROM ${backquote(original)};`,
        )
        queries.push(`ALTER TABLE ${backquote(name)} ADD PRIMARY KEY(${pk});`)
      } else {
        dropCols = cols
      }
    }
    if (dropCols !== null) {
      const present = [...dropCols.pk.split(', '), ...dropCols.nonpk.split(', ')]
      let q = `ALTER TABLE ${backquote(original)}`
      for (const c of columnsOf(original)) if (!present.includes(c)) q += ` DROP ${backquote(c)},`
      queries.push(`${trimChars(q, ', ')};`)
    } else {
      queries.push(`DROP TABLE ${backquote(original)}`)
    }
  }
  return queries
}

/** pma: Normalization::getAllCombinationPartialKeys (backquoted columns; the full key removed) */
export function getAllCombinationPartialKeys(primaryKey: readonly string[]): string[] {
  const results = ['']
  for (const element of primaryKey) {
    for (const combination of [...results]) results.push(trimChars(`${element},${combination}`, ','))
  }
  results.pop()
  return results
}

/** pma: Normalization::findDistinctValuesCount — one row, `<col>_cnt` per column */
export function getDistinctValuesCountQuery(columns: readonly string[], table: string): string {
  let q = 'SELECT '
  for (const c of columns) {
    if (c === '') continue
    q += `COUNT(DISTINCT ${c}) as '${c}_cnt', `
  }
  return `${trimChars(q, ', ')} FROM (SELECT * FROM ${backquote(table)} LIMIT 500) as dt;`
}

/** pma: Normalization::checkPartialDependency's probe */
export function getPartialDependencyQuery(partialKey: string, column: string, table: string): string {
  return `SELECT COUNT(DISTINCT ${partialKey},${column}) as pkColCnt FROM (SELECT * FROM ${backquote(table)} LIMIT 500) as dt;`
}

/** pma: Normalization::findPartialDependencies's row count */
export function getSampleRowCountQuery(table: string): string {
  return `SELECT COUNT(*) FROM (SELECT * FROM ${backquote(table)} LIMIT 500) as dt;`
}

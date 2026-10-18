/**
 * Links of predefined columns in the `mysql` and `information_schema` schemas: a user name opens
 * its privileges, a table name the table, a routine name its editor, …
 *
 * pma: src/Config/SpecialSchemaLinks.php, src/Display/Results.php (getSpecialLinkUrl,
 * getRowInfoForSpecialLinks; the cell gets the Text_Plain_Link transformation)
 */

interface SpecialLink {
  /** the route of the default page (`DefaultTabTable` / `DefaultTabDatabase` = table / database) */
  page: string
  /** parameters of the default page itself (`change_column=1`, `edit_item=1`) */
  pageParams?: Array<[string, string]>
  linkParam: string
  /** [param_info, column_name] */
  deps?: Array<[string, string]>
}

const TABLE = 'table'
const DATABASE = 'database'
const privileges = (host: string): SpecialLink => ({
  page: '/server/privileges',
  linkParam: 'username',
  deps: [['hostname', host]],
})
const tableLink = (dbColumn: string): SpecialLink => ({
  page: TABLE,
  linkParam: 'table',
  deps: [['db', dbColumn]],
})
const changeColumn = (dbColumn: string, tableColumn: string): SpecialLink => ({
  page: '/table/structure/change',
  pageParams: [['change_column', '1']],
  linkParam: 'field',
  deps: [
    ['db', dbColumn],
    ['table', tableColumn],
  ],
})
const routine = (dbColumn: string, typeColumn: string, edit: boolean): SpecialLink => ({
  page: '/database/routines',
  ...(edit ? { pageParams: [['edit_item', '1']] as Array<[string, string]> } : {}),
  linkParam: 'item_name',
  deps: [
    ['db', dbColumn],
    ['item_type', typeColumn],
  ],
})

const LINKS: Record<'mysql' | 'information_schema', Record<string, Record<string, SpecialLink>>> = {
  mysql: {
    columns_priv: {
      user: privileges('host'),
      table_name: tableLink('Db'),
      column_name: changeColumn('Db', 'Table_name'),
    },
    db: { user: privileges('host') },
    event: {
      name: {
        page: '/events',
        pageParams: [['edit_item', '1']],
        linkParam: 'item_name',
        deps: [['db', 'db']],
      },
    },
    innodb_index_stats: {
      table_name: tableLink('database_name'),
      index_name: {
        page: '/table/structure',
        linkParam: 'index',
        deps: [
          ['db', 'database_name'],
          ['table', 'table_name'],
        ],
      },
    },
    innodb_table_stats: { table_name: tableLink('database_name') },
    proc: { name: routine('db', 'type', true), specific_name: routine('db', 'type', true) },
    proc_priv: { user: privileges('Host'), routine_name: routine('Db', 'Routine_type', true) },
    proxies_priv: { user: privileges('Host') },
    tables_priv: { user: privileges('Host'), table_name: tableLink('Db') },
    user: { user: privileges('host') },
  },
  information_schema: {
    columns: {
      table_name: tableLink('table_schema'),
      column_name: changeColumn('table_schema', 'table_name'),
    },
    key_column_usage: {
      table_name: tableLink('constraint_schema'),
      column_name: changeColumn('table_schema', 'table_name'),
      referenced_table_name: tableLink('referenced_table_schema'),
      referenced_column_name: changeColumn('referenced_table_schema', 'referenced_table_name'),
    },
    partitions: { table_name: tableLink('table_schema') },
    processlist: { user: privileges('host') },
    referential_constraints: {
      table_name: tableLink('constraint_schema'),
      referenced_table_name: tableLink('constraint_schema'),
    },
    routines: { routine_name: routine('routine_schema', 'routine_type', false) },
    schemata: { schema_name: { page: DATABASE, linkParam: 'db' } },
    statistics: {
      table_name: tableLink('table_schema'),
      column_name: changeColumn('table_schema', 'table_name'),
    },
    tables: { table_name: tableLink('table_schema') },
    table_constraints: { table_name: tableLink('table_schema') },
    views: { table_name: tableLink('table_schema') },
  },
}

/** The link of a cell: a phpMyAdmin route and its query parameters, in phpMyAdmin's order. */
export interface SpecialLinkUrl {
  route: string
  params: Array<[string, string]>
}

/**
 * The link of column `column` of `table` while browsing database `db` (Results::getRowValues checks
 * the current database, the column's original table and name, all lower-cased), or null.
 * `rowInfo` maps every lower-cased original column name of the row to its value (NULL absent).
 */
export function specialSchemaLink(
  cfg: { DefaultTabTable: string; DefaultTabDatabase: string },
  db: string,
  table: string,
  column: string,
  value: string,
  rowInfo: ReadonlyMap<string, string>,
): SpecialLinkUrl | null {
  const d = db.toLowerCase()
  if (d !== 'mysql' && d !== 'information_schema') return null
  const link = LINKS[d][table.toLowerCase()]?.[column.toLowerCase()]
  if (link === undefined) return null
  const route =
    link.page === TABLE ? cfg.DefaultTabTable : link.page === DATABASE ? cfg.DefaultTabDatabase : link.page
  const params: Array<[string, string]> = [...(link.pageParams ?? []), [link.linkParam, value]]
  for (const [param, col] of link.deps ?? []) {
    const v = rowInfo.get(col.toLowerCase())
    if (v !== undefined) params.push([param, v])
  }
  return { route, params }
}

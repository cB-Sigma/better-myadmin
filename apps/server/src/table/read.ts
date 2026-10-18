/**
 * Read model of one table, with the queries phpMyAdmin sends for the Structure page and the column
 * form (so even the reads stay comparable in the parity logs).
 *
 * pma: src/Dbal/DatabaseInterface.php::getColumns/getTablesFull/getTableIndexes,
 *      src/Query/Generator.php::getColumns/getSqlForTablesFull/getTableIndexesSql,
 *      src/Table/Table.php, src/Partitioning/Partition.php, src/Charsets.php, src/StorageEngine.php
 */

import {
  type ColumnMeta,
  type ServerInfo,
  collationDescription,
  unquoteDefaultValue,
} from '@bettermyadmin/mysql-types'
import { type ShowIndexRow, type TableIndex, backquote, indexesFromShowIndexes } from '@bettermyadmin/sql-gen'
import type { Conn } from '../db/connection.ts'
import { NavDbi } from '../navigation/dbi.ts'

/** The request-scoped reader: one connection, phpMyAdmin's per-request caches. */
export class TableReader {
  readonly dbi: NavDbi
  readonly conn: Conn
  #indexes = new Map<string, TableIndex[]>()
  #status = new Map<string, Record<string, string | null> | null>()
  #collations: Map<string, Map<string, { name: string; description: string }>> | null = null
  #charsets: Array<{ name: string; description: string }> | null = null
  #engines: Array<{ Engine: string; Support: string; Comment: string }> | null = null
  readonly #tr: { gettext(s: string): string; pgettext(c: string, s: string): string }

  constructor(
    conn: Conn,
    cache: Record<string, unknown>,
    tr: { gettext(s: string): string; pgettext(c: string, s: string): string },
  ) {
    this.conn = conn
    this.dbi = new NavDbi(conn, cache)
    this.#tr = tr
  }

  get server(): ServerInfo {
    const i = this.conn.serverInfo
    return {
      vendor: i?.isMariaDb ? 'mariadb' : i?.isPercona ? 'percona' : 'mysql',
      version: i?.versionInt ?? 0,
    }
  }

  /** Forget cached index/status data after a DDL statement (phpMyAdmin re-reads on the next request). */
  invalidate(): void {
    this.#indexes.clear()
    this.#status.clear()
  }

  /** pma: DbTableExists::selectDatabase (selectDb) — false when the database does not exist */
  async selectDb(db: string): Promise<boolean> {
    return this.conn.selectDb(db, 'table.use')
  }

  /**
   * pma: DatabaseInterface::getTableIndexes + Index::loadIndexes
   */
  async getIndexes(db: string, table: string): Promise<TableIndex[]> {
    const key = `${db}\u0000${table}`
    const cached = this.#indexes.get(key)
    if (cached !== undefined) return cached
    const rows = await this.dbi.fetchResultSimple(`SHOW INDEXES FROM ${backquote(db)}.${backquote(table)}`)
    const indexes = indexesFromShowIndexes(rows as unknown as ShowIndexRow[])
    this.#indexes.set(key, indexes)
    return indexes
  }

  /**
   * Columns in ORDINAL_POSITION order, with multi-column index membership attached to `Key`.
   * pma: DatabaseInterface::getColumns, ::attachIndexInfoToColumns, ::convertToColumns
   */
  async getColumns(db: string, table: string): Promise<ColumnMeta[]> {
    const collate = await this.dbi.collateForIS()
    const q = (s: string) => this.dbi.quoteString(s)
    const rows = await this.dbi.fetchResultSimple(
      'SELECT `COLUMN_NAME` AS `Field`, `COLUMN_TYPE` AS `Type`, `COLLATION_NAME` AS `Collation`,' +
        ' `IS_NULLABLE` AS `Null`, `COLUMN_KEY` AS `Key`, `COLUMN_DEFAULT` AS `Default`,' +
        ' `EXTRA` AS `Extra`, `PRIVILEGES` AS `Privileges`, `COLUMN_COMMENT` AS `Comment`' +
        ` FROM \`information_schema\`.\`COLUMNS\` WHERE \`TABLE_SCHEMA\` ${collate} = ${q(db)}` +
        ` AND \`TABLE_NAME\` ${collate} = ${q(table)} ORDER BY \`ORDINAL_POSITION\``,
    )
    if (rows.length === 0) return []
    const indexes = await this.getIndexes(db, table)
    return rows.map((r) => {
      const field = r.Field ?? ''
      let key = r.Key ?? ''
      if (key === '') {
        for (const index of indexes) {
          const col = index.columns.find((c) => c.key === field)
          if (col === undefined || col.seqInIndex <= 1) continue
          key = !index.nonUnique ? 'UNI' : 'MUL'
        }
      }
      const def = r.Default ?? null
      return {
        Field: field,
        Type: r.Type ?? '',
        Collation: r.Collation ?? null,
        Null: r.Null === 'YES' ? 'YES' : 'NO',
        Key: key,
        Default: def === null || def === 'NULL' ? null : unquoteDefaultValue(def),
        Extra: r.Extra ?? '',
        Comment: r.Comment ?? '',
      }
    })
  }

  /**
   * pma: Table::getColumnGenerationExpression (MySQL > 5.7.5 with information_schema)
   */
  async getGenerationExpressions(db: string, table: string, column?: string): Promise<Map<string, string>> {
    const q = (s: string) => this.dbi.quoteString(s)
    let sql = `SELECT
                \`COLUMN_NAME\` AS \`Field\`,
                \`GENERATION_EXPRESSION\` AS \`Expression\`
                FROM
                \`information_schema\`.\`COLUMNS\`
                WHERE
                \`TABLE_SCHEMA\` = ${q(db)}
                AND \`TABLE_NAME\` = ${q(table)}`
    if (column !== undefined) sql += ` AND  \`COLUMN_NAME\` = ${q(column)}`
    const rows = await this.dbi.fetchResultSimple(sql)
    return new Map(rows.map((r) => [r.Field ?? '', r.Expression ?? '']))
  }

  /**
   * One row of getTablesFull (information_schema.TABLES with SHOW TABLE STATUS aliases).
   * pma: Table::getStatusInfo, Query\Generator::getSqlForTablesFull
   */
  async getStatus(db: string, table: string): Promise<Record<string, string | null> | null> {
    const key = `${db}\u0000${table}`
    if (this.#status.has(key)) return this.#status.get(key) ?? null
    const collate = await this.dbi.collateForIS()
    const q = (s: string) => this.dbi.quoteString(s)
    const rows = await this.dbi.fetchResultSimple(
      'SELECT *, `TABLE_SCHEMA`       AS `Db`, `TABLE_NAME`         AS `Name`, `TABLE_TYPE`         AS `TABLE_TYPE`,' +
        ' `ENGINE`             AS `Engine`, `ENGINE`             AS `Type`, `VERSION`            AS `Version`,' +
        ' `ROW_FORMAT`         AS `Row_format`, `TABLE_ROWS`         AS `Rows`, `AVG_ROW_LENGTH`     AS `Avg_row_length`,' +
        ' `DATA_LENGTH`        AS `Data_length`, `MAX_DATA_LENGTH`    AS `Max_data_length`,' +
        ' `INDEX_LENGTH`       AS `Index_length`, `DATA_FREE`          AS `Data_free`,' +
        ' `AUTO_INCREMENT`     AS `Auto_increment`, `CREATE_TIME`        AS `Create_time`,' +
        ' `UPDATE_TIME`        AS `Update_time`, `CHECK_TIME`         AS `Check_time`,' +
        ' `TABLE_COLLATION`    AS `Collation`, `CHECKSUM`           AS `Checksum`,' +
        ' `CREATE_OPTIONS`     AS `Create_options`, `TABLE_COMMENT`      AS `Comment`' +
        ` FROM \`information_schema\`.\`TABLES\` t WHERE \`TABLE_SCHEMA\` ${collate} = ${q(db)}` +
        `  AND t.\`TABLE_NAME\` ${collate} = ${q(table)}`,
    )
    const row = rows[0] ?? null
    this.#status.set(key, row)
    return row
  }

  /** pma: Table::isView (TABLE_TYPE from the cached status; information_schema tables are views) */
  async isView(db: string, table: string): Promise<boolean> {
    const s = await this.getStatus(db, table)
    if (s !== null) return s.TABLE_TYPE === 'VIEW' || s.TABLE_TYPE === 'SYSTEM VIEW'
    return db === 'information_schema'
  }

  /** pma: Table::getStorageEngine (upper-cased by the callers) */
  async getEngine(db: string, table: string): Promise<string> {
    return (await this.getStatus(db, table))?.ENGINE ?? ''
  }

  /** pma: Table::showCreate */
  async showCreate(db: string, table: string): Promise<string> {
    const r = await this.dbi.tryQuery(
      `SHOW CREATE TABLE ${backquote(db)}.${backquote(table)}`,
      'table.create',
    )
    return r?.rows[0]?.[1] ?? ''
  }

  /** pma: Partition::havePartitioning */
  async havePartitioning(): Promise<boolean> {
    const v = this.server.version
    if (v >= 80000) return true
    if (v < 50600) return php_truthy(await this.dbi.fetchValue('SELECT @@have_partitioning;'))
    const plugins = await this.dbi.fetchResultSimple('SHOW PLUGINS')
    return plugins.some((p) => p.Name === 'partition')
  }

  /** pma: Partition::getPartitions (raw rows of information_schema.PARTITIONS) */
  async getPartitionRows(db: string, table: string): Promise<Array<Record<string, string | null>>> {
    if (!(await this.havePartitioning())) return []
    const q = (s: string) => this.dbi.quoteString(s)
    return this.dbi.fetchResultSimple(
      `SELECT * FROM \`information_schema\`.\`PARTITIONS\` WHERE \`TABLE_SCHEMA\` = ${q(db)} AND \`TABLE_NAME\` = ${q(table)}`,
    )
  }

  /** pma: Charsets::getCollations — charset → collation name → {name, description}, sorted */
  async getCollations(): Promise<Map<string, Map<string, { name: string; description: string }>>> {
    if (this.#collations !== null) return this.#collations
    const s = this.server
    const sql =
      s.vendor === 'mariadb' && s.version >= 101000
        ? 'SELECT `collapp`.`FULL_COLLATION_NAME` AS `Collation`, `collapp`.`CHARACTER_SET_NAME` AS `Charset`,' +
          ' `collapp`.`ID` AS `Id`, `collapp`.`IS_DEFAULT` AS `Default`, `coll`.`IS_COMPILED` AS `Compiled`,' +
          ' `coll`.`SORTLEN` AS `Sortlen` FROM `information_schema`.`COLLATION_CHARACTER_SET_APPLICABILITY` `collapp`' +
          ' LEFT JOIN `information_schema`.`COLLATIONS` `coll` ON `collapp`.`COLLATION_NAME`=`coll`.`COLLATION_NAME`'
        : 'SELECT `COLLATION_NAME` AS `Collation`, `CHARACTER_SET_NAME` AS `Charset`, `ID` AS `Id`,' +
          ' `IS_DEFAULT` AS `Default`, `IS_COMPILED` AS `Compiled`, `SORTLEN` AS `Sortlen`' +
          ' FROM `information_schema`.`COLLATIONS`'
    const rows = await this.dbi.fetchResultSimple(sql)
    const out = new Map<string, Map<string, { name: string; description: string }>>()
    for (const r of rows) {
      const cs = r.Charset ?? ''
      const name = r.Collation ?? ''
      let m = out.get(cs)
      if (m === undefined) {
        m = new Map()
        out.set(cs, m)
      }
      m.set(name, { name, description: collationDescription(name, this.#tr) })
    }
    for (const [cs, m] of out) out.set(cs, new Map([...m].sort(([a], [b]) => phpStrcmp(a, b))))
    this.#collations = out
    return out
  }

  /** pma: Charsets::getCharsets — sorted by name */
  async getCharsets(): Promise<Array<{ name: string; description: string }>> {
    if (this.#charsets !== null) return this.#charsets
    const rows = await this.dbi.fetchResultSimple(
      'SELECT `CHARACTER_SET_NAME` AS `Charset`, `DEFAULT_COLLATE_NAME` AS `Default collation`,' +
        ' `DESCRIPTION` AS `Description`, `MAXLEN` AS `Maxlen` FROM `information_schema`.`CHARACTER_SETS`',
    )
    this.#charsets = rows
      .map((r) => ({ name: r.Charset ?? '', description: r.Description ?? '' }))
      .sort((a, b) => phpStrcmp(a.name, b.name))
    return this.#charsets
  }

  /** pma: Charsets::findCollationByName */
  async findCollation(name: string): Promise<{ name: string; description: string } | null> {
    const charset = name.split('_')[0] ?? ''
    return (await this.getCollations()).get(charset)?.get(name) ?? null
  }

  /** pma: StorageEngine::getStorageEngines (with @@disabled_storage_engines on MySQL ≥ 5.7.8) */
  async getStorageEngines(): Promise<Array<{ Engine: string; Support: string; Comment: string }>> {
    if (this.#engines !== null) return this.#engines
    const rows = await this.dbi.fetchResultSimple('SHOW STORAGE ENGINES')
    const engines = rows.map((r) => ({
      Engine: r.Engine ?? '',
      Support: r.Support ?? '',
      Comment: r.Comment ?? '',
    }))
    const s = this.server
    if (s.vendor !== 'mariadb' && s.version >= 50708) {
      let disabled = this.dbi.cache.disabled_storage_engines
      if (typeof disabled !== 'string') {
        disabled = String((await this.dbi.fetchValue('SELECT @@disabled_storage_engines')) || '')
        this.dbi.cache.disabled_storage_engines = disabled
      }
      for (const name of (disabled as string).split(',')) {
        const e = engines.find((x) => x.Engine === name)
        if (e !== undefined) e.Support = 'DISABLED'
      }
    }
    this.#engines = engines
    return engines
  }

  /** pma: StorageEngine::getArray */
  async getEngineOptions(): Promise<Array<{ name: string; comment: string; isDefault: boolean }>> {
    return (await this.getStorageEngines())
      .filter((d) => d.Support !== 'NO' && d.Support !== 'DISABLED' && d.Engine !== 'PERFORMANCE_SCHEMA')
      .map((d) => ({ name: d.Engine, comment: d.Comment, isDefault: d.Support === 'DEFAULT' }))
  }

  /** pma: Innodb::supportsFilePerTable */
  async innodbFilePerTable(): Promise<boolean> {
    const r = await this.dbi.tryQuery("SHOW GLOBAL VARIABLES LIKE 'innodb_file_per_table';")
    return r?.rows[0]?.[1] === 'ON'
  }

  /** pma: DatabaseInterface::getVariable('FOREIGN_KEY_CHECKS') etc. */
  async getSessionVariable(name: string): Promise<string | null> {
    const r = await this.dbi.tryQuery(`SHOW SESSION VARIABLES LIKE '${name}';`)
    return r?.rows[0]?.[1] ?? null
  }

  /** pma: Table::getNameAndTypeOfTheColumns (ENUM/SET values re-spaced) */
  async getNameAndTypeOfTheColumns(db: string, table: string): Promise<Array<[string, string]>> {
    return (await this.getColumns(db, table)).map((c) => {
      const m = /^(set|enum)\(([\s\S]+)\)$/i.exec(c.Type)
      if (m === null) return [c.Field, c.Type]
      const values = `,${m[2] ?? ''}`.replace(/([^,])''/g, "$1\\'").slice(1)
      return [c.Field, `${m[1]}(${values.replaceAll(',', ', ')})`]
    })
  }
}

/** PHP truthiness of a fetched value */
function php_truthy(v: string | null | false): boolean {
  return v !== false && v !== null && v !== '' && v !== '0'
}

/** ksort(…, SORT_STRING): byte-wise comparison */
function phpStrcmp(a: string, b: string): number {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return Buffer.compare(x, y)
}

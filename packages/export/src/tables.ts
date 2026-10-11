import { unquoteDefaultValue } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import type { ExportDbi } from './dbi.ts'

/** pma: src/Dbal/Column.php (DatabaseInterface::getColumns) */
export interface Column {
  field: string
  type: string
  collation: string | null
  isNull: boolean
  key: string
  /** null: no default (or DEFAULT NULL) */
  default: string | null
  extra: string
  privileges: string
  comment: string
}

/** PHP strnatcasecmp (enough for table names). */
export function strnatcasecmp(a: string, b: string): number {
  const ax = a.toLowerCase().match(/(\d+|\D+)/g) ?? []
  const bx = b.toLowerCase().match(/(\d+|\D+)/g) ?? []
  for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
    const x = ax[i] as string
    const y = bx[i] as string
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (x !== y) return x < y ? -1 : 1
  }
  return ax.length - bx.length
}

/**
 * Table/database reads the plugins need, with phpMyAdmin's queries and per-dump caches
 * (getTablesFull's cache, Table objects).
 * pma: src/Table/Table.php, src/Dbal/DatabaseInterface.php
 */
export class TableInfo {
  readonly dbi: ExportDbi
  readonly #status = new Map<string, Record<string, string | null> | null>()
  #collate: string | null = null

  constructor(dbi: ExportDbi) {
    this.dbi = dbi
  }

  /** Util::getCollateForIS */
  async collateForIS(): Promise<string> {
    if (this.#collate !== null) return this.#collate
    const names = await this.dbi.getLowerCaseNames()
    this.#collate = names === 0 ? 'COLLATE utf8_bin' : names === 2 ? 'COLLATE utf8_general_ci' : ''
    return this.#collate
  }

  /** DatabaseInterface::getTables (SHOW TABLES FROM, NaturalOrder) */
  async getTables(db: string): Promise<string[]> {
    if (db === '') return []
    const r = await this.dbi.select(`SHOW TABLES FROM ${backquote(db)};`, false)
    if (r === null) return []
    const tables: string[] = []
    for await (const row of r.rows) tables.push(row[0] ?? '')
    if (this.dbi.naturalOrder) tables.sort(strnatcasecmp)
    return tables
  }

  /** DatabaseInterface::getTablesFull for one table (information_schema with SHOW TABLE STATUS aliases) */
  async status(db: string, table: string): Promise<Record<string, string | null> | null> {
    const key = `${db}\u0000${table}`
    if (this.#status.has(key)) return this.#status.get(key) ?? null
    const collate = await this.collateForIS()
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

  /** Table::isView */
  async isView(db: string, table: string): Promise<boolean> {
    if (db === '' || table === '') return false
    const s = await this.status(db, table)
    if (s !== null) return s.TABLE_TYPE === 'VIEW' || s.TABLE_TYPE === 'SYSTEM VIEW'
    if (db === 'information_schema') return true
    const v = await this.dbi.fetchValue(
      `SELECT 1 FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ${this.dbi.quoteString(db)} AND TABLE_NAME = ${this.dbi.quoteString(table)}`,
    )
    return v !== false && v !== null && v !== '' && v !== '0'
  }

  /** Table::getStorageEngine (upper-cased) */
  async engine(db: string, table: string): Promise<string> {
    if (db === '' || table === '') return ''
    return ((await this.status(db, table))?.Engine ?? '').toUpperCase()
  }

  /** Table::isMerge */
  async isMerge(db: string, table: string): Promise<boolean> {
    const e = await this.engine(db, table)
    return e === 'MERGE' || e === 'MRG_MYISAM'
  }

  /** Table::getNonGeneratedColumns (backquoted) */
  async getNonGeneratedColumns(db: string, table: string): Promise<string[]> {
    const rows = await this.dbi.fetchResultSimple(`SHOW COLUMNS FROM ${backquote(db)}.${backquote(table)}`)
    const ret: string[] = []
    for (const column of rows) {
      const extra = column.Extra ?? ''
      if (
        (extra.includes('GENERATED') || extra.includes('VIRTUAL')) &&
        !extra.includes('DEFAULT_GENERATED')
      ) {
        continue
      }
      ret.push(backquote(column.Field ?? ''))
    }
    return ret
  }

  /** DatabaseInterface::getColumns (without the index-membership refinement of `Key`) */
  async getColumns(db: string, table: string): Promise<Column[]> {
    const collate = await this.collateForIS()
    const q = (s: string) => this.dbi.quoteString(s)
    const rows = await this.dbi.fetchResultSimple(
      'SELECT `COLUMN_NAME` AS `Field`, `COLUMN_TYPE` AS `Type`, `COLLATION_NAME` AS `Collation`,' +
        ' `IS_NULLABLE` AS `Null`, `COLUMN_KEY` AS `Key`, `COLUMN_DEFAULT` AS `Default`,' +
        ' `EXTRA` AS `Extra`, `PRIVILEGES` AS `Privileges`, `COLUMN_COMMENT` AS `Comment`' +
        ` FROM \`information_schema\`.\`COLUMNS\` WHERE \`TABLE_SCHEMA\` ${collate} = ${q(db)}` +
        ` AND \`TABLE_NAME\` ${collate} = ${q(table)} ORDER BY \`ORDINAL_POSITION\``,
    )
    return rows.map((r) => {
      const def = r.Default ?? null
      return {
        field: r.Field ?? '',
        type: r.Type ?? '',
        collation: r.Collation ?? null,
        isNull: r.Null === 'YES',
        key: r.Key ?? '',
        default: def === null || def === 'NULL' ? null : unquoteDefaultValue(def),
        extra: r.Extra ?? '',
        privileges: r.Privileges ?? '',
        comment: r.Comment ?? '',
      }
    })
  }

  /** DatabaseInterface::getDbCollation */
  async getDbCollation(db: string): Promise<string> {
    if (!this.dbi.disableIS) {
      const v = await this.dbi.fetchValue(
        `SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${this.dbi.quoteString(db)} LIMIT 1`,
      )
      return typeof v === 'string' ? v : ''
    }
    await this.dbi.selectDb(db)
    const v = await this.dbi.fetchValue('SELECT @@collation_database')
    return typeof v === 'string' ? v : ''
  }

  /** SHOW CREATE TABLE row[1] ('' when it fails) */
  async showCreateTable(db: string, table: string): Promise<string> {
    const v = await this.dbi.fetchValue(`SHOW CREATE TABLE ${backquote(db)}.${backquote(table)}`, 1)
    return typeof v === 'string' ? v : ''
  }

  /** Index::getFromTable: SHOW INDEXES rows */
  async getIndexes(db: string, table: string): Promise<Array<Record<string, string | null>>> {
    return this.dbi.fetchResultSimple(`SHOW INDEXES FROM ${backquote(db)}.${backquote(table)}`)
  }
}

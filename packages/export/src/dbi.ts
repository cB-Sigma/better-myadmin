import type { FieldMetadata } from '@bettermyadmin/mysql-types'

/** FieldMetadata plus the raw protocol type (ODS/ODT/XML look at it) and the column's schema. */
export interface ExportField extends FieldMetadata {
  /** MYSQLI_TYPE_* */
  type: number
  db: string
}

/**
 * One result: field metadata and the rows. Cells are strings in the byte-preserving encoding of
 * `bytes.ts` (BIT columns as the decimal text mysqli returns), NULL as null.
 */
export interface ExportResult {
  fields: ExportField[]
  rows: AsyncIterable<Array<string | null>>
  /** Known only for buffered results (DatabaseInterface::QUERY_BUFFERED). */
  numRows?: number
}

/**
 * The DatabaseInterface subset the export runs on: one user connection (session statements such
 * as SET SQL_MODE / time_zone / SQL_QUOTE_SHOW_CREATE apply to the following reads).
 * pma: src/Dbal/DatabaseInterface.php
 */
export interface ExportDbi {
  /** dbi->query(): throws on error */
  query(sql: string): Promise<void>
  /** dbi->tryQuery() without reading the result: false on error (getError() then holds it) */
  tryQuery(sql: string): Promise<boolean>
  /** dbi->getError() of the last statement ('' when it succeeded) */
  getError(): string
  /** dbi->tryQuery() of a SELECT; `unbuffered` streams the rows (QUERY_UNBUFFERED). null on error. */
  select(sql: string, unbuffered: boolean): Promise<ExportResult | null>
  fetchValue(sql: string, column?: number | string): Promise<string | null | false>
  fetchSingleColumn(sql: string): Promise<string[]>
  fetchResultSimple(sql: string): Promise<Array<Record<string, string | null>>>
  quoteString(s: string): string
  selectDb(db: string): Promise<boolean>
  /** DatabaseInterface::getDatabaseList() (ListDatabase: only_db, hide_db, sorted) */
  getDatabaseList(): Promise<string[]>
  /** DatabaseInterface::getVersionString() */
  versionString: string
  /** DatabaseInterface::getVersion() as an int */
  versionInt: number
  isMariaDb: boolean
  /** lower_case_table_names (Util::getCollateForIS) */
  getLowerCaseNames(): Promise<number>
  /** $cfg['Servers'][$i]['DisableIS'] */
  disableIS: boolean
  /** $cfg['NaturalOrder'] (DatabaseInterface::getTables) */
  /** $cfg['NaturalOrder']: PHP strnatcasecmp, or null to keep the server's order */
  naturalCompare: ((a: string, b: string) => number) | null
}

/** A foreign key of SHOW CREATE TABLE (Relation::getForeignKeysData). */
export interface ExportForeignKey {
  constraint: string
  indexList: string[]
  refDbName: string | null
  refTableName: string
  refIndexList: string[]
  onDelete?: string
  onUpdate?: string
}

/**
 * The configuration storage (pmadb) features the plugins read, through the control user.
 * Absent features are null. pma: src/ConfigStorage/Relation.php, src/Transformations.php
 */
export interface ExportRelation {
  /** RelationParameters::$db (the pmadb name) or null without configuration storage */
  pmadb: string | null
  relationFeature: boolean
  browserTransformationFeature: boolean
  columnCommentsFeature: boolean
  /** pdf_pages / table_coords tables (PdfFeature) */
  pdfFeature: { pdfPages: string; tableCoords: string } | null
  /** RelationParameters::toArray(): configured table name per feature key (`bookmark` → `pma__bookmark`) */
  tables: Record<string, string | null>
  /** Relation::getForeignersInternal(db, table): column → {foreign_db, foreign_table, foreign_field} */
  getForeignersInternal(
    db: string,
    table: string,
  ): Promise<Record<string, { foreign_db: string; foreign_table: string; foreign_field: string }>>
  /** Relation::getForeignKeysData(db, table) */
  getForeignKeysData(db: string, table: string): Promise<ExportForeignKey[]>
  /** Transformations::getMime(db, table, strict=true) */
  getMime(db: string, table: string): Promise<Record<string, { mimetype: string }> | null>
}

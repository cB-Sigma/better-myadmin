import { quoteString } from './quote.ts'

/**
 * pma: QueryGenerator::getColumnNamesAndTypes (DatabaseInterface::getColumnNames); `collate` is
 * Util::getCollateForIS (`COLLATE utf8_bin`, `COLLATE utf8_general_ci` or '').
 */
export function columnNamesAndTypesQuery(collate: string, db: string, table: string): string {
  return (
    'SELECT `COLUMN_NAME`, `COLUMN_TYPE` FROM `information_schema`.`COLUMNS`' +
    ` WHERE \`TABLE_SCHEMA\` ${collate} = ${quoteString(db)}` +
    ` AND \`TABLE_NAME\` ${collate} = ${quoteString(table)}` +
    ' ORDER BY `ORDINAL_POSITION`'
  )
}

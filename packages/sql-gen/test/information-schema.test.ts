import { describe, expect, it } from 'vitest'
import { columnNamesAndTypesQuery } from '../src/index.ts'

describe('columnNamesAndTypesQuery (QueryGenerator::getColumnNamesAndTypes)', () => {
  it('quotes the names and puts the information_schema collation after both columns', () => {
    expect(columnNamesAndTypesQuery('COLLATE utf8_bin', "d'b", 't')).toBe(
      "SELECT `COLUMN_NAME`, `COLUMN_TYPE` FROM `information_schema`.`COLUMNS` WHERE `TABLE_SCHEMA` COLLATE utf8_bin = 'd\\'b' AND `TABLE_NAME` COLLATE utf8_bin = 't' ORDER BY `ORDINAL_POSITION`",
    )
  })
  it('lower_case_table_names=1: no collation', () => {
    expect(columnNamesAndTypesQuery('', 'db', 't')).toBe(
      "SELECT `COLUMN_NAME`, `COLUMN_TYPE` FROM `information_schema`.`COLUMNS` WHERE `TABLE_SCHEMA`  = 'db' AND `TABLE_NAME`  = 't' ORDER BY `ORDINAL_POSITION`",
    )
  })
})

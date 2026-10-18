import { describe, expect, it } from 'vitest'
import { type RelationParametersArray, relationParametersFromArray } from '../src/relation-parameters.ts'
import { renameTableInStorage } from '../src/table-writers.ts'
import { FakeConn, loadFixture } from './fixtures.ts'

/**
 * A moved or renamed table keeps its configuration storage rows (Relation::renameTable /
 * renameSingleTable, statements as phpMyAdmin builds them, including the two spaces before `=` in
 * the WHERE clause): column_info, table_info, relation on both sides, table_coords (deleted when
 * the table leaves the database), table_uiprefs and navigationhiding.
 */
const fx = loadFixture<{ relationParameters: RelationParametersArray }>('repositories.json')
const rp = relationParametersFromArray(fx.relationParameters)
const S = 'm1meta_rp'

const update = (
  t: string,
  dbField: string,
  tableField: string,
  to: [string, string],
  from: [string, string],
) =>
  `UPDATE \`${S}\`.\`${t}\` SET ${dbField} = '${to[0]}', ${tableField} = '${to[1]}' WHERE ${dbField}  = '${from[0]}' AND ${tableField} = '${from[1]}'`

async function run(sourceDb: string, targetDb: string, sourceTable: string, targetTable: string) {
  const conn = new FakeConn()
  await renameTableInStorage(conn, rp, sourceDb, targetDb, sourceTable, targetTable)
  return conn.log.map((l) => l.sql)
}

describe('renames propagate to the configuration storage [p08-8b840d]', () => {
  it('within the database: every table follows, table_coords included', async () => {
    const to: [string, string] = ['d', 'new']
    const from: [string, string] = ['d', 'old']
    expect(await run('d', 'd', 'old', 'new')).toEqual([
      update('pma__column_info', 'db_name', 'table_name', to, from),
      update('pma__table_info', 'db_name', 'table_name', to, from),
      update('pma__relation', 'foreign_db', 'foreign_table', to, from),
      update('pma__relation', 'master_db', 'master_table', to, from),
      update('pma__table_coords', 'db_name', 'table_name', to, from),
      update('pma__table_uiprefs', 'db_name', 'table_name', to, from),
      update('pma__navigationhiding', 'db_name', 'table_name', to, from),
      `UPDATE \`${S}\`.\`pma__navigationhiding\` SET db_name = 'd', item_name = 'new' WHERE db_name  = 'd' AND item_name = 'old' AND item_type = 'table'`,
    ])
  })

  it('to another database: the designer coordinates are deleted', async () => {
    const sql = await run('d', 'e', 't', 't')
    expect(sql).toContain(
      `DELETE FROM \`${S}\`.\`pma__table_coords\` WHERE db_name  = 'd' AND table_name = 't'`,
    )
    expect(sql.filter((s) => s.includes('pma__table_coords'))).toHaveLength(1)
    expect(sql).toContain(update('pma__relation', 'master_db', 'master_table', ['e', 't'], ['d', 't']))
  })

  it('without a control link nothing is sent', async () => {
    await expect(renameTableInStorage(null, rp, 'd', 'd', 'a', 'b')).resolves.toBeUndefined()
  })
})

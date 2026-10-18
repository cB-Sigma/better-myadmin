import { describe, expect, it } from 'vitest'
import { getViewSqlQuery } from '../src/view.ts'

const base = {
  orReplace: false,
  algorithm: '',
  definer: '',
  sqlSecurity: '',
  name: 'v',
  columnNames: '',
  as: 'SELECT 1',
  with: '',
}

describe('getViewSqlQuery (CreateController::getSqlQuery)', () => {
  it('builds CREATE with every option, lines joined by \\r\\n [p04-74ef44]', () => {
    expect(
      getViewSqlQuery(true, {
        orReplace: true,
        algorithm: 'MERGE',
        definer: 'u@%',
        sqlSecurity: 'INVOKER',
        name: 'v`1',
        columnNames: 'a,b',
        as: 'SELECT 1, 2',
        with: 'LOCAL',
      }),
    ).toBe(
      'CREATE OR REPLACE\r\n ALGORITHM = MERGE\r\nDEFINER=`u`@`%` \r\n SQL SECURITY INVOKER\r\n VIEW `v``1`\r\n (a,b)\r\n AS SELECT 1, 2\r\n WITH LOCAL  CHECK OPTION',
    )
  })

  it('ALTER, a definer without host, and options outside the lists left out', () => {
    expect(
      getViewSqlQuery(false, { ...base, definer: 'u', algorithm: 'X', sqlSecurity: 'Y', with: 'NONE' }),
    ).toBe('ALTER\r\nDEFINER=`u`\r\n VIEW `v`\r\n AS SELECT 1')
  })

  it("PHP's empty(): '0' is no definer and no column names", () => {
    expect(getViewSqlQuery(true, { ...base, definer: '0', columnNames: '0' })).toBe(
      'CREATE\r\n VIEW `v`\r\n AS SELECT 1',
    )
  })
})

import type { GridData } from '@bettermyadmin/contracts'
import { describe, expect, it } from 'vitest'
import { DiscardingLog, statementLog } from '../../src/db/statement-log.ts'
import { unreadRawCells } from '../../src/query/raw-cells.ts'
import { mbLongerThan, mbStrlen, mbSubstr } from '../../src/util/mb.ts'

/** The memory guards of large results and statements (docs/architecture/17-large-data.md). */
describe('unreadRawCells', () => {
  it('marks the raw values of truncated, transformed and non-editable cells only', () => {
    const grid = {
      columns: [{ index: 1 }, { index: 0 }, { index: 2 }, { index: 3 }],
      rows: [
        {
          cells: [
            { k: 'v', cls: 'data grid_edit click2 pre_wrap truncated' },
            { k: 'v', cls: 'text-end data grid_edit click2 not_null' },
            { k: 'v', cls: 'text-start data  click2 hex' },
            { k: 'v', cls: 'data grid_edit click2 Text_Plain transformed' },
          ],
        },
      ],
    } as unknown as GridData
    // grid column 0 is raw column 1 (truncated), column 1 is raw 0 (kept)
    expect(unreadRawCells(grid)).toEqual([[false, true, true, true]])
  })
})

describe('statementLog', () => {
  it('keeps nothing without DBG/sql, but stays an array (iteration, identity)', () => {
    const log = statementLog(false)
    expect(log).toBeInstanceOf(DiscardingLog)
    log.push({ sql: 'SELECT 1', ms: 1, label: 'x' })
    expect(log.length).toBe(0)
    expect([...log]).toEqual([])
    expect(log.filter(() => true)).not.toBeInstanceOf(DiscardingLog)
    const debug = statementLog(true)
    debug.push({ sql: 'SELECT 1', ms: 1, label: 'x' })
    expect(debug).toHaveLength(1)
  })
})

describe('mb helpers', () => {
  it('count code points like mb_strlen / mb_substr without listing them', () => {
    const s = 'a😀é'
    expect(mbStrlen(s)).toBe(3)
    expect([mbLongerThan(s, 2), mbLongerThan(s, 3), mbLongerThan('abc', 5)]).toEqual([true, false, false])
    expect([mbSubstr(s, 2), mbSubstr(s, 0), mbSubstr(s, 9)]).toEqual(['a😀', '', s])
    const big = '0'.repeat(50_000_000)
    expect(mbLongerThan(big, 1000)).toBe(true)
    expect(mbSubstr(big, 1000)).toHaveLength(1000)
  })
})

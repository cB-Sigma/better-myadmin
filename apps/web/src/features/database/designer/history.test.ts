import { describe, expect, it } from 'vitest'
import {
  type ContrRelation,
  addObject,
  buildQuery,
  detail,
  emptyOptions,
  emptyQueryBuilder,
  historyDelete,
  historyGroups,
  queryHaving,
  queryWhere,
  selectAll,
  storeColumn,
} from './history'

const contr: ContrRelation[] = [
  {
    constraint: 'child_ibfk_1',
    masterTable: 'db.child',
    masterField: 'parent_id',
    foreignTable: 'db.parent',
    foreignField: 'id',
  },
]

describe('visual query builder (history.ts)', () => {
  it('builds SELECT … FROM with a LEFT JOIN along the relation, WHERE, ORDER BY', () => {
    let s = storeColumn(emptyQueryBuilder(), 'parent', 'name', true)
    s = storeColumn(s, 'child', 'id', true)
    let r = addObject(s, 'child', 'id', 1, { ...emptyOptions(), relOpt: '>', query: '1', newName: 'cid' })
    expect(r.created).toBe(2)
    r = addObject(r.state, 'parent', 'name', 1, { ...emptyOptions(), orderBy: 'DESC' })
    // DesignerHistory.display sorts the new entry above the tables it sorts after
    expect(r.state.history.map((h) => `${h.tab}:${h.type}`)).toEqual([
      'parent:OrderBy',
      'child:Where',
      'child:Rename',
    ])
    expect(historyGroups(r.state.history)).toEqual([
      { tab: 'parent', indexes: [0] },
      { tab: 'child', indexes: [1, 2] },
    ])
    const b = buildQuery(r.state, contr)
    expect(b.sql).toBe(
      'SELECT `parent`.`name`, `child`.`id` AS `cid`\nFROM `parent`\nLEFT JOIN `child` ON `parent`.`id` = `child`.`parent_id` \nWHERE (( `id` > 1))\nORDER BY `name` DESC',
    )
    // queryFrom leaves the history's tables appended to the from-array
    expect(b.fromArray).toEqual(['parent', 'child', 'parent', 'child', 'child'])
  })

  it('keeps phpMyAdmin’s join when the referencing table comes first', () => {
    const s = storeColumn(storeColumn(emptyQueryBuilder(), 'child', 'id', true), 'parent', 'name', true)
    expect(buildQuery(s, contr).sql).toBe(
      'SELECT `child`.`id`, `parent`.`name`\nFROM `child` , `parent`\nLEFT JOIN `child` ON `parent`.`id` = `child`.`parent_id`  AND `child`.`parent_id` = `parent`.`id` ',
    )
  })

  it('SELECT * without columns; aggregates, GROUP BY, HAVING, OR conditions', () => {
    let r = addObject(emptyQueryBuilder(), 't', 'a', 1, {
      ...emptyOptions(),
      operator: 'count',
      groupBy: true,
      hRelOpt: '>',
      hOperator: 'sum',
      having: '5',
    })
    expect(r.created).toBe(3)
    r = addObject(r.state, 't', 'b', 1, { ...emptyOptions(), relOpt: '=', query: "'x'" })
    r = addObject(r.state, 't', 'c', 1, { ...emptyOptions(), relOpt: '<', query: '3' })
    const history = r.state.history.map((h) => (h.columnName === 'c' ? { ...h, andOr: 1 as const } : h))
    expect(queryWhere(history)).toBe("(( `b` = 'x')) OR (( `c` < 3)) )")
    expect(queryHaving(history)).toBe('(sum(`a`) > 5)')
    expect(buildQuery({ ...r.state, history }, []).sql).toBe(
      "SELECT * \nFROM `t`\nWHERE (( `b` = 'x')) OR (( `c` < 3)) )\nGROUP BY `a`\nHAVING (sum(`a`) > 5)",
    )
    expect(history.map(detail)).toEqual([
      'Select count( a )',
      'GroupBy a',
      'Having sum( a )>5',
      "Where b='x'",
      'Where c<3',
    ])
  })

  it('an empty WHERE value adds nothing; an empty HAVING value stops after the entries before it', () => {
    const s = emptyQueryBuilder()
    expect(addObject(s, 't', 'a', 1, { ...emptyOptions(), relOpt: '=' }).result).toBe('error')
    const r = addObject(s, 't', 'a', 1, { ...emptyOptions(), newName: 'x', hRelOpt: '=' })
    expect(r.result).toBe('stop')
    expect(r.state.history).toHaveLength(1)
  })

  it('select all / delete keep the from-array like phpMyAdmin', () => {
    let s = storeColumn(emptyQueryBuilder(), 't', 'a', true)
    s = selectAll(s, 't', true, ['a'])
    expect(s.selectField).toEqual(['`t`.*'])
    expect(s.fromArray).toEqual(['t'])
    s = selectAll(s, 't', false, [])
    expect(s.selectField).toEqual([])
    const r = addObject(s, 't', 'a', 1, { ...emptyOptions(), groupBy: true })
    expect(historyDelete(r.state, 0).history).toEqual([])
  })
})

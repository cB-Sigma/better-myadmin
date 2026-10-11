import { describe, expect, it } from 'vitest'
import { applyVariables, getVariableCount } from '../src/bookmarks.ts'
import { getUserFormFields } from '../src/index.ts'
import { PhpSparseList, phpJsonEncode } from '../src/php.ts'
import { fixUpMime } from '../src/relations.ts'
import { getCreateTableSqlQueries } from '../src/resources.ts'
import { applyUserPreferences } from '../src/userprefs.ts'
import { loadFixture } from './fixtures.ts'

const php = loadFixture<{
  json_encode: Array<{ value: unknown; php: string }>
  json_encode_gaps: Array<{ remove: number[]; php: string }>
  bookmark_variables: Array<{
    query: string
    variables: Record<string, string>
    count: number
    applied: string
  }>
  fix_up_mime: Array<{ in: string; out: string }>
}>('php.json')

describe('json_encode (default flags)', () => {
  for (const c of php.json_encode) {
    it(c.php, () => expect(phpJsonEncode(c.value)).toBe(c.php))
  }
  for (const c of php.json_encode_gaps) {
    it(`list with removed keys ${c.remove.join(',')}`, () => {
      const entries: Array<[number, { db: string; table: string }]> = [0, 1, 2]
        .filter((k) => !c.remove.includes(k))
        .map((k) => [k, { db: 'd', table: `t${k}` }])
      expect(phpJsonEncode(new PhpSparseList(entries))).toBe(c.php)
    })
  }
})

describe('Bookmark::getVariableCount / applyVariables', () => {
  for (const c of php.bookmark_variables) {
    it(c.query, () => {
      expect(getVariableCount(c.query)).toBe(c.count)
      expect(applyVariables(c.query, c.variables)).toBe(c.applied)
    })
  }
})

describe('Transformations::fixUpMime', () => {
  for (const c of php.fix_up_mime) it(JSON.stringify(c.in), () => expect(fixUpMime(c.in)).toBe(c.out))
})

describe('Relation::getCreateTableSqlQueries', () => {
  const f = loadFixture<{
    cases: Array<{ replacements: Record<string, string>; queries: Record<string, string> }>
  }>('create-tables.json')
  for (const c of f.cases) {
    it(JSON.stringify(c.replacements), () => {
      const got = getCreateTableSqlQueries(c.replacements)
      expect(Object.keys(got)).toEqual(Object.keys(c.queries))
      expect(got).toEqual(c.queries)
    })
  }
})

describe('UserFormList::getFields / UserPreferences::apply', () => {
  const f = loadFixture<{
    fields: { default: string[]; developer: string[] }
    apply: Array<{ disallow: string[]; config_data: Record<string, unknown>; applied: unknown }>
  }>('userprefs.json')
  it('form fields', () => {
    expect(getUserFormFields(false)).toEqual(f.fields.default)
    expect(getUserFormFields(true)).toEqual(f.fields.developer)
  })
  for (const c of f.apply) {
    it(`apply with UserprefsDisallow=${JSON.stringify(c.disallow)}`, () => {
      expect(applyUserPreferences(c.config_data, getUserFormFields(false), c.disallow)).toEqual(c.applied)
    })
  }
})

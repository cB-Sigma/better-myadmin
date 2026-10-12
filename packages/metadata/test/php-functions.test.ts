import { describe, expect, it } from 'vitest'
import { applyVariables, getVariableCount } from '../src/bookmarks.ts'
import { getUserFormFields } from '../src/index.ts'
import { PhpSparseList, phpJsonEncode, phpSerialize, phpUnserialize } from '../src/php.ts'
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

describe('serialize / Core::safeUnserialize', () => {
  const value = {
    COLUMNS: [
      {
        Field: 'id',
        Type: 'int',
        Collation: null,
        Null: 'NO',
        Key: 'PRI',
        Default: null,
        Extra: '',
        Comment: 'é',
      },
    ],
    INDEXES: [{ Non_unique: '0', x: true, y: 1.5, z: 3 }],
  }
  // php -r 'echo serialize([...]);' (PHP 8)
  const golden =
    'a:2:{s:7:"COLUMNS";a:1:{i:0;a:8:{s:5:"Field";s:2:"id";s:4:"Type";s:3:"int";s:9:"Collation";N;s:4:"Null";s:2:"NO";s:3:"Key";s:3:"PRI";s:7:"Default";N;s:5:"Extra";s:0:"";s:7:"Comment";s:2:"é";}}s:7:"INDEXES";a:1:{i:0;a:4:{s:10:"Non_unique";s:1:"0";s:1:"x";b:1;s:1:"y";d:1.5;s:1:"z";i:3;}}}'
  it('serializes like PHP', () => expect(phpSerialize(value)).toBe(golden))
  it('round-trips', () => expect(phpUnserialize(golden)).toEqual(value))
  it('rejects objects and malformed input', () => {
    expect(phpUnserialize('O:8:"stdClass":0:{}')).toBeNull()
    expect(phpUnserialize('a:1:{')).toBeNull()
  })
})

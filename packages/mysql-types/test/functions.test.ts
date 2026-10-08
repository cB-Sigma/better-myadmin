import { describe, expect, it } from 'vitest'
import {
  type ServerInfo,
  createFieldMetadata,
  getDefaultFunctionForField,
  getDefaultTypeOptions,
  getFunctionCellKind,
  getFunctionsForField,
  getTrueType,
  getVirtualityOptions,
  isDateTimeType,
  isTimeType,
  resolveDefaultFunctions,
} from '../src/index.ts'
import { loadFixture } from './fixtures.ts'

type DefaultCase = [string, boolean, string | null, string, boolean, string, string, boolean, string]

interface FunctionsFixture {
  defaultFunctionsConfig: Record<string, Record<string, string> | null>
  defaultFunctionForField: { server: ServerInfo; config: string; cases: DefaultCase[] }[]
  functionsForField: {
    server: ServerInfo
    defaultFunction: string
    hasForeignField: boolean
    options: { label: string; value?: string; title?: string; selected?: boolean }[]
  }[]
}

const f = loadFixture<FunctionsFixture>('insert-edit-functions.json')

describe('insert/edit function dropdown (golden, executed phpMyAdmin)', () => {
  for (const group of f.defaultFunctionForField) {
    it(`getDefaultFunctionForField ${group.server.vendor} ${group.server.version} config=${group.config}`, () => {
      const cfg = resolveDefaultFunctions(f.defaultFunctionsConfig[group.config])
      for (const [
        trueType,
        firstTimestamp,
        defaultValue,
        extra,
        isNull,
        key,
        type,
        insertMode,
        expected,
      ] of group.cases) {
        const actual = getDefaultFunctionForField(
          { trueType, firstTimestamp, defaultValue, extra, isNull, key, type, insertMode },
          group.server,
          cfg,
        )
        expect(actual, JSON.stringify([trueType, defaultValue, extra, isNull, key, type, insertMode])).toBe(
          expected,
        )
      }
    })
  }

  it('getFunctionsForField', () => {
    for (const c of f.functionsForField) {
      const actual = getFunctionsForField(c.server, c.defaultFunction, c.hasForeignField).map((o) => {
        const r: { label: string; value?: string; title?: string; selected?: boolean } = { label: o.label }
        if (o.title !== undefined) {
          r.value = o.value
          r.title = o.title
        }
        if (o.selected) r.selected = true
        return r
      })
      expect(actual, JSON.stringify([c.server, c.defaultFunction, c.hasForeignField])).toEqual(c.options)
    }
  })
})

describe('insert/edit function cell', () => {
  const cfg = { showFunctionFields: true, protectBinary: 'blob' as const }
  it('mirrors isColumnBinary and the ENUM/SET "--" cell', () => {
    expect(
      getFunctionCellKind({ trueType: 'blob', isBlob: true, isBinary: false, isUpload: false }, cfg),
    ).toBe('binary')
    expect(
      getFunctionCellKind({ trueType: 'blob', isBlob: true, isBinary: false, isUpload: true }, cfg),
    ).toBe('select')
    expect(
      getFunctionCellKind({ trueType: 'enum', isBlob: false, isBinary: false, isUpload: false }, cfg),
    ).toBe('none')
    expect(
      getFunctionCellKind(
        { trueType: 'varbinary', isBlob: false, isBinary: true, isUpload: false },
        { showFunctionFields: true, protectBinary: 'noblob' },
      ),
    ).toBe('binary')
    expect(
      getFunctionCellKind(
        { trueType: 'int', isBlob: false, isBinary: false, isUpload: false },
        { ...cfg, showFunctionFields: false },
      ),
    ).toBe(null)
  })

  it('getTrueType strips length and comments', () => {
    expect(getTrueType('varchar(36)')).toBe('varchar')
    expect(getTrueType("enum('a','b')")).toBe('enum')
    expect(getTrueType('int unsigned')).toBe('int unsigned')
    expect(getTrueType('timestamp /* mariadb-5.3 */')).toBe('timestamp')
  })

  it('default type and virtuality options follow the server', () => {
    expect(getDefaultTypeOptions({ vendor: 'mysql', version: 80400 })).toEqual([
      'NONE',
      'USER_DEFINED',
      'NULL',
      'CURRENT_TIMESTAMP',
    ])
    expect(getDefaultTypeOptions({ vendor: 'mariadb', version: 110700 })).toContain('UUID_v7')
    expect(getVirtualityOptions({ vendor: 'mariadb', version: 100100 })).toEqual([
      '',
      'VIRTUAL',
      'PERSISTENT',
    ])
    expect(getVirtualityOptions({ vendor: 'mysql', version: 50600 })).toBe(null)
  })
})

interface FieldCase {
  type: number
  flags: number
  charsetnr: number
  [k: string]: unknown
}

describe('FieldMetadata (golden, executed phpMyAdmin)', () => {
  const { cases } = loadFixture<{ cases: FieldCase[] }>('field-metadata.json')
  it('maps protocol types and flags', () => {
    for (const c of cases) {
      const m = createFieldMetadata({
        name: 'c',
        orgName: 'c',
        table: 't',
        orgTable: 't',
        type: c.type,
        flags: c.flags,
        charsetNr: c.charsetnr,
        length: 10,
      })
      const { type: _t, flags: _f, charsetnr: _c, isDateTimeType: dt, isTimeType: tt, ...expected } = c
      const actual: Record<string, unknown> = { ...m }
      for (const k of ['name', 'orgName', 'table', 'orgTable', 'charsetNr', 'decimals', 'length'])
        delete actual[k]
      expect(actual, `${c.type}/${c.flags}`).toEqual(expected)
      expect(isDateTimeType(m)).toBe(dt)
      expect(isTimeType(m)).toBe(tt)
    }
  })
})

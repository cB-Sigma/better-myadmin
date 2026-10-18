import { describe, expect, it } from 'vitest'
import {
  type ColumnMeta,
  collationDescription,
  columnFormRow,
  decorateColumnMetaDefault,
  moveColumnOptions,
} from '../src/index.ts'
import { loadFixture } from './fixtures.ts'

const collations = loadFixture<{ cases: [string, string][] }>('collations.json')

describe('Collation::getDescription (golden, executed phpMyAdmin)', () => {
  it('every server collation and the MariaDB/legacy names', () => {
    expect(collations.cases.length).toBeGreaterThan(250)
    for (const [name, description] of collations.cases)
      expect(collationDescription(name), name).toBe(description)
  })

  it('translates through pgettext contexts', () => {
    const tr = {
      gettext: (s: string) => `[${s}]`,
      pgettext: (c: string, s: string) => `${c}:${s}`,
    }
    expect(collationDescription('latin1_swedish_ci', tr)).toBe(
      'Collation:Swedish, Collation variant:case-insensitive',
    )
  })
})

describe('change form prefill (ColumnsDefinition::displayForm, column_attributes.twig)', () => {
  const mysql = { vendor: 'mysql', version: 80400 } as const
  const meta = (o: Partial<ColumnMeta>): ColumnMeta => ({
    Field: 'c',
    Type: 'int',
    Collation: null,
    Null: 'NO',
    Key: '',
    Default: null,
    Extra: '',
    Comment: '',
    ...o,
  })

  it('decorateColumnMetaDefault', () => {
    expect(decorateColumnMetaDefault(null, true)).toEqual({ DefaultType: 'NULL', DefaultValue: '' })
    expect(decorateColumnMetaDefault(null, false)).toEqual({ DefaultType: 'NONE', DefaultValue: '' })
    expect(decorateColumnMetaDefault('current_timestamp()', false).DefaultType).toBe('CURRENT_TIMESTAMP')
    expect(decorateColumnMetaDefault('uuid()', false).DefaultType).toBe('UUID')
    expect(decorateColumnMetaDefault('0', false)).toEqual({ DefaultType: 'USER_DEFINED', DefaultValue: '0' })
  })

  it('an auto-increment integer', () => {
    const r = columnFormRow(
      meta({ Field: 'id', Type: 'int unsigned', Extra: 'auto_increment', Key: 'PRI' }),
      mysql,
    )
    expect(r.values).toMatchObject({
      type: 'INT',
      length: '',
      attribute: 'UNSIGNED',
      autoIncrement: true,
      null: false,
    })
    expect(r.orig).toMatchObject({
      type: 'INT',
      attribute: 'UNSIGNED',
      extra: 'auto_increment',
      defaultType: 'NONE',
    })
  })

  it('a TIMESTAMP with CURRENT_TIMESTAMP default and on update', () => {
    const r = columnFormRow(
      meta({
        Type: 'timestamp(3)',
        Default: 'CURRENT_TIMESTAMP(3)',
        Extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)',
      }),
      mysql,
    )
    expect(r.values).toMatchObject({
      type: 'TIMESTAMP',
      length: '3',
      defaultType: 'USER_DEFINED',
      defaultValue: 'CURRENT_TIMESTAMP(3)',
      attribute: 'on update CURRENT_TIMESTAMP',
    })
    expect(r.orig.attribute).toBe('')
  })

  it('BIT and BINARY defaults, enum lengths, generated columns, unknown types', () => {
    expect(columnFormRow(meta({ Type: 'bit(4)', Default: "b'0101'" }), mysql).values.defaultValue).toBe(
      '0101',
    )
    expect(columnFormRow(meta({ Type: 'bit(4)', Default: "b'0101'" }), mysql).orig.defaultValue).toBe('0101')
    expect(columnFormRow(meta({ Type: 'varbinary(3)', Default: 'ab' }), mysql).values.defaultValue).toBe(
      '6162',
    )
    expect(columnFormRow(meta({ Type: "enum('a','b')" }), mysql).values).toMatchObject({
      type: 'ENUM',
      length: "'a','b'",
    })
    const gen = columnFormRow(
      meta({ Type: 'int', Extra: 'STORED GENERATED', Expression: '(`a` + 1)' }),
      mysql,
    )
    expect(gen.values).toMatchObject({ virtuality: 'STORED', expression: '(`a` + 1)' })
    expect(gen.orig.virtuality).toBe('')
    // MySQL reports GEOMETRYCOLLECTION as geomcollection: no such option, the select shows the first one
    expect(columnFormRow(meta({ Type: 'geomcollection' }), mysql).values.type).toBe('INT')
    // expression default uuid() decorates to UUID, which MySQL's dropdown does not offer
    expect(columnFormRow(meta({ Type: 'char(36)', Default: 'uuid()' }), mysql).values.defaultType).toBe(
      'NONE',
    )
  })

  it('move column options [p04-6268d7]', () => {
    expect(moveColumnOptions(['a', 'b', 'c'], 'b')).toEqual([
      { value: '', after: null, disabled: false },
      { value: '-first', after: null, disabled: false },
      { value: 'a', after: 'a', disabled: true },
      { value: 'b', after: 'b', disabled: true },
      { value: 'c', after: 'c', disabled: false },
    ])
    expect(moveColumnOptions(['a', 'b'], 'a')[1]?.disabled).toBe(true)
  })
})

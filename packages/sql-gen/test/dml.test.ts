import type { ServerInfo } from '@bettermyadmin/mysql-types'
import { describe, expect, it } from 'vitest'
import {
  type EditField,
  buildDeleteRowQuery,
  buildDeleteRowsQueries,
  buildInsertEditQueries,
  buildInsertSqlQuery,
  buildProtectedValueQuery,
  getQueryValueForInsert,
  getQueryValueForUpdate,
  uploadedEditField,
} from '../src/index.ts'
import { type Bytes, asText, cell, loadFixture } from './fixtures.ts'

interface ValueCase {
  server: ServerInfo
  field: EditField
  usingKey: boolean
  whereClause: string
  protectedValue: Bytes | null
  uuid: string
  insert: Bytes | { error: string }
  update: Bytes | { error: string }
}

const { cases } = loadFixture<{ cases: ValueCase[] }>('insert-edit-values.json')

const isError = (v: Bytes | { error: string }): v is { error: string } =>
  typeof v === 'object' && 'error' in v

describe('InsertEdit value generation (golden, executed phpMyAdmin)', () => {
  it('has many cases', () => {
    expect(cases.length).toBeGreaterThan(1000)
  })

  for (const server of [...new Set(cases.map((c) => `${c.server.vendor} ${c.server.version}`))]) {
    it(`getQueryValueForInsert / getQueryValueForUpdate on ${server} [p03-cb66f4 p03-f8cc27]`, () => {
      for (const c of cases.filter((x) => `${x.server.vendor} ${x.server.version}` === server)) {
        const ctx = { server: c.server, uuid: () => c.uuid }
        const label = JSON.stringify(c.field)
        const insert = () =>
          getQueryValueForInsert(c.field, ctx, {
            usingKey: c.usingKey,
            whereClause: c.whereClause,
            protectedValue: cell(c.protectedValue),
          })
        if (isError(c.insert)) expect(insert, label).toThrow()
        else expect(insert(), label).toBe(asText(c.insert))

        const update = () => getQueryValueForUpdate(c.field, ctx)
        if (isError(c.update)) expect(update, label).toThrow()
        else expect(update(), label).toBe(asText(c.update))
      }
    })
  }
})

const field = (columnName: string, value: string, rest: Partial<EditField> = {}): EditField => ({
  columnName,
  value,
  type: '',
  autoIncrement: false,
  isNull: false,
  wasPreviouslyNull: false,
  function: '',
  salt: null,
  previousValue: null,
  isUploaded: false,
  ...rest,
})

describe('statement assembly (ReplaceController)', () => {
  const ctx = { server: { vendor: 'mysql', version: 80400 } as const }

  it('multi-row INSERT with columns from the first row', () => {
    const sql = buildInsertEditQueries(
      {
        table: 'users',
        rows: [
          {
            fields: [
              field('id', '', { autoIncrement: true }),
              field('name', "O'Neil"),
              field('gen', 'x', { virtual: true } as Partial<EditField>),
            ],
          },
          { fields: [field('id', ''), field('name', 'b')], skip: true },
          { fields: [field('id', '7'), field('name', 'c', { function: 'UPPER' })] },
        ],
      },
      ctx,
    )
    expect(sql).toEqual(["INSERT INTO `users` (`id`, `name`) VALUES (NULL, 'O\\'Neil'), ('7', UPPER('c'))"])
  })

  it('INSERT IGNORE and column defaults used verbatim', () => {
    const sql = buildInsertEditQueries(
      {
        table: 't',
        submitType: 'insertignore',
        rows: [{ fields: [field('created', 'CURRENT_TIMESTAMP'), field('n', "'x'")] }],
        columnDefaults: { created: 'CURRENT_TIMESTAMP', n: "'x'" },
      },
      ctx,
    )
    expect(sql).toEqual(["INSERT IGNORE INTO `t` (`created`, `n`) VALUES (CURRENT_TIMESTAMP, 'x')"])
  })

  it('one UPDATE per edited row, LIMIT 1 unless the clause is unique', () => {
    const rows = [
      {
        whereClause: '`t`.`id` = 1',
        fields: [field('a', 'new', { previousValue: 'old' }), field('b', 'same', { previousValue: 'same' })],
      },
      { whereClause: '`t`.`id` = 2', fields: [field('b', 'same', { previousValue: 'same' })] },
      { whereClause: '`t`.`id` = 3', fields: [field('c', '', { isNull: true, wasPreviouslyNull: false })] },
    ]
    expect(buildInsertEditQueries({ table: 't', rows, clauseIsUnique: true }, ctx)).toEqual([
      "UPDATE `t` SET `a` = 'new' WHERE `t`.`id` = 1",
      'UPDATE `t` SET `c` = NULL WHERE `t`.`id` = 3',
    ])
    expect(buildInsertEditQueries({ table: 't', rows: rows.slice(0, 1) }, ctx)).toEqual([
      "UPDATE `t` SET `a` = 'new' WHERE `t`.`id` = 1 LIMIT 1",
    ])
  })

  it('"Insert as new row" from an edit copies protected binary values [p03-4997ee p03-6d6c71]', () => {
    const sql = buildInsertEditQueries(
      {
        table: 'files',
        submitType: 'insert',
        rows: [
          {
            whereClause: '`files`.`id` = 4',
            fields: [
              field('id', '', { autoIncrement: true }),
              { ...field('data', '', { type: 'protected' }), protectedValue: Uint8Array.from([1, 2]) },
            ],
          },
        ],
      },
      ctx,
    )
    expect(sql).toEqual(['INSERT INTO `files` (`id`, `data`) VALUES (NULL, 0x0102)'])
    expect(buildProtectedValueQuery('data', 'files', '`files`.`id` = 4')).toBe(
      'SELECT `data` FROM `files` WHERE `files`.`id` = 4 LIMIT 1;',
    )
  })

  it('uploads are inserted as hex verbatim; protected blobs untouched on UPDATE [p03-b4c209 p03-4997ee]', () => {
    const up = uploadedEditField('img', Uint8Array.from([0xff, 0xd8]))
    expect(getQueryValueForInsert(up, ctx)).toBe('0xffd8')
    expect(getQueryValueForUpdate(field('img', '', { type: 'protected' }), ctx)).toBe('')
  })

  it('BIT, hex, uuid and NOW(fsp) values [p03-2e3f92 p03-b3c9a2 p03-c6dc22]', () => {
    expect(getQueryValueForInsert(field('b', '1021', { type: 'bit' }), ctx)).toBe("b'1001'")
    expect(getQueryValueForInsert(field('h', 'ABCD', { type: 'hex' }), ctx)).toBe('0xABCD')
    expect(getQueryValueForInsert(field('u', '', { type: 'uuid' }), ctx)).toBe('uuid()')
    expect(getQueryValueForInsert(field('d', '3', { function: 'NOW' }), ctx)).toBe('NOW(3)')
    expect(getQueryValueForInsert(field('d', 'current_timestamp(2)', { type: 'datetime' }), ctx)).toBe(
      'current_timestamp(2)',
    )
    expect(
      getQueryValueForInsert(field('p', 'secret', { function: 'PHP_PASSWORD_HASH' }), {
        ...ctx,
        passwordHash: () => '$2y$10$x',
      }),
    ).toBe("'$2y$10$x'")
    expect(() =>
      getQueryValueForInsert(field('p', 'secret', { function: 'PHP_PASSWORD_HASH' }), ctx),
    ).toThrow()
  })

  it('INSERT builder and DELETE', () => {
    expect(buildInsertSqlQuery('t', false, ['`a`'], ['1', '2'])).toBe('INSERT INTO `t` (`a`) VALUES (1), (2)')
    expect(buildDeleteRowQuery('t', '`t`.`id` = 1', true)).toBe('DELETE FROM `t` WHERE `t`.`id` = 1')
    expect(buildDeleteRowQuery('t', '`t`.`a` = 1', false)).toBe('DELETE FROM `t` WHERE `t`.`a` = 1 LIMIT 1')
    expect(buildDeleteRowsQueries('t`x', ['`a` = 1', '`a` = 2'])).toEqual([
      'DELETE FROM `t``x` WHERE `a` = 1 LIMIT 1;',
      'DELETE FROM `t``x` WHERE `a` = 2 LIMIT 1;',
    ])
  })
})

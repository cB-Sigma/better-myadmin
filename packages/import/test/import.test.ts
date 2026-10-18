import { gzipSync } from 'node:zlib'
import { englishTranslator } from '@bettermyadmin/i18n'
import { describe, expect, it } from 'vitest'
import {
  ColumnType,
  Import,
  ImportFile,
  type QueryRunner,
  compressionOf,
  phpFloatString,
} from '../src/index.ts'

const SUPPORT = { gzip: true, bzip2: true, zip: true }

function importOf(text: string, statements: string[] = []): Import {
  const runner: QueryRunner = {
    forceExecute: false,
    hasError: false,
    skipQueries: 0,
    clearError() {},
    async runQuery(sql) {
      if (sql !== '') statements.push(sql)
    },
  }
  return new Import({
    dbi: {
      tryQuery: async () => ({ numRows: 0, firstValue: null }),
      quoteString: (s) => `'${s.replace(/'/g, "''")}'`,
      getTables: async () => ['people', 'people_1'],
      getColumnNames: async () => [],
      fetchSingleColumn: async () => [],
      isView: async () => false,
    },
    runner,
    tr: englishTranslator(),
    db: 'd',
    table: '',
    importType: 'database',
    importFileName: 'x.sql',
    importFile: '/tmp/x',
    localImportFile: '',
    file: new ImportFile(Buffer.from(text), SUPPORT),
    readLimit: 1310720,
    request: { get: () => undefined, has: () => false },
  })
}

describe('import file', () => {
  it('detects and opens gzip, bzip2 and zip by their magic bytes [p07-85c45c]', () => {
    expect(compressionOf(gzipSync(Buffer.from('x')))).toBe('application/gzip')
    const bz = Buffer.from(
      'QlpoOTFBWSZTWb43xuUAAAReAAAQQAAgCAoEDAAgACIGhtQgyYhCzmWzxdyRThQkL43xuUA=',
      'base64',
    )
    const f = new ImportFile(bz, SUPPORT)
    expect(f.compression).toBe('application/bzip2')
    expect(f.read(100).toString()).toBe('SELECT 1;\n')
    expect(f.eof()).toBe(true)
    expect(() => new ImportFile(bz, { ...SUPPORT, bzip2: false })).toThrow(
      /unsupported compression \(application\/bzip2\)/,
    )
  })

  it('skips a UTF-8 byte order mark in the first chunk [p07-78ed9c]', () => {
    const imp = importOf('﻿SELECT 1;')
    expect((imp.getNextChunk() as Buffer).toString()).toBe('SELECT 1;')
  })
})

describe('Import helpers', () => {
  it('names columns like a spreadsheet', () => {
    const imp = importOf('')
    expect([1, 26, 27, 52, 53, 702, 703].map((n) => imp.getColumnAlphaName(n))).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ])
  })

  it('formats floats like PHP (precision 14)', () => {
    expect(
      [0.1 + 0.2, 1e15, 1e14, 1e13, 0.0001, 0.00001, 1.23456789012345, -2.5, 5].map(phpFloatString),
    ).toEqual([
      '0.3',
      '1.0E+15',
      '1.0E+14',
      '10000000000000',
      '0.0001',
      '1.0E-5',
      '1.2345678901235',
      '-2.5',
      '5',
    ])
  })

  it('detects column types and sizes (analyzeTable)', () => {
    const imp = importOf('')
    const a = imp.analyzeTable({
      tableName: 't',
      columns: ['i', 'b', 'd', 'v', 'n'],
      rows: [
        ['1', '3000000000', '1.5', 'x', 'NULL'],
        ['-22', '1', '-12.25', '12', 'NULL'],
      ],
    })
    expect(a.map((c) => [c.type, c.size])).toEqual([
      [ColumnType.Int, 3],
      [ColumnType.BigInt, 10],
      [ColumnType.Decimal, { precision: 5, scale: 2 }],
      [ColumnType.Varchar, 2],
      [ColumnType.Varchar, 10],
    ])
  })

  it('builds CREATE TABLE and one INSERT (buildSql) and picks a free table name', async () => {
    const out: string[] = []
    const imp = importOf('', out)
    const table = {
      tableName: 't',
      columns: ['a', 'b'],
      rows: [
        ['1', 'x'],
        ['2', 'NULL'],
      ],
    }
    await imp.buildSql('d', [table], [imp.analyzeTable(table)])
    expect(out).toEqual([
      'CREATE TABLE IF NOT EXISTS `d`.`t` (`a` int(1), `b` varchar(1))',
      "INSERT INTO `d`.`t` (`a`, `b`) VALUES (1, 'x'),\n (2, NULL)",
    ])
    expect(await imp.getNextAvailableTableName('d', 'people')).toBe('people_2')
    expect(await imp.getNextAvailableTableName('d', 'new ')).toBe('new')
  })
})

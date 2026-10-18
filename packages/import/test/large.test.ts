import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { englishTranslator } from '@bettermyadmin/i18n'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Import, ImportFile, type QueryRunner } from '../src/index.ts'

/**
 * Large imports (docs/architecture/17-large-data.md): a file is read from disk chunk by chunk, a
 * gzip or bzip2 one through a decompressed temporary copy, and the import stops before the time
 * limit so that it can be resumed.
 */
const SUPPORT = { gzip: true, bzip2: true, zip: true }
/** test/fixtures/stream.sql.bz2 is `bzip2 -9` of this text (2.5 MB: three bzip2 blocks) */
const SQL = (() => {
  let s = ''
  for (let i = 0; i < 60000; i++) s += `INSERT INTO t VALUES (${i}, 'row ${i}');\n`
  return s
})()

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bma-import-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const tempCopies = () =>
  readdirSync(tmpdir()).filter((n) => n.startsWith('bma-import-') && !n.startsWith('bma-import-test-'))

/** Reads the whole file in chunks of `size`, as Import::getNextChunk does */
function readAll(f: ImportFile, size = 1310720): { text: string; chunks: number; largest: number } {
  const parts: Buffer[] = []
  let largest = 0
  while (!f.eof()) {
    const b = f.read(size)
    largest = Math.max(largest, b.length)
    parts.push(b)
  }
  return { text: Buffer.concat(parts).toString(), chunks: parts.length, largest }
}

describe('ImportFile.open: from disk, in chunks', () => {
  it('an uncompressed file: positioned reads of the asked size, nothing copied', async () => {
    const path = join(dir, 'a.sql')
    writeFileSync(path, SQL)
    const before = tempCopies()
    const f = await ImportFile.open(path, SUPPORT)
    expect(f.compression).toBe('none')
    const r = readAll(f, 65536)
    expect(r.text).toBe(SQL)
    expect(r.largest).toBe(65536)
    expect(r.chunks).toBe(Math.ceil(SQL.length / 65536))
    expect(tempCopies()).toEqual(before)
    f.close()
  })

  it('gzip: decompressed to a temporary file, read from there, removed on close', async () => {
    const path = join(dir, 'a.sql.gz')
    writeFileSync(path, gzipSync(SQL))
    const before = tempCopies()
    const f = await ImportFile.open(path, SUPPORT)
    expect(f.compression).toBe('application/gzip')
    expect(tempCopies().length).toBe(before.length + 1)
    expect(readAll(f).text).toBe(SQL)
    f.close()
    expect(tempCopies()).toEqual(before)
  })

  it('bzip2 (several blocks) the same way', async () => {
    const path = join(import.meta.dirname, 'fixtures/stream.sql.bz2')
    const f = await ImportFile.open(path, SUPPORT)
    expect(f.compression).toBe('application/bzip2')
    expect(readAll(f).text).toBe(SQL)
    f.close()
  })

  it('a disabled or damaged compression rejects and leaves no temporary copy', async () => {
    const gz = join(dir, 'a.sql.gz')
    writeFileSync(gz, gzipSync(SQL))
    await expect(ImportFile.open(gz, { ...SUPPORT, gzip: false })).rejects.toThrow(/unsupported compression/)
    const bad = join(dir, 'bad.gz')
    writeFileSync(bad, Buffer.concat([gzipSync(SQL).subarray(0, 100), Buffer.from('garbage')]))
    const before = tempCopies()
    await expect(ImportFile.open(bad, SUPPORT)).rejects.toThrow()
    expect(tempCopies()).toEqual(before)
  })

  it('a charset conversion is applied to each chunk read from disk', async () => {
    const path = join(dir, 'a.sql')
    writeFileSync(path, 'abcdef')
    const f = await ImportFile.open(path, SUPPORT)
    f.convert((b) => Buffer.from(b.toString().toUpperCase()))
    expect([f.read(4).toString(), f.read(4).toString()]).toEqual(['ABCD', 'EF'])
    f.close()
  })
})

describe('Import::checkTimeout', () => {
  const importOf = (file: ImportFile) => {
    const runner: QueryRunner = {
      forceExecute: false,
      hasError: false,
      skipQueries: 0,
      clearError() {},
      async runQuery() {},
    }
    return new Import({
      dbi: {
        tryQuery: async () => ({ numRows: 0, firstValue: null }),
        quoteString: (s) => `'${s}'`,
        getTables: async () => [],
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
      file,
      readLimit: 1024,
      request: { get: () => undefined, has: () => false },
    })
  }

  it('no limit (maximumTime 0): never', () => {
    const imp = importOf(new ImportFile(Buffer.from(SQL), SUPPORT))
    imp.now = () => imp.timestamp + 10_000
    expect(imp.checkTimeout()).toBe(false)
  })

  it('5 seconds before maximumTime the reads stop and stay stopped', () => {
    const imp = importOf(new ImportFile(Buffer.from(SQL), SUPPORT))
    imp.maximumTime = 299
    let t = imp.timestamp
    imp.now = () => t
    expect(imp.getNextChunk()).toBeInstanceOf(Buffer)
    t += 294
    expect(imp.checkTimeout()).toBe(false)
    t += 1
    expect(imp.getNextChunk()).toBe(false)
    expect(imp.timeoutPassed).toBe(true)
    t = imp.timestamp
    expect(imp.checkTimeout()).toBe(true)
  })
})

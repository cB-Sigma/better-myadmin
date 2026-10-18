import { describe, expect, it } from 'vitest'
import { OutputHandler } from '../src/output.ts'

/**
 * Uncompressed output reaches the sink in chunks of about 64 KiB, not one write per line: a
 * 2M-row dump made 2M awaited writes (docs/architecture/17-large-data.md). The bytes are those
 * of the lines, in order.
 */
describe('OutputHandler: uncompressed writes', () => {
  it('collects lines into 64 KiB writes; finish() sends the rest', async () => {
    const writes: Buffer[] = []
    const out = new OutputHandler(
      { write: (b) => void writes.push(Buffer.from(b)) },
      { asFile: true, compression: '' },
    )
    const lines = Array.from({ length: 20000 }, (_, i) => `(${i}, 'value ${i}'),\n`)
    for (const l of lines) await out.addLine(l)
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((w) => w.length >= 64 * 1024)).toBe(true)
    await out.finish(false, 'x.sql')
    expect(Buffer.concat(writes).toString()).toBe(lines.join(''))
    expect(writes.length).toBeLessThan(lines.length / 100)
    expect(out.written).toBe(Buffer.byteLength(lines.join('')))
  })

  it('a short dump is one write at finish()', async () => {
    const writes: Buffer[] = []
    const out = new OutputHandler(
      { write: (b) => void writes.push(Buffer.from(b)) },
      { asFile: false, compression: '' },
    )
    await out.addLine('-- a\n')
    await out.addLine('SELECT 1;\n')
    expect(writes).toEqual([])
    await out.finish(false, 'x.sql')
    expect(writes.map(String)).toEqual(['-- a\nSELECT 1;\n'])
  })
})

import { describe, expect, it } from 'vitest'
import { dropExtension, isFileDrag } from './DragDropImport'
import { matchFormat, oneCharacter, uploadEstimate } from './ImportPage'

describe('import page behaviours (import.ts)', () => {
  it('picks the format from the file name, a compression suffix ignored [p07-50895c]', () => {
    const formats = ['csv', 'sql', 'xml']
    expect(matchFormat('C:\\fakepath\\Dump.SQL.gz', formats)).toBe('sql')
    expect(matchFormat('a.csv.zip', formats)).toBe('csv')
    expect(matchFormat('a.txt', formats)).toBeNull()
  })

  it('keeps one enclosure character unless the first is an escape [p07-22fafd]', () => {
    expect(oneCharacter('""')).toBe('"')
    expect(oneCharacter('\\"')).toBe('\\"')
    expect(oneCharacter("'")).toBe("'")
  })
})

describe('drag and drop import (drag_drop_import.ts)', () => {
  it('accepts sql, xml, ldi, mediawiki and shp, optionally compressed [p07-ca06b4]', () => {
    expect(dropExtension('a.sql.gz')).toBe('sql')
    expect(dropExtension('b.shp')).toBe('shp')
    expect(dropExtension('c.csv')).toBe('')
    expect(dropExtension('d.ods')).toBe('')
  })

  it('tells operating system file drags from browser-internal ones', () => {
    expect(isFileDrag(['Files'], false)).toBe(true)
    expect(isFileDrag(['Files', 'application/x-moz-file'], false)).toBe(true)
    expect(isFileDrag(['Files', 'text/uri-list', 'text/html'], false)).toBe(false)
    expect(isFileDrag(['Files', 'application/x-moz-nativeimage'], false)).toBe(false)
    expect(isFileDrag(['Files'], true)).toBe(false)
    expect(isFileDrag(['text/plain'], false)).toBe(false)
  })
})

describe('upload progress (import.ts performUpload)', () => {
  it('no estimate below 10 % and 2 MB; then the speed and the time left', () => {
    expect(uploadEstimate(5, 100, 1000)).toBeNull()
    expect(uploadEstimate(0, 100, 1000)).toBeNull()
    // 10 of 100 bytes in 2 s: 5 B/s, 90 bytes left → 18 s
    expect(uploadEstimate(10, 100, 2000)).toEqual({ bytesPerSecond: 5, minutes: 0, seconds: 18 })
    // 3 MB of 100 MB in 10 s: 97 MB left at 0.3 MB/s → 323 s = 5 min 23 s
    expect(uploadEstimate(3_000_000, 100_000_000, 10_000)).toEqual({
      bytesPerSecond: 300_000,
      minutes: 5,
      seconds: 23,
    })
  })
})

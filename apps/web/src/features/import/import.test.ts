import { describe, expect, it } from 'vitest'
import { dropExtension, isFileDrag } from './DragDropImport'
import { matchFormat, oneCharacter } from './ImportPage'

describe('import page behaviours (import.ts)', () => {
  it('picks the format from the file name, a compression suffix ignored', () => {
    const formats = ['csv', 'sql', 'xml']
    expect(matchFormat('C:\\fakepath\\Dump.SQL.gz', formats)).toBe('sql')
    expect(matchFormat('a.csv.zip', formats)).toBe('csv')
    expect(matchFormat('a.txt', formats)).toBeNull()
  })

  it('keeps one enclosure character unless the first is an escape', () => {
    expect(oneCharacter('""')).toBe('"')
    expect(oneCharacter('\\"')).toBe('\\"')
    expect(oneCharacter("'")).toBe("'")
  })
})

describe('drag and drop import (drag_drop_import.ts)', () => {
  it('accepts sql, xml, ldi, mediawiki and shp, optionally compressed', () => {
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

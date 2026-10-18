import { describe, expect, it } from 'vitest'
import { convertFromUtf8, encodeUtf7 } from '../src/charset.ts'

/** UTF-7 as glibc's iconv writes it (phpMyAdmin's Encoding::convertString with charset utf-7). */
describe('encodeUtf7', () => {
  it('closes a base64 run with "-" only before a base64 character or "-", and at the end', () => {
    // outputs of `iconv -f utf-8 -t utf-7` (glibc)
    expect(encodeUtf7('row number 2 éé\n')).toBe('row number 2 +AOkA6Q\n')
    expect(encodeUtf7('[\n')).toBe('+AFs\n')
    expect(encodeUtf7('{"type":"header","x":1}')).toBe('+AHsAIg-type+ACI:+ACI-header+ACI,+ACI-x+ACI:1+AH0-')
    expect(encodeUtf7('a+b')).toBe('a+-b')
    expect(encodeUtf7('😀x')).toBe('+2D3eAA-x')
    expect(encodeUtf7('é-')).toBe('+AOk--')
  })

  it('is the export conversion for utf-7', () => {
    expect(convertFromUtf8(Buffer.from('é;\n'), 'utf-7').toString('latin1')).toBe('+AOkAOw\n')
  })
})

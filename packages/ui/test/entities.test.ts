import { describe, expect, it } from 'vitest'
import { decodeEntities } from '../src/lib/entities.ts'

describe('decodeEntities (get_icon prints its text raw)', () => {
  it('named and numeric entities like the browser', () => {
    expect(decodeEntities('Запрос&nbsp;по&nbsp;шаблону')).toBe('Запрос по шаблону')
    expect(decodeEntities('Salva &amp; chiudi')).toBe('Salva & chiudi')
    expect(decodeEntities('об&#39;єм &#x41;&laquo;x&raquo;')).toBe("об'єм A«x»")
  })

  it('leaves plain text and unknown entities alone', () => {
    expect(decodeEntities('Query')).toBe('Query')
    expect(decodeEntities('a & b &unknown; &#0;')).toBe('a & b &unknown; &#0;')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { encodeBytes } from '../src/bytes.ts'
import { convertKanaKV, kanjiStrConv } from '../src/kanji.ts'

/**
 * The export's Kanji conversion against PHP 8.3's mbstring (fixtures/kanji-mbstring.json, made with
 * mb_convert_kana($s, 'KV', 'UTF-8') and mb_convert_encoding($s, 'SJIS' | 'EUC-JP', 'UTF-8')):
 * JIS X 0208 only (CP932 extensions are '?'), mbstring's own mappings of ¥ ‾ − 〜 ～ ‖ ¢ £ ¬.
 */
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/kanji-mbstring.json', import.meta.url), 'utf8'),
) as Array<Record<string, string>>
const hex = (s: string) => encodeBytes(s).toString('hex')

describe('Encoding::kanjiStrConv', () => {
  for (const f of fixtures) {
    const input = f.in as string
    it(JSON.stringify(input.slice(0, 30)), () => {
      expect(convertKanaKV(input)).toBe(f.kana)
      for (const enc of ['SJIS', 'EUC-JP']) {
        expect(hex(kanjiStrConv(input, enc, '')), enc).toBe(f[enc])
        expect(hex(kanjiStrConv(input, enc, 'kana')), `${enc}+kana`).toBe(f[`${enc}+kana`])
      }
    })
  }

  it('nothing to do without an encoding and Kana; raw bytes of a binary cell stay as they are', () => {
    expect(kanjiStrConv('日本語', '', '')).toBe('日本語')
    expect(kanjiStrConv('ｶﾞ', '', 'kana')).toBe('ガ')
    // 0xff 0xfe kept as escapes (bytes.ts), the text around them converted
    expect(hex(kanjiStrConv('語\udcff\udcfe語', 'SJIS', ''))).toBe('8ceafffe8cea')
  })
})

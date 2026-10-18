import iconv from 'iconv-lite'
import { decodeBytes } from './bytes.ts'

/**
 * Japanese (Kanji) conversion of the export output, `Encoding::kanjiStrConv`: optionally half-width
 * katakana to full-width (`mb_convert_kana($s, 'KV')`), then the text to EUC-JP or Shift_JIS. The
 * line is UTF-8 text here; phpMyAdmin guesses its encoding among ASCII, SJIS, EUC-JP and JIS, which
 * misreads UTF-8 Japanese as SJIS / EUC-JP (parity-exceptions.md Q66, not reproduced): an ASCII line
 * is the same either way. Bytes kept as escapes (binary cells, bytes.ts) are left as they are.
 * pma: src/Encoding.php::kanjiStrConv, src/Export/OutputHandler.php::addLine
 */
export function kanjiStrConv(line: string, enc: string, kana: string): string {
  if (enc === '' && kana === '') return line
  let out = ''
  // text runs between the escaped raw bytes (U+DC80–U+DCFF not part of a surrogate pair)
  for (const part of line.split(/((?<![\ud800-\udbff])[\udc80-\udcff]+)/)) {
    if (part === '') continue
    if (/^[\udc80-\udcff]+$/.test(part) && !/[\ud800-\udbff]/.test(part)) {
      out += part
      continue
    }
    let text = kana === 'kana' ? convertKanaKV(part) : part
    if ((enc === 'EUC-JP' || enc === 'SJIS') && /[\u0080-\uffff]/.test(text)) {
      text = decodeBytes(encodeJis(text, enc))
    }
    out += text
  }
  return out
}

/** half-width katakana U+FF61–U+FF9F → full-width (mb_convert_kana 'K') */
const HALF = '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ'
const FULL =
  '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜'
const VOICED: Record<string, string> = {
  ｶ: 'ガ',
  ｷ: 'ギ',
  ｸ: 'グ',
  ｹ: 'ゲ',
  ｺ: 'ゴ',
  ｻ: 'ザ',
  ｼ: 'ジ',
  ｽ: 'ズ',
  ｾ: 'ゼ',
  ｿ: 'ゾ',
  ﾀ: 'ダ',
  ﾁ: 'ヂ',
  ﾂ: 'ヅ',
  ﾃ: 'デ',
  ﾄ: 'ド',
  ﾊ: 'バ',
  ﾋ: 'ビ',
  ﾌ: 'ブ',
  ﾍ: 'ベ',
  ﾎ: 'ボ',
  ｳ: 'ヴ',
}
const SEMI_VOICED: Record<string, string> = { ﾊ: 'パ', ﾋ: 'ピ', ﾌ: 'プ', ﾍ: 'ペ', ﾎ: 'ポ' }

/** mb_convert_kana($s, 'KV'): half-width katakana to full-width, a following ﾞ / ﾟ merged (V) */
export function convertKanaKV(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    const next = s[i + 1]
    if (next === 'ﾞ' && VOICED[c] !== undefined) {
      out += VOICED[c]
      i++
      continue
    }
    if (next === 'ﾟ' && SEMI_VOICED[c] !== undefined) {
      out += SEMI_VOICED[c]
      i++
      continue
    }
    const k = HALF.indexOf(c)
    out += k === -1 ? c : (FULL[k] as string)
  }
  return out
}

/**
 * mbstring's SJIS / EUC-JP are JIS X 0208 (+ JIS X 0212 for EUC-JP) without the CP932 / eucJP-ms
 * extensions iconv-lite's tables have: their NEC / IBM rows become '?' like any character the
 * target cannot hold, and the few characters mbstring maps differently are mapped its way (both
 * checked against PHP 8.3's mb_convert_encoding for every BMP character).
 */
const OVERRIDES: Record<'SJIS' | 'EUC-JP', Record<number, string>> = {
  SJIS: {
    162: '8191',
    163: '8192',
    165: '818f',
    172: '81ca',
    175: '8150',
    8214: '8161',
    8254: '8150',
    8722: '817c',
    12316: '8160',
  },
  'EUC-JP': {
    162: 'a1f1',
    163: 'a1f2',
    165: '3f',
    172: 'a2cc',
    8214: 'a1c2',
    8254: 'a1b1',
    8722: 'a1dd',
    12316: 'a1c1',
    65374: 'a1c1',
  },
}
/** lead bytes of the CP932 (NEC row 13, NEC-selected IBM, IBM) and eucJP-ms extension rows */
const EXTENSION_LEADS: Record<'SJIS' | 'EUC-JP', Set<number>> = {
  SJIS: new Set([0x80, 0x87, 0xed, 0xee, 0xfa, 0xfb, 0xfc]),
  'EUC-JP': new Set([0xad, 0xf9, 0xfa, 0xfb, 0xfc]),
}
const QUESTION = Buffer.from('?')
const cache: Record<'SJIS' | 'EUC-JP', Map<string, Buffer>> = { SJIS: new Map(), 'EUC-JP': new Map() }

/** mb_convert_encoding($text, 'SJIS' | 'EUC-JP', 'UTF-8') */
export function encodeJis(text: string, enc: 'SJIS' | 'EUC-JP'): Buffer {
  const memo = cache[enc]
  const parts: Buffer[] = []
  for (const ch of text) {
    let b = memo.get(ch)
    if (b === undefined) {
      const cp = ch.codePointAt(0) as number
      const o = OVERRIDES[enc][cp]
      if (o !== undefined) b = Buffer.from(o, 'hex')
      else if (cp < 0x80) b = Buffer.from(ch, 'latin1')
      else {
        b = iconv.encode(ch, enc === 'SJIS' ? 'Shift_JIS' : 'EUC-JP')
        if (b.length > 0 && EXTENSION_LEADS[enc].has(b[0] as number)) b = QUESTION
      }
      memo.set(ch, b)
    }
    parts.push(b)
  }
  return Buffer.concat(parts)
}

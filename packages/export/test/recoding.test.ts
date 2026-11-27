import { describe, expect, it } from 'vitest'
import {
  RecodeError,
  type Recoding,
  convertFromUtf8,
  convertToUtf8,
  encodingSupported,
  iconvMode,
  listEncodings,
  recoding,
  recodingSupported,
} from '../src/index.ts'

/**
 * `$cfg['IconvExtraParams']` and `$cfg['RecodingEngine']` as glibc iconv / mbstring read them, so
 * export and import treat a character that does not fit the charset the way phpMyAdmin's
 * Encoding::convertString does. Expectations verified against PHP 8.3 `iconv()` / `mb_convert_encoding()`.
 */
const iconv = (mode: Recoding['mode']): Recoding => ({ engine: 'iconv', mode })
const MB: Recoding = { engine: 'mbstring', mode: 'translit' }

describe('iconvMode (glibc suffix grammar)', () => {
  it('reads the TRANSLIT / IGNORE flags phpMyAdmin appends', () => {
    expect(iconvMode('//TRANSLIT')).toBe('translit')
    expect(iconvMode('//IGNORE')).toBe('ignore')
    expect(iconvMode('//TRANSLIT//IGNORE')).toBe('translit') // TRANSLIT wins over IGNORE
    expect(iconvMode('//IGNORE,TRANSLIT')).toBe('translit') // comma-separated, order-independent
    expect(iconvMode('//translit')).toBe('translit') // TRANSLIT is case-insensitive in glibc
  })
  it('is strict without a // suffix', () => {
    expect(iconvMode('')).toBe('strict')
    expect(iconvMode('TRANSLIT')).toBe('strict') // not appended at all (no leading //)
    expect(iconvMode('//')).toBe('strict') // empty flag list
  })
  it('is invalid for an unrecognised // suffix (iconv_open fails)', () => {
    expect(iconvMode('//FOO')).toBe('invalid')
    expect(iconvMode('// ')).toBe('invalid')
    expect(iconvMode('//ignore')).toBe('invalid') // IGNORE is case-sensitive in glibc
  })
})

describe('recoding engine selection (Encoding::initEngine)', () => {
  it('uses mbstring only for an explicit mb (stored mbstring), iconv for everything else', () => {
    expect(recoding({ RecodingEngine: 'mbstring', IconvExtraParams: '//TRANSLIT' }).engine).toBe('mbstring')
    for (const e of ['auto', 'iconv', 'none']) {
      expect(recoding({ RecodingEngine: e, IconvExtraParams: '//TRANSLIT' }).engine).toBe('iconv')
    }
  })
  it('isSupported() is always true — none still recodes through iconv (X52)', () => {
    expect(recodingSupported('none')).toBe(true)
    expect(recodingSupported('auto')).toBe(true)
  })
})

describe('convertFromUtf8 (export, utf-8 → charset)', () => {
  const win1252 = (s: string, r: Recoding) => convertFromUtf8(Buffer.from(s, 'utf8'), 'windows-1252', r)
  const latin1 = (s: string, r: Recoding) => convertFromUtf8(Buffer.from(s, 'utf8'), 'iso-8859-1', r)
  it('translit approximates, else ?', () => {
    expect(win1252('é 😀 ✓', iconv('translit'))).toEqual(
      Buffer.from([0xe9, 0x20, 0x3a, 0x2d, 0x44, 0x20, 0x3f]),
    )
  })
  it('ignore drops the unmappable characters', () => {
    expect(latin1('a€b中c', iconv('ignore'))).toEqual(Buffer.from('abc', 'latin1'))
  })
  it('strict throws (iconv returns false on the first unmappable character)', () => {
    expect(() => latin1('a€b', iconv('strict'))).toThrow(RecodeError)
    expect(() => latin1('a€b', iconv('invalid'))).toThrow(RecodeError)
    expect(latin1('abc', iconv('strict'))).toEqual(Buffer.from('abc', 'latin1')) // all-mappable is fine
  })
  it('mbstring substitutes ? and never throws', () => {
    expect(latin1('a€b中cé', MB)).toEqual(Buffer.from([0x61, 0x3f, 0x62, 0x3f, 0x63, 0xe9]))
  })
})

describe('convertToUtf8 (import, charset → utf-8)', () => {
  const b = (...bytes: number[]) => Buffer.from(bytes)
  it('decodes a defined byte (windows-1252 0x80 is €)', () => {
    expect(convertToUtf8(b(0x61, 0x80, 0x62), 'windows-1252', iconv('translit')).toString('utf8')).toBe('a€b')
    expect(convertToUtf8(b(0xe9), 'iso-8859-1', iconv('translit')).toString('utf8')).toBe('é')
  })
  it('a byte the charset does not define fails under translit / strict (phpMyAdmin dies, X52)', () => {
    // 0x81 is undefined in windows-1252; //TRANSLIT does not rescue invalid *input*
    expect(() => convertToUtf8(b(0x61, 0x81, 0x62), 'windows-1252', iconv('translit'))).toThrow(RecodeError)
    expect(() => convertToUtf8(b(0x61, 0x81, 0x62), 'windows-1252', iconv('strict'))).toThrow(RecodeError)
  })
  it('ignore drops it, mbstring substitutes ?', () => {
    expect(convertToUtf8(b(0x61, 0x81, 0x62), 'windows-1252', iconv('ignore')).toString('utf8')).toBe('ab')
    expect(convertToUtf8(b(0x61, 0x81, 0x62), 'windows-1252', MB).toString('utf8')).toBe('a?b')
  })
})

describe('listEncodings (Encoding::listEncodings, upstream c916636459)', () => {
  // the default $cfg['AvailableCharsets']; the missing ones were probed with PHP 8.3 / glibc:
  // `@iconv($c, 'utf-8', '') === false` and `mb_convert_encoding('', 'utf-8', $c)` raising ValueError
  const AVAILABLE = [
    'iso-8859-1',
    'iso-8859-2',
    'iso-8859-3',
    'iso-8859-4',
    'iso-8859-5',
    'iso-8859-6',
    'iso-8859-7',
    'iso-8859-8',
    'iso-8859-9',
    'iso-8859-10',
    'iso-8859-11',
    'iso-8859-12',
    'iso-8859-13',
    'iso-8859-14',
    'iso-8859-15',
    'windows-1250',
    'windows-1251',
    'windows-1252',
    'windows-1256',
    'windows-1257',
    'koi8-r',
    'big5',
    'gb2312',
    'utf-16',
    'utf-8',
    'utf-7',
    'x-user-defined',
    'euc-jp',
    'ks_c_5601-1987',
    'tis-620',
    'SHIFT_JIS',
    'SJIS',
    'SJIS-win',
  ]
  const without = (gone: string[]) => AVAILABLE.filter((c) => !gone.includes(c))

  it('lists what glibc iconv converts from', () => {
    expect(listEncodings(AVAILABLE, 'iconv')).toEqual(
      without(['iso-8859-12', 'x-user-defined', 'ks_c_5601-1987']),
    )
  })

  it('lists what mbstring converts from', () => {
    expect(listEncodings(AVAILABLE, 'mbstring')).toEqual(
      without([
        'iso-8859-11',
        'iso-8859-12',
        'windows-1250',
        'windows-1256',
        'windows-1257',
        'x-user-defined',
        'ks_c_5601-1987',
        'tis-620',
      ]),
    )
  })

  it('matches names the way each engine does, and still leaves ISO-2022-CN-EXT out', () => {
    expect(encodingSupported('Iso-8859-1', 'iconv')).toBe(true)
    expect(encodingSupported('ISO_8859-1', 'iconv')).toBe(true)
    expect(encodingSupported('latin1', 'iconv')).toBe(true)
    expect(encodingSupported('no-such-charset', 'iconv')).toBe(false)
    expect(encodingSupported('Windows-1252', 'mbstring')).toBe(true)
    expect(encodingSupported('sjis-win', 'mbstring')).toBe(true)
    expect(encodingSupported('ISO-2022-CN-EXT', 'iconv')).toBe(true)
    expect(listEncodings(['ISO-2022-CN-EXT', 'utf-8'], 'iconv')).toEqual(['utf-8'])
  })
})

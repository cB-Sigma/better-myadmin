import iconv from 'iconv-lite'
import translit from './generated/translit.json' with { type: 'json' }

/** pma: src/Charsets.php::$mysqlCharsetMap (file charset → MySQL charset for SET NAMES) */
export const MYSQL_CHARSET_MAP: Readonly<Record<string, string>> = {
  big5: 'big5',
  'cp-866': 'cp866',
  'euc-jp': 'ujis',
  'euc-kr': 'euckr',
  gb2312: 'gb2312',
  gbk: 'gbk',
  'iso-8859-1': 'latin1',
  'iso-8859-2': 'latin2',
  'iso-8859-7': 'greek',
  'iso-8859-8': 'hebrew',
  'iso-8859-8-i': 'hebrew',
  'iso-8859-9': 'latin5',
  'iso-8859-13': 'latin7',
  'iso-8859-15': 'latin1',
  'koi8-r': 'koi8r',
  shift_jis: 'sjis',
  'tis-620': 'tis620',
  'utf-8': 'utf8',
  'windows-1250': 'cp1250',
  'windows-1251': 'cp1251',
  'windows-1252': 'latin1',
  'windows-1256': 'cp1256',
  'windows-1257': 'cp1257',
}

/** The engine phpMyAdmin would use for RecodingEngine (iconv is always available here). */
export function recodingSupported(engine: string): boolean {
  return engine !== 'none'
}

/**
 * Encoding::listEncodings(): AvailableCharsets without ISO-2022-CN-EXT (CVE-2024-2961).
 * (iconv engine: the configured list as is.)
 */
export function listEncodings(available: readonly string[]): string[] {
  return available.filter((charset) => {
    const n = charset.replace(/[^A-Za-z0-9\-/]/g, '').toUpperCase()
    return !n.includes('ISO-2022-CN-EXT') && !n.includes('ISO2022CNEXT')
  })
}

/** Whether iconv-lite can encode to `charset` (x-user-defined and utf-7 are mapped). */
export function canEncode(charset: string): boolean {
  return iconv.encodingExists(mapName(charset))
}

function mapName(charset: string): string {
  const c = charset.toLowerCase()
  if (c === 'x-user-defined') return 'latin1'
  if (c === 'ks_c_5601-1987') return 'euc-kr'
  if (c === 'sjis' || c === 'sjis-win') return 'shift_jis'
  return c
}

/**
 * Encoding::convertString('utf-8', $charset, $what) on bytes. Unconvertible characters become `?`
 * (glibc iconv with //TRANSLIT approximates some of them instead).
 */
export function convertFromUtf8(bytes: Buffer, charset: string): Buffer {
  const c = charset.toLowerCase()
  if (c === 'utf-7') return Buffer.from(encodeUtf7(iconv.decode(bytes, 'utf8')), 'latin1')
  if (c === 'utf-8' || !canEncode(c)) return bytes
  const name = mapName(c)
  let cache = encodable.get(name)
  if (cache === undefined) {
    cache = new Map()
    encodable.set(name, cache)
  }
  let out = ''
  for (const ch of iconv.decode(bytes, 'utf8')) {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x80) {
      out += ch
      continue
    }
    let ok = cache.get(cp)
    if (ok === undefined) {
      ok = iconv.decode(iconv.encode(ch, name), name) === ch
      cache.set(cp, ok)
    }
    // like iconv //TRANSLIT: glibc's ASCII transliteration, else '?'
    out += ok ? ch : (TRANSLIT[cp.toString(16)] ?? '?')
  }
  return iconv.encode(out, name)
}

const TRANSLIT = translit as Record<string, string>
const encodable = new Map<string, Map<number, boolean>>()

/** Encoding::convertString($charset, 'utf-8', $what) on bytes (import). */
export function convertToUtf8(bytes: Buffer, charset: string): Buffer {
  const c = charset.toLowerCase()
  if (c === 'utf-8' || !canEncode(c)) return bytes
  return Buffer.from(iconv.decode(bytes, mapName(c)), 'utf8')
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** glibc's DIRECT_TAB: RFC 2152 set D, space, tab, CR and LF are written as they are */
const isDirect = (c: string) => /^[A-Za-z0-9'(),\-./:? \t\n\r]$/.test(c)
/** a character that would continue a base64 run: the run is closed by an explicit '-' before it */
const isXBase64 = (c: string) => /^[A-Za-z0-9+/-]$/.test(c)

/**
 * UTF-7 as glibc's iconv writes it (iconv-lite's codec differs): the optional direct characters
 * (`!"#$%&*;<=>@[]^_\`{|}`) go into base64, a base64 run is closed with '-' only when the next
 * character could continue it, and at the end of the converted string; '+' is "+-".
 * glibc: iconvdata/utf-7.c
 */
export function encodeUtf7(s: string): string {
  let out = ''
  let inB64 = false
  let bits = 0
  let nbits = 0
  const close = (next: string | null) => {
    if (nbits > 0) out += B64[(bits << (6 - nbits)) & 63]
    if (next === null || isXBase64(next)) out += '-'
    inB64 = false
    bits = 0
    nbits = 0
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (isDirect(c)) {
      if (inB64) close(c)
      out += c
      continue
    }
    if (c === '+' && !inB64) {
      out += '+-'
      continue
    }
    if (!inB64) {
      out += '+'
      inB64 = true
    }
    bits = (bits << 16) | s.charCodeAt(i)
    nbits += 16
    while (nbits >= 6) {
      nbits -= 6
      out += B64[(bits >> nbits) & 63]
    }
    bits &= (1 << nbits) - 1
  }
  if (inB64) close(null)
  return out
}

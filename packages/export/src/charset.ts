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

/**
 * Encoding::isSupported(). phpMyAdmin picks a recoding engine from `$cfg['RecodingEngine']`
 * (`initEngine`): the configured one if its PHP function exists, else it autodetects iconv then
 * mbstring, else `none`. iconv-lite is always present here, so a usable engine is always found —
 * even for `RecodingEngine = 'none'`, whose `isset` "function" does not exist, so phpMyAdmin falls
 * through to iconv too (and only adds a "the none extension is missing" notice, which is n/a for us:
 * there is no PHP extension layer). `isSupported()` is therefore always true (X52).
 */
export function recodingSupported(_engine?: string): boolean {
  return true
}

/** How `$cfg['IconvExtraParams']` tells glibc iconv to treat a character absent from the target. */
export type ConvMode =
  /** `//TRANSLIT`: an ASCII approximation (glibc's transliteration tables), else `?` */
  | 'translit'
  /** `//IGNORE`: drop it */
  | 'ignore'
  /** no `//` suffix: any such character fails the whole conversion (iconv returns false) */
  | 'strict'
  /** an unrecognised `//` suffix: iconv_open itself fails, so every conversion fails */
  | 'invalid'

/** The recoding engine and mode a request runs with. */
export interface Recoding {
  engine: 'iconv' | 'mbstring'
  mode: ConvMode
}

/** The default phpMyAdmin ships: autodetected iconv with `IconvExtraParams = '//TRANSLIT'`. */
export const DEFAULT_RECODING: Recoding = { engine: 'iconv', mode: 'translit' }

/** A character cannot be converted and the mode does not tolerate it: phpMyAdmin dies here (X52). */
export class RecodeError extends Error {
  constructor(message = 'Charset conversion failed.') {
    super(message)
    this.name = 'RecodeError'
  }
}

/**
 * glibc's reading of `$cfg['IconvExtraParams']`, which phpMyAdmin appends to the target charset
 * only when it starts with `//` (Encoding::convertString). After the `//`, glibc splits the flags
 * on `/` and `,`: `TRANSLIT` is matched case-insensitively, `IGNORE` only upper-case, and any other
 * non-empty token makes iconv_open fail. `TRANSLIT` wins when both are present.
 */
export function iconvMode(extra: string): ConvMode {
  if (!extra.startsWith('//')) return 'strict'
  let translit = false
  let ignore = false
  for (const token of extra.slice(2).split(/[/,]/)) {
    if (token === '') continue
    if (token.toUpperCase() === 'TRANSLIT') translit = true
    else if (token === 'IGNORE') ignore = true
    else return 'invalid'
  }
  return translit ? 'translit' : ignore ? 'ignore' : 'strict'
}

/** The Recoding of a request's settings (`RecodingEngine` + `IconvExtraParams`). */
export function recoding(settings: { RecodingEngine: string; IconvExtraParams: string }): Recoding {
  return {
    // only an explicit `mb` (stored as `mbstring`) selects mbstring; auto / iconv / none all land on
    // iconv in a runtime where iconv is present (Encoding::initEngine order is iconv, then mbstring)
    engine: settings.RecodingEngine === 'mbstring' ? 'mbstring' : 'iconv',
    mode: iconvMode(settings.IconvExtraParams),
  }
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
 * Encoding::convertString('utf-8', $charset, $what) on bytes (export). A character absent from the
 * target charset is handled per `rec` (IconvExtraParams): approximated (`translit`, the default),
 * dropped (`ignore`), or — for `strict`/`invalid` — it throws {@link RecodeError}, where phpMyAdmin
 * dies with an uncaught TypeError (X52). The mbstring engine always substitutes `?` (never throws).
 */
export function convertFromUtf8(bytes: Buffer, charset: string, rec: Recoding = DEFAULT_RECODING): Buffer {
  const c = charset.toLowerCase()
  if (c === 'utf-7') return Buffer.from(encodeUtf7(iconv.decode(bytes, 'utf8')), 'latin1')
  if (c === 'utf-8' || !canEncode(c)) return bytes
  const name = mapName(c)
  let cache = encodable.get(name)
  if (cache === undefined) {
    cache = new Map()
    encodable.set(name, cache)
  }
  // an unrecognised //suffix (invalid) fails iconv_open: nothing converts, whatever the input
  if (rec.engine === 'iconv' && rec.mode === 'invalid') throw new RecodeError()
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
    if (ok) {
      out += ch
      continue
    }
    if (rec.engine === 'mbstring')
      out += '?' // mb_convert_encoding's substitute character
    else if (rec.mode === 'translit') out += TRANSLIT[cp.toString(16)] ?? '?'
    else if (rec.mode === 'ignore') continue
    else throw new RecodeError() // strict: iconv returns false on the first unmappable character
  }
  return iconv.encode(out, name)
}

const TRANSLIT = translit as Record<string, string>
const encodable = new Map<string, Map<number, boolean>>()
/** iconv-lite's substitution character for a byte the source charset does not define. */
const REPLACEMENT = '�'

/**
 * Encoding::convertString($charset, 'utf-8', $what) on bytes (import). A byte the source charset
 * does not define is tolerated only by `//IGNORE` (it is dropped); `translit`, `strict` and
 * `invalid` all make iconv return false on it, so this throws {@link RecodeError} (phpMyAdmin dies,
 * X52). The mbstring engine substitutes `?` (never throws). //TRANSLIT does not rescue invalid
 * *input* — it only approximates unmappable *output* — so a bad byte fails under the default too.
 */
export function convertToUtf8(bytes: Buffer, charset: string, rec: Recoding = DEFAULT_RECODING): Buffer {
  const c = charset.toLowerCase()
  if (c === 'utf-8' || !canEncode(c)) return bytes
  if (rec.engine === 'iconv' && rec.mode === 'invalid') throw new RecodeError()
  const decoded = iconv.decode(bytes, mapName(c))
  if (!decoded.includes(REPLACEMENT)) return Buffer.from(decoded, 'utf8')
  // the source held bytes the charset does not define
  if (rec.engine === 'mbstring') return Buffer.from(decoded.replaceAll(REPLACEMENT, '?'), 'utf8')
  if (rec.mode === 'ignore') return Buffer.from(decoded.replaceAll(REPLACEMENT, ''), 'utf8')
  throw new RecodeError()
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

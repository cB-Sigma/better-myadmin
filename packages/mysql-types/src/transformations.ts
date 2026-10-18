/**
 * Browser display (output) and input transformations: the plugin catalog, option parsing and each
 * plugin's applyTransformation as a pure function returning the HTML phpMyAdmin renders.
 *
 * pma: src/Transformations.php (getOptions, getAvailableMimeTypes, fixUpMime)
 *      src/Plugins/TransformationsPlugin.php::getOptions, src/Plugins/IOTransformationsPlugin.php
 *      src/Plugins/Transformations/** (every concrete plugin and its Abs/* base)
 *      src/Config/Settings/Transformations.php ($cfg['DefaultTransformations'])
 */

import { N_ } from '@bettermyadmin/i18n'
import { checkLink as sanitizeCheckLink } from '@bettermyadmin/i18n/bbcode'
import { bin2hex, htmlspecialchars, toBytes } from './php.ts'

export type TransformationKind = 'output' | 'input' | 'both'

export interface TransformationPlugin {
  /** file path below src/Plugins/Transformations without `.php`, e.g. `Output/Text_Plain_Dateformat` */
  file: string
  /** `getName()` */
  name: string
  /** `getMIMEType()/getMIMESubtype()` from the file name, e.g. `Text/Plain` */
  mimetype: string
  /** the file-name part after the MIME type, e.g. `Dateformat` (overview label `Text/Plain: Dateformat`) */
  label: string
  kind: TransformationKind
  /** `getInfo()` msgid (translated by the caller) */
  info: string
}

const INFO = {
  download: N_(
    'Displays a link to download the binary data of the column. You can use the option to specify the filename.',
  ),
  hex: N_(
    'Displays hexadecimal representation of data. Optional first parameter specifies how often space will be added (defaults to 2 nibbles).',
  ),
  inline: N_(
    'Displays a clickable thumbnail. The options are the maximum width and height in pixels. The original aspect ratio is preserved.',
  ),
  imageLink: N_('Displays a link to download this image.'),
  sql: N_('Formats text as SQL query with syntax highlighting.'),
  binaryToIp: N_(
    'Converts an Internet network address stored as a binary string into a string in Internet standard (IPv4/IPv6) format.',
  ),
  bool2text: N_(
    "Converts Boolean values to text (default 'T' and 'F'). First option is for TRUE, second for FALSE. Nonzero=true.",
  ),
  dateFormat: N_(
    'Displays a TIME, TIMESTAMP, DATETIME or numeric unix timestamp column as formatted date. The first option is the offset (in hours) which will be added to the timestamp (Default: 0). Use second option to specify a different date/time format string. Third option determines whether you want to see local date or UTC one (use "local" or "utc" strings) for that. According to that, date format has different value - for "local" see the documentation for PHP\'s strftime() function and for "utc" it is done using gmdate() function.',
  ),
  external: N_(
    'LINUX ONLY: Launches an external application and feeds it the column data via standard input. Returns the standard output of the application. The default is Tidy, to pretty-print HTML code. For security reasons, you have to manually edit the file src/Plugins/Transformations/Abs/ExternalTransformationsPlugin.php and list the tools you want to make available. The first option is then the number of the program you want to use. The second option should be blank for historical reasons. The third option, if set to 1, will convert the output using htmlspecialchars() (Default 1). The fourth option, if set to 1, will prevent wrapping and ensure that the output appears all on one line (Default 1).',
  ),
  formatted: N_(
    'Displays the contents of the column as-is, without running it through htmlspecialchars(). That is, the column is assumed to contain valid HTML.',
  ),
  textImageLink: N_(
    'Displays an image and a link; the column contains the filename. The first option is a URL prefix like "https://www.example.com/". The second and third options are the width and the height in pixels.',
  ),
  json: N_('Formats text as JSON with syntax highlighting.'),
  xml: N_('Formats text as XML with syntax highlighting.'),
  textLink: N_(
    'Displays a link; the column contains the filename. The first option is a URL prefix like "https://www.example.com/". The second option is a title for the link.',
  ),
  longToIp: N_(
    'Converts an (IPv4) Internet network address stored as a BIGINT into a string in Internet standard dotted format.',
  ),
  preApPend: N_(
    'Prepends and/or Appends text to a string. First option is text to be prepended, second is appended (enclosed in single quotes, default empty string).',
  ),
  substring: N_(
    'Displays a part of a string. The first option is the number of characters to skip from the beginning of the string (Default 0). The second option is the number of characters to return (Default: until end of string). The third option is the string to append and/or prepend when truncation occurs (Default: "…").',
  ),
  imageUpload: N_(
    'Image upload functionality which also displays a thumbnail. The options are the width and height of the thumbnail in pixels. Defaults to 100 X 100.',
  ),
  fileUpload: N_('File upload functionality for TEXT columns. It does not have a textarea for input.'),
  ipToBinary: N_('Converts an Internet network address in (IPv4/IPv6) format to binary'),
  ipToLong: N_('Converts an Internet network address in (IPv4/IPv6) format into a long integer.'),
  jsonEditor: N_('Syntax highlighted CodeMirror editor for JSON.'),
  regex: N_(
    'Validates the string using regular expression and performs insert only if string matches it. The first option is the Regular Expression.',
  ),
  sqlEditor: N_('Syntax highlighted CodeMirror editor for SQL.'),
  xmlEditor: N_('Syntax highlighted CodeMirror editor for XML (and HTML).'),
} as const

function plugin(file: string, name: string, kind: TransformationKind, info: string): TransformationPlugin {
  const base = file.split('/').pop() ?? file
  const [a = '', b = '', c = ''] = base.split('_')
  return { file, name, mimetype: `${a}/${b}`, label: c, kind, info }
}

/**
 * Every plugin, in the order getAvailableMimeTypes discovers them (directories Input/, Output/,
 * then the root, each sorted by file name).
 */
export const TRANSFORMATION_PLUGINS: readonly TransformationPlugin[] = [
  plugin('Input/Image_JPEG_Upload', 'Image upload', 'input', INFO.imageUpload),
  plugin('Input/Text_Plain_FileUpload', 'Text file upload', 'input', INFO.fileUpload),
  plugin('Input/Text_Plain_Iptobinary', 'IPv4/IPv6 To Binary', 'input', INFO.ipToBinary),
  plugin('Input/Text_Plain_Iptolong', 'IPv4/IPv6 To Long', 'input', INFO.ipToLong),
  plugin('Input/Text_Plain_JsonEditor', 'JSON', 'input', INFO.jsonEditor),
  plugin('Input/Text_Plain_RegexValidation', 'Regex Validation', 'input', INFO.regex),
  plugin('Input/Text_Plain_SqlEditor', 'SQL', 'input', INFO.sqlEditor),
  plugin('Input/Text_Plain_XmlEditor', 'XML', 'input', INFO.xmlEditor),
  plugin('Output/Application_Octetstream_Download', 'Download', 'output', INFO.download),
  plugin('Output/Application_Octetstream_Hex', 'Hex', 'output', INFO.hex),
  plugin('Output/Image_JPEG_Inline', 'Inline', 'output', INFO.inline),
  plugin('Output/Image_JPEG_Link', 'ImageLink', 'output', INFO.imageLink),
  plugin('Output/Image_PNG_Inline', 'Inline', 'output', INFO.inline),
  plugin('Output/Text_Octetstream_Sql', 'SQL', 'output', INFO.sql),
  plugin('Output/Text_Plain_Binarytoip', 'Binary To IPv4/IPv6', 'output', INFO.binaryToIp),
  plugin('Output/Text_Plain_Bool2Text', 'Bool2Text', 'output', INFO.bool2text),
  plugin('Output/Text_Plain_Dateformat', 'Date Format', 'output', INFO.dateFormat),
  plugin('Output/Text_Plain_External', 'External', 'output', INFO.external),
  plugin('Output/Text_Plain_Formatted', 'Formatted', 'output', INFO.formatted),
  plugin('Output/Text_Plain_Imagelink', 'Image Link', 'output', INFO.textImageLink),
  plugin('Output/Text_Plain_Json', 'JSON', 'output', INFO.json),
  plugin('Output/Text_Plain_Sql', 'SQL', 'output', INFO.sql),
  plugin('Output/Text_Plain_Xml', 'XML', 'output', INFO.xml),
  plugin('Text_Plain_Link', 'TextLink', 'both', INFO.textLink),
  plugin('Text_Plain_Longtoipv4', 'Long To IPv4', 'both', INFO.longToIp),
  plugin('Text_Plain_PreApPend', 'PreApPend', 'both', INFO.preApPend),
  plugin('Text_Plain_Substring', 'Substring', 'both', INFO.substring),
]

/** Transformations::getAvailableMimeTypes as the overview page shows it */
export function getAvailableMimeTypes(): {
  mimetype: string[]
  transformation: TransformationPlugin[]
  input_transformation: TransformationPlugin[]
} {
  const mimetype: string[] = []
  const transformation: TransformationPlugin[] = []
  const input: TransformationPlugin[] = []
  for (const p of TRANSFORMATION_PLUGINS) {
    if (!mimetype.includes(p.mimetype)) mimetype.push(p.mimetype)
    if (p.kind === 'input') input.push(p)
  }
  for (const p of TRANSFORMATION_PLUGINS) if (p.kind !== 'input') transformation.push(p)
  for (const p of TRANSFORMATION_PLUGINS) if (p.kind === 'both') input.push(p)
  return { mimetype, transformation, input_transformation: input }
}

/**
 * The plugin of a stored transformation file (`Output/Text_Plain_Dateformat.php`,
 * `input/image_jpeg_upload.php`...). PHP class lookup is case-insensitive, so is this.
 * pma: Transformations::getPluginInstance
 */
export function findTransformationPlugin(file: string): TransformationPlugin | null {
  const key = file
    .replace(/\.php$/i, '')
    .replaceAll('\\', '/')
    .toLowerCase()
  return TRANSFORMATION_PLUGINS.find((p) => p.file.toLowerCase() === key) ?? null
}

/** `$cfg['DefaultTransformations']` (pma: src/Config/Settings/Transformations.php) */
export interface DefaultTransformations {
  Substring: [number | string, number | string, string]
  Bool2Text: [string, string]
  External: [number | string, string, number | string, number | string]
  PreApPend: [string, string]
  Hex: [number | string]
  DateFormat: [number | string, string, string]
  Inline: [number | string, number | string]
  TextImageLink: [string | null, number | string, number | string]
  TextLink: [string | null, string | null, boolean | string | null]
}

export const DEFAULT_TRANSFORMATIONS: DefaultTransformations = {
  Substring: [0, 'all', '…'],
  Bool2Text: ['T', 'F'],
  External: [0, '-f /dev/null -i -wrap -q', 1, 1],
  PreApPend: ['', ''],
  Hex: ['2'],
  DateFormat: [0, '', 'local'],
  Inline: ['100', 100],
  TextImageLink: [null, 100, 50],
  TextLink: [null, null, null],
}

/**
 * Splits an option string on commas; single-quoted parts may contain commas, quotes and
 * backslashes are stripped.
 * pma: Transformations::getOptions
 */
export function parseTransformationOptions(optionString: string): string[] {
  if (optionString === '') return []
  const parts = optionString.split(',')
  const result: string[] = []
  let option: string | undefined
  // biome-ignore lint/suspicious/noAssignInExpressions: mirrors the PHP loop
  while ((option = parts.shift()) !== undefined) {
    const trimmed = phpTrim(option)
    if (trimmed.length > 1 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
      option = Array.from(trimmed).slice(1, -1).join('')
    } else if (trimmed.startsWith("'")) {
      let acc = ltrimWs(option)
      let rtrimmed = ''
      let next: string | undefined
      // biome-ignore lint/suspicious/noAssignInExpressions: mirrors the PHP loop
      while ((next = parts.shift()) !== undefined) {
        acc += `,${next}`
        rtrimmed = rtrimWs(acc)
        if (rtrimmed.endsWith("'")) break
      }
      option = Array.from(rtrimmed).slice(1, -1).join('')
    }
    result.push(stripslashes(option))
  }
  return result
}

/** PHP trim's default character list: space, \t, \n, \r, \0, \x0B */
const WS = ' \t\n\r\u0000\u000b'
const ltrimWs = (s: string) => {
  let i = 0
  while (i < s.length && WS.includes(s[i] as string)) i++
  return s.slice(i)
}
const rtrimWs = (s: string) => {
  let i = s.length
  while (i > 0 && WS.includes(s[i - 1] as string)) i--
  return s.slice(0, i)
}
const phpTrim = (s: string) => rtrimWs(ltrimWs(s))

/** PHP stripslashes */
export function stripslashes(s: string): string {
  return s.replace(/\\(.?)/gs, (_, c: string) => (c === '0' ? '\0' : c))
}

/** pma: TransformationsPlugin::getOptions — defaults filled in where the option is missing or '' */
export function withDefaults<T extends readonly unknown[]>(
  options: readonly string[],
  defaults: T,
): unknown[] {
  return defaults.map((d, i) => {
    const o = options[i]
    return o !== undefined && o !== '' ? o : d
  })
}

/** What a plugin needs besides the cell value. */
export interface TransformContext {
  /** FieldMetadata of the column (Dateformat: INT columns; Binarytoip: binary flag) */
  meta?: { isInt?: boolean; isBinary?: boolean }
  /**
   * URL of /transformation/wrapper for this cell with extra parameters (`ct`, `cn`, `resize`,
   * `newWidth`, `newHeight`); null when the cell has no wrapper link.
   */
  wrapperUrl?: (extra?: Record<string, string>) => string
  /** `$cfg['DefaultTransformations']` */
  defaults?: DefaultTransformations
  /** `__()` */
  t?: (msgid: string) => string
  /** Config::isGd2Available — the Inline plugin requests resized thumbnails */
  gd2?: boolean
  /** Util::localisedDate for the Dateformat plugin (format with strftime-like specifiers) */
  localisedDate?: (date: Date, format: string) => string
}

const utf8 = new TextDecoder('utf-8')
const asText = (b: string | Uint8Array): string => (typeof b === 'string' ? b : utf8.decode(b))
const esc = (s: string) => htmlspecialchars(s)

/** pma: Sanitize::checkLink(url, http = true, other = true) */
const checkLink = (url: string): boolean => sanitizeCheckLink(url, true, true)

/** pma: FormatConverter::longToIp */
export function longToIp(buffer: string): string {
  if (!/^\d+$/.test(buffer)) return buffer
  const n = Number(buffer)
  if (n < 0 || n > 4294967295) return buffer
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

/** PHP ip2long */
export function ip2long(ip: string): number | false {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (m === null) return false
  const parts = m.slice(1).map(Number)
  if (parts.some((p) => p > 255)) return false
  return (
    (((parts[0] as number) << 24) >>> 0) +
    ((parts[1] as number) << 16) +
    ((parts[2] as number) << 8) +
    (parts[3] as number)
  )
}

/** PHP inet_pton */
export function inetPton(ip: string): Uint8Array | false {
  if (ip2long(ip) !== false) {
    return Uint8Array.from(ip.split('.').map(Number))
  }
  if (!ip.includes(':')) return false
  let head = ip
  let v4: number[] = []
  const lastColon = ip.lastIndexOf(':')
  if (ip.slice(lastColon + 1).includes('.')) {
    const tail = ip.slice(lastColon + 1)
    if (ip2long(tail) === false) return false
    v4 = tail.split('.').map(Number)
    head = `${ip.slice(0, lastColon + 1)}0:0`
  }
  const dbl = head.split('::')
  if (dbl.length > 2) return false
  const left = dbl[0] === '' ? [] : (dbl[0] as string).split(':')
  const right = dbl.length === 2 ? (dbl[1] === '' ? [] : (dbl[1] as string).split(':')) : []
  const groups =
    dbl.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false
  const out = new Uint8Array(16)
  groups.forEach((g, i) => {
    const v = Number.parseInt(g, 16)
    out[i * 2] = v >> 8
    out[i * 2 + 1] = v & 255
  })
  if (v4.length === 4) out.set(v4, 12)
  return out
}

/** PHP inet_ntop */
export function inetNtop(bytes: Uint8Array): string | false {
  if (bytes.length === 4) return Array.from(bytes).join('.')
  if (bytes.length !== 16) return false
  const groups: number[] = []
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] as number) << 8) | (bytes[i + 1] as number))
  // IPv4-mapped / compatible addresses keep the dotted tail like glibc
  const v4tail = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return `::ffff:${v4tail}`
  // longest run of zero groups (length >= 2) becomes ::
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  const hex = groups.map((g) => g.toString(16))
  if (bestStart < 0) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`
}

function hex2bin(hex: string): Uint8Array | false {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return false
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** pma: FormatConverter::binaryToIp */
export function binaryToIp(buffer: string | Uint8Array, isBinary: boolean): string {
  const text = typeof buffer === 'string' ? buffer : latin1(buffer)
  if (!text.startsWith('0x')) return isBinary ? bin2hex(buffer) : asText(buffer)
  const bin = hex2bin(text.slice(2))
  if (bin === false) return text
  const ip = inetNtop(bin)
  return ip === false ? text : ip
}

const latin1 = (b: Uint8Array) => {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return s
}

/** PHP chunk_split($s, $n, ' ') */
function chunkSplit(s: string, n: number): string {
  let out = ''
  for (let i = 0; i < s.length; i += n) out += `${s.slice(i, i + n)} `
  return out
}

const intOpt = (v: unknown): number => {
  const n = Number.parseInt(String(v ?? ''), 10)
  return Number.isNaN(n) ? 0 : n
}

/** PHP mb_substr with a possibly negative/omitted length */
function mbSubstr(s: string, start: number, length?: number): string {
  const chars = Array.from(s)
  const from = start < 0 ? Math.max(0, chars.length + start) : start
  if (length === undefined) return chars.slice(from).join('')
  const to = length < 0 ? chars.length + length : from + length
  return chars.slice(from, Math.max(from, to)).join('')
}

/** PHP date() / DateTime::format for the UTC branch of the Dateformat plugin (common specifiers). */
export function phpDateFormat(d: Date, format: string, utc: boolean): string {
  const g = (k: 'FullYear' | 'Month' | 'Date' | 'Hours' | 'Minutes' | 'Seconds' | 'Day') =>
    (utc ? d[`getUTC${k}`]() : d[`get${k}`]()) as number
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  let out = ''
  for (let i = 0; i < format.length; i++) {
    const c = format[i] as string
    const h = g('Hours')
    switch (c) {
      case 'd':
        out += pad(g('Date'))
        break
      case 'j':
        out += String(g('Date'))
        break
      case 'D':
        out += (days[g('Day')] as string).slice(0, 3)
        break
      case 'l':
        out += days[g('Day')]
        break
      case 'N':
        out += String(g('Day') === 0 ? 7 : g('Day'))
        break
      case 'w':
        out += String(g('Day'))
        break
      case 'm':
        out += pad(g('Month') + 1)
        break
      case 'n':
        out += String(g('Month') + 1)
        break
      case 'M':
        out += (months[g('Month')] as string).slice(0, 3)
        break
      case 'F':
        out += months[g('Month')]
        break
      case 'Y':
        out += String(g('FullYear'))
        break
      case 'y':
        out += pad(g('FullYear') % 100)
        break
      case 'H':
        out += pad(h)
        break
      case 'G':
        out += String(h)
        break
      case 'h':
        out += pad(h % 12 === 0 ? 12 : h % 12)
        break
      case 'g':
        out += String(h % 12 === 0 ? 12 : h % 12)
        break
      case 'i':
        out += pad(g('Minutes'))
        break
      case 's':
        out += pad(g('Seconds'))
        break
      case 'a':
        out += h < 12 ? 'am' : 'pm'
        break
      case 'A':
        out += h < 12 ? 'AM' : 'PM'
        break
      case 'U':
        out += String(Math.floor(d.getTime() / 1000))
        break
      case '\\':
        i++
        out += format[i] ?? ''
        break
      default:
        out += c
    }
  }
  return out
}

/** A strftime-like formatter (Util::localisedDate's specifiers) used when no translator-aware one is given. */
export function strftimeFormat(d: Date, format: string, t: (s: string) => string = (s) => s): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const longMonths = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const h = d.getHours()
  return format.replace(/%([a-zA-Z%])/g, (all, c: string) => {
    switch (c) {
      case 'a':
        return t(days[d.getDay()] as string)
      case 'A':
        return t(
          ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
            d.getDay()
          ] as string,
        )
      case 'b':
      case 'h':
        return t(months[d.getMonth()] as string)
      case 'B':
        return t(longMonths[d.getMonth()] as string)
      case 'd':
        return pad(d.getDate())
      case 'e':
        return String(d.getDate()).padStart(2, ' ')
      case 'H':
        return pad(h)
      case 'I':
        return pad(h % 12 === 0 ? 12 : h % 12)
      case 'm':
        return pad(d.getMonth() + 1)
      case 'M':
        return pad(d.getMinutes())
      case 'S':
        return pad(d.getSeconds())
      case 'p':
        return h < 12 ? 'AM' : 'PM'
      case 'y':
        return pad(d.getFullYear() % 100)
      case 'Y':
        return String(d.getFullYear())
      case 'j': {
        const start = new Date(d.getFullYear(), 0, 1)
        return pad(Math.floor((d.getTime() - start.getTime()) / 86400000) + 1, 3)
      }
      case '%':
        return '%'
      default:
        return all
    }
  })
}

/** PHP strtotime for the common MySQL date/time literals (local time); null when unparsable. */
function strtotime(s: string): number | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*$/.exec(s)
  if (m !== null) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    )
    return Math.floor(d.getTime() / 1000)
  }
  const tm = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(s)
  if (tm !== null) {
    const now = new Date()
    now.setHours(Number(tm[1]), Number(tm[2]), Number(tm[3] ?? 0), 0)
    return Math.floor(now.getTime() / 1000)
  }
  const p = Date.parse(s)
  return Number.isNaN(p) ? null : Math.floor(p / 1000)
}

function checkdate(m: number, d: number, y: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1) return false
  return d <= new Date(y, m, 0).getDate()
}

/** pma: Abs/DateFormatTransformationsPlugin::applyTransformation */
function dateFormat(buffer: string, options: readonly string[], ctx: TransformContext): string {
  const opts = withDefaults(options, (ctx.defaults ?? DEFAULT_TRANSFORMATIONS).DateFormat)
  let timestamp: number | null = -1
  if (ctx.meta?.isInt === true) {
    timestamp = /^-?\d+$/.test(buffer) ? Number(buffer) : null
  } else if (/^(\d{2}){3,7}$/.test(buffer)) {
    const offset = buffer.length === 14 || buffer.length === 8 ? 4 : 2
    const n = (from: number, len: number) => Number.parseInt(buffer.slice(from, from + len) || '0', 10)
    const y = n(0, offset)
    const mo = n(offset, 2)
    const d = n(offset + 2, 2)
    if (checkdate(mo, d, y)) {
      timestamp = Math.floor(
        new Date(y, mo - 1, d, n(offset + 4, 2), n(offset + 6, 2), n(offset + 8, 2)).getTime() / 1000,
      )
    }
  } else if (/^[0-9]\d{1,9}$/.test(buffer)) {
    timestamp = Number(buffer)
  } else {
    timestamp = strtotime(buffer)
  }
  if ((timestamp === null || timestamp < 0) && /^[1-9]\d{1,9}$/.test(buffer)) timestamp = Number(buffer)
  if (timestamp === null || Number.isNaN(timestamp) || timestamp < 0) return esc(buffer)
  // is_int($options[0]): only the configured default (an int) is used, user options are strings
  const offsetOpt = opts[0]
  timestamp -= (typeof offsetOpt === 'number' ? offsetOpt : 0) * 3600
  const timeZone = opts[2] === 'utc' ? 'utc' : 'local'
  let format = typeof opts[1] === 'string' ? (opts[1] as string) : ''
  const t = ctx.t ?? ((s: string) => s)
  if (format === '' && timeZone === 'local') format = t('%B %d, %Y at %I:%M %p')
  else if (format === '') format = 'Y-m-d  H:i:s'
  const date = new Date(timestamp * 1000)
  const text =
    timeZone === 'local'
      ? (ctx.localisedDate ?? ((d, f) => strftimeFormat(d, f, t)))(date, format)
      : phpDateFormat(date, format, true)
  return `<dfn onclick="alert(${htmlspecialchars(JSON.stringify(buffer), 'compat')});" title="${esc(buffer)}">${esc(text)}</dfn>`
}

/**
 * Output of a browser display transformation as phpMyAdmin's HTML, or `{ sql }` for the two SQL
 * plugins (Generator::formatSql: the caller renders highlighted SQL).
 * pma: TransformationsInterface::applyTransformation of every Output/ and root plugin
 */
export function applyOutputTransformation(
  file: string,
  buffer: string | Uint8Array,
  options: readonly string[],
  ctx: TransformContext = {},
): { html: string } | { sql: string } {
  const p = findTransformationPlugin(file)
  const defaults = ctx.defaults ?? DEFAULT_TRANSFORMATIONS
  const text = asText(buffer)
  const wrapper = ctx.wrapperUrl ?? (() => '')
  const t = ctx.t ?? ((s: string) => s)
  switch (p?.file) {
    case 'Output/Application_Octetstream_Download': {
      const cn = options[0] !== undefined && options[0] !== '' ? options[0] : 'binary_file.dat'
      return {
        html: `<a href="${esc(wrapper({ ct: 'application/octet-stream', cn }))}" title="${esc(cn)}" class="disableAjax">${esc(cn)}</a>`,
      }
    }
    case 'Output/Application_Octetstream_Hex': {
      const n = intOpt(withDefaults(options, defaults.Hex)[0])
      const hex = bin2hex(buffer)
      return { html: n < 1 ? hex : chunkSplit(hex, n) }
    }
    case 'Output/Image_JPEG_Inline':
    case 'Output/Image_PNG_Inline': {
      const o = withDefaults(options, defaults.Inline)
      if (ctx.gd2 !== false) {
        return {
          html: `<a href="${esc(wrapper())}" rel="noopener noreferrer" target="_blank"><img src="${esc(wrapper({ resize: 'jpeg', newWidth: String(intOpt(o[0])), newHeight: String(intOpt(o[1])) }))}" alt="[${esc(text)}]" border="0"></a>`,
        }
      }
      return { html: `<img src="${esc(wrapper())}" alt="[${esc(text)}]" width="320" height="240">` }
    }
    case 'Output/Image_JPEG_Link':
      return {
        html: `<a class="disableAjax" target="_blank" rel="noopener noreferrer" href="${esc(wrapper())}" alt="[${esc(text)}]">[BLOB]</a>`,
      }
    case 'Output/Text_Octetstream_Sql':
    case 'Output/Text_Plain_Sql':
      return { sql: text }
    case 'Output/Text_Plain_Binarytoip':
      return { html: binaryToIp(buffer, ctx.meta?.isBinary === true) }
    case 'Output/Text_Plain_Bool2Text': {
      const o = withDefaults(options, defaults.Bool2Text)
      return { html: String(text === '0' ? o[1] : o[0]) }
    }
    case 'Output/Text_Plain_Dateformat':
      return { html: dateFormat(text, options, { ...ctx, t }) }
    case 'Output/Text_Plain_External':
      // $allowedPrograms is empty in phpMyAdmin's source: the buffer is returned unchanged
      // (parity exception: BetterMyAdmin never runs a shell command)
      return { html: text }
    case 'Output/Text_Plain_Formatted':
      return { html: `<iframe srcdoc="${text.replaceAll('"', "'")}" sandbox=""></iframe>` }
    case 'Output/Text_Plain_Imagelink': {
      const o = withDefaults(options, defaults.TextImageLink)
      const url = String(o[0] ?? '') + text
      if (!checkLink(url)) return { html: esc(url) }
      return {
        html: `<a href="${esc(url)}" rel="noopener noreferrer" target="_blank">\n    <img src="${esc(url)}" border="0" width="${intOpt(o[1])}" height="${intOpt(o[2])}">\n    ${esc(text)}\n</a>\n`,
      }
    }
    case 'Output/Text_Plain_Json':
      return { html: `<pre><code class="json">${esc(text)}</code></pre>` }
    case 'Output/Text_Plain_Xml':
      return { html: `<pre><code class="xml">${esc(text)}</code></pre>` }
    case 'Text_Plain_Link':
      return { html: textLink(text, options, defaults) }
    case 'Text_Plain_Longtoipv4':
      return { html: esc(longToIp(text)) }
    case 'Text_Plain_PreApPend': {
      const o = withDefaults(options, defaults.PreApPend)
      return { html: esc(String(o[0])) + esc(text) + esc(String(o[1])) }
    }
    case 'Text_Plain_Substring':
      return { html: substring(text, options, defaults) }
    default:
      return { html: esc(text) }
  }
}

function textLink(text: string, options: readonly string[], defaults: DefaultTransformations): string {
  const o = withDefaults(options, defaults.TextLink)
  const url =
    String(o[0] ?? '') +
    (o[2] !== null && o[2] !== undefined && o[2] !== false && o[2] !== '' && o[2] !== '0' ? '' : text)
  if (!checkLink(url)) return esc(url)
  const title = o[1] === null || o[1] === undefined ? null : String(o[1])
  return `<a href="${esc(url)}" title="${esc(title ?? '')}" target="_blank" rel="noopener noreferrer">${esc(title ?? text)}</a>`
}

function substring(text: string, options: readonly string[], defaults: DefaultTransformations): string {
  const o = withDefaults(options, defaults.Substring)
  const skip = intOpt(o[0])
  const newtext = o[1] !== 'all' ? mbSubstr(text, skip, intOpt(o[1])) : mbSubstr(text, skip)
  const length = Array.from(newtext).length
  const base = Array.from(text).length
  let out = newtext
  if (length !== base) {
    if (skip !== 0) out = String(o[2]) + out
    if (length + skip !== base) out += String(o[2])
  }
  return esc(out)
}

/** `applyTransformationNoWrap` (only External, when option 4 is empty or 1) */
export function transformationNoWrap(file: string, options: readonly string[]): boolean {
  if (findTransformationPlugin(file)?.file !== 'Output/Text_Plain_External') return false
  const o = options[3]
  return o === undefined || o === '' || o === '1'
}

export interface InputTransformResult {
  value: string
  success: boolean
  error: string
}

/**
 * The value an input transformation stores (IOTransformationsPlugin::applyTransformation on
 * save). `pregMatch` compiles PHP patterns for Regex Validation (null = invalid pattern).
 * Values are binary strings (one char per byte) as posted.
 */
export function applyInputTransformation(
  file: string,
  value: string,
  options: readonly string[] = [],
  ctx: {
    defaults?: DefaultTransformations
    pregMatch?: (pattern: string, subject: string) => boolean | null
    t?: (s: string) => string
  } = {},
): InputTransformResult {
  const p = findTransformationPlugin(file)
  const defaults = ctx.defaults ?? DEFAULT_TRANSFORMATIONS
  const t = ctx.t ?? ((s: string) => s)
  const ok = (v: string): InputTransformResult => ({ value: v, success: true, error: '' })
  switch (p?.file) {
    case 'Input/Text_Plain_Iptobinary': {
      const bin = inetPton(value)
      return ok(bin === false ? value : `0x${bin2hex(bin)}`)
    }
    case 'Input/Text_Plain_Iptolong': {
      const l = ip2long(value)
      return ok(l === false ? value : String(l))
    }
    case 'Input/Text_Plain_RegexValidation': {
      const pattern = options[0] ?? ''
      // !empty($options[0]) && preg_match(...) !== 1
      if (pattern !== '' && pattern !== '0' && ctx.pregMatch?.(pattern, value) !== true) {
        return {
          value,
          success: false,
          error: t('Validation failed for the input string %s.').replace('%s', htmlspecialchars(value)),
        }
      }
      return ok(value)
    }
    default:
      // Image upload, file upload and the CodeMirror editors pass the value through; the root
      // plugins (Link, Longtoipv4, PreApPend, Substring) are not IOTransformationsPlugin, so as
      // input transformations ReplaceController skips them
      return ok(value)
  }
}

/**
 * Whether the plugin is an IOTransformationsPlugin (its widget replaces the default one and it
 * runs on save). The root plugins are listed as input transformations but are not.
 */
export function isInputTransformation(file: string): boolean {
  return findTransformationPlugin(file)?.kind === 'input'
}

/** The bytes of a cell for plugins that work on binary data. */
export const transformationBytes = (b: string | Uint8Array): Uint8Array => toBytes(b)

import type { CollationsResponse } from '@bettermyadmin/contracts'
import type { Translator } from '@bettermyadmin/i18n'
import type { AdminCtx } from './context.ts'

export interface Charset {
  name: string
  description: string
  defaultCollation: string
}

export interface Collation {
  name: string
  charset: string
  description: string
  isDefault: boolean
}

/** PHP ksort($a, SORT_STRING): byte order */
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b))

/**
 * Charsets and collations of the server, sorted like phpMyAdmin (ksort SORT_STRING), with the
 * collation descriptions built from their names. Cached per request in phpMyAdmin (static
 * properties); here per call site.
 * pma: src/Charsets.php::loadCharsets, ::loadCollations
 */
const charsetCache = new WeakMap<AdminCtx, Promise<Charset[]>>()
const collationCache = new WeakMap<AdminCtx, Promise<Map<string, Collation[]>>>()

export function loadCharsets(ctx: AdminCtx): Promise<Charset[]> {
  let p = charsetCache.get(ctx)
  if (p === undefined) {
    p = readCharsets(ctx)
    charsetCache.set(ctx, p)
  }
  return p
}

export function loadCollations(ctx: AdminCtx): Promise<Map<string, Collation[]>> {
  let p = collationCache.get(ctx)
  if (p === undefined) {
    p = readCollations(ctx)
    collationCache.set(ctx, p)
  }
  return p
}

async function readCharsets(ctx: AdminCtx): Promise<Charset[]> {
  const sql = ctx.server.DisableIS
    ? 'SHOW CHARACTER SET'
    : 'SELECT `CHARACTER_SET_NAME` AS `Charset`, `DEFAULT_COLLATE_NAME` AS `Default collation`, `DESCRIPTION` AS `Description`, `MAXLEN` AS `Maxlen` FROM `information_schema`.`CHARACTER_SETS`'
  const rows = await ctx.conn.rows(sql, 'charsets.list')
  const map = new Map<string, Charset>()
  for (const r of rows) {
    map.set(r.Charset ?? '', {
      name: r.Charset ?? '',
      description: r.Description ?? '',
      defaultCollation: r['Default collation'] ?? '',
    })
  }
  return [...map.values()].sort((a, b) => byteOrder(a.name, b.name))
}

async function readCollations(ctx: AdminCtx): Promise<Map<string, Collation[]>> {
  let sql: string
  if (ctx.isMariaDb && ctx.versionInt >= 101000) {
    sql =
      'SELECT `collapp`.`FULL_COLLATION_NAME` AS `Collation`, `collapp`.`CHARACTER_SET_NAME` AS `Charset`, `collapp`.`ID` AS `Id`, `collapp`.`IS_DEFAULT` AS `Default`, `coll`.`IS_COMPILED` AS `Compiled`, `coll`.`SORTLEN` AS `Sortlen` FROM `information_schema`.`COLLATION_CHARACTER_SET_APPLICABILITY` `collapp` LEFT JOIN `information_schema`.`COLLATIONS` `coll` ON `collapp`.`COLLATION_NAME`=`coll`.`COLLATION_NAME`'
  } else if (ctx.server.DisableIS) {
    sql = 'SHOW COLLATION'
  } else {
    sql =
      'SELECT `COLLATION_NAME` AS `Collation`, `CHARACTER_SET_NAME` AS `Charset`, `ID` AS `Id`, `IS_DEFAULT` AS `Default`, `IS_COMPILED` AS `Compiled`, `SORTLEN` AS `Sortlen` FROM `information_schema`.`COLLATIONS`'
  }
  const rows = await ctx.conn.rows(sql, 'charsets.collations')
  const byCharset = new Map<string, Map<string, Collation>>()
  for (const r of rows) {
    const charset = r.Charset ?? ''
    const name = r.Collation ?? ''
    const list = byCharset.get(charset) ?? new Map<string, Collation>()
    list.set(name, {
      name,
      charset,
      description: collationDescription(ctx.tr, name),
      isDefault: r.Default === 'Yes' || r.Default === '1',
    })
    byCharset.set(charset, list)
  }
  const out = new Map<string, Collation[]>()
  for (const [charset, list] of byCharset) {
    out.set(
      charset,
      [...list.values()].sort((a, b) => byteOrder(a.name, b.name)),
    )
  }
  return out
}

/** pma: src/Controllers/Server/CollationsController.php */
export async function collationsPage(ctx: AdminCtx): Promise<CollationsResponse> {
  const charsets = await loadCharsets(ctx)
  const collations = await loadCollations(ctx)
  return {
    charsets: charsets.map((c) => ({
      name: c.name,
      description: c.description,
      collations: (collations.get(c.name) ?? []).map((k) => ({
        name: k.name,
        description: k.description,
        isDefault: k.isDefault,
      })),
    })),
  }
}

/** Charsets::findCollationByName */
export function findCollation(collations: Map<string, Collation[]>, name: string): Collation | null {
  const charset = name.split('_')[0] ?? ''
  return collations.get(charset)?.find((c) => c.name === name) ?? null
}

/**
 * The description of a collation built from its name tokens: charset, language, variant, suffixes.
 * pma: src/Charsets/Collation.php::buildDescription
 */
export function collationDescription(tr: Translator, collation: string): string {
  const p = (s: string) => tr.pgettext('Collation', s)
  const parts = collation.split('_')
  let name = tr.gettext('Unknown')
  let variant: string | null = null
  const suffixes: string[] = []
  let unicode = false
  let unknown = false
  let level = 0
  for (const part of parts) {
    if (level === 0) {
      // Next will be language; first should be charset
      level = 1
      ;[name, unicode, unknown, variant] = level0(p, part, unicode, unknown, variant)
      continue
    }
    if (level === 1) {
      // Next will be variant unless changed later
      level = 4
      const [n, l, found] = level1(p, part, unicode, unknown, name, level)
      name = n
      level = l
      if (found) continue
    }
    if (level === 2) {
      level = 4
      // German variant
      if (part === 'pb') {
        name = p('German (phone book order)')
        continue
      }
      name = p('German (dictionary order)')
    }
    if (level === 3) {
      level = 4
      // Spanish variant
      if (part === 'trad') {
        name = p('Spanish (traditional)')
        continue
      }
      name = p('Spanish (modern)')
    }
    if (level === 4) {
      level = 5
      const v = getVariant(part)
      if (v !== null) {
        variant = v
        continue
      }
    }
    if (level < 5) continue
    const suffix = getSuffix(tr, part)
    if (suffix !== null) suffixes.push(suffix)
  }
  let result = name
  if (variant !== null) result += ` (${variant})`
  if (suffixes.length > 0) result += `, ${suffixes.join(', ')}`
  return result
}

function getVariant(part: string): string | null {
  switch (part) {
    case '0900':
      return 'UCA 9.0.0'
    case '520':
      return 'UCA 5.2.0'
    case 'mysql561':
      return 'MySQL 5.6.1'
    case 'mysql500':
      return 'MySQL 5.0.0'
    default:
      return null
  }
}

function getSuffix(tr: Translator, part: string): string | null {
  const v = (s: string) => tr.pgettext('Collation variant', s)
  switch (part) {
    case 'ci':
      return v('case-insensitive')
    case 'cs':
      return v('case-sensitive')
    case 'ai':
      return v('accent-insensitive')
    case 'as':
      return v('accent-sensitive')
    case 'ks':
      return v('kana-sensitive')
    case 'w2':
    case 'l2':
      return v('multi-level')
    case 'bin':
      return v('binary')
    case 'nopad':
      return v('no-pad')
    default:
      return null
  }
}

type P = (s: string) => string

function level0(
  p: P,
  part: string,
  unicode0: boolean,
  unknown0: boolean,
  variant0: string | null,
): [string, boolean, boolean, string | null] {
  let unicode = unicode0
  let unknown = unknown0
  let variant = variant0
  let name: string
  switch (part) {
    case 'binary':
      name = p('Binary')
      break
    // Unicode charsets
    case 'utf8mb4':
      variant = 'UCA 4.0.0'
      name = p('Unicode')
      unicode = true
      break
    case 'ucs2':
    case 'utf8':
    case 'utf8mb3':
    case 'utf16':
    case 'utf16le':
    case 'utf16be':
    case 'utf32':
      name = p('Unicode')
      unicode = true
      break
    // West European charsets
    case 'ascii':
    case 'cp850':
    case 'dec8':
    case 'hp8':
    case 'latin1':
    case 'macroman':
      name = p('West European')
      break
    // Central European charsets
    case 'cp1250':
    case 'cp852':
    case 'latin2':
    case 'macce':
      name = p('Central European')
      break
    // Russian charsets
    case 'cp866':
    case 'koi8r':
      name = p('Russian')
      break
    // Chinese charsets
    case 'gb2312':
    case 'gbk':
      name = p('Simplified Chinese')
      break
    case 'big5':
      name = p('Traditional Chinese')
      break
    case 'gb18030':
      name = p('Chinese')
      unicode = true
      break
    // Japanese charsets
    case 'sjis':
    case 'ujis':
    case 'cp932':
    case 'eucjpms':
      name = p('Japanese')
      break
    // Baltic charsets
    case 'cp1257':
    case 'latin7':
      name = p('Baltic')
      break
    // Other
    case 'armscii8':
    case 'armscii':
      name = p('Armenian')
      break
    case 'cp1251':
      name = p('Cyrillic')
      break
    case 'cp1256':
      name = p('Arabic')
      break
    case 'euckr':
      name = p('Korean')
      break
    case 'hebrew':
      name = p('Hebrew')
      break
    case 'geostd8':
      name = p('Georgian')
      break
    case 'greek':
      name = p('Greek')
      break
    case 'keybcs2':
      name = p('Czech-Slovak')
      break
    case 'koi8u':
      name = p('Ukrainian')
      break
    case 'latin5':
      name = p('Turkish')
      break
    case 'swe7':
      name = p('Swedish')
      break
    case 'tis620':
      name = p('Thai')
      break
    default:
      name = p('Unknown')
      unknown = true
  }
  return [name, unicode, unknown, variant]
}

const LEVEL1: Record<string, string> = {
  bulgarian: 'Bulgarian',
  bg: 'Bulgarian',
  croatian: 'Croatian',
  hr: 'Croatian',
  czech: 'Czech',
  cs: 'Czech',
  danish: 'Danish',
  da: 'Danish',
  english: 'English',
  en: 'English',
  esperanto: 'Esperanto',
  eo: 'Esperanto',
  estonian: 'Estonian',
  et: 'Estonian',
  german1: 'German (dictionary order)',
  german2: 'German (phone book order)',
  hungarian: 'Hungarian',
  hu: 'Hungarian',
  icelandic: 'Icelandic',
  is: 'Icelandic',
  japanese: 'Japanese',
  ja: 'Japanese',
  la: 'Classical Latin',
  latvian: 'Latvian',
  lv: 'Latvian',
  lithuanian: 'Lithuanian',
  lt: 'Lithuanian',
  korean: 'Korean',
  ko: 'Korean',
  myanmar: 'Burmese',
  my: 'Burmese',
  persian: 'Persian',
  polish: 'Polish',
  pl: 'Polish',
  roman: 'West European',
  romanian: 'Romanian',
  ro: 'Romanian',
  ru: 'Russian',
  si: 'Sinhalese',
  sinhala: 'Sinhalese',
  slovak: 'Slovak',
  sk: 'Slovak',
  slovenian: 'Slovenian',
  sl: 'Slovenian',
  spanish: 'Spanish (modern)',
  spanish2: 'Spanish (traditional)',
  swedish: 'Swedish',
  sv: 'Swedish',
  thai: 'Thai',
  th: 'Thai',
  turkish: 'Turkish',
  tr: 'Turkish',
  ukrainian: 'Ukrainian',
  uk: 'Ukrainian',
  vietnamese: 'Vietnamese',
  vi: 'Vietnamese',
}

function level1(
  p: P,
  part: string,
  unicode: boolean,
  unknown: boolean,
  name0: string,
  level0: number,
): [string, number, boolean] {
  let name = name0
  let level = level0
  switch (part) {
    case 'general':
      break
    case 'chinese':
    case 'cn':
    case 'zh':
      if (unicode) name = p('Chinese')
      break
    case 'german':
    case 'de':
      // Name is set later
      level = 2
      break
    case 'es':
      // Name is set later
      level = 3
      break
    case 'unicode':
      if (unknown) name = p('Unicode')
      break
    default: {
      const label = Object.hasOwn(LEVEL1, part) ? LEVEL1[part] : undefined
      if (label === undefined) return [name, level, false]
      name = p(label)
    }
  }
  return [name, level, true]
}

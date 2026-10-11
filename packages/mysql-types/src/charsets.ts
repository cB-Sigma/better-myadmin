/**
 * Collation descriptions (the `title` of collation options and of the Structure page's `<dfn>`).
 *
 * pma: src/Charsets/Collation.php::buildDescription and helpers
 */

/** The gettext functions the descriptions need (the request translator). */
export interface CollationTranslator {
  gettext(msgid: string): string
  pgettext(context: string, msgid: string): string
}

const identity: CollationTranslator = { gettext: (s) => s, pgettext: (_c, s) => s }

const LEVEL0: Record<string, string> = {
  binary: 'Binary',
  utf8mb4: 'Unicode',
  ucs2: 'Unicode',
  utf8: 'Unicode',
  utf8mb3: 'Unicode',
  utf16: 'Unicode',
  utf16le: 'Unicode',
  utf16be: 'Unicode',
  utf32: 'Unicode',
  ascii: 'West European',
  cp850: 'West European',
  dec8: 'West European',
  hp8: 'West European',
  latin1: 'West European',
  macroman: 'West European',
  cp1250: 'Central European',
  cp852: 'Central European',
  latin2: 'Central European',
  macce: 'Central European',
  cp866: 'Russian',
  koi8r: 'Russian',
  gb2312: 'Simplified Chinese',
  gbk: 'Simplified Chinese',
  big5: 'Traditional Chinese',
  gb18030: 'Chinese',
  sjis: 'Japanese',
  ujis: 'Japanese',
  cp932: 'Japanese',
  eucjpms: 'Japanese',
  cp1257: 'Baltic',
  latin7: 'Baltic',
  armscii8: 'Armenian',
  armscii: 'Armenian',
  cp1251: 'Cyrillic',
  cp1256: 'Arabic',
  euckr: 'Korean',
  hebrew: 'Hebrew',
  geostd8: 'Georgian',
  greek: 'Greek',
  keybcs2: 'Czech-Slovak',
  koi8u: 'Ukrainian',
  latin5: 'Turkish',
  swe7: 'Swedish',
  tis620: 'Thai',
}
const UNICODE_CHARSETS = new Set([
  'utf8mb4',
  'ucs2',
  'utf8',
  'utf8mb3',
  'utf16',
  'utf16le',
  'utf16be',
  'utf32',
  'gb18030',
])

/** level 1 tokens → name; `null`: the name is left as is ("general") */
const LEVEL1: Record<string, string | null> = {
  general: null,
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

const VARIANTS: Record<string, string> = {
  '0900': 'UCA 9.0.0',
  '520': 'UCA 5.2.0',
  mysql561: 'MySQL 5.6.1',
  mysql500: 'MySQL 5.0.0',
}

const SUFFIXES: Record<string, string> = {
  ci: 'case-insensitive',
  cs: 'case-sensitive',
  ai: 'accent-insensitive',
  as: 'accent-sensitive',
  ks: 'kana-sensitive',
  w2: 'multi-level',
  l2: 'multi-level',
  bin: 'binary',
  nopad: 'no-pad',
}

/**
 * e.g. `utf8mb4_0900_ai_ci` → "Unicode (UCA 9.0.0), accent-insensitive, case-insensitive".
 *
 * pma: src/Charsets/Collation.php::buildDescription
 */
export function collationDescription(collation: string, tr: CollationTranslator = identity): string {
  const c = (s: string) => tr.pgettext('Collation', s)
  let name = tr.gettext('Unknown')
  let variant: string | null = null
  const suffixes: string[] = []
  let unicode = false
  let unknown = false
  let level = 0
  for (const part of collation.split('_')) {
    if (level === 0) {
      level = 1
      // getNameForLevel0
      if (part === 'utf8mb4') variant = 'UCA 4.0.0'
      const n = Object.hasOwn(LEVEL0, part) ? LEVEL0[part] : undefined
      if (n === undefined) {
        name = c('Unknown')
        unknown = true
      } else {
        name = c(n)
        if (UNICODE_CHARSETS.has(part)) unicode = true
      }
      continue
    }
    if (level === 1) {
      level = 4
      // getNameForLevel1
      let found = true
      if (part === 'chinese' || part === 'cn' || part === 'zh') {
        if (unicode) name = c('Chinese')
      } else if (part === 'german' || part === 'de') {
        level = 2
      } else if (part === 'es') {
        level = 3
      } else if (part === 'unicode') {
        if (unknown) name = c('Unicode')
      } else if (Object.hasOwn(LEVEL1, part)) {
        const n = LEVEL1[part]
        if (n !== null && n !== undefined) name = c(n)
      } else {
        found = false
      }
      if (found) continue
    }
    if (level === 2) {
      level = 4
      if (part === 'pb') {
        name = c('German (phone book order)')
        continue
      }
      name = c('German (dictionary order)')
    }
    if (level === 3) {
      level = 4
      if (part === 'trad') {
        name = c('Spanish (traditional)')
        continue
      }
      name = c('Spanish (modern)')
    }
    if (level === 4) {
      level = 5
      const v = Object.hasOwn(VARIANTS, part) ? VARIANTS[part] : undefined
      if (v !== undefined) {
        variant = v
        continue
      }
    }
    if (level < 5) continue
    const s = Object.hasOwn(SUFFIXES, part) ? SUFFIXES[part] : undefined
    if (s !== undefined) suffixes.push(tr.pgettext('Collation variant', s))
  }
  let result = name
  if (variant !== null) result += ` (${variant})`
  if (suffixes.length > 0) result += `, ${suffixes.join(', ')}`
  return result
}

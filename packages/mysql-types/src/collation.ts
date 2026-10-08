/**
 * Human description of a collation name ("Unicode (UCA 4.0.0), case-insensitive").
 * Strings are phpMyAdmin's msgids (context "Collation" / "Collation variant").
 * pma: src/Charsets/Collation.php::buildDescription
 */

const LEVEL0: Record<string, string> = {
  binary: 'Binary',
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

const UNICODE = new Set(['ucs2', 'utf8', 'utf8mb3', 'utf16', 'utf16le', 'utf16be', 'utf32'])

/** Level-1 tokens (locale names / codes); `null` = known but keeps the current name. */
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

export function collationDescription(collation: string): string {
  let name = 'Unknown'
  let variant: string | null = null
  const suffixes: string[] = []
  let unicode = false
  let unknown = false
  let level = 0

  for (const part of collation.split('_')) {
    if (level === 0) {
      level = 1
      if (part === 'utf8mb4') {
        variant = 'UCA 4.0.0'
        name = 'Unicode'
        unicode = true
      } else if (UNICODE.has(part)) {
        name = 'Unicode'
        unicode = true
      } else if (part === 'gb18030') {
        name = 'Chinese'
        unicode = true
      } else if (Object.hasOwn(LEVEL0, part)) {
        name = LEVEL0[part]!
      } else {
        name = 'Unknown'
        unknown = true
      }
      continue
    }

    if (level === 1) {
      level = 4
      let found = true
      if (part === 'chinese' || part === 'cn' || part === 'zh') {
        if (unicode) name = 'Chinese'
      } else if (part === 'german' || part === 'de') {
        level = 2
      } else if (part === 'es') {
        level = 3
      } else if (part === 'unicode') {
        if (unknown) name = 'Unicode'
      } else if (Object.hasOwn(LEVEL1, part)) {
        const n = LEVEL1[part]
        if (n !== null && n !== undefined) name = n
      } else {
        found = false
      }
      if (found) continue
    }

    if (level === 2) {
      level = 4
      if (part === 'pb') {
        name = 'German (phone book order)'
        continue
      }
      name = 'German (dictionary order)'
    }

    if (level === 3) {
      level = 4
      if (part === 'trad') {
        name = 'Spanish (traditional)'
        continue
      }
      name = 'Spanish (modern)'
    }

    if (level === 4) {
      level = 5
      const v = VARIANTS[part]
      if (v !== undefined) {
        variant = v
        continue
      }
    }

    if (level < 5) continue
    const s = SUFFIXES[part]
    if (s !== undefined) suffixes.push(s)
  }

  let result = name
  if (variant !== null) result += ` (${variant})`
  if (suffixes.length > 0) result += `, ${suffixes.join(', ')}`
  return result
}

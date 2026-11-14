/**
 * Collation descriptions (the `title` of collation options and of the Structure page's `<dfn>`).
 *
 * pma: src/Charsets/Collation.php::buildDescription and helpers
 */
import { NC_ } from '@bettermyadmin/i18n'

/** The gettext functions the descriptions need (the request translator). */
export interface CollationTranslator {
  gettext(msgid: string): string
  pgettext(context: string, msgid: string): string
}

const identity: CollationTranslator = { gettext: (s) => s, pgettext: (_c, s) => s }

const LEVEL0: Record<string, string> = {
  binary: NC_('Collation', 'Binary'),
  utf8mb4: NC_('Collation', 'Unicode'),
  ucs2: NC_('Collation', 'Unicode'),
  utf8: NC_('Collation', 'Unicode'),
  utf8mb3: NC_('Collation', 'Unicode'),
  utf16: NC_('Collation', 'Unicode'),
  utf16le: NC_('Collation', 'Unicode'),
  utf16be: NC_('Collation', 'Unicode'),
  utf32: NC_('Collation', 'Unicode'),
  ascii: NC_('Collation', 'West European'),
  cp850: NC_('Collation', 'West European'),
  dec8: NC_('Collation', 'West European'),
  hp8: NC_('Collation', 'West European'),
  latin1: NC_('Collation', 'West European'),
  macroman: NC_('Collation', 'West European'),
  cp1250: NC_('Collation', 'Central European'),
  cp852: NC_('Collation', 'Central European'),
  latin2: NC_('Collation', 'Central European'),
  macce: NC_('Collation', 'Central European'),
  cp866: NC_('Collation', 'Russian'),
  koi8r: NC_('Collation', 'Russian'),
  gb2312: NC_('Collation', 'Simplified Chinese'),
  gbk: NC_('Collation', 'Simplified Chinese'),
  big5: NC_('Collation', 'Traditional Chinese'),
  gb18030: NC_('Collation', 'Chinese'),
  sjis: NC_('Collation', 'Japanese'),
  ujis: NC_('Collation', 'Japanese'),
  cp932: NC_('Collation', 'Japanese'),
  eucjpms: NC_('Collation', 'Japanese'),
  cp1257: NC_('Collation', 'Baltic'),
  latin7: NC_('Collation', 'Baltic'),
  armscii8: NC_('Collation', 'Armenian'),
  armscii: NC_('Collation', 'Armenian'),
  cp1251: NC_('Collation', 'Cyrillic'),
  cp1256: NC_('Collation', 'Arabic'),
  euckr: NC_('Collation', 'Korean'),
  hebrew: NC_('Collation', 'Hebrew'),
  geostd8: NC_('Collation', 'Georgian'),
  greek: NC_('Collation', 'Greek'),
  keybcs2: NC_('Collation', 'Czech-Slovak'),
  koi8u: NC_('Collation', 'Ukrainian'),
  latin5: NC_('Collation', 'Turkish'),
  swe7: NC_('Collation', 'Swedish'),
  tis620: NC_('Collation', 'Thai'),
}
// pma: Collation::UNICODE_CHARSETS
const UNICODE_CHARSETS = new Set([
  'ucs2',
  'utf8',
  'utf8mb3',
  'utf8mb4',
  'utf16',
  'utf16le',
  'utf16be',
  'utf32',
])

/** getLanguageName: token → name; `null`: the name found so far is kept ("general") */
const LANGUAGES: Record<string, string | null> = {
  general: null,
  bosnian: NC_('Collation', 'Bosnian'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  bs: NC_('Collation', 'Bosnian'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  bulgarian: NC_('Collation', 'Bulgarian'),
  bg: NC_('Collation', 'Bulgarian'),
  croatian: NC_('Collation', 'Croatian'),
  hr: NC_('Collation', 'Croatian'),
  czech: NC_('Collation', 'Czech'),
  cs: NC_('Collation', 'Czech'),
  danish: NC_('Collation', 'Danish'),
  da: NC_('Collation', 'Danish'),
  english: NC_('Collation', 'English'),
  en: NC_('Collation', 'English'),
  esperanto: NC_('Collation', 'Esperanto'),
  eo: NC_('Collation', 'Esperanto'),
  estonian: NC_('Collation', 'Estonian'),
  et: NC_('Collation', 'Estonian'),
  galician: NC_('Collation', 'Galician'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  gl: NC_('Collation', 'Galician'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  german1: NC_('Collation', 'German (dictionary order)'),
  german2: NC_('Collation', 'German (phone book order)'),
  hungarian: NC_('Collation', 'Hungarian'),
  hu: NC_('Collation', 'Hungarian'),
  icelandic: NC_('Collation', 'Icelandic'),
  is: NC_('Collation', 'Icelandic'),
  japanese: NC_('Collation', 'Japanese'),
  ja: NC_('Collation', 'Japanese'),
  la: NC_('Collation', 'Classical Latin'),
  latvian: NC_('Collation', 'Latvian'),
  lv: NC_('Collation', 'Latvian'),
  lithuanian: NC_('Collation', 'Lithuanian'),
  lt: NC_('Collation', 'Lithuanian'),
  korean: NC_('Collation', 'Korean'),
  ko: NC_('Collation', 'Korean'),
  mongolian: NC_('Collation', 'Mongolian'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  mn: NC_('Collation', 'Mongolian'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  myanmar: NC_('Collation', 'Burmese'),
  my: NC_('Collation', 'Burmese'),
  nb: NC_('Collation', 'Norwegian Bokmål'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  nn: NC_('Collation', 'Norwegian Nynorsk'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  persian: NC_('Collation', 'Persian'),
  polish: NC_('Collation', 'Polish'),
  pl: NC_('Collation', 'Polish'),
  roman: NC_('Collation', 'West European'),
  romanian: NC_('Collation', 'Romanian'),
  ro: NC_('Collation', 'Romanian'),
  ru: NC_('Collation', 'Russian'),
  serbian: NC_('Collation', 'Serbian'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  sr: NC_('Collation', 'Serbian'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
  si: NC_('Collation', 'Sinhalese'),
  sinhala: NC_('Collation', 'Sinhalese'),
  slovak: NC_('Collation', 'Slovak'),
  sk: NC_('Collation', 'Slovak'),
  slovenian: NC_('Collation', 'Slovenian'),
  sl: NC_('Collation', 'Slovenian'),
  spanish: NC_('Collation', 'Spanish (modern)'),
  spanish2: NC_('Collation', 'Spanish (traditional)'),
  swedish: NC_('Collation', 'Swedish'),
  sv: NC_('Collation', 'Swedish'),
  thai: NC_('Collation', 'Thai'),
  th: NC_('Collation', 'Thai'),
  turkish: NC_('Collation', 'Turkish'),
  tr: NC_('Collation', 'Turkish'),
  ukrainian: NC_('Collation', 'Ukrainian'),
  uk: NC_('Collation', 'Ukrainian'),
  vietnamese: NC_('Collation', 'Vietnamese'),
  vi: NC_('Collation', 'Vietnamese'),
}

/** getScript: the script of the language, e.g. utf8mb4_sr_latn_0900_ai_ci */
const SCRIPTS: Record<string, string> = {
  cyrl: NC_('Collation', 'Cyrillic'),
  latn: NC_('Collation', 'Latin'), // i18n-new: phpMyAdmin 060fd18bf6, its catalogue not refreshed yet
}

const VARIANTS: Record<string, string> = {
  uca1400: 'UCA 14.0.0',
  '0900': 'UCA 9.0.0',
  '520': 'UCA 5.2.0',
  mysql561: 'MySQL 5.6.1',
  mysql500: 'MySQL 5.0.0',
}

const SUFFIXES: Record<string, string> = {
  ci: NC_('Collation variant', 'case-insensitive'),
  cs: NC_('Collation variant', 'case-sensitive'),
  ai: NC_('Collation variant', 'accent-insensitive'),
  as: NC_('Collation variant', 'accent-sensitive'),
  ks: NC_('Collation variant', 'kana-sensitive'),
  w2: NC_('Collation variant', 'multi-level'),
  l2: NC_('Collation variant', 'multi-level'),
  bin: NC_('Collation variant', 'binary'),
  nopad: NC_('Collation variant', 'no-pad'),
}

/**
 * e.g. `utf8mb4_0900_ai_ci` → "Unicode (UCA 9.0.0), accent-insensitive, case-insensitive".
 *
 * pma: src/Charsets/Collation.php::buildDescription
 */
export function collationDescription(collation: string, tr: CollationTranslator = identity): string {
  const c = (s: string) => tr.pgettext('Collation', s)
  const own = <T>(map: Record<string, T>, key: string): T | undefined =>
    Object.hasOwn(map, key) ? map[key] : undefined
  const [charset = '', ...parts] = collation.split('_')
  // getCharsetName
  const charsetName = own(LEVEL0, charset)
  const unknown = charsetName === undefined
  const unicode = UNICODE_CHARSETS.has(charset)
  let name = charsetName === undefined ? tr.pgettext('Collation', 'Unknown') : c(charsetName)
  let variant: string | null = charset === 'utf8mb4' ? 'UCA 4.0.0' : null
  const suffixes: string[] = []
  let languageFound = false
  for (const [i, part] of parts.entries()) {
    // "cs" is Czech right after the charset, e.g. utf8mb4_cs_0900_ai_ci, and case-sensitive elsewhere
    if (i === 0 && part === 'cs') {
      name = tr.pgettext('Collation', 'Czech')
      languageFound = true
      continue
    }
    const suffix = own(SUFFIXES, part)
    if (suffix !== undefined) {
      suffixes.push(tr.pgettext('Collation variant', suffix))
      continue
    }
    const v = own(VARIANTS, part)
    if (v !== undefined) {
      variant = v
      continue
    }
    const script = own(SCRIPTS, part)
    if (script !== undefined) {
      name += ` (${c(script)})`
      continue
    }
    if (languageFound) continue
    // the token after "de" and "es" can choose the sort order, e.g. utf8mb4_de_pb_0900_ai_ci
    const next = parts[i + 1] ?? ''
    let language: string | null
    if (part === 'german' || part === 'de') {
      language =
        next === 'pb'
          ? tr.pgettext('Collation', 'German (phone book order)')
          : tr.pgettext('Collation', 'German (dictionary order)')
    } else if (part === 'es') {
      language =
        next === 'trad'
          ? tr.pgettext('Collation', 'Spanish (traditional)')
          : tr.pgettext('Collation', 'Spanish (modern)')
    } else if (part === 'chinese' || part === 'cn' || part === 'zh') {
      language = unicode ? tr.pgettext('Collation', 'Chinese') : name
    } else if (part === 'unicode') {
      language = unknown ? tr.pgettext('Collation', 'Unicode') : name
    } else {
      const n = own(LANGUAGES, part)
      language = n === undefined ? null : n === null ? name : c(n)
    }
    if (language === null) continue
    name = language
    languageFound = true
  }
  let result = name
  if (variant !== null) result += ` (${variant})`
  if (suffixes.length > 0) result += `, ${suffixes.join(', ')}`
  return result
}

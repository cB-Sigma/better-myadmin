/**
 * Language list and selection, shared by the server (per-request locale, `SET lc_messages`) and the web
 * app (selector). pma: src/I18n/LanguageManager.php, src/I18n/Language.php
 */
import { shippedLocales } from './generated/catalog-index.ts'
import { languageData } from './generated/languages.ts'

const DATA = new Map(languageData.map((d) => [d[0], d]))

/** PCRE (no /u) → JS: POSIX classes are ASCII. */
function pcreToJs(re: string): string {
  return re.replaceAll('[[:alpha:]]', '[A-Za-z]').replaceAll('[[:space:]]', '[ \\t\\n\\r\\v\\f]')
}

const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export class Language {
  /** Lower-case key, also the `lang` parameter / cookie value (`pt_br`). */
  readonly key: string
  /** Catalogue code (`pt_BR`). */
  readonly code: string
  readonly englishName: string
  readonly nativeName: string
  readonly mysqlLocale: string
  readonly regex: string
  readonly #accept: RegExp
  readonly #userAgent: RegExp

  constructor(key: string, code: string, name: string, native: string, regex: string, mysql: string) {
    this.key = key
    this.code = code
    this.englishName = name
    this.nativeName = native
    this.mysqlLocale = mysql
    this.regex = regex.includes('[-_]') ? regex : regex.replaceAll('|', '([-_][[:alpha:]]{2,3})?|')
    const js = pcreToJs(this.regex)
    this.#accept = new RegExp(`^(${js})(;q=[0-9]\\.[0-9])?$`, 'i')
    this.#userAgent = new RegExp(`(\\(|\\[|;[ \\t\\n\\r\\v\\f])(${js})(;|\\]|\\))`, 'i')
  }

  /** Language::getName — `Native - English`, or the English name alone. */
  get name(): string {
    return this.nativeName !== '' ? `${this.nativeName} - ${this.englishName}` : this.englishName
  }

  /** Language::isRTL */
  get isRTL(): boolean {
    return ['ar', 'fa', 'he', 'ur'].includes(this.code)
  }

  get dir(): 'ltr' | 'rtl' {
    return this.isRTL ? 'rtl' : 'ltr'
  }

  /** Language::matchesAcceptLanguage — one comma-separated entry, not trimmed (as phpMyAdmin). */
  matchesAcceptLanguage(header: string): boolean {
    return this.#accept.test(header)
  }

  /** Language::matchesUserAgent */
  matchesUserAgent(header: string): boolean {
    return this.#userAgent.test(header)
  }
}

export interface LanguageManagerOptions {
  /** Locale directories that exist (resources/locale/<code>); default: the shipped catalogues. */
  locales?: readonly string[]
  /** $cfg['FilterLanguages'] — a regex body, applied like preg_grep('@…@'). */
  FilterLanguages?: string
  /** $cfg['Lang'] */
  Lang?: string
  /** $cfg['DefaultLang'] */
  DefaultLang?: string
}

export interface LanguageRequest {
  /** $_POST['lang'] */
  post?: string | undefined
  /** $_GET['lang'] */
  get?: string | undefined
  /** pma_lang cookie */
  cookie?: string | undefined
  acceptLanguage?: string | undefined
  userAgent?: string | undefined
}

export interface LanguageSelection {
  language: Language
  /** An unsupported code was ignored: phpMyAdmin then shows "Ignoring unsupported language code." */
  ignoredUnsupported: boolean
}

export class LanguageManager {
  readonly #opts: LanguageManagerOptions
  #available: Map<string, Language> | null = null

  constructor(opts: LanguageManagerOptions = {}) {
    this.#opts = opts
  }

  /** LanguageManager::availableLocales */
  availableLocales(): string[] {
    const locales = ['en', ...(this.#opts.locales ?? shippedLocales)]
    const filter = this.#opts.FilterLanguages ?? ''
    if (filter === '') return locales
    let re: RegExp | null = null
    // the '@' delimiter ends the pattern early → preg_grep() fails → unfiltered list
    if (!filter.includes('@')) {
      try {
        re = new RegExp(pcreToJs(filter))
      } catch {
        re = null
      }
    }
    return re === null ? locales : locales.filter((l) => re.test(l))
  }

  /** LanguageManager::availableLanguages (keyed by lower-case code, in locale-dir order) */
  availableLanguages(): Map<string, Language> {
    if (this.#available !== null) return this.#available
    const out = new Map<string, Language>()
    for (const raw of this.availableLocales()) {
      const key = raw.toLowerCase()
      const d = DATA.get(key)
      out.set(
        key,
        d !== undefined
          ? new Language(key, d[1], d[2], d[3], d[4], d[5])
          : new Language(key, key, ucfirst(key), ucfirst(key), key, ''),
      )
    }
    this.#available = out
    return out
  }

  /** LanguageManager::sortedLanguages — by English name (strcmp). */
  sortedLanguages(): Language[] {
    return [...this.availableLanguages().values()].sort((a, b) =>
      a.englishName < b.englishName ? -1 : a.englishName > b.englishName ? 1 : 0,
    )
  }

  /** LanguageManager::hasChoice */
  hasChoice(): boolean {
    return this.availableLanguages().size > 1
  }

  /** LanguageManager::getLanguage */
  getLanguage(code: string): Language | undefined {
    return this.availableLanguages().get(code.toLowerCase())
  }

  /**
   * LanguageManager::selectLanguage — `Lang` directive, POST `lang`, GET `lang`, `pma_lang` cookie, each
   * Accept-Language entry, User-Agent, then `DefaultLang` / `en`.
   */
  selectLanguage(req: LanguageRequest = {}): LanguageSelection {
    let failed = false
    const tryCode = (code: string | undefined): Language | undefined => {
      if (code === undefined || code === '') return undefined
      const lang = this.getLanguage(code)
      if (lang === undefined) failed = true
      return lang
    }
    const result = (language: Language): LanguageSelection => ({ language, ignoredUnsupported: failed })

    const fromConfig = tryCode(this.#opts.Lang)
    if (fromConfig !== undefined) return result(fromConfig)
    for (const code of [req.post, req.get, req.cookie]) {
      const lang = tryCode(code)
      if (lang !== undefined) return result(lang)
    }
    const langs = [...this.availableLanguages().values()]
    const accept = req.acceptLanguage ?? ''
    if (accept !== '') {
      for (const header of accept.split(',')) {
        const lang = langs.find((l) => l.matchesAcceptLanguage(header))
        if (lang !== undefined) return result(lang)
      }
    }
    const ua = req.userAgent ?? ''
    if (ua !== '') {
      const lang = langs.find((l) => l.matchesUserAgent(ua))
      if (lang !== undefined) return result(lang)
    }
    const all = this.availableLanguages()
    return result(all.get(this.#opts.DefaultLang ?? 'en') ?? all.get('en')!)
  }
}

/** The MySQL `lc_messages` locale for a language key, '' when phpMyAdmin sends none. */
export function mysqlLocaleFor(key: string): string {
  return DATA.get(key.toLowerCase())?.[5] ?? ''
}

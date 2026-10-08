import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LanguageManager, mysqlLocaleFor } from '../src/languages.ts'
import { pluralRule } from '../src/plural.ts'

interface Case {
  name: string
  cfg?: { Lang?: string; DefaultLang?: string; FilterLanguages?: string }
  post?: string
  get?: string
  cookie?: string
  accept?: string
  ua?: string
  expected: string
  warning: boolean
  available: string[]
  hasChoice: boolean
}
const fx = JSON.parse(readFileSync(new URL('./fixtures/languages.json', import.meta.url), 'utf8')) as {
  sorted: Array<[string, string, string, string, string, string, boolean]>
  selection: Case[]
}

describe('LanguageManager', () => {
  it('sortedLanguages: order, names, MySQL locale, RTL', () => {
    const got = new LanguageManager()
      .sortedLanguages()
      .map((l) => [l.key, l.code, l.name, l.englishName, l.nativeName, l.mysqlLocale, l.isRTL])
    expect(got).toEqual(fx.sorted)
  })

  for (const c of fx.selection) {
    it(`selectLanguage: ${c.name}`, () => {
      const lm = new LanguageManager({ ...c.cfg })
      const sel = lm.selectLanguage({
        post: c.post,
        get: c.get,
        cookie: c.cookie,
        acceptLanguage: c.accept,
        userAgent: c.ua,
      })
      expect(sel.language.code).toBe(c.expected)
      expect(sel.ignoredUnsupported).toBe(c.warning)
      expect([...lm.availableLanguages().keys()]).toEqual(c.available)
      expect(lm.hasChoice()).toBe(c.hasChoice)
    })
  }

  it('MySQL lc_messages locales', () => {
    expect(mysqlLocaleFor('de')).toBe('de_DE')
    expect(mysqlLocaleFor('en')).toBe('en_US')
    expect(mysqlLocaleFor('pt_br')).toBe('pt_BR')
    expect(mysqlLocaleFor('af')).toBe('')
  })
})

describe('Plural-Forms evaluation (motranslator + symfony/expression-language)', () => {
  it('boolean results select form 0, numeric results are used and clamped', () => {
    const de = pluralRule(' nplurals=2; plural=n != 1;')
    expect([0, 1, 2, 5].map((n) => de.select(n))).toEqual([0, 0, 0, 0])
    const ru = pluralRule(
      ' nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
    )
    expect([0, 1, 2, 5, 21, 22, 111].map((n) => ru.select(n))).toEqual([2, 0, 1, 2, 0, 1, 2])
    expect(pluralRule(' nplurals=2; plural=n == 1 ? 0 : 5;').select(3)).toBe(1)
    expect(pluralRule(' nplurals=1; plural=0;').select(7)).toBe(0)
    expect(pluralRule('garbage').select(7)).toBe(0)
  })
})

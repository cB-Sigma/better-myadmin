import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileCatalog } from '../src/compile.ts'
import { shippedLocales } from '../src/generated/catalog-index.ts'
import { translatorFor } from '../src/node.ts'
import { moKey, parsePo } from '../src/po.ts'

interface GettextFixture {
  numbers: number[]
  digests: Record<string, [number, string]>
  locales: Record<
    string,
    {
      pluralForms: string
      gettext: Array<[string, string]>
      ngettext: Array<[string, string, string[]]>
      pgettext: Array<[string, string, string]>
    }
  >
}

const fx = JSON.parse(
  readFileSync(new URL('./fixtures/gettext.json', import.meta.url), 'utf8'),
) as GettextFixture

describe('gettext matches phpMyAdmin (motranslator) on .mo files compiled by polib', () => {
  for (const [code, data] of Object.entries(fx.locales)) {
    describe(code, () => {
      const t = translatorFor(code)
      it('gettext', () => {
        for (const [id, expected] of data.gettext) expect(t.gettext(id), id).toBe(expected)
      })
      it('ngettext (plural form selection included)', () => {
        for (const [one, many, expected] of data.ngettext) {
          expect(
            fx.numbers.map((n) => t.ngettext(one, many, n)),
            one,
          ).toEqual(expected)
        }
      })
      it('pgettext', () => {
        for (const [ctx, id, expected] of data.pgettext)
          expect(t.pgettext(ctx, id), `${ctx}|${id}`).toBe(expected)
      })
    })
  }

  it('English is the identity, plural n != 1', () => {
    const en = translatorFor('en')
    expect(en.gettext('Log in')).toBe('Log in')
    expect(en.ngettext('%1$d row deleted.', '%1$d rows deleted.', 1)).toBe('%1$d row deleted.')
    expect(en.ngettext('%1$d row deleted.', '%1$d rows deleted.', 0)).toBe('%1$d rows deleted.')
    expect(en.pgettext('Short month name for May', 'May')).toBe('May')
  })

  it('the fixture covers every shipped catalogue', () => {
    expect(Object.keys(fx.digests).sort()).toEqual([...shippedLocales].sort())
  })

  // one test per catalogue: parsing and compiling all of them is seconds of CPU, which in a single
  // test outran the default timeout whenever the parallel suite loaded the machine
  it.each([...shippedLocales])(
    'the %s catalogue holds exactly the .mo content (keys and translations)',
    (code) => {
      const text = readFileSync(new URL(`../po/${code}.po`, import.meta.url), 'utf8')
      const c = compileCatalog(text)
      expect(c.pluralForms, code).toMatch(/nplurals=/)
      const lines = parsePo(text)
        .entries.map((e) => `${moKey(e)}\u0001${e.msgstr.join('\u0000')}`)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      expect(Object.keys(c.messages).length, code).toBe(lines.length)
      const md5 = createHash('md5').update(lines.join('\u0002')).digest('hex')
      expect([lines.length, md5], code).toEqual(fx.digests[code])
    },
  )
})

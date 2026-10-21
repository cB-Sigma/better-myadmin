import { describe, expect, it } from 'vitest'
import { mysqlDocUrl, pmaDocUrl, serverDocUrl } from '../src/lib/doc-urls.ts'
import { iconParts } from '../src/lib/link-mode.ts'
import { LOADING, PROCESSING_REQUEST, messagePolicy } from '../src/lib/messages.ts'
import { visibleTabCount } from '../src/lib/overflow.ts'
import { disclosureInitial } from '../src/lib/sliders.ts'
import { THEMES, colorModeKey, colorModeLabel, resolveThemeState, themeKey } from '../src/themes/index.ts'

describe('ajaxShowMessage policy (ajax-message.ts)', () => {
  it('defaults to a sticky, non-dismissable "Loading…" with the spinner [p01-47c1c5] [p01-eb435e]', () => {
    expect(messagePolicy()).toEqual({
      text: LOADING,
      duration: null,
      dismissable: false,
      spinner: true,
      type: null,
    })
  })
  it('"Processing request" is sticky and not dismissable, without spinner [p01-eb435e]', () => {
    expect(messagePolicy(PROCESSING_REQUEST)).toMatchObject({
      duration: null,
      dismissable: false,
      spinner: false,
    })
  })
  it('a normal message fades after 5 s and is dismissable [p01-eb435e]', () => {
    expect(messagePolicy('Done')).toMatchObject({ duration: 5000, dismissable: true })
  })
  it('honours an explicit timeout, and timeout=false means sticky but dismissable [p01-eb435e] [p01-211041]', () => {
    expect(messagePolicy('Done', 3000)?.duration).toBe(3000)
    expect(messagePolicy('Failed', false, 'error')).toMatchObject({
      duration: null,
      dismissable: true,
      type: 'error',
    })
  })
  it('an empty message shows nothing', () => {
    expect(messagePolicy('')).toBeNull()
  })
})

describe('menu_resizer overflow', () => {
  it('keeps every tab when the row fits', () => {
    expect(visibleTabCount([100, 100, 100], 301, 50)).toBe(3)
  })
  it('moves tabs from the right end into More while the row overflows (>= wmax)', () => {
    // 300 >= 300 → overflow; with More (50): 350 → drop one (250) → still >= 300? no
    expect(visibleTabCount([100, 100, 100], 300, 50)).toBe(2)
    expect(visibleTabCount([100, 100, 100], 200, 50)).toBe(1)
    expect(visibleTabCount([100, 100, 100], 40, 50)).toBe(0)
  })
})

describe('InitialSlidersState', () => {
  it.each([
    ['open', { open: true, collapsible: true }],
    ['closed', { open: false, collapsible: true }],
    ['disabled', { open: true, collapsible: false }],
  ] as const)('%s', (state, expected) => {
    expect(disclosureInitial(state)).toEqual(expected)
  })
})

describe('ActionLinksMode / TabsMode (Generator::getIcon)', () => {
  it('icons, text, both, forced text', () => {
    expect(iconParts('icons')).toEqual({ icon: true, text: false })
    expect(iconParts('text')).toEqual({ icon: false, text: true })
    expect(iconParts('both')).toEqual({ icon: true, text: true })
    expect(iconParts('icons', true)).toEqual({ icon: true, text: true })
  })
})

describe('documentation links', () => {
  it('phpMyAdmin docs [p01-62e957]', () => {
    expect(pmaDocUrl('index')).toBe('https://docs.phpmyadmin.net/en/latest/index.html')
    expect(pmaDocUrl('faq', 'faq7-2')).toBe('https://docs.phpmyadmin.net/en/latest/faq.html#faq7-2')
  })
  it('MySQL manual by server version (Util::getMySQLDocuURL) [p01-62e957]', () => {
    expect(mysqlDocUrl('charset-connection', '', 80404)).toBe(
      'https://dev.mysql.com/doc/refman/8.0/en/charset-connection.html',
    )
    expect(mysqlDocUrl('Charset_Connection', 'x', 50744)).toBe(
      'https://dev.mysql.com/doc/refman/5.7/en/charset-connection.html#x',
    )
    expect(mysqlDocUrl('', '', 90100)).toBe('https://dev.mysql.com/doc/refman/9.0/en/index.html')
    expect(mysqlDocUrl('server-error-reference', '', 80000)).toBe(
      'https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html',
    )
  })
  it('server docs (Util::getDocuURL) [p01-62e957]', () => {
    expect(serverDocUrl(true)).toBe('https://mariadb.com/kb/en/documentation/')
    expect(serverDocUrl(false, 80400)).toBe('https://dev.mysql.com/doc/refman/8.0/en/index.html')
  })
})

describe('themes (ThemeManager)', () => {
  it('ships the four phpMyAdmin themes and the modern one, sorted by id', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['bootstrap', 'metro', 'modern', 'original', 'pmahomme'])
    expect(THEMES.find((t) => t.id === 'modern')?.pmaColorModes).toEqual([])
    expect(THEMES.find((t) => t.id === 'metro')?.pmaColorModes).toEqual([
      'win',
      'teal',
      'redmond',
      'blueeyes',
      'mono',
    ])
  })
  it('every theme has a dark variant', () => {
    for (const t of THEMES) expect(t.colorModes).toContain('dark')
  })
  it('cookie names follow ThemePerServer [p01-b253b9]', () => {
    expect(themeKey(false, 3)).toBe('bma_theme')
    expect(themeKey(true, 3)).toBe('bma_theme-3')
    expect(colorModeKey(true, 3)).toBe('bma_theme-3_color')
  })
  it('stored theme wins, else ThemeDefault, else the modern theme (X53)', () => {
    const base = { storedMode: null, prefersDark: false }
    expect(resolveThemeState({ ...base, storedTheme: 'metro', themeDefault: 'original' }).theme).toBe('metro')
    expect(resolveThemeState({ ...base, storedTheme: null, themeDefault: 'original' }).theme).toBe('original')
    expect(resolveThemeState({ ...base, storedTheme: 'nope', themeDefault: 'nope' }).theme).toBe('modern')
  })
  it('colour mode: stored when valid for the theme, else OS preference, else the first mode [p01-b253b9]', () => {
    expect(
      resolveThemeState({
        storedTheme: 'metro',
        storedMode: 'teal',
        themeDefault: 'pmahomme',
        prefersDark: true,
      }),
    ).toEqual({
      theme: 'metro',
      storedMode: 'teal',
      colorMode: 'teal',
    })
    expect(
      resolveThemeState({
        storedTheme: 'pmahomme',
        storedMode: 'teal',
        themeDefault: 'pmahomme',
        prefersDark: false,
      }).colorMode,
    ).toBe('light')
    expect(
      resolveThemeState({
        storedTheme: 'metro',
        storedMode: null,
        themeDefault: 'pmahomme',
        prefersDark: true,
      }).colorMode,
    ).toBe('dark')
    expect(
      resolveThemeState({
        storedTheme: 'metro',
        storedMode: null,
        themeDefault: 'pmahomme',
        prefersDark: false,
      }).colorMode,
    ).toBe('win')
  })
  it('colour mode labels (Twig |title)', () => {
    expect(colorModeLabel('light')).toBe('Light')
    expect(colorModeLabel('dark')).toBe('Dark')
    expect(colorModeLabel('blueeyes')).toBe('Blueeyes')
  })
})

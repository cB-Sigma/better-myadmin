import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CLIENT_CONFIG } from '../../lib/config.ts'
import { BBCode } from './bbcode.tsx'
import { parseVersionString, versionNotice } from './home/VersionInfo.tsx'
import {
  PASSWORD_CHARS,
  checkPassword,
  strengthDictionary,
  strengthLabel,
  suggestPassword,
} from './home/password.ts'
import { CHORD_MS, type KeyInfo, ShortcutMachine } from './hotkeys/shortcuts.ts'
import { DemoServerCard, isDemo } from './session/DemoNotice.tsx'
import {
  DB_TABS,
  SERVER_TABS,
  TABLE_TABS,
  defaultDatabasePath,
  defaultServerPath,
  defaultTablePath,
  isTabActive,
} from './tabs.ts'
import { expandUserString, pageTitle } from './title.ts'

const vars = {
  httpHost: 'pma.local:8080',
  host: 'db1',
  verbose: '',
  db: 'shop',
  table: 'orders',
  appVersion: '1.0.0',
}

describe('page titles (Header::getPageTitle, Util::expandUserString)', () => {
  it('picks TitleTable / TitleDatabase / TitleServer / TitleDefault [p01-a7125e]', () => {
    expect(pageTitle(DEFAULT_CLIENT_CONFIG, vars)).toBe(
      'pma.local:8080 / db1 / shop / orders | BetterMyAdmin 1.0.0',
    )
    expect(pageTitle(DEFAULT_CLIENT_CONFIG, { ...vars, table: '' })).toBe(
      'pma.local:8080 / db1 / shop | BetterMyAdmin 1.0.0',
    )
    expect(pageTitle(DEFAULT_CLIENT_CONFIG, { ...vars, table: '', db: '' })).toBe(
      'pma.local:8080 / db1 | BetterMyAdmin 1.0.0',
    )
    expect(pageTitle(DEFAULT_CLIENT_CONFIG, { ...vars, table: '', db: '', host: '' })).toBe(
      'pma.local:8080 | BetterMyAdmin 1.0.0',
    )
    expect(pageTitle(DEFAULT_CLIENT_CONFIG, null)).toBe('BetterMyAdmin')
  })
  it('@VSERVER@ prefers verbose; legacy __VAR__ placeholders; no re-expansion', () => {
    expect(
      expandUserString('@VSERVER@|@VERBOSE@|@SERVER@|__DB__|__TABLE__', { ...vars, verbose: 'Prod' }),
    ).toBe('Prod|Prod|db1|shop|orders')
    expect(expandUserString('@DATABASE@', { ...vars, db: '@TABLE@' })).toBe('@TABLE@')
  })
})

describe('tabs (Menu.php active routes, DefaultTab*)', () => {
  it('active routes', () => {
    expect(isTabActive(SERVER_TABS.status, 'status/processes')).toBe(true)
    expect(isTabActive(SERVER_TABS.rights, 'user-groups')).toBe(true)
    expect(isTabActive(SERVER_TABS.engine, 'engines/InnoDB')).toBe(false)
    expect(isTabActive(TABLE_TABS.structure, 'relation')).toBe(true)
    expect(isTabActive(TABLE_TABS.search, 'zoom-search')).toBe(true)
    expect(isTabActive(DB_TABS.query, 'multi-table-query')).toBe(true)
    expect(isTabActive(DB_TABS.sql, 'structure')).toBe(false)
  })
  it('default tabs map phpMyAdmin routes to our paths', () => {
    expect(defaultServerPath('/')).toBe('')
    expect(defaultServerPath('/server/privileges')).toBe('privileges')
    expect(defaultDatabasePath('/database/operations')).toBe('operations')
    expect(defaultTablePath('/sql')).toBe('browse')
    expect(defaultTablePath('/table/change')).toBe('insert')
  })
})

const key = (keyCode: number, o: Partial<KeyInfo> = {}): KeyInfo => ({
  keyCode,
  ctrlKey: false,
  altKey: false,
  targetTag: 'BODY',
  contentEditable: false,
  ...o,
})
const page = { db: 'shop', table: '', blocked: false }

describe('shortcuts_handler.ts', () => {
  it('D then S opens database structure; S alone opens the navigation settings', () => {
    const m = new ShortcutMachine(() => {})
    expect(m.keydown(key(83), page).actions).toEqual(['navigation-settings'])
    m.keydown(key(68), page)
    expect(m.keydown(key(83), page).actions).toEqual(['db-structure'])
  })
  it('T then F only acts with a table selected', () => {
    const m = new ShortcutMachine(() => {})
    m.keydown(key(84), page)
    expect(m.keydown(key(70), page).actions).toEqual([])
    expect(m.keydown(key(70), { ...page, table: 'orders' }).actions).toEqual(['table-search'])
  })
  it('the chord disarms 2 s after the key is released', () => {
    const timers: Array<[() => void, number]> = []
    const m = new ShortcutMachine((fn, ms) => timers.push([fn, ms]))
    m.keydown(key(68), page)
    m.keyup(key(68))
    expect(timers[0]?.[1]).toBe(CHORD_MS)
    timers[0]?.[0]()
    expect(m.keydown(key(83), page).actions).toEqual(['navigation-settings'])
  })
  it('form fields: letters are ignored, Ctrl+K and Ctrl+Alt+C still toggle the console [p02-a7b23d]', () => {
    const m = new ShortcutMachine(() => {})
    expect(m.keydown(key(69, { targetTag: 'INPUT' }), page).actions).toEqual([])
    expect(m.keydown(key(75, { targetTag: 'TEXTAREA', ctrlKey: true }), page)).toEqual({
      actions: ['console-toggle'],
      preventDefault: true,
    })
    expect(m.keydown(key(67, { targetTag: 'INPUT', ctrlKey: true, altKey: true }), page).actions).toEqual([
      'console-toggle',
    ])
  })
  it('Ctrl+K outside form fields toggles twice (quirk Q45); K toggles once', () => {
    const m = new ShortcutMachine(() => {})
    expect(m.keydown(key(75, { ctrlKey: true }), page).actions).toEqual(['console-toggle', 'console-toggle'])
    expect(m.keydown(key(75), page).actions).toEqual(['console-toggle'])
  })
  it('E, H, Backspace, ? and the blocked state', () => {
    const m = new ShortcutMachine(() => {})
    expect(m.keydown(key(69), page).actions).toEqual(['export'])
    expect(m.keydown(key(72), page).actions).toEqual(['home'])
    expect(m.keydown(key(8), page).actions).toEqual(['back'])
    expect(m.keydown(key(191, { shiftKey: true }), page).actions).toEqual(['help'])
    expect(m.keydown(key(72), { ...page, blocked: true }).actions).toEqual([])
    expect(m.keydown(key(72, { contentEditable: true }), page).actions).toEqual([])
  })
})

describe('change password helpers (functions.ts)', () => {
  it('checkPassword', () => {
    expect(checkPassword(true, '', '')).toBeNull()
    expect(checkPassword(false, '', '')).toBe('The password is empty!')
    expect(checkPassword(false, 'a', 'b')).toBe("The passwords aren't the same!")
    expect(checkPassword(false, 'a', 'a')).toBeNull()
  })
  it('suggestPassword: 16 characters of the phpMyAdmin alphabet', () => {
    const pw = suggestPassword((n) => Int32Array.from({ length: n }, (_, i) => -i * 7))
    expect(pw).toHaveLength(16)
    for (const c of pw) expect(PASSWORD_CHARS).toContain(c)
    expect(pw[1]).toBe(PASSWORD_CHARS[7])
  })
  it('strength dictionary', () => {
    expect(strengthDictionary('bob')).toEqual(['phpmyadmin', 'mariadb', 'mysql', 'php', 'my', 'admin', 'bob'])
  })
})

describe('version check (git-info.ts)', () => {
  it('parseVersionString', () => {
    expect(parseVersionString('6.0.0-dev')).toBe(600000000)
    expect(parseVersionString('5.2.1-rc2')).toBe(502010000 - 22)
    expect(parseVersionString('5.2.1-beta1')).toBe(502010000 - 41)
  })
  it('newer / security / up to date [p01-bb3004] [p06-f6908d]', () => {
    expect(versionNotice('1.2.0', '1.2.0')).toEqual({ upToDate: true, newer: false, security: false })
    // "security" = only the 4th (hotfix) part differs: Math.floor(v / 10000) compares major.minor.patch
    expect(versionNotice('1.2.0', '1.2.0.1')).toEqual({ upToDate: false, newer: true, security: true })
    expect(versionNotice('1.2.0', '1.2.1')).toEqual({ upToDate: false, newer: true, security: false })
    expect(versionNotice('1.2.0', '1.3.0')).toEqual({ upToDate: false, newer: true, security: false })
  })
})

describe('BBCode (Sanitize::convertBBCode)', () => {
  const html = (t: string) => renderToStaticMarkup(<BBCode text={t} />)
  it('formatting, links, documentation links; HTML stays text', () => {
    expect(html('Directory [code]config[/code] <b>x</b>')).toBe(
      'Directory <code>config</code> &lt;b&gt;x&lt;/b&gt;',
    )
    expect(html('[a@https://php.net/x@_blank]session[/a]')).toBe(
      '<a href="https://php.net/x" target="_blank" rel="noopener noreferrer">session</a>',
    )
    expect(html('[doc@cfg_blowfish_secret]documentation[/doc]')).toBe(
      '<a href="https://cb-sigma.github.io/better-myadmin/config.html#cfg_blowfish_secret" target="documentation">documentation</a>',
    )
    expect(html('[doc@faq1-46]x[/doc]')).toContain('faq.html#faq1-46')
  })
  it('refuses javascript: links and odd targets', () => {
    expect(html('[a@javascript:alert(1)]x[/a]')).toBe('[a@javascript:alert(1)]x')
  })
})

describe('the demo server (DBG/demo) and the password strength labels', () => {
  it("isDemo reads $cfg['DBG']['demo']; the card carries base.twig's notice", () => {
    expect(isDemo({ DBG: { demo: true } })).toBe(true)
    expect(isDemo({ DBG: { demo: false } })).toBe(false)
    expect(isDemo({})).toBe(false)
    const html = renderToStaticMarkup(<DemoServerCard />)
    expect(html).toContain('BetterMyAdmin Demo Server')
    expect(html).toContain(
      'You are using the demo server. You can do anything here, but please do not change root, debian-sys-maint and pma users. More information is available at <a',
    )
  })

  it('checkPasswordStrength: the zxcvbn score as text', () => {
    expect([0, 1, 2, 3, 4, null].map(strengthLabel)).toEqual([
      'Extremely weak',
      'Very weak',
      'Weak',
      'Good',
      'Strong',
      '',
    ])
  })
})

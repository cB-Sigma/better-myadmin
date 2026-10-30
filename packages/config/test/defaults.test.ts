import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { defaultConfig, defaults, serverDefaults } from '../src/defaults.ts'
import type { AnyNode } from '../src/nodes.ts'
import {
  type ResolvedConfig,
  type ServerConfig,
  USERPREF_PATHS,
  configNode,
  directiveCount,
  directives,
  resolvedConfigSchema,
} from '../src/schema.ts'
import { type PmaDefaultsFixture, phpJsonShape, readFixture, stripBma } from './helpers.ts'

const pma = readFixture<PmaDefaultsFixture>('pma-defaults.json')

describe('defaults vs phpMyAdmin Settings::asArray() dump', () => {
  it('fixture comes from the reference commit', () => {
    // docs/reference/reference-commit.txt: the pin moves with each upstream sync
    const pin = readFileSync(new URL('../../../docs/reference/reference-commit.txt', import.meta.url), 'utf8')
    expect(pma._meta.commit).toBe(pin.trim().split(/\s+/)[0])
  })

  it('top-level defaults equal the PHP dump exactly (BetterMyAdmin additions removed)', () => {
    expect(phpJsonShape(stripBma(defaultConfig()))).toStrictEqual(pma.settings)
  })

  it('Server defaults equal Server::asArray() exactly', () => {
    const ours = stripBma(
      serverDefaults(),
      (configNode.fields.Servers as AnyNode & { kind: 'servers' }).server,
    )
    expect(phpJsonShape(ours)).toStrictEqual(pma.server)
  })

  it('has the same directive names, in the same order, as Settings::asArray()', () => {
    const ours = Object.keys(stripBma(defaultConfig()) as object)
    expect(ours).toStrictEqual(Object.keys(pma.settings))
    for (const group of [
      'Export',
      'Import',
      'Schema',
      'SQLQuery',
      'DBG',
      'Console',
      'DefaultTransformations',
    ]) {
      const o = Object.keys((stripBma(defaultConfig()) as Record<string, object>)[group] as object)
      expect(o, group).toStrictEqual(Object.keys(pma.settings[group] as object))
    }
  })

  it('applies one default server at index 1 (1-based)', () => {
    expect(Object.keys(defaults.Servers)).toStrictEqual(['1'])
    expect(defaults.Servers[1]?.host).toBe('localhost')
    expect(defaults.Servers[1]?.auth_type).toBe('cookie')
  })

  it('every default passes its own schema', () => {
    expect(resolvedConfigSchema.safeParse(defaultConfig()).success).toBe(true)
  })

  it('defaults are frozen; defaultConfig() returns fresh copies', () => {
    expect(Object.isFrozen(defaults)).toBe(true)
    const a = defaultConfig()
    a.MaxRows = 1
    expect(defaultConfig().MaxRows).toBe(25)
  })

  it('includes the BetterMyAdmin additions with their documented defaults', () => {
    const d = defaultConfig()
    expect(d.DataDir).toBe('~/.bettermyadmin')
    expect(d.SessionStore).toBe('sqlite')
    expect(d.RedisUrl).toBe('')
    expect(d.Listen).toStrictEqual({ host: '127.0.0.1', port: 8080, basePath: '/' })
    expect(d.LoginRateLimit.enabled).toBe(true)
    expect(d.ForceSSL).toBe(false)
    expect(d.Servers[1]?.max_connections).toBe(4)
    expect(d.Export.csv_escape_formulas).toBe(false)
    expect(d.Export.jsmodule_structure_or_data).toBe('data')
    expect(d.Import.MaxDecompressedSize).toBe(0)
  })
})

describe('directive metadata', () => {
  it('counts every leaf directive', () => {
    const pmaLeafCount =
      Object.keys(pma.settings).length -
      7 /* groups */ -
      1 /* Servers */ -
      1 /* MysqlMinVersion group */ +
      Object.keys(pma.server).length -
      2 /* SignonCookieParams, AllowDeny groups */ +
      5 /* SignonCookieParams leaves */ +
      1 /* samesite (optional) */ +
      2 /* AllowDeny leaves */ +
      ['Export', 'Import', 'Schema', 'SQLQuery', 'DBG', 'Console'].reduce(
        (n, g) => n + Object.keys(pma.settings[g] as object).length,
        0,
      ) +
      9 -
      1 /* Inline group */ +
      4 /* Inline leaves */ +
      2 /* MysqlMinVersion leaves */
    const bma = directives.filter((d) => d.node.flags.bma).length
    expect(directiveCount).toBe(pmaLeafCount + bma)
    expect(bma).toBe(22)
  })

  it('userPref flags match phpMyAdmin UserFormList::getFields() + custom-handled keys', () => {
    const fromPma = pma.userPrefFields.map((f) => f.replace(/^Servers\/1\//, 'Servers/*/'))
    expect([...USERPREF_PATHS].sort()).toStrictEqual([...fromPma, 'ThemeDefault'].sort())
    const flagged = new Set<string>()
    const walk = (n: AnyNode): void => {
      if (n.flags.userPref && !flagged.has(n.path)) {
        // report the topmost flagged node (DefaultTransformations/Inline is a group here)
        const cut = n.path.lastIndexOf('/')
        const parent = cut < 0 ? '' : n.path.slice(0, cut)
        if (!flagged.has(parent)) flagged.add(n.path)
      }
      if (n.kind === 'group') for (const c of Object.values(n.fields as Record<string, AnyNode>)) walk(c)
      else if (n.kind === 'servers') walk(n.server)
    }
    walk(configNode)
    expect([...flagged].sort()).toStrictEqual([...USERPREF_PATHS].sort())
  })

  it('marks the secrets', () => {
    const secrets = directives
      .filter((d) => d.node.flags.secret)
      .map((d) => d.path)
      .sort()
    expect(secrets).toStrictEqual(
      [
        'blowfish_secret',
        'ProxyPass',
        'URLQueryEncryptionSecretKey',
        'CaptchaLoginPrivateKey',
        'RedisUrl',
        'Servers/*/password',
        'Servers/*/controlpass',
      ].sort(),
    )
  })

  it('resolved types are precise', () => {
    expectTypeOf<ResolvedConfig['MaxRows']>().toEqualTypeOf<number>()
    expectTypeOf<ResolvedConfig['GridEditing']>().toEqualTypeOf<'double-click' | 'click' | 'disabled'>()
    expectTypeOf<ResolvedConfig['DefaultTabTable']>().toEqualTypeOf<
      '/table/structure' | '/table/sql' | '/table/search' | '/table/change' | '/sql'
    >()
    expectTypeOf<ResolvedConfig['ProtectBinary']>().toEqualTypeOf<false | 'blob' | 'noblob' | 'all'>()
    expectTypeOf<ServerConfig['port']>().toEqualTypeOf<string>()
    expectTypeOf<ServerConfig['bookmarktable']>().toEqualTypeOf<string | false>()
    expectTypeOf<ServerConfig['ssl_key']>().toEqualTypeOf<string | null>()
    expectTypeOf<ResolvedConfig['Servers']>().toEqualTypeOf<Record<number, ServerConfig>>()
    expectTypeOf<ResolvedConfig['Export']['format']>().toMatchTypeOf<string>()
  })
})

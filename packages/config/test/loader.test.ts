import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import { defaultConfig } from '../src/defaults.ts'
import { ConfigError } from '../src/errors.ts'
import { defineConfig, loadConfig } from '../src/loader.ts'
import { resolveConfig, resolveLayers, validateConfig } from '../src/resolve.ts'
import type { ConfigInput } from '../src/schema.ts'

const INDEX_URL = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href

let dir: string
beforeEach(async () => {
  // inside the package: vite-node (vitest) cannot import modules from outside the project root
  dir = await mkdtemp(join(import.meta.dirname, '.tmp-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const errorOf = (fn: () => unknown): ConfigError => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ConfigError) return e
    throw e
  }
  throw new Error('expected a ConfigError')
}

describe('loadConfig: files', () => {
  it('without file and env returns the defaults', async () => {
    const r = await loadConfig({ cwd: dir, env: {} })
    expect(r.file).toBeUndefined()
    expect(r.config).toStrictEqual(defaultConfig())
    expect(r.warnings).toStrictEqual([])
  })

  it('reads bettermyadmin.config.ts via dynamic import (default export, defineConfig)', async () => {
    await writeFile(
      join(dir, 'bettermyadmin.config.ts'),
      `import { defineConfig } from '${INDEX_URL}'
       export default defineConfig({
         blowfish_secret: 'dev-only-secret-change-me-32-bytes!!',
         Servers: [
           { host: 'mysql84', port: 3306, auth_type: 'cookie', verbose: 'MySQL 8.4 (dev)',
             controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' },
           { host: 'mariadb11', port: 3306, auth_type: 'cookie', verbose: 'MariaDB 11 (dev)' },
         ],
         UploadDir: './.data/upload', SaveDir: './.data/save',
         DBG: { sql: true },
       })`,
    )
    const { config, file } = await loadConfig({ cwd: dir, env: {} })
    expect(file).toBe(join(dir, 'bettermyadmin.config.ts'))
    expect(config.Servers[1]).toMatchObject({
      host: 'mysql84',
      port: '3306',
      controluser: 'pma',
      pmadb: 'phpmyadmin',
    })
    expect(config.Servers[2]).toMatchObject({ host: 'mariadb11', controluser: '', pmadb: '', user: 'root' })
    expect(config.DBG).toStrictEqual({ sql: true, sqllog: false, demo: false, simple2fa: false })
    expect(config.UploadDir).toBe('./.data/upload')
  })

  it('reads .mjs exporting a (async) function', async () => {
    await writeFile(join(dir, 'bettermyadmin.config.mjs'), 'export default async () => ({ MaxRows: 50 })')
    expect((await loadConfig({ cwd: dir, env: {} })).config.MaxRows).toBe(50)
  })

  it('reads .json and .yaml', async () => {
    await writeFile(join(dir, 'a.json'), JSON.stringify({ MaxRows: 100, Servers: { 2: { host: 'x' } } }))
    const j = await loadConfig({ cwd: dir, file: 'a.json', env: {} })
    expect(j.config.MaxRows).toBe(100)
    expect(Object.keys(j.config.Servers)).toStrictEqual(['2'])

    await writeFile(
      join(dir, 'bettermyadmin.config.yaml'),
      'MaxRows: 250\nServers:\n  - host: db\n    port: 3306\nExport:\n  format: csv\n',
    )
    const y = await loadConfig({ cwd: dir, env: {} })
    expect(y.config.MaxRows).toBe(250)
    expect(y.config.Servers[1]?.port).toBe('3306')
    expect(y.config.Export.format).toBe('csv')
    expect(y.config.Export.method).toBe('quick')
  })

  it('env overrides the file', async () => {
    await writeFile(
      join(dir, 'bettermyadmin.config.json'),
      JSON.stringify({ MaxRows: 100, Servers: [{ host: 'file' }] }),
    )
    const { config } = await loadConfig({ cwd: dir, env: { BMA__MaxRows: '10', BMA__Servers__1__port: '1' } })
    expect(config.MaxRows).toBe(10)
    expect(config.Servers[1]).toMatchObject({ host: 'file', port: '1' })
  })

  it('honours BMA_CONFIG and file: false', async () => {
    await writeFile(join(dir, 'custom.yml'), 'MaxRows: 42\n')
    await writeFile(join(dir, 'bettermyadmin.config.json'), '{"MaxRows": 7}')
    expect((await loadConfig({ cwd: dir, env: { BMA_CONFIG: 'custom.yml' } })).config.MaxRows).toBe(42)
    expect((await loadConfig({ cwd: dir, env: {}, file: false })).config.MaxRows).toBe(25)
  })

  it('warns when several config files exist and uses the first by precedence', async () => {
    await writeFile(join(dir, 'bettermyadmin.config.json'), '{"MaxRows": 7}')
    await writeFile(join(dir, 'bettermyadmin.config.yaml'), 'MaxRows: 8')
    const r = await loadConfig({ cwd: dir, env: {} })
    expect(r.config.MaxRows).toBe(7)
    expect(r.warnings[0]).toMatch(/several config files found/)
  })

  it('reports syntax errors and missing files readably', async () => {
    await writeFile(join(dir, 'bettermyadmin.config.json'), '{"MaxRows": ')
    await expect(loadConfig({ cwd: dir, env: {} })).rejects.toThrow(
      /syntax error: .* \(from bettermyadmin.config.json\)/,
    )
    await expect(loadConfig({ cwd: dir, env: {}, file: 'nope.json' })).rejects.toThrow(
      /config file not found/,
    )
  })

  it('names the file in validation errors', async () => {
    await writeFile(join(dir, 'bettermyadmin.config.json'), '{"MaxRow": 5}')
    await expect(loadConfig({ cwd: dir, env: {} })).rejects.toThrow(
      `Invalid BetterMyAdmin configuration (${join(dir, 'bettermyadmin.config.json')}):\n  - MaxRow: unknown directive "MaxRow". Did you mean "MaxRows"? (from bettermyadmin.config.json)`,
    )
  })
})

describe('unknown directives', () => {
  it('suggests the nearest directive (Levenshtein)', () => {
    const cases: [ConfigInput, string][] = [
      [{ MaxRow: 5 } as ConfigInput, 'MaxRow: unknown directive "MaxRow". Did you mean "MaxRows"?'],
      [{ gridediting: 'click' } as ConfigInput, 'Did you mean "GridEditing"?'],
      [
        { NavigationTreeEnableGroupping: true } as ConfigInput,
        'Did you mean "NavigationTreeEnableGrouping"?',
      ],
      [
        { Export: { formt: 'csv' } } as ConfigInput,
        'Export.formt: unknown directive "formt". Did you mean "Export.format"?',
      ],
      [
        { Servers: [{ hots: 'x' }] } as unknown as ConfigInput,
        'Servers.1.hots: unknown directive "hots". Did you mean "Servers.1.host"?',
      ],
      [{ host: 'x' } as ConfigInput, 'host: unknown directive "host". Did you mean "Servers.<i>.host"?'],
      [{ blowfish_secrets: 'x' } as ConfigInput, 'Did you mean "blowfish_secret"?'],
      [{ Zzzzzzzzzzzzzzzzzz: 1 } as ConfigInput, 'Nearest directive:'],
    ]
    for (const [input, msg] of cases) {
      expect(errorOf(() => resolveConfig(input)).message).toContain(msg)
    }
  })

  it('lists every problem at once', () => {
    const e = errorOf(() =>
      resolveConfig({ MaxRow: 1, Export: { formt: 'x' }, GridEditing: 'nope' } as unknown as ConfigInput),
    )
    // unknown keys are reported before values are validated
    expect(e.issues.map((i) => i.path)).toStrictEqual(['MaxRow', 'Export.formt'])
  })

  it('accepts removed phpMyAdmin directives with a warning (parity Q2)', () => {
    const r = resolveLayers([
      { value: { DisplayBinaryAsHex: true, Servers: [{ connect_type: 'tcp', host: 'h' }] }, label: 'x' },
    ])
    expect(r.warnings).toStrictEqual([
      'DisplayBinaryAsHex: removed in phpMyAdmin 4.3.0; ignored (x)',
      'Servers.1.connect_type: removed in phpMyAdmin 4.7.0; ignored (x)',
    ])
  })
})

describe('validation errors are readable', () => {
  it('reports type and range problems with paths', () => {
    const e = errorOf(() =>
      resolveConfig({
        MaxRows: 'lots',
        GridEditing: 'triple-click',
        Servers: [{ port: true, AllowDeny: { order: 'random' } }],
        Export: { format: 'docx' },
        FirstDayOfCalendar: 9,
        DefaultTransformations: { Substring: [0, 'some'] },
      } as unknown as ConfigInput),
    )
    expect(e.issues.map((i) => `${i.path}: ${i.message}`)).toStrictEqual([
      'Servers.1.port: expected a string, got true',
      'Servers.1.AllowDeny.order: expected one of "", "deny,allow", "allow,deny", "explicit", got "random"',
      'MaxRows: expected an integer, got "lots"',
      'GridEditing: expected one of "double-click", "click", "disabled", got "triple-click"',
      'Export.format: expected one of "sql", "codegen", "csv", "excel", "htmlword", "json", "latex", "mediawiki", "ods", "odt", "pdf", "phparray", "texytext", "xml", "yaml", got "docx"',
      'DefaultTransformations.Substring.1: expected a list like [0,"all","…"], got "some" (at [1])',
      'FirstDayOfCalendar: must be <= 7, got 9',
    ])
    expect(e.message).toMatch(/^Invalid BetterMyAdmin configuration:\n {2}- Servers\.1\.port/)
  })

  it('never prints secret values', () => {
    const e = errorOf(() =>
      resolveConfig({
        blowfish_secret: 12.5,
        Servers: [{ password: ['hunter2'] }],
      } as unknown as ConfigInput),
    )
    expect(e.message).not.toContain('hunter2')
    expect(e.message).not.toContain('12.5')
    expect(e.message).toContain('(secret value hidden)')
  })

  it('rejects non-integer server keys', () => {
    expect(
      errorOf(() => resolveConfig({ Servers: { first: { host: 'x' } } } as unknown as ConfigInput)).message,
    ).toContain('server index must be a positive integer (Servers are 1-based)')
  })

  it('validateConfig returns issues instead of throwing', () => {
    const r = validateConfig({ MaxRows: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]?.message).toBe('must be >= 1, got 0')
  })
})

describe('phpMyAdmin semantics', () => {
  it('Servers: array element 0 is server 1; object keys are 1-based; Servers[0] ignored', () => {
    expect(Object.keys(resolveConfig({ Servers: [{ host: 'a' }, { host: 'b' }] }).Servers)).toStrictEqual([
      '1',
      '2',
    ])
    const r = resolveLayers([
      { value: { Servers: { 0: { host: 'zero' }, 3: { host: 'three' } } }, label: 'x' },
    ])
    expect(Object.keys(r.config.Servers)).toStrictEqual(['3'])
    expect(r.warnings[0]).toMatch(/Servers\.0: ignored, server indices are 1-based/)
  })

  it('no configured server means one default server at index 1', () => {
    expect(resolveConfig({ Servers: [] }).Servers).toStrictEqual(defaultConfig().Servers)
    expect(resolveConfig({ Servers: { 0: { host: 'x' } } }).Servers[1]?.host).toBe('localhost')
  })

  it('a server without host and verbose is named "Server <i>"', () => {
    const s = resolveConfig({ Servers: { 1: { host: 'a' }, 2: { host: '' } } }).Servers
    expect(s[1]?.verbose).toBe('')
    expect(s[2]?.verbose).toBe('Server 2')
  })

  it('each server gets the Server.php defaults independently', () => {
    const s = resolveConfig({ Servers: [{ host: 'a', user: 'x', pmadb: 'p' }, { host: 'b' }] }).Servers
    expect(s[2]?.user).toBe('root')
    expect(s[2]?.pmadb).toBe('')
  })

  it('null means unset (PHP isset), except for nullable directives', () => {
    const c = resolveConfig({ MaxRows: null, Servers: [{ host: 'a', ssl_ca: null }] })
    expect(c.MaxRows).toBe(25)
    expect(c.Servers[1]?.ssl_ca).toBe(null)
    expect(
      resolveConfig({ Servers: [{ ssl_ca: '/x' }] }, { Servers: [{ ssl_ca: null }] }).Servers[1]?.ssl_ca,
    ).toBe(null)
  })

  it('groups merge directive by directive; lists replace', () => {
    const c = resolveConfig(
      { Export: { format: 'csv' }, AvailableCharsets: ['utf-8'] },
      { Export: { method: 'custom' } },
    )
    expect(c.Export.format).toBe('csv')
    expect(c.Export.method).toBe('custom')
    expect(c.Export.asfile).toBe(true)
    expect(c.AvailableCharsets).toStrictEqual(['utf-8'])
  })

  it('DefaultFunctions keeps defaults for unspecified keys (array_replace)', () => {
    const c = resolveConfig({ DefaultFunctions: { FUNC_UUID: 'UUID_SHORT', FUNC_JSON: 'JSON_OBJECT' } })
    expect(c.DefaultFunctions).toStrictEqual({
      FUNC_CHAR: '',
      FUNC_DATE: '',
      FUNC_NUMBER: '',
      FUNC_SPATIAL: 'GeomFromText',
      FUNC_UUID: 'UUID_SHORT',
      first_timestamp: 'NOW',
      FUNC_JSON: 'JSON_OBJECT',
    })
  })

  it('DefaultTransformations merge element-wise', () => {
    const c = resolveConfig({ DefaultTransformations: { Substring: [2], TextLink: [null, 'title'] } })
    expect(c.DefaultTransformations.Substring).toStrictEqual([2, 'all', '…'])
    expect(c.DefaultTransformations.TextLink).toStrictEqual([null, 'title', null])
  })

  it('aliases: secret -> blowfish_secret, control_* -> control*', () => {
    const c = resolveConfig({
      secret: 'x'.repeat(32),
      Servers: [{ control_host: 'h', control_password: 'p' }],
    })
    expect(c.blowfish_secret).toBe('x'.repeat(32))
    expect(c.Servers[1]).toMatchObject({ controlhost: 'h', controlpass: 'p' })
    const r = resolveLayers([{ value: { secret: 'a', blowfish_secret: 'b' }, label: 'x' }])
    expect(r.config.blowfish_secret).toBe('b')
    expect(r.warnings).toStrictEqual(['secret: ignored because "blowfish_secret" is also set'])
  })

  it('coerces lossless PHP-style scalars from files (ints as strings, numeric ports, 0/1 bools)', () => {
    const c = resolveConfig({
      MaxRows: '50',
      ShowAll: 1,
      Servers: [{ port: 3306, controlport: 3307, MaxTableUiprefs: '10' }],
      DefaultTransformations: { Hex: ['4'] },
    } as unknown as ConfigInput)
    expect(c.MaxRows).toBe(50)
    expect(c.ShowAll).toBe(true)
    expect(c.Servers[1]).toMatchObject({ port: '3306', controlport: '3307', MaxTableUiprefs: 10 })
    expect(c.DefaultTransformations.Hex).toStrictEqual([4])
  })

  it('maps legacy values like phpMyAdmin setters', () => {
    const c = resolveConfig({
      DefaultTabServer: 'welcome',
      DefaultTabDatabase: 'db_operations.php',
      NavigationTreeDefaultTabTable: 'insert',
      TablePrimaryKeyOrder: 'desc',
    })
    expect(c.DefaultTabServer).toBe('/')
    expect(c.DefaultTabDatabase).toBe('/database/operations')
    expect(c.NavigationTreeDefaultTabTable).toBe('/table/change')
    expect(c.TablePrimaryKeyOrder).toBe('DESC')
  })

  it('warns about UserprefsDisallow entries that are not user preferences', () => {
    const r = resolveLayers([
      { value: { UserprefsDisallow: ['MaxRows', 'Servers/1/hide_db', 'TempDir'] }, label: 'x' },
    ])
    expect(r.warnings).toStrictEqual([
      'UserprefsDisallow: "TempDir" is not a user-preference directive; it has no effect',
    ])
  })
})

describe('defineConfig', () => {
  it('is an identity function with full typing', () => {
    const c = defineConfig({ MaxRows: 50, Servers: [{ host: 'h', port: 3306 }], Export: { format: 'csv' } })
    expect(c).toStrictEqual({ MaxRows: 50, Servers: [{ host: 'h', port: 3306 }], Export: { format: 'csv' } })
    expectTypeOf(defineConfig).parameter(0).toMatchTypeOf<ConfigInput>()
    // @ts-expect-error unknown directive
    defineConfig({ MaxRow: 1 })
    // @ts-expect-error invalid enum value
    defineConfig({ GridEditing: 'triple-click' })
    // @ts-expect-error wrong type
    defineConfig({ Servers: [{ ssl: 'yes' }] })
    defineConfig({
      secret: 'alias accepted',
      DefaultTabTable: 'browse',
      Servers: { 2: { control_host: 'x' } },
    })
  })
})

import { describe, expect, it } from 'vitest'
import { parseEnv } from '../src/env.ts'
import { ConfigError } from '../src/errors.ts'
import { loadConfig } from '../src/loader.ts'

const load = (env: Record<string, string>) => loadConfig({ file: false, env })

describe('env overrides (BMA__ double-underscore paths)', () => {
  it('sets per-server directives with 1-based indices and fills server defaults', async () => {
    const { config } = await load({ BMA__Servers__1__host: '127.0.0.1', BMA__Servers__2__host: 'replica' })
    expect(config.Servers[1]?.host).toBe('127.0.0.1')
    expect(config.Servers[2]?.host).toBe('replica')
    expect(config.Servers[2]?.auth_type).toBe('cookie')
    expect(config.Servers[2]?.max_connections).toBe(4)
    expect(Object.keys(config.Servers)).toStrictEqual(['1', '2'])
  })

  it('coerces booleans', async () => {
    for (const [raw, v] of [
      ['true', true],
      ['1', true],
      ['yes', true],
      ['ON', true],
      ['false', false],
      ['0', false],
      ['no', false],
      ['off', false],
      ['', false],
    ] as const) {
      const { config } = await load({ BMA__ShowAll: raw })
      expect(config.ShowAll, raw).toBe(v)
    }
    await expect(load({ BMA__ShowAll: 'maybe' })).rejects.toThrow(
      /ShowAll: expected a boolean .* got "maybe" \(from env BMA__ShowAll\)/,
    )
  })

  it('coerces integers and validates ranges', async () => {
    expect((await load({ BMA__MaxRows: '100' })).config.MaxRows).toBe(100)
    expect((await load({ BMA__Servers__1__MaxTableUiprefs: ' 7 ' })).config.Servers[1]?.MaxTableUiprefs).toBe(
      7,
    )
    await expect(load({ BMA__MaxRows: '1.5' })).rejects.toThrow(/MaxRows: expected an integer, got "1.5"/)
    await expect(load({ BMA__MaxRows: '0' })).rejects.toThrow(
      /MaxRows: must be >= 1, got 0 \(from env BMA__MaxRows\)/,
    )
  })

  it('keeps strings as-is (ports stay strings like phpMyAdmin)', async () => {
    const { config } = await load({ BMA__Servers__1__port: '3307', BMA__TitleDefault: '' })
    expect(config.Servers[1]?.port).toBe('3307')
    expect(config.TitleDefault).toBe('')
  })

  it('validates enums and maps legacy spellings', async () => {
    expect((await load({ BMA__GridEditing: 'click' })).config.GridEditing).toBe('click')
    expect((await load({ BMA__DefaultTabTable: 'browse' })).config.DefaultTabTable).toBe('/sql')
    expect((await load({ BMA__RecodingEngine: 'mb' })).config.RecodingEngine).toBe('mbstring')
    await expect(load({ BMA__GridEditing: 'triple-click' })).rejects.toThrow(
      /GridEditing: expected one of "double-click", "click", "disabled", got "triple-click"/,
    )
  })

  it('handles mixed-type directives', async () => {
    expect((await load({ BMA__AllowThirdPartyFraming: 'sameorigin' })).config.AllowThirdPartyFraming).toBe(
      'sameorigin',
    )
    expect((await load({ BMA__AllowThirdPartyFraming: 'true' })).config.AllowThirdPartyFraming).toBe(true)
    expect((await load({ BMA__ProtectBinary: 'false' })).config.ProtectBinary).toBe(false)
    expect((await load({ BMA__ProtectBinary: 'noblob' })).config.ProtectBinary).toBe('noblob')
    expect((await load({ BMA__ShowServerInfo: 'web-server' })).config.ShowServerInfo).toBe('web-server')
    expect((await load({ BMA__Servers__1__bookmarktable: 'false' })).config.Servers[1]?.bookmarktable).toBe(
      false,
    )
    expect(
      (await load({ BMA__Servers__1__bookmarktable: 'pma__bookmark' })).config.Servers[1]?.bookmarktable,
    ).toBe('pma__bookmark')
    expect((await load({ BMA__Servers__1__ssl_ca: '/ca.pem' })).config.Servers[1]?.ssl_ca).toBe('/ca.pem')
    expect((await load({ BMA__Servers__1__control_ssl: 'null' })).config.Servers[1]?.control_ssl).toBe(null)
    expect((await load({ BMA__Import__ldi_local_option: 'auto' })).config.Import.ldi_local_option).toBe(
      'auto',
    )
    expect((await load({ BMA__Import__ldi_local_option: 'off' })).config.Import.ldi_local_option).toBe(false)
    expect(
      (await load({ BMA__NavigationTreeTableSeparator: 'false' })).config.NavigationTreeTableSeparator,
    ).toBe(false)
    expect(
      (await load({ BMA__NavigationTreeTableSeparator: '["__","--"]' })).config.NavigationTreeTableSeparator,
    ).toStrictEqual(['__', '--'])
  })

  it('parses lists as JSON or comma-separated', async () => {
    expect(
      (await load({ BMA__UserprefsDisallow: 'MaxRows, Export/format' })).config.UserprefsDisallow,
    ).toStrictEqual(['MaxRows', 'Export/format'])
    expect(
      (await load({ BMA__MysqlSslWarningSafeHosts: '["a","b"]' })).config.MysqlSslWarningSafeHosts,
    ).toStrictEqual(['a', 'b'])
    expect(
      (await load({ BMA__Servers__1__AllowDeny__rules: 'allow % from all' })).config.Servers[1]?.AllowDeny
        .rules,
    ).toStrictEqual(['allow % from all'])
    expect((await load({ BMA__Servers__1__only_db: '["a","b"]' })).config.Servers[1]?.only_db).toStrictEqual([
      'a',
      'b',
    ])
    expect((await load({ BMA__Servers__1__only_db: 'single' })).config.Servers[1]?.only_db).toBe('single')
  })

  it('addresses record keys, tuple elements and nested groups', async () => {
    const { config } = await load({
      BMA__DefaultFunctions__FUNC_UUID: 'UUID_SHORT',
      BMA__DefaultTransformations__Substring__1: '10',
      BMA__DefaultTransformations__Inline__0: '200',
      BMA__Export__format: 'csv',
      BMA__Console__Height: '120',
      BMA__Listen__port: '3000',
      BMA__Servers__1__SignonCookieParams__samesite: 'Lax',
    })
    expect(config.DefaultFunctions.FUNC_UUID).toBe('UUID_SHORT')
    expect(config.DefaultFunctions.FUNC_SPATIAL).toBe('GeomFromText')
    expect(config.DefaultTransformations.Substring).toStrictEqual([0, 10, '…'])
    expect(config.DefaultTransformations.Inline[0]).toBe(200)
    expect(config.Export.format).toBe('csv')
    expect(config.Console.Height).toBe(120)
    expect(config.Listen.port).toBe(3000)
    expect(config.Servers[1]?.SignonCookieParams.samesite).toBe('Lax')
  })

  it('accepts JSON for a group or a whole server', async () => {
    const { config } = await load({
      BMA__Listen: '{"host":"0.0.0.0","port":80}',
      BMA__Servers__2: '{"host":"b","port":3307}',
    })
    expect(config.Listen).toStrictEqual({ host: '0.0.0.0', port: 80, basePath: '/' })
    expect(config.Servers[2]?.port).toBe('3307')
  })

  it('accepts the secret alias and the control_* aliases [p08-7bc4a5]', async () => {
    const { config } = await load({ BMA__secret: 's'.repeat(32), BMA__Servers__1__control_user: 'pma' })
    expect(config.blowfish_secret).toBe('s'.repeat(32))
    expect(config.Servers[1]?.controluser).toBe('pma')
  })

  it('matches directive names case-insensitively when unambiguous', async () => {
    expect((await load({ BMA__MAXROWS: '30' })).config.MaxRows).toBe(30)
  })

  it('applies the shortcuts, with explicit BMA__ variables winning', async () => {
    const { config } = await load({
      BMA_HOST: 'db',
      BMA_PORT: '3307',
      BMA_USER: 'app',
      BMA_PASSWORD: 'pw',
      BMA_ARBITRARY_SERVER: 'true',
      BMA_ABSOLUTE_URI: 'https://bma.example/',
    })
    expect(config.Servers[1]).toMatchObject({ host: 'db', port: '3307', user: 'app', password: 'pw' })
    expect(config.AllowArbitraryServer).toBe(true)
    expect(config.PmaAbsoluteUri).toBe('https://bma.example/')
    const both = await load({ BMA_HOST: 'short', BMA__Servers__1__host: 'explicit' })
    expect(both.config.Servers[1]?.host).toBe('explicit')
  })

  it('ignores unrelated variables, including other BMA_ ones', async () => {
    const { config } = await load({ PATH: '/bin', BMA_SOMETHING: 'x', HOME: '/root' })
    expect(config.MaxRows).toBe(25)
  })

  it('reports unknown env directives with the nearest name', async () => {
    await expect(load({ BMA__MaxRow: '5' })).rejects.toThrow(
      /unknown directive "MaxRow". Did you mean "MaxRows"\? \(from env BMA__MaxRow\)/,
    )
    await expect(load({ BMA__Servers__1__hots: 'x' })).rejects.toThrow(
      /Servers.1.hots: unknown directive "hots". Did you mean "Servers.1.host"\?/,
    )
    await expect(load({ BMA__Servers__0__host: 'x' })).rejects.toThrow(
      /expected a 1-based server index, got "0"/,
    )
    await expect(load({ BMA__MaxRows__x: '1' })).rejects.toThrow(/"MaxRows" has no sub-directives/)
  })

  it('never echoes secret values in env errors', async () => {
    const e = await load({ BMA__Servers__1__password: 'hunter2', BMA__Listen: '{bad json' }).catch(
      (x: unknown) => x,
    )
    expect(e).toBeInstanceOf(ConfigError)
    expect((e as Error).message).not.toContain('hunter2')
  })

  it('parseEnv records the origin of every directive', () => {
    const layer = parseEnv({ BMA__MaxRows: '5', BMA_HOST: 'h' })
    expect(layer.issues).toStrictEqual([])
    expect(layer.value).toStrictEqual({ MaxRows: 5, Servers: { 1: { host: 'h' } } })
    expect(layer.origins.get('MaxRows')).toBe('env BMA__MaxRows')
    expect(layer.origins.get('Servers.1.host')).toBe('env BMA_HOST')
  })
})

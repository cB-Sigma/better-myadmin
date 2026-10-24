import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCKER_ENV_NAMES, iniQuantity, parseDockerEnv } from '../src/docker-env.ts'
import { ConfigError } from '../src/errors.ts'
import { loadConfig } from '../src/loader.ts'

/**
 * The official phpMyAdmin image's variables (phpmyadmin/docker config.inc.php,
 * docker-entrypoint.sh) mapped like the image does.
 */
const load = (env: Record<string, string>, file: string | false = false) => loadConfig({ file, env })

describe('BetterMyAdmin names for the image variables', () => {
  it('every phpMyAdmin variable has a distinct BMA_ name', () => {
    const bma = DOCKER_ENV_NAMES.map((n) => n.bma)
    expect(new Set(bma).size).toBe(bma.length)
    expect(bma.every((n) => n.startsWith('BMA_'))).toBe(true)
    expect(DOCKER_ENV_NAMES.find((n) => n.pma === 'APACHE_PORT')?.bma).toBe('BMA_LISTEN_PORT')
  })

  it('the documentation lists every variable under both names (docs-site/setup.rst)', () => {
    const doc = readFileSync(new URL('../../../docs-site/setup.rst', import.meta.url), 'utf8')
    for (const { pma, bma } of DOCKER_ENV_NAMES) {
      expect(doc, bma).toContain(`\`\`${bma}\`\``)
      expect(doc, pma).toContain(`\`\`${pma}\`\``)
    }
  })

  it('a BMA_ name does what its phpMyAdmin variable does', async () => {
    const { config } = await load({
      BMA_DOCKER: '1',
      BMA_HOSTS: 'a, b',
      BMA_HOST_LABELS: 'Primary,Replica',
      BMA_USER: 'root',
      BMA_PASSWORD: 'pw',
      BMA_STORAGE_DB: 'phpmyadmin',
      BMA_CONTROL_USER: 'pma',
      BMA_CONTROL_PASSWORD: 'pmapass',
      BMA_UPLOAD_LIMIT: '64M',
      BMA_EXEC_TIME_LIMIT: '600',
      BMA_LISTEN_PORT: '8080',
    })
    expect(config.Servers[1]).toMatchObject({
      host: 'a',
      verbose: 'Primary',
      auth_type: 'config',
      user: 'root',
    })
    expect(config.Servers[2]).toMatchObject({
      host: 'b',
      verbose: 'Replica',
      controluser: 'pma',
      pmadb: 'phpmyadmin',
    })
    expect(config.Servers[2]?.controlpass).toBe('pmapass')
    expect(config.MaxUploadSize).toBe(64 * 1024 * 1024)
    expect(config.ExecTimeLimit).toBe(600)
    expect(config.Listen.port).toBe(8080)
  })

  it('both set: the BMA_ name wins; secrets files and messages under the BMA_ name', async () => {
    const both = await load({
      BMA_DOCKER: '1',
      APACHE_PORT: '80',
      BMA_LISTEN_PORT: '8080',
      PMA_HOST: 'old',
      BMA_HOST: 'new',
    })
    expect(both.config.Listen.port).toBe(8080)
    expect(both.config.Servers[1]?.host).toBe('new')
    const dir = mkdtempSync(join(tmpdir(), 'bma-secret-'))
    writeFileSync(join(dir, 'pw'), 's3cret\n')
    const secret = await load({ BMA_HOST: 'h', BMA_USER: 'u', BMA_PASSWORD_FILE: join(dir, 'pw') })
    expect(secret.config.Servers[1]?.password).toBe('s3cret')
    const bad = await load({ BMA_UPLOAD_LIMIT: 'lots' }).catch((e: ConfigError) => e)
    expect(String((bad as ConfigError).message)).toContain('env BMA_UPLOAD_LIMIT')
  })
})

describe('phpMyAdmin docker image variables', () => {
  it('nothing set outside the image: no layer', () => {
    expect(parseDockerEnv({}).value).toEqual({})
  })

  it('in the image the linked `db` is the default server, cookie auth, no password allowed', async () => {
    const { config } = await load({ BMA_DOCKER: '1' })
    expect(config.Servers[1]).toMatchObject({
      host: 'db',
      auth_type: 'cookie',
      compress: false,
      AllowNoPassword: true,
    })
    expect(Object.keys(config.Servers)).toEqual(['1'])
    // the image's defaults: all interfaces, the phpMyAdmin image's port, the data volume
    expect(config.Listen).toMatchObject({ host: '0.0.0.0', port: 80 })
    expect(config.DataDir).toBe('/var/lib/bettermyadmin')
    expect((await load({ BMA_DOCKER: '1', APACHE_PORT: '8081' })).config.Listen.port).toBe(8081)
  })

  it('PMA_HOST, PMA_PORT, PMA_VERBOSE, PMA_ARBITRARY, PMA_ABSOLUTE_URI', async () => {
    const { config } = await load({
      PMA_HOST: 'mysql84',
      PMA_PORT: '3307',
      PMA_VERBOSE: 'Primary',
      PMA_ARBITRARY: '1',
      PMA_ABSOLUTE_URI: ' https://example.org/pma/ ',
    })
    expect(config.Servers[1]).toMatchObject({ host: 'mysql84', port: '3307', verbose: 'Primary' })
    expect(config.AllowArbitraryServer).toBe(true)
    expect(config.PmaAbsoluteUri).toBe('https://example.org/pma/')
    // only `1` turns it on, like the image
    expect((await load({ PMA_ARBITRARY: 'true' })).config.AllowArbitraryServer).toBe(false)
  })

  it('PMA_USER / PMA_PASSWORD switch every server to config auth', async () => {
    const { config } = await load({ PMA_HOSTS: 'a, b', PMA_USER: 'root', PMA_PASSWORD: 'pw' })
    for (const i of [1, 2])
      expect(config.Servers[i]).toMatchObject({ auth_type: 'config', user: 'root', password: 'pw' })
    expect(config.Servers[2]?.host).toBe('b')
    // no PMA_PASSWORD: an empty one
    expect((await load({ PMA_HOST: 'a', PMA_USER: 'u' })).config.Servers[1]?.password).toBe('')
  })

  it('PMA_HOSTS with PMA_VERBOSES / PMA_PORTS lists, PMA_SOCKETS', async () => {
    const { config } = await load({ PMA_HOSTS: 'h1,h2', PMA_PORTS: '3306,3307', PMA_VERBOSES: 'one,two' })
    expect([config.Servers[1]?.port, config.Servers[2]?.port]).toEqual(['3306', '3307'])
    expect([config.Servers[1]?.verbose, config.Servers[2]?.verbose]).toEqual(['one', 'two'])
    const s = (await load({ PMA_SOCKETS: '/run/a.sock,/run/b.sock' })).config.Servers
    expect([s[1]?.host, s[1]?.socket, s[2]?.socket]).toEqual(['localhost', '/run/a.sock', '/run/b.sock'])
  })

  it('PMA_PMADB sets the storage database and its tables; control connection variables', async () => {
    const { config } = await load({
      PMA_HOST: 'db',
      PMA_PMADB: 'phpmyadmin',
      PMA_CONTROLUSER: 'pma',
      PMA_CONTROLPASS: 'pmapass',
      PMA_CONTROLHOST: 'ctl',
      PMA_CONTROLPORT: '3308',
    })
    expect(config.Servers[1]).toMatchObject({
      pmadb: 'phpmyadmin',
      relation: 'pma__relation',
      bookmarktable: 'pma__bookmark',
      export_templates: 'pma__export_templates',
      controluser: 'pma',
      controlpass: 'pmapass',
      controlhost: 'ctl',
      controlport: '3308',
    })
  })

  it('global directives: history, uploads, limits, UPLOAD_LIMIT, APACHE_PORT', async () => {
    const { config } = await load({
      PMA_QUERYHISTORYDB: 'true',
      PMA_QUERYHISTORYMAX: '50',
      PMA_UPLOADDIR: '/upload',
      PMA_SAVEDIR: '/save',
      MAX_EXECUTION_TIME: '600',
      MEMORY_LIMIT: '512M',
      UPLOAD_LIMIT: '2048K',
      APACHE_PORT: '8090',
    })
    expect(config).toMatchObject({
      QueryHistoryDB: true,
      QueryHistoryMax: 50,
      UploadDir: '/upload',
      SaveDir: '/save',
      ExecTimeLimit: 600,
      MemoryLimit: '512M',
      MaxUploadSize: 2097152,
    })
    expect(config.Listen.port).toBe(8090)
    // (bool) '0' is false in PHP
    expect((await load({ PMA_QUERYHISTORYDB: '0' })).config.QueryHistoryDB).toBe(false)
  })

  it('UPLOAD_LIMIT is a php.ini quantity', async () => {
    expect([iniQuantity('100'), iniQuantity('64M'), iniQuantity('1g'), iniQuantity('x')]).toEqual([
      100,
      64 * 1024 ** 2,
      1024 ** 3,
      null,
    ])
    await expect(load({ UPLOAD_LIMIT: 'lots' })).rejects.toThrow(ConfigError)
  })

  it('Docker secrets: <NAME>_FILE, trailing newlines dropped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bma-docker-env-'))
    writeFileSync(join(dir, 'pw'), 's3cret\n\n')
    const { config } = await load({ PMA_HOST: 'db', PMA_USER: 'root', PMA_PASSWORD_FILE: join(dir, 'pw') })
    expect(config.Servers[1]?.password).toBe('s3cret')
  })

  it('base64 SSL files are written to PMA_SSL_DIR and used as paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bma-docker-ssl-'))
    const { config } = await load({
      PMA_HOST: 'db',
      PMA_SSL: '1',
      PMA_SSL_DIR: dir,
      PMA_SSL_CA_BASE64: Buffer.from('CA PEM').toString('base64'),
    })
    expect(config.Servers[1]?.ssl).toBe(true)
    expect(config.Servers[1]?.ssl_ca).toBe(join(dir, 'phpmyadmin-ssl-CA-1.pem'))
    expect(readFileSync(join(dir, 'phpmyadmin-ssl-CA-1.pem'), 'utf8')).toBe('CA PEM')
  })

  it('a decoded key is readable by its owner only; a bad value is reported without its content', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'bma-docker-key-')), 'ssl')
    const key = Buffer.from('-----BEGIN PRIVATE KEY-----').toString('base64')
    parseDockerEnv({ PMA_HOST: 'db', PMA_SSL_DIR: dir, PMA_SSL_KEY_BASE64: key })
    expect(statSync(join(dir, 'phpmyadmin-ssl-CERT-1.cert')).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    const secret = 'c2VjcmV0!!not-base64'
    const { issues } = parseDockerEnv({ PMA_HOST: 'db', PMA_SSL_DIR: dir, PMA_SSL_KEY_BASE64: secret })
    expect(issues.map((i) => i.message)).toEqual([
      `Failed to decode: ${join(dir, 'phpmyadmin-ssl-CERT-1.cert')}`,
    ])
    expect(JSON.stringify(issues)).not.toContain(secret)
  })

  it('the config file overrides the image variables, BMA__ variables override both', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bma-docker-file-'))
    const file = join(dir, 'bettermyadmin.config.json')
    writeFileSync(file, JSON.stringify({ Servers: [{ host: 'from-file' }], MaxRows: 50 }))
    const { config } = await load({ PMA_HOST: 'from-env', PMA_PORT: '3307', BMA__MaxRows: '100' }, file)
    expect(config.Servers[1]).toMatchObject({ host: 'from-file', port: '3307' })
    expect(config.MaxRows).toBe(100)
  })
})

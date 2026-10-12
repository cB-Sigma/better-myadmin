import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { getLogMessage, logUser } from '../../src/auth/auth-log.ts'
import { getServer } from '../../src/config.ts'
import { controlServer } from '../../src/db/control.ts'
import { connectionOptions } from '../../src/db/pool-manager.ts'
import { worldWritable } from '../../src/http/config-permissions.ts'
import { httpRequest } from '../../src/util/http-request.ts'
import { testConfig } from '../support/app.ts'

/**
 * Server / connection / shell directives: the control link's `control*` overrides, `AuthLog` /
 * `AuthLogSuccess`, `ssl_ca_path`, `CheckConfigurationPermissions`, `ProxyUrl` / `ProxyUser` /
 * `ProxyPass`.
 */
const tmp = mkdtempSync(join(tmpdir(), 'f01a-dir-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('control link (Config::getConnectionParams ControlUser)', () => {
  it('controlhost / controlport / control_* override the server, settings shared on the same host', () => {
    const same = controlServer(
      getServer(
        testConfig(
          {},
          {
            host: 'db1',
            port: '3307',
            ssl: true,
            hide_connection_errors: true,
            controluser: 'cu',
            controlpass: 'cp',
            controlport: '3310',
            control_ssl: false,
            control_socket: '/s',
          },
        ),
        1,
      )!,
    )
    expect(same.creds).toEqual({ user: 'cu', password: 'cp' })
    expect(same.server).toMatchObject({ host: 'db1', port: '3310', ssl: false, socket: '/s' })
    expect(same.server.hide_connection_errors).toBe(true)

    const other = controlServer(
      getServer(
        testConfig(
          {},
          {
            host: 'db1',
            port: '3307',
            ssl: true,
            hide_connection_errors: true,
            controlhost: 'db2',
            control_hide_connection_errors: false,
          },
        ),
        1,
      )!,
    )
    expect(other.server).toMatchObject({ host: 'db2', port: '', ssl: false })
    expect(other.server.hide_connection_errors).toBe(false)
    const hidden = controlServer(
      getServer(
        testConfig({}, { host: 'db1', controlhost: 'db2', control_hide_connection_errors: true }),
        1,
      )!,
    )
    expect(hidden.server.hide_connection_errors).toBe(true)
  })
})

describe('AuthLog / AuthLogSuccess (Logging::logUser)', () => {
  const sink = () => {
    const lines: string[] = []
    return {
      lines,
      write: {
        stderr: (l: string) => lines.push(`stderr:${l}`),
        file: (p: string, l: string) => lines.push(`${p}:${l}`),
      },
    }
  }
  it('messages', () => {
    expect(getLogMessage('u', 'ok', '1.2.3.4')).toBe('user authenticated: u from 1.2.3.4')
    expect(getLogMessage('u', 'mysql-denied', '1.2.3.4')).toBe('user denied: u (mysql-denied) from 1.2.3.4')
  })
  it('destinations and success logging', () => {
    const s = sink()
    const when = new Date(2026, 0, 5, 7, 8, 9)
    logUser({ AuthLog: 'auto', AuthLogSuccess: false }, 'u', 'ok', '::1', s.write, when)
    logUser({ AuthLog: 'auto', AuthLogSuccess: false }, 'u', 'empty-denied', '::1', s.write, when)
    logUser({ AuthLog: 'php', AuthLogSuccess: true }, 'u', 'ok', '::1', s.write, when)
    logUser({ AuthLog: '', AuthLogSuccess: true }, 'u', 'ok', '::1', s.write, when)
    logUser({ AuthLog: 'syslog', AuthLogSuccess: true }, 'u', 'ok', '::1', s.write, when)
    logUser({ AuthLog: '/var/log/pma.log', AuthLogSuccess: false }, 'u', 'no-activity', '::1', s.write, when)
    expect(s.lines).toEqual([
      'stderr:user denied: u (empty-denied) from ::1',
      'stderr:user authenticated: u from ::1',
      '/var/log/pma.log:Jan 05 07:08:09 phpmyadmin: user denied: u (no-activity) from ::1\n',
    ])
  })
})

describe('ssl_ca_path (mysqli capath)', () => {
  it('every certificate of the directory is trusted, after ssl_ca', () => {
    const dir = join(tmp, 'ca')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir)
    writeFileSync(join(dir, 'b.pem'), '-----BEGIN CERTIFICATE-----B')
    writeFileSync(join(dir, 'a.crt'), '-----BEGIN CERTIFICATE-----A')
    writeFileSync(join(dir, 'readme.txt'), 'x')
    const s = getServer(
      testConfig({}, { ssl: true, ssl_ca: '-----BEGIN CERTIFICATE-----0', ssl_ca_path: dir }),
      1,
    )!
    const opts = connectionOptions(s, { user: 'u', password: '' })
    expect((opts.ssl as { ca: string[] }).ca).toEqual([
      '-----BEGIN CERTIFICATE-----0',
      '-----BEGIN CERTIFICATE-----A',
      '-----BEGIN CERTIFICATE-----B',
    ])
  })
})

describe('CheckConfigurationPermissions (Config::checkPermissions)', () => {
  it('a world-writable file is refused, except on Windows', () => {
    const f = join(tmp, 'config.json')
    writeFileSync(f, '{}')
    chmodSync(f, 0o644)
    expect(worldWritable(f, 'linux')).toBe(false)
    chmodSync(f, 0o666)
    expect(worldWritable(f, 'linux')).toBe(true)
    expect(worldWritable(f, 'win32')).toBe(false)
    expect(worldWritable(undefined, 'linux')).toBe(false)
  })
})

describe('ProxyUrl / ProxyUser / ProxyPass (HttpRequest)', () => {
  it('HTTP goes to the proxy as an absolute URI with Proxy-Authorization; HTTPS opens a CONNECT tunnel', async () => {
    const seen: Array<{ method: string; url: string; auth: string | undefined }> = []
    const proxy = http.createServer((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers['proxy-authorization'] })
      res.end('feed')
    })
    proxy.on('connect', (req, socket: net.Socket) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers['proxy-authorization'] })
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
    const { port } = proxy.address() as net.AddressInfo
    try {
      const settings = { ProxyUrl: `127.0.0.1:${port}`, ProxyUser: 'pu', ProxyPass: 'pp' }
      const got = await httpRequest(settings, 'http://example.invalid/version.json')
      expect(got).toEqual({ status: 200, body: 'feed' })
      await expect(httpRequest(settings, 'https://example.invalid/x')).rejects.toThrow('proxy CONNECT 403')
      const auth = `Basic ${Buffer.from('pu:pp').toString('base64')}`
      expect(seen).toEqual([
        { method: 'GET', url: 'http://example.invalid/version.json', auth },
        { method: 'CONNECT', url: 'example.invalid:443', auth },
      ])
    } finally {
      proxy.close()
    }
  })
})

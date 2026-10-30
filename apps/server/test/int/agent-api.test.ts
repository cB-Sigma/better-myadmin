import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MYSQL, testApp, testConfig } from '../support/app.ts'

/**
 * The agent API and its MCP endpoint (docs/features/16-agent-api.md): every request authenticates
 * on its own (Basic / config / the SignonPage's agentCredentials), passes the login rules, and runs
 * with the MySQL user's privileges; no session, no CSRF token, but no cross-site requests either.
 */
// biome-ignore lint/suspicious/noExplicitAny: response JSON read loosely in assertions
type Any = any
const DB = 'agent_it'
const OTHER = 'agent_it_other'
const USER = 'agent_it_user'
const base = '/api/agent/v1/servers/1'
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`

let root: mysql.Connection
let t: ReturnType<typeof testApp>
let dir: string

async function call(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: string | null } = {},
): Promise<{ status: number; json: Any; res: Response }> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  if (init.auth !== null) headers.Authorization = init.auth ?? basic(USER, USER)
  if (init.body !== undefined && headers['Content-Type'] === undefined)
    headers['Content-Type'] = 'application/json'
  const res = await t.app.request(`${base}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(init.body !== undefined
      ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) }
      : {}),
  })
  const text = await res.text()
  return { status: res.status, json: text === '' ? null : JSON.parse(text), res }
}
const mcp = (msg: unknown, headers: Record<string, string> = {}) => call('/mcp', { body: msg, headers })

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${OTHER};
    CREATE DATABASE ${DB}; CREATE DATABASE ${OTHER};
    CREATE TABLE ${DB}.items (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(20) NOT NULL COMMENT 'the name',
      price DECIMAL(20,4), data VARBINARY(4), big BIGINT UNSIGNED, KEY by_name (name, price)) COMMENT 'stock';
    INSERT INTO ${DB}.items (name, price, data, big) VALUES ('a', 1.5, 0x00ff, 18446744073709551615), ('b', NULL, NULL, 1), ('c', 3, NULL, 2);
    CREATE VIEW ${DB}.v AS SELECT id FROM ${DB}.items;
    CREATE TABLE ${OTHER}.secret (x INT);
    DROP USER IF EXISTS '${USER}'@'%'; CREATE USER '${USER}'@'%' IDENTIFIED BY '${USER}';
    GRANT SELECT, INSERT, UPDATE, DELETE, SHOW VIEW ON ${DB}.* TO '${USER}'@'%';`)
  // under the workspace: the test runner loads the SignonPage module (as auth-types.test.ts)
  mkdirSync(join(process.cwd(), '.data'), { recursive: true })
  dir = mkdtempSync(join(process.cwd(), '.data', 'agent-'))
})
afterAll(async () => {
  await root.query(
    `DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${OTHER}; DROP USER IF EXISTS '${USER}'@'%'`,
  )
  await root.end()
  rmSync(dir, { recursive: true, force: true })
})
afterEach(async () => t?.close())

describe('agent API: enabling and authentication', () => {
  it('is off by default (AgentApi)', async () => {
    t = testApp(testConfig({}))
    const r = await call('/databases')
    expect(r.status).toBe(404)
    expect(r.json.error.message).toMatch(/AgentApi/)
  })

  it('cookie auth: HTTP Basic, a 401 that asks for it, wrong passwords counted by the login limiter', async () => {
    t = testApp(testConfig({ AgentApi: true, LoginRateLimit: { maxAttempts: 3 } }))
    const none = await call('/databases', { auth: null })
    expect(none.status).toBe(401)
    expect(none.res.headers.get('WWW-Authenticate')).toMatch(/^Basic /)
    const bad = await call('/databases', { auth: basic(USER, 'wrong') })
    expect(bad.status).toBe(401)
    expect(bad.json.error.code).toBe('AUTH_REQUIRED')
    await call('/databases', { auth: basic(USER, 'wrong') })
    await call('/databases', { auth: basic(USER, 'wrong') })
    // locked out now, even with the right password
    const locked = await call('/databases')
    expect(locked.status).toBe(429)
  })

  it('the login rules apply (AllowRoot), and no session cookie is set', async () => {
    t = testApp(testConfig({ AgentApi: true }, { AllowRoot: false }))
    const r = await call('/databases', { auth: basic('root', MYSQL.password) })
    expect(r.status).toBe(403)
    const ok = await call('/databases')
    expect(ok.status).toBe(200)
    expect(ok.res.headers.get('Set-Cookie')).toBeNull()
  })

  it('config auth: the configured user, no credentials in the request', async () => {
    t = testApp(testConfig({ AgentApi: true }, { auth_type: 'config', user: USER, password: USER }))
    const r = await call('/databases', { auth: null })
    expect(r.status).toBe(200)
    expect(r.json.databases).toContain(DB)
  })

  it("signon auth: the SignonPage module's agentCredentials export", async () => {
    const file = join(dir, 'signon.mjs')
    writeFileSync(
      file,
      `export default () => new Response('page')
export function agentCredentials(request) {
  const u = request.headers.get('x-test-user')
  return u === null ? null : { user: u, password: u }
}`,
    )
    t = testApp(
      testConfig(
        { AgentApi: true },
        { auth_type: 'signon', SignonSession: 'S', SignonURL: '/signon/', SignonPage: file },
      ),
    )
    expect((await call('/databases', { auth: null })).status).toBe(401)
    const r = await call('/databases', { auth: null, headers: { 'x-test-user': USER } })
    expect(r.status).toBe(200)
    expect(r.json.databases).toContain(DB)
  })

  it('refuses cross-site requests: another Origin, a POST that is not JSON', async () => {
    t = testApp(testConfig({ AgentApi: true }))
    const cross = await call('/databases', { headers: { Origin: 'https://evil.example' } })
    expect(cross.status).toBe(403)
    const form = await call('/query', {
      body: 'sql=SELECT+1',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(form.status).toBe(415)
    const same = await call('/databases', { headers: { Origin: 'http://localhost', Host: 'localhost' } })
    expect(same.status).toBe(200)
  })
})

describe("agent API: reading and querying with the user's privileges", () => {
  it('databases (only those the user may see), tables, describe', async () => {
    t = testApp(testConfig({ AgentApi: true }))
    const dbs = (await call('/databases')).json.databases as string[]
    expect(dbs).toContain(DB)
    expect(dbs).not.toContain(OTHER)
    const tables = (await call(`/databases/${DB}/tables`)).json.tables
    expect(tables).toEqual([
      expect.objectContaining({ name: 'items', type: 'table', engine: 'InnoDB', comment: 'stock' }),
      expect.objectContaining({ name: 'v', type: 'view', rows: null }),
    ])
    const d = (await call(`/databases/${DB}/tables/items`)).json
    // MariaDB keeps the display widths MySQL 8 dropped (int(11), bigint(20) unsigned)
    expect(
      d.columns.map((c: Any) => [c.name, c.type.replace(/^(int|bigint)\(\d+\)/, '$1'), c.nullable]),
    ).toEqual([
      ['id', 'int', false],
      ['name', 'varchar(20)', false],
      ['price', 'decimal(20,4)', true],
      ['data', 'varbinary(4)', true],
      ['big', 'bigint unsigned', true],
    ])
    expect(d.columns[1].comment).toBe('the name')
    expect(d.indexes).toEqual([
      { name: 'PRIMARY', unique: true, type: 'BTREE', columns: ['id'] },
      { name: 'by_name', unique: false, type: 'BTREE', columns: ['name', 'price'] },
    ])
    expect(d.create).toMatch(/^CREATE TABLE `items`/)
    // another database: the server's own refusal
    const denied = await call(`/databases/${OTHER}/tables`)
    expect(denied.status).toBe(400)
    expect(denied.json.error.errno).toBe(1044)
  })

  it('query: exact values, binary as base64, the row limit, writes, stop at the first error', async () => {
    t = testApp(testConfig({ AgentApi: true }))
    const r = await call('/query', {
      body: { sql: 'SELECT id, name, price, data, big FROM items ORDER BY id', db: DB, maxRows: 2 },
    })
    expect(r.status).toBe(200)
    const [s] = r.json.statements
    expect(s.columns.map((c: Any) => c.name)).toEqual(['id', 'name', 'price', 'data', 'big'])
    expect(s.rows).toEqual([
      ['1', 'a', '1.5000', { base64: 'AP8=' }, '18446744073709551615'],
      ['2', 'b', null, null, '1'],
    ])
    expect(s.truncated).toBe(true)
    const all = (await call('/query', { body: { sql: `SELECT id FROM ${DB}.items`, maxRows: 3 } })).json
      .statements[0]
    expect(all.truncated).toBe(false)
    expect(all.rows).toHaveLength(3)

    const w = await call('/query', {
      body: {
        sql: "INSERT INTO items (name) VALUES ('d'); UPDATE items SET price = 9 WHERE name = 'd'; SELECT nope FROM items; SELECT 1",
        db: DB,
      },
    })
    const st = w.json.statements
    expect(st).toHaveLength(3)
    expect(st[0]).toMatchObject({ affectedRows: 1, insertId: '4' })
    expect(st[1]).toMatchObject({ affectedRows: 1 })
    expect(st[2].error).toMatchObject({ errno: 1054 })
    // a privilege the user lacks
    const drop = (await call('/query', { body: { sql: 'DROP TABLE items', db: DB } })).json.statements[0]
    expect(drop.error.errno).toBe(1142)
  })

  it('DROP DATABASE follows AllowUserDropDatabase, as in the SQL box', async () => {
    await root.query(`GRANT DROP ON ${DB}.* TO '${USER}'@'%'`)
    try {
      t = testApp(testConfig({ AgentApi: true }))
      const r = (await call('/query', { body: { sql: `DROP DATABASE ${DB}` } })).json.statements[0]
      expect(r.error.message).toMatch(/DROP DATABASE/)
      const [[exists]] = (await root.query(`SHOW DATABASES LIKE '${DB}'`)) as unknown as [unknown[]]
      expect(exists).toBeDefined()
    } finally {
      await root.query(`REVOKE DROP ON ${DB}.* FROM '${USER}'@'%'`)
    }
  })

  it('explain', async () => {
    t = testApp(testConfig({ AgentApi: true }))
    const r = (await call('/explain', { body: { sql: "SELECT * FROM items WHERE name = 'a'", db: DB } })).json
    expect(r.sql).toBe("EXPLAIN SELECT * FROM items WHERE name = 'a'")
    expect(r.columns.map((c: Any) => c.name)).toContain('key')
    expect(r.rows[0]).toContain('by_name')
  })
})

describe('MCP endpoint', () => {
  it('initialize, tools/list, notifications, a tool call, errors', async () => {
    t = testApp(testConfig({ AgentApi: true }))
    const init = await mcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    })
    expect(init.json.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'bettermyadmin' },
    })
    expect((await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    const list = await mcp(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'MCP-Protocol-Version': '2025-06-18' },
    )
    expect(list.json.result.tools.map((x: Any) => x.name)).toEqual([
      'list_databases',
      'list_tables',
      'describe_table',
      'query',
      'explain',
    ])

    const q = await mcp({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: { sql: 'SELECT name FROM items ORDER BY id LIMIT 1', database: DB },
      },
    })
    expect(q.json.result.isError).toBe(false)
    expect(q.json.result.structuredContent.statements[0].rows).toEqual([['a']])
    expect(JSON.parse(q.json.result.content[0].text)).toEqual(q.json.result.structuredContent)

    const failed = await mcp({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'query', arguments: { sql: 'SELECT nope' } },
    })
    expect(failed.json.result.isError).toBe(true)
    const denied = await mcp({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'list_tables', arguments: { database: OTHER } },
    })
    expect(denied.json.result.isError).toBe(true)
    expect(denied.json.result.content[0].text).toMatch(/denied/)
    const unknown = await mcp({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
    })
    expect(unknown.json.error.code).toBe(-32602)
    const missing = await mcp({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'describe_table', arguments: { database: DB } },
    })
    expect(missing.json.error.code).toBe(-32602)
    expect((await mcp({ jsonrpc: '2.0', id: 8, method: 'nope' })).json.error.code).toBe(-32601)
    expect((await mcp('{bad', {})).json.error.code).toBe(-32700)
    expect(
      (await mcp({ jsonrpc: '2.0', id: 9, method: 'ping' }, { 'MCP-Protocol-Version': '1999-01-01' })).status,
    ).toBe(400)
    expect((await call('/mcp')).status).toBe(405)
  })

  it('without credentials: a 401 before any method runs', async () => {
    t = testApp(testConfig({ AgentApi: true }))
    const r = await call('/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, auth: null })
    expect(r.status).toBe(401)
    expect(r.res.headers.get('WWW-Authenticate')).toMatch(/^Basic /)
  })
})

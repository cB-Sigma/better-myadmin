import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { MYSQL, testApp } from '../support/app.ts'

/**
 * Every GET endpoint asked with odd query values (`true`, empty strings, `k[]=` lists, nested maps,
 * JSON-looking text, repeated keys) for every query name the server reads: an endpoint answers, or
 * refuses with a 4xx (the VALIDATION envelope), but never fails with a 5xx. The browser side is
 * tests/e2e/search-params.e2e.ts.
 */
const DB = 'f05_odd_int'
const app = testApp()
let root: mysql.Connection

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
const src = (dir: string) =>
  files(join(import.meta.dirname, dir))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(f, 'utf8'))

/** the query names: c.req.query('…') / queries('…'), and the contracts' request fields */
const keys = [
  ...new Set([
    ...src('../../src').flatMap((s) =>
      [...s.matchAll(/req\.quer(?:y|ies)\('(\w+)'\)/g)].map((m) => m[1] as string),
    ),
    ...src('../../../../packages/contracts/src').flatMap((s) =>
      [...s.matchAll(/^\s+(\w+): z\./gm)].map((m) => m[1] as string),
    ),
  ]),
]
const variants: Array<(k: string) => string> = [
  (k) => `${k}=true&${k}=1`,
  (k) => `${k}[]=a&${k}[]=1`,
  (k) => `${k}=`,
  (k) => `${k}[x][y]=null&${k}=%5B1%5D`,
]
const values: Record<string, string> = { s: '1', db: DB, t: 't', table: 't' }
const routes = [
  ...new Set(
    app.app.routes
      .filter((r) => r.method === 'GET' && r.path.startsWith('/api/') && !r.path.includes('*'))
      .map((r) =>
        r.path.replace(
          /:(\w+)(\{(?:[^{}]|\{[^}]*\})*\})?/g,
          (_, k: string, re?: string) => values[k] ?? (re ? '1' : 'x'),
        ),
      ),
  ),
]

beforeAll(async () => {
  root = await mysql.createConnection({ ...MYSQL, multipleStatements: true })
  await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
    CREATE TABLE ${DB}.t (id INT PRIMARY KEY, v VARCHAR(10)); INSERT INTO ${DB}.t VALUES (1, 'a')`)
  await app.login()
})
afterAll(async () => {
  await root.query(`DROP DATABASE IF EXISTS ${DB}`)
  await root.end()
  await app.close()
})

it(
  'every GET endpoint refuses or reads odd query values, never with a 5xx',
  { timeout: 600_000 },
  async () => {
    expect(routes.length).toBeGreaterThan(100)
    expect(keys).toEqual(expect.arrayContaining(['pos', 'db', 'table']))
    const failed: string[] = []
    let answered = 0
    for (const route of routes) {
      for (const v of variants) {
        // in chunks under RequestProblemChecking's 1000 parameters ("possible exploit")
        for (let at = 0; at < keys.length; at += 400) {
          const url = `${route}?${keys
            .slice(at, at + 400)
            .map(v)
            .join('&')}`
          const r = await Promise.race([
            app.req('GET', url),
            new Promise<null>((ok) => setTimeout(() => ok(null), 15_000)),
          ])
          if (r === null) failed.push(`${route} [timeout] ${v('k')}`)
          else {
            if (r.status < 300) answered++
            if (r.status >= 500)
              failed.push(`${route} [${r.status}] ${v('k')}: ${JSON.stringify(r.json).slice(0, 300)}`)
          }
        }
      }
    }
    expect(failed).toEqual([])
    // most endpoints read the odd values instead of refusing them
    expect(answered).toBeGreaterThan(routes.length * variants.length * Math.ceil(keys.length / 400) * 0.5)
  },
)

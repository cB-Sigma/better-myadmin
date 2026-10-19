import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type mysql from 'mysql2/promise'
import type { testApp } from '../../../apps/server/test/support/app.ts'
import { readZip } from '../../../packages/export/src/zip.ts'
import { findForm, serializeForm } from './form.ts'
import type { PmaClient } from './pma.ts'

/**
 * Shared pieces of the export/import parity suites: the seed schema, the export form of
 * phpMyAdmin (scraped, so defaults come from phpMyAdmin), the dump of both tools and the header
 * normalisation (docs/architecture/11: tool, version, timestamp lines are not compared).
 */
export const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}

export type Pairs = Array<[string, string]>

export const SEED = readFileSync(new URL('../fixtures/export-seed.sql', import.meta.url), 'utf8')

/** (Re)creates `db` with the seed schema. */
export async function seedDatabase(root: mysql.Connection, db: string): Promise<void> {
  await root.query(
    `DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE \`${db}\`; ${SEED}`,
  )
}

export async function createAccounts(root: mysql.Connection, users: string[]): Promise<void> {
  for (const u of users) {
    await root.query(
      `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON *.* TO '${u}'@'%'`,
    )
  }
}

/** The `dump` form of phpMyAdmin's export page for a scope, serialized like the browser does. */
export async function pmaExportForm(
  pma: PmaClient,
  scope: 'server' | 'database' | 'table',
  params: Record<string, string> = {},
): Promise<Pairs> {
  const html = await pma.getPage(`/${scope}/export`, params)
  const start = html.indexOf('<form method="post" action="index.php?route=/export" name="dump"')
  if (start < 0) throw new Error(`no export form on /${scope}/export: ${html.slice(0, 500)}`)
  return serializeForm(findForm(html.slice(start), { action: 'route=/export' })).filter(
    ([k]) => k !== 'token',
  )
}

/** Replaces (or adds) fields; `null` removes them (an unticked checkbox). */
export function withFields(pairs: Pairs, changes: Record<string, string | string[] | null>): Pairs {
  let out = [...pairs]
  for (const [k, v] of Object.entries(changes)) {
    out = out.filter(([n]) => n !== k)
    if (v === null) continue
    if (Array.isArray(v)) for (const x of v) out.push([k, x])
    else out.push([k, v])
  }
  return out
}

export interface Dump {
  status: number
  contentType: string
  filename: string
  body: Buffer
}

const dispositionName = (h: string | null): string => {
  if (h === null) return ''
  const star = /filename\*=UTF-8''([^;]+)/.exec(h)
  if (star) return decodeURIComponent(star[1] as string)
  return /filename="([^"]*)"/.exec(h)?.[1] ?? ''
}

export async function pmaDump(pma: PmaClient, pairs: Pairs): Promise<Dump> {
  let status = 0
  let headers = new Headers()
  const body = await pma.postPage('/export', pairs, {
    binary: true,
    onHeaders: (st, h) => {
      status = st
      headers = h
    },
  })
  return {
    status,
    contentType: headers.get('content-type') ?? '',
    filename: dispositionName(headers.get('content-disposition')),
    body: Buffer.from(body, 'latin1'),
  }
}

export async function bmaDump(bma: ReturnType<typeof testApp>, pairs: Pairs): Promise<Dump> {
  const prep = await bma.req('POST', '/api/servers/1/export', { params: pairs })
  if (prep.status !== 200) throw new Error(`BMA export failed: ${JSON.stringify(prep.json)}`)
  const id = prep.json.id as string | undefined
  if (id === undefined)
    return { status: 200, contentType: '', filename: '', body: Buffer.from(JSON.stringify(prep.json)) }
  const cookie = [...bma.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await bma.app.request(`/api/servers/1/export/${id}`, { headers: { cookie } })
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    filename: dispositionName(res.headers.get('content-disposition')),
    body: Buffer.from(await res.arrayBuffer()),
  }
}

/** Header lines naming the tool, its version, the runtime and the generation time. */
const TOOL_LINE =
  /^(--|%|#|-|\s\*)\s*(phpMyAdmin|BetterMyAdmin) [A-Za-z ]*Dump\s*$|^(--|%|-|\s\*) ?(@?version|https?:\/\/|Generation Time:|PHP Version:|Node\.js Version:)/

export function normaliseText(s: string): string {
  return s
    .split('\n')
    .filter((l) => !TOOL_LINE.test(l))
    .join('\n')
}

/** The comparable text of a dump: decompressed, zip entries concatenated with their names. */
export function comparable(d: Dump): string {
  let b = d.body
  // "View output as text": phpMyAdmin's page holds the dump in a textarea, escaped
  const html = b.toString('latin1')
  const ta = /<textarea name="sqldump"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)
  if (ta !== null) {
    const text = (ta[1] as string)
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
    return normaliseText(text)
  }
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b)
  if (b[0] === 0x50 && b[1] === 0x4b) {
    return readZip(b)
      .map((e) => `== ${e.name}\n${normaliseText(e.data.toString('latin1'))}`)
      .join('\n')
  }
  return normaliseText(b.toString('latin1'))
}

/**
 * Mask the one environment-determined token in an export artifact: the configured server host (and,
 * in a "Host:" dump-header line, the port it connects on). Our app reaches MySQL on 127.0.0.1 and
 * the published port; the reference reaches it by its compose service name on :3306. This appears in
 * the dump header ("-- Host: …", "% Host: …"), in each per-database file's zip-entry name
 * (`<host>_<db>.sql`) and in the download filename (`<db>-<host>-…`, `srv-<host>.csv`). Everything
 * else stays byte-exact, and locally both sides are 127.0.0.1 so this is a near no-op.
 */
const EXPORT_HOSTS = [
  'mysql84-replica',
  'mariadb11-replica',
  'mysql84',
  'mariadb11',
  '127.0.0.1',
  '127_0_0_1',
  process.env.BMA_TEST_HOST ?? '127.0.0.1',
]
const EXPORT_HOST_RE = new RegExp(`(?:${EXPORT_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})`, 'g')
export const maskExportHost = (s: string): string =>
  s.replace(/(Host: )\S+/g, '$1%HOST%').replace(EXPORT_HOST_RE, '%HOST%')

/** Version / tool strings that differ by design (the JSON header, PHP array doc comment, …). */
export function normaliseFormat(s: string): string {
  return s
    .replace(/("version":\s*)"[^"]*"(,\s*"comment":\s*"Export to JSON plugin for )[^"]*"/, '$1"V"$2TOOL"')
    .replace(/^ \* Export to PHP Array plugin for .*$/m, ' * Export to PHP Array plugin for TOOL')
    .replace(/^ \* @version .*$/m, ' * @version V')
}

export function compareOpenDocument(d: Dump): string {
  return readZip(d.body)
    .map((e) => {
      let text = e.data.toString('utf8')
      if (e.name === 'meta.xml') text = text.replace(/<office:meta>.*<\/office:meta>/, '<office:meta/>')
      return `== ${e.name}\n${text}`
    })
    .join('\n')
}

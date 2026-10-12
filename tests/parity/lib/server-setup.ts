import mysql from 'mysql2/promise'
import { testApp, testConfig } from '../../../apps/server/test/support/app.ts'
import { type AllowedDiff, compareLogs } from './compare.ts'
import { GeneralLog, type LogEntry } from './general-log.ts'
import { PmaClient, isPmaUp } from './pma.ts'

/**
 * Shared set-up of the server-level parity suites: two superuser accounts (one per tool, so each
 * tool's statements can be isolated in the general log), a logged-in phpMyAdmin client, a logged-in
 * BetterMyAdmin app and helpers that run one action in both tools and diff the statements.
 */
export const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
export const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
export const PMA_USER = 'm3srv_pma'
export const BMA_USER = 'm3srv_bma'

export const pmaReachable = await isPmaUp(PMA_URL)

/**
 * Reads phpMyAdmin performs on every Status page (the DI container builds Server\Status\Data for
 * each Status controller) or per request (menu, privileges, pmadb), next to the page's own.
 */
export const PER_REQUEST: AllowedDiff[] = [
  {
    tool: 'pma',
    pattern: '^SELECT `PLUGIN_NAME`, `PLUGIN_DESCRIPTION` FROM `information_schema`\\.`PLUGINS`',
    why: 'Authentication plugins listed by the change-password form phpMyAdmin renders on every page; not part of these pages.',
  },
]

export interface Harness {
  users: { pma: string; bma: string }
  root: mysql.Connection
  log: GeneralLog
  pma: PmaClient
  bma: ReturnType<typeof testApp>
  dbMap: Record<string, string>
  close(): Promise<void>
}

/** Account names per suite (suites may run concurrently: each needs its own general-log users). */
export const suiteUsers = (tag: string) => ({ pma: `${PMA_USER}_${tag}`, bma: `${BMA_USER}_${tag}` })

/**
 * `target` points both tools at another MySQL and phpMyAdmin (the dev replica: its MySQL root and
 * the reference instance whose server it is); our app then gets that host and port as server 1.
 */
export async function startHarness(
  cfg: Parameters<typeof testConfig>[0] = {},
  users: { pma: string; bma: string; grant?: string } = { pma: PMA_USER, bma: BMA_USER },
  server: Parameters<typeof testConfig>[1] = {},
  target: { root: typeof ROOT; pmaUrl: string } = { root: ROOT, pmaUrl: PMA_URL },
): Promise<Harness> {
  const root = await mysql.createConnection({ ...target.root, multipleStatements: true })
  for (const u of [users.pma, users.bma]) {
    await root.query(
      `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; ${users.grant?.replaceAll('{user}', u) ?? `GRANT ALL ON *.* TO '${u}'@'%' WITH GRANT OPTION`}`,
    )
  }
  const log = await GeneralLog.open(target.root)
  const pma = new PmaClient(target.pmaUrl)
  await pma.login(users.pma, users.pma)
  const bma = testApp(
    testConfig(
      cfg,
      target.root === ROOT ? server : { host: target.root.host, port: target.root.port, ...server },
    ),
  )
  await bma.login(users.bma, users.bma)
  return {
    users: { pma: users.pma, bma: users.bma },
    root,
    log,
    pma,
    bma,
    dbMap: { [users.pma]: 'tool_user', [users.bma]: 'tool_user' },
    async close() {
      await bma.close()
      await log.close()
      for (const u of [users.pma, users.bma]) await root.query(`DROP USER IF EXISTS '${u}'@'%'`)
      await root.end()
    },
  }
}

/** Runs the phpMyAdmin action then the BetterMyAdmin one, returning both results and statement logs. */
export async function both<P, B>(
  h: Harness,
  pmaAction: () => Promise<P>,
  bmaAction: () => Promise<B>,
  users: { pma: string; bma: string } = h.users,
): Promise<{ p: P; b: B; pmaLog: LogEntry[]; bmaLog: LogEntry[] }> {
  const m1 = await h.log.marker()
  const p = await pmaAction()
  const pmaLog = await h.log.since(users.pma, m1)
  const m2 = await h.log.marker()
  const b = await bmaAction()
  const bmaLog = await h.log.since(users.bma, m2)
  return { p, b, pmaLog, bmaLog }
}

export function diff(
  h: Harness,
  pmaLog: LogEntry[],
  bmaLog: LogEntry[],
  extra: AllowedDiff[] = [],
  dbMap: Record<string, string> = {},
) {
  return compareLogs(pmaLog, bmaLog, { ...h.dbMap, ...dbMap }, { extra: [...PER_REQUEST, ...extra] })
}

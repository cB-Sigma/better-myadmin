import type {
  ReplicaUserResponse,
  ReplicationActionResponse,
  ReplicationPage,
} from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { maskClientIp, maskServerHost } from './lib/compare.ts'
import type { LogEntry } from './lib/general-log.ts'
import { $, $$, type Node, elements, hasClass, pageHtml, parse, text } from './lib/html.ts'
import { isPmaUp } from './lib/pma.ts'
import { type Harness, ROOT, both, diff, pmaReachable, startHarness } from './lib/server-setup.ts'
import { TARGET } from './lib/target.ts'

/**
 * Golden parity of Server › Replication against both replication roles of the dev setup:
 * - the shared primary (mysql84 :3306, phpMyAdmin :8081): primary card, connected replicas, the
 *   primary configuration wizard, "Add replica replication user" (CREATE USER + GRANT REPLICATION
 *   SLAVE), the not-a-replica card, the change-primary form and its AllowArbitraryServer refusal;
 * - the dev replica (mysql84-replica :3308, phpMyAdmin :8083 with AllowArbitraryServer, see
 *   docker/dev.compose.yml and docker/pma-ref/local-replica.sh): replica card, status table, every
 *   control (Full start/stop, SQL/IO thread only, Reset), skipping errors and changing the primary.
 *   Before each tool's action the replica is put in the same state, so both tools act on the same
 *   thread states and their statements must be identical.
 *
 * Log positions move between the two requests (the primary is shared): positions are masked.
 */
const REPLICA_ROOT = {
  ...ROOT,
  host: process.env.BMA_PARITY_REPLICA_HOST ?? ROOT.host,
  port: Number(process.env.BMA_PARITY_REPLICA_PORT ?? 3308),
}
const REPLICA_PMA = process.env.BMA_PARITY_REPLICA_PMA_URL ?? 'http://127.0.0.1:8083'
/**
 * The primary as the reference and the replica reach it (host networking: 127.0.0.1:3306), entered
 * in phpMyAdmin's change-primary form; `OURS` is the same server as our app reaches it (they differ
 * in compose networking, where the reference reaches it by service name). The statements are
 * compared with phpMyAdmin's host and port mapped to ours.
 */
const SOURCE = {
  host: process.env.BMA_PARITY_REPLICA_SOURCE_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_PARITY_REPLICA_SOURCE_PORT ?? ROOT.port),
  user: 'bma_repl',
  password: 'bma_repl',
}
const OURS = {
  host: process.env.BMA_PARITY_REPLICA_SOURCE_HOST_OURS ?? ROOT.host,
  port: Number(process.env.BMA_PARITY_REPLICA_SOURCE_PORT_OURS ?? ROOT.port),
}
const SOURCE_SAME = SOURCE.host === OURS.host && SOURCE.port === OURS.port
/** MariaDB says MASTER in CHANGE MASTER TO, SHOW BINLOG STATUS and SQL_SLAVE_SKIP_COUNTER */
const MARIADB = TARGET === 'mariadb'
const SQL = {
  binlogStatus: MARIADB ? 'SHOW BINLOG STATUS' : 'SHOW BINARY LOG STATUS',
  change: MARIADB ? 'CHANGE MASTER TO' : 'CHANGE REPLICATION SOURCE TO',
  skip: MARIADB ? 'SQL_SLAVE_SKIP_COUNTER' : 'SQL_REPLICA_SKIP_COUNTER',
}
const USERS = { pma: 'f06r_pma', bma: 'f06r_bma' }
const NEW_USERS = { pma: 'f06r_new_p', bma: 'f06r_new_b' }

const replicaReachable =
  pmaReachable &&
  (await isPmaUp(REPLICA_PMA)) &&
  (await mysql
    .createConnection(REPLICA_ROOT)
    .then(async (c) => {
      const [rows] = (await c.query('SHOW REPLICA STATUS')) as unknown as [unknown[]]
      await c.end()
      return rows.length > 0
    })
    .catch(() => false))

let p: Harness
let r: Harness | undefined

beforeAll(async () => {
  if (!pmaReachable) return
  p = await startHarness({}, USERS)
  await p.root.query(
    Object.values(NEW_USERS)
      .flatMap((u) => [`DROP USER IF EXISTS '${u}'@'%'`, `DROP USER IF EXISTS '${u}'@'localhost'`])
      .join(';'),
  )
  if (replicaReachable)
    r = await startHarness(
      { AllowArbitraryServer: true },
      USERS,
      {},
      { root: REPLICA_ROOT, pmaUrl: REPLICA_PMA },
    )
})
afterAll(async () => {
  await p?.root.query(
    Object.values(NEW_USERS)
      .flatMap((u) => [`DROP USER IF EXISTS '${u}'@'%'`, `DROP USER IF EXISTS '${u}'@'localhost'`])
      .join(';'),
  )
  if (r !== undefined) await restoreReplica(r.root)
  await r?.close()
  await p?.close()
})

const bmaJson = async <T>(h: Harness, method: 'GET' | 'POST', path: string, body?: unknown) => {
  const res = await h.bma.req(method, `/api/servers/1${path}`, body)
  expect(res.status, JSON.stringify(res.json)).toBe(200)
  return res.json as unknown as T
}

/** both(), with `prepare` run as root before each tool's request (both start from the same state). */
async function bothFrom<P, B>(
  h: Harness,
  prepare: () => Promise<void>,
  pmaAction: () => Promise<P>,
  bmaAction: () => Promise<B>,
) {
  await prepare()
  const m1 = await h.log.marker()
  const pr = await pmaAction()
  const pmaLog = await h.log.since(h.users.pma, m1)
  await prepare()
  const m2 = await h.log.marker()
  const b = await bmaAction()
  const bmaLog = await h.log.since(h.users.bma, m2)
  return { p: pr, b, pmaLog, bmaLog }
}

/**
 * Reads allowed-diffs.yaml hides for phpMyAdmin (per-request probes and getColumns) that this page
 * sends in the same place: DatabaseInterface::getColumns('mysql', 'user') for the user/host field
 * lengths and the isGrantUser probe of Privileges::getSqlQueriesForDisplayAndAddUser.
 */
const SAME_AS_PMA = [
  '^SELECT `COLUMN_NAME` AS `Field`',
  '^SHOW INDEXES FROM `mysql`\\.`user`$',
  "^SHOW SESSION VARIABLES LIKE 'collation_connection'$",
  '^SELECT 1 FROM \\(SELECT `GRANTEE`, `IS_GRANTABLE` FROM `INFORMATION_SCHEMA`',
].map((pattern) => ({
  tool: 'bma' as const,
  pattern,
  why: 'phpMyAdmin sends it too, hidden for it by allowed-diffs.yaml (getColumns, isGrantUser)',
}))

/** The alert boxes that are direct children of `id` (the flash messages, the thread errors). */
const alertsIn = (html: Node, id: string, cls = 'alert') => {
  const box = $(html, `#${id}`)
  return box === undefined
    ? []
    : elements(box)
        .filter((e) => hasClass(e, cls))
        .map((e) => text(e).trim())
}

/** phpMyAdmin's host and port of the primary as ours (they differ only in compose networking) */
const mapSource = (log: LogEntry[]): LogEntry[] =>
  SOURCE_SAME
    ? log
    : log.map((e) => ({
        ...e,
        sql: e.sql
          .replace(`_HOST='${SOURCE.host}'`, `_HOST='${OURS.host}'`)
          .replace(new RegExp(`_PORT=${SOURCE.port}\\b`), `_PORT=${OURS.port}`),
      }))

/** Positions of the shared primary's binary log and the relay log move between the two requests. */
const maskLog = (log: LogEntry[]): LogEntry[] =>
  log.map((e) => ({ ...e, sql: e.sql.replace(/((?:SOURCE|MASTER)_LOG_POS\s*=\s*)\d+/gi, '$1N') }))

const MOVING = new Set([
  'Position',
  'Read_Source_Log_Pos',
  'Read_Master_Log_Pos',
  'Relay_Log_Pos',
  'Exec_Source_Log_Pos',
  'Exec_Master_Log_Pos',
  'Relay_Log_Space',
  'Seconds_Behind_Source',
  'Seconds_Behind_Master',
  'Relay_Log_File',
  'Replica_IO_State',
  'Slave_IO_State',
  'File',
  'Source_Log_File',
  'Relay_Source_Log_File',
  'Master_Log_File',
  'Relay_Master_Log_File',
])

/** status_table.twig rows: [name, value (moving ones masked), status class] */
function pmaStatusTable(html: Node, type: 'primary' | 'replica') {
  const table = $(html, `table#server${type}replicationsummary`)
  if (table === undefined) return null
  return $$(table, 'tbody tr').map((tr) => {
    const [name, value] = $$(tr, 'td').map((td) => text(td).trim())
    const span = $(tr, 'span')!
    const status = hasClass(span, 'text-danger')
      ? 'text-danger'
      : hasClass(span, 'text-success')
        ? 'text-success'
        : ''
    return [name, MOVING.has(name!) ? '…' : value, status]
  })
}
const bmaStatusTable = (t: { variables: Array<{ name: string; value: string; status: string }> } | null) =>
  t === null ? null : t.variables.map((v) => [v.name, MOVING.has(v.name) ? '…' : v.value, v.status])

/** The cards of server/replication/index.twig, with their visible text (ids of the links). */
function pmaCards(html: Node) {
  return $$(html, '.card').map((c) => text($(c, '.card-header')!).trim())
}

/** Thread states for the replica (as root); waits until the threads report them. */
async function setThreads(root: mysql.Connection, io: boolean, sql: boolean) {
  await root.query(io ? 'START REPLICA IO_THREAD' : 'STOP REPLICA IO_THREAD')
  await root.query(sql ? 'START REPLICA SQL_THREAD' : 'STOP REPLICA SQL_THREAD')
  for (let i = 0; i < 50; i++) {
    const [[s]] = (await root.query('SHOW REPLICA STATUS')) as unknown as [[Record<string, string>]]
    // MariaDB keeps the Slave_* column names
    const ioOn = (s.Replica_IO_Running ?? s.Slave_IO_Running) === 'Yes'
    const sqlOn = (s.Replica_SQL_Running ?? s.Slave_SQL_Running) === 'Yes'
    if (ioOn === io && sqlOn === sql) return
    await new Promise((res) => setTimeout(res, 200))
  }
  throw new Error(`replica threads did not reach io=${io} sql=${sql}`)
}

/** Points the replica back at the dev primary from its current position and starts it. */
async function restoreReplica(root: mysql.Connection) {
  const primary = await mysql.createConnection({ ...SOURCE, host: ROOT.host, port: ROOT.port })
  const [[pos]] = (await primary.query(SQL.binlogStatus)) as unknown as [[Record<string, string>]]
  await primary.end()
  await root.query('STOP REPLICA')
  const p = MARIADB ? 'MASTER' : 'SOURCE'
  await root.query(
    `${SQL.change} ${p}_HOST=?, ${p}_PORT=?, ${p}_USER=?, ${p}_PASSWORD=?, ${p}_LOG_FILE=?, ${p}_LOG_POS=${Number(pos.Position)}${MARIADB ? ', MASTER_USE_GTID=no' : ', GET_SOURCE_PUBLIC_KEY=1'}`,
    [SOURCE.host, SOURCE.port, SOURCE.user, SOURCE.password, pos.File],
  )
  await setThreads(root, true, true)
}

describe.skipIf(!pmaReachable)('parity: replication on the primary [p06-3af6a2]', () => {
  it('page: primary card, status table, connected replicas, not-a-replica card', async () => {
    const res = await both(
      p,
      () => p.pma.postJson('/server/replication', {}),
      () => bmaJson<ReplicationPage>(p, 'GET', '/replication'),
    )
    const cmp = diff(p, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const html = parse(pageHtml(res.p))
    const page = res.b
    expect(page.isSuperUser).toBe(true)
    expect(page.isPrimary).toBe(true)
    expect(pmaCards(html)).toEqual(['Primary replication', 'Replica replication'])
    expect(bmaStatusTable(page.primary!.statusTable)).toEqual(pmaStatusTable(html, 'primary'))
    const replicas = $$(html, '#replication_replicas_section tbody tr').map((tr) =>
      $$(tr, 'td').map((td) => text(td).trim()),
    )
    expect(page.primary!.replicas.map((x) => [x.serverId, x.host])).toEqual(replicas)
    // not a replica: the configure link, no replica GUI
    expect(page.replica!.isReplica).toBe(false)
    expect($(html, '#replica_configuration_gui')).toBeUndefined()
    expect(text($$(html, 'div.card')[1]!)).toContain('This server is not configured as replica')
  })

  it('primary configuration wizard: the non-system databases', async () => {
    const before = await liveDatabases()
    const res = await both(
      p,
      () => p.pma.postJson('/server/replication', { primary_configure: '1' }),
      () => bmaJson<ReplicationPage>(p, 'GET', '/replication?view=primary_configure'),
    )
    const after = await liveDatabases()
    const cmp = diff(p, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const html = parse(pageHtml(res.p))
    const pmaDbs = $$(html, '#db_select option').map((o) => o.attrs.value ?? '')
    const ours = res.b.primaryConfiguration!.databases
    // databases other suites created or dropped meanwhile (even both) may differ: compare the stable ones
    const stable = new Set(before.filter((d) => after.includes(d)))
    expect(ours.filter((d) => stable.has(d))).toEqual(pmaDbs.filter((d) => stable.has(d)))
    expect(ours).not.toContain('information_schema')
    expect(ours).toContain('mysql')
    expect(res.b.replica).toBeNull()
    expect(pmaCards(html)).toEqual(['Primary replication', 'Primary configuration'])
  })

  it('add replica user form: field lengths, presets, "This host"', async () => {
    const res = await both(
      p,
      () => p.pma.postJson('/server/replication', { primary_add_user: '1', replica_clear_screen: '1' }),
      () => bmaJson<ReplicationPage>(p, 'GET', '/replication?view=primary_add_user'),
    )
    const cmp = diff(p, res.pmaLog, res.bmaLog, SAME_AS_PMA)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const html = parse(pageHtml(res.p))
    const f = res.b.addUser!
    expect(String(f.usernameLength)).toBe($(html, '#pma_username')!.attrs.maxlength)
    expect(String(f.hostnameLength)).toBe($(html, '#pma_hostname')!.attrs.maxlength)
    // "this host" is the connecting client's IP, which differs between the apps (compose net vs host)
    const thisHost = (v: string | null) => (v === null ? null : maskClientIp(v))
    expect(thisHost(f.thisHost)).toBe(
      thisHost($(html, '#select_pred_hostname')!.attrs['data-thishost'] ?? null),
    )
    expect($$(html, '#select_pred_hostname option').map((o) => o.attrs.value)).toEqual([
      'any',
      'localhost',
      ...(f.thisHost !== null ? ['thishost'] : []),
      'hosttable',
      'userdefined',
    ])
    expect(res.b.primary).toBeNull()
    expect(res.b.replica).toBeNull()
  })

  const userForm = (u: string, extra: Record<string, string> = {}) => ({
    pred_username: 'userdefined',
    username: u,
    pred_hostname: 'any',
    hostname: '',
    pred_password: 'userdefined',
    pma_pw: 'F06r_secret!1',
    ...extra,
  })
  const pmaAddUser = (form: Record<string, string>) =>
    p.pma.postPage('/server/privileges', {
      grant_count: '25',
      createdb: '0',
      Repl_slave_priv: 'Y',
      sr_take_action: 'true',
      adduser_submit: '1',
      pma_pw2: form.pma_pw ?? '',
      generated_pw: '',
      ...form,
    })

  for (const [name, extra] of [
    ['password, any host', {}],
    ['no password, local host', { pred_password: 'none', pred_hostname: 'localhost', pma_pw: '' }],
  ] as Array<[string, Record<string, string>]>) {
    it(`add replica user (${name}): CREATE USER, GRANT REPLICATION SLAVE, ALTER USER … REQUIRE NONE [p06-57b49f]`, async () => {
      const res = await both(
        p,
        () => pmaAddUser(userForm(NEW_USERS.pma, extra)),
        () =>
          bmaJson<ReplicaUserResponse>(
            p,
            'POST',
            '/replication/replica-user',
            userForm(NEW_USERS.bma, extra),
          ),
      )
      // phpMyAdmin goes on with the new user's edit page (Users & privileges): only the writes and
      // the reads before them are this form's
      const firstWrite = (log: LogEntry[]) => log.findIndex((e) => /^(CREATE|GRANT|ALTER)\b/.test(e.sql))
      const cut = (log: LogEntry[]) =>
        log.slice(0, log.findLastIndex((e) => /^(CREATE|GRANT|ALTER)\b/.test(e.sql)) + 1)
      expect(firstWrite(res.pmaLog)).toBeGreaterThan(-1)
      const cmp = diff(p, cut(res.pmaLog), res.bmaLog, SAME_AS_PMA, {
        [NEW_USERS.pma]: 'NEW',
        [NEW_USERS.bma]: 'NEW',
      })
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      const html = parse(res.p)
      const box = $(html, 'div.result_query')!
      expect(res.b.success).toBe(true)
      expect(text($(box, 'div.alert')!).trim()).toBe(res.b.message.text)
      expect(text($(box, 'code')!).replaceAll(NEW_USERS.pma, 'NEW')).toBe(
        res.b.sql.replaceAll(NEW_USERS.bma, 'NEW'),
      )

      // the same user again: "The user … already exists!"
      const again = await both(
        p,
        () => pmaAddUser(userForm(NEW_USERS.pma, extra)),
        () =>
          bmaJson<ReplicaUserResponse>(
            p,
            'POST',
            '/replication/replica-user',
            userForm(NEW_USERS.bma, extra),
          ),
      )
      const cmp2 = diff(p, cut(again.pmaLog), again.bmaLog, SAME_AS_PMA, {
        [NEW_USERS.pma]: 'NEW',
        [NEW_USERS.bma]: 'NEW',
      })
      expect(cmp2.bma.filter((s) => /^(CREATE|GRANT|ALTER)\b/.test(s))).toEqual([])
      expect(again.b.success).toBe(false)
      const err = $$(parse(again.p), 'div.alert-danger').map((d) => text(d).trim())
      expect(err.map((e) => e.replace(NEW_USERS.pma, 'NEW'))).toContain(
        text(parse(again.b.message.text)).replace(NEW_USERS.bma, 'NEW'),
      )
      await p.root.query(
        Object.values(NEW_USERS)
          .flatMap((u) => [`DROP USER IF EXISTS '${u}'@'%'`, `DROP USER IF EXISTS '${u}'@'localhost'`])
          .join(';'),
      )
    })
  }

  it('change-primary form on a non-replica, and the AllowArbitraryServer refusal (no statement) [p06-8d7e2c]', async () => {
    const form = await both(
      p,
      () => p.pma.postJson('/server/replication', { replica_configure: '1', replica_clear_screen: '1' }),
      () => bmaJson<ReplicationPage>(p, 'GET', '/replication?view=replica_configure'),
    )
    const cmp = diff(p, form.pmaLog, form.bmaLog, SAME_AS_PMA)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const html = parse(pageHtml(form.p))
    expect(String(form.b.changePrimary!.usernameLength)).toBe($(html, '#text_username')!.attrs.maxlength)
    expect(String(form.b.changePrimary!.hostnameLength)).toBe($(html, '#text_hostname')!.attrs.maxlength)
    expect(pmaCards(html)).toEqual(['Replica configuration - Change or reconfigure primary server'])
    expect(form.b.primary).toBeNull()
    expect(form.b.replica).toBeNull()

    // the reference on :8081 and our default configuration do not allow arbitrary servers
    const refused = await both(
      p,
      () =>
        p.pma.postJson('/server/replication', {
          sr_take_action: 'true',
          replica_changeprimary: '1',
          username: SOURCE.user,
          pma_pw: SOURCE.password,
          hostname: SOURCE.host,
          text_port: String(SOURCE.port),
        }),
      () =>
        bmaJson<ReplicationActionResponse>(p, 'POST', '/replication/change-primary', {
          username: SOURCE.user,
          password: SOURCE.password,
          hostname: SOURCE.host,
          port: String(SOURCE.port),
        }),
    )
    const c2 = diff(p, refused.pmaLog, refused.bmaLog)
    expect(c2.problems, c2.problems.join('\n')).toEqual([])
    expect(c2.bma.filter((s) => !/^(SELECT|SHOW|USE|SET)/.test(s))).toEqual([])
    const msg = $$(parse(pageHtml(refused.p)), 'div.alert-danger').map((d) => text(d).trim())
    expect(refused.b.success).toBe(false)
    expect(msg).toContain(refused.b.message!.text)
  })
})

/** The replica's receiver thread logs in as the same account when it (re)connects */
const notReplicaThread = (e: LogEntry) =>
  !/^(SELECT @@GLOBAL\.|SET @(master|source|slave|replica)_|SELECT @source_binlog_checksum)/i.test(e.sql)

async function liveDatabases(): Promise<string[]> {
  const [rows] = (await p.root.query({ sql: 'SHOW DATABASES', rowsAsArray: true })) as unknown as [string[][]]
  return rows.map((x) => x[0]!)
}

describe.skipIf(!replicaReachable)('parity: replication on the replica [p06-3c4d46]', () => {
  afterEach(async () => {
    if (r !== undefined) await setThreads(r.root, true, true)
  })

  it('page: not-a-primary card, replica card, status table and the control links', async () => {
    const h = r!
    await setThreads(h.root, true, true)
    const res = await both(
      h,
      () => h.pma.postJson('/server/replication', {}),
      () => bmaJson<ReplicationPage>(h, 'GET', '/replication'),
    )
    const cmp = diff(h, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const html = parse(pageHtml(res.p))
    expect(res.b.isPrimary).toBe(false)
    expect(text($$(html, 'div.card')[0]!)).toContain('This server is not configured as primary')
    expect(res.b.replica!.isReplica).toBe(true)
    expect(bmaStatusTable(res.b.replica!.statusTable)).toEqual(pmaStatusTable(html, 'replica'))
    const links = $$(html, '#replica_control_gui a').map((a) => [text(a).trim(), a.attrs['data-post'] ?? ''])
    const action = (post: string) => /sr_replica_action=(\w+)/.exec(post)?.[1]
    expect(links.map(([label]) => label)).toEqual([
      'Full stop',
      'Reset replica',
      'Stop SQL Thread only',
      'Stop IO Thread only',
    ])
    const rep = res.b.replica!
    expect([rep.fullAction, 'reset', rep.sqlAction, rep.ioAction]).toEqual(
      links.map(([, post]) => action(post!)),
    )
    expect(alertsIn(html, 'replica_configuration_gui', 'alert-danger')).toEqual([])
  })

  for (const [name, io, sql] of [
    ['both threads stopped', false, false],
    ['IO thread stopped', false, true],
    ['SQL thread stopped', true, false],
  ] as Array<[string, boolean, boolean]>) {
    it(`page flags and labels: ${name}`, async () => {
      const h = r!
      const res = await bothFrom(
        h,
        () => setThreads(h.root, io, sql),
        () => h.pma.postJson('/server/replication', {}),
        () => bmaJson<ReplicationPage>(h, 'GET', '/replication'),
      )
      const html = parse(pageHtml(res.p))
      const rep = res.b.replica!
      // each flag is its own thread's state (phpMyAdmin swaps them and reads the IO state from
      // Replica_SQL_Running: Q16, Q62)
      expect([rep.ioRunning, rep.sqlRunning]).toEqual([io, sql])
      const ours = {
        errors: [
          ...(!sql ? ['Replica SQL Thread not running!'] : []),
          ...(!io ? ['Replica IO Thread not running!'] : []),
        ],
        links: [
          !io || !sql ? 'Full start' : 'Full stop',
          'Reset replica',
          !sql ? 'Start SQL Thread only' : 'Stop SQL Thread only',
          !io ? 'Start IO Thread only' : 'Stop IO Thread only',
        ],
        actions: [!io || !sql ? 'start' : 'stop', !sql ? 'start' : 'stop', !io ? 'start' : 'stop'],
      }
      expect([rep.fullAction, rep.sqlAction, rep.ioAction]).toEqual(ours.actions)
      // phpMyAdmin's IO flag is Replica_SQL_Running (Q62; MariaDB has the Slave_* columns, which it
      // reads right), and the template gets the two swapped (Q16)
      const pmaIo = MARIADB ? io : sql
      const pmaSql = sql
      const pmaView = {
        errors: [
          ...(!pmaIo ? ['Replica SQL Thread not running!'] : []),
          ...(!pmaSql ? ['Replica IO Thread not running!'] : []),
        ],
        links: [
          !pmaIo || !pmaSql ? 'Full start' : 'Full stop',
          'Reset replica',
          !pmaIo ? 'Start SQL Thread only' : 'Stop SQL Thread only',
          !pmaSql ? 'Start IO Thread only' : 'Stop IO Thread only',
        ],
      }
      expect({
        errors: alertsIn(html, 'replica_configuration_gui', 'alert-danger'),
        links: $$(html, '#replica_control_gui a').map((a) => text(a).trim()),
      }).toEqual(pmaView)
      if (io === sql) expect({ errors: ours.errors, links: ours.links }).toEqual(pmaView)
      expect(bmaStatusTable(rep.statusTable)).toEqual(pmaStatusTable(html, 'replica'))
    })
  }

  const controls: Array<
    [
      string,
      { io: boolean; sql: boolean },
      Record<string, string>,
      { action: string; control: string | null },
    ]
  > = [
    ['Full stop', { io: true, sql: true }, { sr_replica_action: 'stop' }, { action: 'stop', control: null }],
    [
      'Full start',
      { io: false, sql: false },
      { sr_replica_action: 'start' },
      { action: 'start', control: null },
    ],
    [
      'Stop SQL Thread only',
      { io: true, sql: true },
      { sr_replica_action: 'stop', sr_replica_control_param: 'SQL_THREAD' },
      { action: 'stop', control: 'SQL_THREAD' },
    ],
    [
      'Start IO Thread only',
      { io: false, sql: true },
      { sr_replica_action: 'start', sr_replica_control_param: 'IO_THREAD' },
      { action: 'start', control: 'IO_THREAD' },
    ],
    [
      'Reset replica',
      { io: true, sql: true },
      { sr_replica_action: 'reset' },
      { action: 'reset', control: null },
    ],
  ]
  for (const [name, from, pmaForm, bmaBody] of controls) {
    it(`control: ${name}`, async () => {
      const h = r!
      const res = await bothFrom(
        h,
        () => setThreads(h.root, from.io, from.sql),
        () =>
          h.pma.postJson('/server/replication', {
            sr_take_action: '1',
            sr_replica_server_control: '1',
            ...pmaForm,
          }),
        () => bmaJson<ReplicationActionResponse>(h, 'POST', '/replication/control', bmaBody),
      )
      const cmp = diff(h, res.pmaLog, res.bmaLog)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      expect(cmp.bma.some((s) => /^(START|STOP|RESET) REPLICA/.test(s))).toBe(true)
      expect(res.p.success).toBe(res.b.success)
      expect(text(parse(String(res.p.message ?? res.p.error))).trim()).toBe(res.b.message!.text)
    })
  }

  it('skip next 2 errors: STOP; SET GLOBAL SQL_REPLICA_SKIP_COUNTER = 2; START (no message)', async () => {
    const h = r!
    const res = await bothFrom(
      h,
      () => setThreads(h.root, true, true),
      () =>
        h.pma.postJson('/server/replication', {
          sr_take_action: '1',
          sr_replica_skip_error: 'Go',
          sr_skip_errors_count: '2',
        }),
      () => bmaJson<ReplicationActionResponse>(h, 'POST', '/replication/skip-errors', { count: '2' }),
    )
    const cmp = diff(h, res.pmaLog, res.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma).toContain(`SET GLOBAL ${SQL.skip} = 2`)
    expect(res.b.message).toBeNull()
    expect(alertsIn(parse(pageHtml(res.p)), 'replication')).toEqual([])
  })

  it('change primary: binary log position from the primary, STOP, CHANGE REPLICATION SOURCE (not started) [p06-8d7e2c]', async () => {
    const h = r!
    const primaryLog = p.log
    const auxUser = SOURCE.user
    const form = { username: SOURCE.user, hostname: SOURCE.host }
    const ours = { username: SOURCE.user, hostname: OURS.host }
    const pmaAux: LogEntry[] = []
    const bmaAux: LogEntry[] = []
    const res = await bothFrom(
      h,
      () => setThreads(h.root, true, true),
      async () => {
        const m = await primaryLog.marker()
        const out = await h.pma.postJson('/server/replication', {
          sr_take_action: 'true',
          replica_changeprimary: '1',
          ...form,
          pma_pw: SOURCE.password,
          text_port: String(SOURCE.port),
        })
        pmaAux.push(...(await primaryLog.since(auxUser, m)).filter(notReplicaThread))
        return out
      },
      async () => {
        const m = await primaryLog.marker()
        const out = await bmaJson<ReplicationActionResponse>(h, 'POST', '/replication/change-primary', {
          ...ours,
          password: SOURCE.password,
          port: String(OURS.port),
        })
        bmaAux.push(...(await primaryLog.since(auxUser, m)).filter(notReplicaThread))
        return out
      },
    )
    // CHANGE REPLICATION SOURCE names the primary by host: ours 127.0.0.1, the reference its compose
    // service name. Mask only that host token (never the port, SOURCE_LOG_FILE/POS or clause order).
    const maskHost = (log: LogEntry[]): LogEntry[] => log.map((e) => ({ ...e, sql: maskServerHost(e.sql) }))
    const cmp = diff(h, maskHost(maskLog(mapSource(res.pmaLog))), maskHost(maskLog(res.bmaLog)))
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(cmp.bma.some((s) => s.startsWith(SQL.change))).toBe(true)
    expect(cmp.bma).toContain('STOP REPLICA')
    expect(cmp.bma).not.toContain('START REPLICA')
    // the auxiliary connection to the primary only reads the position
    expect(bmaAux.map((e) => e.sql)).toEqual(pmaAux.map((e) => e.sql))
    expect(bmaAux.map((e) => e.sql)).toContain(SQL.binlogStatus)
    expect(res.b.success).toBe(true)
    const msg = $$(parse(pageHtml(res.p)), 'div.alert-success').map((d) => text(d).trim())
    expect(msg).toContain(res.b.message!.text.replace(OURS.host, SOURCE.host))
    await restoreReplica(h.root)

    // a primary that refuses the login
    const bad = await bothFrom(
      h,
      () => setThreads(h.root, true, true),
      () =>
        h.pma.postJson('/server/replication', {
          sr_take_action: 'true',
          replica_changeprimary: '1',
          ...form,
          pma_pw: 'wrong',
          text_port: String(SOURCE.port),
        }),
      () =>
        bmaJson<ReplicationActionResponse>(h, 'POST', '/replication/change-primary', {
          ...ours,
          password: 'wrong',
          port: String(OURS.port),
        }),
    )
    const c2 = diff(h, bad.pmaLog, bad.bmaLog)
    expect(c2.problems, c2.problems.join('\n')).toEqual([])
    expect(c2.bma.some((s) => /^(STOP|CHANGE)/.test(s))).toBe(false)
    const err = alertsIn(parse(pageHtml(bad.p)), 'replication', 'alert-danger')
    expect(err).toEqual([bad.b.message!.text.replace(OURS.host, SOURCE.host)])
  })
})

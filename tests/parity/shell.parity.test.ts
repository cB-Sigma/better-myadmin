import type { HomeResponse } from '@bettermyadmin/contracts'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { DB_TABS, SERVER_TABS, TABLE_TABS } from '../../apps/web/src/features/shell/tabs.ts'
import { classify, maskEnv, normalise } from './lib/compare.ts'
import { GeneralLog, type LogEntry } from './lib/general-log.ts'
import { PmaClient, breadcrumb, homeCard, homeWarnings, isPmaUp, menuTabs, visibleText } from './lib/pma.ts'
import { TARGET } from './lib/target.ts'

/**
 * Golden parity of the shell: the tab sets, breadcrumb comments, home-page blocks and warnings,
 * the connection collation and the change-password statements, phpMyAdmin vs BetterMyAdmin.
 * Each role exists twice (…_pa_… for phpMyAdmin, …_pb_… for BetterMyAdmin, same grants) so the
 * general log separates the two tools; every statement BetterMyAdmin runs for the tab bars must
 * also be one phpMyAdmin runs for the same page.
 */
const PMA_URL = process.env.BMA_PARITY_PMA_URL ?? 'http://127.0.0.1:8081'
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const DB = 'm1shell_par'
const ROLES = {
  lim: `GRANT SELECT ON ${DB}.* TO %u`,
  trg: `GRANT SELECT, TRIGGER, EVENT ON ${DB}.* TO %u`,
  su: 'GRANT ALL PRIVILEGES ON *.* TO %u WITH GRANT OPTION',
  pw: `GRANT SELECT ON ${DB}.* TO %u`,
} as const
type Role = keyof typeof ROLES
const user = (tool: 'pa' | 'pb', role: Role) => `m1shell_${tool}_${role}`
const dbMap: Record<string, string> = {}
for (const r of Object.keys(ROLES) as Role[]) {
  dbMap[user('pa', r)] = `user_${r}`
  dbMap[user('pb', r)] = `user_${r}`
}

const reachable = await isPmaUp(PMA_URL)

/** The reference instance: controluser pma/pmapass, pmadb phpmyadmin, a 34-byte blowfish_secret. */
const bmaConfig = () =>
  testConfig(
    { blowfish_secret: 'ref-pma-secret-ref-pma-secret-0123' },
    {
      host: ROOT.host,
      port: String(ROOT.port),
      controluser: 'pma',
      controlpass: 'pmapass',
      pmadb: 'phpmyadmin',
    },
  )

const reads = (log: LogEntry[]) =>
  log.map((e) => normalise(e.sql, dbMap)).filter((s) => classify(s) === 'read')

/** BetterMyAdmin-only reads, each justified (see also tests/parity/allowed-diffs.yaml). */
const BMA_ONLY = [
  // the M0 login verifies the credentials on a throw-away connection (auth/cookie.ts probe)
  /^SELECT (@@)?version, (@@)?version_comment$/,
  // Table::isView/getComment read TABLE_TYPE/TABLE_COMMENT from getTablesFull's cache in phpMyAdmin
  /^SELECT TABLE_TYPE, TABLE_COMMENT FROM information_schema\.TABLES WHERE /,
]

describe.skipIf(!reachable)(
  'parity: shell (Menu, HomeController, /collation-connection, /user-password)',
  () => {
    let root: mysql.Connection
    let log: GeneralLog

    beforeAll(async () => {
      root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
      // a socket reset under CI load emits a connection-level 'error' (not a query rejection); without
      // a listener Node throws it as an unhandled event and crashes the worker, even after a test body
      root.on('error', () => {})
      await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};
      CREATE TABLE ${DB}.t (id INT PRIMARY KEY) COMMENT='Shell parity; InnoDB free: 0 kB';
      CREATE VIEW ${DB}.v_upd AS SELECT id FROM ${DB}.t;
      CREATE VIEW ${DB}.v_ro AS SELECT COUNT(*) AS n FROM ${DB}.t;`)
      for (const r of Object.keys(ROLES) as Role[]) {
        for (const tool of ['pa', 'pb'] as const) {
          const u = user(tool, r)
          await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}';`)
          await root.query(ROLES[r].replace('%u', `'${u}'@'%'`))
        }
      }
      // phpMyAdmin keeps per-user preferences (DefaultConnectionCollation, …) in pmadb: start clean
      await root.query("DELETE FROM phpmyadmin.pma__userconfig WHERE username LIKE 'm1shell\\_%'")
      log = await GeneralLog.open(ROOT)
    })

    afterAll(async () => {
      for (const r of Object.keys(ROLES) as Role[]) {
        for (const tool of ['pa', 'pb'] as const)
          await root.query(`DROP USER IF EXISTS '${user(tool, r)}'@'%'`)
      }
      await root.query(`DROP DATABASE IF EXISTS ${DB}`)
      await root.query("DELETE FROM phpmyadmin.pma__userconfig WHERE username LIKE 'm1shell\\_%'")
      await root.end()
      await log.close()
    })

    const PAGES = [
      { name: 'server', pma: '/index.php?route=/', bma: '/api/servers/1', defs: SERVER_TABS },
      {
        name: 'database',
        pma: `/index.php?route=/database/structure&db=${DB}`,
        bma: `/api/servers/1/databases/${DB}`,
        defs: DB_TABS,
      },
      {
        name: 'information_schema',
        pma: '/index.php?route=/database/structure&db=information_schema',
        bma: '/api/servers/1/databases/information_schema',
        defs: DB_TABS,
      },
      // the reference crashes on /database/structure for `mysql` (TypeError); the SQL tab has the same menu
      {
        name: 'mysql',
        pma: '/index.php?route=/database/sql&db=mysql',
        bma: '/api/servers/1/databases/mysql',
        defs: DB_TABS,
        su: true,
      },
      {
        name: 'table',
        pma: `/index.php?route=/sql&db=${DB}&table=t&pos=0`,
        bma: `/api/servers/1/databases/${DB}/tables/t/capabilities`,
        defs: TABLE_TABS,
      },
      {
        name: 'updatable view',
        pma: `/index.php?route=/sql&db=${DB}&table=v_upd&pos=0`,
        bma: `/api/servers/1/databases/${DB}/tables/v_upd/capabilities`,
        defs: TABLE_TABS,
      },
      {
        name: 'read-only view',
        pma: `/index.php?route=/sql&db=${DB}&table=v_ro&pos=0`,
        bma: `/api/servers/1/databases/${DB}/tables/v_ro/capabilities`,
        defs: TABLE_TABS,
      },
    ] as const

    for (const role of ['su', 'lim', 'trg'] as const) {
      it(`tab bars and capability SQL as ${role}`, async () => {
        const pma = new PmaClient(PMA_URL)
        const bma = testApp(bmaConfig())
        try {
          const pmaUser = user('pa', role)
          const bmaUser = user('pb', role)
          const since = await log.marker()
          await pma.login(pmaUser, pmaUser)
          const pmaTabs: Record<string, string[]> = {}
          const pmaCrumb: Record<string, string> = {}
          const pages = PAGES.filter((p) => !('su' in p) || role === 'su')
          for (const p of pages) {
            const html = await pma.getPage(p.pma)
            pmaTabs[p.name] = menuTabs(html)
            pmaCrumb[p.name] = breadcrumb(html).comment
          }
          expect((await bma.login(bmaUser, bmaUser)).status).toBe(200)
          for (const p of pages) {
            const r = await bma.req('GET', p.bma)
            expect(r.status, JSON.stringify(r.json)).toBe(200)
            const tabs = (r.json.tabs as Array<{ key: string }>).map(
              (t) => (p.defs as Record<string, { text: string }>)[t.key]!.text,
            )
            expect(tabs, `${role}: ${p.name} tabs`).toEqual(pmaTabs[p.name])
            if (p.name !== 'server')
              expect(String(r.json.comment ?? ''), `${role}: ${p.name} comment`).toBe(pmaCrumb[p.name])
          }
          const pmaReads = new Set(reads(await log.since(pmaUser, since)))
          const bmaReads = reads(await log.since(bmaUser, since))
          const extra = bmaReads.filter((s) => !pmaReads.has(s) && !BMA_ONLY.some((re) => re.test(s)))
          expect(extra, 'statements BetterMyAdmin sends that phpMyAdmin does not').toEqual([])
        } finally {
          await bma.close()
        }
      })
    }

    it('home page: Database server card, collation list, warnings [p06-f6908d]', async () => {
      const pma = new PmaClient(PMA_URL)
      const bma = testApp(bmaConfig())
      try {
        await pma.login(user('pa', 'su'), user('pa', 'su'))
        const html = await pma.getPage('/index.php?route=/')
        await bma.login(user('pb', 'su'), user('pb', 'su'))
        const r = await bma.req('GET', '/api/servers/1/home', undefined, { host: '127.0.0.1:8081' })
        const home = r.json as unknown as HomeResponse
        const d = home.databaseServer!
        // the two apps reach MySQL differently (reference by its compose host, ours on 127.0.0.1),
        // so the "Server:" host and the "User: …@<ip>" client IP are env-determined: maskEnv aligns
        // only those; the rest of the card stays byte-exact
        const mapUser = (s: string) =>
          maskEnv(s.replace(user('pa', 'su'), 'U').replace(user('pb', 'su'), 'U'))
        expect(homeCard(html, 'Database server').map(mapUser)).toEqual(
          [
            `Server: ${d.host}`,
            `Hostname: ${d.hostname}`,
            `Server type: ${d.type}`,
            `Server connection: ${d.connection.message}`,
            `Server version: ${d.version}`,
            `User: ${d.user}`,
            `Server charset: ${d.charset}`,
          ].map(mapUser),
        )
        // the collation select: every charset/collation, getDefaultCollation() selected (quirk Q42)
        const select = html.match(/<select[^>]*id="collationConnectionSelect"[\s\S]*?<\/select>/)![0]
        const pmaOptions = [...select.matchAll(/<option value="([^"]*)" title="([^"]*)"( selected)?>/g)].map(
          (m) => ({
            name: m[1],
            description: m[2],
            selected: m[3] !== undefined,
          }),
        )
        const ours = home.collation.charsets.flatMap((c) =>
          c.collations.map((x) => ({
            name: x.name,
            description: x.description,
            selected: x.name === home.collation.selected,
          })),
        )
        expect(ours).toEqual(pmaOptions)
        const groups = [...select.matchAll(/<optgroup label="([^"]*)" title="([^"]*)">/g)].map((m) => [
          m[1],
          m[2],
        ])
        expect(home.collation.charsets.map((c) => [c.name, c.description])).toEqual(groups)
        // warnings (BBCode rendered as text on both sides)
        const bb = (s: string) => s.replace(/\[(\/?[a-z]+|a@[^\]]*|doc@[^\]]*)\]/g, '')
        expect(home.warnings.map((w) => bb(w.message))).toEqual(
          homeWarnings(html).map((w) => w.replace(/ \.$/, '.')),
        )
        // configuration storage complete → no notice on either side
        expect(home.configStorageMessage).toBeNull()
        expect(html).not.toContain('configuration storage is not completely configured')
      } finally {
        await bma.close()
      }
    })

    it('connection collation: same SET collation_connection, list still shows getDefaultCollation()', async () => {
      const pma = new PmaClient(PMA_URL)
      const bma = testApp(bmaConfig())
      try {
        const since = await log.marker()
        await pma.login(user('pa', 'su'), user('pa', 'su'))
        await pma.postPage('/index.php?route=/collation-connection', { collation_connection: 'utf8mb4_bin' })
        const html = await pma.getPage('/index.php?route=/')
        await bma.login(user('pb', 'su'), user('pb', 'su'))
        await bma.req('POST', '/api/servers/1/session/collation', { collation_connection: 'utf8mb4_bin' })
        const home = (await bma.req('GET', '/api/servers/1/home')).json as unknown as HomeResponse
        const set = (u: string) =>
          log
            .since(u, since)
            .then((l) => l.map((e) => e.sql).filter((s) => s.startsWith('SET collation_connection')))
        // (the general log shows statements without the trailing delimiter)
        expect(await set(user('pb', 'su'))).toContain("SET collation_connection = 'utf8mb4_bin'")
        expect(await set(user('pa', 'su'))).toContain("SET collation_connection = 'utf8mb4_bin'")
        expect(html).toMatch(/<option value="utf8mb4_general_ci" title="[^"]*" selected>/)
        expect(home.collation.selected).toBe('utf8mb4_general_ci')
        // restore the reference user's preference (stored in phpMyAdmin's pmadb userconfig)
        await pma.postPage('/index.php?route=/collation-connection', {
          collation_connection: 'utf8mb4_unicode_ci',
        })
      } finally {
        await bma.close()
      }
    })

    const changeBoth = async (role: Role, pw: string) => {
      const pma = new PmaClient(PMA_URL)
      const bma = testApp(bmaConfig())
      try {
        const since = await log.marker()
        await pma.login(user('pa', role), user('pa', role))
        const pmaJson = await pma.postJson('/user-password', {
          nopass: '0',
          pma_pw: pw,
          pma_pw2: pw,
          authentication_plugin: 'mysql_native_password',
          change_pw: '1',
        })
        await bma.login(user('pb', role), user('pb', role))
        const ours = await bma.req('POST', '/api/servers/1/account/password', {
          nopass: false,
          pma_pw: pw,
          pma_pw2: pw,
          authentication_plugin: 'mysql_native_password',
        })
        const writes = async (u: string) =>
          (await log.since(u, since))
            .map((e) => normalise(e.sql, dbMap))
            .filter((s) => classify(s) === 'write' && !/^SET /.test(s))
        return {
          pmaJson,
          ours,
          pmaWrites: await writes(user('pa', role)),
          bmaWrites: await writes(user('pb', role)),
        }
      } finally {
        await bma.close()
      }
    }

    it('change password (form defaults, user without mysql.user access): same ALTER USER and FLUSH PRIVILEGES', async () => {
      const r = await changeBoth('pw', 'm1shell-new-Pw1')
      expect(r.pmaJson.success).toBe(true)
      expect(visibleText(r.pmaJson.message ?? '')).toContain('The profile has been updated.')
      if (TARGET === 'mariadb') {
        // MariaDB: SET PASSWORD = PASSWORD(…) for one's own account (Privileges::getChangePasswordSql)
        const sql = String((r.ours.json as { sql?: string }).sql ?? '')
        expect(sql).toMatch(/^SET password = PASSWORD\('\*\*\*'\)$/i)
        expect(visibleText(r.pmaJson.message ?? '')).toContain(sql)
        expect(r.bmaWrites).toEqual(r.pmaWrites)
        return
      }
      expect(visibleText(r.pmaJson.message ?? '')).toContain(
        "ALTER USER 'm1shell_pa_pw'@'%' IDENTIFIED BY '***'",
      )
      expect(r.ours.json).toMatchObject({
        message: 'The profile has been updated.',
        sql: "ALTER USER 'm1shell_pb_pw'@'%' IDENTIFIED BY '***'",
      })
      expect(r.bmaWrites).toEqual(r.pmaWrites)
      // MySQL's general log masks the password
      expect(r.bmaWrites).toEqual(["ALTER USER 'user_pw'@'%' IDENTIFIED BY <secret>", 'FLUSH PRIVILEGES'])
    })

    it('change password as a user who can read mysql.user: WITH mysql_native_password, refused by MySQL 8.4 (quirk Q43)', async () => {
      const r = await changeBoth('su', 'm1shell-new-Pw2')
      expect(r.bmaWrites).toEqual(r.pmaWrites)
      if (TARGET === 'mariadb') {
        // MariaDB still has mysql_native_password: both succeed with the same statements
        expect(r.pmaJson.success).toBe(true)
        expect(r.ours.status).toBe(200)
        return
      }
      expect(r.pmaWrites).toEqual([
        "ALTER USER 'user_su'@'%' IDENTIFIED WITH 'mysql_native_password' BY <secret>",
      ])
      expect(r.pmaJson.success).toBe(false)
      expect(r.ours.status).toBe(400)
      expect(visibleText(r.pmaJson.message ?? r.pmaJson.error ?? '')).toContain(
        (r.ours.json.error as { message: string }).message,
      )
    })
  },
)

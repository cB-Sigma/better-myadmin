import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { oathTotp } from '../../apps/server/src/preferences/totp.ts'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { getCreateTableSqlQueries } from '../../packages/metadata/src/resources.ts'
import { type PmaInstance, phpAvailable, startPmaInstance } from './lib/pma-instance.ts'
import { PmaClient } from './lib/pma.ts'

/**
 * The low findings of docs/reference/security-review.md, checked against a running phpMyAdmin
 * (a private instance of the reference checkout with its own pmadb) and then against ours:
 * another user's private bookmark (L2), attempts at the second factor (L1) and passwords in the
 * Debug SQL output (L4). Only m1seclow_* databases and users are touched.
 */
const ROOT = {
  host: process.env.BMA_TEST_HOST ?? '127.0.0.1',
  port: Number(process.env.BMA_TEST_PORT ?? 3306),
  user: 'root',
  password: process.env.BMA_TEST_PASSWORD ?? 'root',
}
const PMADB = 'm1seclow_pmadb'
const CTL = 'm1seclow_ctl'
const A = 'm1seclow_a'
const B = 'm1seclow_b'
const DB = 'm1seclow_db'
const SECRET = 'JBSWY3DPEHPK3PXP'
const NEW_PW = 'Very_Secret_42'

const available = phpAvailable()
let root: mysql.Connection
let inst: PmaInstance

function pmaConfig(): string {
  return `$cfg['blowfish_secret'] = 'm1seclow-parity-secret-0123456789abc';
$i = 1;
$cfg['Servers'][$i]['host'] = ${JSON.stringify(ROOT.host)};
$cfg['Servers'][$i]['port'] = ${JSON.stringify(String(ROOT.port))};
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['controluser'] = '${CTL}';
$cfg['Servers'][$i]['controlpass'] = '${CTL}';
$cfg['Servers'][$i]['pmadb'] = '${PMADB}';
$cfg['DBG']['sql'] = true;
$cfg['DBG']['simple2fa'] = true;`
}

const bmaApp = () =>
  testApp(
    testConfig({ DataDir: '', DBG: { sql: true } }, { controluser: CTL, controlpass: CTL, pmadb: PMADB }),
  )

describe.skipIf(!available)('security lows against phpMyAdmin', () => {
  let bookmarkId = 0

  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    await root.query(`DROP DATABASE IF EXISTS ${PMADB}; CREATE DATABASE ${PMADB} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
      DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; CREATE TABLE ${DB}.t (id INT PRIMARY KEY);`)
    await root.query(`USE ${PMADB}`)
    for (const sql of Object.values(getCreateTableSqlQueries({}))) await root.query(sql)
    for (const u of [A, B, CTL]) {
      await root.query(`DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'`)
    }
    await root.query(`GRANT ALL ON \`${DB}\`.* TO '${A}'@'%'; GRANT ALL ON \`${DB}\`.* TO '${B}'@'%';
      GRANT CREATE USER ON *.* TO '${A}'@'%';
      GRANT SELECT, INSERT, UPDATE, DELETE ON \`${PMADB}\`.* TO '${CTL}'@'%';
      GRANT SELECT ON mysql.* TO '${CTL}'@'%';`)
    // B's private bookmark (user = B, not shared)
    const [r] = (await root.query(
      `INSERT INTO ${PMADB}.pma__bookmark (dbase, user, label, query) VALUES ('${DB}', '${B}', 'b private', 'SELECT 4242 AS b_private_bookmark')`,
    )) as unknown as [{ insertId: number }]
    bookmarkId = r.insertId
    inst = await startPmaInstance(pmaConfig())
  })

  afterAll(async () => {
    await inst?.stop()
    await root?.query(`DROP DATABASE IF EXISTS ${PMADB}; DROP DATABASE IF EXISTS ${DB};`)
    for (const u of [A, B, CTL, 'm1seclow_new']) await root?.query(`DROP USER IF EXISTS '${u}'@'%'`)
    await root?.end()
  })

  describe('L2 another user’s private bookmark', () => {
    it('phpMyAdmin: show is refused, run with action_bookmark_all runs it', async () => {
      const pma = new PmaClient(inst.url)
      await pma.login(A, A)
      const show = await pma.postJson('/import', {
        db: DB,
        id_bookmark: String(bookmarkId),
        action_bookmark: '1',
        action_bookmark_all: '1',
        sql_query: '',
      })
      expect(JSON.stringify(show)).not.toContain('b_private_bookmark')
      const run = await pma.postJson('/import', {
        db: DB,
        id_bookmark: String(bookmarkId),
        action_bookmark: '0',
        action_bookmark_all: '1',
        sql_query: '',
      })
      expect(JSON.stringify(run)).toContain('b_private_bookmark')
    })

    it('ours: the same (show refused, run with allUsers)', async () => {
      const bma = bmaApp()
      try {
        await bma.login(A, A)
        const show = await bma.req('GET', `/api/servers/1/bookmarks/${bookmarkId}`)
        expect(JSON.stringify(show.json)).not.toContain('b_private_bookmark')
        const run = await bma.req('POST', `/api/servers/1/bookmarks/${bookmarkId}/run`, {
          db: DB,
          allUsers: true,
        })
        expect(JSON.stringify(run.json)).toContain('b_private_bookmark')
      } finally {
        await bma.close()
      }
    })
  })

  describe('L1 attempts at the second factor', () => {
    beforeAll(async () => {
      const config = JSON.stringify({ '2fa': { backend: 'application', settings: { secret: SECRET } } })
      await root.query(`DELETE FROM ${PMADB}.pma__userconfig WHERE username = ?`, [B])
      await root.query(
        `INSERT INTO ${PMADB}.pma__userconfig (username, timevalue, config_data) VALUES (?, NOW(), ?)`,
        [B, config],
      )
    })
    const code = () => oathTotp(SECRET, Math.floor(Date.now() / 30000))

    it('phpMyAdmin: twenty failed confirmations, then a good one still logs in (no attempt limit)', async () => {
      // the reference has no google2fa: the debug "simple" backend (a confirmation box) shows the
      // same AuthenticationPlugin::checkTwoFactor flow, which counts nothing
      await root.query(`UPDATE ${PMADB}.pma__userconfig SET config_data = ? WHERE username = ?`, [
        JSON.stringify({ '2fa': { backend: 'simple', settings: {} } }),
        B,
      ])
      const pma = new PmaClient(inst.url)
      await pma.login(B, B)
      for (let i = 0; i < 20; i++) {
        const page = await pma.postPage('/', [['2fa_code', '000000']])
        expect(page).toContain('2fa_confirm')
      }
      const ok = await pma.postPage('/', [['2fa_confirm', '1']])
      expect(ok).not.toContain('2fa_confirm')
      await root.query(`UPDATE ${PMADB}.pma__userconfig SET config_data = ? WHERE username = ?`, [
        JSON.stringify({ '2fa': { backend: 'application', settings: { secret: SECRET } } }),
        B,
      ])
    })

    it('ours: the same', async () => {
      const bma = bmaApp()
      try {
        expect((await bma.login(B, B)).json).toMatchObject({ twoFactorRequired: true })
        for (let i = 0; i < 20; i++) {
          const r = await bma.req('POST', '/api/auth/two-factor', { fields: { '2fa_code': '000000' } })
          expect(r.json).toMatchObject({ ok: false })
        }
        const ok = await bma.req('POST', '/api/auth/two-factor', { fields: { '2fa_code': code() } })
        expect(ok.json).toMatchObject({ ok: true })
      } finally {
        await bma.close()
      }
    })
  })

  describe('L4 passwords in Debug SQL', () => {
    const addUser = [
      ['pred_username', 'userdefined'],
      ['username', 'm1seclow_new'],
      ['pred_hostname', 'any'],
      ['hostname', '%'],
      ['pred_password', 'userdefined'],
      ['pma_pw', NEW_PW],
      ['pma_pw2', NEW_PW],
      ['authentication_plugin', 'caching_sha2_password'],
      ['ssl_type', 'NONE'],
      ['adduser_submit', '1'],
    ] as Array<[string, string]>

    it('phpMyAdmin: the debug output of Add user holds the password', async () => {
      await root.query("DROP USER IF EXISTS 'm1seclow_new'@'%'")
      const pma = new PmaClient(inst.url)
      await pma.login(ROOT.user, ROOT.password)
      const r = await pma.postJson('/server/privileges', addUser)
      expect(JSON.stringify(r.debug ?? '')).toContain(NEW_PW)
    })

    it('ours: the SQL log masks it (stricter than phpMyAdmin), as do the statements shown', async () => {
      await root.query("DROP USER IF EXISTS 'm1seclow_new'@'%'")
      const bma = testApp(
        testConfig(
          { DataDir: '', DBG: { sql: true, sqllog: true } },
          { controluser: CTL, controlpass: CTL, pmadb: PMADB },
        ),
      )
      const lines: string[] = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
        lines.push(a.map(String).join(' '))
      })
      try {
        await bma.login(ROOT.user, ROOT.password)
        const r = await bma.req('POST', '/api/servers/1/privileges', Object.fromEntries(addUser))
        expect(r.status, JSON.stringify(r.json)).toBe(200)
        // stricter than phpMyAdmin: the logged CREATE USER is masked
        const create = lines.filter((l) => l.includes('> CREATE USER'))
        expect(create).toHaveLength(1)
        expect(create[0]).toContain("BY '***'")
        expect(lines.some((l) => l.includes(NEW_PW))).toBe(false)
        expect(JSON.stringify((r.json as { sql?: string }).sql ?? '')).not.toContain(NEW_PW)
      } finally {
        spy.mockRestore()
        await bma.close()
      }
    })
  })
})

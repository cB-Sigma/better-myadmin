import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp, testConfig } from '../../apps/server/test/support/app.ts'
import { normalise } from './lib/compare.ts'
import { GeneralLog, type LogEntry } from './lib/general-log.ts'
import { type PmaShadow, canStartShadow, startPmaShadow } from './lib/pma-shadow.ts'
import { PmaClient, sqlBoxForm } from './lib/pma.ts'
import { ROOT, pmaReachable } from './lib/server-setup.ts'

/**
 * Golden parity of Tracker::handleQuery (docs/features/04-table-level.md#tracking): statements run
 * from the SQL box of a database whose table has an active tracking version are appended to that
 * version's schema_sql / data_sql (only the statements of its tracking set), RENAME TABLE moves the
 * version, `tracking_version_auto_create` starts version 1 of a created table / view and of the
 * database on CREATE DATABASE, a deactivated version logs nothing. Both tools run against a
 * phpMyAdmin shadow and a BetterMyAdmin app with the same control user and the same `Servers`
 * settings; every control-link statement naming this suite's databases is compared in order (the
 * request's isAnyTrackingInProgress / getVersion / isTracked reads included), then the
 * pma__tracking rows. Dates are masked.
 */
const PORT = 18952
const PMA_USER = 'f04trl_pma'
const BMA_USER = 'f04trl_bma'
const P = 'f04trl_p'
const B = 'f04trl_b'
const dbMap: Record<string, string> = {
  [PMA_USER]: 'USER',
  [BMA_USER]: 'USER',
  [`${P}_new`]: 'NEWDB',
  [`${B}_new`]: 'NEWDB',
  [P]: 'DB',
  [B]: 'DB',
}
const SERVER = { tracking_version_auto_create: true }
const DATE = /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g
const mask = (s: string) => s.replace(DATE, 'DATE')
const available = pmaReachable && canStartShadow()

let shadow: PmaShadow
let log: GeneralLog
let pma: PmaClient
let bma: ReturnType<typeof testApp>
let root: mysql.Connection

const SEED = `
  CREATE TABLE t (id INT NOT NULL, code VARCHAR(10) NOT NULL DEFAULT 'x', PRIMARY KEY (id)) ENGINE=InnoDB;
  INSERT INTO t VALUES (1, 'a'), (2, 'b');
  CREATE TABLE other (id INT);
`

async function seed(set: string, active: number) {
  for (const db of [P, B]) {
    await root.query(
      `DROP DATABASE IF EXISTS \`${db}\`; DROP DATABASE IF EXISTS \`${db}_new\`; CREATE DATABASE \`${db}\`; USE \`${db}\`; ${SEED}`,
    )
    await root.query('DELETE FROM phpmyadmin.pma__tracking WHERE db_name IN (?, ?)', [db, `${db}_new`])
    await root.query(
      'INSERT INTO phpmyadmin.pma__tracking (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking, tracking_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        db,
        't',
        '1',
        '2024-01-01 10:00:00',
        '2024-01-01 10:00:00',
        '',
        '# log 2024-01-01 10:00:00 x\nCREATE TABLE t;\n',
        '\n',
        set,
        active,
      ],
    )
  }
  await root.query('USE mysql')
}

// the tracker's statements (the pages' own storage reads, which phpMyAdmin repeats per request, aside)
const ours = (e: LogEntry) => e.sql.includes('f04trl_') && e.sql.includes('pma__tracking')
const control = (l: LogEntry[]) => l.filter(ours).map((e) => mask(normalise(e.sql, dbMap)))

async function rows(db: string): Promise<string> {
  const [r] = await root.query(
    'SELECT db_name, table_name, version, schema_snapshot, schema_sql, data_sql, tracking, tracking_active FROM phpmyadmin.pma__tracking WHERE db_name IN (?, ?) ORDER BY db_name, table_name, version',
    [db, `${db}_new`],
  )
  return mask(normalise(JSON.stringify(r), dbMap))
}

async function run(
  sql: string,
  set = 'UPDATE,INSERT,DELETE,ALTER TABLE,RENAME TABLE,CREATE TABLE,CREATE VIEW,CREATE DATABASE',
  active = 1,
) {
  await seed(set, active)
  const m1 = await log.marker()
  const p = await pma.postJson('/import', sqlBoxForm(sql.replaceAll('%DB%', P), P, ''))
  expect(p.success, JSON.stringify(p)).toBe(true)
  const pmaCtl = control(await log.since('pma', m1))
  const m2 = await log.marker()
  const b = await bma.req('POST', '/api/servers/1/query', {
    sql: sql.replaceAll('%DB%', B),
    db: B,
    fromQueryBox: true,
  })
  expect(b.status, JSON.stringify(b.json)).toBe(200)
  const bmaCtl = control(await log.since('pma', m2))
  expect(bmaCtl).toEqual(pmaCtl)
  expect(await rows(B)).toBe(await rows(P))
  return pmaCtl
}

describe.skipIf(!available)('parity: Tracker::handleQuery (statements logged into tracking versions)', () => {
  beforeAll(async () => {
    root = await mysql.createConnection({ ...ROOT, multipleStatements: true })
    for (const u of [PMA_USER, BMA_USER]) {
      await root.query(
        `DROP USER IF EXISTS '${u}'@'%'; CREATE USER '${u}'@'%' IDENTIFIED BY '${u}'; GRANT ALL ON \`f04trl\\_%\`.* TO '${u}'@'%'`,
      )
    }
    shadow = await startPmaShadow(PORT, { server: SERVER })
    log = await GeneralLog.open(ROOT)
    pma = new PmaClient(shadow.url)
    await pma.login(PMA_USER, PMA_USER)
    bma = testApp(
      testConfig({}, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin', ...SERVER }),
    )
    await bma.login(BMA_USER, BMA_USER)
  })
  afterAll(async () => {
    for (const db of [P, B]) {
      await root?.query(`DROP DATABASE IF EXISTS \`${db}\`; DROP DATABASE IF EXISTS \`${db}_new\``)
      await root?.query('DELETE FROM phpmyadmin.pma__tracking WHERE db_name IN (?, ?)', [db, `${db}_new`])
    }
    await root?.query(`DROP USER IF EXISTS '${PMA_USER}'@'%'; DROP USER IF EXISTS '${BMA_USER}'@'%'`)
    await root?.end()
    await log?.close()
    await bma?.close()
    await shadow?.stop()
  })

  it('[p04-cc268e] INSERT / UPDATE / DELETE are appended to data_sql, `db`. prefixes cut', async () => {
    const ctl = await run(
      "INSERT INTO t VALUES (3, 'c'); UPDATE `%DB%`.`t` SET code = 'z' WHERE id = 1; DELETE FROM t WHERE id = 2",
    )
    expect(
      ctl.some((s) => s.startsWith('/*NOTRACK*/ UPDATE `phpmyadmin`.`pma__tracking` SET `data_sql`')),
    ).toBe(true)
  })

  it('ALTER TABLE goes to schema_sql; a statement outside the tracking set is not logged', async () => {
    await run('ALTER TABLE t ADD COLUMN n INT; TRUNCATE other; TRUNCATE t')
  })

  it('RENAME TABLE moves the version to the new name', async () => {
    await run('RENAME TABLE t TO t2')
  })

  it('CREATE INDEX / DROP INDEX / DROP TABLE are DDL of the table', async () => {
    await run(
      'CREATE INDEX ix ON t (code); DROP INDEX ix ON t; DROP TABLE t',
      'CREATE INDEX,DROP INDEX,DROP TABLE',
    )
  })

  it('a deactivated version logs nothing (only the in-progress probe)', async () => {
    await run("INSERT INTO t VALUES (9, 'q')", 'INSERT', 0)
  })

  it('[p04-cc268e] tracking_version_auto_create: CREATE TABLE and CREATE VIEW start version 1', async () => {
    await run('CREATE TABLE fresh (a INT PRIMARY KEY); CREATE VIEW vw AS SELECT id FROM t')
  })

  it('tracking_version_auto_create: CREATE DATABASE starts a database version (tracking_add_drop_database)', async () => {
    await run('CREATE DATABASE %DB%_new')
  })
})

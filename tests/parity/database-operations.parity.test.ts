import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareWrites, normalise } from './lib/compare.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of Database → Operations (docs/features/05-database-level.md): copy (routines,
 * view stand-ins, tables with triggers, views, constraints, events), rename with privilege
 * adjustment, collation changes. phpMyAdmin is driven with the POSTs of its operations forms.
 */
const users = { pma: 'f05_op_pma', bma: 'f05_op_bma' }
const P = 'f05_opp'
const B = 'f05_opb'
const esc = (s: string) => s.replaceAll('_', '\\\\_')
const dbMap: Record<string, string> = {
  // the mysql.* privilege rows are matched with `_` escaped (quoted: `\\_`)
  [esc(`${P}_r`)]: 'NEWDB',
  [esc(`${B}_r`)]: 'NEWDB',
  [esc(P)]: 'DB',
  [esc(B)]: 'DB',
  [`${P}_c`]: 'NEWDB',
  [`${B}_c`]: 'NEWDB',
  [`${P}_r`]: 'NEWDB',
  [`${B}_r`]: 'NEWDB',
  [P]: 'DB',
  [B]: 'DB',
  [users.pma]: 'USER',
  [users.bma]: 'USER',
}
let h: Harness

const seed = (db: string, user: string) => `
DROP DATABASE IF EXISTS ${db}; DROP DATABASE IF EXISTS ${db}_c; DROP DATABASE IF EXISTS ${db}_r;
CREATE DATABASE ${db} DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE TABLE ${db}.parent (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20)) ENGINE=InnoDB;
INSERT INTO ${db}.parent (name) VALUES ('a'), ('b');
CREATE TABLE ${db}.child (id INT PRIMARY KEY, parent_id INT, CONSTRAINT fk_c FOREIGN KEY (parent_id) REFERENCES ${db}.parent (id)) ENGINE=InnoDB;
CREATE TABLE ${db}.log (msg VARCHAR(50)) ENGINE=MyISAM;
CREATE DEFINER='${user}'@'%' TRIGGER ${db}.t_ins AFTER INSERT ON ${db}.parent FOR EACH ROW INSERT INTO ${db}.log VALUES (NEW.name);
CREATE DEFINER='${user}'@'%' VIEW ${db}.v AS SELECT id, name FROM ${db}.parent;
CREATE DEFINER='${user}'@'%' PROCEDURE ${db}.p1(IN x INT) SELECT x;
CREATE DEFINER='${user}'@'%' FUNCTION ${db}.f1(x INT) RETURNS INT DETERMINISTIC RETURN x + 1;
CREATE DEFINER='${user}'@'%' EVENT ${db}.e1 ON SCHEDULE EVERY 1 DAY DISABLE DO DELETE FROM ${db}.log;
`
const cleanup = `DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${P}_c; DROP DATABASE IF EXISTS ${P}_r; DROP DATABASE IF EXISTS ${B}; DROP DATABASE IF EXISTS ${B}_c; DROP DATABASE IF EXISTS ${B}_r`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' })
})
afterAll(async () => {
  await h?.root.query(cleanup)
  await h?.close()
})

const reseed = () => h.root.query(seed(P, users.pma) + seed(B, users.bma))
const bma = (db: string, path: string) => `/api/servers/1/databases/${db}${path}`

describe.skipIf(!pmaReachable)('parity: database operations', () => {
  it('copy structure and data with every option', async () => {
    await reseed()
    const r = await both(
      h,
      () =>
        h.pma.postJson('/database/operations', [
          ['db', P],
          ['db_copy', 'true'],
          ['db_collation', 'utf8mb4_general_ci'],
          ['newname', `${P}_c`],
          ['what', 'data'],
          ['create_database_before_copying', '1'],
          ['drop_if_exists', 'true'],
          ['sql_auto_increment', '1'],
          ['add_constraints', '1'],
          ['submit_copy', 'Go'],
        ]),
      () =>
        h.bma.req('POST', bma(B, '/operations/copy'), {
          newName: `${B}_c`,
          collation: 'utf8mb4_general_ci',
          what: 'data',
          createDatabase: true,
          dropIfExists: true,
          autoIncrement: true,
          addConstraints: true,
        }),
    )
    expect(r.b.status, JSON.stringify(r.b.json)).toBe(200)
    const cmp = compareWrites(r.pmaLog, r.bmaLog, dbMap)
    expect(cmp.bma, `pma: ${JSON.stringify(cmp.pma, null, 1)}`).toEqual(cmp.pma)
    expect(cmp.bma.some((s) => s.startsWith('CREATE DATABASE IF NOT EXISTS `NEWDB`'))).toBe(true)
    expect(cmp.bma.some((s) => /ADD CONSTRAINT/.test(s))).toBe(true)
    expect(String(r.p.message)).toContain('has been copied to')
  })

  it('copy structure only without CREATE DATABASE into an existing database', async () => {
    await reseed()
    await h.root.query(`CREATE DATABASE ${P}_c; CREATE DATABASE ${B}_c`)
    const r = await both(
      h,
      () =>
        h.pma.postJson('/database/operations', [
          ['db', P],
          ['db_copy', 'true'],
          ['newname', `${P}_c`],
          ['what', 'structure'],
          ['submit_copy', 'Go'],
        ]),
      () =>
        h.bma.req('POST', bma(B, '/operations/copy'), {
          newName: `${B}_c`,
          what: 'structure',
          createDatabase: false,
          autoIncrement: false,
          addConstraints: false,
        }),
    )
    const cmp = compareWrites(r.pmaLog, r.bmaLog, dbMap)
    expect(cmp.bma, `pma: ${JSON.stringify(cmp.pma, null, 1)}`).toEqual(cmp.pma)
  })

  it('rename with privilege adjustment', async () => {
    await reseed()
    const r = await both(
      h,
      () =>
        h.pma.postJson('/database/operations', [
          ['db', P],
          ['what', 'data'],
          ['db_rename', 'true'],
          ['db_collation', 'utf8mb4_general_ci'],
          ['newname', `${P}_r`],
          ['adjust_privileges', '1'],
        ]),
      () =>
        h.bma.req('POST', bma(B, '/operations/rename'), {
          newName: `${B}_r`,
          collation: 'utf8mb4_general_ci',
          adjustPrivileges: true,
        }),
    )
    const cmp = compareWrites(r.pmaLog, r.bmaLog, dbMap)
    expect(cmp.bma, `pma: ${JSON.stringify(cmp.pma, null, 1)}`).toEqual(cmp.pma)
    expect(cmp.bma.some((s) => s.startsWith('RENAME TABLE `DB`.`parent` TO `NEWDB`.`parent`'))).toBe(true)
    expect(cmp.bma.at(-1) === 'FLUSH PRIVILEGES' || cmp.bma.includes('DROP DATABASE `DB`')).toBe(true)
  })

  it('same name and invalid names are refused', async () => {
    await reseed()
    const r = await both(
      h,
      () =>
        h.pma.postJson('/database/operations', [
          ['db', P],
          ['db_copy', 'true'],
          ['newname', P],
        ]),
      () => h.bma.req('POST', bma(B, '/operations/copy'), { newName: B }),
    )
    expect(String(r.p.message ?? r.p.error)).toContain(
      'Cannot copy database to the same name. Change the name and try again.',
    )
    expect(JSON.stringify(r.b.json)).toContain('Cannot copy database to the same name.')
    expect(compareWrites(r.pmaLog, r.bmaLog, dbMap).bma).toEqual([])
  })

  it('collation with all tables and columns', async () => {
    await reseed()
    const r = await both(
      h,
      () =>
        h.pma.postJson('/database/operations/collation', [
          ['db', P],
          ['db_collation', 'latin1_swedish_ci'],
          ['change_all_tables_collations', 'on'],
          ['change_all_tables_columns_collations', 'on'],
        ]),
      () =>
        h.bma.req('POST', bma(B, '/operations/collation'), {
          collation: 'latin1_swedish_ci',
          changeAllTables: true,
          changeAllColumns: true,
        }),
    )
    const cmp = compareWrites(r.pmaLog, r.bmaLog, dbMap)
    expect(cmp.bma, `pma: ${JSON.stringify(cmp.pma, null, 1)}`).toEqual(cmp.pma)
    expect(cmp.bma).toContain('ALTER DATABASE `DB` DEFAULT CHARSET=latin1 COLLATE latin1_swedish_ci')
    expect(r.p.success).toBe(true)
  })

  it('the page answers what phpMyAdmin renders', async () => {
    await reseed()
    const r = await both(
      h,
      () => h.pma.getJson('/database/operations', { db: P }),
      () => h.bma.req('GET', bma(B, '/operations')),
    )
    const html = String(r.p.message ?? '')
    const b = r.b.json as { hasComment: boolean; dbCollation: string; isDropDatabaseAllowed: boolean }
    expect(b.hasComment).toBe(html.includes('id="formDatabaseComment"'))
    expect(b.isDropDatabaseAllowed).toBe(html.includes('id="drop_db_anchor"'))
    expect(html).toContain(`name="db_collation" value="${b.dbCollation}"`)
    const reads = (log: typeof r.pmaLog) =>
      log.map((e) => normalise(e.sql, dbMap)).filter((s) => /^SELECT DEFAULT_COLLATION_NAME/.test(s))
    expect(reads(r.bmaLog)).toEqual(reads(r.pmaLog))
  })
})

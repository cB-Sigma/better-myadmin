import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compareWrites, normalise } from './lib/compare.ts'
import { findForm, serializeForm } from './lib/form.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of the view form (docs/features/04-table-level.md#views): CREATE / ALTER VIEW from
 * the form, the Edit view prefill, the errors, and the browser transformations phpMyAdmin copies
 * to the view (on the user's link). Both tools use the `phpmyadmin` configuration storage.
 */
const users = { pma: 'f04_vw_pma', bma: 'f04_vw_bma' }
const P = 'f04_vwp'
const B = 'f04_vwb'
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB', [users.pma]: 'USER', [users.bma]: 'USER' }
let h: Harness
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const seed = (db: string) => `
DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db};
CREATE TABLE ${db}.t (id INT PRIMARY KEY, name VARCHAR(10), note TEXT);
INSERT INTO ${db}.t VALUES (1, 'a', 'x'), (2, 'b', 'y');
DELETE FROM phpmyadmin.pma__column_info WHERE db_name = '${db}';
INSERT INTO phpmyadmin.pma__column_info (db_name, table_name, column_name, comment, mimetype, transformation, transformation_options, input_transformation, input_transformation_options)
  VALUES ('${db}', 't', 'name', 'the name', 'text_plain', 'output/text_plain_bool2text.php', '', '', '');
`
const clean = (db: string) => `DELETE FROM phpmyadmin.pma__column_info WHERE db_name = '${db}';`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users, { controluser: 'pma', controlpass: 'pmapass', pmadb: 'phpmyadmin' })
  await h.root.query(seed(P) + seed(B))
})
afterAll(async () => {
  await h?.root.query(`${clean(P)}${clean(B)} DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${B}`)
  await h?.close()
})

const bma = (path: string) => `/api/servers/1/databases/${B}${path}`
const mask = (s: string) => normalise(s, dbMap)

interface View {
  orReplace?: boolean
  algorithm?: string
  definer?: string
  sqlSecurity?: string
  name: string
  columnNames?: string
  as: string
  with?: string
}

/** the dialog's form post (the hidden inputs of view_create.twig plus the fields) */
function pmaForm(op: 'create' | 'alter', v: View): Array<[string, string]> {
  return [
    ['db', P],
    ['table', 't'],
    ['reload', '1'],
    ['ajax_request', '1'],
    [op === 'create' ? 'createview' : 'alterview', '1'],
    ['ajax_dialog', '1'],
    ...(v.orReplace === true ? ([['view[or_replace]', '1']] as Array<[string, string]>) : []),
    ['view[algorithm]', v.algorithm ?? 'UNDEFINED'],
    ['view[definer]', v.definer ?? ''],
    ['view[sql_security]', v.sqlSecurity ?? ''],
    ['view[name]', v.name],
    ['view[column_names]', v.columnNames ?? ''],
    ['view[as]', v.as],
    ['view[with]', v.with ?? ''],
  ]
}

async function step(op: 'create' | 'alter', v: View) {
  const r = await both(
    h,
    () => h.pma.postJson('/view/create', pmaForm(op, v)),
    () =>
      h.bma.req('POST', bma('/views'), {
        operation: op,
        view: { algorithm: 'UNDEFINED', ...v, as: v.as.replaceAll(P, B) },
      }),
  )
  const w = compareWrites(r.pmaLog as never, r.bmaLog as never, dbMap)
  expect(w.bma.map(mask)).toEqual(w.pma.map(mask))
  return {
    p: JSON.stringify(r.p),
    b: r.b.json as { ok: boolean; messages: Array<{ type: string; text: string; sql?: string }> },
    writes: w.pma.map(mask),
  }
}

async function viewRows(db: string, table: string) {
  const [r] = await h.root.query(
    'SELECT column_name, comment, mimetype, transformation FROM phpmyadmin.pma__column_info WHERE db_name = ? AND table_name = ? ORDER BY column_name',
    [db, table],
  )
  return r
}

describe.skipIf(!pmaReachable)('parity: view form', () => {
  it('create a view with every option (OR REPLACE, definer, security, columns, check option)', async () => {
    const r = await step('create', {
      orReplace: true,
      algorithm: 'MERGE',
      definer: `${users.pma}@%`,
      sqlSecurity: 'INVOKER',
      name: 'v1',
      columnNames: 'a,b',
      as: 'SELECT id, name FROM t WHERE id > 0',
      with: 'CASCADED',
    })
    // the logs compare with whitespace normalised; the statement itself keeps "\r\n"
    expect(r.writes).toEqual([
      'CREATE OR REPLACE ALGORITHM = MERGE DEFINER=`USER`@`%` SQL SECURITY INVOKER VIEW `v1` (a,b) AS SELECT id, name FROM t WHERE id > 0 WITH CASCADED CHECK OPTION',
    ])
    expect(r.b.messages[0]?.sql).toBe(
      `CREATE OR REPLACE\r\n ALGORITHM = MERGE\r\nDEFINER=\`${users.pma}\`@\`%\` \r\n SQL SECURITY INVOKER\r\n VIEW \`v1\`\r\n (a,b)\r\n AS SELECT id, name FROM t WHERE id > 0\r\n WITH CASCADED  CHECK OPTION`,
    )
    expect(r.b.ok).toBe(true)
    expect(r.b.messages[0]?.text).toBe('Your SQL query has been executed successfully.')
  })

  it('create a view of a table with a transformation: the copy to the view', async () => {
    const r = await step('create', { name: 'v2', as: 'SELECT * FROM t' })
    expect(r.b.ok).toBe(true)
    // getColumnMapFromSql reads the columns of `SELECT * FROM (…) AS tmp`, whose table is `tmp`:
    // no stored transformation ever matches (parity-exceptions Q60)
    expect(await viewRows(P, 'v2')).toEqual([])
    expect(await viewRows(B, 'v2')).toEqual([])
  })

  it('Edit view: the form is prefilled from INFORMATION_SCHEMA.VIEWS and SHOW CREATE', async () => {
    const r = await both(
      h,
      () => h.pma.getPage('/view/create', { db: P, table: 'v1' }),
      () => h.bma.req('GET', bma('/views/form?table=v1')),
    )
    const pairs = new Map(serializeForm(findForm(String(r.p), { action: '/view/create' })))
    const b = (r.b.json as { operation: string; view: Record<string, unknown> }).view
    expect((r.b.json as { operation: string }).operation).toBe('alter')
    expect(pairs.has('alterview')).toBe(true)
    expect(b.algorithm).toBe(pairs.get('view[algorithm]'))
    expect(mask(String(b.definer))).toBe(mask(pairs.get('view[definer]') ?? ''))
    expect(b.sqlSecurity).toBe(pairs.get('view[sql_security]'))
    expect(b.name).toBe(pairs.get('view[name]'))
    expect(b.with).toBe(pairs.get('view[with]') === '' ? b.with : pairs.get('view[with]'))
    expect(mask(String(b.as))).toBe(mask(pairs.get('view[as]') ?? ''))
  })

  it('alter the view', async () => {
    const r = await step('alter', {
      algorithm: 'TEMPTABLE',
      definer: `${users.pma}@%`,
      sqlSecurity: 'DEFINER',
      name: 'v1',
      as: 'SELECT id, name FROM t',
      with: '',
    })
    expect(r.writes).toEqual([
      'ALTER ALGORITHM = TEMPTABLE DEFINER=`USER`@`%` SQL SECURITY DEFINER VIEW `v1` AS SELECT id, name FROM t',
    ])
  })

  it('errors: an empty name, a failing statement', async () => {
    let r = await step('create', { name: '', as: 'SELECT 1' })
    expect(r.p).toContain('View name can not be empty!')
    expect(r.b.messages[0]).toEqual({ type: 'error', text: 'View name can not be empty!' })
    r = await step('create', { name: 'v3', as: 'SELECT nope FROM t' })
    expect(r.b.ok).toBe(false)
    const m = r.b.messages[0]
    // the server's wording of the clause (MySQL 'field list', MariaDB 'SELECT')
    expect(m?.text).toMatch(/^#1054 - Unknown column 'nope' in '(field list|SELECT)'$/)
    // phpMyAdmin: '<i>' + statement + '</i><br><br>' + error
    expect(r.p).toContain(
      `<i>${(m?.sql ?? '').replaceAll('\r\n', '\\r\\n').replaceAll(B, P)}</i><br><br>#1054 - Unknown column &#039;nope&#039;`,
    )
  })
})

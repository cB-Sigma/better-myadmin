import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareWrites } from './lib/compare.ts'
import type { PmaJson } from './lib/pma.ts'
import { type Harness, both, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of Routines, Events and Triggers (docs/features/05-database-level.md): the
 * statements of create / edit (backup, DROP, CREATE) / execute through the editor POSTs
 * phpMyAdmin's dialogs send, the validation messages, and the export texts.
 */
const users = { pma: 'f05_pr_pma', bma: 'f05_pr_bma' }
const P = 'f05_prp'
const B = 'f05_prb'
const dbMap: Record<string, string> = { [P]: 'DB', [B]: 'DB', [users.pma]: 'USER', [users.bma]: 'USER' }
let h: Harness

const seed = (db: string) => `
DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db};
CREATE TABLE ${db}.t (id INT PRIMARY KEY, v VARCHAR(20));
CREATE TABLE ${db}.log (msg VARCHAR(50));
`

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, users)
  await h.root.query(seed(P) + seed(B))
})
afterAll(async () => {
  await h?.root.query(`DROP DATABASE IF EXISTS ${P}; DROP DATABASE IF EXISTS ${B}`)
  await h?.close()
})

const bma = (path: string) => `/api/servers/1/databases/${B}${path}`

/** The editor form of routines/editor_form.twig as phpMyAdmin's routines.ts posts it. */
function routinePairs(r: {
  mode: 'add' | 'edit'
  name: string
  type: string
  original?: [string, string]
  params: Array<{ dir: string; name: string; type: string; length: string; text?: string; num?: string }>
  returnType?: string
  returnLength?: string
  returnNum?: string
  definition: string
  deterministic?: boolean
  definer?: string
  security?: string
  access?: string
  comment?: string
}): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    ['db', P],
    [r.mode === 'add' ? 'add_item' : 'edit_item', '1'],
    [r.mode === 'add' ? 'editor_process_add' : 'editor_process_edit', 'true'],
  ]
  if (r.original) pairs.push(['item_original_name', r.original[0]], ['item_original_type', r.original[1]])
  pairs.push(['item_name', r.name], ['item_type', r.type])
  r.params.forEach((p, i) => {
    pairs.push(
      [`item_param_dir[${i}]`, p.dir],
      [`item_param_name[${i}]`, p.name],
      [`item_param_type[${i}]`, p.type],
      [`item_param_length[${i}]`, p.length],
      [`item_param_opts_text[${i}]`, p.text ?? ''],
      [`item_param_opts_num[${i}]`, p.num ?? ''],
    )
  })
  pairs.push(
    ['item_returntype', r.returnType ?? 'INT'],
    ['item_returnlength', r.returnLength ?? ''],
    ['item_returnopts_text', ''],
    ['item_returnopts_num', r.returnNum ?? ''],
    ['item_definition', r.definition],
  )
  if (r.deterministic) pairs.push(['item_isdeterministic', 'on'])
  pairs.push(
    ['item_definer', r.definer ?? ''],
    ['item_securitytype', r.security ?? 'DEFINER'],
    ['item_sqldataaccess', r.access ?? ''],
    ['item_comment', r.comment ?? ''],
  )
  return pairs
}

function routineBody(r: Parameters<typeof routinePairs>[0]) {
  return {
    name: r.name,
    type: r.type,
    ...(r.original ? { originalName: r.original[0], originalType: r.original[1] } : {}),
    params: r.params.map((p) => ({
      dir: p.dir,
      name: p.name,
      type: p.type,
      length: p.length,
      optsText: p.text ?? '',
      optsNum: p.num ?? '',
    })),
    returnType: r.returnType ?? 'INT',
    returnLength: r.returnLength ?? '',
    returnOptsNum: r.returnNum ?? '',
    definition: r.definition,
    isDeterministic: r.deterministic === true,
    definer: r.definer ?? '',
    securityType: r.security ?? 'DEFINER',
    sqlDataAccess: r.access ?? '',
    comment: r.comment ?? '',
  }
}

const text = (s: unknown) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

describe.skipIf(!pmaReachable)('parity: routines', () => {
  const CASES: Array<[string, Parameters<typeof routinePairs>[0]]> = [
    [
      'create a procedure with IN/OUT parameters, charset and numeric options',
      {
        mode: 'add',
        name: 'p_add',
        type: 'PROCEDURE',
        params: [
          { dir: 'IN', name: 'a', type: 'INT', length: '', num: 'UNSIGNED' },
          { dir: 'IN', name: 's', type: 'VARCHAR', length: '20', text: 'utf8mb4' },
          { dir: 'OUT', name: 'r', type: 'INT', length: '' },
        ],
        definition: 'BEGIN SET r = a + 1; END',
        access: 'READS SQL DATA',
        comment: "it's mine",
        definer: 'f05_pr_pma@%',
      },
    ],
    [
      'create a deterministic function returning VARCHAR',
      {
        mode: 'add',
        name: 'f_add',
        type: 'FUNCTION',
        params: [{ dir: '', name: 'x', type: 'INT', length: '' }],
        returnType: 'VARCHAR',
        returnLength: '10',
        definition: 'RETURN CONCAT(x, "!")',
        deterministic: true,
        security: 'INVOKER',
      },
    ],
    [
      'validation errors (no name, VARCHAR without length, bad definer)',
      {
        mode: 'add',
        name: '',
        type: 'PROCEDURE',
        params: [{ dir: 'IN', name: 's', type: 'VARCHAR', length: '' }],
        definition: '',
        definer: 'nobody',
      },
    ],
  ]
  for (const [name, r] of CASES) {
    it(name, async () => {
      const definerB = r.definer?.replace(users.pma, users.bma)
      const res = await both(
        h,
        () => h.pma.postJson('/database/routines', routinePairs(r)),
        () =>
          h.bma.req('POST', bma('/routines'), routineBody({ ...r, ...(definerB ? { definer: definerB } : {}) })),
      )
      const cmp = compareWrites(res.pmaLog, res.bmaLog, dbMap)
      expect(cmp.bma, `pma: ${JSON.stringify(cmp.pma, null, 1)}`).toEqual(cmp.pma)
      const msg = (res.b.json as { messages: Array<{ text: string }> }).messages[0]?.text ?? ''
      const pmaMsg = text((res.p as PmaJson).message ?? (res.p as PmaJson).error)
      for (const line of msg.split('\n')) expect(pmaMsg).toContain(line.replace(/^• /, '').replace(B, P))
    })
  }

  it('edit = backup, DROP, CREATE (with privilege adjustment)', async () => {
    const r: Parameters<typeof routinePairs>[0] = {
      mode: 'edit',
      name: 'p_add2',
      type: 'PROCEDURE',
      original: ['p_add', 'PROCEDURE'],
      params: [{ dir: 'INOUT', name: 'a', type: 'INT', length: '' }],
      definition: 'SET a = a * 2',
    }
    const res = await both(
      h,
      () => h.pma.postJson('/database/routines', [...routinePairs(r), ['item_adjust_privileges', '1']]),
      () => h.bma.req('POST', bma('/routines'), { ...routineBody(r), adjustPrivileges: true }),
    )
    const cmp = compareWrites(res.pmaLog, res.bmaLog, dbMap)
    expect(cmp.bma, `pma: ${JSON.stringify(cmp.pma, null, 1)}`).toEqual(cmp.pma)
    expect(cmp.bma[0]).toBe('DROP PROCEDURE `p_add`')
  })

  it('editor data parsed from SHOW CREATE matches the form phpMyAdmin renders', async () => {
    const res = await both(
      h,
      () => h.pma.getJson('/database/routines', { db: P, edit_item: '1', item_name: 'f_add', item_type: 'FUNCTION' }),
      () => h.bma.req('GET', bma('/routines/editor?name=f_add&type=FUNCTION')),
    )
    const html = String(res.p.message)
    const d = (res.b.json as { routine: { params: Array<{ name: string }>; returnLength: string; definition: string } })
      .routine
    expect(html).toContain(`name="item_param_name[0]" type="text" value="${d.params[0]?.name}"`)
    expect(html).toContain(`name="item_returnlength" value="${d.returnLength}"`)
    expect(html).toContain(d.definition.replaceAll('"', '&quot;'))
  })

  it('execute a procedure and a function', async () => {
    const p = await both(
      h,
      () =>
        h.pma.postJson('/database/routines', [
          ['db', P],
          ['execute_routine', '1'],
          ['item_name', 'p_add2'],
          ['item_type', 'PROCEDURE'],
          ['params[a]', '21'],
          ['funcs[a]', ''],
        ]),
      () =>
        h.bma.req('POST', bma('/routines/execute'), {
          name: 'p_add2',
          type: 'PROCEDURE',
          params: { a: '21' },
          funcs: { a: '' },
        }),
    )
    const cmp = compareWrites(p.pmaLog, p.bmaLog, dbMap)
    expect(cmp.bma).toEqual(cmp.pma)
    expect(cmp.bma).toEqual(["SET @p0='21'", 'CALL `p_add2`(@p0)'])
    const f = await both(
      h,
      () =>
        h.pma.postJson('/database/routines', [
          ['db', P],
          ['execute_routine', '1'],
          ['item_name', 'f_add'],
          ['item_type', 'FUNCTION'],
          ['params[x]', '-41'],
          ['funcs[x]', 'ABS'],
        ]),
      () =>
        h.bma.req('POST', bma('/routines/execute'), {
          name: 'f_add',
          type: 'FUNCTION',
          params: { x: '-41' },
          funcs: { x: 'ABS' },
        }),
    )
    const c2 = compareWrites(f.pmaLog, f.bmaLog, dbMap)
    expect(c2.bma).toEqual(c2.pma)
    const rs = (f.b.json as { resultSets: Array<{ rows: string[][] }> }).resultSets
    expect(String(f.p.message)).toContain(`<td>${rs[0]?.rows[0]?.[0]}</td>`)
  })

  it('export wraps SHOW CREATE in DELIMITER', async () => {
    const res = await both(
      h,
      () => h.pma.getJson('/database/routines', { db: P, export_item: '1', item_name: 'f_add', item_type: 'FUNCTION' }),
      () => h.bma.req('GET', bma('/routines/export?name=f_add&type=FUNCTION')),
    )
    const b = res.b.json as { title: string; sql: string }
    expect(b.title).toBe(res.p.title)
    expect(b.sql.replaceAll(users.bma, users.pma)).toBe(res.p.message)
  })
})

describe.skipIf(!pmaReachable)('parity: events', () => {
  const ev = (o: Record<string, string>) => ({
    name: o.item_name ?? '',
    ...(o.item_original_name !== undefined ? { originalName: o.item_original_name } : {}),
    status: o.item_status ?? '',
    type: o.item_type ?? '',
    executeAt: o.item_execute_at ?? '',
    intervalValue: o.item_interval_value ?? '',
    intervalField: o.item_interval_field ?? '',
    starts: o.item_starts ?? '',
    ends: o.item_ends ?? '',
    definition: o.item_definition ?? '',
    preserve: o.item_preserve === 'on',
    definer: o.item_definer ?? '',
    comment: o.item_comment ?? '',
  })
  const CASES: Array<[string, Record<string, string>]> = [
    [
      'recurring with start, preserve, comment, disabled',
      {
        add_item: '1',
        editor_process_add: 'true',
        item_name: 'e1',
        item_status: 'DISABLED',
        item_type: 'RECURRING',
        item_interval_value: '5x',
        item_interval_field: 'HOUR',
        item_starts: '2030-01-01 00:00:00',
        item_definition: 'DELETE FROM log',
        item_preserve: 'on',
        item_comment: 'cleanup',
      },
    ],
    [
      'one time in the future, enabled',
      {
        add_item: '1',
        editor_process_add: 'true',
        item_name: 'e2',
        item_status: 'ENABLED',
        item_type: 'ONE TIME',
        item_execute_at: '2031-01-01 00:00:00',
        item_definition: 'INSERT INTO log VALUES ("x")',
      },
    ],
    [
      'edit: DROP EVENT IF EXISTS then CREATE',
      {
        edit_item: '1',
        editor_process_edit: 'true',
        item_original_name: 'e1',
        item_name: 'e1b',
        item_status: 'SLAVESIDE_DISABLED',
        item_type: 'RECURRING',
        item_interval_value: '1',
        item_interval_field: 'DAY_HOUR',
        item_definition: 'DELETE FROM log',
      },
    ],
    ['validation errors', { add_item: '1', editor_process_add: 'true', item_type: 'RECURRING' }],
  ]
  for (const [name, o] of CASES) {
    it(name, async () => {
      const res = await both(
        h,
        () => h.pma.postJson('/database/events', { db: P, ...o }),
        () => h.bma.req('POST', bma('/events'), ev(o)),
      )
      const cmp = compareWrites(res.pmaLog, res.bmaLog, dbMap)
      expect(cmp.bma, `pma: ${JSON.stringify(cmp.pma, null, 1)}`).toEqual(cmp.pma)
      const msg = (res.b.json as { messages: Array<{ text: string }> }).messages[0]?.text ?? ''
      const pmaMsg = text((res.p as PmaJson).message ?? (res.p as PmaJson).error)
      for (const line of msg.split('\n')) expect(pmaMsg).toContain(line.replace(/^• /, ''))
    })
  }

  it('list and export', async () => {
    const res = await both(
      h,
      () => h.pma.getJson('/database/events', { db: P, export_item: '1', item_name: 'e2' }),
      () => h.bma.req('GET', bma('/events/export?name=e2')),
    )
    const b = res.b.json as { title: string; sql: string }
    expect(b.title).toBe(res.p.title)
    expect(b.sql.replaceAll(users.bma, users.pma)).toBe(res.p.message)
  })
})

describe.skipIf(!pmaReachable)('parity: triggers', () => {
  const tg = (o: Record<string, string>) => ({
    name: o.item_name ?? '',
    ...(o.item_original_name !== undefined ? { originalName: o.item_original_name } : {}),
    table: o.item_table ?? '',
    timing: o.item_timing ?? '',
    event: o.item_event ?? '',
    definition: o.item_definition ?? '',
    definer: o.item_definer ?? '',
  })
  const CASES: Array<[string, Record<string, string>, string]> = [
    [
      'create at database level',
      {
        add_item: '1',
        editor_process_add: 'true',
        item_name: 'tg1',
        item_table: 't',
        item_timing: 'BEFORE',
        item_event: 'INSERT',
        item_definition: 'SET NEW.v = UPPER(NEW.v)',
      },
      '',
    ],
    [
      'edit at table level',
      {
        edit_item: '1',
        editor_process_edit: 'true',
        item_original_name: 'tg1',
        item_name: 'tg2',
        item_table: 't',
        item_timing: 'AFTER',
        item_event: 'UPDATE',
        item_definition: 'INSERT INTO log VALUES (NEW.v)',
      },
      't',
    ],
    ['validation errors', { add_item: '1', editor_process_add: 'true', item_table: 'nope' }, ''],
  ]
  for (const [name, o, table] of CASES) {
    it(name, async () => {
      const res = await both(
        h,
        () => h.pma.postJson('/triggers', { db: P, ...(table !== '' ? { table } : {}), ...o }),
        () => h.bma.req('POST', bma(`/triggers${table !== '' ? `?table=${table}` : ''}`), tg(o)),
      )
      const cmp = compareWrites(res.pmaLog, res.bmaLog, dbMap)
      expect(cmp.bma, `pma: ${JSON.stringify(cmp.pma, null, 1)}`).toEqual(cmp.pma)
      const msg = (res.b.json as { messages: Array<{ text: string }> }).messages[0]?.text ?? ''
      const pmaMsg = text((res.p as PmaJson).message ?? (res.p as PmaJson).error)
      for (const line of msg.split('\n')) expect(pmaMsg).toContain(line.replace(/^• /, ''))
    })
  }

  it('export', async () => {
    const res = await both(
      h,
      () => h.pma.getJson('/triggers', { db: P, export_item: '1', item_name: 'tg2' }),
      () => h.bma.req('GET', bma('/triggers/export?name=tg2')),
    )
    const b = res.b.json as { title: string; sql: string }
    expect(b.title).toBe(res.p.title)
    expect(b.sql).toBe(res.p.message)
  })
})

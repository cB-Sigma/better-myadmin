import type {
  GetVariableResponse,
  ServerVariablesResponse,
  SetVariableResponse,
} from '@bettermyadmin/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { $, $$, type Node, linkTarget, pageHtml, parse, text } from './lib/html.ts'
import { type Harness, both, diff, pmaReachable, startHarness } from './lib/server-setup.ts'

/**
 * Golden parity of Server → Variables: the list (names, formatted global and session values, doc
 * links, editability) and the inline editor (GET the raw value, POST SET GLOBAL with phpMyAdmin's
 * value handling, read back).
 */
let h: Harness
let original = ''

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness()
  const [rows] = await h.root.query('SELECT @@GLOBAL.max_connect_errors AS v')
  original = String((rows as Array<{ v: unknown }>)[0]!.v)
})
afterAll(async () => {
  if (original !== '') await h.root.query(`SET GLOBAL max_connect_errors = ${Number(original)}`)
  await h?.close()
})

function fromHtml(html: Node) {
  return $$(html, 'table#serverVariables tbody tr').map((tr) => {
    const [action, name, value] = $$(tr, 'td')
    const link = $(name!, 'a')
    const abbr = $(value!, 'abbr')
    return {
      editable: $(action!, 'a.editLink') !== undefined,
      session: name!.attrs.class?.includes('font-italic') === true,
      name: text(name!),
      doc: link !== undefined ? linkTarget(link.attrs.href ?? '') : null,
      value: text(value!).replace(/​/g, ''),
      title: abbr?.attrs.title ?? null,
      filterRow: tr.attrs['data-filter-row'],
    }
  })
}

function fromJson(r: ServerVariablesResponse) {
  return r.variables.flatMap((v) => [
    {
      editable: v.isEditable,
      session: false,
      name: v.name.replaceAll('_', ' '),
      doc: v.docUrl,
      value: v.value.text.replace(/\s+/g, ' ').trim(),
      title: v.value.title ?? null,
      filterRow: v.name.toUpperCase(),
    },
    ...(v.sessionValue !== null
      ? [
          {
            editable: false,
            session: true,
            name: `${v.name.replaceAll('_', ' ')} (Session value)`,
            doc: null,
            value: v.sessionValue.text.replace(/\s+/g, ' ').trim(),
            title: v.sessionValue.title ?? null,
            filterRow: v.name.toUpperCase(),
          },
        ]
      : []),
  ])
}

describe.skipIf(!pmaReachable)('parity: server variables', () => {
  it('lists every variable with formatted value, session value and documentation link', async () => {
    const r = await both(
      h,
      () => h.pma.get('/server/variables', {}, true),
      () => h.bma.req('GET', '/api/servers/1/variables'),
    )
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    const html = parse(pageHtml(r.p))
    const json = r.b.json as unknown as ServerVariablesResponse
    expect(linkTarget($(html, 'h2 a')!.attrs.href ?? '')).toBe(json.docUrl)
    const pma = fromHtml(html)
    const ours = fromJson(json)
    // variables whose value changes on its own between the two requests
    const volatile = new Set(['GTID EXECUTED', 'TIMESTAMP', 'GTID PURGED', 'WARNING COUNT'])
    const strip = (xs: typeof pma) => xs.map((x) => (volatile.has(x.name) ? { ...x, value: '' } : x))
    expect(strip(ours)).toEqual(strip(pma))
    expect(pma.some((v) => v.session)).toBe(true)
    expect(json.isSuperUser).toBe(true)
  })

  it('reads a variable for the inline editor', async () => {
    const r = await both(
      h,
      () => h.pma.getJson('/server/variables/get/max_connect_errors'),
      () => h.bma.req('GET', '/api/servers/1/variables/max_connect_errors'),
    )
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect((r.b.json as unknown as GetVariableResponse).message).toBe(r.p.message)
  })

  const SETS: Array<[string, string, string]> = [
    ['integer variable, cast like (int)', 'max_connect_errors', '150abc'],
    ['integer variable, plain', 'max_connect_errors', original === '' ? '100' : original],
    ['string variable, quoted', 'sql_mode', ''],
  ]
  for (const [name, variable, value0] of SETS) {
    it(`SET GLOBAL: ${name}`, async () => {
      let value = value0
      if (variable === 'sql_mode') {
        // set it to its current value: a quoted string, no effect on the server
        const [rows] = await h.root.query('SELECT @@GLOBAL.sql_mode AS v')
        value = String((rows as Array<{ v: unknown }>)[0]!.v)
      }
      if (name.includes('plain')) value = original
      const r = await both(
        h,
        () => h.pma.postJson(`/server/variables/set/${variable}`, { varValue: value }),
        () => h.bma.req('POST', `/api/servers/1/variables/${variable}`, { varValue: value }),
      )
      const cmp = diff(h, r.pmaLog, r.bmaLog)
      expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
      expect(cmp.bma.some((s) => s.startsWith('SET GLOBAL'))).toBe(true)
      const b = r.b.json as unknown as SetVariableResponse
      expect(b.success).toBe(true)
      expect(text(parse(String(r.p.variable)))).toBe(b.variable!.text)
    })
  }

  it('SET GLOBAL of a read-only variable reports the MySQL error', async () => {
    const r = await both(
      h,
      () => h.pma.postJson('/server/variables/set/version', { varValue: 'x' }),
      () => h.bma.req('POST', '/api/servers/1/variables/version', { varValue: 'x' }),
    )
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(r.p.success).toBe(false)
    expect(r.b.status).toBe(400)
    const e = (r.b.json as { error: { errno: number; message: string; sql: string } }).error
    const pmaText = text(parse(String(r.p.error)))
    expect(pmaText).toContain(`#${e.errno} - ${e.message}`)
    expect(pmaText).toContain(e.sql)
  })

  it('a variable name with other characters is refused without a query', async () => {
    const r = await both(
      h,
      () => h.pma.postJson('/server/variables/set/foo-bar', { varValue: 'x' }),
      () => h.bma.req('POST', '/api/servers/1/variables/foo-bar', { varValue: 'x' }),
    )
    const cmp = diff(h, r.pmaLog, r.bmaLog)
    expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
    expect(r.p.success).toBe(false)
    // phpMyAdmin loses the message (quirk Q30): we show "Setting variable failed"
    expect(r.p.error).toBe('')
    expect((r.b.json as unknown as SetVariableResponse).error).toBe('Setting variable failed')
  })
})

import type {
  BinlogResponse,
  CollationsResponse,
  EngineResponse,
  EnginesResponse,
  PluginsResponse,
} from '@bettermyadmin/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { $, $$, type Node, classes, linkTarget, pageHtml, parse, shape, text } from './lib/html.ts'
import { type Harness, both, diff, pmaReachable, startHarness, suiteUsers } from './lib/server-setup.ts'

/**
 * Golden parity of the read-only server pages: Charsets, Engines (+ detail pages, InnoDB Buffer Pool
 * and Status), Plugins, Binary log. Same statements sent to MySQL, same visible values and texts.
 */
let h: Harness

beforeAll(async () => {
  if (!pmaReachable) return
  h = await startHarness({}, suiteUsers('info'))
})
afterAll(async () => h?.close())

async function page<T>(pmaRoute: string, bmaPath: string, params: Record<string, string> = {}, post = false) {
  const r = await both(
    h,
    () => (post ? h.pma.postJson(pmaRoute, params) : h.pma.getJson(pmaRoute, params)),
    () => h.bma.req('GET', `/api/servers/1${bmaPath}`),
  )
  expect(r.b.status, JSON.stringify(r.b.json)).toBe(200)
  const cmp = diff(h, r.pmaLog, r.bmaLog)
  expect(cmp.problems, cmp.problems.join('\n')).toEqual([])
  return { html: parse(pageHtml(r.p)), json: r.b.json as unknown as T }
}

describe.skipIf(!pmaReachable)('parity: charsets, engines, plugins, binary log', () => {
  it('Character sets and collations (/server/collations) [p06-b19775]', async () => {
    const { html, json } = await page<CollationsResponse>('/server/collations', '/collations')
    expect(text($(html, 'h2')!)).toBe('Character sets and collations')
    const cards = $$(html, 'div.card')
    const pma = cards.map((card) => ({
      name: text($(card, 'div.card-header')!.children.filter((c): c is Node => typeof c !== 'string')[0]!),
      description: text(
        $(card, 'div.card-header')!.children.filter((c): c is Node => typeof c !== 'string')[1]!,
      ),
      collations: $$(card, 'li.list-group-item').map((li) => {
        const col = $$(li, 'div.col')[0]!
        const [n, d] = col.children.filter((c): c is Node => typeof c !== 'string')
        return { name: text(n!), description: text(d!), isDefault: $(li, 'span.badge') !== undefined }
      }),
    }))
    expect(json.charsets).toEqual(pma)
    expect(pma.length).toBeGreaterThan(30)
  })

  it('Storage engines (/server/engines) [p06-e1da5c]', async () => {
    const { html, json } = await page<EnginesResponse>('/server/engines', '/engines')
    const rows = $$(html, 'tbody tr').map((tr) => {
      const [a, b] = $$(tr, 'td')
      return {
        engine: text(a!),
        href: $(a!, 'a')!.attrs.href,
        comment: text(b!),
        disabled: classes(tr).includes('disabled'),
        marked: classes(tr).includes('marked'),
      }
    })
    expect(
      json.engines.map((e) => ({
        engine: e.engine,
        href: `index.php?route=/server/engines/${e.engine}`,
        comment: e.comment,
        disabled: e.support === 'NO' || e.support === 'DISABLED',
        marked: e.support === 'DEFAULT',
      })),
    ).toEqual(rows)
  })

  const enginePage = (html: Node) => {
    const h2 = $$(html, 'h2')
    const nav = $$(html, 'p').find((p) => text(p).startsWith('['))
    const varsTable = $(html, 'table')
    return {
      title: h2[1] !== undefined ? text(h2[1]) : null,
      docUrl: h2[1] !== undefined ? linkTarget($(h2[1], 'a')?.attrs.href ?? '') : null,
      comment: $(html, 'em') !== undefined ? text($(html, 'em')!) : null,
      nav: nav !== undefined ? text(nav) : null,
      error: $(html, 'div.alert-danger') !== undefined ? text($(html, 'div.alert-danger')!) : null,
      support: $$(html, 'p')
        .filter(
          (p) => !text(p).startsWith('[') && $(p, 'em') === undefined && $(p, 'div.alert') === undefined,
        )
        .map((p) => text(p)),
      variables:
        varsTable === undefined || $(html, 'caption') !== undefined
          ? []
          : $$(varsTable, 'tr').map((tr) => ({
              desc: $(tr, 'span.hide') !== undefined ? text($(tr, 'span.hide')!) : null,
              title: text($(tr, 'th')!),
              value: text($$(tr, 'td')[1]!),
            })),
    }
  }

  const ours = (e: EngineResponse) => ({
    title: e.isValid ? e.title : null,
    docUrl: e.isValid ? e.docUrl : null,
    comment: e.isValid ? e.comment : null,
    nav:
      e.isValid && e.infoPages.length > 0
        ? `[ ${[{ id: '', label: 'Variables' }, ...e.infoPages].map((p) => p.label).join(' | ')} ]`
        : null,
    error: e.isValid ? null : 'Unknown storage engine.',
    support:
      e.isValid && e.pageContent.kind === 'none'
        ? [
            e.support,
            ...(e.variables.length === 0
              ? ['There is no detailed status information available for this storage engine.']
              : []),
          ]
        : e.pageContent.kind === 'documentation'
          ? [e.pageContent.html.replace(/<[^>]+>/g, '')]
          : [],
    variables:
      e.pageContent.kind === 'none'
        ? e.variables.map((v) => ({ desc: v.desc, title: v.title, value: v.value.replace(/ /g, ' ') }))
        : [],
  })

  for (const engine of [
    'InnoDB',
    'MyISAM',
    'MEMORY',
    'CSV',
    'PERFORMANCE_SCHEMA',
    'MRG_MYISAM',
    'ARCHIVE',
    'BLACKHOLE',
    'FEDERATED',
    'NoSuchEngine',
    'PBMS',
  ]) {
    it(`engine detail page ${engine} [p06-e1da5c]`, async () => {
      const { html, json } = await page<EngineResponse>(`/server/engines/${engine}`, `/engines/${engine}`)
      expect(ours(json)).toEqual(enginePage(html))
    })
  }

  it('InnoDB Buffer Pool page [p06-e1da5c]', async () => {
    const { html, json } = await page<EngineResponse>(
      '/server/engines/InnoDB/Bufferpool',
      '/engines/InnoDB/Bufferpool',
    )
    expect(json.pageContent.kind).toBe('bufferpool')
    const tables = $$(html, 'table')
    const read = (t: Node) => ({
      caption: text($(t, 'caption')!),
      rows: $$(t, 'tbody tr').map((tr) => [text($(tr, 'th')!), text($(tr, 'td')!)]),
      foot: $(t, 'tfoot') !== undefined ? text($(t, 'tfoot')!) : null,
    })
    const [usage, activity] = tables.map(read)
    if (json.pageContent.kind !== 'bufferpool') return
    const b = json.pageContent.bufferPool
    // the counters move between the two requests: compare labels, and values of the idle counters
    expect(usage!.caption).toBe('Buffer pool usage')
    expect(usage!.rows.map((r) => r[0])).toEqual([
      'Free pages',
      'Dirty pages',
      'Pages containing data',
      'Pages to be flushed',
      'Busy pages',
      ...(b.pagesLatched !== null ? ['Latched pages'] : []),
    ])
    expect(usage!.foot).toBe(`Total: ${b.totalPages} / ${b.totalSize}`)
    expect(activity!.caption).toBe('Buffer pool activity')
    expect(activity!.rows.map((r) => r[0])).toEqual([
      'Read requests',
      'Write requests',
      'Read misses',
      'Write waits',
      'Read misses in %',
      'Write waits in %',
    ])
    expect(activity!.rows[3]![1]).toBe(b.waitFree)
    expect(activity!.rows[5]![1]).toBe(b.writeWaitsPct)
  })

  it('InnoDB Status page [p06-e1da5c]', async () => {
    const { html, json } = await page<EngineResponse>(
      '/server/engines/InnoDB/Status',
      '/engines/InnoDB/Status',
    )
    const pre = $(html, 'pre#pre_innodb_status')
    expect(pre).toBeDefined()
    expect(json.pageContent.kind).toBe('status')
    if (json.pageContent.kind !== 'status') return
    // the monitor output changes every second: compare its section headings
    const headings = (s: string) => s.split('\n').filter((l) => /^[A-Z][A-Z /]+$/.test(l.trim()))
    expect(headings(json.pageContent.status)).toEqual(
      headings(text(pre!).length > 0 ? pageHtmlPre(pre!) : ''),
    )
    expect(enginePage(html).nav).toBe('[ Variables | Buffer Pool | InnoDB Status ]')
  })

  it('Plugins (/server/plugins) [p06-e5aa2e]', async () => {
    const { html, json } = await page<PluginsResponse>('/server/plugins', '/plugins')
    const buttons = $$(html, 'div.card-body a.btn').map((a) => [text(a), a.attrs.href])
    expect(json.types.map((t) => [t.type, `#plugins-${t.cleanType}`])).toEqual(buttons)
    const tables = $$(html, 'table').map((t) => ({
      id: t.attrs.id,
      caption: text($(t, 'caption')!),
      rows: $$(t, 'tbody tr').map((tr) => {
        const th = $(tr, 'th')!
        const badge = $(th, 'span.badge')
        return [
          text(th)
            .replace(badge !== undefined ? text(badge) : '', '')
            .trim(),
          badge !== undefined ? text(badge) : null,
          ...$$(tr, 'td').map((td) => text(td)),
        ]
      }),
    }))
    expect(
      json.types.map((t) => ({
        id: `plugins-${t.cleanType}`,
        caption: t.type,
        rows: t.plugins.map((p) => [
          p.name,
          p.status === 'ACTIVE'
            ? null
            : ({ INACTIVE: 'inactive', DISABLED: 'disabled', DELETING: 'deleting', DELETED: 'deleted' }[
                p.status
              ] ?? ''),
          (p.description ?? '').trim(),
          (p.version ?? '').trim(),
          (p.author ?? '').trim(),
          p.license.trim(),
        ]),
      })),
    ).toEqual(tables)
  })

  const binlogFromHtml = (html: Node) => {
    const select = $(html, 'select')!
    const body = $(html, 'div.card-body')!
    const nav = $(html, 'table#binlogTable thead tr td')!
    return {
      // the current log grows while the server works: sizes compared by shape
      options: $$(select, 'option').map((o) => [o.attrs.value, shape(text(o)), 'selected' in o.attrs]),
      summary: shape(text(body).replace(text(select), '').trim()),
      sql: text($(html, 'div.sqlOuter')!),
      message: text($(html, 'div.alert-success')!),
      nav: $$(nav, 'a').map((a) => [a.attrs.title ?? '', text(a), a.attrs['data-post'] ?? '']),
      rows: $$(html, 'table#binlogTable tbody tr').map((tr) => $$(tr, 'td').map((td) => text(td))),
    }
  }

  const binlogFromJson = (b: BinlogResponse) => {
    const post = (params: Record<string, string | number>) =>
      new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    const base: Record<string, string | number> = b.selectedLog !== null ? { log: b.selectedLog } : {}
    if (b.isFullQuery) base.is_full_query = 1
    const nav: string[][] = []
    if (b.previous !== null)
      nav.push([
        'Previous',
        '«',
        post({ ...base, ...(b.previous.pos !== null ? { pos: b.previous.pos } : {}) }),
      ])
    const full: Record<string, string | number> = {
      ...base,
      ...(b.pos > 0 ? { pos: b.pos } : {}),
      is_full_query: 1,
    }
    if (b.isFullQuery) delete full.is_full_query
    nav.push([b.isFullQuery ? 'Truncate shown queries' : 'Show full queries', '', post(full)])
    if (b.next !== null) nav.push(['Next', '»', post({ ...base, pos: b.next.pos })])
    return {
      options: b.binaryLogs.map((l) => [
        l.name,
        shape(`${l.name}${l.size !== null ? ` (${l.size})` : ''}`),
        l.name === b.log,
      ]),
      summary: shape(`${b.fileCount} Files,${b.totalSize !== null ? ` ${b.totalSize}` : ''}`),
      sql: b.sqlMessage.sql,
      message: b.sqlMessage.message.text,
      nav,
      rows: b.events.map((e) => [
        e.logName,
        e.pos,
        e.eventType,
        e.serverId,
        e.origLogPos,
        e.info.replace(/\s+/g, ' ').trim(),
      ]),
    }
  }

  const BINLOG_CASES: Array<[string, Record<string, string>, string]> = [
    ['first page', {}, ''],
    ['second page', { pos: '25' }, '?pos=25'],
    ['third page (previous keeps a position)', { pos: '50' }, '?pos=50'],
    ['full queries', { is_full_query: '1' }, '?is_full_query=1'],
    // the server's first binary log (MySQL `binlog.000001`, MariaDB `mariadb-bin.000001`)
    ['a log by name', { log: '{first}', pos: '10' }, '?log={first}&pos=10'],
  ]
  for (const [name, params0, qs0] of BINLOG_CASES) {
    it(`Binary log: ${name} [p06-debfa6]`, async () => {
      const [[first]] = (await h.root.query({ sql: 'SHOW BINARY LOGS', rowsAsArray: true })) as unknown as [
        [[string]],
      ]
      const log = encodeURIComponent(first[0])
      const params = Object.fromEntries(
        Object.entries(params0).map(([k, v]) => [k, v.replace('{first}', first[0])]),
      )
      const qs = qs0.replace('{first}', log)
      const { html, json } = await page<BinlogResponse>('/server/binlog', `/binlog${qs}`, params, true)
      expect(binlogFromJson(json)).toEqual(binlogFromHtml(html))
    })
  }
})

/** The raw text of a <pre> (keeps the lines) */
function pageHtmlPre(pre: Node): string {
  const raw = (x: Node | string): string => (typeof x === 'string' ? x : x.children.map(raw).join(''))
  return raw(pre)
}

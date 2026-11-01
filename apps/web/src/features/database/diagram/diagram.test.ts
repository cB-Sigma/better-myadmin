import type { ErDiagramResponse, ErTable } from '@bettermyadmin/contracts'
import * as dagre from '@dagrejs/dagre'
import { describe, expect, it } from 'vitest'
import {
  HEADER_H,
  ROW_H,
  buildGraph,
  centreView,
  columnY,
  diagramFileName,
  edgeGeometry,
  fitView,
  layoutGraph,
  nodeSize,
  pngScale,
  refText,
  searchTables,
  zoomAt,
} from './diagram.ts'

const col = (name: string, type = 'int(11)', extra: Partial<ErTable['columns'][number]> = {}) => ({
  name,
  type,
  nullable: false,
  pk: false,
  unique: false,
  ...extra,
})
const table = (name: string, columns = [col('id', 'int(11)', { pk: true })], view = false): ErTable => ({
  name,
  view,
  engine: view ? '' : 'InnoDB',
  comment: '',
  columns,
})

const DATA: ErDiagramResponse = {
  db: 'shop',
  tables: [
    table('customer', [col('id', 'int', { pk: true }), col('email', 'varchar(255)', { unique: true })]),
    table('order', [
      col('id', 'int', { pk: true }),
      col('customer_id'),
      col('parent_id', 'int', { nullable: true }),
    ]),
    table('order_line', [col('order_id'), col('product_id')]),
    table('product'),
    table('log'),
    table('v_orders', [col('id')], true),
  ],
  relations: [
    {
      kind: 'fk',
      name: 'fk_c',
      table: 'order',
      columns: ['customer_id'],
      refDb: 'shop',
      refTable: 'customer',
      refColumns: ['id'],
    },
    {
      kind: 'fk',
      name: 'fk_o',
      table: 'order_line',
      columns: ['order_id'],
      refDb: 'shop',
      refTable: 'order',
      refColumns: ['id'],
    },
    {
      kind: 'internal',
      name: '',
      table: 'order_line',
      columns: ['product_id'],
      refDb: 'shop',
      refTable: 'product',
      refColumns: ['id'],
    },
    {
      kind: 'fk',
      name: 'fk_self',
      table: 'order',
      columns: ['parent_id'],
      refDb: 'shop',
      refTable: 'order',
      refColumns: ['id'],
    },
    {
      kind: 'fk',
      name: 'fk_x',
      table: 'log',
      columns: ['id'],
      refDb: 'other',
      refTable: 'audit',
      refColumns: ['id'],
    },
  ],
}

describe('buildGraph', () => {
  it('one node per table and an edge per relation inside the database [X63]', () => {
    const g = buildGraph(DATA, new Set())
    expect(g.nodes.map((n) => n.id)).toEqual([
      'customer',
      'order',
      'order_line',
      'product',
      'log',
      'v_orders',
    ])
    expect(g.edges.map((e) => [e.from, e.to, e.relation.kind])).toEqual([
      ['order', 'customer', 'fk'],
      ['order_line', 'order', 'fk'],
      ['order_line', 'product', 'internal'],
      ['order', 'order', 'fk'],
    ])
    // the cross-database relation is listed, not drawn
    expect(g.external.map((r) => r.refTable)).toEqual(['audit'])
    expect([...(g.fkColumns.get('order') ?? [])]).toEqual(['customer_id', 'parent_id'])
  })

  it('a relation to a table the user cannot see is not drawn', () => {
    const g = buildGraph({ ...DATA, tables: DATA.tables.filter((t) => t.name !== 'product') }, new Set())
    expect(g.edges.some((e) => e.to === 'product')).toBe(false)
    expect(g.external.map((r) => r.refTable)).toEqual(['product', 'audit'])
  })

  it('collapsed tables keep the header only', () => {
    const open = nodeSize(DATA.tables[1]!, false)
    const closed = nodeSize(DATA.tables[1]!, true)
    expect(open.height).toBe(HEADER_H + 3 * ROW_H + 4)
    expect(closed.height).toBe(HEADER_H)
    const g = buildGraph(DATA, new Set(['order']))
    expect(g.nodes.find((n) => n.id === 'order')).toMatchObject({ collapsed: true, height: HEADER_H })
  })

  it('box widths follow the measured texts within bounds', () => {
    expect(nodeSize(table('t'), false, () => 1).width).toBe(120)
    expect(nodeSize(table('t', [col('c', 'x'.repeat(500))]), false, (s) => s.length * 7).width).toBe(420)
  })
})

describe('layoutGraph', () => {
  it('places referenced tables left of the referencing ones and packs unrelated tables below', () => {
    const g = buildGraph(DATA, new Set())
    const { positions, bounds } = layoutGraph(g, dagre)
    expect(positions.size).toBe(DATA.tables.length)
    const x = (n: string) => positions.get(n)!.x
    expect(x('customer')).toBeLessThan(x('order'))
    expect(x('order')).toBeLessThan(x('order_line'))
    expect(x('product')).toBeLessThan(x('order_line'))
    // log and v_orders have no drawn relation: below the layered part
    const linkedBottom = Math.max(
      ...['customer', 'order', 'order_line', 'product'].map((n) => {
        const r = positions.get(n)!
        return r.y + r.height
      }),
    )
    expect(positions.get('log')!.y).toBeGreaterThan(linkedBottom)
    expect(positions.get('v_orders')!.y).toBeGreaterThan(linkedBottom)
    for (const r of positions.values()) {
      expect(r.x + r.width).toBeLessThanOrEqual(bounds.width)
      expect(r.y + r.height).toBeLessThanOrEqual(bounds.height)
    }
  })

  it('no box overlaps another, also for 150 tables', () => {
    const tables = Array.from({ length: 150 }, (_, i) =>
      table(`t${i}`, [col('id', 'int', { pk: true }), col('ref'), col('name', 'varchar(64)')]),
    )
    const relations = tables.slice(1, 100).map((t, i) => ({
      kind: 'fk' as const,
      name: `fk${i}`,
      table: t.name,
      columns: ['ref'],
      refDb: 'big',
      refTable: `t${Math.floor(i / 3)}`,
      refColumns: ['id'],
    }))
    const g = buildGraph({ db: 'big', tables, relations }, new Set())
    const { positions, bounds } = layoutGraph(g, dagre)
    const rects = [...positions.values()]
    expect(rects).toHaveLength(150)
    // the wide tree is wrapped into a landscape-ish block, still referenced tables first
    expect(bounds.width / bounds.height).toBeGreaterThan(0.5)
    expect(bounds.width / bounds.height).toBeLessThan(4)
    expect(positions.get('t0')!.x).toBeLessThan(positions.get('t1')!.x)
    expect(positions.get('t1')!.x).toBeLessThan(positions.get('t10')!.x)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!
        const b = rects[j]!
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
        expect(overlap, `${i} / ${j}`).toBe(false)
      }
  })

  it('a database without relations is a grid, not one column', () => {
    const tables = Array.from({ length: 40 }, (_, i) => table(`t${i}`))
    const { positions, bounds } = layoutGraph(
      buildGraph({ db: 'd', tables, relations: [] }, new Set()),
      dagre,
    )
    expect(new Set([...positions.values()].map((r) => r.x)).size).toBeGreaterThan(3)
    expect(bounds.width / bounds.height).toBeGreaterThan(0.5)
  })
})

describe('edges', () => {
  const g = buildGraph(DATA, new Set())
  const { positions } = layoutGraph(g, dagre)
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))

  it('start at the referencing column and end at the referenced column', () => {
    const e = g.edges[0]!
    const geo = edgeGeometry(e, positions, nodes)!
    const from = positions.get('order')!
    const to = positions.get('customer')!
    expect(geo.start.x).toBeCloseTo(from.x)
    expect(geo.start.y).toBeCloseTo(columnY(from, nodes.get('order')!, 'customer_id'))
    expect(geo.d.startsWith(`M${Math.round(from.x * 10) / 10},`)).toBe(true)
    // the arrow tip touches the referenced box's right side at its id row
    const tip = geo.arrow.split(' ')[0]!.split(',').map(Number)
    expect(tip[0]).toBeCloseTo(to.x + to.width, 0)
    expect(tip[1]).toBeCloseTo(to.y + HEADER_H + 2 + ROW_H / 2, 0)
  })

  it('a self-reference loops on the right side; a collapsed table anchors at its header', () => {
    const self = edgeGeometry(g.edges[3]!, positions, nodes)!
    const r = positions.get('order')!
    expect(self.start.x).toBeCloseTo(r.x + r.width)
    const c = buildGraph(DATA, new Set(['order']))
    const cl = layoutGraph(c, dagre)
    const geo = edgeGeometry(c.edges[0]!, cl.positions, new Map(c.nodes.map((n) => [n.id, n])))!
    expect(geo.start.y).toBeCloseTo(cl.positions.get('order')!.y + HEADER_H / 2)
  })
})

describe('search, view and export helpers', () => {
  it('search: exact name first, then substrings, case-insensitive', () => {
    expect(searchTables(DATA.tables, 'ORDER')).toEqual(['order', 'order_line', 'v_orders'])
    expect(searchTables(DATA.tables, '  ')).toEqual([])
    expect(searchTables(DATA.tables, 'zzz')).toEqual([])
  })

  it('fit shows the whole diagram and never zooms in beyond 100 %', () => {
    expect(fitView({ x: 0, y: 0, width: 400, height: 200 }, 800, 600)).toEqual({ k: 1, x: 200, y: 200 })
    const v = fitView({ x: 0, y: 0, width: 4000, height: 1000 }, 800, 600)
    expect(v.k).toBeCloseTo(768 / 4000)
    expect(v.x).toBeCloseTo(16)
  })

  it('centre and zoom keep their anchor point', () => {
    const c = centreView({ x: 100, y: 100, width: 200, height: 100 }, 800, 600, 1)
    expect(c).toEqual({ k: 1, x: 200, y: 150 })
    expect(centreView({ x: 0, y: 0, width: 10, height: 10 }, 100, 100, 0.2).k).toBe(0.8)
    const z = zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 50)
    expect(z).toEqual({ k: 2, x: -100, y: -50 })
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 1000, 0, 0).k).toBe(4)
  })

  it('file names, PNG scale and the referenced side text', () => {
    expect(diagramFileName('my/db:1', 'svg')).toBe('my_db_1.svg')
    expect(diagramFileName('', 'png')).toBe('diagram.png')
    expect(pngScale({ x: 0, y: 0, width: 1000, height: 500 })).toBe(2)
    expect(pngScale({ x: 0, y: 0, width: 20000, height: 500 })).toBeLessThan(1)
    expect(refText(DATA.relations[0]!, 'shop')).toBe('customer (id)')
    expect(refText(DATA.relations[4]!, 'shop')).toBe('other.audit (id)')
  })
})

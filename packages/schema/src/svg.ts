import { getStringWidth } from './font.ts'
import {
  type SchemaRequest,
  type SchemaResult,
  type SchemaTableData,
  coordinatesOf,
  fieldsOf,
  floatStr,
  pick,
  relationEnds,
  relationsOf,
  titleOf,
} from './model.ts'
import { XmlWriter } from './xml-writer.ts'

/**
 * The relational schema as SVG.
 * pma: src/Plugins/Schema/SchemaSvg.php, Svg/SvgRelationSchema.php, Svg/TableStatsSvg.php,
 *      Svg/RelationStatsSvg.php, Svg/Svg.php
 */
interface SvgTable {
  name: string
  fields: string[]
  primary: string[]
  displayField: string
  x: number
  y: number
  width: number
  heightCell: number
  height: number
}

const FONT = 'Arial'
const FONT_SIZE = 16

export function svgSchema(req: SchemaRequest, data: ReadonlyMap<string, SchemaTableData>): SchemaResult {
  const o = (k: string) => req.options[k] !== undefined
  const showColor = o('svg_show_color')
  const showKeys = o('svg_show_keys')
  const tableDimension = o('svg_show_table_dimension')
  const sameWide = o('svg_all_tables_same_width')

  const tables = new Map<string, SvgTable>()
  let tablewidth = 0
  let xMax = 0
  let yMax = 0
  let xMin = 100000
  let yMin = 100000
  const sameWidth = new Set<string>()

  const make = (name: string, keys: boolean): SvgTable => {
    const t = data.get(name) as SchemaTableData
    const fields = fieldsOf(t, keys)
    const { x, y } = coordinatesOf(req, name)
    const heightCell = FONT_SIZE + 4
    const s: SvgTable = {
      name,
      fields,
      primary: t.primary,
      displayField: t.displayField,
      x,
      y,
      width: 0,
      heightCell,
      height: (fields.length + 1) * heightCell,
    }
    for (const f of fields) s.width = Math.max(s.width, getStringWidth(f, FONT, FONT_SIZE))
    s.width += getStringWidth('  ', FONT, FONT_SIZE)
    while (s.width < getStringWidth(titleOf(name, s.width, heightCell, tableDimension), FONT, FONT_SIZE))
      s.width += 7
    return s
  }
  const setMinMax = (t: SvgTable, width: number) => {
    xMax = Math.max(xMax, t.x + width)
    yMax = Math.max(yMax, t.y + t.height)
    xMin = Math.min(xMin, t.x)
    yMin = Math.min(yMin, t.y)
  }

  for (const name of req.tables) {
    let t = tables.get(name)
    if (t === undefined) {
      t = make(name, showKeys)
      tables.set(name, t)
      tablewidth = Math.max(tablewidth, t.width)
    }
    // `$this->tables[$table]->width = &$this->tablewidth`: drawn with the final width
    if (sameWide) sameWidth.add(name)
    setMinMax(t, sameWide ? tablewidth : t.width)
  }

  const svg = new XmlWriter()
  svg.startDocument()
  svg.dtd('svg', '-//W3C//DTD SVG 1.1//EN', 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd')

  // Svg::startSvgDoc
  const border = 15
  const width = Math.trunc(xMax + border)
  const height = Math.trunc(yMax + border)
  const vx = xMin - border
  const vy = yMin - border
  svg.startElement('svg')
  if (vx !== 0 || vy !== 0) {
    svg.writeAttribute('viewBox', `${Math.trunc(vx)} ${Math.trunc(vy)} ${width} ${height}`)
  }
  svg.writeAttribute('width', `${floatStr(width - vx)}px`)
  svg.writeAttribute('height', `${floatStr(height - vy)}px`)
  svg.writeAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.writeAttribute('version', '1.1')

  const element = (
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string | null,
    style: string,
  ) => {
    svg.startElement(name)
    svg.writeAttribute('width', floatStr(w))
    svg.writeAttribute('height', floatStr(h))
    svg.writeAttribute('x', floatStr(x))
    svg.writeAttribute('y', floatStr(y))
    svg.writeAttribute('style', style)
    if (text !== null) {
      svg.writeAttribute('font-family', FONT)
      svg.writeAttribute('font-size', `${FONT_SIZE}px`)
      svg.text(text)
    }
    svg.endElement()
  }
  const line = (x1: number, y1: number, x2: number, y2: number, style: string) => {
    svg.startElement('line')
    svg.writeAttribute('x1', floatStr(x1))
    svg.writeAttribute('y1', floatStr(y1))
    svg.writeAttribute('x2', floatStr(x2))
    svg.writeAttribute('y2', floatStr(y2))
    svg.writeAttribute('style', style)
    svg.endElement()
  }

  for (const t of tables.values()) if (sameWidth.has(t.name)) t.width = tablewidth

  const rel = relationsOf(req, data, true)
  if (rel.seen) {
    const wTick = 10
    const root2 = 2 * Math.sqrt(2)
    for (const r of rel.list) {
      const m = tables.get(r.master)
      const f = tables.get(r.foreign)
      if (m === undefined || f === undefined) continue
      const e = relationEnds(m, r.masterField, f, r.foreignField, wTick)
      const color = showColor ? pick(req, ['#c00', '#bbb', '#333', '#cb0', '#0b0', '#0bf', '#b0b']) : '#333'
      const s1 = `stroke:${color};stroke-width:1;`
      const s2 = `stroke:${color};stroke-width:2;`
      line(e.xSrc, e.ySrc, e.xSrc + e.srcDir * wTick, e.ySrc, s1)
      line(e.xDest + e.destDir * wTick, e.yDest, e.xDest, e.yDest, s1)
      line(e.xSrc + e.srcDir * wTick, e.ySrc, e.xDest + e.destDir * wTick, e.yDest, s1)
      line(
        e.xSrc + e.srcDir * wTick * 0.75,
        e.ySrc,
        e.xSrc + e.srcDir * (0.75 - 1 / root2) * wTick,
        e.ySrc + wTick / root2,
        s2,
      )
      line(
        e.xSrc + e.srcDir * wTick * 0.75,
        e.ySrc,
        e.xSrc + e.srcDir * (0.75 - 1 / root2) * wTick,
        e.ySrc - wTick / root2,
        s2,
      )
      line(
        e.xDest + (e.destDir * wTick) / 2,
        e.yDest,
        e.xDest + e.destDir * (0.5 + 1 / root2) * wTick,
        e.yDest + wTick / root2,
        s2,
      )
      line(
        e.xDest + (e.destDir * wTick) / 2,
        e.yDest,
        e.xDest + e.destDir * (0.5 + 1 / root2) * wTick,
        e.yDest - wTick / root2,
        s2,
      )
    }
  }

  // TableStatsSvg::tableDraw
  for (const t of tables.values()) {
    element('rect', t.x, t.y, t.width, t.heightCell, null, 'fill:#007;stroke:black;')
    element(
      'text',
      t.x + 5,
      t.y + 14,
      t.width,
      t.heightCell,
      titleOf(t.name, t.width, t.heightCell, tableDimension),
      'fill:#fff;',
    )
    let current = 0
    for (const field of t.fields) {
      current += t.heightCell
      let fill = 'none'
      if (showColor) {
        if (t.primary.includes(field)) fill = '#aea'
        if (field === t.displayField) fill = 'none'
      }
      element('rect', t.x, t.y + current, t.width, t.heightCell, null, `fill:${fill};stroke:black;`)
      element('text', t.x + 5, t.y + 14 + current, t.width, t.heightCell, field, 'fill:black;')
    }
  }
  svg.endElement()
  svg.endDocument()
  return { fileName: `${req.fileBase}.svg`, mediaType: 'image/svg+xml', data: svg.flush() }
}

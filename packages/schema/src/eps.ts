import { getStringWidth } from './font.ts'
import {
  type SchemaRequest,
  type SchemaResult,
  type SchemaTableData,
  coordinatesOf,
  shownFields,
  floatStr,
  relationEnds,
  relationsOf,
  titleLine,
  titleOf,
} from './model.ts'

/**
 * The relational schema as Encapsulated PostScript.
 * pma: src/Plugins/Schema/SchemaEps.php, Eps/EpsRelationSchema.php, Eps/TableStatsEps.php,
 *      Eps/RelationStatsEps.php, Eps/Eps.php
 */
interface EpsTable {
  name: string
  fields: string[]
  x: number
  y: number
  width: number
  heightCell: number
}

export function epsSchema(req: SchemaRequest, data: ReadonlyMap<string, SchemaTableData>): SchemaResult {
  const o = (k: string) => req.options[k] !== undefined
  const showKeys = o('eps_show_keys')
  const tableDimension = o('eps_show_table_dimension')
  const sameWide = o('eps_all_tables_same_width')
  const orientation = req.options.eps_orientation === 'P' ? 'P' : 'L'

  let out = '%!PS-Adobe-3.0 EPSF-3.0 \n'
  out += `%%Title: ${titleLine(req)}\n`
  out += `%%Creator: ${req.creator}\n`
  out += `%%CreationDate: ${req.date ?? ''}\n`
  out += '%%PageOrder: Ascend \n'
  out += `%%Orientation: ${orientation === 'L' ? 'Landscape' : 'Portrait'}\n`
  out += '%%EndComments \n'
  out += '%%Pages 1 \n'
  out += '%%BoundingBox: 72 150 144 170 \n'
  const font = 'Verdana'
  const fontSize = 10
  out += `/${font} findfont   % Get the basic font\n`
  out += `${fontSize} scalefont            % Scale the font to ${fontSize} points\n`
  out += 'setfont                 % Make it the current font\n'

  const line = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    out += `${w} setlinewidth  \n${floatStr(x1)} ${floatStr(y1)} moveto \n${floatStr(x2)} ${floatStr(y2)} lineto \nstroke \n`
  }
  const rect = (x: number, y: number, w: number, h: number, lw: number) => {
    out += `${lw} setlinewidth  \nnewpath \n${floatStr(x)} ${floatStr(y)} moveto \n0 ${floatStr(h)} rlineto \n${floatStr(w)} 0 rlineto \n0 -${floatStr(h)} rlineto \nclosepath \nstroke \n`
  }
  const showXY = (text: string, x: number, y: number) => {
    out += `${floatStr(x)} ${floatStr(y)} moveto \n(${text}) show \n`
  }

  const tables = new Map<string, EpsTable>()
  let tablewidth = 0
  for (const name of req.tables) {
    let t = tables.get(name)
    if (t === undefined) {
      const d = data.get(name) as SchemaTableData
      const fields = shownFields(d, showKeys)
      const { x, y } = coordinatesOf(req, name)
      t = { name, fields, x, y, width: 0, heightCell: fontSize + 4 }
      for (const f of fields) t.width = Math.max(t.width, getStringWidth(f, font, fontSize))
      t.width += getStringWidth('      ', font, fontSize)
      while (t.width < getStringWidth(titleOf(name, t.width, t.heightCell, tableDimension), font, fontSize)) {
        t.width += 7
      }
      tables.set(name, t)
      tablewidth = Math.max(tablewidth, t.width)
    }
    if (sameWide) t.width = tablewidth
  }

  const rel = relationsOf(req, data, false)
  if (rel.seen) {
    const wTick = 10
    const root2 = 2 * Math.sqrt(2)
    for (const r of rel.list) {
      const m = tables.get(r.master)
      const f = tables.get(r.foreign)
      if (m === undefined || f === undefined) continue
      const e = relationEnds(m, r.masterField, f, r.foreignField, wTick)
      e.ySrc += 10
      e.yDest += 10
      line(e.xSrc, e.ySrc, e.xSrc + e.srcDir * wTick, e.ySrc, 1)
      line(e.xDest + e.destDir * wTick, e.yDest, e.xDest, e.yDest, 1)
      line(e.xSrc + e.srcDir * wTick, e.ySrc, e.xDest + e.destDir * wTick, e.yDest, 1)
      line(
        e.xSrc + e.srcDir * wTick * 0.75,
        e.ySrc,
        e.xSrc + e.srcDir * (0.75 - 1 / root2) * wTick,
        e.ySrc + wTick / root2,
        1,
      )
      line(
        e.xSrc + e.srcDir * wTick * 0.75,
        e.ySrc,
        e.xSrc + e.srcDir * (0.75 - 1 / root2) * wTick,
        e.ySrc - wTick / root2,
        1,
      )
      line(
        e.xDest + (e.destDir * wTick) / 2,
        e.yDest,
        e.xDest + e.destDir * (0.5 + 1 / root2) * wTick,
        e.yDest + wTick / root2,
        1,
      )
      line(
        e.xDest + (e.destDir * wTick) / 2,
        e.yDest,
        e.xDest + e.destDir * (0.5 + 1 / root2) * wTick,
        e.yDest - wTick / root2,
        1,
      )
    }
  }

  for (const t of tables.values()) {
    rect(t.x, t.y + 12, t.width, t.heightCell, 1)
    showXY(titleOf(t.name, t.width, t.heightCell, tableDimension), t.x + 5, t.y + 14)
    let current = 0
    for (const field of t.fields) {
      current += t.heightCell
      rect(t.x, t.y + 12 + current, t.width, t.heightCell, 1)
      showXY(field, t.x + 5, t.y + 14 + current)
    }
  }
  out += 'showpage \n'
  return { fileName: `${req.fileBase}.eps`, mediaType: 'image/x-eps', data: out }
}

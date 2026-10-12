import {
  type SchemaRequest,
  type SchemaResult,
  type SchemaTableData,
  coordinatesOf,
  shownFields,
  floatStr,
  pick,
  relationsOf,
} from './model.ts'
import { XmlWriter } from './xml-writer.ts'

/**
 * The relational schema as a Dia diagram.
 * pma: src/Plugins/Schema/SchemaDia.php, Dia/DiaRelationSchema.php, Dia/TableStatsDia.php,
 *      Dia/RelationStatsDia.php, Dia/Dia.php
 */
interface DiaTable {
  id: number
  name: string
  fields: string[]
  primary: string[]
  displayField: string
  x: number
  y: number
}

const MARGIN = 2.8222000598907471

export function diaSchema(req: SchemaRequest, data: ReadonlyMap<string, SchemaTableData>): SchemaResult {
  const showColor = req.options.dia_show_color !== undefined
  const showKeys = req.options.dia_show_keys !== undefined
  const orientation = req.options.dia_orientation === 'P' ? 'P' : 'L'
  const paper = req.options.dia_paper ?? 'A4'
  let objectId = 0

  const dia = new XmlWriter()
  dia.startDocument()
  // Dia::startDiaDoc
  dia.startElement('dia:diagram')
  dia.writeAttribute('xmlns:dia', 'http://www.lysator.liu.se/~alla/dia/')
  dia.startElement('dia:diagramdata')
  const m = floatStr(MARGIN)
  dia.writeRaw(`<dia:attribute name="background">
              <dia:color val="#ffffff"/>
            </dia:attribute>
            <dia:attribute name="pagebreak">
              <dia:color val="#000099"/>
            </dia:attribute>
            <dia:attribute name="paper">
              <dia:composite type="paper">
                <dia:attribute name="name">
                  <dia:string>#${paper}#</dia:string>
                </dia:attribute>
                <dia:attribute name="tmargin">
                  <dia:real val="${m}"/>
                </dia:attribute>
                <dia:attribute name="bmargin">
                  <dia:real val="${m}"/>
                </dia:attribute>
                <dia:attribute name="lmargin">
                  <dia:real val="${m}"/>
                </dia:attribute>
                <dia:attribute name="rmargin">
                  <dia:real val="${m}"/>
                </dia:attribute>
                <dia:attribute name="is_portrait">
                  <dia:boolean val="${orientation === 'P' ? 'true' : 'false'}"/>
                </dia:attribute>
                <dia:attribute name="scaling">
                  <dia:real val="1"/>
                </dia:attribute>
                <dia:attribute name="fitto">
                  <dia:boolean val="false"/>
                </dia:attribute>
              </dia:composite>
            </dia:attribute>
            <dia:attribute name="grid">
              <dia:composite type="grid">
                <dia:attribute name="width_x">
                  <dia:real val="1"/>
                </dia:attribute>
                <dia:attribute name="width_y">
                  <dia:real val="1"/>
                </dia:attribute>
                <dia:attribute name="visible_x">
                  <dia:int val="1"/>
                </dia:attribute>
                <dia:attribute name="visible_y">
                  <dia:int val="1"/>
                </dia:attribute>
                <dia:composite type="color"/>
              </dia:composite>
            </dia:attribute>
            <dia:attribute name="color">
              <dia:color val="#d8e5e5"/>
            </dia:attribute>
            <dia:attribute name="guides">
              <dia:composite type="guides">
                <dia:attribute name="hguides"/>
                <dia:attribute name="vguides"/>
              </dia:composite>
            </dia:attribute>`)
  dia.endElement()
  dia.startElement('dia:layer')
  dia.writeAttribute('name', 'Background')
  dia.writeAttribute('visible', 'true')
  dia.writeAttribute('active', 'true')

  const tables = new Map<string, DiaTable>()
  for (const name of req.tables) {
    if (tables.has(name)) continue
    const d = data.get(name) as SchemaTableData
    const { x, y } = coordinatesOf(req, name)
    tables.set(name, {
      id: ++objectId,
      name,
      fields: shownFields(d, showKeys),
      primary: d.primary,
      displayField: d.displayField,
      x,
      y,
    })
  }
  const rel = relationsOf(req, data, false)

  // TableStatsDia::tableDraw
  const factor = 0.1
  for (const t of tables.values()) {
    const color = showColor ? `#${pick(req, ['FF0000', '000099', '00FF00'])}` : '#000000'
    const pos = `${floatStr(t.x * factor)},${floatStr(t.y * factor)}`
    dia.startElement('dia:object')
    dia.writeAttribute('type', 'Database - Table')
    dia.writeAttribute('version', '0')
    dia.writeAttribute('id', String(t.id))
    dia.writeRaw(`<dia:attribute name="obj_pos">
                <dia:point val="${pos}"/>
            </dia:attribute>
            <dia:attribute name="obj_bb">
                <dia:rectangle val="${pos};9.97,9.2"/>
            </dia:attribute>
            <dia:attribute name="meta">
                <dia:composite type="dict"/>
            </dia:attribute>
            <dia:attribute name="elem_corner">
                <dia:point val="${pos}"/>
            </dia:attribute>
            <dia:attribute name="elem_width">
                <dia:real val="5.9199999999999999"/>
            </dia:attribute>
            <dia:attribute name="elem_height">
                <dia:real val="3.5"/>
            </dia:attribute>
            <dia:attribute name="text_colour">
                <dia:color val="${color}"/>
            </dia:attribute>
            <dia:attribute name="line_colour">
                <dia:color val="#000000"/>
            </dia:attribute>
            <dia:attribute name="fill_colour">
                <dia:color val="#ffffff"/>
            </dia:attribute>
            <dia:attribute name="line_width">
                <dia:real val="0.10000000000000001"/>
            </dia:attribute>
            <dia:attribute name="name">
                <dia:string>#${t.name}#</dia:string>
            </dia:attribute>
            <dia:attribute name="comment">
                <dia:string>##</dia:string>
            </dia:attribute>
            <dia:attribute name="visible_comment">
                <dia:boolean val="false"/>
            </dia:attribute>
            <dia:attribute name="tagging_comment">
                <dia:boolean val="false"/>
            </dia:attribute>
            <dia:attribute name="underline_primary_key">
                <dia:boolean val="true"/>
            </dia:attribute>
            <dia:attribute name="bold_primary_keys">
                <dia:boolean val="true"/>
            </dia:attribute>
            <dia:attribute name="normal_font">
                <dia:font family="monospace" style="0" name="Courier"/>
            </dia:attribute>
            <dia:attribute name="name_font">
                <dia:font family="sans" style="80" name="Helvetica-Bold"/>
            </dia:attribute>
            <dia:attribute name="comment_font">
                <dia:font family="sans" style="0" name="Helvetica"/>
            </dia:attribute>
            <dia:attribute name="normal_font_height">
                <dia:real val="0.80000000000000004"/>
            </dia:attribute>
            <dia:attribute name="name_font_height">
                <dia:real val="0.69999999999999996"/>
            </dia:attribute>
            <dia:attribute name="comment_font_height">
                <dia:real val="0.69999999999999996"/>
            </dia:attribute>`)
    dia.startElement('dia:attribute')
    dia.writeAttribute('name', 'attributes')
    for (const field of t.fields) {
      dia.writeRaw(`<dia:composite type="table_attribute">
                    <dia:attribute name="name">
                <dia:string>#${field}#</dia:string>
                </dia:attribute>
                <dia:attribute name="type">
                    <dia:string>##</dia:string>
                </dia:attribute>
                    <dia:attribute name="comment">
                <dia:string>##</dia:string>
                </dia:attribute>`)
      let pm = t.primary.includes(field) ? 'true' : 'false'
      if (field === t.displayField) pm = 'false'
      dia.writeRaw(`<dia:attribute name="primary_key">
                    <dia:boolean val="${pm}"/>
                </dia:attribute>
                <dia:attribute name="nullable">
                    <dia:boolean val="false"/>
                </dia:attribute>
                <dia:attribute name="unique">
                    <dia:boolean val="${pm}"/>
                </dia:attribute>
                </dia:composite>`)
    }
    dia.endElement()
    dia.endElement()
  }

  // RelationStatsDia::relationDraw
  if (rel.seen) {
    const xy = (t: DiaTable, column: string): [number, number] => {
      const pos = Math.max(0, t.fields.indexOf(column))
      return pos !== 0 ? [pos + 12 + pos, pos + 12 + pos + 1] : [pos + 12, pos + 12 + 1]
    }
    for (const r of rel.list) {
      const mt = tables.get(r.master)
      const ft = tables.get(r.foreign)
      if (mt === undefined || ft === undefined) continue
      const src = xy(mt, r.masterField)
      const dest = xy(ft, r.foreignField)
      ++objectId
      if (src[1] === dest[1] && src[0] === dest[0]) continue
      const color = showColor ? `#${pick(req, ['FF0000', '000099', '00FF00'])}` : '#000000'
      dia.writeRaw(`<dia:object type="Database - Reference" version="0" id="${objectId}">
            <dia:attribute name="obj_pos">
                <dia:point val="3.27,18.9198"/>
            </dia:attribute>
            <dia:attribute name="obj_bb">
                <dia:rectangle val="2.27,8.7175;17.7679,18.9198"/>
            </dia:attribute>
            <dia:attribute name="meta">
                <dia:composite type="dict"/>
            </dia:attribute>
            <dia:attribute name="orth_points">
                <dia:point val="3.27,18.9198"/>
                <dia:point val="2.27,18.9198"/>
                <dia:point val="2.27,14.1286"/>
                <dia:point val="17.7679,14.1286"/>
                <dia:point val="17.7679,9.3375"/>
                <dia:point val="16.7679,9.3375"/>
            </dia:attribute>
            <dia:attribute name="orth_orient">
                <dia:enum val="0"/>
                <dia:enum val="1"/>
                <dia:enum val="0"/>
                <dia:enum val="1"/>
                <dia:enum val="0"/>
            </dia:attribute>
            <dia:attribute name="orth_autoroute">
                <dia:boolean val="true"/>
            </dia:attribute>
            <dia:attribute name="text_colour">
                <dia:color val="#000000"/>
            </dia:attribute>
            <dia:attribute name="line_colour">
                <dia:color val="${color}"/>
            </dia:attribute>
            <dia:attribute name="line_width">
                <dia:real val="0.10000000000000001"/>
            </dia:attribute>
            <dia:attribute name="line_style">
                <dia:enum val="0"/>
                <dia:real val="1"/>
            </dia:attribute>
            <dia:attribute name="corner_radius">
                <dia:real val="0"/>
            </dia:attribute>
            <dia:attribute name="end_arrow">
                <dia:enum val="22"/>
            </dia:attribute>
            <dia:attribute name="end_arrow_length">
                <dia:real val="0.5"/>
            </dia:attribute>
            <dia:attribute name="end_arrow_width">
                <dia:real val="0.5"/>
            </dia:attribute>
            <dia:attribute name="start_point_desc">
                <dia:string>#1#</dia:string>
            </dia:attribute>
            <dia:attribute name="end_point_desc">
                <dia:string>#n#</dia:string>
            </dia:attribute>
            <dia:attribute name="normal_font">
                <dia:font family="monospace" style="0" name="Courier"/>
            </dia:attribute>
            <dia:attribute name="normal_font_height">
                <dia:real val="0.59999999999999998"/>
            </dia:attribute>
            <dia:connections>
                <dia:connection handle="0" to="${mt.id}" connection="${src[1]}"/>
                <dia:connection handle="1" to="${ft.id}" connection="${dest[1]}"/>
            </dia:connections>
            </dia:object>`)
    }
  }
  dia.endElement()
  dia.endDocument()
  return { fileName: `${req.fileBase}.dia`, mediaType: 'application/x-dia-diagram', data: dia.flush() }
}

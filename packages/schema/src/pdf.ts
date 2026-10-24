import { type Align, type Border, type Link, PmaPdf } from '@bettermyadmin/pdf'
import {
  type SchemaRequest,
  type SchemaResult,
  type SchemaTableData,
  coordinatesOf,
  relationEnds,
  relationsOf,
  shownFields,
  titleOf,
} from './model.ts'

/**
 * The relational schema as PDF (TCPDF in mm): the tables at their designer positions scaled to the
 * page, the relations, an optional grid, and with "Data dictionary" a table of contents and one page
 * per table before the schema page, linked both ways.
 * pma: src/Plugins/Schema/SchemaPdf.php, Pdf/PdfRelationSchema.php, Pdf/TableStatsPdf.php,
 *      Pdf/RelationStatsPdf.php, Pdf/Pdf.php
 */

/** sprintf('%.0f', n) */
const f0 = (n: number) => `${n < 0 ? '-' : ''}${Math.round(Math.abs(n))}`
/** sprintf('%02d', n) */
const d2 = (n: number) => String(n).padStart(2, '0')

/** customLinks: [table][field or '-'] → link id ('' when the target is not drawn) */
type Links = Record<string, Record<string, Link>>

/** pma: src/Plugins/Schema/Pdf/Pdf.php */
class SchemaPdfDoc extends PmaPdf {
  xMin = 0
  yMin = 0
  leftMargin = 10
  topMargin = 10
  scale = 1
  readonly customLinks: { doc: Links; RT: Links } = { doc: {}, RT: {} }
  /** customLinks['RT']['-']: the relational schema page */
  rtLink: Link = ''
  widths: number[] = []
  cMargin = 0
  readonly withDoc: boolean
  readonly pageTitle: string

  constructor(orientation: string, paper: string, req: SchemaRequest, withDoc: boolean, pageTitle: string) {
    super(orientation, 'mm', paper, {
      author: req.creator,
      pageNumberLabel: tOf(req)('Page number:'),
      errorLabel: tOf(req)('Error while creating PDF:'),
      date: req.localisedDate ?? '',
    })
    this.withDoc = withDoc
    this.pageTitle = pageTitle
  }

  setCMargin(cMargin: number): void {
    this.cMargin = cMargin
  }

  setScale(scale = 1, xMin = 0, yMin = 0, leftMargin = -1, topMargin = -1): void {
    this.scale = scale
    this.xMin = xMin
    this.yMin = yMin
    // (as phpMyAdmin: the properties, not the arguments, are compared with -1)
    if (this.leftMargin !== -1) this.leftMargin = leftMargin
    if (this.topMargin === -1) return
    this.topMargin = topMargin
  }

  cellScale(
    w: number,
    h = 0,
    txt = '',
    border: Border = 0,
    ln = 0,
    align: Align = '',
    fill = false,
    link: Link = '',
  ): void {
    this.cell(w / this.scale, h / this.scale, txt, border, ln, align, fill, link)
  }

  lineScale(x1: number, y1: number, x2: number, y2: number): void {
    const sx = (x: number) => (x - this.xMin) / this.scale + this.leftMargin
    const sy = (y: number) => (y - this.yMin) / this.scale + this.topMargin
    this.line(sx(x1), sy(y1), sx(x2), sy(y2))
  }

  setXyScale(x: number, y: number): void {
    this.setXY((x - this.xMin) / this.scale + this.leftMargin, (y - this.yMin) / this.scale + this.topMargin)
  }

  setXScale(x: number): void {
    this.setX((x - this.xMin) / this.scale + this.leftMargin)
  }

  setFontSizeScale(size: number): void {
    // Set font size in points
    this.setFontSize(size / this.scale)
  }

  setLineWidthScale(width: number): void {
    this.setLineWidth(width / this.scale)
  }

  /** the page description (or "PDF export page"), only with the data dictionary */
  protected override header(): void {
    if (!this.withDoc) return
    this.setFont('B', 14)
    this.cell(0, 6, this.pageTitle, 'B', 1, 'C')
    this.setFont('')
    this.ln()
  }

  protected override footer(): void {
    if (!this.withDoc) return
    super.footer()
  }

  setWidths(w: number[]): void {
    this.widths = w
  }

  /** one row of the data dictionary: bordered cells as high as the tallest text */
  row(data: string[], links: Record<number, Link>): void {
    let nb = 0
    data.forEach((d, i) => {
      nb = Math.max(nb, this.numLines(this.widths[i] ?? 0, d))
    })
    const il = this.fontSize
    const h = (il + 1) * nb
    // page break if necessary
    this.checkPageBreak(h)
    // draw the cells
    data.forEach((d, i) => {
      const w = this.widths[i] ?? 0
      // save current position
      const x = this.getX()
      const y = this.getY()
      // draw the border
      this.rect(x, y, w, h)
      const link = links[i]
      if (link !== undefined) this.link(x, y, w, h, link)
      // print text
      this.multiCell(w, il + 1, d, 'L')
      // go to right side
      this.setXY(x + w, y)
    })
    // go to line
    this.ln(h)
  }

  /** the number of lines a MultiCell of width w will take */
  numLines(w0: number, txt: string): number {
    const w = w0 === 0 ? this.w - this.rMargin - this.x : w0
    const wmax = ((w - 2 * this.cMargin) * 1000) / this.fontSize
    const s = [...txt.replaceAll('\r', '')]
    let nb = s.length
    if (nb > 0 && s[nb - 1] === '\n') nb--
    const charWidth = (c: string) => (this.getStringWidth(c) * 1000) / this.fontSize
    let sep = -1
    let i = 0
    let j = 0
    let l = 0
    let nl = 1
    while (i < nb) {
      const c = s[i] as string
      if (c === '\n') {
        i++
        sep = -1
        j = i
        l = 0
        nl++
        continue
      }
      if (c === ' ') sep = i
      l += charWidth(c)
      if (l > wmax) {
        if (sep === -1) {
          if (i === j) i++
        } else i = sep + 1
        sep = -1
        j = i
        l = 0
        nl++
      } else i++
    }
    return nl
  }

  /** a link id of customLinks ('' when there is none) */
  linkOf(group: 'doc' | 'RT', table: string, field: string): Link {
    return this.customLinks[group][table]?.[field] ?? ''
  }

  setLinkOf(group: 'doc' | 'RT', table: string, field: string, link: Link): void {
    this.customLinks[group][table] ??= {}
    ;(this.customLinks[group][table] as Record<string, Link>)[field] = link
  }
}

interface PdfTable {
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

/** the translation of a msgid (identity without a translator) */
const tOf = (req: SchemaRequest) => req.t ?? ((s: string) => s)

/** PdfRelationSchema: the document of the request's tables */
export async function pdfSchema(
  req: SchemaRequest,
  data: ReadonlyMap<string, SchemaTableData>,
): Promise<SchemaResult> {
  const t = tOf(req)
  const o = (k: string) => req.options[k] !== undefined
  const showGrid = o('pdf_show_grid')
  const showColor = o('pdf_show_color')
  const showKeys = o('pdf_show_keys')
  const tableDimension = o('pdf_show_table_dimension')
  const sameWide = o('pdf_all_tables_same_width')
  const withDoc = o('pdf_with_doc')
  const tableOrder = req.options.pdf_table_order ?? ''
  // ExportRelationSchema::setOrientation / setPaper
  const orientation = req.options.pdf_orientation === 'P' ? 'P' : 'L'
  const paper = req.options.pdf_paper ?? 'A4'
  const pageTitle = req.pageTitle ?? t('PDF export page')

  const pdf = new SchemaPdfDoc(orientation, paper, req, withDoc, pageTitle)
  pdf.setTitle(t('Schema of the %s database').replace('%s', req.db))
  pdf.setCMargin(0)
  pdf.setAutoPageBreak(true)

  const alltables = [...req.tables]
  // sort() / rsort(): byte order
  const cmp = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b))
  if (tableOrder === 'name_asc') alltables.sort(cmp)
  else if (tableOrder === 'name_desc') alltables.sort((a, b) => cmp(b, a))

  if (withDoc) {
    pdf.setAutoPageBreak(true, 15)
    pdf.setCMargin(1)
    dataDictionaryDoc(pdf, req, data, alltables, orientation, paper)
    pdf.setAutoPageBreak(true)
    pdf.setCMargin(0)
  }
  pdf.addPage()
  let topMargin = 10
  let bottomMargin = 10
  const leftMargin = 10
  const rightMargin = 10
  if (withDoc) {
    pdf.setLink(pdf.rtLink, -1)
    pdf.bookmark(t('Relational schema'))
    pdf.setAlias('{00}', String(pdf.pageNo()))
    topMargin = 28
    bottomMargin = 28
  }

  // TableStatsPdf
  const tables = new Map<string, PdfTable>()
  let tablewidth = 0
  let xMax = 0
  let yMax = 0
  let xMin = 100000
  let yMin = 100000
  const make = (name: string): PdfTable => {
    const d = data.get(name) as SchemaTableData
    const fields = shownFields(d, showKeys)
    const { x, y } = coordinatesOf(req, name)
    const heightCell = 6
    const s: PdfTable = {
      name,
      fields,
      primary: d.primary,
      displayField: d.displayField,
      x,
      y,
      width: 0,
      heightCell,
      height: (fields.length + 1) * heightCell,
    }
    for (const f of fields) s.width = Math.max(s.width, pdf.getStringWidth(f))
    s.width += pdf.getStringWidth('      ')
    pdf.setFont('B', null)
    // it is unknown what value must be added, because table title is affected by the table width value
    while (s.width < pdf.getStringWidth(titleOf(name, s.width, s.height, tableDimension))) s.width += 5
    pdf.setFont('', null)
    return s
  }
  for (const name of alltables) {
    let s = tables.get(name)
    if (s === undefined) {
      s = make(name)
      tables.set(name, s)
      tablewidth = Math.max(tablewidth, s.width)
    }
    if (sameWide) s.width = tablewidth
    xMax = Math.max(xMax, s.x + s.width)
    yMax = Math.max(yMax, s.y + s.height)
    xMin = Math.min(xMin, s.x)
    yMin = Math.min(yMin, s.y)
  }

  // Defines the scale factor
  const innerWidth = pdf.getPageWidth() - rightMargin - leftMargin
  const innerHeight = pdf.getPageHeight() - topMargin - bottomMargin
  const scale = Math.ceil(Math.max((xMax - xMin) / innerWidth, (yMax - yMin) / innerHeight) * 100) / 100
  pdf.setScale(scale, xMin, yMin, leftMargin, topMargin)
  // Builds and save the PDF document
  pdf.setLineWidthScale(0.1)

  if (showGrid) {
    pdf.setFontSize(10)
    // strokeGrid
    const gridSize = 10
    const labelHeight = 4
    const labelWidth = 5
    const topSpace = withDoc ? 6 : 0
    const bottomSpace = withDoc ? 15 : 0
    pdf.setMargins(0, 0)
    pdf.setDrawColor(200, 200, 200)
    // Draws horizontal lines
    const gridHeight = pdf.getPageHeight() - topSpace - bottomSpace
    for (let l = 0, size = Math.trunc(gridHeight / gridSize); l <= size; l++) {
      pdf.line(0, l * gridSize + topSpace, pdf.getPageWidth(), l * gridSize + topSpace)
      // Avoid duplicates
      if (l <= 0 || l > Math.trunc((gridHeight - labelHeight) / gridSize)) continue
      pdf.setXY(0, l * gridSize + topSpace)
      pdf.cell(labelWidth, labelHeight, ` ${f0((l * gridSize + topSpace - topMargin) * scale + yMin)}`)
    }
    // Draws vertical lines
    for (let j = 0, size = Math.trunc(pdf.getPageWidth() / gridSize); j <= size; j++) {
      pdf.line(j * gridSize, topSpace, j * gridSize, pdf.getPageHeight() - bottomSpace)
      pdf.setXY(j * gridSize, topSpace)
      pdf.cell(labelWidth, labelHeight, f0((j * gridSize - leftMargin) * scale + xMin))
    }
  }

  pdf.setFontSizeScale(14)
  // previous logic was checking master tables and foreign tables but I think that looping on every
  // table of the pdf page as a master and finding its foreigns is OK (then we can support innodb)
  const rel = relationsOf({ ...req, tables: alltables }, data, false)
  if (rel.seen) {
    // RelationStatsPdf::relationDraw
    const wTick = 5
    const root2 = 2 * Math.sqrt(2)
    rel.list.forEach((r, i) => {
      const m = tables.get(r.master)
      const f = tables.get(r.foreign)
      if (m === undefined || f === undefined) return
      const e = relationEnds(m, r.masterField, f, r.foreignField, wTick)
      if (showColor) {
        const d = i % 6
        let j = (i - d) / 6
        j %= 4
        j++
        const cases: Array<[number, number, number]> = [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [1, 1, 0],
          [1, 0, 1],
          [0, 1, 1],
        ]
        const [a, b, c] = cases[d] as [number, number, number]
        const k = 1 - (j - 1) / 6
        pdf.setDrawColor(a * 255 * k, b * 255 * k, c * 255 * k)
      } else pdf.setDrawColor(0)
      pdf.setLineWidthScale(0.2)
      pdf.lineScale(e.xSrc, e.ySrc, e.xSrc + e.srcDir * wTick, e.ySrc)
      pdf.lineScale(e.xDest + e.destDir * wTick, e.yDest, e.xDest, e.yDest)
      pdf.setLineWidthScale(0.1)
      pdf.lineScale(e.xSrc + e.srcDir * wTick, e.ySrc, e.xDest + e.destDir * wTick, e.yDest)
      // Draws arrows ->
      pdf.lineScale(
        e.xSrc + e.srcDir * wTick * 0.75,
        e.ySrc,
        e.xSrc + e.srcDir * (0.75 - 1 / root2) * wTick,
        e.ySrc + wTick / root2,
      )
      pdf.lineScale(
        e.xSrc + e.srcDir * wTick * 0.75,
        e.ySrc,
        e.xSrc + e.srcDir * (0.75 - 1 / root2) * wTick,
        e.ySrc - wTick / root2,
      )
      pdf.lineScale(
        e.xDest + (e.destDir * wTick) / 2,
        e.yDest,
        e.xDest + e.destDir * (0.5 + 1 / root2) * wTick,
        e.yDest + wTick / root2,
      )
      pdf.lineScale(
        e.xDest + (e.destDir * wTick) / 2,
        e.yDest,
        e.xDest + e.destDir * (0.5 + 1 / root2) * wTick,
        e.yDest - wTick / root2,
      )
      pdf.setDrawColor(0)
    })
  }

  // TableStatsPdf::tableDraw
  for (const s of tables.values()) {
    pdf.setXyScale(s.x, s.y)
    pdf.setFont('B', null)
    if (showColor) {
      pdf.setTextColor(200)
      pdf.setFillColor(0, 0, 128)
    }
    if (withDoc) pdf.setLink(pdf.linkOf('RT', s.name, '-'), -1)
    else pdf.setLinkOf('doc', s.name, '-', '')
    pdf.cellScale(
      s.width,
      s.heightCell,
      titleOf(s.name, s.width, s.height, tableDimension),
      1,
      1,
      'C',
      showColor,
      pdf.linkOf('doc', s.name, '-'),
    )
    pdf.setXScale(s.x)
    pdf.setFont('', null)
    pdf.setTextColor()
    pdf.setFillColor(255)
    for (const field of s.fields) {
      if (showColor) {
        if (s.primary.includes(field)) pdf.setFillColor(215, 121, 123)
        if (field === s.displayField) pdf.setFillColor(142, 159, 224)
      }
      if (withDoc) pdf.setLink(pdf.linkOf('RT', s.name, field), -1)
      else pdf.setLinkOf('doc', s.name, field, '')
      pdf.cellScale(
        s.width,
        s.heightCell,
        ` ${field}`,
        1,
        1,
        'L',
        showColor,
        pdf.linkOf('doc', s.name, field),
      )
      pdf.setXScale(s.x)
      pdf.setFillColor(255)
    }
  }

  const bytes = await pdf.output(req.now ?? new Date())
  return {
    fileName: `${req.fileBase}.pdf`,
    mediaType: 'application/pdf',
    data: Buffer.from(bytes).toString('base64'),
    encoding: 'base64',
  }
}

/** PdfRelationSchema::dataDictionaryDoc: the table of contents and one page per table */
function dataDictionaryDoc(
  pdf: SchemaPdfDoc,
  req: SchemaRequest,
  data: ReadonlyMap<string, SchemaTableData>,
  alltables: string[],
  orientation: 'L' | 'P',
  paper: string,
): void {
  const t = tOf(req)
  const docOf = (table: string) => data.get(table)?.doc
  // TOC
  pdf.addPage()
  pdf.cell(0, 9, t('Table of contents'), 1, 0, 'C')
  pdf.ln(15)
  let i = 1
  for (const table of alltables) {
    pdf.setLinkOf('doc', table, '-', pdf.addLink())
    pdf.setX(10)
    pdf.cell(0, 6, `${t('Page number:')} {${d2(i)}}`, 0, 0, 'R', false, pdf.linkOf('doc', table, '-'))
    pdf.setX(10)
    pdf.cell(0, 6, `${i} ${table}`, 0, 1, 'L', false, pdf.linkOf('doc', table, '-'))
    for (const row of docOf(table)?.columns ?? []) {
      pdf.setX(20)
      pdf.setLinkOf('doc', table, row.field, pdf.addLink())
    }
    i++
  }
  pdf.rtLink = pdf.addLink()
  pdf.setX(10)
  pdf.cell(0, 6, `${t('Page number:')} {00}`, 0, 0, 'R', false, pdf.rtLink)
  pdf.setX(10)
  pdf.cell(0, 6, `${i} ${t('Relational schema')}`, 0, 1, 'L', false, pdf.rtLink)
  let z = 0
  for (const table of alltables) {
    const doc = docOf(table)
    z++
    pdf.setAutoPageBreak(true, 15)
    pdf.addPage()
    pdf.bookmark(table)
    pdf.setAlias(`{${d2(z)}}`, String(pdf.pageNo()))
    pdf.setLinkOf('RT', table, '-', pdf.addLink())
    pdf.setLink(pdf.linkOf('doc', table, '-'), -1)
    pdf.setFont('B', 18)
    pdf.cell(0, 8, `${z} ${table}`, 1, 1, 'C', false, pdf.linkOf('RT', table, '-'))
    pdf.setFont('', 8)
    pdf.ln()

    // Displays the comments of the table if MySQL >= 3.23
    let br = false
    const line = (label: string, value: string) => {
      if (value === '') return
      pdf.cell(0, 3, `${label} ${value}`, 0, 1)
      br = true
    }
    line(t('Table comments:'), doc?.comment ?? '')
    line(t('Creation:'), doc?.createTime ?? '')
    line(t('Last update:'), doc?.updateTime ?? '')
    line(t('Last check:'), doc?.checkTime ?? '')
    if (br) {
      pdf.cell(0, 3, '', 0, 1)
      pdf.ln()
    }

    pdf.setFont('B')
    const heads = [
      t('Column'),
      t('Type'),
      t('Attributes'),
      t('Null'),
      t('Default'),
      t('Extra'),
      t('Links to'),
      t('Comments'),
    ]
    let widths: number[]
    if (orientation === 'L') {
      // this is really intended for 'letter'
      const commentsWidth = paper === 'A4' ? 67 : 50
      widths = [25, 20, 20, 10, 20, 25, 45, commentsWidth, 45]
    } else widths = [20, 20, 20, 10, 15, 15, 30, 30, 30]
    heads.forEach((h, n) => pdf.cell(widths[n] ?? 0, 8, h, 1, 0, 'C'))
    pdf.cell(widths[8] ?? 0, 8, 'MIME', 1, 1, 'C')
    pdf.setWidths(widths)
    pdf.setFont('')

    for (const row of doc?.columns ?? []) {
      const fieldName = row.field
      pdf.setLinkOf('RT', table, fieldName, pdf.addLink())
      pdf.bookmark(fieldName, 1, -1)
      pdf.setLink(pdf.linkOf('doc', table, fieldName), -1)
      const foreigner = doc?.foreigners[fieldName]
      let linksTo = ''
      if (foreigner !== undefined) {
        linksTo = '-> '
        if (foreigner.db !== req.db) linksTo += `${foreigner.db}.`
        linksTo += `${foreigner.table}.${foreigner.field}`
        // not set for internal
        if (foreigner.onUpdate !== undefined) {
          linksTo += `\nON UPDATE ${foreigner.onUpdate}`
          linksTo += `\nON DELETE ${foreigner.onDelete ?? ''}`
        }
      }
      const diagramRow = [
        fieldName,
        row.printType,
        row.attribute,
        row.isNull ? t('Yes') : t('No'),
        row.default ?? (row.isNull ? 'NULL' : ''),
        row.extra,
        linksTo,
        doc?.comments[fieldName] ?? '',
        (doc?.mime?.[fieldName] ?? '').replaceAll('_', '/'),
      ]
      const links: Record<number, Link> = { 0: pdf.linkOf('RT', table, fieldName) }
      if (foreigner !== undefined) {
        const target = pdf.customLinks.doc[foreigner.table]?.[foreigner.field]
        if (target !== undefined) links[6] = target
      }
      pdf.row(diagramRow, links)
    }
    pdf.setFont('', 14)
  }
}

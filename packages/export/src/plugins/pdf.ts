import { localisedDate } from '@bettermyadmin/i18n'
import { extractColumnSpec } from '@bettermyadmin/mysql-types'
import { type Align, PdfCreationFailure, PmaPdf } from '@bettermyadmin/pdf'
import { decodeBytes } from '../bytes.ts'
import type { ExportField, ExportResult } from '../dbi.ts'
import { ExportError } from '../errors.ts'
import type { Params } from '../params.ts'
import { type Aliases, ExportPlugin, type ExportSettings, foreignersEmpty } from '../plugin.ts'
import { type PluginProperties, main, radio, textItem } from '../properties.ts'
import type { TableInfo } from '../tables.ts'
import { structureValues } from './text.ts'

/** The labels the report prints (translated by the plugin). */
interface ReportLabels {
  database: string
  table: string
  purpose: string
}

/**
 * The PDF report: page header with the title, "Database: …, Table: …, Purpose: …" and the grey
 * column-title band; tables drawn row by row across pages with MultiCell, the grid drawn per page.
 * Adapted from a LGPL script by Philip Clarke.
 * pma: src/Plugins/Export/Helpers/Pdf.php
 */
export class PdfReport extends PmaPdf {
  /** sparse, keyed by column index like the PHP arrays (a hidden column has no title) */
  tablewidths: Record<number, number> = {}
  colTitles: Record<number, string | null> = {}
  colAlign: Record<number, Align> = {}
  displayColumn: Record<number, boolean> = {}
  readonly headerset = new Set<number>()
  dataY = 0
  titleFontSize = 0
  titleText = ''
  dbAlias = ''
  tableAlias = ''
  purpose = ''
  currentDb = ''
  currentTable = ''
  aliases: Aliases = {}
  labels: ReportLabels = { database: 'Database:', table: 'Table:', purpose: 'Purpose:' }

  /** checkPageBreak: on a new page the rows continue below the header (dataY) */
  protected override checkPageBreak(h = 0, y: number | null = null, addPage = true): boolean {
    const yy = y ?? this.y
    const currentPage = this.page
    if (yy + h > this.pageBreakTrigger && !this.inFooter && this.acceptPageBreak()) {
      if (addPage) {
        // Automatic page break
        const x = this.x
        this.addPage()
        this.y = this.dataY
        const now = this.pages[this.page - 1]
        const old = this.pages[this.page - 2]
        this.x = now !== undefined && old !== undefined && now.olm !== old.olm ? x + now.olm - old.olm : x
      }
      return true
    }
    // account for columns mode
    return currentPage !== this.page
  }

  /** This method is used to render the page header. */
  protected override header(): void {
    let maxY = 0
    // We don't want automatic page breaks while generating header as this can lead to infinite
    // recursion as auto generated page will want header as well causing another page break
    this.setAutoPageBreak(false)
    // Check if header for this page already exists
    if (!this.headerset.has(this.page)) {
      this.setY(this.tMargin - (this.fontSizePt / this.k) * 5)
      const cellFontSize = this.fontSizePt
      this.setFont('', this.titleFontSize !== 0 ? this.titleFontSize : this.fontSizePt)
      this.cell(0, this.fontSizePt, this.titleText, 0, 1, 'C')
      this.setFont('', cellFontSize)
      this.setY(this.tMargin - (this.fontSizePt / this.k) * 2.5)
      this.cell(
        0,
        this.fontSizePt,
        `${this.labels.database} ${this.dbAlias},  ${this.labels.table} ${this.tableAlias},  ${this.labels.purpose} ${this.purpose}`,
        0,
        1,
        'L',
      )
      let l = this.lMargin
      for (const [col, txt] of Object.entries(this.colTitles)) {
        const w = this.tablewidths[Number(col)] ?? 0
        this.setXY(l, this.tMargin)
        this.multiCell(w, this.fontSizePt, txt ?? 'NULL')
        l += w
        maxY = Math.max(maxY, this.getY())
      }
      this.setXY(this.lMargin, this.tMargin)
      this.setFillColor(200, 200, 200)
      l = this.lMargin
      for (const [col, txt] of Object.entries(this.colTitles)) {
        const w = this.tablewidths[Number(col)] ?? 0
        this.setXY(l, this.tMargin)
        this.cell(w, maxY - this.tMargin, '', 1, 0, 'L', true)
        this.setXY(l, this.tMargin)
        this.multiCell(w, this.fontSizePt, txt ?? 'NULL', 'C')
        l += w
      }
      this.setFillColor(255, 255, 255)
      // set headerset
      this.headerset.add(this.page)
    }
    this.dataY = maxY
    this.setAutoPageBreak(true)
  }

  /**
   * The rows of a table (each a list of cells, null for NULL), across pages: the horizontal line
   * above each row, the cells, then the vertical lines of every page used.
   * pma: Pdf::morepagestable, getTriggers, getTableDef (their common loop)
   */
  async #table(
    rows: AsyncIterable<Array<string | null>> | Iterable<Array<string | null>>,
    lineheight: number,
    cellText: (txt: string | null, col: number) => string = (txt) => txt ?? 'NULL',
  ): Promise<void> {
    // some things to set and 'remember'
    let l = this.lMargin
    const startheight = this.dataY
    let h = startheight
    const startpage = this.page
    let currpage = startpage
    // calculate the whole width
    let fullwidth = 0
    for (const width of Object.values(this.tablewidths)) fullwidth += width
    // Now let's start to write the table
    let row = 0
    const tmpheight = new Map<string, number>()
    let maxpage = this.page
    for await (const data of rows) {
      this.page = currpage
      // write the horizontal borders
      this.line(l, h, fullwidth + l, h)
      // write the content and remember the height of the highest col
      data.forEach((txt, col) => {
        this.page = currpage
        this.setXY(l, h)
        const width = this.tablewidths[col]
        if (width !== undefined && width > 0) {
          this.multiCell(width, lineheight, cellText(txt, col), this.colAlign[col] ?? 'L')
          l += width
        }
        const key = `${row}-${this.page}`
        if ((tmpheight.get(key) ?? 0) < this.getY()) tmpheight.set(key, this.getY())
        if (this.page > maxpage) maxpage = this.page
      })
      // get the height we were in the last used page
      h = tmpheight.get(`${row}-${maxpage}`) ?? 0
      // set the "pointer" to the left margin
      l = this.lMargin
      // set the $currpage to the last page
      currpage = maxpage
      row++
    }
    // draw the borders
    // we start adding a horizontal line on the last page
    this.page = maxpage
    this.line(l, h, fullwidth + l, h)
    // now we start at the top of the document and walk down
    for (let i = startpage; i <= maxpage; i++) {
      this.page = i
      l = this.lMargin
      const t = i === startpage ? startheight : this.tMargin
      const lh = i === maxpage ? h : this.h - this.bMargin
      this.line(l, t, l, lh)
      for (const width of Object.values(this.tablewidths)) {
        l += width
        this.line(l, t, l, lh)
      }
    }
    // set it to the last page, if not it'll cause some problems
    this.page = maxpage
  }

  #reset(): void {
    this.tablewidths = {}
    this.colTitles = {}
    this.displayColumn = {}
    this.colAlign = {}
  }

  /** Prints triggers */
  async getTriggers(tables: TableInfo, tr: (s: string) => string, db: string, table: string): Promise<void> {
    const triggers = await tables.getTriggers(db, table)
    // prevents printing blank trigger list for any table
    if (triggers.length === 0) return
    this.#reset()
    // Making table heading, keeping column width constant
    this.colTitles = { 0: tr('Name'), 1: tr('Time'), 2: tr('Event'), 3: tr('Definition') }
    this.tablewidths = { 0: 90, 1: 80, 2: 40, 3: 240 }
    for (let c = 0; c < 4; c++) {
      this.colAlign[c] = 'L'
      this.displayColumn[c] = true
    }
    // Starting to fill table with required info
    this.setY(this.tMargin)
    this.addPage()
    this.setFont('', 9)
    await this.#table(
      triggers.map((t) => [t.name, t.timing, t.event, t.statement]),
      this.fontSizePt,
    )
  }

  /** Print table's CREATE definition */
  async getTableDef(
    plugin: ExportPdf,
    db: string,
    table: string,
    doRelation: boolean,
    doComments: boolean,
    doMime: boolean,
  ): Promise<void> {
    const { ctx } = plugin
    const tr = (s: string) => ctx.tr.gettext(s)
    const rel = ctx.relation
    this.#reset()
    // Gets fields properties
    await ctx.dbi.selectDb(db)
    // Check if we can use Relations
    let haveRel = false
    let foreigners: Awaited<ReturnType<ExportPdf['getForeigners']>> | null = null
    if (doRelation) {
      // Find which tables are related with the current one and write it in an array
      foreigners = await plugin.getForeigners(db, table)
      haveRel = !foreignersEmpty(foreigners)
    }
    // column count and table heading
    this.colTitles = { 0: tr('Column'), 1: tr('Type'), 2: tr('Null'), 3: tr('Default') }
    this.tablewidths = { 0: 90, 1: 80, 2: 40, 3: 120 }
    for (let i = 0; i < 4; i++) {
      this.colAlign[i] = 'L'
      this.displayColumn[i] = true
    }
    // the optional columns follow in order (pma: upstream acbb64ea40 appends them; before it,
    // "Links to" took index 4 without moving the counter and the comments shifted left of their title)
    let next = 4
    const titled = (title: string) => {
      this.colTitles[next] = title
      this.displayColumn[next] = true
      this.colAlign[next] = 'L'
      this.tablewidths[next] = 120
      next++
    }
    if (doRelation && haveRel) titled(tr('Links to'))
    if (doComments) titled(tr('Comments'))
    if (doMime && rel.browserTransformationFeature) titled(tr('Media type'))
    // Starting to fill table with required info
    this.setY(this.tMargin)
    this.addPage()
    this.setFont('', 9)
    // Now let's start to write the table structure
    const comments = doComments ? await ctx.tables.getComments(db, table) : {}
    const mimeMap = doMime && rel.browserTransformationFeature ? await rel.getMime(db, table) : null
    const columns = await ctx.tables.getColumns(db, table)
    const rows = columns.map((column) => {
      const type = extractColumnSpec(column.type).print_type
      const data: string[] = [
        column.field,
        type === '' ? ' ' : type,
        column.isNull ? 'Yes' : 'No',
        column.default ?? (column.isNull ? 'NULL' : ''),
      ]
      const fieldName = column.field
      if (doRelation && haveRel) {
        const f = foreigners?.data[fieldName]
        data.push(f !== undefined ? `${f.foreign_table} (${f.foreign_field})` : '')
      }
      if (doComments) data.push(comments[fieldName] ?? '')
      if (doMime && rel.browserTransformationFeature) data.push(mimeMap?.[fieldName]?.mimetype ?? '')
      return data
    })
    await this.#table(rows, this.fontSizePt)
  }

  /** MySQL report: pass 1 for the column widths, pass 2 prints the rows */
  async mysqlReport(run: (sql: string) => Promise<ExportResult>, query: string): Promise<void> {
    this.#reset()
    // Pass 1 for column widths
    const select = () => run(query)
    let results = await select()
    const fields: ExportField[] = results.fields
    const numFields = fields.length
    // sColWidth = starting col width (an average size width)
    const availableWidth = this.w - this.lMargin - this.rMargin
    const sColWidth = availableWidth / numFields
    let totalTitleWidth = 0
    // loop through results header and set initial col widths/ titles/ alignment; if a col title
    // is less than the starting col width, reduce that column size
    const colFits = new Map<number, number>()
    const titleWidth: number[] = []
    for (let i = 0; i < numFields; i++) {
      const f = fields[i] as ExportField
      let colAs = f.name
      const alias = this.aliases[this.currentDb]?.tables?.[this.currentTable]?.columns?.[colAs]
      if (alias !== undefined && alias !== '' && alias !== '0') colAs = alias
      const stringWidth = this.getStringWidth(colAs) + 6
      // save the real title's width
      titleWidth[i] = stringWidth
      totalTitleWidth += stringWidth
      // set any column titles less than the start width to the column title width
      if (stringWidth < sColWidth) colFits.set(i, stringWidth)
      this.colTitles[i] = colAs
      this.displayColumn[i] = true
      this.colAlign[i] = f.mappedType === 'int' ? 'R' : 'L'
      if (f.mappedType !== 'blob') continue
      // do not deactivate completely the display but show the field's name and [BLOB]
      if (f.isBinary) {
        this.displayColumn[i] = false
        delete this.colTitles[i]
      }
      this.colAlign[i] = 'L'
    }
    // title width verification
    const adjustingMode = totalTitleWidth > availableWidth
    // we have enough space for all the titles at their original width so use the true title's width
    if (!adjustingMode) titleWidth.forEach((val, key) => colFits.set(key, val))
    // loop through the data; any column whose contents is greater than the column size is resized
    for await (const row of results.rows) {
      for (const [key, val] of [...colFits]) {
        const stringWidth = this.getStringWidth(row[key] ?? 'NULL') + 6
        if (adjustingMode && stringWidth > sColWidth) {
          // any column whose data's width is bigger than the start width is now discarded
          colFits.delete(key)
        } else if (stringWidth > val && stringWidth < sColWidth * 3) {
          // if data's width is bigger than the current column width, enlarge the column (but
          // avoid enlarging it if the data's width is very big)
          colFits.set(key, stringWidth)
        }
      }
    }
    let totAlreadyFitted = 0
    for (const [key, val] of colFits) {
      // set fitted columns to smallest size
      this.tablewidths[key] = val
      // to work out how much (if any) space has been freed up
      totAlreadyFitted += val
    }
    const surplusToAdd = adjustingMode
      ? (colFits.size * sColWidth - totAlreadyFitted) / (numFields - colFits.size)
      : 0
    for (let i = 0; i < numFields; i++) {
      if (!colFits.has(i)) this.tablewidths[i] = sColWidth + surplusToAdd
      if (this.displayColumn[i] === true) continue
      this.tablewidths[i] = 0
    }
    // Pass 2
    results = await select()
    this.setY(this.tMargin)
    this.addPage()
    this.setFont('', 9)
    await this.#table(results.rows, this.fontSizePt, (txt, col) => {
      const f = fields[col]
      let t = txt
      if (t !== null && f !== undefined) {
        if (f.mappedType === 'geometry') t = '[GEOMETRY]'
        if (f.mappedType === 'blob' || f.isBinary) t = '[BLOB]'
      }
      return t ?? 'NULL'
    })
  }
}

/**
 * Produce a PDF report (export) from a query.
 * pma: src/Plugins/Export/ExportPdf.php
 */
export class ExportPdf extends ExportPlugin {
  pdf: PdfReport | null = null
  /** PDF Report Title */
  pdfReportTitle = ''
  doRelation = false
  doMime = false

  get name(): string {
    return 'pdf'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'pdf',
      text: 'PDF',
      extension: 'pdf',
      mimeType: 'application/pdf',
      forceFile: true,
      options: [
        main('pdf_general_opts', '', [textItem('pdf_report_title', __('Report title:'))]),
        main('pdf_dump_what', __('Dump table'), [radio('pdf_structure_or_data', '', structureValues(__))]),
      ],
    }
  }

  #report(): PdfReport {
    if (this.pdf === null) throw new Error('ExportPdf: setExportOptions() was not called')
    return this.pdf
  }

  /** Outputs export footer: the whole document */
  override async exportFooter(): Promise<void> {
    let bytes: Uint8Array
    try {
      bytes = await this.#report().output(this.ctx.now)
    } catch (e) {
      // Pdf::Error: "Error while creating PDF: …" ends the export with that message
      if (e instanceof PdfCreationFailure) throw new ExportError(e.message)
      throw e
    }
    await this.addLine(decodeBytes(bytes))
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const pdf = this.#report()
    pdf.currentDb = db
    pdf.currentTable = table
    pdf.dbAlias = this.getDbAlias(aliases, db)
    pdf.tableAlias = this.getTableAlias(aliases, db, table)
    pdf.aliases = aliases
    pdf.purpose = this.__('Dumping data')
    await pdf.mysqlReport((sql) => this.query(sql), sqlQuery)
  }

  /** Outputs result of raw query in PDF format */
  override async exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    const pdf = this.#report()
    pdf.dbAlias = '----'
    pdf.tableAlias = '----'
    pdf.purpose = this.__('Query result data')
    if (db !== '') {
      pdf.currentDb = db
      await this.ctx.dbi.selectDb(db)
    }
    await pdf.mysqlReport((sql) => this.query(sql), sqlQuery)
  }

  override async exportStructure(
    db: string,
    table: string,
    exportMode: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const pdf = this.#report()
    // getting purpose to show at top
    let purpose = ''
    switch (exportMode) {
      case 'create_table':
        purpose = this.__('Table structure')
        break
      case 'triggers':
        purpose = this.__('Triggers')
        break
      case 'create_view':
        purpose = this.__('View structure')
        break
      case 'stand_in':
        purpose = this.__('Stand in')
    }
    pdf.currentDb = db
    pdf.currentTable = table
    pdf.dbAlias = this.getDbAlias(aliases, db)
    pdf.tableAlias = this.getTableAlias(aliases, db, table)
    pdf.aliases = aliases
    pdf.purpose = purpose
    if (exportMode === 'create_table' || exportMode === 'create_view') {
      await pdf.getTableDef(this, db, table, this.doRelation, true, this.doMime)
    } else if (exportMode === 'triggers') {
      await pdf.getTriggers(this.ctx.tables, (s) => this.__(s), db, table)
    }
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.pdfReportTitle = request.get('pdf_report_title') ?? ''
    const { ctx } = this
    this.pdf = new PdfReport('L', 'pt', 'A3', {
      author: `${ctx.tool.name} ${ctx.tool.version}`,
      pageNumberLabel: this.__('Page number:'),
      errorLabel: this.__('Error while creating PDF:'),
      date: localisedDate(ctx.tr, Math.floor(ctx.now.getTime() / 1000), '', ctx.timeZone),
    })
    this.pdf.labels = {
      database: this.__('Database:'),
      table: this.__('Table:'),
      purpose: this.__('Purpose:'),
    }
    this.structureOrData = this.setStructureOrData(
      request.get('pdf_structure_or_data'),
      cfg.pdf_structure_or_data,
      'data',
    )
    this.doRelation = request.has('pdf_relation')
    this.doMime = request.has('pdf_mime')
    // setupExportConfiguration
    this.pdf.titleFontSize = 18
    this.pdf.titleText = this.pdfReportTitle
    this.pdf.setTopMargin(30)
  }
}

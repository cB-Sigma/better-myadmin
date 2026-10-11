import { extractColumnSpec } from '@bettermyadmin/mysql-types'
import { decodeBytes, encodeBytes, hexBytes, htmlspecialchars } from '../bytes.ts'
import type { Params } from '../params.ts'
import {
  type Aliases,
  ExportPlugin,
  type ExportSettings,
  type Foreigners,
  foreignersEmpty,
} from '../plugin.ts'
import {
  type OptionMainGroup,
  type PluginProperties,
  boolItem,
  hidden,
  main,
  radio,
  textItem,
} from '../properties.ts'
import type { Column } from '../tables.ts'
import { createZip } from '../zip.ts'
import { structureValues } from './text.ts'

/** pma: src/OpenDocument.php::NS (a heredoc: one attribute per line) */
export const ODF_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
].join('\n')

const p2 = (n: number) => String(n).padStart(2, '0')

/** DateTime::format(DATE_W3C) in local time */
function w3c(d: Date): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const a = Math.abs(off)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}`
}

/**
 * Minimalistic creator of OASIS OpenDocument (zip of mimetype, content.xml, meta.xml, styles.xml,
 * META-INF/manifest.xml).
 * pma: src/OpenDocument.php::create
 */
export function createOpenDocument(
  mime: string,
  data: string,
  tool: { name: string; version: string },
  now: Date,
): Buffer {
  const files = [
    mime,
    data,
    `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.0"><office:meta><meta:generator>${tool.name} ${tool.version}</meta:generator><meta:initial-creator>${tool.name} ${tool.version}</meta:initial-creator><meta:creation-date>${w3c(now)}</meta:creation-date></office:meta></office:document-meta>`,
    `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ODF_NS} office:version="1.0"><office:font-face-decls><style:font-face style:name="Arial Unicode MS" svg:font-family="'Arial Unicode MS'" style:font-pitch="variable"/><style:font-face style:name="DejaVu Sans1" svg:font-family="'DejaVu Sans'" style:font-pitch="variable"/><style:font-face style:name="HG Mincho Light J" svg:font-family="'HG Mincho Light J'" style:font-pitch="variable"/><style:font-face style:name="DejaVu Serif" svg:font-family="'DejaVu Serif'" style:font-family-generic="roman" style:font-pitch="variable"/><style:font-face style:name="Thorndale" svg:font-family="Thorndale" style:font-family-generic="roman" style:font-pitch="variable"/><style:font-face style:name="DejaVu Sans" svg:font-family="'DejaVu Sans'" style:font-family-generic="swiss" style:font-pitch="variable"/></office:font-face-decls><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:hyphenation-ladder-count="no-limit" style:text-autospace="ideograph-alpha" style:punctuation-wrap="hanging" style:line-break="strict" style:tab-stop-distance="0.4925in" style:writing-mode="page"/><style:text-properties style:use-window-font-color="true" style:font-name="DejaVu Serif" fo:font-size="12pt" fo:language="en" fo:country="US" style:font-name-asian="DejaVu Sans1" style:font-size-asian="12pt" style:language-asian="none" style:country-asian="none" style:font-name-complex="DejaVu Sans1" style:font-size-complex="12pt" style:language-complex="none" style:country-complex="none" fo:hyphenate="false" fo:hyphenation-remain-char-count="2" fo:hyphenation-push-char-count="2"/></style:default-style><style:style style:name="Standard" style:family="paragraph" style:class="text"/><style:style style:name="Text_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0.0835in"/></style:style><style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text_body" style:class="text"><style:paragraph-properties fo:margin-top="0.1665in" fo:margin-bottom="0.0835in" fo:keep-with-next="always"/><style:text-properties style:font-name="DejaVu Sans" fo:font-size="14pt" style:font-name-asian="DejaVu Sans1" style:font-size-asian="14pt" style:font-name-complex="DejaVu Sans1" style:font-size-complex="14pt"/></style:style><style:style style:name="Heading_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_body" style:class="text" style:default-outline-level="1"><style:text-properties style:font-name="Thorndale" fo:font-size="24pt" fo:font-weight="bold" style:font-name-asian="HG Mincho Light J" style:font-size-asian="24pt" style:font-weight-asian="bold" style:font-name-complex="Arial Unicode MS" style:font-size-complex="24pt" style:font-weight-complex="bold"/></style:style><style:style style:name="Heading_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_body" style:class="text" style:default-outline-level="2"><style:text-properties style:font-name="DejaVu Serif" fo:font-size="18pt" fo:font-weight="bold" style:font-name-asian="DejaVu Sans1" style:font-size-asian="18pt" style:font-weight-asian="bold" style:font-name-complex="DejaVu Sans1" style:font-size-complex="18pt" style:font-weight-complex="bold"/></style:style></office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="8.2673in" fo:page-height="11.6925in" style:num-format="1" style:print-orientation="portrait" fo:margin-top="1in" fo:margin-bottom="1in" fo:margin-left="1.25in" fo:margin-right="1.25in" style:writing-mode="lr-tb" style:footnote-max-height="0in"><style:footnote-sep style:width="0.0071in" style:distance-before-sep="0.0398in" style:distance-after-sep="0.0398in" style:adjustment="left" style:rel-width="25%" style:color="#000000"/></style:page-layout-properties><style:header-style/><style:footer-style/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`,
    `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:media-type="${mime}" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="meta.xml"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml"/></manifest:manifest>`,
  ]
  const names = ['mimetype', 'content.xml', 'meta.xml', 'styles.xml', 'META-INF/manifest.xml']
  return createZip(new Map(files.map((f, i) => [String(i), encodeBytes(f)])), names, now)
}

/** PHP strtotime() of a MySQL DATE / TIME / DATETIME value (false → 0), in UTC */
export function mysqlStrtotime(s: string, now: Date): number {
  const date = /^(-?\d{1,4})-(\d{1,2})-(\d{1,2})/.exec(s)
  const time = /(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(s)
  if (date === null && time === null) return 0
  if (time !== null && Number(time[1]) > 24) return 0
  const d = new Date(0)
  if (date !== null) d.setUTCFullYear(Number(date[1]), Number(date[2]) - 1, Number(date[3]))
  else d.setUTCFullYear(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (date !== null && time === null && s.length > (date[0] as string).length) return 0
  d.setUTCHours(
    time === null ? 0 : Number(time[1]),
    time === null ? 0 : Number(time[2]),
    time?.[3] === undefined ? 0 : Number(time[3]),
    0,
  )
  return d.getTime() / 1000
}

function phpDate(format: 'Y-m-d' | 'PT' | 'Y-m-d\\TH:i:s', epoch: number): string {
  const d = new Date(epoch * 1000)
  const y = d.getUTCFullYear()
  const Y = y < 0 ? `-${String(-y).padStart(4, '0')}` : String(y).padStart(4, '0')
  const ymd = `${Y}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
  const hms = [p2(d.getUTCHours()), p2(d.getUTCMinutes()), p2(d.getUTCSeconds())]
  if (format === 'Y-m-d') return ymd
  if (format === 'PT') return `PT${hms[0]}H${hms[1]}M${hms[2]}S`
  return `${ymd}T${hms.join(':')}`
}

const cell = (value: string) =>
  `<table:table-cell office:value-type="string"><text:p>${value}</text:p></table:table-cell>`

/**
 * Handles the export for the ODS class.
 * pma: src/Plugins/Export/ExportOds.php
 */
export class ExportOds extends ExportPlugin {
  buffer = ''
  columns = false
  null = ''

  get name(): string {
    return 'ods'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'ods',
      text: 'OpenDocument Spreadsheet',
      extension: 'ods',
      mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
      forceFile: true,
      options: [
        main('ods_general_opts', '', [
          textItem('ods_null', __('Replace NULL with:')),
          boolItem('ods_columns', __('Put columns names in the first row')),
          hidden('ods_structure_or_data'),
        ]),
      ],
    }
  }

  override async exportHeader(): Promise<void> {
    this.buffer += `<?xml version="1.0" encoding="utf-8"?><office:document-content ${ODF_NS} office:version="1.0"><office:automatic-styles><number:date-style style:name="N37" number:automatic-order="true"><number:month number:style="long"/><number:text>/</number:text><number:day number:style="long"/><number:text>/</number:text><number:year/></number:date-style><number:time-style style:name="N43"><number:hours number:style="long"/><number:text>:</number:text><number:minutes number:style="long"/><number:text>:</number:text><number:seconds number:style="long"/><number:text> </number:text><number:am-pm/></number:time-style><number:date-style style:name="N50" number:automatic-order="true" number:format-source="language"><number:month/><number:text>/</number:text><number:day/><number:text>/</number:text><number:year/><number:text> </number:text><number:hours number:style="long"/><number:text>:</number:text><number:minutes number:style="long"/><number:text> </number:text><number:am-pm/></number:date-style><style:style style:name="DateCell" style:family="table-cell" style:parent-style-name="Default" style:data-style-name="N37"/><style:style style:name="TimeCell" style:family="table-cell" style:parent-style-name="Default" style:data-style-name="N43"/><style:style style:name="DateTimeCell" style:family="table-cell" style:parent-style-name="Default" style:data-style-name="N50"/></office:automatic-styles><office:body><office:spreadsheet>`
  }

  override async exportFooter(): Promise<void> {
    this.buffer += '</office:spreadsheet></office:body></office:document-content>'
    const zip = createOpenDocument(
      'application/vnd.oasis.opendocument.spreadsheet',
      this.buffer,
      this.ctx.tool,
      this.ctx.now,
    )
    await this.addLine(decodeBytes(zip))
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    const result = await this.query(sqlQuery)
    const fieldsMeta = result.fields
    this.buffer += `<table:table table:name="${htmlspecialchars(tableAlias)}">`
    if (this.columns) {
      this.buffer += '<table:table-row>'
      for (const f of fieldsMeta)
        this.buffer += cell(htmlspecialchars(this.getColumnAlias(aliases, db, table, f.name)))
      this.buffer += '</table:table-row>'
    }
    for await (const row of result.rows) {
      this.buffer += '<table:table-row>'
      row.forEach((field0, j) => {
        const f = fieldsMeta[j]
        let field = field0
        // export GIS types as hex (hexBytes(null) is '')
        if (f?.isMappedTypeGeometry === true) field = `0x${field === null ? '' : hexBytes(field)}`
        if (field === null) this.buffer += cell(htmlspecialchars(this.null))
        else if (f?.isBinary === true && f.isBlob) this.buffer += cell('')
        else if (f?.mappedType === 'date') {
          this.buffer += `<table:table-cell office:value-type="date" office:date-value="${phpDate('Y-m-d', mysqlStrtotime(field, this.ctx.now))}" table:style-name="DateCell"><text:p>${htmlspecialchars(field)}</text:p></table:table-cell>`
        } else if (f?.mappedType === 'time') {
          this.buffer += `<table:table-cell office:value-type="time" office:time-value="${phpDate('PT', mysqlStrtotime(field, this.ctx.now))}" table:style-name="TimeCell"><text:p>${htmlspecialchars(field)}</text:p></table:table-cell>`
        } else if (f?.mappedType === 'datetime') {
          this.buffer += `<table:table-cell office:value-type="date" office:date-value="${phpDate('Y-m-d\\TH:i:s', mysqlStrtotime(field, this.ctx.now))}" table:style-name="DateTimeCell"><text:p>${htmlspecialchars(field)}</text:p></table:table-cell>`
        } else if (f?.isNumeric === true) {
          this.buffer += `<table:table-cell office:value-type="float" office:value="${field}" ><text:p>${htmlspecialchars(field)}</text:p></table:table-cell>`
        } else this.buffer += cell(htmlspecialchars(field))
      })
      this.buffer += '</table:table-row>'
    }
    this.buffer += '</table:table>'
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('ods_structure_or_data'),
      cfg.ods_structure_or_data,
      'data',
    )
    this.columns = request.has('ods_columns')
    this.null = this.stringValue(request.get('ods_null'), cfg.ods_null)
  }
}

const H2 = '<text:h text:outline-level="2" text:style-name="Heading_2" text:is-list-header="true">'

/**
 * Handles the export for the ODT class.
 * pma: src/Plugins/Export/ExportOdt.php
 */
export class ExportOdt extends ExportPlugin {
  buffer = ''
  columns = false
  doComments = false
  doMime = false
  doRelation = false
  null = ''

  get name(): string {
    return 'odt'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    const hideStructure = this.ctx.exportType === 'table' && !this.ctx.singleTable
    const groups: OptionMainGroup[] = [
      main('odt_general_opts', __('Dump table'), [radio('odt_structure_or_data', '', structureValues(__))]),
    ]
    if (!hideStructure) {
      const items = []
      if (this.ctx.relation.relationFeature)
        items.push(boolItem('odt_relation', __('Display foreign key relationships')))
      items.push(boolItem('odt_comments', __('Display comments')))
      if (this.ctx.relation.browserTransformationFeature)
        items.push(boolItem('odt_mime', __('Display media types')))
      groups.push(main('odt_structure', __('Object creation options'), items))
    }
    groups.push(
      main('odt_data', __('Data dump options'), [
        boolItem('odt_columns', __('Put columns names in the first row')),
        textItem('odt_null', __('Replace NULL with:')),
      ]),
    )
    return {
      name: 'odt',
      text: 'OpenDocument Text',
      extension: 'odt',
      mimeType: 'application/vnd.oasis.opendocument.text',
      forceFile: true,
      options: groups,
    }
  }

  override async exportHeader(): Promise<void> {
    this.buffer += `<?xml version="1.0" encoding="utf-8"?><office:document-content ${ODF_NS} office:version="1.0"><office:body><office:text>`
  }

  override async exportFooter(): Promise<void> {
    this.buffer += '</office:text></office:body></office:document-content>'
    const zip = createOpenDocument(
      'application/vnd.oasis.opendocument.text',
      this.buffer,
      this.ctx.tool,
      this.ctx.now,
    )
    await this.addLine(decodeBytes(zip))
  }

  override async exportDBHeader(db: string, dbAlias0 = ''): Promise<void> {
    const dbAlias = dbAlias0 === '' ? db : dbAlias0
    this.buffer += `<text:h text:outline-level="1" text:style-name="Heading_1" text:is-list-header="true">${this.__('Database')} ${htmlspecialchars(dbAlias)}</text:h>`
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    const result = await this.query(sqlQuery)
    const fieldsMeta = result.fields
    this.buffer += H2
    this.buffer +=
      tableAlias !== ''
        ? `${this.__('Dumping data for table')} ${htmlspecialchars(tableAlias)}`
        : this.__('Dumping data for query result')
    this.buffer += `</text:h><table:table table:name="${htmlspecialchars(tableAlias)}_structure"><table:table-column table:number-columns-repeated="${fieldsMeta.length}"/>`
    if (this.columns) {
      this.buffer += '<table:table-row>'
      for (const f of fieldsMeta)
        this.buffer += cell(htmlspecialchars(this.getColumnAlias(aliases, db, table, f.name)))
      this.buffer += '</table:table-row>'
    }
    for await (const row of result.rows) {
      this.buffer += '<table:table-row>'
      row.forEach((field0, j) => {
        const f = fieldsMeta[j]
        let field = field0
        if (f?.isMappedTypeGeometry === true) field = `0x${field === null ? '' : hexBytes(field)}`
        if (field === null) this.buffer += cell(htmlspecialchars(this.null))
        else if (f?.isBinary === true && f.isBlob) this.buffer += cell('')
        else if (f?.isNumeric === true) {
          this.buffer += `<table:table-cell office:value-type="float" office:value="${field}" ><text:p>${htmlspecialchars(field)}</text:p></table:table-cell>`
        } else this.buffer += cell(htmlspecialchars(field))
      })
      this.buffer += '</table:table-row>'
    }
    this.buffer += '</table:table>'
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  #head(): string {
    return `<table:table-row>${cell(this.__('Column'))}${cell(this.__('Type'))}${cell(this.__('Null'))}${cell(this.__('Default'))}`
  }

  async getTableDefStandIn(db: string, view: string, aliases: Aliases = {}): Promise<string> {
    const viewAlias = this.getTableAlias(aliases, db, view)
    await this.ctx.dbi.selectDb(db)
    this.buffer += `<table:table table:name="${htmlspecialchars(viewAlias)}_data"><table:table-column table:number-columns-repeated="4"/>${this.#head()}</table:table-row>`
    for (const column of await this.ctx.tables.getColumns(db, view)) {
      this.buffer += `${this.formatOneColumnDefinition(column, this.getColumnAlias(aliases, db, view, column.field))}</table:table-row>`
    }
    this.buffer += '</table:table>'
    return ''
  }

  async getTableDef(db: string, table: string, aliases: Aliases = {}): Promise<boolean> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    const rel = this.ctx.relation
    await this.ctx.dbi.selectDb(db)
    const foreigners: Foreigners | null =
      this.doRelation && rel.relationFeature ? await this.getForeigners(db, table) : null
    const showRel = this.doRelation && foreigners !== null && !foreignersEmpty(foreigners)
    this.buffer += `<table:table table:name="${htmlspecialchars(tableAlias)}_structure">`
    let columnsCnt = 4
    if (showRel) columnsCnt++
    if (this.doComments) columnsCnt++
    if (this.doMime && rel.browserTransformationFeature) columnsCnt++
    this.buffer += `<table:table-column table:number-columns-repeated="${columnsCnt}"/>${this.#head()}`
    if (showRel) this.buffer += cell(this.__('Links to'))
    let comments: Record<string, string> = {}
    if (this.doComments) {
      this.buffer += cell(this.__('Comments'))
      comments = await this.ctx.tables.getComments(db, table)
    }
    let mimeMap: Record<string, { mimetype: string }> | null = null
    if (this.doMime && rel.browserTransformationFeature) {
      this.buffer += cell(this.__('Media type'))
      mimeMap = await rel.getMime(db, table)
    }
    this.buffer += '</table:table-row>'
    for (const column of await this.ctx.tables.getColumns(db, table)) {
      const fieldName = column.field
      this.buffer += this.formatOneColumnDefinition(
        column,
        this.getColumnAlias(aliases, db, table, column.field),
      )
      if (showRel && foreigners !== null) {
        const foreigner = this.searchColumnInForeigners(foreigners, fieldName)
        if (foreigner !== false) {
          const rtable0 = foreigner.foreign_table
          const rfield = this.getColumnAlias(aliases, db, rtable0, foreigner.foreign_field)
          const rtable = this.getTableAlias(aliases, db, rtable0)
          const relation = htmlspecialchars(`${rtable} (${rfield})`)
          this.buffer += cell(htmlspecialchars(relation))
        }
      }
      if (this.doComments) {
        this.buffer += cell(
          comments[fieldName] !== undefined ? htmlspecialchars(comments[fieldName] as string) : '',
        )
      }
      if (this.doMime && rel.browserTransformationFeature) {
        const m = mimeMap?.[fieldName]
        this.buffer += cell(m !== undefined ? htmlspecialchars(m.mimetype.replaceAll('_', '/')) : '')
      }
      this.buffer += '</table:table-row>'
    }
    this.buffer += '</table:table>'
    return true
  }

  getTriggers(
    table: string,
    triggers: Array<{ name: string; timing: string; event: string; statement: string }>,
  ): string {
    this.buffer += `<table:table table:name="${htmlspecialchars(table)}_triggers"><table:table-column table:number-columns-repeated="4"/><table:table-row>${cell(this.__('Name'))}${cell(this.__('Time'))}${cell(this.__('Event'))}${cell(this.__('Definition'))}</table:table-row>`
    for (const t of triggers) {
      this.buffer += `<table:table-row>${cell(htmlspecialchars(t.name))}${cell(htmlspecialchars(t.timing))}${cell(htmlspecialchars(t.event))}${cell(htmlspecialchars(t.statement))}</table:table-row>`
    }
    this.buffer += '</table:table>'
    return this.buffer
  }

  override async exportStructure(
    db: string,
    table: string,
    exportMode: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    switch (exportMode) {
      case 'create_table':
        this.buffer += `${H2}${this.__('Table structure for table')} ${htmlspecialchars(tableAlias)}</text:h>`
        await this.getTableDef(db, table, aliases)
        break
      case 'triggers': {
        const triggers = await this.ctx.tables.getTriggers(db, table)
        if (triggers.length > 0) {
          this.buffer += `${H2}${this.__('Triggers')} ${htmlspecialchars(tableAlias)}</text:h>`
          this.getTriggers(tableAlias, triggers)
        }
        break
      }
      case 'create_view':
        this.buffer += `${H2}${this.__('Structure for view')} ${htmlspecialchars(tableAlias)}</text:h>`
        await this.getTableDef(db, table, aliases)
        break
      case 'stand_in':
        this.buffer += `${H2}${this.__('Stand-in structure for view')} ${htmlspecialchars(tableAlias)}</text:h>`
        await this.getTableDefStandIn(db, table, aliases)
    }
  }

  formatOneColumnDefinition(column: Column, colAs0 = ''): string {
    const colAs = colAs0 === '' ? column.field : colAs0
    let definition = `<table:table-row>${cell(htmlspecialchars(colAs))}`
    // print_type is escaped once more below (phpMyAdmin double-escapes it)
    let type = htmlspecialchars(extractPrintType(column.type))
    if (type === '') type = '&nbsp;'
    definition += cell(htmlspecialchars(type))
    definition += cell(column.isNull ? this.__('Yes') : this.__('No'))
    definition += cell(htmlspecialchars(column.default ?? (column.isNull ? 'NULL' : '')))
    return definition
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('odt_structure_or_data'),
      cfg.odt_structure_or_data,
      'structure_and_data',
    )
    this.columns = request.has('odt_columns')
    this.doRelation = request.has('odt_relation')
    this.doMime = request.has('odt_mime')
    this.doComments = request.has('odt_comments')
    this.null = this.stringValue(request.get('odt_null'), cfg.odt_null)
  }
}

const extractPrintType = (t: string) => extractColumnSpec(t).print_type

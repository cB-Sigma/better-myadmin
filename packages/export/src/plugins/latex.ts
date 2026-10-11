import { localisedDate } from '@bettermyadmin/i18n'
import { extractColumnSpec } from '@bettermyadmin/mysql-types'
import { bin2hex } from '../bytes.ts'
import { expandUserString } from '../expand.ts'
import type { Params } from '../params.ts'
import {
  type Aliases,
  ExportPlugin,
  type ExportSettings,
  type Foreigners,
  foreignersEmpty,
} from '../plugin.ts'
import {
  type LeafItem,
  type OptionMainGroup,
  type PluginProperties,
  bool,
  main,
  radio,
  textItem,
} from '../properties.ts'
import { structureValues, uniqueKeyColumns } from './text.ts'

/** ExportLatex::texEscape: addcslashes($string, '$%{}&#_^') */
export const texEscape = (s: string): string => s.replace(/[$%{}&#_^]/g, (c) => `\\${c}`)

/**
 * Handles the export for the Latex format.
 * pma: src/Plugins/Export/ExportLatex.php
 */
export class ExportLatex extends ExportPlugin {
  caption = false
  columns = false
  dataCaption = ''
  dataContinuedCaption = ''
  dataLabel = ''
  doComments = false
  doMime = false
  doRelation = false
  null = ''
  structureCaption = ''
  structureContinuedCaption = ''
  structureLabel = ''

  get name(): string {
    return 'latex'
  }

  override getTranslatedText(text: string): string {
    /* Messages used in default captions */
    const messages: Array<[string, string]> = [
      ['strLatexContent', this.__('Content of table @TABLE@')],
      ['strLatexContinued', this.__('(continued)')],
      ['strLatexStructure', this.__('Structure of table @TABLE@')],
    ]
    let out = text
    for (const [k, v] of messages) out = out.replaceAll(k, v)
    return out
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    const hideStructure = this.ctx.exportType === 'table' && !this.ctx.singleTable
    const groups: OptionMainGroup[] = [
      main('latex_general_opts', '', [bool('latex_caption', __('Include table caption'))]),
      main('latex_dump_what', __('Dump table'), [radio('latex_structure_or_data', '', structureValues(__))]),
    ]
    if (!hideStructure) {
      const items: LeafItem[] = [
        textItem('latex_structure_caption', __('Table caption:'), { doc: 'faq6-27' }),
        textItem('latex_structure_continued_caption', __('Table caption (continued):'), { doc: 'faq6-27' }),
        textItem('latex_structure_label', __('Label key:'), { doc: 'faq6-27' }),
      ]
      if (this.ctx.relation.relationFeature)
        items.push(bool('latex_relation', __('Display foreign key relationships')))
      items.push(bool('latex_comments', __('Display comments')))
      if (this.ctx.relation.browserTransformationFeature)
        items.push(bool('latex_mime', __('Display media types')))
      groups.push(main('latex_structure', __('Object creation options'), items))
    }
    groups.push(
      main('latex_data', __('Data dump options'), [
        bool('latex_columns', __('Put columns names in the first row:')),
        textItem('latex_data_caption', __('Table caption:'), { doc: 'faq6-27' }),
        textItem('latex_data_continued_caption', __('Table caption (continued):'), { doc: 'faq6-27' }),
        textItem('latex_data_label', __('Label key:'), { doc: 'faq6-27' }),
        textItem('latex_null', __('Replace NULL with:')),
      ]),
    )
    return {
      name: 'latex',
      text: 'LaTeX',
      extension: 'tex',
      mimeType: 'application/x-tex',
      forceFile: false,
      options: groups,
    }
  }

  override async exportHeader(): Promise<void> {
    const { tool } = this.ctx
    let head = `% ${tool.name} LaTeX Dump\n% version ${tool.version}\n% ${tool.url}\n%\n% ${this.__('Host:')} ${this.ctx.host}`
    if (this.ctx.port !== '' && this.ctx.port !== '0') head += `:${this.ctx.port}`
    head +=
      `\n% ${this.__('Generation Time:')} ${localisedDate(this.ctx.tr, Math.floor(this.ctx.now.getTime() / 1000), '', this.ctx.timeZone)}\n` +
      `% ${this.__('Server version:')} ${this.ctx.dbi.versionString}\n` +
      `% ${tool.runtimeLabel} ${tool.runtime}\n`
    await this.addLine(head)
  }

  override async exportDBHeader(db: string, dbAlias0 = ''): Promise<void> {
    const dbAlias = dbAlias0 === '' ? db : dbAlias0
    await this.addLine(`% \n% ${this.__('Database:')} '${dbAlias}'\n% \n`)
  }

  #expand(s: string, texify: boolean, table: string, database: string): Promise<string> {
    return expandUserString(this.ctx, s, texify ? texEscape : null, { table, database })
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const dbAlias = this.getDbAlias(aliases, db)
    const tableAlias = this.getTableAlias(aliases, db, table)
    const result = await this.query(sqlQuery)
    const fieldsMeta = result.fields
    const columnsCnt = fieldsMeta.length
    const columnsAlias = fieldsMeta.map((f) => this.getColumnAlias(aliases, db, table, f.name))
    let buffer = `\n%\n% ${this.__('Data:')} ${tableAlias}\n%\n \\begin{longtable}{|`
    buffer += 'l|'.repeat(columnsCnt)
    buffer += '} \n'
    buffer += ' \\hline \\endhead \\hline \\endfoot \\hline \n'
    if (this.caption) {
      buffer += ` \\caption{${await this.#expand(this.dataCaption, true, tableAlias, dbAlias)}} \\label{${await this.#expand(this.dataLabel, false, tableAlias, dbAlias)}} \\\\`
    }
    await this.addLine(buffer)
    // show column names
    if (this.columns) {
      buffer = '\\hline '
      for (let i = 0; i < columnsCnt; i++) {
        buffer += `\\multicolumn{1}{|c|}{\\textbf{${texEscape(columnsAlias[i] as string)}}} & `
      }
      buffer = `${[...buffer].slice(0, -2).join('')}\\\\ \\hline \\hline `
      await this.addLine(`${buffer} \\endfirsthead \n`)
      if (this.caption) {
        await this.addLine(
          `\\caption{${await this.#expand(this.dataContinuedCaption, true, tableAlias, dbAlias)}} \\\\ `,
        )
      }
      await this.addLine(`${buffer}\\endhead \\endfoot\n`)
    } else {
      await this.addLine('\\\\ \\hline')
    }
    // print the whole table (fetchAssoc: duplicate column names keep the last value)
    const names = fieldsMeta.map((f) => f.name)
    for await (const row of result.rows) {
      const assoc = new Map<string, string | null>()
      names.forEach((n, i) => assoc.set(n, row[i] ?? null))
      let line = ''
      for (let i = 0; i < columnsCnt; i++) {
        const v = assoc.get(names[i] as string) ?? null
        const f = fieldsMeta[i]
        let columnValue: string
        if (v !== null) {
          columnValue =
            f?.isMappedTypeGeometry === true || f?.isBinary === true
              ? texEscape(`0x${bin2hex(v)}`)
              : texEscape(v)
        } else columnValue = this.null
        // last column ... no need for & character
        line += i === columnsCnt - 1 ? columnValue : `${columnValue} & `
      }
      line += ' \\\\ \\hline \n'
      await this.addLine(line)
    }
    await this.addLine(' \\end{longtable}\n')
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  override async exportStructure(
    db: string,
    table: string,
    exportMode: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const dbAlias = this.getDbAlias(aliases, db)
    const tableAlias = this.getTableAlias(aliases, db, table)
    const rel = this.ctx.relation
    /* We do not export triggers */
    if (exportMode === 'triggers') return
    const uniqueKeys = await uniqueKeyColumns(this, db, table)
    await this.ctx.dbi.selectDb(db)
    // Check if we can use Relations
    const foreigners: Foreigners | null =
      this.doRelation && rel.relationFeature ? await this.getForeigners(db, table) : null
    const showRel = this.doRelation && foreigners !== null && !foreignersEmpty(foreigners)
    await this.addLine(`\n%\n% ${this.__('Structure:')} ${tableAlias}\n%\n \\begin{longtable}{`)
    let alignment = '|l|c|c|c|'
    if (showRel) alignment += 'l|'
    if (this.doComments) alignment += 'l|'
    if (this.doMime && rel.browserTransformationFeature) alignment += 'l|'
    let buffer = `${alignment}} \n`
    let header = ' \\hline '
    header += `\\multicolumn{1}{|c|}{\\textbf{${this.__('Column')}}} & \\multicolumn{1}{|c|}{\\textbf{${this.__('Type')}}} & \\multicolumn{1}{|c|}{\\textbf{${this.__('Null')}}} & \\multicolumn{1}{|c|}{\\textbf{${this.__('Default')}}}`
    if (showRel) header += ` & \\multicolumn{1}{|c|}{\\textbf{${this.__('Links to')}}}`
    let comments: Record<string, string> = {}
    if (this.doComments) {
      header += ` & \\multicolumn{1}{|c|}{\\textbf{${this.__('Comments')}}}`
      comments = await this.ctx.tables.getComments(db, table)
    }
    let mimeMap: Record<string, { mimetype: string }> | null = null
    if (this.doMime && rel.browserTransformationFeature) {
      header += ' & \\multicolumn{1}{|c|}{\\textbf{MIME}}'
      mimeMap = await rel.getMime(db, table)
    }
    // Table caption for first page and label
    if (this.caption) {
      buffer += ` \\caption{${await this.#expand(this.structureCaption, true, tableAlias, dbAlias)}} \\label{${await this.#expand(this.structureLabel, false, tableAlias, dbAlias)}} \\\\\n`
    }
    buffer += `${header} \\\\ \\hline \\hline\n\\endfirsthead\n`
    // Table caption on next pages
    if (this.caption) {
      buffer += ` \\caption{${await this.#expand(this.structureContinuedCaption, true, tableAlias, dbAlias)}} \\\\ \n`
    }
    buffer += `${header} \\\\ \\hline \\hline \\endhead \\endfoot \n`
    await this.addLine(buffer)

    for (const row of await this.ctx.tables.getColumns(db, table)) {
      let type = extractColumnSpec(row.type).print_type
      if (type === '' || type === '0') type = ' '
      const fieldName = row.field
      const colAs = this.getColumnAlias(aliases, db, table, row.field)
      let localBuffer = `${colAs}\0${type}\0${row.isNull ? this.__('Yes') : this.__('No')}\0${row.default ?? (row.isNull ? 'NULL' : '')}`
      if (showRel && foreigners !== null)
        localBuffer += `\0${this.getRelationString(foreigners, fieldName, db, aliases)}`
      if (this.doComments && rel.columnCommentsFeature) localBuffer += `\0${comments[fieldName] ?? ''}`
      if (this.doMime && rel.browserTransformationFeature) {
        localBuffer += '\0'
        const m = mimeMap?.[fieldName]
        if (m !== undefined) localBuffer += m.mimetype.replaceAll('_', '/')
      }
      localBuffer = texEscape(localBuffer)
      if (row.key === 'PRI') {
        const pos = Math.max(0, localBuffer.indexOf('\0'))
        localBuffer = `\\textit{${localBuffer.slice(0, pos)}}${localBuffer.slice(pos)}`
      }
      if (uniqueKeys.includes(fieldName)) {
        const pos = Math.max(0, localBuffer.indexOf('\0'))
        localBuffer = `\\textbf{${localBuffer.slice(0, pos)}}${localBuffer.slice(pos)}`
      }
      await this.addLine(`${localBuffer.replaceAll('\0', ' & ')} \\\\ \\hline \n`)
    }
    await this.addLine(' \\end{longtable}\n')
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('latex_structure_or_data'),
      cfg.latex_structure_or_data,
      'structure_and_data',
    )
    this.caption = request.has('latex_caption')
    this.columns = request.has('latex_columns')
    this.doRelation = request.has('latex_relation')
    this.doMime = request.has('latex_mime')
    this.doComments = request.has('latex_comments')
    this.dataCaption = this.stringValue(request.get('latex_data_caption'), cfg.latex_data_caption)
    this.dataContinuedCaption = this.stringValue(
      request.get('latex_data_continued_caption'),
      cfg.latex_data_continued_caption,
    )
    this.dataLabel = this.stringValue(request.get('latex_data_label'), cfg.latex_data_label)
    this.null = this.stringValue(request.get('latex_null'), cfg.latex_null)
    this.structureCaption = this.stringValue(
      request.get('latex_structure_caption'),
      cfg.latex_structure_caption,
    )
    this.structureContinuedCaption = this.stringValue(
      request.get('latex_structure_continued_caption'),
      cfg.latex_structure_continued_caption,
    )
    this.structureLabel = this.stringValue(request.get('latex_structure_label'), cfg.latex_structure_label)
  }
}

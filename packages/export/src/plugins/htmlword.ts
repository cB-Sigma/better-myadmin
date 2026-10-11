import { extractColumnSpec } from '@bettermyadmin/mysql-types'
import { htmlspecialchars } from '../bytes.ts'
import type { Params } from '../params.ts'
import {
  type Aliases,
  ExportPlugin,
  type ExportSettings,
  type Foreigners,
  foreignersEmpty,
} from '../plugin.ts'
import { type PluginProperties, bool, main, radio, textItem } from '../properties.ts'
import type { Column } from '../tables.ts'
import { structureValues, uniqueKeyColumns } from './text.ts'

const TABLE = '<table width="100%" cellspacing="1">'

/**
 * HTML-Word export code.
 * pma: src/Plugins/Export/ExportHtmlword.php
 */
export class ExportHtmlword extends ExportPlugin {
  columns = false
  doComments = false
  doMime = false
  doRelation = false
  null = ''

  get name(): string {
    return 'htmlword'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'htmlword',
      text: 'Microsoft Word 2000',
      extension: 'doc',
      mimeType: 'application/vnd.ms-word',
      forceFile: true,
      options: [
        main('htmlword_dump_what', __('Dump table'), [
          radio('htmlword_structure_or_data', '', structureValues(__)),
        ]),
        main('htmlword_dump_data_options', __('Data dump options'), [
          textItem('htmlword_null', __('Replace NULL with:')),
          bool('htmlword_columns', __('Put columns names in the first row')),
        ]),
      ],
    }
  }

  override async exportHeader(): Promise<void> {
    await this.addLine(
      `<html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:x="urn:schemas-microsoft-com:office:word"
            xmlns="http://www.w3.org/TR/REC-html40">

            <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
            <html>
            <head>
                <meta http-equiv="Content-type" content="text/html;charset=${this.ctx.charset ?? 'utf-8'}" />
            </head>
            <body>`,
    )
  }

  override async exportFooter(): Promise<void> {
    await this.addLine('</body></html>')
  }

  override async exportDBHeader(db: string, dbAlias0 = ''): Promise<void> {
    const dbAlias = dbAlias0 === '' ? db : dbAlias0
    await this.addLine(`<h1>${this.__('Database')} ${htmlspecialchars(dbAlias)}</h1>`)
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    await this.addLine(`<h2>${this.__('Dumping data for table')} ${htmlspecialchars(tableAlias)}</h2>`)
    await this.addLine(TABLE)
    const result = await this.query(sqlQuery)
    // If required, get fields name at the first line
    if (this.columns) {
      let schemaInsert = '<tr class="print-category">'
      for (const f of result.fields) {
        schemaInsert += `<td class="print"><strong>${htmlspecialchars(this.getColumnAlias(aliases, db, table, f.name))}</strong></td>`
      }
      schemaInsert += '</tr>'
      await this.addLine(schemaInsert)
    }
    // Format the data
    for await (const row of result.rows) {
      let schemaInsert = '<tr class="print-category">'
      for (const field of row)
        schemaInsert += `<td class="print">${htmlspecialchars(field ?? this.null)}</td>`
      schemaInsert += '</tr>'
      await this.addLine(schemaInsert)
    }
    await this.addLine('</table>')
  }

  #head(extra = ''): string {
    return `${TABLE}<tr class="print-category"><th class="print">${this.__('Column')}</th><td class="print"><strong>${this.__('Type')}</strong></td><td class="print"><strong>${this.__('Null')}</strong></td><td class="print"><strong>${this.__('Default')}</strong></td>${extra}`
  }

  async getTableDefStandIn(db: string, view: string, aliases: Aliases = {}): Promise<string> {
    let schemaInsert = `${this.#head()}</tr>`
    const uniqueKeys = await uniqueKeyColumns(this, db, view)
    for (const column of await this.ctx.tables.getColumns(db, view)) {
      schemaInsert += `${this.formatOneColumnDefinition(column, uniqueKeys, this.getColumnAlias(aliases, db, view, column.field))}</tr>`
    }
    return `${schemaInsert}</table>`
  }

  async getTableDef(db: string, table: string, aliases: Aliases = {}): Promise<string> {
    const rel = this.ctx.relation
    await this.ctx.dbi.selectDb(db)
    // Check if we can use Relations
    const foreigners: Foreigners | null =
      this.doRelation && rel.relationFeature ? await this.getForeigners(db, table) : null
    const showRel = this.doRelation && foreigners !== null && !foreignersEmpty(foreigners)
    let extra = ''
    if (showRel) extra += `<td class="print"><strong>${this.__('Links to')}</strong></td>`
    let comments: Record<string, string> = {}
    if (this.doComments) {
      extra += `<td class="print"><strong>${this.__('Comments')}</strong></td>`
      comments = await this.ctx.tables.getComments(db, table)
    }
    let mimeMap: Record<string, { mimetype: string }> | null = null
    if (this.doMime && rel.browserTransformationFeature) {
      extra += `<td class="print"><strong>${this.__('Media type')}</strong></td>`
      mimeMap = await rel.getMime(db, table)
    }
    let schemaInsert = `${this.#head(extra)}</tr>`
    const columns = await this.ctx.tables.getColumns(db, table)
    const uniqueKeys = await uniqueKeyColumns(this, db, table)
    for (const column of columns) {
      schemaInsert += this.formatOneColumnDefinition(
        column,
        uniqueKeys,
        this.getColumnAlias(aliases, db, table, column.field),
      )
      const fieldName = column.field
      if (showRel && foreigners !== null) {
        schemaInsert += `<td class="print">${htmlspecialchars(this.getRelationString(foreigners, fieldName, db, aliases))}</td>`
      }
      if (this.doComments && rel.columnCommentsFeature) {
        schemaInsert += `<td class="print">${comments[fieldName] !== undefined ? htmlspecialchars(comments[fieldName] as string) : ''}</td>`
      }
      if (this.doMime && rel.browserTransformationFeature) {
        const m = mimeMap?.[fieldName]
        schemaInsert += `<td class="print">${m !== undefined ? htmlspecialchars(m.mimetype.replaceAll('_', '/')) : ''}</td>`
      }
      schemaInsert += '</tr>'
    }
    return `${schemaInsert}</table>`
  }

  getTriggers(triggers: Array<{ name: string; timing: string; event: string; statement: string }>): string {
    let dump = `${TABLE}<tr class="print-category"><th class="print">${this.__('Name')}</th><td class="print"><strong>${this.__('Time')}</strong></td><td class="print"><strong>${this.__('Event')}</strong></td><td class="print"><strong>${this.__('Definition')}</strong></td></tr>`
    for (const t of triggers) {
      dump += `<tr class="print-category"><td class="print">${htmlspecialchars(t.name)}</td><td class="print">${htmlspecialchars(t.timing)}</td><td class="print">${htmlspecialchars(t.event)}</td><td class="print">${htmlspecialchars(t.statement)}</td></tr>`
    }
    return `${dump}</table>`
  }

  override async exportStructure(
    db: string,
    table: string,
    exportMode: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    let dump = ''
    switch (exportMode) {
      case 'create_table':
        dump += `<h2>${this.__('Table structure for table')} ${htmlspecialchars(tableAlias)}</h2>`
        dump += await this.getTableDef(db, table, aliases)
        break
      case 'triggers': {
        const triggers = await this.ctx.tables.getTriggers(db, table)
        if (triggers.length > 0) {
          dump += `<h2>${this.__('Triggers')} ${htmlspecialchars(tableAlias)}</h2>`
          dump += this.getTriggers(triggers)
        }
        break
      }
      case 'create_view':
        dump += `<h2>${this.__('Structure for view')} ${htmlspecialchars(tableAlias)}</h2>`
        dump += await this.getTableDef(db, table, aliases)
        break
      case 'stand_in':
        dump += `<h2>${this.__('Stand-in structure for view')} ${htmlspecialchars(tableAlias)}</h2>`
        // export a stand-in definition to resolve view dependencies
        dump += await this.getTableDefStandIn(db, table, aliases)
    }
    await this.addLine(dump)
  }

  formatOneColumnDefinition(column: Column, uniqueKeys: string[], colAlias0 = ''): string {
    const colAlias = colAlias0 === '' ? column.field : colAlias0
    let definition = '<tr class="print-category">'
    let type = htmlspecialchars(extractColumnSpec(column.type).print_type)
    if (type === '') type = '&nbsp;'
    let fmtPre = ''
    let fmtPost = ''
    if (uniqueKeys.includes(column.field)) {
      fmtPre = `<strong>${fmtPre}`
      fmtPost += '</strong>'
    }
    if (column.key === 'PRI') {
      fmtPre = `<em>${fmtPre}`
      fmtPost += '</em>'
    }
    definition += `<td class="print">${fmtPre}${htmlspecialchars(colAlias)}${fmtPost}</td>`
    definition += `<td class="print">${htmlspecialchars(type)}</td>`
    definition += `<td class="print">${column.isNull ? this.__('Yes') : this.__('No')}</td>`
    definition += `<td class="print">${htmlspecialchars(column.default ?? (column.isNull ? 'NULL' : ''))}</td>`
    return definition
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('htmlword_structure_or_data'),
      cfg.htmlword_structure_or_data,
      'structure_and_data',
    )
    this.columns = request.has('htmlword_columns')
    this.doRelation = request.has('htmlword_relation')
    this.doMime = request.has('htmlword_mime')
    this.doComments = request.has('htmlword_comments')
    this.null = this.stringValue(request.get('htmlword_null'), cfg.htmlword_null)
  }
}

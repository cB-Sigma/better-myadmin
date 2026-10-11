import { extractColumnSpec } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import { hexBytes, htmlspecialchars } from '../bytes.ts'
import type { Params } from '../params.ts'
import {
  type Aliases,
  ExportPlugin,
  type ExportSettings,
  type Foreigners,
  foreignersEmpty,
} from '../plugin.ts'
import { type PluginProperties, boolItem, main, radio, subgroup, textItem } from '../properties.ts'
import type { Column } from '../tables.ts'

/** PHP's loose `$key['Non_unique'] != 0` */
const nonUnique = (v: string | null | undefined) => v !== null && v !== undefined && v !== '0' && v !== ''

/** The unique-key columns of a table (getTableIndexes, Non_unique == 0). */
export async function uniqueKeyColumns(p: ExportPlugin, db: string, table: string): Promise<string[]> {
  const keys = await p.ctx.tables.getIndexes(db, table)
  return keys.filter((k) => !nonUnique(k.Non_unique)).map((k) => k.Column_name ?? '')
}

export const structureValues = (__: (s: string) => string): Array<[string, string]> => [
  ['structure', __('structure')],
  ['data', __('data')],
  ['structure_and_data', __('structure and data')],
]

/**
 * Handles the export for the MediaWiki class.
 * pma: src/Plugins/Export/ExportMediawiki.php
 */
export class ExportMediawiki extends ExportPlugin {
  caption = false
  headers = false

  get name(): string {
    return 'mediawiki'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'mediawiki',
      text: 'MediaWiki Table',
      extension: 'mediawiki',
      mimeType: 'text/plain',
      forceFile: false,
      options: [
        main('mediawiki_general_opts', __('Dump table'), [
          subgroup(
            radio('mediawiki_structure_or_data', '', structureValues(__)),
            [],
            'mediawiki_dump_table',
            __('Dump table'),
          ),
          boolItem('mediawiki_caption', __('Export table names')),
          boolItem('mediawiki_headers', __('Export table headers')),
        ]),
      ],
    }
  }

  override async exportStructure(
    db: string,
    table: string,
    exportMode: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    let output = ''
    if (exportMode === 'create_table') {
      const columns = await this.ctx.tables.getColumns(db, table)
      // Print structure comment
      output = this.#exportComment(`Table structure for ${backquote(tableAlias)}`)
      // Begin the table construction
      output += '{| class="wikitable" style="text-align:center;"\n'
      // Add the table name
      if (this.caption) output += `|+'''${tableAlias}'''\n`
      // Add the table headers
      if (this.headers) {
        output += '|- style="background:#ffdead;"\n'
        output += '! style="background:#ffffff" | \n'
        for (const column of columns)
          output += ` | ${this.getColumnAlias(aliases, db, table, column.field)}\n`
      }
      // Add the table structure
      output += '|-\n! Type\n'
      for (const column of columns) output += ` | ${column.type}\n`
      output += '|-\n! Null\n'
      for (const column of columns) output += ` | ${column.isNull ? 'YES' : 'NO'}\n`
      output += '|-\n! Default\n'
      for (const column of columns) output += ` | ${column.default ?? ''}\n`
      output += '|-\n! Extra\n'
      for (const column of columns) output += ` | ${column.extra}\n`
      output += '|}\n\n'
    }
    await this.addLine(output)
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    // Print data comment
    let output = this.#exportComment(
      tableAlias !== '' ? `Table data for ${backquote(tableAlias)}` : 'Query results',
    )
    // Begin the table construction
    output += '{| class="wikitable sortable" style="text-align:center;"\n'
    // Add the table name
    if (this.caption) output += `|+'''${tableAlias}'''\n`
    // Add the table headers
    if (this.headers) {
      // Get column names
      const columnNames = await this.ctx.tables.getColumnNames(db, table)
      // Add column names as table headers
      if (columnNames.length > 0) {
        // Use '|-' for separating rows
        output += '|-\n'
        // Use '!' for separating table headers
        for (const column of columnNames) output += ` ! ${this.getColumnAlias(aliases, db, table, column)}\n`
      }
    }
    // Get the table data from the database
    const result = await this.query(sqlQuery)
    const fieldsMeta = result.fields
    for await (const row of result.rows) {
      output += '|-\n'
      // Use '|' for separating table columns
      fieldsMeta.forEach((f, i) => {
        let v = row[i] ?? null
        if (v === null) v = 'NULL'
        else if (f.isMappedTypeGeometry || f.isBinary) v = `0x${hexBytes(v)}`
        output += ` | ${v}\n`
      })
    }
    // End table construction
    output += '|}\n\n'
    await this.addLine(output)
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  #exportComment(text = ''): string {
    // see https://www.mediawiki.org/wiki/Help:Formatting
    return `\n<!--\n${htmlspecialchars(text)}\n-->\n\n`
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('mediawiki_structure_or_data'),
      cfg.mediawiki_structure_or_data,
      'data',
    )
    this.caption = request.has('mediawiki_caption')
    this.headers = request.has('mediawiki_headers')
  }
}

/**
 * Export to Texy! text.
 * pma: src/Plugins/Export/ExportTexytext.php
 */
export class ExportTexytext extends ExportPlugin {
  columns = false
  doComments = false
  doMime = false
  doRelation = false
  null = ''

  get name(): string {
    return 'texytext'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'texytext',
      text: 'Texy! text',
      extension: 'txt',
      mimeType: 'text/plain',
      forceFile: false,
      options: [
        main('texytext_general_opts', __('Dump table'), [
          radio('texytext_structure_or_data', '', structureValues(__)),
        ]),
        main('texytext_data', __('Data dump options'), [
          boolItem('texytext_columns', __('Put columns names in the first row')),
          textItem('texytext_null', __('Replace NULL with:')),
        ]),
      ],
    }
  }

  override async exportDBHeader(db: string, dbAlias0 = ''): Promise<void> {
    const dbAlias = dbAlias0 === '' ? db : dbAlias0
    await this.addLine(`===${this.__('Database')} ${dbAlias}\n\n`)
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const tableAlias = this.getTableAlias(aliases, db, table)
    await this.addLine(
      tableAlias !== ''
        ? `== ${this.__('Dumping data for table')} ${tableAlias}\n\n`
        : `==${this.__('Dumping data for query result')}\n\n`,
    )
    const result = await this.query(sqlQuery)
    const fieldsMeta = result.fields
    // If required, get fields name at the first line
    if (this.columns) {
      let textOutput = '|------\n'
      for (const f of fieldsMeta)
        textOutput += `|${htmlspecialchars(this.getColumnAlias(aliases, db, table, f.name))}`
      textOutput += '\n|------\n'
      await this.addLine(textOutput)
    }
    // Format the data
    for await (const row of result.rows) {
      let textOutput = ''
      row.forEach((field, j) => {
        let value: string
        if (field === null) value = this.null
        else if (field !== '') {
          value = field
          const f = fieldsMeta[j]
          if (f?.isMappedTypeGeometry === true || f?.isBinary === true) value = `0x${hexBytes(value)}`
        } else value = ' '
        textOutput += `|${htmlspecialchars(value).replaceAll('|', '&#124;')}`
      })
      textOutput += '\n'
      await this.addLine(textOutput)
    }
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  async getTableDefStandIn(db: string, view: string, aliases: Aliases = {}): Promise<string> {
    const uniqueKeys = await uniqueKeyColumns(this, db, view)
    await this.ctx.dbi.selectDb(db)
    let textOutput = `|------\n|${this.__('Column')}|${this.__('Type')}|${this.__('Null')}|${this.__('Default')}\n|------\n`
    for (const column of await this.ctx.tables.getColumns(db, view)) {
      const colAs = this.getColumnAlias(aliases, db, view, column.field)
      textOutput += `${this.formatOneColumnDefinition(column, uniqueKeys, colAs)}\n`
    }
    return textOutput
  }

  async getTableDef(db: string, table: string, aliases: Aliases = {}): Promise<string> {
    const rel = this.ctx.relation
    let textOutput = ''
    const uniqueKeys = await uniqueKeyColumns(this, db, table)
    await this.ctx.dbi.selectDb(db)
    // Check if we can use Relations
    const foreigners: Foreigners | null =
      this.doRelation && rel.relationFeature ? await this.getForeigners(db, table) : null
    textOutput += '|------\n'
    textOutput += `|${this.__('Column')}`
    textOutput += `|${this.__('Type')}`
    textOutput += `|${this.__('Null')}`
    textOutput += `|${this.__('Default')}`
    if (this.doRelation && foreigners !== null && !foreignersEmpty(foreigners))
      textOutput += `|${this.__('Links to')}`
    let comments: Record<string, string> = {}
    if (this.doComments) {
      textOutput += `|${this.__('Comments')}`
      comments = await this.ctx.tables.getComments(db, table)
    }
    let mimeMap: Record<string, { mimetype: string }> | null = null
    if (this.doMime && rel.browserTransformationFeature) {
      textOutput += `|${this.__('Media type')}`
      mimeMap = await rel.getMime(db, table)
    }
    textOutput += '\n|------\n'
    for (const column of await this.ctx.tables.getColumns(db, table)) {
      const colAs = this.getColumnAlias(aliases, db, table, column.field)
      textOutput += this.formatOneColumnDefinition(column, uniqueKeys, colAs)
      const fieldName = column.field
      if (this.doRelation && foreigners !== null && !foreignersEmpty(foreigners)) {
        textOutput += `|${htmlspecialchars(this.getRelationString(foreigners, fieldName, db, aliases))}`
      }
      if (this.doComments && rel.columnCommentsFeature) {
        textOutput += `|${comments[fieldName] !== undefined ? htmlspecialchars(comments[fieldName] as string) : ''}`
      }
      if (this.doMime && rel.browserTransformationFeature) {
        const m = mimeMap?.[fieldName]
        textOutput += `|${m !== undefined ? htmlspecialchars(m.mimetype.replaceAll('_', '/')) : ''}`
      }
      textOutput += '\n'
    }
    return textOutput
  }

  getTriggers(triggers: Array<{ name: string; timing: string; event: string; statement: string }>): string {
    let dump = `|------\n|${this.__('Name')}|${this.__('Time')}|${this.__('Event')}|${this.__('Definition')}\n|------\n`
    for (const t of triggers) {
      dump += `|${t.name}|${t.timing}|${t.event}|${htmlspecialchars(t.statement).replaceAll('|', '&#124;')}\n`
    }
    return dump
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
        dump += `== ${this.__('Table structure for table')} ${tableAlias}\n\n`
        dump += await this.getTableDef(db, table, aliases)
        break
      case 'triggers': {
        const triggers = await this.ctx.tables.getTriggers(db, table)
        if (triggers.length > 0) {
          dump += `== ${this.__('Triggers')} ${tableAlias}\n\n`
          dump += this.getTriggers(triggers)
        }
        break
      }
      case 'create_view':
        dump += `== ${this.__('Structure for view')} ${tableAlias}\n\n`
        dump += await this.getTableDef(db, table, aliases)
        break
      case 'stand_in':
        dump += `== ${this.__('Stand-in structure for view')} ${table}\n\n`
        // export a stand-in definition to resolve view dependencies
        dump += await this.getTableDefStandIn(db, table, aliases)
    }
    await this.addLine(dump)
  }

  formatOneColumnDefinition(column: Column, uniqueKeys: string[], colAlias0 = ''): string {
    const colAlias = colAlias0 === '' ? column.field : colAlias0
    let type = extractColumnSpec(column.type).print_type
    if (type === '' || type === '0') type = '&nbsp;'
    let fmtPre = ''
    let fmtPost = ''
    if (uniqueKeys.includes(column.field)) {
      fmtPre = `**${fmtPre}`
      fmtPost += '**'
    }
    if (column.key === 'PRI') {
      fmtPre = `//${fmtPre}`
      fmtPost += '//'
    }
    let definition = `|${fmtPre}${htmlspecialchars(colAlias)}${fmtPost}`
    definition += `|${htmlspecialchars(type)}`
    definition += `|${column.isNull ? this.__('Yes') : this.__('No')}`
    definition += `|${htmlspecialchars(column.default ?? (column.isNull ? 'NULL' : ''))}`
    return definition
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('texytext_structure_or_data'),
      cfg.texytext_structure_or_data,
      'structure_and_data',
    )
    this.columns = request.has('texytext_columns')
    this.doRelation = request.has('texytext_relation')
    this.doMime = request.has('texytext_mime')
    this.doComments = request.has('texytext_comments')
    this.null = this.stringValue(request.get('texytext_null'), cfg.texytext_null)
  }
}

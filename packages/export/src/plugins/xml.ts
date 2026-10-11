import { localisedDate } from '@bettermyadmin/i18n'
import { backquote } from '@bettermyadmin/sql-gen'
import { hexBytes, htmlspecialchars } from '../bytes.ts'
import type { Params } from '../params.ts'
import { type Aliases, ExportPlugin, type ExportSettings } from '../plugin.ts'
import { type PluginProperties, boolItem, hidden, main } from '../properties.ts'

const rtrim = (s: string) => s.replace(/[ \n\r\t\v\0]+$/, '')

/**
 * Used to build XML dumps of tables.
 * pma: src/Plugins/Export/ExportXml.php
 */
export class ExportXml extends ExportPlugin {
  #tables: string[] = []
  exportContents = false
  doExportEvents = false
  exportFunctions = false
  exportProcedures = false
  exportTables = false
  exportTriggers = false
  exportViews = false

  get name(): string {
    return 'xml'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'xml',
      text: 'XML',
      extension: 'xml',
      mimeType: 'text/xml',
      forceFile: false,
      options: [
        main('xml_general_opts', '', [hidden('xml_structure_or_data')]),
        main('xml_structure', __('Object creation options (all are recommended)'), [
          boolItem('xml_export_events', __('Events')),
          boolItem('xml_export_functions', __('Functions')),
          boolItem('xml_export_procedures', __('Procedures')),
          boolItem('xml_export_tables', __('Tables')),
          boolItem('xml_export_triggers', __('Triggers')),
          boolItem('xml_export_views', __('Views')),
        ]),
        main('xml_data', __('Data dump options'), [boolItem('xml_export_contents', __('Export contents'))]),
      ],
    }
  }

  setTables(tables: string[]): void {
    this.#tables = [...tables]
  }

  async #exportDefinitions(
    db: string,
    type: 'function' | 'procedure' | 'event',
    names: string[],
  ): Promise<string> {
    let head = ''
    for (const name of names) {
      head += `            <pma:${type} name="${htmlspecialchars(name)}">\n`
      const [what, col] =
        type === 'function'
          ? ['FUNCTION', 'Create Function']
          : type === 'procedure'
            ? ['PROCEDURE', 'Create Procedure']
            : ['EVENT', 'Create Event']
      const definition = await this.ctx.dbi.fetchValue(
        `SHOW CREATE ${what} ${backquote(db)}.${backquote(name)}`,
        col,
      )
      // Do some formatting
      let sql = htmlspecialchars(rtrim(typeof definition === 'string' ? definition : ''))
      sql = sql.replaceAll('\n', '\n                ')
      head += `                ${sql}\n`
      head += `            </pma:${type}>\n`
    }
    return head
  }

  override async exportHeader(): Promise<void> {
    const exportStruct =
      this.exportFunctions ||
      this.exportProcedures ||
      this.exportTables ||
      this.exportTriggers ||
      this.exportViews
    const charset = this.ctx.out.convertCharset !== null ? (this.ctx.charset ?? 'utf-8') : 'utf-8'
    const { tool } = this.ctx
    let head =
      `<?xml version="1.0" encoding="${charset}"?>\n<!--\n- ${tool.name} XML Dump\n- version ${tool.version}\n- ${tool.url}\n-\n` +
      `- ${this.__('Host:')} ${htmlspecialchars(this.ctx.host)}`
    if (this.ctx.port !== '' && this.ctx.port !== '0') head += `:${this.ctx.port}`
    head +=
      `\n- ${this.__('Generation Time:')} ${localisedDate(this.ctx.tr, Math.floor(this.ctx.now.getTime() / 1000), '', this.ctx.timeZone)}\n` +
      `- ${this.__('Server version:')} ${this.ctx.dbi.versionString}\n` +
      `- ${tool.runtimeLabel} ${tool.runtime}\n-->\n\n`
    head += `<pma_xml_export version="1.0"${exportStruct ? ' xmlns:pma="https://www.phpmyadmin.net/some_doc_url/"' : ''}>\n`
    const db = this.ctx.db
    if (exportStruct) {
      const q = (s: string) => this.ctx.dbi.quoteString(s)
      const result =
        (
          await this.ctx.dbi.fetchResultSimple(
            `SELECT \`DEFAULT_CHARACTER_SET_NAME\`, \`DEFAULT_COLLATION_NAME\` FROM \`information_schema\`.\`SCHEMATA\` WHERE \`SCHEMA_NAME\` = ${q(db)} LIMIT 1`,
          )
        )[0] ?? {}
      const dbCollation = result.DEFAULT_COLLATION_NAME ?? ''
      const dbCharset = result.DEFAULT_CHARACTER_SET_NAME ?? ''
      head += '    <!--\n    - Structure schemas\n    -->\n    <pma:structure_schemas>\n'
      head += `        <pma:database name="${htmlspecialchars(db)}" collation="${htmlspecialchars(dbCollation)}" charset="${htmlspecialchars(dbCharset)}">\n`
      if (this.#tables.length === 0) this.#tables.push(this.ctx.table)
      for (const table of this.#tables) {
        // Export tables and views
        const rows = await this.ctx.dbi.select(
          `SHOW CREATE TABLE ${backquote(db)}.${backquote(table)}`,
          false,
        )
        let tbl: string | null = null
        if (rows !== null) {
          // fetchResult(…, 0): keyed by the first column
          for await (const r of rows.rows) if (r[0] === table) tbl = r[1] ?? ''
        }
        if (tbl === null) continue
        const isView = await this.ctx.tables.isView(db, table)
        const type = isView ? 'view' : 'table'
        if (isView && !this.exportViews) continue
        if (!isView && !this.exportTables) continue
        head += `            <pma:${type} name="${htmlspecialchars(table)}">\n`
        tbl = `                ${htmlspecialchars(tbl)}`.replaceAll('\n', '\n                ')
        head += `${tbl};\n`
        head += `            </pma:${type}>\n`
        if (!this.exportTriggers) continue
        // Export triggers
        for (const trigger of await this.ctx.tables.getTriggers(db, table)) {
          let code = `CREATE TRIGGER ${backquote(trigger.name)} ${trigger.timing} ${trigger.event} ON ${backquote(trigger.table)}\n FOR EACH ROW ${trigger.statement}\n//\n`
          head += `            <pma:trigger name="${htmlspecialchars(trigger.name)}">\n`
          // Do some formatting
          const chars = [...rtrim(code)]
          code = chars.slice(0, Math.max(0, chars.length - 3)).join('')
          code = `                ${htmlspecialchars(code)}`.replaceAll('\n', '\n                ')
          head += `${code}\n`
          head += '            </pma:trigger>\n'
        }
      }
      const names = (type: string) =>
        this.ctx.dbi.fetchSingleColumn(
          `SELECT SPECIFIC_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ${q(db)} AND ROUTINE_TYPE = '${type}' AND SPECIFIC_NAME != ''`,
        )
      if (this.exportFunctions) head += await this.#exportDefinitions(db, 'function', await names('FUNCTION'))
      if (this.exportProcedures)
        head += await this.#exportDefinitions(db, 'procedure', await names('PROCEDURE'))
      if (this.doExportEvents) {
        // Export events
        const events = await this.ctx.dbi.fetchSingleColumn(
          `SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=${q(db)}`,
        )
        head += await this.#exportDefinitions(db, 'event', events)
      }
      head += '        </pma:database>\n    </pma:structure_schemas>\n'
      if (this.exportContents) head += '\n'
    }
    await this.addLine(head)
  }

  override async exportFooter(): Promise<void> {
    await this.addLine('</pma_xml_export>')
  }

  override async exportDBHeader(db: string, dbAlias0 = ''): Promise<void> {
    const dbAlias = dbAlias0 === '' ? db : dbAlias0
    if (!this.exportContents) return
    await this.addLine(
      `    <!--\n    - ${this.__('Database:')} '${htmlspecialchars(dbAlias)}'\n    -->\n    <database name="${htmlspecialchars(dbAlias)}">\n`,
    )
  }

  override async exportDBFooter(_db: string): Promise<void> {
    if (!this.exportContents) return
    await this.addLine('    </database>\n')
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    // Do not export data for merge tables
    if (await this.ctx.tables.isMerge(db, table)) return
    const tableAlias = this.getTableAlias(aliases, db, table)
    if (!this.exportContents) return
    const result = await this.query(sqlQuery)
    const fieldsMeta = result.fields
    await this.addLine(`        <!-- ${this.__('Table')} ${htmlspecialchars(tableAlias)} -->\n`)
    for await (const record of result.rows) {
      let buffer = `        <table name="${htmlspecialchars(tableAlias)}">\n`
      fieldsMeta.forEach((f, i) => {
        const colAs = this.getColumnAlias(aliases, db, table, f.name)
        // If a cell is NULL, still export it to preserve the XML structure
        let v = record[i] ?? null
        if (v === null) v = 'NULL'
        else if (f.isMappedTypeGeometry || f.isBinary) v = `0x${hexBytes(v)}`
        buffer += `            <column name="${htmlspecialchars(colAs)}">${htmlspecialchars(v)}</column>\n`
      })
      buffer += '        </table>\n'
      await this.addLine(buffer)
    }
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('xml_structure_or_data'),
      cfg.xml_structure_or_data,
      'data',
    )
    this.exportContents = request.has('xml_export_contents')
    this.doExportEvents = request.has('xml_export_events')
    this.exportFunctions = request.has('xml_export_functions')
    this.exportProcedures = request.has('xml_export_procedures')
    this.exportTables = request.has('xml_export_tables')
    this.exportTriggers = request.has('xml_export_triggers')
    this.exportViews = request.has('xml_export_views')
  }
}

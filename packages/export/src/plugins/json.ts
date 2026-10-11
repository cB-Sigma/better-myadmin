import { bin2hex } from '../bytes.ts'
import { ExportError } from '../errors.ts'
import type { Params } from '../params.ts'
import { type PhpValue, jsonEncode } from '../php.ts'
import { type Aliases, ExportPlugin, type ExportSettings } from '../plugin.ts'
import { type PluginProperties, bool, hidden, main } from '../properties.ts'

/**
 * Handles the export for the JSON format.
 * pma: src/Plugins/Export/ExportJson.php
 */
export class ExportJson extends ExportPlugin {
  #first = true
  prettyPrint = false
  unicode = false

  get name(): string {
    return 'json'
  }

  encode(data: PhpValue): string | false {
    return jsonEncode(data, { pretty: this.prettyPrint, unicode: this.unicode })
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'json',
      text: 'JSON',
      extension: 'json',
      mimeType: 'application/json',
      forceFile: false,
      options: [
        main('json_general_opts', '', [
          hidden('json_structure_or_data'),
          bool('json_pretty_print', __('Output pretty-printed JSON (Use human-readable formatting)')),
          bool('json_unicode', __('Output unicode characters unescaped')),
        ]),
      ],
    }
  }

  override async exportHeader(): Promise<void> {
    const data = this.encode(
      new Map<string, PhpValue>([
        ['type', 'header'],
        ['version', this.ctx.tool.version],
        ['comment', `Export to JSON plugin for ${this.ctx.tool.name}`],
      ]),
    )
    if (data === false) throw new ExportError('Failure during header export.')
    await this.addLine(`[\n${data},\n`)
  }

  override async exportFooter(): Promise<void> {
    await this.addLine(']\n')
  }

  override async exportDBHeader(db: string, dbAlias0 = ''): Promise<void> {
    const dbAlias = dbAlias0 === '' ? db : dbAlias0
    const data = this.encode(
      new Map<string, PhpValue>([
        ['type', 'database'],
        ['name', dbAlias],
      ]),
    )
    if (data === false) throw new ExportError('Failure during header export.')
    await this.addLine(`${data},\n`)
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const dbAlias = this.getDbAlias(aliases, db)
    const tableAlias = this.getTableAlias(aliases, db, table)
    if (!this.#first) await this.addLine(',')
    else this.#first = false
    const buffer = this.encode(
      new Map<string, PhpValue>([
        ['type', 'table'],
        ['name', tableAlias],
        ['database', dbAlias],
        ['data', '@@DATA@@'],
      ]),
    )
    if (buffer === false) throw new ExportError('Failure during data export.')
    await this.#doExportForQuery(sqlQuery, buffer, aliases, db, table)
  }

  async #doExportForQuery(
    sqlQuery: string,
    buffer: string,
    aliases: Aliases | null,
    db: string | null,
    table: string | null,
  ): Promise<void> {
    const [header = '', footer = ''] = buffer.split('"@@DATA@@"')
    await this.addLine(`${header}\n[\n`)
    const result = await this.query(sqlQuery)
    const fieldsMeta = result.fields
    const columns = fieldsMeta.map((f) =>
      db !== null && table !== null && aliases !== null
        ? this.getColumnAlias(aliases, db, table, f.name)
        : f.name,
    )
    let recordCnt = 0
    for await (const record of result.rows) {
      recordCnt++
      // Output table name as comment if this is the first record of the table
      if (recordCnt > 1) await this.addLine(',\n')
      const data = new Map<string, PhpValue>()
      fieldsMeta.forEach((f, i) => {
        // 63 is the binary charset, see: https://dev.mysql.com/doc/internals/en/charsets.html
        const binary = (f.mappedType === 'blob' || f.mappedType === 'string') && f.charsetNr === 63
        let v = record[i] ?? null
        if ((f.isMappedTypeGeometry || binary) && v !== null) {
          // export GIS and blob types as hex
          v = `0x${bin2hex(v)}`
        }
        data.set(columns[i] as string, v)
      })
      const encoded = this.encode(data)
      if (encoded === '' || encoded === false) throw new ExportError('Failure during data export.')
      await this.addLine(encoded)
    }
    await this.addLine(`\n]\n${footer}\n`)
  }

  override async exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    const buffer = this.encode(
      new Map<string, PhpValue>([
        ['type', 'raw'],
        ['data', '@@DATA@@'],
      ]),
    )
    if (buffer === false) throw new ExportError('Failure during data export.')
    if (db !== '') await this.ctx.dbi.selectDb(db)
    await this.#doExportForQuery(sqlQuery, buffer, null, db, null)
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('json_structure_or_data'),
      cfg.json_structure_or_data,
      'data',
    )
    this.prettyPrint = request.has('json_pretty_print')
    this.unicode = request.has('json_unicode')
  }
}

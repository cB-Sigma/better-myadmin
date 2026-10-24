import { php } from '@bettermyadmin/mysql-types'
import { backquote } from '@bettermyadmin/sql-gen'
import { hexBytes } from '../bytes.ts'
import type { Params } from '../params.ts'
import { varExport } from '../php.ts'
import { type Aliases, ExportPlugin, type ExportSettings } from '../plugin.ts'
import { type PluginProperties, hidden, main, textItem } from '../properties.ts'

/**
 * Handles the export for the YAML format.
 * pma: src/Plugins/Export/ExportYaml.php
 */
export class ExportYaml extends ExportPlugin {
  get name(): string {
    return 'yaml'
  }

  protected setProperties(): PluginProperties {
    return {
      name: 'yaml',
      text: 'YAML',
      extension: 'yml',
      mimeType: 'text/yaml',
      forceFile: true,
      options: [main('yaml_general_opts', '', [hidden('yaml_structure_or_data')])],
    }
  }

  override async exportHeader(): Promise<void> {
    await this.addLine('%YAML 1.1\n---\n')
  }

  override async exportFooter(): Promise<void> {
    await this.addLine('...\n')
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
    const columns = fieldsMeta.map((f) => this.getColumnAlias(aliases, db, table, f.name))
    let recordCnt = 0
    for await (const record of result.rows) {
      recordCnt++
      // Output table name as comment if this is the first record of the table
      let buffer = recordCnt === 1 ? `# ${dbAlias}.${tableAlias}\n-\n` : '-\n'
      fieldsMeta.forEach((f, i) => {
        let v = record[i]
        if (v === undefined) return
        if (v === null) {
          buffer += `  ${columns[i]}: null\n`
          return
        }
        if (f.isMappedTypeGeometry || f.isBinary) v = `0x${hexBytes(v)}`
        const isNotString = f.mappedType !== 'string'
        if (php.isNumericString(v) && isNotString) {
          buffer += `  ${columns[i]}: ${v}\n`
          return
        }
        v = v.replace(
          /[\\"\n\r]/g,
          (c) => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r' })[c] as string,
        )
        buffer += `  ${columns[i]}: "${v}"\n`
      })
      await this.addLine(buffer)
    }
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('yaml_structure_or_data'),
      cfg.yaml_structure_or_data,
      'data',
    )
  }
}

/** JavaScript's reserved words, which an export binding cannot be named (ES2023, strict mode). */
const JS_RESERVED = new Set(
  (
    'await break case catch class const continue debugger default delete do else enum export extends ' +
    'false finally for function if implements import in instanceof interface let new null package ' +
    'private protected public return static super switch this throw true try typeof var void while with yield'
  ).split(' '),
)

/**
 * Handles the export for the JavaScript module format: one `export const <table> = [{…}, …]` per
 * table, the column names and values as JSON literals. BetterMyAdmin's replacement for phpMyAdmin's
 * PHP array format (parity exception X57), which it follows otherwise (header, database comments,
 * hex for binary and geometry values, aliases).
 * pma: src/Plugins/Export/ExportPhparray.php
 */
export class ExportJsmodule extends ExportPlugin {
  /** the binding names used so far: two tables may sanitise to the same one */
  private readonly bindings = new Set<string>()

  get name(): string {
    return 'jsmodule'
  }

  protected setProperties(): PluginProperties {
    return {
      name: 'jsmodule',
      text: 'JavaScript module',
      extension: 'js',
      mimeType: 'text/javascript',
      forceFile: false,
      options: [main('jsmodule_general_opts', '', [hidden('jsmodule_structure_or_data')])],
    }
  }

  /** `*` + `/` would close the comment */
  commentString(s: string): string {
    return s.replaceAll('*/', '*\\/')
  }

  /** a valid, unused JavaScript binding name for a table */
  binding(name: string): string {
    let id = name.replace(/[^\p{ID_Continue}$]/gu, '_')
    if (!/^[\p{ID_Start}$_]/u.test(id)) id = `_${id}`
    if (JS_RESERVED.has(id)) id = `${id}_`
    let unique = id
    for (let n = 2; this.bindings.has(unique); n++) unique = `${id}_${n}`
    this.bindings.add(unique)
    return unique
  }

  override async exportHeader(): Promise<void> {
    await this.addLine(
      `/**\n * Export to JavaScript module plugin for ${this.ctx.tool.name}\n * @version ${this.ctx.tool.version}\n */\n\n`,
    )
  }

  override async exportDBHeader(db: string, dbAlias0 = ''): Promise<void> {
    const dbAlias = dbAlias0 === '' ? db : dbAlias0
    await this.addLine(`/**\n * Database ${this.commentString(backquote(dbAlias))}\n */\n`)
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
    const columns = fieldsMeta.map((f) => JSON.stringify(this.getColumnAlias(aliases, db, table, f.name)))
    let buffer = `\n/* ${this.commentString(backquote(dbAlias))}.${this.commentString(backquote(tableAlias))} */\n`
    buffer += `export const ${this.binding(tableAlias)} = [`
    await this.addLine(buffer)
    let recordCnt = 0
    for await (const record of result.rows) {
      recordCnt++
      const cells = columns.map((col, i) => {
        let v = record[i] ?? null
        const f = fieldsMeta[i]
        if (v !== null && (f?.isMappedTypeGeometry === true || f?.isBinary === true)) v = `0x${hexBytes(v)}`
        return `${col}: ${JSON.stringify(v === null ? null : String(v))}`
      })
      await this.addLine(`${recordCnt === 1 ? '' : ','}\n  { ${cells.join(', ')} }`)
    }
    await this.addLine('\n];\n')
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('jsmodule_structure_or_data'),
      cfg.jsmodule_structure_or_data,
      'data',
    )
  }
}

/**
 * Handles the export for the TOON format.
 * pma: src/Plugins/Export/ExportToon.php
 */
export class ExportToon extends ExportPlugin {
  indent = 2
  separator = ','

  get name(): string {
    return 'toon'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'toon',
      text: 'TOON',
      extension: 'toon',
      mimeType: 'text/toon',
      forceFile: true,
      options: [
        main('toon_general_opts', '', [
          textItem('toon_separator', __('Columns separated with:')),
          textItem('toon_indent', __('Indentation:')),
          hidden('toon_structure_or_data'),
        ]),
      ],
    }
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const dbAlias = this.getDbAlias(aliases, db)
    const tableAlias = this.getTableAlias(aliases, db, table)
    // use buffered query to get $rowsCnt
    const result = await this.query(sqlQuery, false)
    const fieldsMeta = result.fields
    const columnsCnt = fieldsMeta.length
    const rowsCnt = result.numRows ?? 0
    const columns = fieldsMeta.map((f) => this.getColumnAlias(aliases, db, table, f.name))
    let buffer = `${dbAlias}.${tableAlias}[${rowsCnt}${this.separator !== ',' ? this.separator : ''}]{`
    buffer += columns.join(this.separator)
    buffer += '}:\n'
    await this.addLine(buffer)
    let insertedLines = 0
    for await (const row of result.rows) {
      buffer = ''
      row.forEach((col0, index) => {
        if (index === 0) buffer += ' '.repeat(this.indent)
        let col = col0
        const f = fieldsMeta[index]
        if (col !== null && (f?.isMappedTypeGeometry === true || f?.isBinary === true))
          col = `0x${hexBytes(col)}`
        buffer += col ?? 'null'
        if (index !== columnsCnt - 1) buffer += this.separator
      })
      insertedLines++
      buffer += insertedLines === rowsCnt ? '\n\n' : '\n'
      await this.addLine(buffer)
    }
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('toon_structure_or_data'),
      cfg.toon_structure_or_data,
      'structure_and_data',
    )
    this.separator = this.stringValue(request.get('toon_separator'), cfg.toon_separator ?? this.separator)
    const indent = request.get('toon_indent') ?? ''
    this.indent = /^\d+$/.test(indent)
      ? Number(indent)
      : typeof cfg.toon_indent === 'number'
        ? cfg.toon_indent
        : 2
    this.separator = this.separator.replaceAll('\\t', '\t')
  }
}

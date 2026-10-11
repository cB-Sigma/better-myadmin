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

/**
 * Handles the export for the PHP Array format.
 * pma: src/Plugins/Export/ExportPhparray.php
 */
export class ExportPhparray extends ExportPlugin {
  get name(): string {
    return 'phparray'
  }

  protected setProperties(): PluginProperties {
    return {
      name: 'phparray',
      text: 'PHP array',
      extension: 'php',
      mimeType: 'text/plain',
      forceFile: false,
      options: [main('phparray_general_opts', '', [hidden('phparray_structure_or_data')])],
    }
  }

  /** strtr($string, '*' . '/', '-'): only `*` is translated (the "to" string is shorter) */
  commentString(s: string): string {
    return s.replaceAll('*', '-')
  }

  override async exportHeader(): Promise<void> {
    await this.addLine(
      `<?php\n/**\n * Export to PHP Array plugin for ${this.ctx.tool.name}\n * @version ${this.ctx.tool.version}\n */\n\n`,
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
    const columnsCnt = fieldsMeta.length
    const columns = fieldsMeta.map((f) => this.getColumnAlias(aliases, db, table, f.name))
    let tableFixed = table
    // fix variable names (based on https://www.php.net/manual/en/language.variables.basics.php)
    if (
      !/^[a-zA-Z_\u007f-\u{10ffff}\udc80-\udcff][a-zA-Z0-9_\u007f-\u{10ffff}\udc80-\udcff]*$/u.test(
        tableAlias,
      )
    ) {
      // fix invalid characters in variable names by replacing them with underscores
      tableFixed = tableAlias.replace(/[^a-zA-Z0-9_\u007f-\u{10ffff}]/gu, '_')
      // variable name must not start with a number or dash...
      if (!/^[a-zA-Z_\u007f-\u{10ffff}]/u.test(tableFixed)) tableFixed = `_${tableFixed}`
    }
    let buffer = `\n/* ${this.commentString(backquote(dbAlias))}.${this.commentString(backquote(tableAlias))} */\n`
    buffer += `$${tableFixed} = array(`
    await this.addLine(buffer)
    buffer = ''
    let recordCnt = 0
    for await (const record of result.rows) {
      recordCnt++
      buffer += recordCnt === 1 ? '\n  array(' : ',\n  array('
      for (let i = 0; i < columnsCnt; i++) {
        let v = record[i] ?? null
        const f = fieldsMeta[i]
        if (v !== null && (f?.isMappedTypeGeometry === true || f?.isBinary === true)) v = `0x${hexBytes(v)}`
        buffer += `${varExport(columns[i] as string)} => ${varExport(v)}${i + 1 >= columnsCnt ? '' : ','}`
      }
      buffer += ')'
      await this.addLine(buffer)
      buffer = ''
    }
    buffer += '\n);\n'
    await this.addLine(buffer)
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('phparray_structure_or_data'),
      cfg.phparray_structure_or_data,
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

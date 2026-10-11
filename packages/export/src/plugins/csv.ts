import { hexBytes } from '../bytes.ts'
import type { Params } from '../params.ts'
import { type Aliases, ExportPlugin, type ExportSettings } from '../plugin.ts'
import { type PluginProperties, boolItem, hidden, main, textItem } from '../properties.ts'

/** PHP strcspn($s, $chars) !== strlen($s): whether `s` contains any of `chars` */
export const containsAny = (s: string, chars: string): boolean => {
  for (const c of chars) if (s.includes(c)) return true
  return false
}

/**
 * Handles the export for the CSV format.
 * pma: src/Plugins/Export/ExportCsv.php
 */
export class ExportCsv extends ExportPlugin {
  columns = false
  separator = ','
  terminated = ''
  enclosed = '"'
  escaped = '"'
  removeCrLf = false
  null = 'NULL'

  get name(): string {
    return 'csv'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'csv',
      text: 'CSV',
      extension: 'csv',
      mimeType: 'text/comma-separated-values',
      forceFile: false,
      options: [
        main('csv_general_opts', '', [
          textItem('csv_separator', __('Columns separated with:')),
          textItem('csv_enclosed', __('Columns enclosed with:')),
          textItem('csv_escaped', __('Columns escaped with:')),
          textItem('csv_terminated', __('Lines terminated with:')),
          textItem('csv_null', __('Replace NULL with:')),
          boolItem('csv_removeCRLF', __('Remove carriage return/line feed characters within columns')),
          boolItem('csv_columns', __('Put columns names in the first row')),
          hidden('csv_structure_or_data'),
        ]),
      ],
    }
  }

  #setupExportConfiguration(): void {
    if (this.terminated === '' || this.terminated.toLowerCase() === 'auto') this.terminated = '\n'
    else
      this.terminated = this.terminated
        .replaceAll('\\r', '\r')
        .replaceAll('\\n', '\n')
        .replaceAll('\\t', '\t')
    this.separator = this.separator.replaceAll('\\t', '\t')
  }

  override async exportData(
    db: string,
    table: string,
    sqlQuery: string,
    aliases: Aliases = {},
  ): Promise<void> {
    const result = await this.query(sqlQuery)
    const fieldsMeta = result.fields
    const charsNeedingEnclosure = this.separator + this.enclosed + this.terminated
    // If required, get fields name at the first line
    if (this.columns) {
      const insertFields: string[] = []
      for (const f of fieldsMeta) {
        const colAs = this.getColumnAlias(aliases, db, table, f.name)
        const needsEnclosing = containsAny(colAs, charsNeedingEnclosure)
        if (this.enclosed === '' || !needsEnclosing) {
          insertFields.push(colAs)
          continue
        }
        insertFields.push(
          this.enclosed + colAs.replaceAll(this.enclosed, this.escaped + this.enclosed) + this.enclosed,
        )
      }
      await this.addLine(insertFields.join(this.separator) + this.terminated)
    }
    // Format the data
    for await (const row of result.rows) {
      const insertValues: string[] = []
      row.forEach((field0, j) => {
        let field = field0
        if (field === null) {
          insertValues.push(this.null)
          return
        }
        if (field === '') {
          insertValues.push('')
          return
        }
        const meta = fieldsMeta[j]
        if (meta?.isMappedTypeGeometry === true || meta?.isBinary === true) {
          insertValues.push(`0x${hexBytes(field)}`)
          return
        }
        // remove CRLF characters within field
        if (this.removeCrLf) field = field.replace(/[\r\n]/g, '')
        if (this.enclosed === '') {
          insertValues.push(field)
          return
        }
        if (!containsAny(field, charsNeedingEnclosure)) {
          insertValues.push(field)
          return
        }
        if (this.escaped !== this.enclosed) {
          // also double the escape string if found in the data
          field = field.replaceAll(this.escaped, this.escaped + this.escaped)
          field = field.replaceAll(this.enclosed, this.escaped + this.enclosed)
        } else {
          // avoid a problem when escape string equals enclose
          field = field.replaceAll(this.enclosed, this.escaped + this.enclosed)
        }
        insertValues.push(this.enclosed + field + this.enclosed)
      })
      await this.addLine(insertValues.join(this.separator) + this.terminated)
    }
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('csv_structure_or_data'),
      cfg.csv_structure_or_data,
      'data',
    )
    this.terminated = this.stringValue(request.get('csv_terminated'), cfg.csv_terminated)
    this.separator = this.stringValue(request.get('csv_separator'), cfg.csv_separator)
    this.columns = request.has('csv_columns')
    this.enclosed = this.stringValue(request.get('csv_enclosed'), cfg.csv_enclosed)
    this.escaped = this.stringValue(request.get('csv_escaped'), cfg.csv_escaped)
    this.removeCrLf = request.has('csv_removeCRLF')
    this.null = this.stringValue(request.get('csv_null'), cfg.csv_null)
    this.#setupExportConfiguration()
  }
}

/**
 * Handles the export for the CSV-Excel format.
 * pma: src/Plugins/Export/ExportExcel.php
 */
export class ExportExcel extends ExportPlugin {
  columns = false
  edition = 'win'
  removeCrLf = false
  null = 'NULL'
  separator = ','
  enclosed = '"'
  escaped = '"'
  terminated = ''

  get name(): string {
    return 'excel'
  }

  protected setProperties(): PluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'excel',
      text: 'CSV for MS Excel',
      extension: 'csv',
      mimeType: 'text/comma-separated-values',
      forceFile: false,
      options: [
        main('excel_general_opts', '', [
          textItem('excel_null', __('Replace NULL with:')),
          boolItem('excel_removeCRLF', __('Remove carriage return/line feed characters within columns')),
          boolItem('excel_columns', __('Put columns names in the first row')),
          {
            kind: 'select',
            name: 'excel_edition',
            text: __('Excel edition:'),
            values: [
              ['win', 'Windows'],
              ['mac_excel2003', 'Excel 2003 / Macintosh'],
              ['mac_excel2008', 'Excel 2008 / Macintosh'],
            ],
          },
          hidden('excel_structure_or_data'),
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
    const result = await this.query(sqlQuery)
    if (this.columns) {
      const insertFields = result.fields.map((f) => {
        const colAs = this.getColumnAlias(aliases, db, table, f.name)
        return this.enclosed === ''
          ? colAs
          : this.enclosed + colAs.replaceAll(this.enclosed, this.escaped + this.enclosed) + this.enclosed
      })
      await this.addLine(insertFields.join(this.separator) + this.terminated)
    }
    for await (const row of result.rows) {
      const insertValues = row.map((field0) => {
        if (field0 === null) return this.null
        if (field0 === '') return ''
        // always enclose fields
        let field = field0.replace(/\r(\n)?/g, '\n')
        // remove CRLF characters within field
        if (this.removeCrLf) field = field.replace(/[\r\n]/g, '')
        if (this.enclosed === '') return field
        if (this.escaped !== this.enclosed) {
          return (
            this.enclosed +
            field
              .replaceAll(this.escaped, this.escaped + this.escaped)
              .replaceAll(this.enclosed, this.escaped + this.enclosed) +
            this.enclosed
          )
        }
        return this.enclosed + field.replaceAll(this.enclosed, this.escaped + this.enclosed) + this.enclosed
      })
      await this.addLine(insertValues.join(this.separator) + this.terminated)
    }
  }

  override exportRawQuery(db: string, sqlQuery: string): Promise<void> {
    return this.rawAsData(db, sqlQuery)
  }

  setExportOptions(request: Params, cfg: ExportSettings): void {
    this.structureOrData = this.setStructureOrData(
      request.get('excel_structure_or_data'),
      cfg.excel_structure_or_data,
      'data',
    )
    const edition = this.stringValue(request.get('excel_edition'), cfg.excel_edition)
    this.edition = edition === 'mac_excel2003' || edition === 'mac_excel2008' ? edition : 'win'
    this.columns = request.has('excel_columns')
    this.removeCrLf = request.has('excel_removeCRLF')
    this.null = this.stringValue(request.get('excel_null'), cfg.excel_null)
    // setupExportConfiguration
    this.terminated = '\r\n'
    this.separator = this.edition === 'mac_excel2008' ? ',' : ';'
    this.enclosed = '"'
    this.escaped = '"'
  }
}

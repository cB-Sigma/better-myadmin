import { boolItem, main } from '@bettermyadmin/export'
import { type AnalysedColumn, type Import, type ImportTable, phpFloatString } from '../import.ts'
import { ImportPlugin, type ImportPluginProperties } from '../plugin.ts'
import { rtrimChars } from '../strings.ts'
import { type El, attr, child, children, loadXml, text } from '../xml.ts'

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
}

/** PHP (int) of an attribute string */
const intval = (s: string) => {
  const m = /^\s*[+-]?\d+/.exec(s)
  return m === null ? 0 : Number.parseInt(m[0], 10)
}

/** PHP (float) of an attribute string */
const floatval = (s: string) => {
  const m = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(s)
  return m === null ? 0 : Number(m[0])
}

/**
 * Handles the import for the ODS format.
 * pma: src/Plugins/Import/ImportOds.php
 */
export class ImportOds extends ImportPlugin {
  get name(): string {
    return 'ods'
  }

  protected setProperties(): ImportPluginProperties {
    const __ = (s: string) => this.__(s)
    return {
      name: 'ods',
      text: 'OpenDocument Spreadsheet',
      extension: 'ods',
      mimeType: '',
      options: [
        main('ods_general_opts', '', [
          boolItem(
            'ods_col_names',
            __(
              'The first line of the file contains the table column names <i>(if this is unchecked, the first line will become part of the data)</i>',
            ),
          ),
          boolItem('ods_empty_rows', __('Do not import empty rows')),
          boolItem(
            'ods_recognize_percentages',
            __('Import percentages as proper decimals <i>(ex. 12.00% to .12)</i>'),
          ),
          boolItem('ods_recognize_currency', __('Import currencies <i>(ex. $5.00 to 5.00)</i>')),
        ]),
      ],
    }
  }

  async doImport(imp: Import): Promise<void> {
    const r = imp.request
    const o = {
      percentages: r.has('ods_recognize_percentages'),
      currency: r.has('ods_recognize_currency'),
      includeEmptyRows: r.has('ods_empty_rows'),
      hasColumnNames: r.has('ods_col_names'),
    }
    const parts: Buffer[] = []
    while (!imp.finished && !imp.hasError && !imp.timeoutPassed) {
      const data = imp.getNextChunk()
      if (data === false) break
      if (data === true) continue
      parts.push(data)
    }
    const xml = loadXml(Buffer.concat(parts).toString('utf8'))
    let sheets: El[] = []
    if (xml === false) {
      imp.message = imp.error(
        'The XML file specified was either malformed or incomplete. Please correct the issue and try again.',
      )
      imp.hasError = true
    } else {
      const body = child(xml, 'body', NS.office)
      const root = body === null ? null : child(body, 'spreadsheet', NS.office)
      if (root === null) {
        imp.message = imp.error('Could not parse OpenDocument Spreadsheet!')
        imp.hasError = true
      } else sheets = children(root, NS.table)
    }
    const tables = this.#readSheets(imp, sheets, o)
    /* Obtain the best-fit MySQL types for each column */
    const analyses: AnalysedColumn[][] = tables.map((t) => imp.analyzeTable(t))
    const dbName = imp.db !== '' ? imp.db : 'ODS_DB'
    if (imp.db === '') await imp.createDatabase(dbName, 'utf8', 'utf8_general_ci')
    await imp.buildSql(dbName, tables, analyses)
    /* Commit any possible data in buffers */
    await imp.runQuery('')
  }

  #getValue(cell: El, paragraphs: El[], o: { percentages: boolean; currency: boolean }): string {
    const type = attr(cell, 'value-type', NS.office)
    if (o.percentages && type === 'percentage')
      return phpFloatString(floatval(attr(cell, 'value', NS.office)))
    if (o.currency && type === 'currency') return phpFloatString(floatval(attr(cell, 'value', NS.office)))
    /* We need to concatenate all paragraphs */
    const values: string[] = []
    for (const p of paragraphs) {
      const v = text(p)
      const a = child(p, 'a')
      if (v === '' && a !== null) {
        values.push(text(a))
        continue
      }
      values.push(v)
    }
    return values.join('\n')
  }

  #readCells(row: El, o: { percentages: boolean; currency: boolean }): string[] {
    const tempRow: string[] = []
    const cells = children(row, NS.table)
    cells.forEach((cell, idx) => {
      const paragraphs = children(cell, NS.text)
      if (paragraphs.length !== 0) {
        const numRepeat = intval(attr(cell, 'number-columns-repeated', NS.table))
        const n = numRepeat !== 0 ? numRepeat : 1
        for (let k = 0; k < n; k++) tempRow.push(this.#getValue(cell, paragraphs, o))
        return
      }
      // skip empty repeats in the last row
      if (idx + 1 === cells.length) return
      const numNull = intval(attr(cell, 'number-columns-repeated', NS.table))
      if (numNull !== 0) for (let k = 0; k < numNull; ++k) tempRow.push('NULL')
      else tempRow.push('NULL')
    })
    return tempRow
  }

  #readSheets(
    imp: Import,
    sheets: El[],
    o: { percentages: boolean; currency: boolean; includeEmptyRows: boolean; hasColumnNames: boolean },
  ): ImportTable[] {
    let maxCols = 0
    const out: ImportTable[] = []
    for (const sheet of sheets) {
      // readRows
      let colNamesInFirstRow = o.hasColumnNames
      const colNames: string[] = []
      const tempRows: string[][] = []
      for (const row of children(sheet, NS.table)) {
        if (row.localName !== 'table-row') continue
        if (colNamesInFirstRow) {
          colNamesInFirstRow = false
          this.#readCells(row, o).forEach((value, columnIndex) => {
            if (value === 'NULL') colNames.push(imp.getColumnAlphaName(columnIndex + 1))
            else colNames.push(rtrimChars(value))
          })
          maxCols = Math.max(colNames.length, maxCols)
          continue
        }
        const tempRow = this.#readCells(row, o)
        maxCols = Math.max(tempRow.length, maxCols)
        /* Don't include a row that is full of NULL values */
        if (o.includeEmptyRows) {
          if (tempRow.some((c) => c !== 'NULL')) tempRows.push(tempRow)
        } else tempRows.push(tempRow)
      }
      /* Skip over empty sheets */
      if (tempRows.length === 0 || (tempRows[0] as string[]).length === 0) continue
      for (let i = colNames.length; i < maxCols; ++i) colNames.push(imp.getColumnAlphaName(i + 1))
      const rows = tempRows.map((r) => {
        const x: Array<string | null> = [...r]
        while (x.length < maxCols) x.push('NULL')
        return x
      })
      out.push({ tableName: attr(sheet, 'name', NS.table), columns: colNames, rows })
      maxCols = 0
    }
    return out
  }
}

import {
  type LeafItem,
  type OptionMainGroup,
  boolItem,
  decodeBytes,
  main,
  numberItem,
  textItem,
} from '@bettermyadmin/export'
import { backquote } from '@bettermyadmin/sql-gen'
import type { Import, ImportTable } from '../import.ts'
import { ImportPlugin, type ImportPluginProperties } from '../plugin.ts'
import { rtrimChars, trimChars } from '../strings.ts'

/** A request value as PHP sees it: its UTF-8 bytes, one char per byte */
export const bin = (s: string): string => Buffer.from(s, 'utf8').toString('latin1')
/** back from bytes to a (byte-preserving) JS string */
export const unbin = (s: string): string => decodeBytes(Buffer.from(s, 'latin1'))

/** PHP strtr with the CSV escapes */
const replacements = (s: string) =>
  s.replace(/\\[ntr]/g, (m) => ({ '\\n': '\n', '\\t': '\t', '\\r': '\r' })[m] as string)

/** pathinfo($name, PATHINFO_FILENAME) */
export function fileBaseName(name: string): string {
  const base = name.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? (dot === 0 ? '' : base) : base.slice(0, dot)
}

/**
 * Super class of the CSV import plugins.
 * pma: src/Plugins/Import/AbstractImportCsv.php
 */
export abstract class AbstractImportCsv extends ImportPlugin {
  protected generalOptions(extra: LeafItem[]): OptionMainGroup {
    const n = this.name
    return main(`${n}_general_opts`, '', [
      boolItem(
        `${n}_replace`,
        this.__('Update data when duplicate keys found on import (add ON DUPLICATE KEY UPDATE)'),
      ),
      textItem(`${n}_terminated`, this.__('Columns separated with:'), { size: 2 }),
      textItem(`${n}_enclosed`, this.__('Columns enclosed with:'), { size: 2, len: 2 }),
      textItem(`${n}_escaped`, this.__('Columns escaped with:'), { size: 2, len: 2 }),
      textItem(`${n}_new_line`, this.__('Lines terminated with:'), { size: 2 }),
      ...extra,
    ])
  }
}

/**
 * Handles the import for the CSV format.
 * pma: src/Plugins/Import/ImportCsv.php
 */
export class ImportCsv extends AbstractImportCsv {
  get name(): string {
    return 'csv'
  }

  protected setProperties(): ImportPluginProperties {
    const __ = (s: string) => this.__(s)
    const extra: LeafItem[] = []
    if (this.page.importType !== 'table') {
      extra.push(textItem('csv_new_tbl_name', __('Name of the new table (optional):')))
      if (this.page.importType === 'server') {
        extra.push(textItem('csv_new_db_name', __('Name of the new database (optional):')))
      }
      extra.push(numberItem('csv_partial_import', __('Import these many number of rows (optional):')))
      extra.push(
        boolItem(
          'csv_col_names',
          __(
            'The first line of the file contains the table column names <i>(if this is unchecked, the first line will become part of the data)</i>',
          ),
        ),
      )
    } else {
      extra.push(numberItem('csv_partial_import', __('Import these many number of rows (optional):')))
      const hint = __(
        'If the data in each row of the file is not in the same order as in the database, list the corresponding column names here. Column names must be separated by commas and not enclosed in quotations.',
      )
      // Generator::showHint
      extra.push(
        textItem(
          'csv_columns',
          `${__('Column names:')} <span class="pma_hint"><img src="themes/dot.gif" title="" alt="" class="icon ic_b_help"><span class="hide">${hint}</span></span>`,
        ),
      )
    }
    extra.push(boolItem('csv_ignore', __('Do not abort on INSERT error')))
    extra.push(boolItem('csv_empty_as_null', __('Import empty values as NULL')))
    return { name: 'csv', text: 'CSV', extension: 'csv', mimeType: '', options: [this.generalOptions(extra)] }
  }

  async doImport(imp: Import): Promise<void> {
    const r = imp.request
    const intoExistingTable = imp.importType === 'table'
    const replace = r.has('csv_replace')
    const ignore = r.has('csv_ignore')
    const terminated = bin(replacements(r.get('csv_terminated') ?? ''))
    const enclosed = bin(replacements(r.get('csv_enclosed') ?? ''))
    const escaped = bin(replacements(r.get('csv_escaped') ?? ''))
    const newLine = bin(replacements(r.get('csv_new_line') ?? ''))
    const columns = r.get('csv_columns') ?? ''
    // pma: min(0, (int) csv_partial_import) is never positive
    const maxLines = Math.min(0, Math.trunc(Number(r.get('csv_partial_import') ?? 0)) || 0)
    const csvHasColumnNames = r.has('csv_col_names')
    const emptyAsNull = r.has('csv_empty_as_null')
    const newDatabaseName = r.get('csv_new_db_name') ?? ''
    const newTableName = r.get('csv_new_tbl_name') ?? ''

    // buildErrorsForParams: reported immediately (Generator::mysqlDie + exit)
    const paramError = (what: string) => {
      imp.message = imp.error('Invalid parameter for CSV import: %s', this.__(what))
      imp.hasError = true
      return true
    }
    let failed = false
    if (terminated === '') failed = paramError('Columns terminated with')
    else if (enclosed.length > 1) failed = paramError('Columns enclosed with')
    else if (escaped.length > 1) failed = paramError('Columns escaped with')
    else if (newLine.length !== 1 && newLine !== 'auto') failed = paramError('Lines terminated with')
    if (failed) {
      imp.dieMessage = true
      return
    }

    // getSqlRequiredFields
    let fields: string[] = []
    if (intoExistingTable) {
      const tmpFields = await imp.dbi.getColumnNames(imp.db, imp.table)
      if (columns === '') fields = tmpFields
      else {
        for (const v of columns.split(/,( ?)/).filter((_, i) => i % 2 === 0)) {
          /* Trim also `, if user already included backquoted fields */
          const val = trimChars(v, ' \t\r\n\0\x0B`')
          if (!tmpFields.includes(val)) {
            imp.message = imp.error(
              'Invalid column (%s) specified! Ensure that columns names are spelled correctly, separated by commas, and not enclosed in quotes.',
              val,
            )
            imp.hasError = true
            break
          }
          fields.push(val)
        }
      }
    }
    // getSqlTemplate
    let sqlTemplate = ''
    if (intoExistingTable) {
      sqlTemplate = `INSERT${ignore ? ' IGNORE' : ''} INTO ${backquote(imp.table)}`
      if (columns !== '') sqlTemplate += ` (${fields.map((f) => backquote(f)).join(', ')}) `
      sqlTemplate += ' VALUES ('
    }

    // Defaults for parser
    let i = 0
    let len = 0
    let lastlen = 0
    let line = 1
    let lasti = -1
    let values: Array<string | null> = []
    let csvFinish = false
    let maxLinesConstraint = maxLines + 1
    if (csvHasColumnNames) maxLinesConstraint++
    const rows: Array<Array<string | null>> = []
    let buffer = ''
    let maxCols = 0
    const tl = terminated.length
    const at = (k: number) => buffer.charAt(k)
    let ch: string | null = ''

    const addRow = async (vals: Array<string | null>) => {
      const quoted = vals.map((v) => (v === null ? 'NULL' : imp.dbi.quoteString(unbin(v))))
      let sql = sqlTemplate + quoted.join(', ') + ')'
      if (replace) {
        sql += ' ON DUPLICATE KEY UPDATE '
        for (const f of fields) sql += `${backquote(f)} = VALUES(${backquote(f)}), `
        sql = sql.replace(/[, ]+$/, '')
      }
      await imp.runQuery(sql)
    }
    const term = () => {
      if (tl > 1 && ch === terminated[0]) {
        ch = (ch as string) + buffer.substr(i + 1, tl - 1)
        i += tl - 1
      }
    }
    const isNl = (c: string | null) => c === newLine || (newLine === 'auto' && (c === '\r' || c === '\n'))

    while (!(imp.finished && i >= len) && !imp.hasError && !imp.timeoutPassed) {
      const data = imp.getNextChunk()
      if (data === false) {
        // subtract data we didn't handle yet and stop processing
        imp.offset -= buffer.length
        break
      }
      if (data !== true) {
        // Append new data to buffer
        buffer += data.toString('latin1')
        // Force a trailing new line at EOF to prevent parsing problems
        if (imp.finished && buffer !== '' && buffer !== '0') {
          const finalch = buffer.slice(-1)
          if (newLine === 'auto' && finalch !== '\r' && finalch !== '\n') buffer += '\n'
          else if (newLine !== 'auto' && finalch !== newLine) buffer += newLine
        }
        // Do not parse string when we're not at the end and don't have new line inside
        if (
          (newLine === 'auto' && !buffer.includes('\r') && !buffer.includes('\n')) ||
          (newLine !== 'auto' && !buffer.includes(newLine))
        ) {
          continue
        }
      }
      // Current length of our buffer
      len = buffer.length
      // Currently parsed char
      ch = at(i)
      term()
      while (i < len) {
        // Deadlock protection
        if (lasti === i && lastlen === len) {
          imp.message = imp.error('Invalid format of CSV input on line %d.', line)
          imp.hasError = true
          break
        }
        lasti = i
        lastlen = len
        // This can happen with auto EOL and \r at the end of buffer
        if (!csvFinish) {
          // Grab empty field
          if (ch === terminated) {
            if (i === len - 1) break
            values.push('')
            i++
            ch = at(i)
            term()
            continue
          }
          // Grab one field
          const fallbacki = i
          let needEnd: boolean
          if (ch === enclosed) {
            if (i === len - 1) break
            needEnd = true
            i++
            ch = at(i)
            term()
          } else needEnd = false
          let fail = false
          let value: string | null = ''
          while (
            (needEnd && (ch !== enclosed || enclosed === escaped)) ||
            (!needEnd && !(ch === terminated || isNl(ch)))
          ) {
            if (ch === escaped) {
              if (i === len - 1) {
                fail = true
                break
              }
              i++
              ch = at(i)
              term()
              if (enclosed === escaped && (ch === terminated || isNl(ch))) break
            }
            value += ch ?? ''
            if (i === len - 1) {
              if (!imp.finished) fail = true
              break
            }
            i++
            ch = at(i)
            if (tl <= 1 || ch !== terminated[0]) continue
            ch += buffer.substr(i + 1, tl - 1)
            i += tl - 1
          }
          // unquoted NULL string
          if (!needEnd && value === 'NULL') value = null
          // Transform empty values to NULL
          if (emptyAsNull && value === '') value = null
          if (fail) {
            i = fallbacki
            ch = at(i)
            if (tl > 1 && ch === terminated[0]) i += tl - 1
            break
          }
          // Need to strip trailing enclosing char?
          if (needEnd && ch === enclosed) {
            if (imp.finished && i === len - 1) ch = null
            else if (i === len - 1) {
              i = fallbacki
              ch = at(i)
              if (tl > 1 && ch === terminated[0]) i += tl - 1
              break
            } else {
              i++
              ch = at(i)
              term()
            }
          }
          // Are we at the end?
          if (isNl(ch) || (imp.finished && i === len - 1)) csvFinish = true
          // Go to next char
          if (ch === terminated) {
            if (i === len - 1) {
              i = fallbacki
              ch = at(i)
              if (tl > 1 && ch === terminated[0]) i += tl - 1
              break
            }
            i++
            ch = at(i)
            term()
          }
          // If everything went okay, store value
          values.push(value)
        }
        // End of line
        if (!csvFinish && !isNl(ch)) continue
        if (newLine === 'auto' && ch === '\r') {
          // Handle "\r\n"
          if (i >= len - 2 && !imp.finished) break // We need more data to decide new line
          if (at(i + 1) === '\n') i++
        }
        // We didn't parse value till the end of line, so there was empty one
        if (!csvFinish) values.push('')
        if (!intoExistingTable) {
          maxCols = Math.max(maxCols, values.length)
          rows.push(values)
        } else {
          // Do we have correct count of values?
          if (values.length !== fields.length) {
            // Hack for excel
            if (values[values.length - 1] !== ';') {
              imp.message = imp.error('Invalid column count in CSV input on line %d.', line)
              imp.hasError = true
              break
            }
            values.pop()
          }
          await addRow(values)
        }
        line++
        csvFinish = false
        values = []
        buffer = buffer.slice(i + 1)
        len = buffer.length
        i = 0
        lasti = -1
        ch = buffer.slice(0, 1)
        if (maxLines > 0 && line === maxLinesConstraint) {
          imp.finished = true
          break
        }
      }
      if (maxLines > 0 && line === maxLinesConstraint) {
        imp.finished = true
        break
      }
    }

    if (!intoExistingTable) {
      await this.#buildSqlStructures(imp, rows, maxCols, {
        csvHasColumnNames,
        emptyAsNull,
        newDatabaseName,
        newTableName,
        ignore,
      })
    }
    // Commit any possible data in buffers
    await imp.runQuery('')
    if (values.length === 0 || imp.hasError) return
    imp.message = imp.error('Invalid format of CSV input on line %d.', line)
    imp.hasError = true
  }

  async #buildSqlStructures(
    imp: Import,
    rows0: Array<Array<string | null>>,
    maxCols: number,
    o: {
      csvHasColumnNames: boolean
      emptyAsNull: boolean
      newDatabaseName: string
      newTableName: string
      ignore: boolean
    },
  ): Promise<void> {
    /* Fill out all rows */
    let rows = rows0.map((row) => {
      const r = row.map((v) => (v === null ? null : unbin(v)))
      while (r.length < maxCols) r.push('NULL')
      return r
    })
    if (o.emptyAsNull) rows = rows.map((r) => r.map((v) => (v === null || v === '' ? 'NULL' : v)))
    let colNames: string[] = []
    /* Remove the first row if it contains the column names */
    if (o.csvHasColumnNames) colNames = (rows.shift() ?? []).map((v) => v ?? '')
    // getColumnNames
    if (o.csvHasColumnNames) colNames = colNames.map((c) => rtrimChars(c))
    if (colNames.length !== maxCols) {
      for (let k = 0; k < maxCols; ++k) colNames.push(`COL ${k + 1}`)
    }
    const tblName =
      o.newTableName !== ''
        ? o.newTableName
        : await imp.getNextAvailableTableName(imp.db, fileBaseName(imp.importFileName))
    const table: ImportTable = { tableName: tblName, columns: colNames, rows }
    /* Obtain the best-fit MySQL types for each column */
    const analysis = imp.analyzeTable(table)
    let newDb: string
    if (o.newDatabaseName !== '') newDb = o.newDatabaseName
    else newDb = `CSV_DB ${(await imp.dbi.fetchSingleColumn('SHOW DATABASES')).length + 1}`
    const dbName = imp.db !== '' ? imp.db : newDb
    if (imp.db === '') await imp.createDatabase(dbName, 'utf8', 'utf8_general_ci')
    await imp.buildSql(dbName, [table], [analysis], null, o.ignore ? 'INSERT IGNORE' : 'INSERT')
  }
}

/**
 * CSV import plugin using LOAD DATA (table scope only).
 * pma: src/Plugins/Import/ImportLdi.php
 */
export class ImportLdi extends AbstractImportCsv {
  get name(): string {
    return 'ldi'
  }

  protected setProperties(): ImportPluginProperties {
    const props: ImportPluginProperties = {
      name: 'ldi',
      text: 'CSV using LOAD DATA',
      extension: 'ldi',
      mimeType: '',
      options: null,
    }
    if (this.page.importType !== 'table') return props
    props.options = [
      this.generalOptions([
        textItem('ldi_columns', this.__('Column names: ')),
        boolItem('ldi_ignore', this.__('Do not abort on INSERT error')),
        boolItem('ldi_local_option', this.__('Use LOCAL keyword')),
      ]),
    ]
    return props
  }

  async doImport(imp: Import): Promise<void> {
    const r = imp.request
    const compression = imp.file?.compression ?? ''
    if (imp.importFile === 'none' || compression !== 'none' || imp.charsetConversion) {
      // We handle only some kind of data!
      imp.message = imp.error('This plugin does not support compressed imports!')
      imp.hasError = true
      return
    }
    const q = (s: string) => imp.dbi.quoteString(s)
    let sql = 'LOAD DATA'
    if (r.has('ldi_local_option')) sql += ' LOCAL'
    sql += ` INFILE ${q(imp.importFile)}`
    if (r.has('ldi_replace')) sql += ' REPLACE'
    else if (r.has('ldi_ignore')) sql += ' IGNORE'
    sql += ` INTO TABLE ${backquote(imp.table)}`
    const terminated = r.get('ldi_terminated') ?? ''
    const enclosed = r.get('ldi_enclosed') ?? ''
    const escaped = r.get('ldi_escaped') ?? ''
    let newLine = r.get('ldi_new_line') ?? ''
    const columns = r.get('ldi_columns') ?? ''
    if (terminated !== '') sql += ` FIELDS TERMINATED BY '${terminated}'`
    if (enclosed !== '') sql += ` ENCLOSED BY ${q(enclosed)}`
    if (escaped !== '') sql += ` ESCAPED BY ${q(escaped)}`
    if (newLine !== '') {
      if (newLine === 'auto') newLine = '\n'
      sql += ` LINES TERMINATED BY '${newLine}'`
    }
    if (imp.runner.skipQueries > 0) {
      sql += ` IGNORE ${imp.runner.skipQueries} LINES`
      imp.runner.skipQueries = 0
    }
    if (columns !== '') {
      const parts = columns.split(/,( ?)/).filter((_, k) => k % 2 === 0)
      sql += ` (${parts.map((p) => backquote(trimChars(p, ' \t\r\n\0\x0B`'))).join(', ')})`
    }
    await imp.runQuery(sql)
    await imp.runQuery('')
    imp.finished = true
  }
}

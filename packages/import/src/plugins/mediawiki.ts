import type { Import } from '../import.ts'
import { ImportPlugin, type ImportPluginProperties } from '../plugin.ts'
import { trimChars } from '../strings.ts'
import { fileBaseName } from './csv.ts'

const trim = (s: string) => trimChars(s)

/**
 * Handles the import for the MediaWiki format.
 * pma: src/Plugins/Import/ImportMediawiki.php
 */
export class ImportMediawiki extends ImportPlugin {
  get name(): string {
    return 'mediawiki'
  }

  protected setProperties(): ImportPluginProperties {
    return {
      name: 'mediawiki',
      text: this.__('MediaWiki Table'),
      extension: 'txt',
      mimeType: 'text/plain',
      options: null,
    }
  }

  async doImport(imp: Import): Promise<void> {
    const analyze = imp.importType !== 'table'
    let buffer = ''
    let lastChunkLine = ''
    let insideComment = false
    let insideDataComment = false
    let insideStructureComment = false
    // MediaWiki only accepts "\n" as row terminator
    const nl = '\n'
    let curTableName = ''
    let curTempTableHeaders: string[] = []
    let curTempTable: string[][] = []
    let inTableHeader = false
    const decoder = new TextDecoder('utf-8')
    while (!imp.finished && !imp.hasError && !imp.timeoutPassed) {
      const data = imp.getNextChunk()
      if (data === false) {
        // Subtract data we didn't handle yet and stop processing
        imp.offset -= Array.from(buffer).length
        break
      }
      if (data !== true) {
        // Append new data to buffer (sic: phpMyAdmin replaces it)
        buffer = decoder.decode(data, { stream: !imp.finished })
        // Don't parse string if we're not at the end and don't have a new line inside
        if (!buffer.includes(nl)) continue
      }
      buffer = lastChunkLine + buffer
      const bufferLines = buffer.split(nl)
      let count = bufferLines.length
      if (!imp.finished) lastChunkLine = bufferLines[--count] as string
      let curTempLine: string[] = []
      for (let lineNr = 0; lineNr < count; ++lineNr) {
        let cur = trim(bufferLines[lineNr] as string)
        if (cur === '') continue
        const first = cur[0]
        // Check beginning of comment
        if (cur.startsWith('<!--')) {
          insideComment = true
          continue
        }
        if (insideComment) {
          // Check end of comment
          if (cur.startsWith('-->')) {
            if (insideDataComment) insideDataComment = false
            if (!insideStructureComment) insideComment = false
          } else {
            const data = /^Table data for `(.*)`$/.exec(cur)
            if (data !== null) {
              curTableName = data[1] as string
              insideDataComment = true
              insideStructureComment = false
            } else if (/^Table structure for `(.*)`$/.test(cur)) {
              // The structure comments will be ignored
              insideStructureComment = true
            }
          }
          continue
        }
        if (/^\{\|(.*)$/.test(cur)) {
          // Check start of table
          curTempTable = []
          curTempLine = []
          inTableHeader = false
        } else if (cur.startsWith('|-') || cur.startsWith('|+') || cur.startsWith('|}')) {
          // Add current line to the values storage
          if (curTempLine.length > 0) {
            if (inTableHeader) curTempTableHeaders = curTempLine
            else curTempTable.push(curTempLine)
          }
          curTempLine = []
          // No more processing required at the end of the table
          if (cur.startsWith('|}')) {
            await this.#importDataOneTable(imp, analyze, {
              tableName: curTableName,
              columns: curTempTableHeaders,
              rows: curTempTable,
            })
            curTableName = ''
          }
        } else if (first === '|' || first === '!') {
          if (first === '!') {
            cur = cur.replaceAll('!!', '||')
            inTableHeader = true
          } else inTableHeader = false
          for (const c of explodeMarkup(cur)) {
            let cell = trim(getCellData(c))
            for (const colStartChar of ['|', '!']) {
              if (cell.startsWith(colStartChar)) cell = trim(Array.from(cell).slice(1).join(''))
            }
            curTempLine.push(cell)
          }
        } else {
          // If it's none of the above, then the current line has a bad format
          imp.hasError = true
        }
      }
    }
  }

  async #importDataOneTable(
    imp: Import,
    analyze: boolean,
    table: { tableName: string; columns: string[]; rows: Array<Array<string | null>> },
  ): Promise<void> {
    if (analyze) {
      if (table.tableName === '') {
        table.tableName = await imp.getNextAvailableTableName(imp.db, fileBaseName(imp.importFileName))
      }
      // Set generic names for table headers if they don't exist
      if (table.columns.length === 0) {
        const n = table.rows[0]?.length ?? 0
        for (let i = 0; i < n; ++i) table.columns.push(`COL ${i + 1}`)
      }
      const analysis = imp.analyzeTable(table)
      const dbName = imp.db !== '' ? imp.db : 'mediawiki_DB'
      if (imp.db === '') await imp.createDatabase(dbName, 'utf8', 'utf8_general_ci')
      await imp.buildSql(dbName, [table], [analysis])
    }
    // Commit any possible data in buffers
    await imp.runQuery('')
  }
}

/** ImportMediawiki::delimiterReplace */
function delimiterReplace(replace: string, subject: string): string {
  let cleaned = ''
  let insideTag = false
  let insideAttribute = false
  let startAttributeCharacter: string | false = false
  let partialSeparator = false
  // byte-wise in PHP; the special characters are all ASCII
  for (const curChar of subject) {
    if (curChar === '|') {
      if (!insideAttribute) {
        cleaned += curChar
        if (partialSeparator) {
          insideTag = false
          insideAttribute = false
        }
      } else if (partialSeparator) cleaned += replace
      partialSeparator = !partialSeparator
    } else {
      if (partialSeparator && insideAttribute) cleaned += '|'
      partialSeparator = false
      cleaned += curChar
      if (curChar === '<' && !insideAttribute) insideTag = true
      else if (curChar === '>' && !insideAttribute) insideTag = false
      else if ((curChar === '"' || curChar === "'") && insideTag) {
        if (!insideAttribute) {
          insideAttribute = true
          startAttributeCharacter = curChar
        } else if (curChar === startAttributeCharacter) {
          insideAttribute = false
          startAttributeCharacter = false
        }
      }
    }
  }
  return cleaned
}

/** ImportMediawiki::explodeMarkup */
function explodeMarkup(text0: string): string[] {
  const placeholder = '\x00'
  const text = text0.replaceAll(placeholder, '')
  const cleaned = delimiterReplace(placeholder, text)
  return cleaned.split('||').map((s) => s.replaceAll(placeholder, '||'))
}

/** ImportMediawiki::getCellData */
function getCellData(cell: string): string {
  const i = cell.indexOf('|')
  const first = i < 0 ? cell : cell.slice(0, i)
  // A '|' inside an invalid link should not be mistaken as delimiting cell parameters
  if (!first.includes('[[')) return cell
  if (i < 0) return first
  return cell.slice(i + 1)
}

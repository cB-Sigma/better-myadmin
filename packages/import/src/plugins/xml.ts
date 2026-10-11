import { backquote } from '@bettermyadmin/sql-gen'
import type { AnalysedColumn, Import, ImportTable } from '../import.ts'
import { ImportPlugin, type ImportPluginProperties } from '../plugin.ts'
import { attr, child, children, loadXml, namespaces, text } from '../xml.ts'

/**
 * Handles the import for the XML format (phpMyAdmin's own XML export).
 * pma: src/Plugins/Import/ImportXml.php
 */
export class ImportXml extends ImportPlugin {
  get name(): string {
    return 'xml'
  }

  protected setProperties(): ImportPluginProperties {
    return { name: 'xml', text: this.__('XML'), extension: 'xml', mimeType: 'text/xml', options: null }
  }

  async doImport(imp: Import): Promise<void> {
    const parts: Buffer[] = []
    while (!imp.finished && !imp.hasError && !imp.timeoutPassed) {
      const data = imp.getNextChunk()
      if (data === false) break
      if (data === true) continue
      parts.push(data)
    }
    const xml = loadXml(Buffer.concat(parts).toString('utf8'))
    const malformed = () => {
      // echo Message::error(…)->getDisplay()
      imp.echoed.push(
        imp.__(
          'The XML file specified was either malformed or incomplete. Please correct the issue and try again.',
        ),
      )
      imp.finished = false
    }
    if (xml === false) return malformed()
    const ns = namespaces(xml)
    const pma = ns.pma ?? null
    // Get the database name, collation and charset
    const schemas = children(xml, pma).find((c) => c.localName === 'structure_schemas')
    const dbEl = schemas === undefined ? null : child(schemas, 'database')
    let dbName: string
    let collation: string | null = null
    let charset: string | null = null
    if (pma !== null && dbEl !== null) {
      dbName = attr(dbEl, 'name')
      collation = attr(dbEl, 'collation')
      charset = attr(dbEl, 'charset')
    } else {
      // If the structure section is not present get the database name from the data section
      const first = children(xml, null)[0]
      dbName = first === undefined ? '' : attr(first, 'name')
    }
    if (dbName === '') return malformed()
    // CREATE code included (by default: no)
    const structPresent = pma !== null
    let create: string[] | null = []
    if (structPresent) {
      for (const val1 of children(xml, pma)) {
        for (const val2 of children(val1, pma)) {
          create.push(`USE ${backquote(attr(val2, 'name'))}`)
          for (const val3 of children(val2, pma)) {
            // Remove the extra cosmetic spacing
            create.push(text(val3).replaceAll('                ', ''))
          }
        }
      }
    }
    // Move down the XML tree to the actual data
    let analyses: AnalysedColumn[][] | null = null
    const byName = new Map<string, ImportTable>()
    let databaseName = ''
    const databaseXml = child(xml, 'database', null)
    if (databaseXml !== null) {
      databaseName = attr(databaseXml, 'name')
      for (const rowXml of children(databaseXml, null).filter((c) => c.localName === 'table')) {
        const tableName = attr(rowXml, 'name')
        const table = byName.get(tableName) ?? { tableName, columns: [], rows: [] }
        const row: string[] = []
        for (const cellXml of children(rowXml, null).filter((c) => c.localName === 'column')) {
          const columnName = attr(cellXml, 'name')
          if (!table.columns.includes(columnName)) table.columns.push(columnName)
          row.push(text(cellXml))
        }
        table.rows.push(row)
        byName.set(tableName, table)
      }
    }
    const tables = [...byName.values()]
    for (const t of tables) t.tableName = await imp.getNextAvailableTableName(databaseName, t.tableName)
    if (!structPresent) analyses = tables.map((t) => imp.analyzeTable(t))
    // Only build SQL from data if there is data present and no structure.
    if (!structPresent && tables.length > 0) create = null
    if (imp.db !== '') {
      // Override the database name in the XML file, if one is selected
      dbName = imp.db
    } else {
      await imp.createDatabase(dbName, charset ?? 'utf8', collation ?? 'utf8_general_ci')
    }
    await imp.buildSql(dbName, tables, analyses, create)
    // Commit any possible data in buffers
    await imp.runQuery('')
  }
}

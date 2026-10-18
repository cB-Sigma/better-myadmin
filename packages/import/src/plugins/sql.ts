import { boolItem, main, select } from '@bettermyadmin/export'
import { mbStrlen } from '@bettermyadmin/mysql-types'
import { BufferedQuery } from '@bettermyadmin/sql-lexer'
import type { Import } from '../import.ts'
import { ImportPlugin, type ImportPluginProperties } from '../plugin.ts'

/**
 * Handles the import for the SQL format.
 * pma: src/Plugins/Import/ImportSql.php
 */
export class ImportSql extends ImportPlugin {
  get name(): string {
    return 'sql'
  }

  protected setProperties(): ImportPluginProperties {
    const compats = this.page.compatibilities
    return {
      name: 'sql',
      text: 'SQL',
      extension: 'sql',
      mimeType: '',
      options:
        compats.length === 0
          ? null
          : [
              main('sql_general_opts', '', [
                select(
                  'sql_compatibility',
                  this.__('SQL compatibility mode:'),
                  compats.map((c) => [c, c]),
                  ['sql-mode'],
                ),
                boolItem(
                  'sql_no_auto_value_on_zero',
                  this.__('Do not use <code>AUTO_INCREMENT</code> for zero values'),
                  ['sql-mode', 'sqlmode_no_auto_value_on_zero'],
                ),
              ]),
            ],
    }
  }

  async doImport(imp: Import): Promise<void> {
    // Handle compatibility options.
    await this.#setSqlMode(
      imp,
      imp.request.get('sql_compatibility') ?? null,
      imp.request.has('sql_no_auto_value_on_zero'),
    )
    const bq = new BufferedQuery()
    const delimiter = imp.request.get('sql_delimiter')
    if (delimiter !== undefined) bq.setDelimiter(delimiter)
    imp.finished = false
    const decoder = new TextDecoder('utf-8')
    while (!imp.hasError && !imp.timeoutPassed) {
      // Getting the first statement, the remaining data and the last delimiter.
      const statement = bq.extract()
      // If there is no full statement, we are looking for more data.
      if (statement === false || statement === '') {
        const newData = imp.getNextChunk()
        // Subtract data we didn't handle yet and stop processing.
        if (newData === false) {
          imp.offset -= mbStrlen(bq.query)
          break
        }
        // Checking if the input buffer has finished.
        if (newData === true) {
          imp.finished = true
          break
        }
        const text = decoder.decode(newData, { stream: !imp.finished })
        // Convert CR (but not CRLF) to LF otherwise all queries may not get executed on some platforms.
        bq.append(text.replace(/\r($|[^\n])/g, '\n$1'))
        continue
      }
      await imp.runQuery(statement)
    }
    // Extracting remaining statements.
    while (!imp.hasError && !imp.timeoutPassed && bq.queryLength > 0) {
      const statement = bq.extract(true)
      if (statement === false || statement === '') continue
      await imp.runQuery(statement)
    }
    if (imp.hasError) return
    // Finishing.
    await imp.runQuery('')
  }

  async #setSqlMode(imp: Import, compat: string | null, noAutoValueOnZero: boolean): Promise<void> {
    const modes: string[] = []
    if (compat !== null && compat !== 'NONE') modes.push(compat)
    if (noAutoValueOnZero) modes.push('NO_AUTO_VALUE_ON_ZERO')
    if (modes.length === 0) return
    await imp.dbi.tryQuery(`SET SQL_MODE="${modes.join(',')}"`)
  }
}

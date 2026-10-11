import type { ImportPageContext, ImportPlugin } from './plugin.ts'
import { ImportCsv, ImportLdi } from './plugins/csv.ts'
import { ImportMediawiki } from './plugins/mediawiki.ts'
import { ImportOds } from './plugins/ods.ts'
import { ImportShp } from './plugins/shp.ts'
import { ImportSql } from './plugins/sql.ts'
import { ImportXml } from './plugins/xml.ts'

type PluginClass = new (page: ImportPageContext) => ImportPlugin

/**
 * ImportFormat: name → plugin class.
 * pma: src/Plugins/Import/ImportFormat.php
 */
export const IMPORT_PLUGINS: Record<string, PluginClass> = {
  csv: ImportCsv,
  ldi: ImportLdi,
  mediawiki: ImportMediawiki,
  ods: ImportOds,
  shp: ImportShp,
  sql: ImportSql,
  xml: ImportXml,
}

/** ImportLdi::isAvailable: table scope only */
const available = (name: string, page: ImportPageContext) => name !== 'ldi' || page.importType === 'table'

export function createImportPlugin(name: string, page: ImportPageContext): ImportPlugin | null {
  const C = IMPORT_PLUGINS[name]
  return C === undefined ? null : new C(page)
}

/** Plugins::getImport: the available plugins, sorted by their display text */
export function listImportPlugins(page: ImportPageContext): ImportPlugin[] {
  const out: ImportPlugin[] = []
  for (const [name, C] of Object.entries(IMPORT_PLUGINS)) if (available(name, page)) out.push(new C(page))
  return out.sort((a, b) => {
    const x = a.properties.text.toLowerCase()
    const y = b.properties.text.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  })
}

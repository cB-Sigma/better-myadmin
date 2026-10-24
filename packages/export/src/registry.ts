import type { ExportPlugin, PluginContext } from './plugin.ts'
import { ExportCodegen } from './plugins/codegen.ts'
import { ExportCsv, ExportExcel } from './plugins/csv.ts'
import { ExportHtmlword } from './plugins/htmlword.ts'
import { ExportJson } from './plugins/json.ts'
import { ExportLatex } from './plugins/latex.ts'
import { ExportOds, ExportOdt } from './plugins/opendocument.ts'
import { ExportJsmodule, ExportToon, ExportYaml } from './plugins/simple.ts'
import { ExportSql } from './plugins/sql.ts'
import { ExportMediawiki, ExportTexytext } from './plugins/text.ts'
import { ExportXml } from './plugins/xml.ts'

type PluginClass = new (ctx: PluginContext) => ExportPlugin

/** name → plugin class (Plugins::getPlugin('export', name)) */
export const EXPORT_PLUGINS: Record<string, PluginClass> = {
  codegen: ExportCodegen,
  csv: ExportCsv,
  excel: ExportExcel,
  htmlword: ExportHtmlword,
  jsmodule: ExportJsmodule,
  json: ExportJson,
  latex: ExportLatex,
  mediawiki: ExportMediawiki,
  ods: ExportOds,
  odt: ExportOdt,
  sql: ExportSql,
  texytext: ExportTexytext,
  toon: ExportToon,
  xml: ExportXml,
  yaml: ExportYaml,
}

/**
 * Whether a plugin is offered in this scope. ExportXml needs a database (it is skipped on the
 * server export page); ExportPdf needs TCPDF, which is not ported (the reference build ships
 * without it, so it never offers PDF either).
 * pma: src/Plugins/Export/ExportXml.php::isAvailable, ExportPdf.php::isAvailable
 */
export const PLUGIN_AVAILABLE: Record<string, (ctx: PluginContext) => boolean> = {
  xml: (ctx) => ctx.db !== '',
}

export function createPlugin(name: string, ctx: PluginContext): ExportPlugin | null {
  const C = EXPORT_PLUGINS[name.toLowerCase()]
  return C === undefined ? null : new C(ctx)
}

/** Plugins::getExport: every available plugin, sorted case-insensitively by display text */
export function listPlugins(ctx: PluginContext): ExportPlugin[] {
  const out: ExportPlugin[] = []
  for (const [name, C] of Object.entries(EXPORT_PLUGINS)) {
    const avail = PLUGIN_AVAILABLE[name]
    if (avail !== undefined && !avail(ctx)) continue
    out.push(new C(ctx))
  }
  return out.sort((a, b) => {
    const x = a.properties.text.toLowerCase()
    const y = b.properties.text.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  })
}

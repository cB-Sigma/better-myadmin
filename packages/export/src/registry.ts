import type { ExportPlugin, PluginContext } from './plugin.ts'
import { ExportSql } from './plugins/sql.ts'

type PluginClass = new (ctx: PluginContext) => ExportPlugin

/** name → plugin class (Plugins::getPlugin('export', name)) */
export const EXPORT_PLUGINS: Record<string, PluginClass> = {
  sql: ExportSql,
}

/** Whether a plugin is offered in this scope (ExportXml needs a database; PDF needs TCPDF). */
export const PLUGIN_AVAILABLE: Record<string, (ctx: PluginContext) => boolean> = {}

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

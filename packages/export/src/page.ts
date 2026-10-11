import { COMPATIBILITIES, type ExportEnvironment } from './export.ts'
import { OutputHandler } from './output.ts'
import type { Params } from './params.ts'
import type { ExportType, PluginContext } from './plugin.ts'
import type { OptionItem, OptionMainGroup, PluginProperties } from './properties.ts'
import { listPlugins } from './registry.ts'
import { TableInfo } from './tables.ts'

/** An option control with its current value (Plugins::getDefault / ::checkboxCheck). */
export type OptionView = (
  | Exclude<OptionItem, { kind: 'subgroup' }>
  | { kind: 'subgroup'; name: string; text: string; header: OptionView | null; items: OptionView[] }
) & { value?: string; checked?: boolean }

export interface PluginView {
  name: string
  text: string
  extension: string
  forceFile: boolean
  options: Array<{ kind: 'main'; name: string; text: string; items: OptionView[] }> | null
}

/** A plugin context for listing plugins on a page (no dump is written). */
export async function pageContext(
  env: ExportEnvironment,
  o: { exportType: ExportType; singleTable: boolean; db: string; table: string; rawQuery: boolean },
): Promise<PluginContext> {
  const tables = new TableInfo(env.dbi)
  return {
    dbi: env.dbi,
    out: new OutputHandler({ write: () => {} }, { asFile: true, compression: '' }),
    relation: env.relation,
    tables,
    tr: env.tr,
    exportType: o.exportType,
    singleTable: o.singleTable,
    settings: env.config.Export,
    host: env.host,
    port: env.port,
    server: { host: env.host, verbose: env.verbose, httpHost: env.httpHost },
    tool: env.tool,
    db: o.db,
    table: o.table,
    charset: null,
    tableData: [],
    timeZone: env.timeZone,
    parserContext: env.parserContext,
    compatibilities: COMPATIBILITIES,
    rawQuery: o.rawQuery,
    currentTableIsView:
      o.exportType === 'table' && o.table !== '' ? await tables.isView(o.db, o.table) : false,
    now: env.now ?? new Date(),
  }
}

/**
 * The option tree with values: GET-repopulated values win, then (unless repopulating) the
 * `$cfg[type]` setting. `type` settings are `$cfg['Export']` or `$cfg['Import']`.
 * pma: src/Plugins.php::checkboxCheck, ::getDefault
 */
export function withValues(
  groups: readonly OptionMainGroup[] | null,
  settings: Record<string, unknown>,
  request: Params | null,
  repopulate: boolean,
  timeoutPassed = false,
  translate: (s: string) => string = (s) => s,
): PluginView['options'] {
  if (groups === null) return null
  const truthy = (v: unknown) =>
    v !== undefined && v !== null && v !== false && v !== '' && v !== 0 && v !== '0'
  const checked = (name: string): boolean =>
    request?.get(name) !== undefined ||
    (!repopulate && ((timeoutPassed && request?.get(name) !== undefined) || truthy(settings[name])))
  const value = (name: string): string => {
    const r = request?.get(name)
    if (r !== undefined && (repopulate || timeoutPassed)) return r
    const s = settings[name]
    if (s === undefined || s === null) return ''
    return typeof s === 'boolean' ? (s ? '1' : '') : String(s)
  }
  const one = (i: OptionItem): OptionView => {
    if (i.kind === 'subgroup') {
      return {
        kind: 'subgroup',
        name: i.name,
        text: i.text,
        header: i.header === null ? null : one(i.header),
        items: i.items.map(one),
      }
    }
    if (i.kind === 'bool') return { ...i, text: translate(i.text), checked: checked(i.name) }
    if (i.kind === 'message') return { ...i, text: translate(i.text) }
    return { ...i, text: translate(i.text), value: translate(value(i.name)) }
  }
  return groups.map((g) => ({ kind: 'main', name: g.name, text: g.text, items: g.items.map(one) }))
}

export function pluginViews(
  ctx: PluginContext,
  settings: Record<string, unknown>,
  request: Params | null,
  repopulate: boolean,
  list: Array<{ properties: PluginProperties; getTranslatedText(t: string): string }> = listPlugins(ctx),
): PluginView[] {
  return list.map((p) => ({
    name: p.properties.name,
    text: p.getTranslatedText(p.properties.text),
    extension: p.properties.extension,
    forceFile: p.properties.forceFile,
    options: withValues(p.properties.options, settings, request, repopulate, false, (t) =>
      p.getTranslatedText(t),
    ),
  }))
}

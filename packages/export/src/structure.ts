import type { Translator } from '@bettermyadmin/i18n'
import type { Context } from '@bettermyadmin/sql-lexer'
import type { ExportDbi, ExportRelation } from './dbi.ts'
import { COMPATIBILITIES } from './export.ts'
import { OutputHandler } from './output.ts'
import type { ExportSettings, PluginContext } from './plugin.ts'
import { ExportSql } from './plugins/sql.ts'
import { TableInfo } from './tables.ts'

/** The configuration storage as seen by a structure-only plugin: none (getTableDef never reads it). */
const NO_RELATION: ExportRelation = {
  pmadb: null,
  relationFeature: false,
  browserTransformationFeature: false,
  columnCommentsFeature: false,
  pdfFeature: null,
  tables: {},
  getForeignersInternal: async () => ({}),
  getForeignKeysData: async () => [],
  getMime: async () => null,
}

export interface StructurePluginOptions {
  dbi: ExportDbi
  tr: Translator
  /** the connection's parser context (keywords per version, sql_mode) */
  parserContext: Context
  /** $cfg['Export'] (remove_definer_from_definitions …) */
  settings?: ExportSettings
  /** setAutoIncrement() */
  autoIncrement?: boolean
}

/**
 * The SQL export plugin the way phpMyAdmin's table move/copy (TableMover::moveCopy) and
 * Tracker::createVersion get it: `Plugins::getPlugin('export', 'sql', ExportType::Table)`, then
 * `useSqlBackquotes(true)` (and `setAutoIncrement()` for a copy). No output: callers use
 * `getTableDef()` and the deferred `sqlConstraintsQuery` / `sqlIndexes` / `sqlAutoIncrements`.
 */
export function structurePlugin(o: StructurePluginOptions): ExportSql {
  const out = new OutputHandler({ write: () => {} }, { asFile: false, compression: '' })
  const ctx: PluginContext = {
    dbi: o.dbi,
    out,
    relation: NO_RELATION,
    tables: new TableInfo(o.dbi),
    tr: o.tr,
    exportType: 'table',
    singleTable: false,
    settings: o.settings ?? {},
    host: '',
    port: '',
    server: { host: '', verbose: '', httpHost: '' },
    tool: { name: '', version: '', url: '', runtime: '', runtimeLabel: '' },
    db: '',
    table: '',
    charset: null,
    tableData: [],
    timeZone: 'UTC',
    parserContext: o.parserContext,
    compatibilities: COMPATIBILITIES,
    rawQuery: false,
    currentTableIsView: false,
    now: new Date(),
  }
  const plugin = new ExportSql(ctx)
  plugin.useSqlBackquotes = true
  plugin.autoIncrement = o.autoIncrement === true
  return plugin
}

import type { Translator } from '@bettermyadmin/i18n'
import type { Context } from '@bettermyadmin/sql-lexer'
import type { ExportDbi, ExportRelation } from './dbi.ts'
import type { OutputHandler } from './output.ts'
import type { Params } from './params.ts'
import type { PluginProperties } from './properties.ts'
import type { TableInfo } from './tables.ts'

export type ExportType = 'server' | 'database' | 'table' | 'raw'
export type StructureOrData = 'structure' | 'data' | 'structure_and_data'

/** Alias information for db/table/columns (Export::mergeAliases shape). */
export type Aliases = Record<
  string,
  { alias?: string; tables?: Record<string, { alias?: string; columns?: Record<string, string> }> }
>

/** The `$cfg['Export']` settings the plugins read (defaults and remove_definer_from_definitions). */
export type ExportSettings = Record<string, unknown>

/** The tool named in dump headers (phpMyAdmin prints its own name, version and URL). */
export interface ToolInfo {
  name: string
  version: string
  url: string
  /** "PHP Version:" line: the runtime version */
  runtime: string
  runtimeLabel: string
}

/** Everything a plugin needs (phpMyAdmin's container services and static state). */
export interface PluginContext {
  dbi: ExportDbi
  out: OutputHandler
  relation: ExportRelation
  tables: TableInfo
  tr: Translator
  exportType: ExportType
  singleTable: boolean
  settings: ExportSettings
  /** $config->selectedServer host / port */
  host: string
  port: string
  tool: ToolInfo
  /** Current::$database / Current::$table */
  db: string
  table: string
  /** Current::$charset (the file charset; null when not sent) */
  charset: string | null
  /** Export::$tableData */
  tableData: string[]
  /** PHP's date.timezone, for localisedDate() */
  timeZone: string
  /** the parser context of the connection (Context::loadClosest + setMode on connect) */
  parserContext: Context
  /** DatabaseInterface::getCompatibilities() */
  compatibilities: string[]
  /** a raw query export (`raw_query` sent): the SQL plugin keeps its options at table scope */
  rawQuery: boolean
  /** Table::isView() of Current::$table (option labels at table scope) */
  currentTableIsView: boolean
  /** "now" of the dump (header dates) */
  now: Date
}

/**
 * Common interface of the export plugins; every output line goes through ctx.out.addLine.
 * pma: src/Plugins/ExportPlugin.php
 */
export abstract class ExportPlugin {
  readonly ctx: PluginContext
  protected structureOrData: StructureOrData = 'data'
  readonly properties: PluginProperties

  constructor(ctx: PluginContext) {
    this.ctx = ctx
    this.properties = this.setProperties()
  }

  abstract get name(): string
  protected abstract setProperties(): PluginProperties
  abstract setExportOptions(request: Params, settings: ExportSettings): void

  protected __(msgid: string): string {
    return this.ctx.tr.gettext(msgid)
  }

  protected addLine(line: string): Promise<void> {
    return this.ctx.out.addLine(line)
  }

  async exportHeader(): Promise<void> {}
  async exportFooter(): Promise<void> {}
  async exportDBHeader(_db: string, _dbAlias = ''): Promise<void> {}
  async exportDBFooter(_db: string): Promise<void> {}
  async exportDBCreate(_db: string, _dbAlias = ''): Promise<void> {}
  abstract exportData(db: string, table: string, sqlQuery: string, aliases?: Aliases): Promise<void>
  async exportRoutines(_db: string, _aliases: Aliases = {}): Promise<void> {}
  async exportEvents(_db: string): Promise<void> {}
  async exportRawQuery(_db: string, _sqlQuery: string): Promise<void> {}
  async exportStructure(_db: string, _table: string, _mode: string, _aliases: Aliases = {}): Promise<void> {}
  async exportMetadata(_db: string, _tables: string | string[], _types: string[]): Promise<void> {}

  includeStructure(): boolean {
    return this.structureOrData === 'structure' || this.structureOrData === 'structure_and_data'
  }

  includeData(): boolean {
    return this.structureOrData === 'data' || this.structureOrData === 'structure_and_data'
  }

  /** ExportPlugin::setStructureOrData */
  protected setStructureOrData(
    fromRequest: string | undefined,
    fromConfig: unknown,
    def: StructureOrData,
  ): StructureOrData {
    const ok = (v: unknown): v is StructureOrData =>
      v === 'structure' || v === 'data' || v === 'structure_and_data'
    if (ok(fromRequest)) return fromRequest
    if (ok(fromConfig)) return fromConfig
    return def
  }

  getDbAlias(aliases: Aliases, db: string): string {
    const a = aliases[db]?.alias
    return typeof a === 'string' && a !== '' && a !== '0' ? a : db
  }

  getTableAlias(aliases: Aliases, db: string, table: string): string {
    const a = aliases[db]?.tables?.[table]?.alias
    return typeof a === 'string' && a !== '' && a !== '0' ? a : table
  }

  getColumnAlias(aliases: Aliases, db: string, table: string, column: string): string {
    const a = aliases[db]?.tables?.[table]?.columns?.[column]
    return typeof a === 'string' && a !== '' && a !== '0' ? a : column
  }

  /** ExportPlugin::getAlias: the alias of a db, table or column name, '' when none */
  getAlias(aliases: Aliases, id: string): string {
    for (const [dbKey, db] of Object.entries(aliases)) {
      if (dbKey === id && typeof db.alias === 'string' && db.alias !== '' && db.alias !== '0') return db.alias
      if (db.tables === undefined) continue
      for (const [tableKey, table] of Object.entries(db.tables)) {
        if (tableKey === id && typeof table.alias === 'string' && table.alias !== '' && table.alias !== '0') {
          return table.alias
        }
        if (table.columns === undefined) continue
        for (const [colKey, col] of Object.entries(table.columns)) {
          if (colKey === id && typeof col === 'string' && col !== '' && col !== '0') return col
        }
      }
    }
    return ''
  }

  /** ExportPlugin::getRelationString: "ForeignTable (foreign_field)" */
  getRelationString(
    foreigners: Record<string, { foreign_table: string; foreign_field: string }>,
    fieldName: string,
    db: string,
    aliases: Aliases = {},
  ): string {
    const f = foreigners[fieldName]
    if (f === undefined) return ''
    const ffield = this.getColumnAlias(aliases, db, f.foreign_table, f.foreign_field)
    const ftable = this.getTableAlias(aliases, db, f.foreign_table)
    return `${ftable} (${ffield})`
  }

  getTranslatedText(text: string): string {
    return text
  }
}

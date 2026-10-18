import type { Translator } from '@bettermyadmin/i18n'
import { backquote } from '@bettermyadmin/sql-gen'
import { type Context, Parser, SelectStatement } from '@bettermyadmin/sql-lexer'
import { listEncodings } from './charset.ts'
import type { ExportDbi, ExportRelation } from './dbi.ts'
import { ExportError } from './errors.ts'
import { expandUserString } from './expand.ts'
import { OutputHandler as Output, type OutputHandler, type OutputSink } from './output.ts'
import { Params } from './params.ts'
import type { Aliases, ExportPlugin, ExportSettings, ExportType, PluginContext, ToolInfo } from './plugin.ts'
import { createPlugin } from './registry.ts'
import { TableInfo } from './tables.ts'

export type SeparateFiles = '' | 'server' | 'database'

/** The configuration directives the export reads. */
export interface ExportConfig {
  Export: ExportSettings
  ZipDump: boolean
  GZipDump: boolean
  CompressOnFly: boolean
  SaveDir: string
  RecodingEngine: string
  AvailableCharsets: readonly string[]
}

export interface ExportEnvironment {
  dbi: ExportDbi
  relation: ExportRelation
  tr: Translator
  config: ExportConfig
  host: string
  port: string
  tool: ToolInfo
  timeZone: string
  parserContext: Context
  /** $cfg['Servers'][$i]['verbose'] and the request's Host (expandUserString) */
  verbose: string
  httpHost: string
  now?: Date
  /** Encoding::canConvertKanji(): the request's language is Japanese */
  canConvertKanji?: boolean
}

/**
 * Types of metadata to export ("in the future these can be allowed to be selected by the user").
 * pma: src/Export/Export.php::getMetadataTypes
 */
export const METADATA_TYPES = [
  'column_info',
  'table_uiprefs',
  'tracking',
  'bookmark',
  'relation',
  'table_coords',
  'pdf_pages',
  'savedsearches',
  'central_columns',
  'export_templates',
]

/** Sanitize::sanitizeFilename */
export function sanitizeFilename(filename: string, replaceDots = false): string {
  const re = replaceDots ? /[^\p{N}\p{L}_-]/gu : /[^\p{N}\p{L}._-]/gu
  return filename.replace(re, '_')
}

/**
 * Export::mergeAliases: array_merge_recursive, then the second non-empty value wins a conflict.
 */
export function mergeAliases(a1: Aliases, a2: Aliases): Aliases {
  const pick = (v1: string | null | undefined, v2: string | null | undefined): string | undefined => {
    if (v1 === undefined) return v2 ?? undefined
    if (v2 === undefined) return v1 ?? undefined
    return (v2 !== '' && v2 !== null ? v2 : v1) ?? undefined
  }
  const out: Aliases = {}
  for (const dbName of new Set([...Object.keys(a1), ...Object.keys(a2)])) {
    const d1 = a1[dbName] ?? {}
    const d2 = a2[dbName] ?? {}
    const db: NonNullable<Aliases[string]> = {}
    const alias = pick(d1.alias ?? undefined, d2.alias ?? undefined)
    if (alias !== undefined) db.alias = alias
    if (d1.tables !== undefined || d2.tables !== undefined) {
      db.tables = {}
      for (const t of new Set([...Object.keys(d1.tables ?? {}), ...Object.keys(d2.tables ?? {})])) {
        const t1 = d1.tables?.[t] ?? {}
        const t2 = d2.tables?.[t] ?? {}
        const tbl: { alias?: string; columns?: Record<string, string> } = {}
        const ta = pick(t1.alias ?? undefined, t2.alias ?? undefined)
        if (ta !== undefined) tbl.alias = ta
        if (t1.columns !== undefined || t2.columns !== undefined) {
          tbl.columns = {}
          for (const c of new Set([...Object.keys(t1.columns ?? {}), ...Object.keys(t2.columns ?? {})])) {
            tbl.columns[c] = pick(t1.columns?.[c], t2.columns?.[c]) ?? ''
          }
        }
        db.tables[t] = tbl
      }
    }
    out[dbName] = db
  }
  return out
}

/** The aliases posted by the rename dialog (`aliases[db][alias]`, `…[tables][t][alias]`, `…[columns][c]`). */
export function aliasesFromParams(params: Params): Aliases | null {
  const tree = params.tree('aliases')
  if (tree === undefined) return null
  const out: Aliases = {}
  for (const [db, v] of Object.entries(tree)) {
    if (typeof v !== 'object' || v === null) continue
    const o = v as Record<string, unknown>
    const entry: NonNullable<Aliases[string]> = {}
    if (typeof o.alias === 'string') entry.alias = o.alias
    if (typeof o.tables === 'object' && o.tables !== null) {
      entry.tables = {}
      for (const [t, tv] of Object.entries(o.tables as Record<string, unknown>)) {
        if (typeof tv !== 'object' || tv === null) continue
        const to = tv as Record<string, unknown>
        const te: { alias?: string; columns?: Record<string, string> } = {}
        if (typeof to.alias === 'string') te.alias = to.alias
        if (typeof to.columns === 'object' && to.columns !== null) {
          te.columns = Object.fromEntries(
            Object.entries(to.columns as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === 'string',
            ),
          )
        }
        entry.tables[t] = te
      }
    }
    out[db] = entry
  }
  return Object.keys(out).length === 0 ? null : out
}

/** Thrown for request errors phpMyAdmin answers with a message instead of a dump. */
export class ExportRequestError extends Error {
  constructor(
    message: string,
    readonly code: 'missing' | 'bad_type' | 'no_tables',
  ) {
    super(message)
  }
}

export interface PreparedExport {
  plugin: ExportPlugin
  exportType: ExportType
  asFile: boolean
  compression: '' | 'zip' | 'gzip'
  separateFiles: SeparateFiles
  /** final file name (raw query: export.<ext>) */
  filename: string
  mimeType: string
  saveOnServer: boolean
  isQuickExport: boolean
  /** POSTed aliases (kept in the session for the Back link) */
  postedAliases: Aliases | null
  /** the file name template when "Use this for future exports" is ticked */
  rememberTemplate: string | null
  run(sink: OutputSink): Promise<void>
}

/**
 * The export: request parsing, plugin set-up, output mode and file name (ExportController), then
 * the dump walk (Export::exportServer / exportDatabase / exportTable / exportRawQuery).
 * pma: src/Controllers/Export/ExportController.php, src/Export/Export.php
 */
export async function prepareExport(env: ExportEnvironment, params: Params): Promise<PreparedExport> {
  const { dbi, tr, config } = env
  const quickOrCustom = params.get('quick_or_custom')
  const outputFormat = params.get('output_format')
  const compressionParam = params.str('compression')
  const asSeparateFiles = params.str('as_separate_files')
  const quickExportOnServer = params.get('quick_export_onserver')
  const onServerParam = params.get('onserver')
  const structureOrDataForced = !['', '0', undefined].includes(params.get('structure_or_data_forced'))
  const rememberTemplate = params.has('remember_template')
  const dbSelect = params.list('db_select') ?? params.get('db_select')
  let tableStructure = params.list('table_structure')
  const lockTables = params.has('lock_tables')
  const singleTable = params.has('single_table') ? !['', '0'].includes(params.str('single_table')) : false
  const charset = params.has('charset') ? params.str('charset') : null
  const maxSize = params.has('maxsize') ? params.str('maxsize') : ''
  const tableSelect = params.list('table_select') ?? []
  let tableData = params.list('table_data') ?? []
  const db = params.str('db')
  const table = params.str('table')
  const sqlQuery = params.str('sql_query')

  // sanitize this parameter which will be used below in a file inclusion
  const what = params.str('what').replace(/\.\.*/g, '.')
  if (what === '') throw new ExportRequestError(missing(tr, 'what'), 'missing')
  const exportTypeRaw = params.str('export_type')
  if (!['server', 'database', 'table', 'raw'].includes(exportTypeRaw)) {
    throw new ExportRequestError(missing(tr, 'export_type'), 'missing')
  }
  const exportType = exportTypeRaw as ExportType

  const tables = new TableInfo(dbi)
  const settings = config.Export

  // valid compression methods
  const compressionMethods: string[] = []
  if (config.ZipDump) compressionMethods.push('zip')
  if (config.GZipDump) compressionMethods.push('gzip')

  let separateFiles: SeparateFiles = ''
  const isQuickExport = quickOrCustom === 'quick'
  let saveOnServer = false
  let asFile: boolean
  let compression: '' | 'zip' | 'gzip' = ''
  if (outputFormat === 'astext') {
    asFile = false
  } else {
    asFile = true
    if (asSeparateFiles !== '' && compressionParam === 'zip') {
      if (asSeparateFiles === 'server' || asSeparateFiles === 'database') separateFiles = asSeparateFiles
    }
    if (compressionMethods.includes(compressionParam)) compression = compressionParam as 'zip' | 'gzip'
    if ((isQuickExport && quickExportOnServer) || (!isQuickExport && onServerParam)) {
      // Will we save dump on server?
      saveOnServer = config.SaveDir !== ''
    }
  }

  // Generate error url and check for needed variables
  let tableNames: string[] = []
  if (exportType === 'database') {
    if (db === '') throw new ExportRequestError(missing(tr, 'db'), 'missing')
    tableNames = tableSelect
  } else if (exportType === 'table') {
    if (db === '') throw new ExportRequestError(missing(tr, 'db'), 'missing')
    if (table === '') throw new ExportRequestError(missing(tr, 'table'), 'missing')
  }

  // Merge SQL Query aliases with Export aliases from export page,
  // Export page aliases are given more preference over SQL Query aliases.
  let aliases: Aliases = {}
  const first = new Parser(sqlQuery, { context: env.parserContext }).statements[0]
  if (first instanceof SelectStatement) aliases = first.getAliases(db) as unknown as Aliases
  const posted = aliasesFromParams(params)
  if (posted !== null) aliases = mergeAliases(aliases, posted)

  // Do we need to convert charset?
  const convertCharset =
    asFile &&
    config.RecodingEngine !== 'none' &&
    charset !== null &&
    charset !== 'utf-8' &&
    listEncodings(config.AvailableCharsets).includes(charset)
      ? charset
      : null

  // ExportController: knjenc / xkana when posted, used when Encoding::canConvertKanji()
  const kanji =
    env.canConvertKanji === true
      ? {
          enc: params.has('knjenc') ? params.str('knjenc') : '',
          kana: params.has('xkana') ? params.str('xkana') : '',
        }
      : null

  const now = env.now ?? new Date()
  const out: OutputHandler = new Output(
    { write: () => {} },
    {
      asFile,
      compression,
      compressOnFly: config.CompressOnFly,
      convertCharset,
    },
  )
  const ctx: PluginContext = {
    dbi,
    out,
    relation: env.relation,
    tables,
    tr,
    exportType,
    singleTable,
    settings,
    host: env.host,
    port: env.port,
    server: { host: env.host, verbose: env.verbose, httpHost: env.httpHost },
    tool: env.tool,
    db,
    table,
    charset,
    tableData,
    timeZone: env.timeZone,
    parserContext: env.parserContext,
    compatibilities: COMPATIBILITIES,
    rawQuery: params.has('raw_query'),
    currentTableIsView: exportType === 'table' ? await tables.isView(db, table) : false,
    now,
  }
  const plugin = createPlugin(what, ctx)
  // Check export type
  if (plugin === null) throw new ExportRequestError(tr.gettext('Bad type!'), 'bad_type')
  plugin.setExportOptions(params, settings)

  // Generate filename and mime type if needed
  let filename = ''
  let mimeType = ''
  if (asFile) {
    const filenameTemplate = params.str('filename_template')
    filename = getFinalFilename(
      plugin,
      compression,
      sanitizeFilename(await expandUserString(ctx, filenameTemplate), true),
    )
    mimeType =
      compression === 'gzip'
        ? 'application/x-gzip'
        : compression === 'zip'
          ? 'application/zip'
          : plugin.properties.mimeType
  }
  // For raw query export, filename will be export.extension
  if (exportType === 'raw') filename = getFinalFilename(plugin, compression, 'export')
  if (!saveOnServer && asFile) filename = sanitizeFilename(filename)

  if (!asFile && exportType === 'database' && tableNames.length === 0) {
    throw new ExportRequestError(tr.gettext('No tables found in database.'), 'no_tables')
  }

  const run = async (sink: OutputSink): Promise<void> => {
    // the sink is known now
    const handler = new Output(sink, {
      asFile,
      compression,
      compressOnFly: config.CompressOnFly,
      convertCharset,
      kanji,
    })
    ;(ctx as { out: OutputHandler }).out = handler
    const walker = new ExportWalker(ctx, handler, maxSize)
    try {
      // Re - initialize
      handler.clearBuffer()
      if ('setTables' in plugin && typeof plugin.setTables === 'function') {
        ;(plugin as unknown as { setTables(t: string[]): void }).setTables(tableNames)
      }
      // Add possibly some comments to export
      await plugin.exportHeader()
      // Builds the dump
      if (exportType === 'server') {
        await walker.exportServer(dbSelect ?? '', plugin, aliases, separateFiles)
      } else if (exportType === 'database') {
        if (tableStructure === undefined) tableStructure = []
        if (structureOrDataForced) {
          tableStructure = tableNames
          tableData = tableNames
          ctx.tableData.splice(0, ctx.tableData.length, ...tableNames)
        }
        const doIt = () =>
          walker.exportDatabase(
            db,
            tableNames,
            tableStructure ?? [],
            tableData,
            plugin,
            aliases,
            separateFiles,
          )
        if (lockTables) {
          await walker.lockTables(db, tableNames, 'READ')
          try {
            await doIt()
          } finally {
            await dbi.tryQuery('UNLOCK TABLES')
          }
        } else await doIt()
      } else if (exportType === 'raw') {
        await plugin.exportRawQuery(db, sqlQuery)
      } else {
        // We export just one table
        const allrows = params.str('allrows')
        const limitTo = params.str('limit_to', '0')
        const limitFrom = params.str('limit_from', '0')
        const doIt = () =>
          walker.exportTable(db, table, plugin, allrows, limitTo, limitFrom, sqlQuery, aliases)
        if (lockTables) {
          try {
            await walker.lockTables(db, [table], 'READ')
            await doIt()
          } finally {
            await dbi.tryQuery('UNLOCK TABLES')
          }
        } else await doIt()
      }
      await plugin.exportFooter()
    } catch (e) {
      if (!(e instanceof ExportError)) throw e
    }
    await handler.finish(separateFiles !== '', filename, now)
  }

  return {
    plugin,
    exportType,
    asFile,
    compression,
    separateFiles,
    filename,
    mimeType,
    saveOnServer,
    isQuickExport,
    postedAliases: posted,
    rememberTemplate: asFile && rememberTemplate ? params.str('filename_template') : null,
    run,
  }
}

/** DatabaseInterface::getCompatibilities */
export const COMPATIBILITIES = [
  'NONE',
  'ANSI',
  'DB2',
  'MAXDB',
  'MYSQL323',
  'MYSQL40',
  'MSSQL',
  'ORACLE',
  'TRADITIONAL',
]

function missing(tr: Translator, name: string): string {
  return tr.gettext('Missing parameter:').concat(` ${name}`)
}

/** Export::getFinalFilename */
export function getFinalFilename(plugin: ExportPlugin, compression: string, filename0: string): string {
  let filename = filename0
  // Grab basic dump extension and mime type
  // Check if the user already added extension;
  // get the substring where the extension would be if it was included
  const requiredExtension = `.${plugin.properties.extension}`
  const chars = [...filename]
  const userExtension = chars.slice(Math.max(0, chars.length - [...requiredExtension].length)).join('')
  if (userExtension.toLowerCase() !== requiredExtension) filename += requiredExtension
  // If dump is going to be compressed, add compression to extension
  if (compression === 'gzip') filename += '.gz'
  else if (compression === 'zip') filename += '.zip'
  return filename
}

/**
 * The dump walk every structured plugin sees.
 * pma: src/Export/Export.php::exportServer, ::exportDatabase, ::exportTable
 */
export class ExportWalker {
  readonly ctx: PluginContext
  readonly out: OutputHandler
  readonly tableMaxSizeInMb: string

  constructor(ctx: PluginContext, out: OutputHandler, tableMaxSizeInMb: string) {
    this.ctx = ctx
    this.out = out
    this.tableMaxSizeInMb = tableMaxSizeInMb
  }

  async exportServer(
    dbSelect: string | string[],
    plugin: ExportPlugin,
    aliases: Aliases,
    separateFiles: SeparateFiles,
  ): Promise<void> {
    let tmpSelect: string | undefined
    if (Array.isArray(dbSelect) && dbSelect.length > 0) tmpSelect = `|${dbSelect.join('|')}|`
    // Walk over databases
    for (const currentDb of await this.ctx.dbi.getDatabaseList()) {
      if (tmpSelect === undefined || !` ${tmpSelect}`.includes(`|${currentDb}|`)) continue
      const tables = await this.ctx.tables.getTables(currentDb)
      await this.exportDatabase(
        currentDb,
        tables,
        tables,
        tables,
        plugin,
        aliases,
        separateFiles === 'database' ? 'database' : '',
      )
      if (separateFiles !== 'server') continue
      this.out.saveObjectInBuffer(currentDb)
    }
  }

  async exportDatabase(
    db: string,
    tables: string[],
    tableStructure: string[],
    tableData: string[],
    plugin: ExportPlugin,
    aliases: Aliases,
    separateFiles: SeparateFiles,
  ): Promise<void> {
    const a = aliases[db]?.alias
    const dbAlias = typeof a === 'string' && a !== '' && a !== '0' ? a : ''
    await plugin.exportDBHeader(db, dbAlias)
    await plugin.exportDBCreate(db, dbAlias)
    if (separateFiles === 'database') this.out.saveObjectInBuffer('database', true)
    if (plugin.includeStructure()) {
      await plugin.exportRoutines(db, aliases)
      if (separateFiles === 'database') this.out.saveObjectInBuffer('routines')
    }
    const views: string[] = []
    for (const table of tables) {
      // if this is a view, collect it for later;
      // views must be exported after the tables
      const isView = await this.ctx.tables.isView(db, table)
      if (isView) views.push(table)
      if (plugin.includeStructure() && tableStructure.includes(table)) {
        // for a view, export a stand-in definition of the table
        // to resolve view dependencies (only when it's a single-file export)
        if (isView) {
          if (separateFiles === '') await plugin.exportStructure(db, table, 'stand_in', aliases)
        } else {
          if (await this.#exceedsMaxTableSize(db, table)) continue
          await plugin.exportStructure(db, table, 'create_table', aliases)
        }
      }
      // if this is a view or a merge table, don't export data
      if (plugin.includeData() && tableData.includes(table) && !isView) {
        const nonGeneratedCols = await this.ctx.tables.getNonGeneratedColumns(db, table)
        // Skip tables that cannot be read
        if (nonGeneratedCols.length === 0) continue
        const localQuery = `SELECT ${nonGeneratedCols.join(', ')} FROM ${backquote(db)}.${backquote(table)}`
        await plugin.exportData(db, table, localQuery, aliases)
      }
      // this buffer was filled, we save it and go to the next one
      if (separateFiles === 'database') this.out.saveObjectInBuffer(`table_${table}`)
      // now export the triggers (needs to be done after the data because
      // triggers can modify already imported tables)
      if (!plugin.includeStructure()) continue
      await plugin.exportStructure(db, table, 'triggers', aliases)
      if (separateFiles !== 'database') continue
      this.out.saveObjectInBuffer(`table_${table}`, true)
    }
    for (const view of views) {
      // no data export for a view
      if (!plugin.includeStructure()) continue
      await plugin.exportStructure(db, view, 'create_view', aliases)
      if (separateFiles !== 'database') continue
      this.out.saveObjectInBuffer(`view_${view}`)
    }
    await plugin.exportDBFooter(db)
    if (separateFiles === 'database') this.out.saveObjectInBuffer('extra')
    // Types of metadata to export.
    await plugin.exportMetadata(db, tables, METADATA_TYPES)
    if (separateFiles === 'database') this.out.saveObjectInBuffer('metadata')
    if (!plugin.includeStructure()) return
    await plugin.exportEvents(db)
    if (separateFiles !== 'database') return
    this.out.saveObjectInBuffer('events')
  }

  async exportTable(
    db: string,
    table: string,
    plugin: ExportPlugin,
    allrows: string | null,
    limitTo: string,
    limitFrom: string,
    sqlQuery0: string,
    aliases: Aliases,
  ): Promise<void> {
    let sqlQuery = sqlQuery0
    const a = aliases[db]?.alias
    const dbAlias = typeof a === 'string' && a !== '' && a !== '0' ? a : ''
    await plugin.exportDBHeader(db, dbAlias)
    const lt = phpNumber(limitTo)
    const lf = phpNumber(limitFrom)
    const addQuery =
      allrows === '0' && lt > 0 && lf >= 0 ? ` LIMIT ${lf > 0 ? `${limitFrom}, ` : ''}${limitTo}` : ''
    if (plugin.includeStructure()) {
      if (await this.ctx.tables.isView(db, table))
        await plugin.exportStructure(db, table, 'create_view', aliases)
      else await plugin.exportStructure(db, table, 'create_table', aliases)
    }
    // If this is an export of a single view, we have to export data;
    // for example, a PDF report
    // if it is a merge table, no data is exported
    if (plugin.includeData()) {
      let localQuery: string
      if (sqlQuery !== '') {
        // only preg_replace if needed
        if (addQuery !== '') {
          // remove trailing semicolon before adding a LIMIT
          sqlQuery = sqlQuery.replace(/;\s*$/, '')
        }
        localQuery = sqlQuery + addQuery
        await this.ctx.dbi.selectDb(db)
      } else {
        // Data is exported only for Non-generated columns
        const nonGeneratedCols = await this.ctx.tables.getNonGeneratedColumns(db, table)
        // Skip tables that cannot be read
        if (nonGeneratedCols.length === 0) return
        localQuery = `SELECT ${nonGeneratedCols.join(', ')} FROM ${backquote(db)}.${backquote(table)}${addQuery}`
      }
      await plugin.exportData(db, table, localQuery, aliases)
    }
    // now export the triggers (needs to be done after the data because
    // triggers can modify already imported tables)
    if (plugin.includeStructure()) await plugin.exportStructure(db, table, 'triggers', aliases)
    await plugin.exportDBFooter(db)
    await plugin.exportMetadata(db, table, METADATA_TYPES)
  }

  /** Export::lockTables */
  async lockTables(db: string, tables: string[], lockType = 'WRITE'): Promise<void> {
    const locks = tables.map((t) => `${backquote(db)}.${backquote(t)} ${lockType}`)
    await this.ctx.dbi.tryQuery(`LOCK TABLES ${locks.join(', ')}`)
  }

  async #exceedsMaxTableSize(db: string, table: string): Promise<boolean> {
    // Checking if the maximum table size constrain has been set
    // And if that constrain is a valid number or not
    if (
      !/^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(this.tableMaxSizeInMb)
    ) {
      return false
    }
    // This obtains the current table's size
    const q = (s: string) => this.ctx.dbi.quoteString(s)
    const v = await this.ctx.dbi.fetchValue(
      `SELECT data_length + index_length
                    from information_schema.TABLES
                    WHERE table_schema = ${q(db)}
                    AND table_name = ${q(table)}`,
    )
    //Converting the size to MB
    const size = (typeof v === 'string' ? Number.parseInt(v, 10) || 0 : 0) / (1024 * 1024)
    return size > Number(this.tableMaxSizeInMb)
  }
}

/** PHP's comparison of a numeric string with an int (`$limitTo > 0`) */
function phpNumber(s: string): number {
  const m = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(s)
  return m === null ? 0 : Number(m[0])
}

export { Params }

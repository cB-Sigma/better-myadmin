import { backquote } from '@bettermyadmin/sql-gen'
import { type MetaConn, firstColumn } from './conn.ts'
import { phpEmpty } from './php.ts'
import {
  DEFAULT_TABLE_NAMES,
  type RelationParameters,
  type RelationParamsArray,
  STORAGE_TABLE_DIRECTIVES,
  type StorageServer,
  type StorageTableDirective,
  relationParametersFromArray,
} from './relation-parameters.ts'
import { getCreateTableSqlQueries, upgradeColumnInfoSql } from './resources.ts'

export interface StorageMessage {
  type: 'error' | 'notice' | 'success'
  /** English text (phpMyAdmin's msgid with `args` filled in). */
  text: string
  /** The msgid and its sprintf arguments when `text` was built from one, for translation. */
  msgid?: string
  args?: string[]
}

/** RelationParameters::* work flags → the directive(s) they need. pma: Relation::checkRelationsParam $workToTable */
const WORK_TO_TABLE: ReadonlyArray<readonly [string, string | readonly string[]]> = [
  ['relwork', 'relation'],
  ['displaywork', ['relation', 'table_info']],
  ['bookmarkwork', 'bookmarktable'],
  ['pdfwork', ['table_coords', 'pdf_pages']],
  ['commwork', 'column_info'],
  ['mimework', 'column_info'],
  ['historywork', 'history'],
  ['recentwork', 'recent'],
  ['favoritework', 'favorite'],
  ['uiprefswork', 'table_uiprefs'],
  ['trackingwork', 'tracking'],
  ['userconfigwork', 'userconfig'],
  ['menuswork', ['users', 'usergroups']],
  ['navwork', 'navigationhiding'],
  ['savedsearcheswork', 'savedsearches'],
  ['centralcolumnswork', 'central_columns'],
  ['designersettingswork', 'designer_settings'],
  ['exporttemplateswork', 'export_templates'],
]

/** Directive → RelationParameters key it fills. pma: Relation::fillRelationParamsWithTableNames */
const DIRECTIVE_PARAM: Readonly<Record<StorageTableDirective, string>> = {
  bookmarktable: 'bookmark',
  relation: 'relation',
  table_info: 'table_info',
  table_coords: 'table_coords',
  column_info: 'column_info',
  pdf_pages: 'pdf_pages',
  history: 'history',
  recent: 'recent',
  favorite: 'favorite',
  table_uiprefs: 'table_uiprefs',
  tracking: 'tracking',
  userconfig: 'userconfig',
  users: 'users',
  usergroups: 'usergroups',
  navigationhiding: 'navigationhiding',
  savedsearches: 'savedsearches',
  central_columns: 'central_columns',
  designer_settings: 'designer_settings',
  export_templates: 'export_templates',
}

/** The order fillRelationParamsWithTableNames tests the directives in (its elseif chain). */
const FILL_ORDER: readonly StorageTableDirective[] = [
  'bookmarktable',
  'relation',
  'table_info',
  'table_coords',
  'column_info',
  'pdf_pages',
  'history',
  'recent',
  'favorite',
  'table_uiprefs',
  'tracking',
  'userconfig',
  'users',
  'usergroups',
  'navigationhiding',
  'savedsearches',
  'central_columns',
  'designer_settings',
  'export_templates',
]

/** checkTableAccess: single-table features probed after the paired ones, in this order. */
const SINGLE_ACCESS: ReadonlyArray<readonly [string, string]> = [
  ['export_templates', 'exporttemplateswork'],
  ['designer_settings', 'designersettingswork'],
  ['central_columns', 'centralcolumnswork'],
  ['savedsearches', 'savedsearcheswork'],
  ['navigationhiding', 'navwork'],
  ['bookmark', 'bookmarkwork'],
  ['userconfig', 'userconfigwork'],
  ['tracking', 'trackingwork'],
  ['table_uiprefs', 'uiprefswork'],
  ['favorite', 'favoritework'],
  ['recent', 'recentwork'],
  ['history', 'historywork'],
  ['relation', 'relwork'],
]

/**
 * Discovery, feature probing and auto-creation of the configuration storage, on the control
 * connection. Mutates `server` exactly like phpMyAdmin mutates `Config::$selectedServer`
 * (ZeroConf fills empty table names and `pmadb`).
 *
 * pma: src/ConfigStorage/Relation.php
 */
export class ConfigStorage {
  readonly conn: MetaConn
  readonly server: StorageServer
  /** `Current::$server > 0` */
  readonly hasServer: boolean
  #cache: RelationParameters | null

  constructor(
    conn: MetaConn,
    server: StorageServer,
    cached: RelationParameters | null = null,
    hasServer = true,
  ) {
    this.conn = conn
    this.server = server
    this.#cache = cached
    this.hasServer = hasServer
  }

  /** pma: Relation::getRelationParameters */
  async getRelationParameters(): Promise<RelationParameters> {
    if (this.#cache === null) this.#cache = relationParametersFromArray(await this.#checkRelationsParam())
    return this.#cache
  }

  get cached(): RelationParameters | null {
    return this.#cache
  }

  resetCache(): void {
    this.#cache = null
  }

  /** pma: Relation::canAccessStorageTable */
  async canAccessStorageTable(tableDbName: string): Promise<boolean> {
    return (await this.conn.tryQuery(`SELECT NULL FROM ${backquote(tableDbName)} LIMIT 0`)) !== false
  }

  /**
   * pma: Relation::tryUpgradeTransformations
   *
   * Parity note: phpMyAdmin stops consuming the upgrade's result sets after the first statement
   * without one, which leaves its control link "out of sync" so every later probe of that request
   * fails. We consume all results (docs/reference/parity-exceptions.md).
   */
  async tryUpgradeTransformations(): Promise<boolean> {
    const newCols = ['input_transformation', 'input_transformation_options']
    const query = `SHOW COLUMNS FROM ${backquote(this.server.pmadb)}.${backquote(String(this.server.column_info))} WHERE Field IN ('${newCols.join("', '")}')`
    const result = await this.conn.tryQuery(query)
    if (result === false) return false
    if (result.rows.length === 2) return true
    const upgrade = upgradeColumnInfoSql()
      .replaceAll('`phpmyadmin`', backquote(this.server.pmadb))
      .replaceAll('`pma__column_info`', backquote(String(this.server.column_info)))
    await this.conn.tryMultiQuery(upgrade)
    return this.conn.lastError === ''
  }

  /** pma: Relation::checkTableAccess */
  async #checkTableAccess(p: RelationParamsArray): Promise<RelationParamsArray> {
    const set = (k: string) => typeof p[k] === 'string'
    if (set('relation') && set('table_info')) {
      if (await this.canAccessStorageTable(String(p.table_info))) p.displaywork = true
    }
    if (set('table_coords') && set('pdf_pages')) {
      if (await this.canAccessStorageTable(String(p.table_coords))) {
        if (await this.canAccessStorageTable(String(p.pdf_pages))) p.pdfwork = true
      }
    }
    if (set('column_info')) {
      if (await this.canAccessStorageTable(String(p.column_info))) {
        p.commwork = true
        // phpMyAdmin 4.3+: check for the input transformations upgrade
        p.mimework = await this.tryUpgradeTransformations()
      }
    }
    if (set('users') && set('usergroups')) {
      if (await this.canAccessStorageTable(String(p.users))) {
        if (await this.canAccessStorageTable(String(p.usergroups))) p.menuswork = true
      }
    }
    for (const [setting, work] of SINGLE_ACCESS) {
      if (!set(setting)) continue
      if (!(await this.canAccessStorageTable(String(p[setting])))) continue
      p[work] = true
    }
    return p
  }

  /** pma: Relation::getTables via DatabaseInterface::getTables (control connection) */
  async #getTables(database: string): Promise<string[]> {
    if (database === '') return []
    const r = await this.conn.tryQuery(`SHOW TABLES FROM ${backquote(database)};`)
    return r === false ? [] : firstColumn(r)
  }

  /** pma: Relation::fillRelationParamsWithTableNames */
  async #fillRelationParamsWithTableNames(p: RelationParamsArray): Promise<RelationParamsArray | null> {
    if (this.arePmadbTablesAllDisabled()) return null
    const tables = await this.#getTables(this.server.pmadb)
    if (tables.length === 0) return null
    for (const table of tables) {
      const directive = FILL_ORDER.find((d) => table === this.server[d])
      if (directive !== undefined) p[DIRECTIVE_PARAM[directive]] = table
    }
    return p
  }

  /** pma: Relation::checkRelationsParam (the `allworks` it computes is unused by fromArray) */
  async #checkRelationsParam(): Promise<RelationParamsArray> {
    const p: RelationParamsArray = {}
    for (const [work] of WORK_TO_TABLE) p[work] = false
    p.allworks = false
    p.user = null
    p.db = null
    if (!this.hasServer || this.server.pmadb === '' || !(await this.conn.selectDb(this.server.pmadb))) {
      this.server.pmadb = ''
      return p
    }
    p.user = this.server.user
    p.db = this.server.pmadb
    const filled = await this.#fillRelationParamsWithTableNames(p)
    if (filled === null) return p
    return this.#checkTableAccess(filled)
  }

  /** pma: Relation::arePmadbTablesAllDisabled */
  arePmadbTablesAllDisabled(): boolean {
    return STORAGE_TABLE_DIRECTIVES.every((d) => this.server[d] === false)
  }

  /** pma: Relation::arePmadbTablesDefined */
  arePmadbTablesDefined(): boolean {
    return !STORAGE_TABLE_DIRECTIVES.some((d) => phpEmpty(this.server[d]))
  }

  /** pma: Relation::getConfigurationStorageDbName */
  getConfigurationStorageDbName(): string {
    return phpEmpty(this.server.pmadb) ? 'phpmyadmin' : this.server.pmadb
  }

  /** pma: Relation::getTableReplacementNames */
  #getTableReplacementNames(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const d of STORAGE_TABLE_DIRECTIVES) {
      const v = this.server[d]
      const table = DEFAULT_TABLE_NAMES[d]
      if (phpEmpty(v) || v === table) continue
      out[table] = String(v)
    }
    return out
  }

  /**
   * Creates the missing tables in `db` (or, with `create = false`, only adopts the existing ones),
   * fills the empty table directives with the default names and points `pmadb` at `db`.
   * Returns phpMyAdmin's `Current::$message` when an error stops it.
   *
   * pma: Relation::fixPmaTables
   */
  async fixPmaTables(db: string, create = true): Promise<StorageMessage | null> {
    if (this.arePmadbTablesAllDisabled()) return null
    const existing = await this.#getTables(db)
    const replacements = this.#getTableReplacementNames()
    let createQueries: Record<string, string> = {}
    if (create) {
      createQueries = getCreateTableSqlQueries(replacements)
      if (!(await this.conn.selectDb(db))) return { type: 'error', text: this.conn.lastError }
    }
    let foundOne = false
    for (const d of STORAGE_TABLE_DIRECTIVES) {
      const table = DEFAULT_TABLE_NAMES[d]
      // the feature is disabled by the user in config
      if (this.server[d] === false) continue
      if (!existing.includes(replacements[table] ?? table)) {
        if (!create) continue
        await this.conn.tryQuery(createQueries[table] as string)
        if (this.conn.lastError !== '') return { type: 'error', text: this.conn.lastError }
      }
      foundOne = true
      // do not override a user defined value, only fill if empty
      if (this.server[d] !== '') continue
      this.server[d] = table
    }
    if (!foundOne) return null
    this.server.pmadb = db
    this.#cache = null
    await this.getRelationParameters()
    return null
  }

  /** pma: Relation::createPmaDatabase */
  async createPmaDatabase(name: string): Promise<StorageMessage | null> {
    await this.conn.tryQuery(`CREATE DATABASE IF NOT EXISTS ${backquote(name)}`)
    const error = this.conn.lastError
    if (error === '') {
      this.#cache = null
      await this.getRelationParameters()
      return null
    }
    if (this.conn.lastErrno === 1044) {
      return {
        type: 'error',
        text: `You do not have necessary privileges to create a database named '${name}'. You may go to 'Operations' tab of any database to set up the phpMyAdmin configuration storage there.`,
        msgid:
          "You do not have necessary privileges to create a database named '%s'. You may go to 'Operations' tab of any database to set up the phpMyAdmin configuration storage there.",
        args: [name],
      }
    }
    return { type: 'error', text: error }
  }

  /**
   * ZeroConf probe run once the user is connected: adopt default-named tables in the configured
   * pmadb (or `phpmyadmin`), else in the current database.
   *
   * pma: Relation::initRelationParamsCache
   */
  async initRelationParamsCache(currentDb: string): Promise<void> {
    const storageDbName = this.server.pmadb !== '' ? this.server.pmadb : 'phpmyadmin'
    await this.fixPmaTables(storageDbName, false)
    if (this.server.pmadb !== '') return
    await this.fixPmaTables(currentDb, false)
  }
}

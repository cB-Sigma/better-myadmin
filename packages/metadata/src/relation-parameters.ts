/**
 * Which configuration-storage features work, and through which tables.
 *
 * pma: src/ConfigStorage/RelationParameters.php, src/ConfigStorage/Features/*.php
 */

/** The 19 `Servers[$i]` table-name directives, in phpMyAdmin's `fixPmaTables` order. */
export const STORAGE_TABLE_DIRECTIVES = [
  'bookmarktable',
  'relation',
  'table_info',
  'table_coords',
  'pdf_pages',
  'column_info',
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
] as const
export type StorageTableDirective = (typeof STORAGE_TABLE_DIRECTIVES)[number]

/** Default table name → directive. pma: Relation::fixPmaTables $tablesToFeatures */
export const DEFAULT_TABLE_NAMES: Readonly<Record<StorageTableDirective, string>> = {
  bookmarktable: 'pma__bookmark',
  relation: 'pma__relation',
  table_info: 'pma__table_info',
  table_coords: 'pma__table_coords',
  pdf_pages: 'pma__pdf_pages',
  column_info: 'pma__column_info',
  history: 'pma__history',
  recent: 'pma__recent',
  favorite: 'pma__favorite',
  table_uiprefs: 'pma__table_uiprefs',
  tracking: 'pma__tracking',
  userconfig: 'pma__userconfig',
  users: 'pma__users',
  usergroups: 'pma__usergroups',
  navigationhiding: 'pma__navigationhiding',
  savedsearches: 'pma__savedsearches',
  central_columns: 'pma__central_columns',
  designer_settings: 'pma__designer_settings',
  export_templates: 'pma__export_templates',
}

/**
 * The part of `$cfg['Servers'][$i]` (phpMyAdmin's `Config::$selectedServer`) the storage layer
 * reads and — through ZeroConf auto-detection — writes.
 */
export type StorageServer = {
  /** The logged-in MySQL user (`selectedServer['user']`). */
  user: string
  pmadb: string
  MaxTableUiprefs: number
  DisableIS: boolean
} & Record<StorageTableDirective, string | false>

export interface Feature {
  database: string
}

export interface RelationParameters {
  user: string | null
  db: string | null
  bookmarkFeature: (Feature & { bookmark: string }) | null
  browserTransformationFeature: (Feature & { columnInfo: string }) | null
  centralColumnsFeature: (Feature & { centralColumns: string }) | null
  columnCommentsFeature: (Feature & { columnInfo: string }) | null
  configurableMenusFeature: (Feature & { userGroups: string; users: string }) | null
  databaseDesignerSettingsFeature: (Feature & { designerSettings: string }) | null
  displayFeature: (Feature & { relation: string; tableInfo: string }) | null
  exportTemplatesFeature: (Feature & { exportTemplates: string }) | null
  favoriteTablesFeature: (Feature & { favorite: string }) | null
  navigationItemsHidingFeature: (Feature & { navigationHiding: string }) | null
  pdfFeature: (Feature & { pdfPages: string; tableCoords: string }) | null
  recentlyUsedTablesFeature: (Feature & { recent: string }) | null
  relationFeature: (Feature & { relation: string }) | null
  savedQueryByExampleSearchesFeature: (Feature & { savedSearches: string }) | null
  sqlHistoryFeature: (Feature & { history: string }) | null
  trackingFeature: (Feature & { tracking: string }) | null
  uiPreferencesFeature: (Feature & { tableUiPrefs: string }) | null
  userPreferencesFeature: (Feature & { userConfig: string }) | null
}

/** The flat array of Relation::checkRelationsParam (keys are RelationParameters::* constants). */
export type RelationParamsArray = Record<string, string | boolean | null>

/** RelationParameters::toArray() keys in phpMyAdmin's order (without `version`). */
export interface RelationParametersArray {
  user: string | null
  db: string | null
  bookmark: string | null
  central_columns: string | null
  column_info: string | null
  designer_settings: string | null
  export_templates: string | null
  favorite: string | null
  history: string | null
  navigationhiding: string | null
  pdf_pages: string | null
  recent: string | null
  relation: string | null
  savedsearches: string | null
  table_coords: string | null
  table_info: string | null
  table_uiprefs: string | null
  tracking: string | null
  userconfig: string | null
  usergroups: string | null
  users: string | null
  bookmarkwork: boolean
  mimework: boolean
  centralcolumnswork: boolean
  commwork: boolean
  menuswork: boolean
  designersettingswork: boolean
  displaywork: boolean
  exporttemplateswork: boolean
  favoritework: boolean
  navwork: boolean
  pdfwork: boolean
  recentwork: boolean
  relwork: boolean
  savedsearcheswork: boolean
  historywork: boolean
  trackingwork: boolean
  uiprefswork: boolean
  userconfigwork: boolean
  allworks: boolean
}

/** DatabaseName::tryFrom / TableName::tryFrom: non-empty string, ≤ 64 chars, no trailing space. */
export function validIdentifier(name: unknown): name is string {
  if (typeof name !== 'string' || name === '') return false
  if ([...name].length > 64) return false
  return !name.endsWith(' ')
}

const str = (v: unknown): string | null => (validIdentifier(v) ? v : null)
const on = (v: unknown): boolean => v === true

export function emptyRelationParameters(user: string | null = null): RelationParameters {
  return {
    user,
    db: null,
    bookmarkFeature: null,
    browserTransformationFeature: null,
    centralColumnsFeature: null,
    columnCommentsFeature: null,
    configurableMenusFeature: null,
    databaseDesignerSettingsFeature: null,
    displayFeature: null,
    exportTemplatesFeature: null,
    favoriteTablesFeature: null,
    navigationItemsHidingFeature: null,
    pdfFeature: null,
    recentlyUsedTablesFeature: null,
    relationFeature: null,
    savedQueryByExampleSearchesFeature: null,
    sqlHistoryFeature: null,
    trackingFeature: null,
    uiPreferencesFeature: null,
    userPreferencesFeature: null,
  }
}

/** pma: src/ConfigStorage/RelationParameters.php::fromArray */
export function relationParametersFromArray(
  input: RelationParamsArray | RelationParametersArray,
): RelationParameters {
  const p = input as RelationParamsArray
  const user = typeof p.user === 'string' && p.user !== '' ? p.user : null
  const database = str(p.db)
  if (database === null) return emptyRelationParameters(user)
  const rp = emptyRelationParameters(user)
  rp.db = database

  const one = <K extends string>(work: string, key: string, prop: K) => {
    if (!on(p[work])) return null
    const t = str(p[key])
    return t === null ? null : ({ database, [prop]: t } as Feature & Record<K, string>)
  }

  rp.bookmarkFeature = one('bookmarkwork', 'bookmark', 'bookmark')
  const columnInfo = str(p.column_info)
  if (on(p.mimework) && columnInfo !== null) rp.browserTransformationFeature = { database, columnInfo }
  if (on(p.commwork) && columnInfo !== null) rp.columnCommentsFeature = { database, columnInfo }
  rp.centralColumnsFeature = one('centralcolumnswork', 'central_columns', 'centralColumns')
  if (on(p.menuswork)) {
    const userGroups = str(p.usergroups)
    const users = str(p.users)
    if (userGroups !== null && users !== null) rp.configurableMenusFeature = { database, userGroups, users }
  }
  rp.databaseDesignerSettingsFeature = one('designersettingswork', 'designer_settings', 'designerSettings')
  const relation = str(p.relation)
  if (on(p.displaywork) && relation !== null) {
    const tableInfo = str(p.table_info)
    if (tableInfo !== null) rp.displayFeature = { database, relation, tableInfo }
  }
  rp.exportTemplatesFeature = one('exporttemplateswork', 'export_templates', 'exportTemplates')
  rp.favoriteTablesFeature = one('favoritework', 'favorite', 'favorite')
  rp.navigationItemsHidingFeature = one('navwork', 'navigationhiding', 'navigationHiding')
  if (on(p.pdfwork)) {
    const pdfPages = str(p.pdf_pages)
    const tableCoords = str(p.table_coords)
    if (pdfPages !== null && tableCoords !== null) rp.pdfFeature = { database, pdfPages, tableCoords }
  }
  rp.recentlyUsedTablesFeature = one('recentwork', 'recent', 'recent')
  if (on(p.relwork) && relation !== null) rp.relationFeature = { database, relation }
  rp.savedQueryByExampleSearchesFeature = one('savedsearcheswork', 'savedsearches', 'savedSearches')
  rp.sqlHistoryFeature = one('historywork', 'history', 'history')
  rp.trackingFeature = one('trackingwork', 'tracking', 'tracking')
  rp.uiPreferencesFeature = one('uiprefswork', 'table_uiprefs', 'tableUiPrefs')
  rp.userPreferencesFeature = one('userconfigwork', 'userconfig', 'userConfig')
  return rp
}

/** pma: RelationParameters::hasAllFeatures */
export function hasAllFeatures(rp: RelationParameters): boolean {
  return (
    rp.bookmarkFeature !== null &&
    rp.browserTransformationFeature !== null &&
    rp.centralColumnsFeature !== null &&
    rp.columnCommentsFeature !== null &&
    rp.configurableMenusFeature !== null &&
    rp.databaseDesignerSettingsFeature !== null &&
    rp.displayFeature !== null &&
    rp.exportTemplatesFeature !== null &&
    rp.favoriteTablesFeature !== null &&
    rp.navigationItemsHidingFeature !== null &&
    rp.pdfFeature !== null &&
    rp.recentlyUsedTablesFeature !== null &&
    rp.relationFeature !== null &&
    rp.savedQueryByExampleSearchesFeature !== null &&
    rp.sqlHistoryFeature !== null &&
    rp.trackingFeature !== null &&
    rp.uiPreferencesFeature !== null &&
    rp.userPreferencesFeature !== null
  )
}

/** pma: RelationParameters::toArray (minus `version`) */
export function relationParametersToArray(rp: RelationParameters): RelationParametersArray {
  return {
    user: rp.user,
    db: rp.db,
    bookmark: rp.bookmarkFeature?.bookmark ?? null,
    central_columns: rp.centralColumnsFeature?.centralColumns ?? null,
    column_info: rp.columnCommentsFeature?.columnInfo ?? rp.browserTransformationFeature?.columnInfo ?? null,
    designer_settings: rp.databaseDesignerSettingsFeature?.designerSettings ?? null,
    export_templates: rp.exportTemplatesFeature?.exportTemplates ?? null,
    favorite: rp.favoriteTablesFeature?.favorite ?? null,
    history: rp.sqlHistoryFeature?.history ?? null,
    navigationhiding: rp.navigationItemsHidingFeature?.navigationHiding ?? null,
    pdf_pages: rp.pdfFeature?.pdfPages ?? null,
    recent: rp.recentlyUsedTablesFeature?.recent ?? null,
    relation: rp.relationFeature?.relation ?? rp.displayFeature?.relation ?? null,
    savedsearches: rp.savedQueryByExampleSearchesFeature?.savedSearches ?? null,
    table_coords: rp.pdfFeature?.tableCoords ?? null,
    table_info: rp.displayFeature?.tableInfo ?? null,
    table_uiprefs: rp.uiPreferencesFeature?.tableUiPrefs ?? null,
    tracking: rp.trackingFeature?.tracking ?? null,
    userconfig: rp.userPreferencesFeature?.userConfig ?? null,
    usergroups: rp.configurableMenusFeature?.userGroups ?? null,
    users: rp.configurableMenusFeature?.users ?? null,
    bookmarkwork: rp.bookmarkFeature !== null,
    mimework: rp.browserTransformationFeature !== null,
    centralcolumnswork: rp.centralColumnsFeature !== null,
    commwork: rp.columnCommentsFeature !== null,
    menuswork: rp.configurableMenusFeature !== null,
    designersettingswork: rp.databaseDesignerSettingsFeature !== null,
    displaywork: rp.displayFeature !== null,
    exporttemplateswork: rp.exportTemplatesFeature !== null,
    favoritework: rp.favoriteTablesFeature !== null,
    navwork: rp.navigationItemsHidingFeature !== null,
    pdfwork: rp.pdfFeature !== null,
    recentwork: rp.recentlyUsedTablesFeature !== null,
    relwork: rp.relationFeature !== null,
    savedsearcheswork: rp.savedQueryByExampleSearchesFeature !== null,
    historywork: rp.sqlHistoryFeature !== null,
    trackingwork: rp.trackingFeature !== null,
    uiprefswork: rp.uiPreferencesFeature !== null,
    userconfigwork: rp.userPreferencesFeature !== null,
    allworks: hasAllFeatures(rp),
  }
}

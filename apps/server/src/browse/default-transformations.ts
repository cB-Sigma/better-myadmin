import type { RelationParameters } from '@bettermyadmin/metadata'

/**
 * Results::$transformationInfo: the columns phpMyAdmin always shows through a display
 * transformation (SQL or JSON highlighting, links) — system schema columns and the configuration
 * storage's own tables. Looked up with the lower-cased current database, table and column, like
 * phpMyAdmin (the configuration storage database is keyed with its name as configured).
 * pma: src/Display/Results.php::setDefaultTransformations
 */
const SQL = { mimetype: 'Text/Plain', transformation: 'output/text_plain_sql.php' }
const BLOB_SQL = { mimetype: 'Application/Octetstream', transformation: 'output/text_octetstream_sql.php' }
const JSON_TF = { mimetype: 'Text/Plain', transformation: 'output/text_plain_json.php' }
const LINK = { mimetype: 'Text/Plain', transformation: 'text_plain_link.php' }

export type DefaultTransformation = typeof SQL

const FIXED: Record<string, Record<string, Record<string, DefaultTransformation>>> = {
  information_schema: {
    events: { event_definition: SQL },
    processlist: { info: SQL },
    routines: { routine_definition: SQL },
    triggers: { action_statement: SQL },
    views: { view_definition: SQL },
  },
  mysql: {
    event: { body: BLOB_SQL, body_utf8: BLOB_SQL },
    general_log: { argument: SQL },
    help_category: { url: LINK },
    help_topic: { example: SQL, url: LINK },
    proc: { param_list: BLOB_SQL, returns: BLOB_SQL, body: BLOB_SQL, body_utf8: BLOB_SQL },
    slow_log: { sql_text: SQL },
  },
}

function storageColumns(rp: RelationParameters): Record<string, Record<string, DefaultTransformation>> {
  const rel: Record<string, Record<string, DefaultTransformation>> = {}
  if (rp.sqlHistoryFeature !== null) rel[rp.sqlHistoryFeature.history] = { sqlquery: SQL }
  if (rp.bookmarkFeature !== null) rel[rp.bookmarkFeature.bookmark] = { query: SQL }
  if (rp.trackingFeature !== null) rel[rp.trackingFeature.tracking] = { schema_sql: SQL, data_sql: SQL }
  if (rp.favoriteTablesFeature !== null) rel[rp.favoriteTablesFeature.favorite] = { tables: JSON_TF }
  if (rp.recentlyUsedTablesFeature !== null) rel[rp.recentlyUsedTablesFeature.recent] = { tables: JSON_TF }
  if (rp.savedQueryByExampleSearchesFeature !== null)
    rel[rp.savedQueryByExampleSearchesFeature.savedSearches] = { search_data: JSON_TF }
  if (rp.databaseDesignerSettingsFeature !== null)
    rel[rp.databaseDesignerSettingsFeature.designerSettings] = { settings_data: JSON_TF }
  if (rp.uiPreferencesFeature !== null) rel[rp.uiPreferencesFeature.tableUiPrefs] = { prefs: JSON_TF }
  if (rp.userPreferencesFeature !== null) rel[rp.userPreferencesFeature.userConfig] = { config_data: JSON_TF }
  if (rp.exportTemplatesFeature !== null)
    rel[rp.exportTemplatesFeature.exportTemplates] = { template_data: JSON_TF }
  return rel
}

/** The predefined transformation of a column of the result, or null. */
export function defaultTransformation(
  rp: RelationParameters | null,
  db: string,
  orgTable: string,
  orgName: string,
): DefaultTransformation | null {
  const dbLower = db.toLowerCase()
  const tables =
    FIXED[dbLower] ?? (rp !== null && rp.db !== null && rp.db === dbLower ? storageColumns(rp) : undefined)
  return tables?.[orgTable.toLowerCase()]?.[orgName.toLowerCase()] ?? null
}

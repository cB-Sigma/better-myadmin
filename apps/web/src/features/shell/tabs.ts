import type { DbTabKey, ServerTabKey, TableTabKey } from '@bettermyadmin/contracts'
import type { PmaIconName } from '@bettermyadmin/ui'

export interface TabDef {
  text: string
  icon: PmaIconName
  /** path below the scope root (`/s/$server`, `/s/$server/db/$db`, `…/t/$table`) */
  path: string
  /** further paths that mark the tab active (phpMyAdmin's `active` route lists) */
  activePaths?: string[]
  /** a path prefix marks the tab active (status/*, settings/*) */
  prefix?: boolean
}

/**
 * Server-scope tabs. pma: src/Menu.php::getServerTabs — order, icons, texts and active routes.
 * Visibility is decided by the server (GET /api/servers/:s returns the visible keys).
 */
export const SERVER_TABS: Record<ServerTabKey, TabDef> = {
  databases: { text: 'Databases', icon: 's_db', path: 'databases' },
  sql: { text: 'SQL', icon: 'b_sql', path: 'sql' },
  status: { text: 'Status', icon: 's_status', path: 'status', prefix: true },
  rights: {
    text: 'User accounts',
    icon: 's_rights',
    path: 'privileges',
    activePaths: ['user-groups'],
    prefix: true,
  },
  export: { text: 'Export', icon: 'b_export', path: 'export' },
  import: { text: 'Import', icon: 'b_import', path: 'import' },
  // pma: Menu.php — /preferences/manage, active on every /preferences/* route
  settings: {
    text: 'Settings',
    icon: 'b_tblops',
    path: 'preferences/manage',
    activePaths: ['preferences'],
    prefix: true,
  },
  binlog: { text: 'Binary log', icon: 's_tbl', path: 'binlog' },
  replication: { text: 'Replication', icon: 's_replication', path: 'replication' },
  vars: { text: 'Variables', icon: 's_vars', path: 'variables' },
  charset: { text: 'Charsets', icon: 's_asci', path: 'collations' },
  engine: { text: 'Engines', icon: 'b_engine', path: 'engines' },
  plugins: { text: 'Plugins', icon: 'b_plugin', path: 'plugins' },
}

/** pma: src/Menu.php::getDbTabs */
export const DB_TABS: Record<DbTabKey, TabDef> = {
  structure: { text: 'Structure', icon: 'b_props', path: 'structure' },
  sql: { text: 'SQL', icon: 'b_sql', path: 'sql' },
  search: { text: 'Search', icon: 'b_search', path: 'search' },
  query: { text: 'Query', icon: 's_db', path: 'multi-table-query' },
  export: { text: 'Export', icon: 'b_export', path: 'export' },
  import: { text: 'Import', icon: 'b_import', path: 'import' },
  operation: { text: 'Operations', icon: 'b_tblops', path: 'operations' },
  privileges: { text: 'Privileges', icon: 's_rights', path: 'privileges' },
  routines: { text: 'Routines', icon: 'b_routines', path: 'routines' },
  events: { text: 'Events', icon: 'b_events', path: 'events' },
  triggers: { text: 'Triggers', icon: 'b_triggers', path: 'triggers' },
  tracking: { text: 'Tracking', icon: 'eye', path: 'tracking' },
  designer: { text: 'Designer', icon: 'b_relations', path: 'designer' },
  central_columns: { text: 'Central columns', icon: 'centralColumns', path: 'central-columns' },
}

/** pma: src/Menu.php::getTableTabs (Browse = /sql with pos=0; Export with single_table=true) */
export const TABLE_TABS: Record<TableTabKey, TabDef> = {
  browse: { text: 'Browse', icon: 'b_browse', path: 'browse' },
  structure: { text: 'Structure', icon: 'b_props', path: 'structure', activePaths: ['relation'] },
  sql: { text: 'SQL', icon: 'b_sql', path: 'sql' },
  search: { text: 'Search', icon: 'b_search', path: 'search', activePaths: ['find-replace', 'zoom-search'] },
  insert: { text: 'Insert', icon: 'b_insrow', path: 'insert' },
  export: { text: 'Export', icon: 'b_tblexport', path: 'export' },
  import: { text: 'Import', icon: 'b_tblimport', path: 'import' },
  privileges: { text: 'Privileges', icon: 's_rights', path: 'privileges' },
  operation: { text: 'Operations', icon: 'b_tblops', path: 'operations' },
  tracking: { text: 'Tracking', icon: 'eye', path: 'tracking' },
  triggers: { text: 'Triggers', icon: 'b_triggers', path: 'triggers' },
}

/** Is the tab active for the current path (relative to the scope root, no leading slash)? */
export function isTabActive(def: TabDef, rest: string): boolean {
  const first = rest.split('/')[0] ?? ''
  for (const p of [def.path, ...(def.activePaths ?? [])]) {
    if (rest === p) return true
    if (def.prefix === true && first === p) return true
  }
  return false
}

/**
 * Default tab of a scope from DefaultTabServer / DefaultTabDatabase / DefaultTabTable (phpMyAdmin
 * route values) to our relative path ('' = the server home page).
 */
export function defaultServerPath(route: string): string {
  return (
    {
      '/': '',
      '/server/databases': 'databases',
      '/server/status': 'status',
      '/server/variables': 'variables',
      '/server/privileges': 'privileges',
    }[route] ?? ''
  )
}

export function defaultDatabasePath(route: string): string {
  return (
    {
      '/database/structure': 'structure',
      '/database/sql': 'sql',
      '/database/search': 'search',
      '/database/operations': 'operations',
    }[route] ?? 'structure'
  )
}

export function defaultTablePath(route: string): string {
  return (
    {
      '/sql': 'browse',
      '/table/structure': 'structure',
      '/table/sql': 'sql',
      '/table/search': 'search',
      '/table/change': 'insert',
    }[route] ?? 'browse'
  )
}

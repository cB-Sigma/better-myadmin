import { z } from 'zod'

/**
 * Configuration storage (pmadb) and the per-user metadata it backs.
 * docs/features/08-settings-preferences-pmadb.md, docs/architecture/06-data-and-metadata-model.md
 */

export const UiMessage = z.object({
  type: z.enum(['success', 'notice', 'error']),
  text: z.string(),
  detail: z.string().optional(),
})
export type UiMessage = z.infer<typeof UiMessage>

/** Where a per-user feature is stored: pmadb, BetterMyAdmin's local SQLite store, or nowhere (session only). */
export const MetadataStore = z.enum(['pmadb', 'local']).nullable()

// ---------------------------------------------------------------------------------------------
// Storage status (/check-relations) and creation
// ---------------------------------------------------------------------------------------------

/** RelationParameters::toArray() (without `version`). */
export const RelationParametersArray = z.object({
  user: z.string().nullable(),
  db: z.string().nullable(),
  bookmark: z.string().nullable(),
  central_columns: z.string().nullable(),
  column_info: z.string().nullable(),
  designer_settings: z.string().nullable(),
  export_templates: z.string().nullable(),
  favorite: z.string().nullable(),
  history: z.string().nullable(),
  navigationhiding: z.string().nullable(),
  pdf_pages: z.string().nullable(),
  recent: z.string().nullable(),
  relation: z.string().nullable(),
  savedsearches: z.string().nullable(),
  table_coords: z.string().nullable(),
  table_info: z.string().nullable(),
  table_uiprefs: z.string().nullable(),
  tracking: z.string().nullable(),
  userconfig: z.string().nullable(),
  usergroups: z.string().nullable(),
  users: z.string().nullable(),
  bookmarkwork: z.boolean(),
  mimework: z.boolean(),
  centralcolumnswork: z.boolean(),
  commwork: z.boolean(),
  menuswork: z.boolean(),
  designersettingswork: z.boolean(),
  displaywork: z.boolean(),
  exporttemplateswork: z.boolean(),
  favoritework: z.boolean(),
  navwork: z.boolean(),
  pdfwork: z.boolean(),
  recentwork: z.boolean(),
  relwork: z.boolean(),
  savedsearcheswork: z.boolean(),
  historywork: z.boolean(),
  trackingwork: z.boolean(),
  uiprefswork: z.boolean(),
  userconfigwork: z.boolean(),
  allworks: z.boolean(),
})
export type RelationParametersArray = z.infer<typeof RelationParametersArray>

export const StorageAction = z.enum(['create_pmadb', 'fixall_pmadb', 'fix_pmadb'])
export type StorageAction = z.infer<typeof StorageAction>

/** GET /api/servers/:s/metadata-storage/status?db= */
export const StorageStatusResponse = z.object({
  relationParameters: RelationParametersArray,
  /** `$cfg['Servers'][$i]['pmadb']` as configured (the notice is an error when non-empty). */
  pmadbConfigured: z.boolean(),
  zeroConf: z.boolean(),
  arePmadbTablesDefined: z.boolean(),
  arePmadbTablesAllDisabled: z.boolean(),
  configurationStorageDbName: z.string(),
  /** SQL_DIR, where create_tables.sql is (check_relations.twig `sql_dir`) */
  sqlDir: z.string(),
  /** Home page notice (HomeController), null when not shown. */
  homeNotice: UiMessage.nullable(),
  /** Database Operations notice (Operations/DatabaseController), null when not shown. */
  operationsNotice: UiMessage.nullable(),
  /** The one "Create" link check_relations.twig offers, if any. */
  offer: StorageAction.nullable(),
  /** One line per `$cfg['Servers'][$i][<table>]` row of the check page. */
  tables: z.array(z.object({ directive: z.string(), name: z.string().nullable(), ok: z.boolean() })),
  /** The feature lines of the check page, in its order. */
  features: z.array(z.object({ flag: z.string(), label: z.string(), enabled: z.boolean() })),
  /** Store serving each per-user feature (pmadb, local fallback, or none). */
  stores: z.object({
    bookmarks: MetadataStore,
    history: MetadataStore,
    recent: MetadataStore,
    favorite: MetadataStore,
    uiPrefs: MetadataStore,
    userConfig: MetadataStore,
  }),
  /** Error opening the control connection (phpMyAdmin then falls back to the user's link). */
  controlError: z.string().nullable(),
})
export type StorageStatusResponse = z.infer<typeof StorageStatusResponse>

/** POST /api/servers/:s/metadata-storage/create */
export const StorageCreateRequest = z.object({
  action: StorageAction,
  /** The current database (fixall_pmadb creates the storage there). */
  db: z.string().optional(),
})
export type StorageCreateRequest = z.infer<typeof StorageCreateRequest>
export const StorageCreateResponse = z.object({
  message: UiMessage.nullable(),
  status: StorageStatusResponse,
})
export type StorageCreateResponse = z.infer<typeof StorageCreateResponse>

// ---------------------------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------------------------

export const Bookmark = z.object({
  id: z.number().int(),
  dbase: z.string(),
  user: z.string(),
  label: z.string(),
  query: z.string(),
  isShared: z.boolean(),
  variableCount: z.number().int(),
})
export type Bookmark = z.infer<typeof Bookmark>

/** GET /api/servers/:s/bookmarks?db= (omit db for all databases, like the console) */
export const BookmarkListResponse = z.object({
  available: z.boolean(),
  allowSharedBookmarks: z.boolean(),
  bookmarks: z.array(Bookmark),
})

/** POST /api/servers/:s/bookmarks — "Bookmark this SQL query" (SqlController::addBookmark, Sql::storeTheQueryAsBookmark) */
export const BookmarkCreateRequest = z.object({
  db: z.string().default(''),
  label: z.string(),
  query: z.string(),
  /** bkm_all_users */
  shared: z.boolean().default(false),
  /** bkm_replace: delete own bookmarks with the same label in this database first */
  replace: z.boolean().default(false),
})
export type BookmarkListResponse = z.infer<typeof BookmarkListResponse>
export type BookmarkCreateRequest = z.input<typeof BookmarkCreateRequest>
export const BookmarkCreateResponse = z.object({ success: z.boolean(), message: UiMessage })
export type BookmarkCreateResponse = z.infer<typeof BookmarkCreateResponse>

/** POST /api/servers/:s/bookmarks/:id/run (ImportController, action_bookmark=0) */
export const BookmarkRunRequest = z.object({
  db: z.string().optional(),
  table: z.string().optional(),
  /** bookmark_variable[n], 1-based */
  variables: z.record(z.string()).optional(),
  /** action_bookmark_all: look the bookmark up regardless of its owner */
  allUsers: z.boolean().default(false),
  pos: z.number().int().min(0).default(0),
  maxRows: z.union([z.number().int().positive(), z.literal('all')]).optional(),
  /** no_history */
  noHistory: z.boolean().optional(),
})
export type BookmarkRunRequest = z.input<typeof BookmarkRunRequest>

export const BookmarkDeleteResponse = z.object({ success: z.boolean(), message: UiMessage.nullable() })
export type BookmarkDeleteResponse = z.infer<typeof BookmarkDeleteResponse>
/** GET /api/servers/:s/bookmarks/:id ("View only") */
export interface BookmarkShowResponse {
  bookmark: Bookmark
  message: UiMessage
}

/** GET /api/servers/:s/console/bookmarks (Console::getBookmarkContent) */
export const ConsoleBookmarksResponse = z.object({
  available: z.boolean(),
  welcomeMessage: z.string(),
  bookmarks: z.array(Bookmark),
})
export type ConsoleBookmarksResponse = z.infer<typeof ConsoleBookmarksResponse>

/** POST /api/servers/:s/console/bookmarks (/console/bookmark/add) */
export const ConsoleBookmarkAddRequest = z.object({
  db: z.string().default(''),
  label: z.string().default(''),
  bookmark_query: z.string().default(''),
  shared: z.boolean().default(false),
})
export const ConsoleBookmarkAddResponse = z.object({
  message: z.string(),
  data: z
    .object({
      bkm_database: z.string(),
      bkm_user: z.string(),
      bkm_sql_query: z.string(),
      bkm_label: z.string(),
    })
    .optional(),
  isShared: z.boolean().optional(),
})
export type ConsoleBookmarkAddRequest = z.input<typeof ConsoleBookmarkAddRequest>
export type ConsoleBookmarkAddResponse = z.infer<typeof ConsoleBookmarkAddResponse>

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

/** GET /api/servers/:s/sql/history — newest first; false when the history feature is off. */
export const HistoryResponse = z.object({
  history: z.union([
    z.literal(false),
    z.array(
      z.object({ db: z.string(), table: z.string(), sqlquery: z.string(), timevalue: z.string().optional() }),
    ),
  ]),
  queryHistoryDB: z.boolean(),
})
export type HistoryResponse = z.infer<typeof HistoryResponse>
export type HistoryEntry = Exclude<HistoryResponse['history'], false>[number]

// ---------------------------------------------------------------------------------------------
// Recent / favorite tables
// ---------------------------------------------------------------------------------------------

export const TableRef = z.object({ db: z.string().min(1), table: z.string().min(1) })
export type TableRef = z.infer<typeof TableRef>

/** GET /api/servers/:s/recent-favorite */
export const RecentFavoriteResponse = z.object({
  recent: z.array(TableRef),
  favorite: z.array(TableRef),
  numRecentTables: z.number().int(),
  numFavoriteTables: z.number().int(),
  /** Show the localStorage → pmadb sync once per session (getHtmlSyncFavoriteTables). */
  syncFavorites: z.boolean(),
})

/** POST /api/servers/:s/recent (RecentTableHandling middleware) */
export const RecentAddRequest = TableRef
export const RecentAddResponse = z.object({ recent: z.array(TableRef), message: UiMessage.nullable() })

/** POST /api/servers/:s/favorites (/database/structure/favorite-table) */
export const FavoriteRequest = z.object({
  db: z.string(),
  table: z.string().min(1),
  action: z.enum(['add', 'remove']),
  /** The browser's localStorage favoriteTables JSON (sha1(user) → list). */
  favoriteTables: z.string().default(''),
})
export const FavoriteResponse = z.object({
  changes: z.boolean(),
  message: UiMessage.optional(),
  /** sha1 of the MySQL user: the localStorage key */
  user: z.string().optional(),
  /** JSON for localStorage.favoriteTables */
  favoriteTables: z.string().optional(),
  favorite: z.array(TableRef).optional(),
  alreadyFavorite: z.boolean().optional(),
})

/** POST /api/servers/:s/favorites/sync (/sync-favorite-tables) */
export const FavoriteSyncRequest = z.object({ favoriteTables: z.string().default('') })
export const FavoriteSyncResponse = z.object({
  favoriteTables: z.string().optional(),
  favorite: z.array(TableRef).optional(),
})

// ---------------------------------------------------------------------------------------------
// Table UI preferences
// ---------------------------------------------------------------------------------------------

/** POST /api/servers/:s/databases/:db/tables/:t/uiprefs (/sql/set-column-preferences) */
export const UiPrefsRequest = z.object({
  /** comma separated column indexes */
  col_order: z.string().optional(),
  /** comma separated 0/1 */
  col_visib: z.string().optional(),
  table_create_time: z.string().nullable().optional(),
})
export const UiPrefsSetResponse = z.object({ success: z.boolean(), message: UiMessage.nullable() })

/** GET /api/servers/:s/databases/:db/tables/:t/uiprefs — validated values (Table::getUiProp) */
export const UiPrefsResponse = z.object({
  sorted_col: z.union([z.string(), z.literal(false)]),
  col_order: z.union([z.array(z.number().int()), z.literal(false)]),
  col_visib: z.union([z.array(z.number().int()), z.literal(false)]),
  /** table_create_time to post back with col_order / col_visib */
  createTime: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------
// User preferences (storage only; the Settings UI is a later milestone)
// ---------------------------------------------------------------------------------------------

export const PrefSource = z.enum(['default', 'config', 'user'])

/** GET /api/servers/:s/prefs */
export const PrefsResponse = z.object({
  storage: z.enum(['db', 'local', 'session']),
  mtime: z.number().int(),
  /** The stored flat map (`config_data`) as is. */
  configData: z.record(z.unknown()),
  /** Every user-preference directive: effective value and where it comes from. */
  values: z.record(
    z.object({
      value: z.unknown(),
      default: z.unknown(),
      config: z.unknown(),
      source: PrefSource,
      disallowed: z.boolean(),
    }),
  ),
})

/** POST /api/servers/:s/prefs — replace the whole map (UserPreferences::save) */
export const PrefsSaveRequest = z.object({ configData: z.record(z.unknown()) })
/** POST /api/servers/:s/prefs/option — one value (UserPreferencesHandler::setUserValue) */
export const PrefsOptionRequest = z.object({
  path: z.string().min(1),
  value: z.unknown(),
  /** Defaults to the phpMyAdmin default of the directive. */
  default: z.unknown().optional(),
})
export const PrefsSaveResponse = z.object({ success: z.boolean(), message: UiMessage.nullable() })

// ---------------------------------------------------------------------------------------------
// Navigation hiding
// ---------------------------------------------------------------------------------------------

/** GET /api/servers/:s/navigation/hidden?db= */
export const HiddenItemsResponse = z.object({
  available: z.boolean(),
  /** item_type → item names, for `db` (Navigation::getHiddenItems) */
  hidden: z.record(z.array(z.string())),
  /** db → number of hidden items (Node::getNavigationHidingData) */
  counts: z.record(z.number().int()),
})

/** POST /api/servers/:s/navigation/hide | /unhide */
export const NavItemRequest = z.object({
  itemName: z.string(),
  itemType: z.string(),
  dbName: z.string(),
})

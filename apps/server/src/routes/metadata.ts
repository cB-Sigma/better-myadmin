import { createHash } from 'node:crypto'
import { serverDefaults } from '@bettermyadmin/config'
import {
  BookmarkCreateRequest,
  BookmarkRunRequest,
  ConsoleBookmarkAddRequest,
  FavoriteRequest,
  FavoriteSyncRequest,
  NavItemRequest,
  PrefsOptionRequest,
  PrefsSaveRequest,
  type QueryResponse,
  RecentAddRequest,
  StorageCreateRequest,
  type StorageStatusResponse,
  type UiMessage,
  UiPrefsRequest,
} from '@bettermyadmin/contracts'
import { N_, sprintf } from '@bettermyadmin/i18n'
import {
  type ConfigStorage,
  applyVariables,
  arrayRead,
  getUserFormFields,
  hasAllFeatures,
  phpEmpty,
  phpJsonDecode,
  phpJsonEncode,
  relationParametersToArray,
  setColumnPreferences,
  sqlDir,
  validIdentifier,
} from '@bettermyadmin/metadata'
import { type Context, Hono } from 'hono'
import { NotFoundError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { recordSqlBoxHistory } from '../metadata/hooks.ts'
import { type MetaRequest, defaultOfPath, resetRelationCache, withMeta } from '../metadata/service.ts'
import { selectDatabase, tableInfo } from '../metadata/table-info.ts'
import { type SqlBoxResult, runSqlBox } from '../query/pipeline.ts'
import type { ServerEnv } from './server.ts'

export const metadataRoutes = new Hono<ServerEnv>()

/**
 * A message through the request's catalogue: `text` (and `detail`) are phpMyAdmin msgids, filled with
 * `args` like `sprintf(__(…), …)`; texts that are not msgids (MySQL errors) come back unchanged.
 */
const msg = (
  c: Context<ServerEnv>,
  type: UiMessage['type'],
  text: string,
  detail?: string,
  args: string[] = [],
): UiMessage => {
  const tr = c.get('tr')
  const t = args.length > 0 ? sprintf(tr.gettext(text), ...args) : tr.gettext(text)
  return detail === undefined || detail === ''
    ? { type, text: t }
    : { type, text: t, detail: tr.gettext(detail) }
}

/** A message built by packages/metadata (English text, msgid + args when interpolated). */
const pkgMsg = (
  c: Context<ServerEnv>,
  m: {
    type: UiMessage['type']
    text: string
    detail?: string | undefined
    msgid?: string | undefined
    args?: string[] | undefined
  },
): UiMessage => msg(c, m.type, m.msgid ?? m.text, m.detail, m.args ?? [])

// ---------------------------------------------------------------------------------------------
// Storage status / creation (pma: CheckRelationsController, HomeController, Operations/DatabaseController)
// ---------------------------------------------------------------------------------------------

/** The `$cfg['Servers'][$i][<table>]` rows of check_relations.twig, in order. */
const CHECK_ROWS: Array<[string, keyof ReturnType<typeof relationParametersToArray>]> = [
  ['relation', 'relation'],
  ['table_info', 'table_info'],
  ['table_coords', 'table_coords'],
  ['pdf_pages', 'pdf_pages'],
  ['column_info', 'column_info'],
  ['bookmarktable', 'bookmark'],
  ['history', 'history'],
  ['recent', 'recent'],
  ['favorite', 'favorite'],
  ['table_uiprefs', 'table_uiprefs'],
  ['tracking', 'tracking'],
  ['userconfig', 'userconfig'],
  ['users', 'users'],
  ['usergroups', 'usergroups'],
  ['navigationhiding', 'navigationhiding'],
  ['savedsearches', 'savedsearches'],
  ['central_columns', 'central_columns'],
  ['designer_settings', 'designer_settings'],
  ['export_templates', 'export_templates'],
]

/** The feature lines of check_relations.twig, in order. */
const FEATURES: Array<[keyof ReturnType<typeof relationParametersToArray>, string]> = [
  ['relwork', 'General relation features'],
  ['displaywork', 'Display features'],
  ['pdfwork', 'Designer and creation of PDFs'],
  ['commwork', 'Displaying column comments'],
  ['mimework', 'Browser transformation'],
  ['bookmarkwork', 'Bookmarked SQL query'],
  ['historywork', 'SQL history'],
  ['recentwork', 'Persistent recently used tables'],
  ['favoritework', 'Persistent favorite tables'],
  ['uiprefswork', "Persistent tables' UI preferences"],
  ['trackingwork', 'Tracking'],
  ['userconfigwork', 'User preferences'],
  ['menuswork', 'Configurable menus'],
  ['navwork', 'Hide/show navigation items'],
  ['savedsearcheswork', 'Saving Query-By-Example searches'],
  ['centralcolumnswork', 'Managing central list of columns'],
  ['designersettingswork', 'Remembering designer settings'],
  ['exporttemplateswork', 'Saving export templates'],
]

async function storageStatus(m: MetaRequest, storage: ConfigStorage): Promise<StorageStatusResponse> {
  const rp = await storage.getRelationParameters()
  const arr = relationParametersToArray(rp)
  const settings = await m.settings()
  const configured = !phpEmpty(m.server.pmadb)
  const zeroConf = m.cfg.ZeroConf
  const warn = !hasAllFeatures(rp) && !settings.PmaNoRelation_DisableWarning
  // Show error if user has configured something, notice elsewhere
  const type = configured ? 'error' : 'notice'
  const homeNotice =
    !storage.arePmadbTablesAllDisabled() && warn
      ? msg(
          m.c,
          type,
          'The phpMyAdmin configuration storage is not completely configured, some extended features have been deactivated. %sFind out why%s. ',
          zeroConf ? "Or alternately go to 'Operations' tab of any database to set it up there." : undefined,
        )
      : null
  const operationsNotice = warn
    ? msg(m.c, type, 'The phpMyAdmin configuration storage has been deactivated. %sFind out why%s.')
    : null
  let offer: StorageStatusResponse['offer'] = null
  if (rp.db === null) {
    if (zeroConf) offer = m.currentDb === '' ? 'create_pmadb' : 'fixall_pmadb'
  } else if (!arr.allworks && zeroConf && storage.arePmadbTablesDefined()) {
    offer = 'fix_pmadb'
  }
  return {
    relationParameters: arr,
    pmadbConfigured: configured,
    zeroConf,
    arePmadbTablesDefined: storage.arePmadbTablesDefined(),
    arePmadbTablesAllDisabled: storage.arePmadbTablesAllDisabled(),
    configurationStorageDbName: storage.getConfigurationStorageDbName(),
    sqlDir: sqlDir(),
    homeNotice,
    operationsNotice,
    offer,
    tables: CHECK_ROWS.map(([directive, key]) => {
      const name = arr[key] as string | null
      return { directive, name, ok: name !== null }
    }),
    features: FEATURES.map(([flag, label]) => ({ flag, label, enabled: arr[flag] === true })),
    stores: (await m.meta()).stores(),
    // the discovery may be cached (the login's two-factor check read the preferences): open the link
    controlError: (await m.control.get()).error ?? null,
  }
}

/** GET /api/servers/:s/metadata-storage/status?db= */
metadataRoutes.get('/metadata-storage/status', (c) =>
  withMeta(c, { db: c.req.query('db') ?? '' }, async (m) =>
    c.json(await storageStatus(m, await m.storage())),
  ),
)

/** POST /api/servers/:s/metadata-storage/create — pma: CheckRelationsController (create_pmadb / fixall_pmadb / fix_pmadb) */
metadataRoutes.post('/metadata-storage/create', async (c) => {
  const req = await parseJson(c, StorageCreateRequest, {})
  return withMeta(c, { db: req.db ?? '' }, async (m) => {
    const storage = await m.storage()
    let message: UiMessage | null = null
    if (req.action === 'create_pmadb') {
      const name = storage.getConfigurationStorageDbName()
      const r = await storage.createPmaDatabase(name)
      message = r ?? (await storage.fixPmaTables(name))
    } else if (req.action === 'fixall_pmadb') {
      if (validIdentifier(m.currentDb)) message = await storage.fixPmaTables(m.currentDb)
    } else {
      const rp = await storage.getRelationParameters()
      message = await storage.fixPmaTables(rp.db ?? '')
    }
    if (message !== null) message = pkgMsg(c, message)
    const status = await storageStatus(m, storage)
    // phpMyAdmin rediscovers the storage on the next request
    resetRelationCache(c, m.serverIndex)
    return c.json({ message, status })
  })
})

// ---------------------------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------------------------

/** GET /api/servers/:s/bookmarks?db= — pma: SqlQueryForm (getList(user, db)) */
metadataRoutes.get('/bookmarks', (c) => {
  const db = c.req.query('db')
  return withMeta(c, { db: db ?? '' }, async (m) => {
    const repo = (await m.meta()).bookmarks()
    return c.json({
      available: repo.available,
      allowSharedBookmarks: m.cfg.AllowSharedBookmarks,
      bookmarks: await repo.getList(m.user, db === undefined ? false : db),
    })
  })
})

/** POST /api/servers/:s/bookmarks — pma: SqlController::addBookmark, Sql::storeTheQueryAsBookmark (bkm_replace) */
metadataRoutes.post('/bookmarks', async (c) => {
  const req = await parseJson(c, BookmarkCreateRequest, {})
  return withMeta(c, { db: req.db }, async (m) => {
    const repo = (await m.meta()).bookmarks()
    let ok: boolean
    if (req.replace) {
      await repo.storeTheQueryAsBookmark(req.db, m.user, req.query, req.label, true, req.shared)
      ok = repo.createBookmark(req.query, req.label, m.user, req.db, req.shared) !== false
    } else {
      const b = repo.createBookmark(req.query, req.label, m.user, req.db, req.shared)
      ok = b !== false && (await repo.save(b))
    }
    return c.json(
      ok
        ? {
            success: true,
            message: msg(c, 'success', 'Bookmark %s has been created.', undefined, [req.label]),
          }
        : { success: false, message: msg(c, 'error', 'Bookmark not created!') },
      ok ? 200 : 400,
    )
  })
})

/** GET /api/servers/:s/bookmarks/:id — pma: ImportController action_bookmark=1 ("Showing bookmark") */
metadataRoutes.get('/bookmarks/:id{[0-9]+}', (c) =>
  withMeta(c, {}, async (m) => {
    const b = await (await m.meta()).bookmarks().get(m.user, Number(c.req.param('id')))
    if (b === null) throw new NotFoundError(c.get('tr').gettext('Bookmark not found.'))
    return c.json({ bookmark: b, message: msg(c, 'success', 'Showing bookmark') })
  }),
)

/** POST /api/servers/:s/bookmarks/:id/delete — pma: ImportController action_bookmark=2 */
metadataRoutes.post('/bookmarks/:id{[0-9]+}/delete', (c) =>
  withMeta(c, {}, async (m) => {
    const repo = (await m.meta()).bookmarks()
    const b = await repo.get(m.user, Number(c.req.param('id')))
    if (b === null) throw new NotFoundError(c.get('tr').gettext('Bookmark not found.'))
    await repo.delete(b.id)
    return c.json({ success: true, message: msg(c, 'success', 'The bookmark has been deleted.') })
  }),
)

/** POST /api/servers/:s/bookmarks/:id/run — pma: ImportController action_bookmark=0 (+ applyVariables) */
metadataRoutes.post('/bookmarks/:id{[0-9]+}/run', async (c) => {
  const req = await parseJson(c, BookmarkRunRequest, {})
  return withMeta(c, { db: req.db ?? '' }, async (m) => {
    const b = await (await m.meta()).bookmarks().get(req.allUsers ? null : m.user, Number(c.req.param('id')))
    if (b === null) throw new NotFoundError(c.get('tr').gettext('Bookmark not found.'))
    const sql = req.variables !== undefined ? applyVariables(b.query, req.variables) : b.query
    const { cfg, pools } = c.get('deps')
    const session = c.get('session')
    const executed = c.get('executed')
    const settings = await m.settings()
    const conn = await pools.acquire(
      session.id,
      m.serverIndex,
      c.get('creds'),
      executed,
      undefined,
      c.get('language').mysqlLocale,
    )
    let r: SqlBoxResult
    try {
      r = await runSqlBox(
        {
          sql,
          db: req.db ?? '',
          table: req.table ?? '',
          pos: req.pos,
          maxRows: req.maxRows ?? settings.MaxRows,
          delimiter: ';',
        },
        {
          cfg: settings,
          conn,
          hmacSecret: session.hmacSecret,
          executed,
          session,
          server: m.serverIndex,
          tr: c.get('tr'),
        },
      )
    } catch (e) {
      conn.raw.release()
      throw e
    }
    if (r.discardConnection) conn.raw.destroy()
    else conn.raw.release()
    await recordSqlBoxHistory(m, {
      current: { db: r.db, table: r.table, sqlQuery: r.sqlQuery },
      noHistory: req.noHistory === true,
    })
    const res: QueryResponse = {
      statements: r.statements,
      executed: cfg.DBG.sql ? executed : [],
      db: r.db === '' ? null : r.db,
      table: r.table === '' ? null : r.table,
      reloadNavigation: r.reloadNavigation,
      sqlQuery: Array.from(r.sqlQuery).length < settings.MaxCharactersInDisplayedSQL ? r.sqlQuery : '',
    }
    if (r.ajaxReload !== undefined) res.ajaxReload = r.ajaxReload
    return c.json(res)
  })
})

/** GET /api/servers/:s/console/bookmarks — pma: Console::getBookmarkContent (/console/bookmark/refresh) */
metadataRoutes.get('/console/bookmarks', (c) =>
  withMeta(c, {}, async (m) => {
    const repo = (await m.meta()).bookmarks()
    const bookmarks = await repo.getList(m.user)
    return c.json({
      available: repo.available,
      // Console::getBookmarkContent's welcome line, in the request language
      welcomeMessage: !repo.available
        ? ''
        : bookmarks.length > 0
          ? sprintf(
              c
                .get('tr')
                .ngettext(
                  'Showing %1$d bookmark (both private and shared)',
                  'Showing %1$d bookmarks (both private and shared)',
                  bookmarks.length,
                ),
              bookmarks.length,
            )
          : c.get('tr').gettext('No bookmarks'),
      bookmarks,
    })
  }),
)

/** POST /api/servers/:s/console/bookmarks — pma: Console\Bookmark\AddController */
metadataRoutes.post('/console/bookmarks', async (c) => {
  const req = await parseJson(c, ConsoleBookmarkAddRequest, {})
  return withMeta(c, { db: req.db }, async (m) => {
    const repo = (await m.meta()).bookmarks()
    const b = repo.createBookmark(req.bookmark_query, req.label, m.user, req.db, req.shared)
    if (b === false || !(await repo.save(b))) return c.json({ message: c.get('tr').gettext('Failed') })
    return c.json({
      message: c.get('tr').gettext('Succeeded'),
      data: {
        bkm_database: req.db,
        bkm_user: m.user,
        bkm_sql_query: req.bookmark_query,
        bkm_label: req.label,
      },
      isShared: req.shared,
    })
  })
})

// ---------------------------------------------------------------------------------------------
// SQL history
// ---------------------------------------------------------------------------------------------

/** GET /api/servers/:s/sql/history — pma: History::getHistory (console) */
metadataRoutes.get('/sql/history', (c) =>
  withMeta(c, {}, async (m) => {
    const settings = await m.settings()
    return c.json({
      history: await (await m.meta()).history().getHistory(m.user),
      queryHistoryDB: settings.QueryHistoryDB,
    })
  }),
)

// ---------------------------------------------------------------------------------------------
// Recent / favorite tables
// ---------------------------------------------------------------------------------------------

/** GET /api/servers/:s/recent-favorite — pma: NavigationTree (recent / favorite lists) */
metadataRoutes.get('/recent-favorite', (c) =>
  withMeta(c, {}, async (m) => {
    const meta = await m.meta()
    const recent = await meta.recentFavorite('recent')
    const favorite = await meta.recentFavorite('favorite')
    meta.storeRecentFavorite(recent)
    meta.storeRecentFavorite(favorite)
    const settings = await m.settings()
    const rp = meta.relationParameters
    return c.json({
      recent: recent.getTables(),
      favorite: favorite.getTables(),
      numRecentTables: settings.NumRecentTables,
      numFavoriteTables: settings.NumFavoriteTables,
      // RecentFavoriteTables::getHtmlSyncFavoriteTables
      syncFavorites:
        rp.favoriteTablesFeature !== null && m.state.favoritesSynced?.[String(m.serverIndex)] !== true,
    })
  }),
)

/**
 * POST /api/servers/:s/recent-favorite/open — pma: /table/recent-favorite (a table chosen in the
 * Recent / Favorites lists): both lists forget it when it no longer exists; the client then opens
 * it (`/sql` with db and table)
 */
metadataRoutes.post('/recent-favorite/open', async (c) => {
  const req = await parseJson(c, RecentAddRequest, {})
  if (!validIdentifier(req.db) || !validIdentifier(req.table)) {
    return c.json({ ok: false, message: msg(c, 'error', 'Invalid database or table name.') })
  }
  return withMeta(c, { db: req.db }, async (m) => {
    const meta = await m.meta()
    for (const kind of ['recent', 'favorite'] as const) {
      const list = await meta.recentFavorite(kind)
      await list.removeIfInvalid(req)
      meta.storeRecentFavorite(list)
    }
    return c.json({ ok: true, message: null })
  })
})

/** POST /api/servers/:s/recent — pma: Http\Middleware\RecentTableHandling */
metadataRoutes.post('/recent', async (c) => {
  const req = await parseJson(c, RecentAddRequest, {})
  return withMeta(c, { db: req.db }, async (m) => {
    const settings = await m.settings()
    const meta = await m.meta()
    const recent = await meta.recentFavorite('recent')
    let message: UiMessage | null = null
    if (settings.NumRecentTables !== 0 && validIdentifier(req.db) && validIdentifier(req.table)) {
      const r = await recent.add(req)
      if (r !== true) message = pkgMsg(c, r)
    }
    meta.storeRecentFavorite(recent)
    return c.json({ recent: recent.getTables(), message })
  })
})

/** pma: TableName::from (src/Identifiers/InvalidTableName.php): the msgid and its arguments, or null */
function tableNameError(name: string): [string, string[]] | null {
  if (name === '') return [N_('The table name must be a non-empty string.'), []]
  if (Array.from(name).length > 64) return [N_('The table name cannot be longer than %d characters.'), ['64']]
  if (name.endsWith(' ')) return [N_('The table name cannot end with a space character.'), []]
  return null
}

/** POST /api/servers/:s/favorites — pma: Database\Structure\FavoriteTableController */
metadataRoutes.post('/favorites', async (c) => {
  const req = await parseJson(c, FavoriteRequest, {})
  if (req.db === '') return c.json({ changes: false })
  return withMeta(c, { db: req.db }, async (m) => {
    const settings = await m.settings()
    const meta = await m.meta()
    const favorite = await meta.recentFavorite('favorite')
    const decoded = phpJsonDecode(req.favoriteTables)
    const favoriteTables: Record<string, unknown> =
      decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)
        ? (decoded as Record<string, unknown>)
        : Array.isArray(decoded)
          ? Object.fromEntries(decoded.map((v, i) => [String(i), v]))
          : {}
    // Required to keep each user's preferences separate.
    const user = createHash('sha1').update(m.user).digest('hex')
    // DbTableExists::selectDatabase (user link)
    const conn = await m.userConn()
    const selected = validIdentifier(req.db) ? await selectDatabase(conn, req.db) : false
    if (!selected) {
      return c.json({ changes: false, message: msg(c, 'error', 'No databases selected.') }, 400)
    }
    // pma: TableName::from($favoriteTableName) throws InvalidTableName
    const bad = tableNameError(req.table)
    if (bad !== null)
      return c.json({ changes: false, message: msg(c, 'error', bad[0], undefined, bad[1]) }, 400)
    const t = { db: req.db, table: req.table }
    let already = favorite.contains(t)
    let changes = true
    if (req.action === 'remove') {
      if (already) {
        await favorite.remove(t)
        already = false
      }
    } else if (!already) {
      if (favorite.getTables().length === settings.NumFavoriteTables) changes = false
      else {
        await favorite.add(t)
        already = true
      }
    }
    meta.storeRecentFavorite(favorite)
    favoriteTables[user] = favorite.getTablesForJson()
    if (!changes) return c.json({ changes, message: msg(c, 'error', 'Favorite List is full!') })
    return c.json({
      changes,
      user,
      favoriteTables: phpJsonEncode(favoriteTables),
      favorite: favorite.getTables(),
      alreadyFavorite: already,
    })
  })
})

/** POST /api/servers/:s/favorites/sync — pma: SyncFavoriteTablesController */
metadataRoutes.post('/favorites/sync', async (c) => {
  const req = await parseJson(c, FavoriteSyncRequest, {})
  return withMeta(c, {}, async (m) => {
    const meta = await m.meta()
    if (meta.stores().favorite === null) return c.json({})
    const favorite = await meta.recentFavorite('favorite')
    const decoded = phpJsonDecode(req.favoriteTables)
    const favoriteTables: Record<string, unknown> =
      decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)
        ? (decoded as Record<string, unknown>)
        : {}
    const user = createHash('sha1').update(m.user).digest('hex')
    const mine = favoriteTables[user]
    if (favorite.getTables().length === 0 && mine !== null && typeof mine === 'object') {
      for (const v of Object.values(mine as Record<string, unknown>)) {
        const { db, table } = (v ?? {}) as Record<string, unknown>
        if (validIdentifier(db) && validIdentifier(table)) await favorite.add({ db, table })
      }
    }
    meta.storeRecentFavorite(favorite)
    favoriteTables[user] = favorite.getTables()
    // Set flag when localStorage and pmadb(if present) are in sync.
    m.state.favoritesSynced ??= {}
    m.state.favoritesSynced[String(m.serverIndex)] = true
    return c.json({ favoriteTables: phpJsonEncode(favoriteTables), favorite: favorite.getTables() })
  })
})

// ---------------------------------------------------------------------------------------------
// Table UI preferences
// ---------------------------------------------------------------------------------------------

/** GET /api/servers/:s/databases/:db/tables/:t/uiprefs — the reader the browse grid uses (Table::getUiProp) */
metadataRoutes.get('/databases/:db/tables/:t/uiprefs', (c) => {
  const db = c.req.param('db')
  const t = c.req.param('t')
  return withMeta(c, { db }, async (m) => {
    const info = tableInfo(m, db, t)
    const ui = (await m.meta()).uiPrefs(db, t, info)
    const discard = c.req.query('discard_remembered_sort') !== undefined
    // GET is side-effect free: stale values are reported as false but removed only by the browse
    // path (pma: Results::getColumnParams / Sql::handleSortOrder)
    return c.json({
      sorted_col: await ui.getUiProp('sorted_col', discard, true),
      col_order: await ui.getUiProp('col_order', false, true),
      col_visib: await ui.getUiProp('col_visib', false, true),
      createTime: await info.createTime(),
    })
  })
})

/** POST /api/servers/:s/databases/:db/tables/:t/uiprefs — pma: Sql\ColumnPreferencesController */
metadataRoutes.post('/databases/:db/tables/:t/uiprefs', async (c) => {
  const req = await parseJson(c, UiPrefsRequest, {})
  const db = c.req.param('db')
  const t = c.req.param('t')
  return withMeta(c, { db }, async (m) => {
    const ui = (await m.meta()).uiPrefs(db, t, tableInfo(m, db, t))
    const status = await setColumnPreferences(ui, {
      colOrder: req.col_order,
      colVisib: req.col_visib,
      tableCreateTime: req.table_create_time ?? null,
    })
    if (typeof status === 'object') {
      return c.json({ success: false, message: pkgMsg(c, status) }, 400)
    }
    return c.json({ success: status, message: null })
  })
})

// ---------------------------------------------------------------------------------------------
// User preferences (storage only)
// ---------------------------------------------------------------------------------------------

/** Stored key of a form path: `Servers/1/only_db` is stored as `Server/only_db`. */
const storedKey = (path: string) => path.replace(/^Servers\/1\//, 'Server/')

/** GET /api/servers/:s/prefs — pma: UserPreferences::load + apply, with the source of each value */
metadataRoutes.get('/prefs', (c) =>
  withMeta(c, {}, async (m) => {
    const prefs = await (await m.meta()).userPreferences().load()
    const disallow = new Set(m.cfg.UserprefsDisallow)
    const paths = [
      ...new Set([
        ...getUserFormFields(m.cfg.UserprefsDeveloperTab).filter((p) => !p.startsWith(':')),
        'ThemeDefault',
      ]),
    ]
    const sDefaults = serverDefaults()
    const values: Record<
      string,
      {
        value: unknown
        default: unknown
        config: unknown
        source: 'default' | 'config' | 'user'
        disallowed: boolean
      }
    > = {}
    for (const path of paths) {
      const isServer = path.startsWith('Servers/1/')
      const sub = path.slice('Servers/1/'.length)
      const def = isServer ? arrayRead(sub, sDefaults) : defaultOfPath(path)
      const config = isServer ? arrayRead(sub, m.server) : arrayRead(path, m.cfg)
      const key = storedKey(path)
      const disallowed = disallow.has(path) || disallow.has(key)
      const stored = prefs.config_data[key]
      let source: 'default' | 'config' | 'user' =
        JSON.stringify(config) === JSON.stringify(def) ? 'default' : 'config'
      let value = config
      if (stored !== undefined && !disallowed) {
        source = 'user'
        value = stored
      }
      values[path] = { value, default: def, config, source, disallowed }
    }
    return c.json({ storage: prefs.type, mtime: prefs.mtime, configData: prefs.config_data, values })
  }),
)

/** POST /api/servers/:s/prefs — replace the stored map (UserPreferences::save, keeps `2fa`) */
metadataRoutes.post('/prefs', async (c) => {
  const req = await parseJson(c, PrefsSaveRequest, {})
  return withMeta(c, {}, async (m) => {
    const r = await (await m.meta()).userPreferences().save(req.configData)
    return r === true
      ? c.json({ success: true, message: null })
      : c.json({ success: false, message: pkgMsg(c, r) }, 500)
  })
})

/** POST /api/servers/:s/prefs/option — one value (UserPreferencesHandler::setUserValue → persistOption) */
metadataRoutes.post('/prefs/option', async (c) => {
  const req = await parseJson(c, PrefsOptionRequest, {})
  return withMeta(c, {}, async (m) => {
    const def = 'default' in req ? req.default : defaultOfPath(req.path)
    const r = await (await m.meta()).userPreferences().persistOption(req.path, req.value, def)
    return r === true
      ? c.json({ success: true, message: null })
      : c.json({ success: false, message: pkgMsg(c, r) }, 500)
  })
})

/** POST /api/servers/:s/prefs/reset — pma: Preferences\ManageController (submit_clear → save([])) */
metadataRoutes.post('/prefs/reset', (c) =>
  withMeta(c, {}, async (m) => {
    const r = await (await m.meta()).userPreferences().save({})
    return r === true
      ? c.json({ success: true, message: msg(c, 'success', 'Configuration has been saved.') })
      : c.json({ success: false, message: pkgMsg(c, r) }, 500)
  }),
)

// ---------------------------------------------------------------------------------------------
// Navigation width (pma: /navigation/update-width)
// ---------------------------------------------------------------------------------------------

/** POST /api/servers/:s/navigation/width — UpdateNavWidthConfigController: the NavigationWidth preference */
metadataRoutes.post('/navigation/width', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null
  const raw = body?.value
  // is_numeric($value) && $value >= 0, then (int)
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(raw)
        ? Number(raw)
        : Number.NaN
  if (Number.isNaN(n) || n < 0) {
    return c.json({ success: false, message: msg(c, 'error', 'Unexpected parameter value.') })
  }
  return withMeta(c, {}, async (m) => {
    const r = await (await m.meta())
      .userPreferences()
      .persistOption('NavigationWidth', Math.trunc(n), defaultOfPath('NavigationWidth'))
    return r === true
      ? c.json({ success: true, message: null })
      : c.json({ success: false, message: pkgMsg(c, r) })
  })
})

// ---------------------------------------------------------------------------------------------
// Navigation hiding (pma: NavigationController hideNavItem / unhideNavItem / showUnhideDialog)
// ---------------------------------------------------------------------------------------------

/** GET /api/servers/:s/navigation/hidden?db= */
metadataRoutes.get('/navigation/hidden', (c) =>
  withMeta(c, {}, async (m) => {
    const nav = (await m.meta()).navigationHiding()
    const db = c.req.query('db') ?? ''
    if (nav === null) return c.json({ available: false, hidden: {}, counts: {} })
    return c.json({
      available: true,
      hidden: db === '' ? {} : await nav.hiddenItems(m.user, db),
      counts: await nav.hiddenCounts(m.user),
    })
  }),
)

/** POST /api/servers/:s/navigation/hide | /unhide (NavigationController hideNavItem / unhideNavItem) */
const navItem = (action: 'hide' | 'unhide') => async (c: Context<ServerEnv>) => {
  const req = await parseJson(c, NavItemRequest, {})
  return withMeta(c, {}, async (m) => {
    const nav = (await m.meta()).navigationHiding()
    if (nav !== null && req.itemName !== '' && req.itemType !== '' && req.dbName !== '') {
      if (action === 'hide') await nav.hide(m.user, req.itemName, req.itemType, req.dbName)
      else await nav.unhide(m.user, req.itemName, req.itemType, req.dbName)
    }
    return c.json({ success: true, available: nav !== null })
  })
}
metadataRoutes.post('/navigation/hide', navItem('hide'))
metadataRoutes.post('/navigation/unhide', navItem('unhide'))

import { backquote, escapeMysqlWildcards, quoteString } from '@bettermyadmin/sql-gen'
import { type MetaConn, type Row, fetchSingleRow, fetchValue, firstColumn } from './conn.ts'
import type {
  BookmarkBackend,
  BookmarkRow,
  HistoryBackend,
  HistoryRow,
  MetadataDriver,
  NavigationHidingBackend,
  RecentFavoriteBackend,
  SaveResult,
  UiPrefsBackend,
  UserConfigBackend,
} from './driver.ts'
import type { RelationParameters } from './relation-parameters.ts'

const q = (s: string) => quoteString(s)
const t = (db: string, table: string) => `${backquote(db)}.${backquote(table)}`

const toBookmark = (r: Row): BookmarkRow => ({
  id: Number(r.id ?? 0),
  dbase: r.dbase ?? '',
  user: r.user ?? '',
  label: r.label ?? '',
  query: r.query ?? '',
})

/** pma: src/Bookmarks/BookmarkRepository.php, src/Bookmarks/Bookmark.php */
class PmadbBookmarks implements BookmarkBackend {
  constructor(
    readonly conn: MetaConn,
    readonly table: string,
  ) {}

  async list(user: string, db: string | false, exactUserMatch: boolean): Promise<BookmarkRow[]> {
    let query = `SELECT * FROM ${this.table} WHERE (\`user\` = ${q(user)}`
    if (!exactUserMatch) query += " OR `user` = ''"
    query += ')'
    if (db !== false) query += ` AND dbase = ${q(db)}`
    query += ' ORDER BY label ASC'
    const r = await this.conn.tryQuery(query)
    return r === false ? [] : r.rows.map(toBookmark)
  }

  async get(user: string | null, id: number, exactUserMatch: boolean): Promise<BookmarkRow | null> {
    let query = `SELECT * FROM ${this.table} WHERE \`id\` = ${id}`
    if (user !== null) {
      query += ` AND (user = ${q(user)}`
      if (!exactUserMatch) query += " OR user = ''"
      query += ')'
    }
    query += ' LIMIT 1'
    const row = await fetchSingleRow(this.conn, query)
    return row === null ? null : toBookmark(row)
  }

  async getByLabel(user: string, db: string, label: string): Promise<BookmarkRow | null> {
    const query = `SELECT * FROM ${this.table} WHERE \`label\` = ${q(label)} AND dbase = ${q(db)} AND user = ${q(user)} LIMIT 1`
    const row = await fetchSingleRow(this.conn, query)
    return row === null ? null : toBookmark(row)
  }

  async insert(b: Omit<BookmarkRow, 'id'>): Promise<boolean> {
    const query = `INSERT INTO ${this.table} (id, dbase, user, query, label) VALUES (NULL, ${q(b.dbase)}, ${q(b.user)}, ${q(b.query)}, ${q(b.label)})`
    await this.conn.query(query)
    return true
  }

  async delete(id: number): Promise<boolean> {
    return (await this.conn.tryQuery(`DELETE FROM ${this.table} WHERE id = ${id}`)) !== false
  }
}

/** pma: src/Console/History.php */
class PmadbHistory implements HistoryBackend {
  constructor(
    readonly conn: MetaConn,
    readonly table: string,
  ) {}

  async add(username: string, db: string, table: string, sqlquery: string, max: number): Promise<void> {
    await this.conn.query(
      `INSERT INTO ${this.table}
                  (\`username\`,
                    \`db\`,
                    \`table\`,
                    \`timevalue\`,
                    \`sqlquery\`)
            VALUES
                  (${q(username)},
                   ${q(db)},
                   ${q(table)},
                   NOW(),
                   ${q(sqlquery)})`,
    )
    // History::purgeHistory
    const searchQuery = `
            SELECT \`timevalue\`
            FROM ${this.table}
            WHERE \`username\` = ${q(username)}
            ORDER BY \`timevalue\` DESC
            LIMIT ${max}, 1`
    const maxTime = await fetchValue(this.conn, searchQuery)
    if (maxTime === false || maxTime === null || maxTime === '' || maxTime === '0') return
    await this.conn.query(
      `DELETE FROM ${this.table}
              WHERE \`username\` = ${q(username)}
                AND \`timevalue\` <= ${q(maxTime)}`,
    )
  }

  async list(username: string): Promise<HistoryRow[]> {
    const r = await this.conn.tryQuery(`
             SELECT \`db\`,
                    \`table\`,
                    \`sqlquery\`,
                    \`timevalue\`
               FROM ${this.table}
              WHERE \`username\` = ${q(username)}
           ORDER BY \`id\` DESC`)
    if (r === false) return []
    return r.rows.map((row) => ({
      db: row.db ?? '',
      table: row.table ?? '',
      sqlquery: row.sqlquery ?? '',
      timevalue: row.timevalue ?? '',
    }))
  }
}

/** pma: src/Favorites/RecentFavoriteTables.php::getFromDb / saveToDb */
class PmadbRecentFavorite implements RecentFavoriteBackend {
  constructor(
    readonly conn: MetaConn,
    readonly table: string,
    readonly kind: 'recent' | 'favorite',
  ) {}

  async read(username: string): Promise<string | null> {
    const r = await this.conn.tryQuery(
      `SELECT \`tables\` FROM ${this.table} WHERE \`username\` = ${q(username)}`,
    )
    if (r === false) return null
    const v = r.rows[0]?.tables
    return typeof v === 'string' ? v : null
  }

  async write(username: string, json: string): Promise<SaveResult> {
    const sqlQuery = ` REPLACE INTO ${this.table} (\`username\`, \`tables\`) VALUES (${q(username)}, ${q(json)})`
    if ((await this.conn.tryQuery(sqlQuery)) === false) {
      return {
        error: this.kind === 'recent' ? 'Could not save recent table!' : 'Could not save favorite table!',
        detail: this.conn.lastError,
      }
    }
    return true
  }
}

/** pma: src/Table/Table.php::getUiPrefsFromDb / saveUiPrefsToDb */
class PmadbUiPrefs implements UiPrefsBackend {
  constructor(
    readonly conn: MetaConn,
    readonly table: string,
  ) {}

  async read(username: string, db: string, table: string): Promise<string | null> {
    const r = await this.conn.query(
      `SELECT \`prefs\` FROM ${this.table} WHERE \`username\` = ${q(username)} AND \`db_name\` = ${q(db)} AND \`table_name\` = ${q(table)}`,
    )
    const v = r.rows[0]?.prefs
    return typeof v === 'string' ? v : null
  }

  async write(
    username: string,
    db: string,
    table: string,
    json: string,
    maxRows: number,
  ): Promise<SaveResult> {
    const sqlQuery = ` REPLACE INTO ${this.table} (username, db_name, table_name, prefs) VALUES (${q(username)}, ${q(db)}, ${q(table)}, ${q(json)})`
    if ((await this.conn.tryQuery(sqlQuery)) === false) {
      return {
        error: 'Could not save table UI preferences!',
        msgid: 'Could not save table UI preferences!',
        detail: this.conn.lastError,
      }
    }
    // remove some old rows in table_uiprefs if it exceeds the configured maximum rows
    const rowsCount = Number((await fetchValue(this.conn, `SELECT COUNT(*) FROM ${this.table}`)) || 0)
    if (rowsCount > maxRows) {
      const numRowsToDelete = rowsCount - maxRows
      const del = ` DELETE FROM ${this.table} ORDER BY last_update ASC LIMIT ${numRowsToDelete}`
      if ((await this.conn.tryQuery(del)) === false) {
        // pma: the %s is MySQLDocumentation::showDocumentation('config', 'cfg_Servers_MaxTableUiprefs')
        return {
          error: "Failed to cleanup table UI preferences (see $cfg['Servers'][$i]['MaxTableUiprefs'] )",
          msgid: "Failed to cleanup table UI preferences (see $cfg['Servers'][$i]['MaxTableUiprefs'] %s)",
          args: [''],
          detail: this.conn.lastError,
        }
      }
    }
    return true
  }
}

/** pma: src/Config/UserPreferences.php::load / save (pmadb branch) */
class PmadbUserConfig implements UserConfigBackend {
  constructor(
    readonly conn: MetaConn,
    readonly database: string,
    readonly table: string,
    readonly disableIS: boolean,
  ) {}

  async load(username: string): Promise<{ configData: string; ts: number } | null> {
    const row = await fetchSingleRow(
      this.conn,
      `SELECT \`config_data\`, UNIX_TIMESTAMP(\`timevalue\`) ts FROM ${this.table} WHERE \`username\` = ${q(username)}`,
    )
    if (row === null || row.config_data === null || row.config_data === undefined || row.ts === null)
      return null
    const ts = Number(row.ts)
    return { configData: row.config_data, ts: Number.isFinite(ts) ? Math.trunc(ts) : Number.NaN }
  }

  async save(username: string, json: string): Promise<SaveResult> {
    const hasConfig = await fetchValue(
      this.conn,
      `SELECT \`username\` FROM ${this.table} WHERE \`username\` = ${q(username)}`,
    )
    const query =
      hasConfig !== false && hasConfig !== null && hasConfig !== '' && hasConfig !== '0'
        ? `UPDATE ${this.table} SET \`timevalue\` = NOW(), \`config_data\` = ${q(json)} WHERE \`username\` = ${q(username)}`
        : `INSERT INTO ${this.table} (\`username\`, \`timevalue\`,\`config_data\`) VALUES (${q(username)}, NOW(), ${q(json)})`
    if ((await this.conn.tryQuery(query)) === false) {
      const detail = this.conn.lastError
      // UserPreferences::hasAccessToDatabase
      const access = this.disableIS
        ? `SHOW DATABASES LIKE ${q(escapeMysqlWildcards(this.database))}`
        : `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ${q(this.database)}`
      const canAccess = (await fetchSingleRow(this.conn, access)) !== null
      // the messages are translated by the caller
      return {
        error: 'Could not save configuration',
        detail,
        ...(canAccess ? {} : { inaccessible: true as const }),
      }
    }
    return true
  }
}

/** pma: src/Navigation/Navigation.php, Nodes/NodeDatabase.php::getHiddenItems, Nodes/Node.php::getNavigationHidingData */
class PmadbNavigationHiding implements NavigationHidingBackend {
  constructor(
    readonly conn: MetaConn,
    readonly table: string,
  ) {}

  async hide(username: string, itemName: string, itemType: string, dbName: string): Promise<void> {
    await this.conn.tryQuery(
      `INSERT INTO ${this.table}(\`username\`, \`item_name\`, \`item_type\`, \`db_name\`, \`table_name\`) VALUES (${q(username)},${q(itemName)},${q(itemType)},${q(dbName)},'')`,
    )
  }

  async unhide(username: string, itemName: string, itemType: string, dbName: string): Promise<void> {
    await this.conn.tryQuery(
      `DELETE FROM ${this.table} WHERE \`username\`=${q(username)} AND \`item_name\`=${q(itemName)} AND \`item_type\`=${q(itemType)} AND \`db_name\`=${q(dbName)}`,
    )
  }

  async hiddenItems(username: string, db: string): Promise<Record<string, string[]>> {
    const r = await this.conn.tryQuery(
      `SELECT \`item_name\`, \`item_type\` FROM ${this.table} WHERE \`username\`=${q(username)} AND \`db_name\`=${q(db)} AND \`table_name\`=''`,
    )
    const hidden: Record<string, string[]> = {}
    if (r === false) return hidden
    for (const row of r.rows) {
      const type = row.item_type ?? ''
      hidden[type] ??= []
      hidden[type].push(row.item_name ?? '')
    }
    return hidden
  }

  async hiddenOfType(username: string, type: string, db: string): Promise<string[]> {
    const r = await this.conn.tryQuery(
      `SELECT \`item_name\` FROM ${this.table} WHERE \`username\`=${q(username)} AND \`item_type\`=${q(type)} AND \`db_name\`=${q(db)}`,
    )
    return r === false ? [] : firstColumn(r)
  }

  async hiddenCounts(username: string): Promise<Record<string, number>> {
    const r = await this.conn.tryQuery(
      `SELECT \`db_name\`, COUNT(*) AS \`count\` FROM ${this.table} WHERE \`username\`=${q(username)} GROUP BY \`db_name\``,
    )
    const out: Record<string, number> = {}
    if (r === false) return out
    for (const row of r.rows) out[row.db_name ?? ''] = Number(row.count ?? 0)
    return out
  }
}

/** The per-user features available in pmadb according to the RelationParameters. */
export class PmadbDriver implements MetadataDriver {
  readonly kind = 'pmadb' as const
  readonly bookmarks: BookmarkBackend | null
  readonly history: HistoryBackend | null
  readonly recent: RecentFavoriteBackend | null
  readonly favorite: RecentFavoriteBackend | null
  readonly uiPrefs: UiPrefsBackend | null
  readonly userConfig: UserConfigBackend | null
  readonly navigationHiding: NavigationHidingBackend | null

  constructor(conn: MetaConn, rp: RelationParameters, opts: { disableIS?: boolean } = {}) {
    const f = rp
    this.bookmarks =
      f.bookmarkFeature && new PmadbBookmarks(conn, t(f.bookmarkFeature.database, f.bookmarkFeature.bookmark))
    this.history =
      f.sqlHistoryFeature &&
      new PmadbHistory(conn, t(f.sqlHistoryFeature.database, f.sqlHistoryFeature.history))
    this.recent =
      f.recentlyUsedTablesFeature &&
      new PmadbRecentFavorite(
        conn,
        t(f.recentlyUsedTablesFeature.database, f.recentlyUsedTablesFeature.recent),
        'recent',
      )
    this.favorite =
      f.favoriteTablesFeature &&
      new PmadbRecentFavorite(
        conn,
        t(f.favoriteTablesFeature.database, f.favoriteTablesFeature.favorite),
        'favorite',
      )
    this.uiPrefs =
      f.uiPreferencesFeature &&
      new PmadbUiPrefs(conn, t(f.uiPreferencesFeature.database, f.uiPreferencesFeature.tableUiPrefs))
    this.userConfig =
      f.userPreferencesFeature &&
      new PmadbUserConfig(
        conn,
        f.userPreferencesFeature.database,
        t(f.userPreferencesFeature.database, f.userPreferencesFeature.userConfig),
        opts.disableIS ?? false,
      )
    this.navigationHiding =
      f.navigationItemsHidingFeature &&
      new PmadbNavigationHiding(
        conn,
        t(f.navigationItemsHidingFeature.database, f.navigationItemsHidingFeature.navigationHiding),
      )
  }
}

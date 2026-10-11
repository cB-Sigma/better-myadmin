import type { RecentFavoriteBackend } from './driver.ts'
import { PhpSparseList, phpJsonDecode, phpJsonEncode, phpValues } from './php.ts'
import { validIdentifier } from './relation-parameters.ts'

export interface RecentFavoriteTable {
  db: string
  table: string
}

export type TableType = 'recent' | 'favorite'

export interface RecentFavoriteMessage {
  type: 'error'
  text: string
  detail?: string
}

/**
 * Recently used / favorite tables of one user on one server. The list lives in the session
 * (`$_SESSION['tmpval'][<type>Tables][<server>]`, loaded once from storage) and every change is
 * written back with `REPLACE INTO` when storage is available.
 *
 * The in-memory list keeps PHP array keys: `remove()` unsets an entry, and the immediate save
 * then encodes the gap (`{"1":{...}}`) exactly like phpMyAdmin's `json_encode`.
 *
 * pma: src/Favorites/RecentFavoriteTables.php
 */
export class RecentFavoriteTables {
  readonly type: TableType
  readonly backend: RecentFavoriteBackend | null
  readonly username: string
  readonly max: number
  readonly tableExists: (db: string, table: string) => Promise<boolean>
  /** PHP array: [key, value] pairs in order. */
  #tables: Array<[number, RecentFavoriteTable]>

  private constructor(
    type: TableType,
    backend: RecentFavoriteBackend | null,
    username: string,
    max: number,
    tableExists: (db: string, table: string) => Promise<boolean>,
    tables: RecentFavoriteTable[],
  ) {
    this.type = type
    this.backend = backend
    this.username = username
    this.max = max
    this.tableExists = tableExists
    this.#tables = tables.map((t, i) => [i, t])
  }

  /**
   * @param sessionList the session copy (`undefined` when not loaded yet in this session)
   * @param max NumRecentTables / NumFavoriteTables
   */
  static async load(opts: {
    type: TableType
    backend: RecentFavoriteBackend | null
    username: string
    max: number
    sessionList: RecentFavoriteTable[] | undefined
    tableExists: (db: string, table: string) => Promise<boolean>
  }): Promise<RecentFavoriteTables> {
    let list = opts.sessionList
    if (list === undefined) list = opts.backend !== null ? await getFromDb(opts.backend, opts.username) : []
    return new RecentFavoriteTables(opts.type, opts.backend, opts.username, opts.max, opts.tableExists, list)
  }

  /** What goes back into the session (`__destruct`: re-indexed). */
  toSession(): RecentFavoriteTable[] {
    return this.#tables.map(([, t]) => ({ db: t.db, table: t.table }))
  }

  getTables(): RecentFavoriteTable[] {
    return this.toSession()
  }

  /** `getTables()` as phpMyAdmin JSON-encodes it (keys kept: a removal in this request leaves a gap). */
  getTablesForJson(): PhpSparseList<RecentFavoriteTable> {
    return new PhpSparseList(this.#tables.map(([k, t]) => [k, { db: t.db, table: t.table }]))
  }

  /** pma: RecentFavoriteTables::contains (loose object comparison) */
  contains(t: RecentFavoriteTable): boolean {
    return this.#tables.some(([, x]) => x.db === t.db && x.table === t.table)
  }

  /** pma: RecentFavoriteTables::trim */
  #trim(): void {
    const max = Math.max(this.max, 0)
    while (this.#tables.length > max) this.#tables.pop()
  }

  async #saveToDb(): Promise<true | RecentFavoriteMessage> {
    if (this.backend === null) return true
    const r = await this.backend.write(this.username, phpJsonEncode(new PhpSparseList(this.#tables)))
    if (r === true) return true
    return { type: 'error', text: r.error, ...(r.detail !== undefined ? { detail: r.detail } : {}) }
  }

  /** pma: RecentFavoriteTables::add */
  async add(t: RecentFavoriteTable): Promise<true | RecentFavoriteMessage> {
    if (!(await this.tableExists(t.db, t.table))) return true
    // add only if this is new table
    const first = this.#tables.find(([k]) => k === 0)?.[1]
    if (first === undefined || first.db !== t.db || first.table !== t.table) {
      const list: RecentFavoriteTable[] = [t, ...this.#tables.map(([, x]) => x)]
      // array_unique(SORT_REGULAR) keeps the first occurrence; array_values re-indexes
      const unique = list.filter((x, i) => list.findIndex((y) => y.db === x.db && y.table === x.table) === i)
      this.#tables = unique.map((x, i) => [i, x])
      this.#trim()
      if (this.backend !== null) return this.#saveToDb()
    }
    return true
  }

  /** pma: RecentFavoriteTables::remove */
  async remove(t: RecentFavoriteTable): Promise<true | RecentFavoriteMessage> {
    this.#tables = this.#tables.filter(([, x]) => x.db !== t.db || x.table !== t.table)
    if (this.backend !== null) return this.#saveToDb()
    return true
  }

  /** pma: RecentFavoriteTables::removeIfInvalid */
  async removeIfInvalid(t: RecentFavoriteTable): Promise<boolean | RecentFavoriteMessage> {
    for (const [, x] of this.#tables) {
      if (x.db !== t.db || x.table !== t.table) continue
      if (!(await this.tableExists(x.db, x.table))) return this.remove(t)
    }
    return false
  }
}

/** pma: RecentFavoriteTables::getFromDb (+ RecentFavoriteTable::fromArray on each entry) */
async function getFromDb(backend: RecentFavoriteBackend, username: string): Promise<RecentFavoriteTable[]> {
  const raw = await backend.read(username)
  if (raw === null) return []
  const out: RecentFavoriteTable[] = []
  for (const v of phpValues(phpJsonDecode(raw))) {
    if (v === null || typeof v !== 'object') continue
    const { db, table } = v as Record<string, unknown>
    if (validIdentifier(db) && validIdentifier(table)) out.push({ db, table })
  }
  return out
}

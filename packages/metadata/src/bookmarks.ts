import type { BookmarkBackend, BookmarkRow } from './driver.ts'

/** pma: src/Bookmarks/Bookmark.php::getVariableCount */
export function getVariableCount(query: string): number {
  return [...query.matchAll(/\[VARIABLE[0-9]*\]/g)].length
}

/**
 * Replaces the `[VARIABLEn]` placeholders (and the comments enclosing them) with the values,
 * 1-based; `[VARIABLE]` is an alias of `[VARIABLE1]`.
 *
 * pma: src/Bookmarks/Bookmark.php::applyVariables
 */
export function applyVariables(query: string, variables: Record<number | string, string>): string {
  // remove comments that encloses a variable placeholder: '|/\*(.*\[VARIABLE[0-9]*\].*)\*/|imsU'
  // (U = ungreedy: both .* are lazy; s: . matches newlines)
  let out = query.replace(/\/\*([\s\S]*?\[VARIABLE[0-9]*\][\s\S]*?)\*\//gi, '$1')
  const n = getVariableCount(query)
  for (let i = 1; i <= n; i++) {
    const v = variables[i] ?? ''
    out = out.replaceAll(`[VARIABLE${i}]`, () => v)
    // backward compatibility
    if (i !== 1) continue
    out = out.replaceAll('[VARIABLE]', () => v)
  }
  return out
}

/** A bookmark as phpMyAdmin's Bookmark object exposes it. */
export interface Bookmark extends BookmarkRow {
  isShared: boolean
  variableCount: number
}

const view = (r: BookmarkRow): Bookmark => ({
  ...r,
  isShared: r.user === '',
  variableCount: getVariableCount(r.query),
})

/**
 * pma: src/Bookmarks/BookmarkRepository.php (+ Bookmark::save / delete)
 */
export class BookmarkRepository {
  readonly backend: BookmarkBackend | null
  readonly allowSharedBookmarks: boolean

  constructor(backend: BookmarkBackend | null, allowSharedBookmarks: boolean) {
    this.backend = backend
    this.allowSharedBookmarks = allowSharedBookmarks
  }

  get available(): boolean {
    return this.backend !== null
  }

  /**
   * The row a new bookmark would get, or false when it cannot be created (no storage, empty
   * query or label, or a private bookmark without a user).
   * pma: BookmarkRepository::createBookmark
   */
  createBookmark(
    sqlQuery: string,
    label: string,
    user: string,
    database: string,
    shared = false,
  ): Omit<BookmarkRow, 'id'> | false {
    if (this.backend === null) return false
    if (sqlQuery === '' || label === '') return false
    const isShared = this.allowSharedBookmarks ? shared : false
    if (!isShared && user === '') return false
    return { dbase: database, user: isShared ? '' : user, label, query: sqlQuery }
  }

  /** pma: Bookmark::save */
  async save(b: Omit<BookmarkRow, 'id'>): Promise<boolean> {
    if (this.backend === null) return false
    return this.backend.insert(b)
  }

  /** pma: Bookmark::delete */
  async delete(id: number): Promise<boolean> {
    if (this.backend === null) return false
    return this.backend.delete(id)
  }

  /** pma: BookmarkRepository::getList */
  async getList(user: string, db: string | false = false): Promise<Bookmark[]> {
    if (this.backend === null) return []
    return (await this.backend.list(user, db, !this.allowSharedBookmarks)).map(view)
  }

  /** pma: BookmarkRepository::get */
  async get(user: string | null, id: number): Promise<Bookmark | null> {
    if (this.backend === null) return null
    const r = await this.backend.get(user, id, !this.allowSharedBookmarks)
    return r === null ? null : view(r)
  }

  /** pma: BookmarkRepository::getByLabel */
  async getByLabel(user: string, db: string, label: string): Promise<Bookmark | null> {
    if (this.backend === null) return null
    const r = await this.backend.getByLabel(user, db, label)
    return r === null ? null : view(r)
  }

  /**
   * Stores the query as a bookmark, optionally replacing the user's bookmarks with the same label
   * in that database first.
   * pma: src/Sql.php::storeTheQueryAsBookmark
   */
  async storeTheQueryAsBookmark(
    db: string,
    bookmarkUser: string,
    sqlQueryForBookmark: string,
    bookmarkLabel: string,
    bookmarkReplace: boolean,
    hasBookmarkAllUsers: boolean,
    currentUser = bookmarkUser,
  ): Promise<void> {
    if (bookmarkReplace) {
      for (const b of await this.getList(currentUser, db)) {
        if (b.label !== bookmarkLabel) continue
        await this.delete(b.id)
      }
    }
    const b = this.createBookmark(sqlQueryForBookmark, bookmarkLabel, bookmarkUser, db, hasBookmarkAllUsers)
    if (b === false) return
    await this.save(b)
  }
}

/** pma: src/Console/Console.php::getBookmarkContent (the welcome line) */
export function consoleBookmarkWelcome(count: number): string {
  if (count > 0) {
    return count === 1
      ? `Showing ${count} bookmark (both private and shared)`
      : `Showing ${count} bookmarks (both private and shared)`
  }
  return 'No bookmarks'
}

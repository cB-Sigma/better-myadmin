import type { Bookmark, QueryResponse } from '@bettermyadmin/contracts'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { qk } from '../../lib/queryKeys'

/** One entry of BookmarkRepository::getList. */
export interface BookmarkEntry {
  id: number
  label: string
  db: string
  query: string
  /** Bookmark::getUser() is empty: shared with every user */
  shared: boolean
  /** Bookmark::getVariableCount ([VARIABLE], [VARIABLEn]) */
  variableCount: number
}

const entry = (b: Bookmark): BookmarkEntry => ({
  id: b.id,
  label: b.label,
  db: b.dbase,
  query: b.query,
  shared: b.isShared,
  variableCount: b.variableCount,
})

/**
 * Bookmarks of the configuration storage (pma__bookmark, or the local store), through the metadata
 * endpoints. Without the bookmark feature the lists come back unavailable and no bookmark UI renders,
 * like phpMyAdmin.
 */
export const bookmarks = {
  /** "Bookmark this SQL query" (SqlController::addBookmark / Sql::storeTheQueryAsBookmark) */
  create: (
    server: number,
    b: { label: string; db: string; sql: string; shared: boolean; replace?: boolean },
  ): Promise<{ ok: boolean; message: string }> =>
    api
      .bookmarkCreate(server, {
        db: b.db,
        label: b.label,
        query: b.sql,
        shared: b.shared,
        replace: b.replace === true,
      })
      .then(
        (r) => ({ ok: r.success, message: r.message.text }),
        (e: Error) => ({ ok: false, message: e.message }),
      ),
  /** Console "Add bookmark" (/console/bookmark/add): `message` is "Succeeded" / "Failed" */
  consoleAdd: (
    server: number,
    b: { label: string; db: string; sql: string; shared: boolean },
  ): Promise<{ ok: boolean; message: string }> =>
    api
      .consoleBookmarkAdd(server, { db: b.db, label: b.label, bookmark_query: b.sql, shared: b.shared })
      .then((r) => ({ ok: r.data !== undefined, message: r.message })),
  /** action_bookmark=1 ("View only"): the query and "Showing bookmark" */
  show: (server: number, id: number) => api.bookmarkShow(server, id),
  /** action_bookmark=2: "The bookmark has been deleted." */
  remove: (server: number, id: number): Promise<{ message: string }> =>
    api.bookmarkDelete(server, id).then((r) => ({ message: r.message?.text ?? '' })),
  /** action_bookmark=0: Bookmark::applyVariables then the SQL-box pipeline, server side */
  run: (
    server: number,
    id: number,
    req: { db: string; table: string; variables: Record<number, string> },
  ): Promise<QueryResponse> =>
    api.bookmarkRun(server, id, {
      db: req.db,
      table: req.table,
      variables: Object.fromEntries(Object.entries(req.variables).map(([k, v]) => [String(k), v])),
    }),
}

/**
 * The feature flag and the list: `db` given is the SQL tab's getList(user, db); omitted is the console's
 * list of every database (Console::getBookmarkContent).
 */
export function useBookmarks(server: number, db?: string) {
  const list = useQuery({
    queryKey: qk.bookmarks(server, db ?? null),
    queryFn: async () => {
      const r = db === undefined ? await api.consoleBookmarks(server) : await api.bookmarks(server, db)
      return { available: r.available, bookmarks: r.bookmarks.map(entry) }
    },
  })
  return {
    enabled: list.data?.available === true,
    bookmarks: list.data?.bookmarks ?? [],
    refetch: list.refetch,
  }
}

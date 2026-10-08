import { useQuery } from '@tanstack/react-query'

/** One entry of BookmarkRepository::getList. */
export interface BookmarkEntry {
  id: number
  label: string
  db: string
  query: string
  /** '' for shared bookmarks */
  user: string
  /** Bookmark::getVariableCount ([VARIABLE], [VARIABLEn]) */
  variableCount: number
}

/**
 * Bookmark storage (pma__bookmark). The SQL tab and the console are written against this interface;
 * the configuration-storage module installs the implementation with `registerBookmarkProvider`.
 */
export interface BookmarkProvider {
  /** RelationParameters->bookmarkFeature !== null for the server. */
  isEnabled(server: number): Promise<boolean>
  /** BookmarkRepository::getList(user, db) — db undefined lists every database (console). */
  list(server: number, db?: string): Promise<BookmarkEntry[]>
  /** Sql::storeTheQueryAsBookmark / console "Add bookmark". */
  create(
    server: number,
    b: { label: string; db: string; sql: string; shared: boolean; replace?: boolean },
  ): Promise<{ ok: boolean; message: string }>
  /** Bookmark::delete ("The bookmark has been deleted."). */
  remove(server: number, id: number): Promise<{ message: string }>
  /** Bookmark::applyVariables for running a bookmark with its variables. */
  run(server: number, id: number, variables: Record<number, string>): Promise<{ sql: string }>
}

/** No configuration storage: no bookmark UI at all, like phpMyAdmin without the bookmark feature. */
const disabled: BookmarkProvider = {
  isEnabled: async () => false,
  list: async () => [],
  create: async () => ({ ok: false, message: 'Bookmark not created!' }),
  remove: async () => ({ message: '' }),
  run: async () => ({ sql: '' }),
}

let provider: BookmarkProvider = disabled

export function registerBookmarkProvider(p: BookmarkProvider | null): void {
  provider = p ?? disabled
}

export function bookmarkProvider(): BookmarkProvider {
  return provider
}

/** The feature flag and the list for a scope (empty and disabled until a provider is registered). */
export function useBookmarks(server: number, db?: string) {
  const enabled = useQuery({
    queryKey: ['srv', server, 'bookmarks', 'enabled'],
    queryFn: () => provider.isEnabled(server),
  })
  const list = useQuery({
    queryKey: ['srv', server, 'bookmarks', 'list', db ?? null],
    queryFn: () => provider.list(server, db),
    enabled: enabled.data === true,
  })
  return { enabled: enabled.data === true, bookmarks: list.data ?? [], refetch: list.refetch }
}

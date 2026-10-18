import { useSyncExternalStore } from 'react'

/**
 * The user errors the server sent (X-BMA-User-Errors, apps/server/src/http/user-errors.ts): the
 * `errors` key of phpMyAdmin's AJAX answers. The shell shows them in `#pma_errors` under the page and
 * empties the list when another page loads (ajax.ts: `$('#pma_errors').remove()`).
 */
export interface UserErrorItem {
  level: 'error' | 'notice'
  /** escaped message with its BBCode converted (Error::getDisplay) */
  html: string
}

export const USER_ERRORS_HEADER = 'X-BMA-User-Errors'

let items: UserErrorItem[] = []
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

/** Reads the header of an answer; the same message is shown once. */
export function collectUserErrors(res: Response): void {
  const h = res.headers.get(USER_ERRORS_HEADER)
  if (h === null) return
  let list: UserErrorItem[]
  try {
    list = JSON.parse(decodeURIComponent(h)) as UserErrorItem[]
  } catch {
    return
  }
  const fresh = list.filter((e) => !items.some((x) => x.html === e.html && x.level === e.level))
  if (fresh.length === 0) return
  items = [...items, ...fresh]
  emit()
}

/** A new page: the previous page's errors go. */
export function clearUserErrors(): void {
  if (items.length === 0) return
  items = []
  emit()
}

export function useUserErrors(): UserErrorItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => items,
  )
}

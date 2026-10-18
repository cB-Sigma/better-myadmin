import { AsyncLocalStorage } from 'node:async_hooks'

/** One connection handed to several holders of the same request. */
export interface SharedLink<T> {
  conn: T
  /** holders that have not released it yet */
  refs: number
}

/**
 * The connections of one HTTP request: phpMyAdmin's request has one user link and one control
 * link, so a second acquire of the same link in the same request (withDb, then MetaRequest, the
 * tracker, the preferences middleware) shares the one already held instead of taking another from
 * the session's pool. Holding several connections of one pool per request is what deadlocks a
 * session whose concurrent requests each wait for a second one.
 */
export interface RequestScope {
  links: Map<string, SharedLink<unknown>>
  /** connections this request holds (any pool): such a request never waits for the budget */
  held: number
}

const storage = new AsyncLocalStorage<RequestScope>()

/** Runs `fn` (one HTTP request) in its own scope. */
export function runInRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ links: new Map(), held: 0 }, fn)
}

export function requestScope(): RequestScope | undefined {
  return storage.getStore()
}

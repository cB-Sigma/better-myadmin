import type { Conn } from './connection.ts'

/**
 * What DatabaseInterface::tryQuery does after every successful statement of a request
 * (`Tracker::handleQuery`), on the user link and the control link alike. The hook is keyed by the
 * request's statement log, which every connection of that request writes to.
 * pma: src/Dbal/DatabaseInterface.php::tryQuery
 */
export type QueryHook = (sql: string, userConn: Conn | null) => Promise<void>

const hooks = new WeakMap<object, QueryHook>()

export function setQueryHook(log: object, hook: QueryHook | null): void {
  if (hook === null) hooks.delete(log)
  else hooks.set(log, hook)
}

/** Runs the request's hook for a statement that succeeded; a failing hook leaves the statement's result alone. */
export async function afterQuery(log: object, sql: string, userConn: Conn | null): Promise<void> {
  const hook = hooks.get(log)
  if (hook === undefined) return
  try {
    await hook(sql, userConn)
  } catch (e) {
    console.error(e)
  }
}

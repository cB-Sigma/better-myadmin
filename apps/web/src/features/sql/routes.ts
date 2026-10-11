/** Route (and params) of the SQL tab of a scope, for <Link> and navigate(). */
export function sqlTabRoute(server: number, db: string, table: string) {
  if (db === '') return { to: '/s/$server/sql', params: { server } } as const
  if (table === '') return { to: '/s/$server/db/$db/sql', params: { server, db } } as const
  return { to: '/s/$server/db/$db/t/$table/sql', params: { server, db, table } } as const
}

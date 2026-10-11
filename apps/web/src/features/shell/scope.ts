import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { api } from '../../lib/api'
import { qk } from '../../lib/queryKeys.ts'

/** The scope of the current route (server, optional database and table), like CommonParams. */
export function useScopeParams(): { server: number; db: string; table: string } {
  const p = useParams({ strict: false }) as { server?: number | string; db?: string; table?: string }
  return { server: Number(p.server ?? 0), db: p.db ?? '', table: p.table ?? '' }
}

/** Scope payloads are cached per session on the server; on the client they live until a reload. */
const SCOPE_STALE = 5 * 60_000

export const serverScopeQuery = (server: number) => ({
  queryKey: qk.scope(server),
  queryFn: () => api.serverScope(server),
  staleTime: SCOPE_STALE,
})

export const databaseScopeQuery = (server: number, db: string) => ({
  queryKey: qk.dbScope({ server, db }),
  queryFn: () => api.databaseScope({ server, db }),
  staleTime: SCOPE_STALE,
})

export const tableScopeQuery = (server: number, db: string, table: string) => ({
  queryKey: qk.tableScope({ server, db, table }),
  queryFn: () => api.tableScope({ server, db, table }),
  staleTime: SCOPE_STALE,
})

export function useServerScope(server: number) {
  return useQuery({ ...serverScopeQuery(server), enabled: server > 0 })
}

export function useDatabaseScope(server: number, db: string) {
  return useQuery({ ...databaseScopeQuery(server, db), enabled: server > 0 && db !== '' })
}

export function useTableScope(server: number, db: string, table: string) {
  return useQuery({ ...tableScopeQuery(server, db, table), enabled: server > 0 && db !== '' && table !== '' })
}

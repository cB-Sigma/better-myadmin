import type {
  AdvisorResponse,
  BinlogQuery,
  BinlogResponse,
  CollationsResponse,
  CreateDatabaseResponse,
  DatabasesQuery,
  DatabasesResponse,
  DropDatabasesResponse,
  EngineResponse,
  EnginesResponse,
  GetVariableResponse,
  KillProcessResponse,
  PluginsResponse,
  ProcessList,
  ProcessesQuery,
  QueryStatistics,
  ServerVariablesResponse,
  SetVariableResponse,
  StatusOverview,
  StatusVariables,
  StatusVariablesRequest,
} from '@bettermyadmin/contracts'
import { call } from '../../lib/api'
import { qk } from '../../lib/queryKeys'

/** Server-level API (docs/architecture/05-api-reference.md#server-scope). */
const qs = (q: Record<string, unknown>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === false || v === '') continue
    p.set(k, v === true ? '1' : String(v))
  }
  const s = p.toString()
  return s === '' ? '' : `?${s}`
}
const base = (s: number) => `/servers/${s}`

export const serverApi = {
  databases: (s: number, q: DatabasesQuery) => call<DatabasesResponse>('GET', `${base(s)}/databases${qs(q)}`),
  createDatabase: (s: number, name: string, collation: string) =>
    call<CreateDatabaseResponse>('POST', `${base(s)}/databases`, { new_db: name, db_collation: collation }),
  dropDatabases: (s: number, names: string[]) =>
    call<DropDatabasesResponse>('POST', `${base(s)}/databases/drop`, { selected_dbs: names }),
  status: (s: number) => call<StatusOverview>('GET', `${base(s)}/status`),
  processes: (s: number, q: ProcessesQuery) =>
    call<ProcessList>('GET', `${base(s)}/status/processes${qs(q)}`),
  kill: (s: number, id: string) =>
    call<KillProcessResponse>('POST', `${base(s)}/status/processes/${id}/kill`),
  queries: (s: number) => call<QueryStatistics>('GET', `${base(s)}/status/queries`),
  statusVariables: (s: number, req: StatusVariablesRequest = {}) =>
    req.flush !== undefined
      ? call<StatusVariables>('POST', `${base(s)}/status/variables`, req)
      : call<StatusVariables>('GET', `${base(s)}/status/variables${qs(req)}`),
  advisor: (s: number) => call<AdvisorResponse>('GET', `${base(s)}/status/advisor`),
  variables: (s: number) => call<ServerVariablesResponse>('GET', `${base(s)}/variables`),
  getVariable: (s: number, name: string) =>
    call<GetVariableResponse>('GET', `${base(s)}/variables/${encodeURIComponent(name)}`),
  setVariable: (s: number, name: string, value: string) =>
    call<SetVariableResponse>('POST', `${base(s)}/variables/${encodeURIComponent(name)}`, {
      varValue: value,
    }),
  collations: (s: number) => call<CollationsResponse>('GET', `${base(s)}/collations`),
  engines: (s: number) => call<EnginesResponse>('GET', `${base(s)}/engines`),
  engine: (s: number, engine: string, page = '') =>
    call<EngineResponse>(
      'GET',
      `${base(s)}/engines/${encodeURIComponent(engine)}${page !== '' ? `/${encodeURIComponent(page)}` : ''}`,
    ),
  plugins: (s: number) => call<PluginsResponse>('GET', `${base(s)}/plugins`),
  binlog: (s: number, q: BinlogQuery) => call<BinlogResponse>('GET', `${base(s)}/binlog${qs(q)}`),
}

/** Query keys below ['srv', s] (docs/architecture/03-frontend-architecture.md#query-keys). */
export const serverKeys = {
  databases: (s: number, q: object) => [...qk.srv(s), 'databases', q] as const,
  allDatabases: (s: number) => [...qk.srv(s), 'databases'] as const,
  status: (s: number, page: string, q: object = {}) => [...qk.srv(s), 'status', page, q] as const,
  variables: (s: number) => [...qk.srv(s), 'variables'] as const,
  collations: (s: number) => [...qk.srv(s), 'collations'] as const,
  engines: (s: number, engine = '', page = '') => [...qk.srv(s), 'engines', engine, page] as const,
  plugins: (s: number) => [...qk.srv(s), 'plugins'] as const,
  binlog: (s: number, q: object) => [...qk.srv(s), 'binlog', q] as const,
}

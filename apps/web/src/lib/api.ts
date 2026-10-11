import type {
  AddColumnsRequest,
  AddKeyRequest,
  AdvisorResponse,
  AuthState,
  AutocompleteResponse,
  BinlogQuery,
  BinlogResponse,
  BookmarkCreateRequest,
  BookmarkCreateResponse,
  BookmarkDeleteResponse,
  BookmarkListResponse,
  BookmarkRunRequest,
  BookmarkShowResponse,
  BrowseRequest,
  CancelResponse,
  ChangeColumnsRequest,
  ChangeFormResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  CollationsResponse,
  ColumnFormOptions,
  ColumnValuesResponse,
  ConsoleBookmarkAddRequest,
  ConsoleBookmarkAddResponse,
  ConsoleBookmarksResponse,
  ConsoleConfigResponse,
  CreateDatabaseResponse,
  CreateTableFormResponse,
  CreateTableRequest,
  DatabaseScope,
  DatabasesQuery,
  DatabasesResponse,
  DdlResponse,
  DefaultFkCheckResponse,
  DropColumnsRequest,
  DropDatabasesResponse,
  EngineResponse,
  EnginesResponse,
  ErrorEnvelope,
  ErrorReportRequest,
  ErrorReportResponse,
  FormatResponse,
  GetVariableResponse,
  GridSaveRequest,
  GridSaveResponse,
  HistoryResponse,
  HomeResponse,
  I18nState,
  IndexFormResponse,
  KillProcessResponse,
  LintRequest,
  LintResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MoveColumnsRequest,
  NavBranchQuery,
  NavBranchResponse,
  NavTreeQuery,
  NavTreeRequest,
  NavTreeResponse,
  PartitionFormResponse,
  PartitionMaintenanceRequest,
  PartitioningRequest,
  PasswordForm,
  PluginsResponse,
  ProcessList,
  ProcessesQuery,
  QueryRequest,
  QueryResponse,
  QueryStatistics,
  RenameIndexRequest,
  ReservedWordCheckResponse,
  SaveIndexRequest,
  ServerScope,
  ServerVariablesResponse,
  SetCollationResponse,
  SetVariableResponse,
  SimulateRequest,
  SimulateResponse,
  SqlFormResponse,
  SqlMessage,
  StatementResult,
  StatusOverview,
  StatusVariables,
  StatusVariablesRequest,
  StructureResponse,
  TableScope,
  VersionCheckResponse,
} from '@bettermyadmin/contracts'
import { CSRF_COOKIE, CSRF_HEADER } from '@bettermyadmin/contracts/constants'
import type { ClientConfig } from './config.ts'

/** An API error carrying the server's envelope (message texts are phpMyAdmin's). */
export class ApiError extends Error {
  readonly status: number
  readonly envelope: ErrorEnvelope['error']
  constructor(status: number, envelope: ErrorEnvelope['error']) {
    super(envelope.message)
    this.status = status
    this.envelope = envelope
  }
}

/**
 * Any failure as a message for `<MessageBox {...errorMessage(e)} />`: an ApiError shows
 * `#errno - message` (DatabaseInterface::getError) with its SQL; anything else its text.
 */
export function errorMessage(e: unknown): SqlMessage {
  if (e instanceof ApiError) {
    const sql = e.envelope.sql
    const text =
      e.envelope.errno !== undefined ? `#${e.envelope.errno} - ${e.envelope.message}` : e.envelope.message
    return sql === undefined ? { type: 'error', text } : { type: 'error', text, sql }
  }
  return { type: 'error', text: e instanceof Error ? e.message : String(e) }
}

function readCookie(name: string): string {
  for (const part of document.cookie.split('; ')) {
    const [k, ...v] = part.split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return ''
}

/** The only place in the web app allowed to call fetch. */
export async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET') headers[CSRF_HEADER] = readCookie(CSRF_COOKIE)
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const env = (json as ErrorEnvelope | null)?.error ?? {
      code: 'INTERNAL' as const,
      message: res.statusText,
    }
    throw new ApiError(res.status, env)
  }
  return json as T
}

/** The scope argument of database- and table-level endpoints (and of their `qk` keys). */
export interface DbRef {
  server: number
  db: string
}
export interface TableRef extends DbRef {
  table: string
}

const srvPath = (s: number) => `/servers/${s}`
const dbPath = (r: DbRef) => `${srvPath(r.server)}/databases/${encodeURIComponent(r.db)}`
const tblPath = (r: TableRef) => `${dbPath(r)}/tables/${encodeURIComponent(r.table)}`

/**
 * Every endpoint of the API, grouped by section of docs/architecture/05-api-reference.md. The first
 * argument is the scope: `server: number`, a `DbRef` or a `TableRef`. Reads are `<thing>`, writes
 * `<verb><Thing>` (docs/architecture/16-golden-path.md#data).
 */
export const api = {
  authState: () => call<AuthState>('GET', '/auth/state'),
  /** The request language; `lang` selects one (pma: `?lang=` from the language selector). */
  i18n: (lang?: string) =>
    call<I18nState>('GET', lang === undefined ? '/i18n' : `/i18n?lang=${encodeURIComponent(lang)}`),
  login: (req: LoginRequest) => call<LoginResponse>('POST', '/auth/login', req),
  logout: () => call<LogoutResponse>('POST', '/auth/logout'),
  query: (server: number, req: QueryRequest) => call<QueryResponse>('POST', `/servers/${server}/query`, req),
  // shell (docs/architecture/05-api-reference.md#server-scope)
  switchServer: (server: number) => call<{ ok: true }>('POST', '/auth/switch-server', { server }),
  configPublic: () => call<ClientConfig>('GET', '/meta/config-public'),
  build: () =>
    call<{ name: string; version: string; commit: string | null; branch: string | null }>(
      'GET',
      '/meta/build',
    ),
  versionCheck: () => call<VersionCheckResponse>('GET', '/meta/version-check'),
  serverScope: (server: number) => call<ServerScope>('GET', `/servers/${server}`),
  databaseScope: (r: DbRef) => call<DatabaseScope>('GET', dbPath(r)),
  tableScope: (r: TableRef) => call<TableScope>('GET', `${tblPath(r)}/capabilities`),
  home: (server: number) => call<HomeResponse>('GET', `/servers/${server}/home`),
  setCollation: (server: number, collation: string) =>
    call<SetCollationResponse>('POST', `/servers/${server}/session/collation`, {
      collation_connection: collation,
    }),
  passwordForm: (server: number) => call<PasswordForm>('GET', `/servers/${server}/account/password`),
  changePassword: (server: number, req: ChangePasswordRequest) =>
    call<ChangePasswordResponse>('POST', `/servers/${server}/account/password`, req),
  /** ThemeSetController's ThemeDefault in the user preferences */
  themeSet: (server: number, theme: string) =>
    call<{ ok: boolean }>('POST', `/servers/${server}/themes/set`, { theme }),
  errorReport: (req: ErrorReportRequest) => call<ErrorReportResponse>('POST', '/telemetry/error', req),
  navTree: (server: number, q: NavTreeQuery = {}) =>
    call<NavTreeResponse>('GET', `/servers/${server}/navigation/tree${queryString(q)}`),
  navTreeState: (server: number, req: NavTreeRequest) =>
    call<NavTreeResponse>('POST', `/servers/${server}/navigation/tree`, req),
  navBranch: (server: number, q: NavBranchQuery) => {
    const { path, ...rest } = q
    const qs = new URLSearchParams()
    for (const p of path) qs.append('path', p)
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) qs.set(k, String(v))
    return call<NavBranchResponse>('GET', `/servers/${server}/navigation/branch?${qs}`)
  },
  // SQL tab and console (docs/architecture/05-api-reference.md#sql-execution)
  sqlForm: (server: number, p: { db?: string; table?: string; sqlQuery?: string | undefined }) =>
    call<SqlFormResponse>('GET', `/servers/${server}/sql/form?${qs(p)}`),
  sqlLint: (server: number, req: LintRequest) =>
    call<LintResponse>('POST', `/servers/${server}/sql/lint`, req),
  sqlFormat: (server: number, sql: string, singleLine: boolean) =>
    call<FormatResponse>('POST', `/servers/${server}/sql/format`, { sql, singleLine }),
  sqlAutocomplete: (server: number, db: string) =>
    call<AutocompleteResponse>('GET', `/servers/${server}/sql/autocomplete?${qs({ db })}`),
  defaultFkCheck: (server: number) =>
    call<DefaultFkCheckResponse>('GET', `/servers/${server}/sql/default-fk-check`),
  /** History::getHistory (configuration storage; `history: false` without the feature) */
  sqlHistory: (server: number) => call<HistoryResponse>('GET', `/servers/${server}/sql/history`),
  // bookmarks (configuration storage, docs/architecture/05-api-reference.md#sql-execution)
  bookmarks: (server: number, db: string) =>
    call<BookmarkListResponse>('GET', `/servers/${server}/bookmarks?db=${encodeURIComponent(db)}`),
  bookmarkCreate: (server: number, req: BookmarkCreateRequest) =>
    call<BookmarkCreateResponse>('POST', `/servers/${server}/bookmarks`, req),
  bookmarkShow: (server: number, id: number) =>
    call<BookmarkShowResponse>('GET', `/servers/${server}/bookmarks/${id}`),
  bookmarkDelete: (server: number, id: number) =>
    call<BookmarkDeleteResponse>('POST', `/servers/${server}/bookmarks/${id}/delete`),
  bookmarkRun: (server: number, id: number, req: BookmarkRunRequest) =>
    call<QueryResponse>('POST', `/servers/${server}/bookmarks/${id}/run`, req),
  consoleBookmarks: (server: number) =>
    call<ConsoleBookmarksResponse>('GET', `/servers/${server}/console/bookmarks`),
  consoleBookmarkAdd: (server: number, req: ConsoleBookmarkAddRequest) =>
    call<ConsoleBookmarkAddResponse>('POST', `/servers/${server}/console/bookmarks`, req),
  simulate: (server: number, req: SimulateRequest) =>
    call<SimulateResponse>('POST', `/servers/${server}/query/simulate`, req),
  cancelQuery: (server: number, queryId: string) =>
    call<CancelResponse>('POST', `/servers/${server}/query/cancel`, { queryId }),
  consoleConfig: (server: number) => call<ConsoleConfigResponse>('GET', `/servers/${server}/console/config`),
  consoleConfigUpdate: (server: number, key: string, value: string) =>
    call<{ message: string }>('POST', `/servers/${server}/console/config`, { key, value }),
  // server administration (docs/architecture/05-api-reference.md#server-scope)
  databases: (s: number, q: DatabasesQuery) =>
    call<DatabasesResponse>('GET', `${srvPath(s)}/databases${flags(q)}`),
  createDatabase: (s: number, name: string, collation: string) =>
    call<CreateDatabaseResponse>('POST', `${srvPath(s)}/databases`, {
      new_db: name,
      db_collation: collation,
    }),
  dropDatabases: (s: number, names: string[]) =>
    call<DropDatabasesResponse>('POST', `${srvPath(s)}/databases/drop`, { selected_dbs: names }),
  statusOverview: (s: number) => call<StatusOverview>('GET', `${srvPath(s)}/status`),
  processes: (s: number, q: ProcessesQuery) =>
    call<ProcessList>('GET', `${srvPath(s)}/status/processes${flags(q)}`),
  killProcess: (s: number, id: string) =>
    call<KillProcessResponse>('POST', `${srvPath(s)}/status/processes/${id}/kill`),
  queryStatistics: (s: number) => call<QueryStatistics>('GET', `${srvPath(s)}/status/queries`),
  statusVariables: (s: number, req: StatusVariablesRequest = {}) =>
    req.flush !== undefined
      ? call<StatusVariables>('POST', `${srvPath(s)}/status/variables`, req)
      : call<StatusVariables>('GET', `${srvPath(s)}/status/variables${flags(req)}`),
  advisor: (s: number) => call<AdvisorResponse>('GET', `${srvPath(s)}/status/advisor`),
  serverVariables: (s: number) => call<ServerVariablesResponse>('GET', `${srvPath(s)}/variables`),
  serverVariable: (s: number, name: string) =>
    call<GetVariableResponse>('GET', `${srvPath(s)}/variables/${encodeURIComponent(name)}`),
  setVariable: (s: number, name: string, value: string) =>
    call<SetVariableResponse>('POST', `${srvPath(s)}/variables/${encodeURIComponent(name)}`, {
      varValue: value,
    }),
  collations: (s: number) => call<CollationsResponse>('GET', `${srvPath(s)}/collations`),
  engines: (s: number) => call<EnginesResponse>('GET', `${srvPath(s)}/engines`),
  engine: (s: number, engine: string, page = '') =>
    call<EngineResponse>(
      'GET',
      `${srvPath(s)}/engines/${encodeURIComponent(engine)}${page !== '' ? `/${encodeURIComponent(page)}` : ''}`,
    ),
  plugins: (s: number) => call<PluginsResponse>('GET', `${srvPath(s)}/plugins`),
  binlog: (s: number, q: BinlogQuery) => call<BinlogResponse>('GET', `${srvPath(s)}/binlog${flags(q)}`),
  // table structure (docs/architecture/05-api-reference.md#table-scope)
  tableStructure: (r: TableRef) => call<StructureResponse>('GET', `${tblPath(r)}/structure`),
  changeColumnsForm: (r: TableRef, fields: string[]) =>
    call<ChangeFormResponse>(
      'GET',
      `${tblPath(r)}/columns/form?${fields.map((f) => `fields=${encodeURIComponent(f)}`).join('&')}`,
    ),
  addColumnsForm: (r: TableRef) =>
    call<{ options: ColumnFormOptions }>('GET', `${tblPath(r)}/columns/add-form`),
  createTableForm: (r: DbRef) => call<CreateTableFormResponse>('GET', `${dbPath(r)}/create-table/form`),
  indexForm: (r: TableRef, q: { index?: string; create?: number }) =>
    call<IndexFormResponse>('GET', `${tblPath(r)}/indexes/form${queryString(q)}`),
  partitionForm: (r: TableRef) => call<PartitionFormResponse>('GET', `${tblPath(r)}/partitions/form`),
  createTable: (r: DbRef, req: CreateTableRequest) =>
    call<DdlResponse & { db: string; table: string }>('POST', `${dbPath(r)}/tables`, req),
  addColumns: (r: TableRef, req: AddColumnsRequest) =>
    call<DdlResponse>('POST', `${tblPath(r)}/columns/add`, req),
  changeColumns: (r: TableRef, req: ChangeColumnsRequest) =>
    call<DdlResponse>('POST', `${tblPath(r)}/columns/change`, req),
  dropColumns: (r: TableRef, req: DropColumnsRequest) =>
    call<DdlResponse>('POST', `${tblPath(r)}/columns/drop`, req),
  addKey: (r: TableRef, req: AddKeyRequest) => call<DdlResponse>('POST', `${tblPath(r)}/columns/key`, req),
  moveColumns: (r: TableRef, req: MoveColumnsRequest) =>
    call<DdlResponse>('POST', `${tblPath(r)}/columns/move`, req),
  reservedWordCheck: (r: TableRef, names: string[], table?: string) =>
    call<ReservedWordCheckResponse>('POST', `${tblPath(r)}/columns/reserved-word-check`, {
      names,
      ...(table !== undefined ? { table } : {}),
    }),
  saveIndex: (r: TableRef, req: SaveIndexRequest) => call<DdlResponse>('POST', `${tblPath(r)}/indexes`, req),
  renameIndex: (r: TableRef, req: RenameIndexRequest) =>
    call<DdlResponse>('POST', `${tblPath(r)}/indexes/rename`, req),
  dropIndex: (r: TableRef, name: string) => call<DdlResponse>('POST', `${tblPath(r)}/indexes/drop`, { name }),
  savePartitioning: (r: TableRef, req: PartitioningRequest) =>
    call<DdlResponse>('POST', `${tblPath(r)}/partitions/partitioning`, req),
  partitionMaintenance: (r: TableRef, req: PartitionMaintenanceRequest) =>
    call<DdlResponse>('POST', `${tblPath(r)}/partitions/maintenance`, req),
  removePartitioning: (r: TableRef) =>
    call<DdlResponse>('POST', `${tblPath(r)}/partitions/remove-partitioning`, {}),
  // results grid (docs/features/02-browse-results-grid.md; pma: /sql and its helper routes)
  browse: (server: number, req: BrowseRequest) =>
    call<BrowseResponse>('POST', `/servers/${server}/browse`, req),
  gridValue: (server: number, req: { db: string; table: string; column: string; where: string }) =>
    call<{ value: string | null }>('POST', `/servers/${server}/browse/grid-value`, req),
  gridValues: (
    server: number,
    req: {
      kind: 'enum' | 'set' | 'relational'
      db: string
      table: string
      column: string
      currValue: string
      where?: string
      keyOrDisplay?: string
      relationalDisplay?: 'K' | 'D'
    },
  ) => call<ColumnValuesResponse>('POST', `/servers/${server}/browse/values`, req),
  gridSave: (server: number, req: GridSaveRequest) =>
    call<GridSaveResponse>('POST', `/servers/${server}/browse/save`, req),
  deleteRows: (
    server: number,
    req: { db: string; table: string; where: string[]; fkChecks: boolean; originalSql: string },
  ) => call<BrowseResponse>('POST', `/servers/${server}/browse/delete-rows`, req),
  /** pma: /sql/set-column-preferences */
  columnPrefs: (
    r: TableRef,
    req: { col_order?: string; col_visib?: string; table_create_time?: string | null },
  ) => call<{ success: boolean; message: { text: string } | null }>('POST', `${tblPath(r)}/uiprefs`, req),
  /** /table/get-field download URL */
  gridFieldUrl: (server: number, p: { db: string; table: string; where: string; sig: string; key: string }) =>
    `/api/servers/${server}/browse/field?${new URLSearchParams(p)}`,
}

/** POST /browse: the statement with its grid, the default-bookmark notice and the previous query card. */
export type BrowseResponse = QueryResponse & { usingBookmark: string | null; previous?: StatementResult }

function queryString(q: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined) qs.set(k, String(v))
  const s = qs.toString()
  return s === '' ? '' : `?${s}`
}

function qs(p: Record<string, string | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') u.set(k, v)
  return u.toString()
}

/** Search params where `true` is `1` and false/empty values are left out (the server pages' GET forms). */
function flags(q: Record<string, unknown>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === false || v === '') continue
    p.set(k, v === true ? '1' : String(v))
  }
  const s = p.toString()
  return s === '' ? '' : `?${s}`
}

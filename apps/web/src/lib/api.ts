import type {
  AuthState,
  AutocompleteResponse,
  BookmarkCreateRequest,
  BookmarkCreateResponse,
  BookmarkDeleteResponse,
  BookmarkListResponse,
  BookmarkRunRequest,
  BookmarkShowResponse,
  BrowseRequest,
  CancelResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  ColumnValuesResponse,
  ConsoleBookmarkAddRequest,
  ConsoleBookmarkAddResponse,
  ConsoleBookmarksResponse,
  ConsoleConfigResponse,
  CreateTrackingVersionRequest,
  DatabaseScope,
  DefaultFkCheckResponse,
  DeleteTrackingVersionsRequest,
  ErrorEnvelope,
  ErrorReportRequest,
  ErrorReportResponse,
  FindReplacePreviewResponse,
  FindReplaceRequest,
  FindReplaceResponse,
  FormatResponse,
  GridSaveRequest,
  GridSaveResponse,
  HistoryResponse,
  HomeResponse,
  I18nState,
  LintRequest,
  LintResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MaintenanceRequest,
  MoveCopyRequest,
  NavBranchQuery,
  NavBranchResponse,
  NavTreeQuery,
  NavTreeRequest,
  NavTreeResponse,
  OperationsPageResponse,
  OperationsResponse,
  OrderByRequest,
  PartitionOpsRequest,
  PasswordForm,
  QueryRequest,
  QueryResponse,
  RangeResponse,
  RelationDropdownResponse,
  RelationPageResponse,
  RelationSaveRequest,
  RelationSaveResponse,
  RenameViewRequest,
  SearchPageResponse,
  SearchRequest,
  SearchResponse,
  ServerScope,
  SetCollationResponse,
  SimulateRequest,
  SimulateResponse,
  SqlActionRequest,
  SqlFormResponse,
  StatementResult,
  TableOptionsRequest,
  TableScope,
  ToggleTrackingRequest,
  TrackingPageResponse,
  TrackingReportRequest,
  TrackingReportResponse,
  TrackingResponse,
  TrackingSnapshotResponse,
  VersionCheckResponse,
  ZoomRequest,
  ZoomResponse,
  ZoomRowResponse,
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
  databaseScope: (server: number, db: string) =>
    call<DatabaseScope>('GET', `/servers/${server}/databases/${encodeURIComponent(db)}`),
  tableScope: (server: number, db: string, table: string) =>
    call<TableScope>(
      'GET',
      `/servers/${server}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/capabilities`,
    ),
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
  // table level beyond Structure (docs/features/04-table-level.md)
  tableOperations: (s: TableRef) => call<OperationsPageResponse>('GET', `${tablePath(s)}/operations`),
  tableOperation: <K extends keyof TableOpBodies>(s: TableRef, op: K, body: TableOpBodies[K]) =>
    call<OperationsResponse>('POST', `${tablePath(s)}/operations/${op}`, body),
  tableRelation: (s: TableRef) => call<RelationPageResponse>('GET', `${tablePath(s)}/relation`),
  tableRelationDropdown: (s: TableRef, q: { foreignDb: string; foreignTable?: string; foreign: boolean }) =>
    call<RelationDropdownResponse>(
      'GET',
      `${tablePath(s)}/relation/dropdown${queryString({ ...q, foreign: String(q.foreign) })}`,
    ),
  tableRelationSave: (s: TableRef, req: RelationSaveRequest) =>
    call<RelationSaveResponse>('POST', `${tablePath(s)}/relation`, req),
  tableSearchPage: (s: TableRef) => call<SearchPageResponse>('GET', `${tablePath(s)}/search`),
  tableSearch: (s: TableRef, req: SearchRequest) =>
    call<SearchResponse>('POST', `${tablePath(s)}/search`, req),
  tableSearchRange: (s: TableRef, column: string) =>
    call<RangeResponse>('GET', `${tablePath(s)}/search/range${queryString({ column })}`),
  tableZoom: (s: TableRef, req: ZoomRequest) =>
    call<ZoomResponse>('POST', `${tablePath(s)}/search/zoom`, req),
  tableZoomRow: (s: TableRef, whereClause: string, sig: string) =>
    call<ZoomRowResponse>('POST', `${tablePath(s)}/search/zoom/row`, { whereClause, sig }),
  tableFindReplacePreview: (s: TableRef, req: FindReplaceRequest) =>
    call<FindReplacePreviewResponse>('POST', `${tablePath(s)}/find-replace/preview`, req),
  tableFindReplace: (s: TableRef, req: FindReplaceRequest) =>
    call<FindReplaceResponse>('POST', `${tablePath(s)}/find-replace`, req),
  tableRelationDropFk: (s: TableRef, constraint: string) =>
    call<OperationsResponse>('POST', `${tablePath(s)}/relation/drop-foreign-key`, { constraint }),
  tableTracking: (s: TableRef) => call<TrackingPageResponse>('GET', `${tablePath(s)}/tracking`),
  tableTrackingCreate: (s: TableRef, req: CreateTrackingVersionRequest) =>
    call<TrackingResponse>('POST', `${tablePath(s)}/tracking/versions`, req),
  tableTrackingDelete: (s: TableRef, req: DeleteTrackingVersionsRequest) =>
    call<TrackingResponse>('POST', `${tablePath(s)}/tracking/versions/delete`, req),
  tableTrackingToggle: (s: TableRef, req: ToggleTrackingRequest) =>
    call<TrackingResponse>('POST', `${tablePath(s)}/tracking/toggle`, req),
  tableTrackingReport: (s: TableRef, req: Partial<TrackingReportRequest> & { version: string }) =>
    call<TrackingReportResponse>('POST', `${tablePath(s)}/tracking/report`, req),
  tableTrackingSnapshot: (s: TableRef, version: string) =>
    call<TrackingSnapshotResponse>('GET', `${tablePath(s)}/tracking/snapshot${queryString({ version })}`),
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
    server: number,
    db: string,
    table: string,
    req: { col_order?: string; col_visib?: string; table_create_time?: string | null },
  ) =>
    call<{ success: boolean; message: { text: string } | null }>(
      'POST',
      `/servers/${server}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/uiprefs`,
      req,
    ),
  /** /table/get-field download URL */
  gridFieldUrl: (server: number, p: { db: string; table: string; where: string; sig: string; key: string }) =>
    `/api/servers/${server}/browse/field?${new URLSearchParams(p)}`,
}

/** A table of a server (the table-scope routes). */
export interface TableRef {
  server: number
  db: string
  table: string
}

const tablePath = (s: TableRef) =>
  `/servers/${s.server}/databases/${encodeURIComponent(s.db)}/tables/${encodeURIComponent(s.table)}`

interface TableOpBodies {
  'order-by': OrderByRequest
  'move-copy': MoveCopyRequest
  options: TableOptionsRequest
  maintenance: MaintenanceRequest
  sql: SqlActionRequest
  partitions: PartitionOpsRequest
  'rename-view': RenameViewRequest
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

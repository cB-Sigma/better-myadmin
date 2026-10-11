import type {
  AuthState,
  AutocompleteResponse,
  BookmarkCreateRequest,
  BookmarkCreateResponse,
  BookmarkDeleteResponse,
  BookmarkListResponse,
  BookmarkRunRequest,
  BookmarkShowResponse,
  CancelResponse,
  CentralColumn,
  CentralColumnsActionResponse,
  CentralColumnsRequest,
  CentralColumnsResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  ConsoleBookmarkAddRequest,
  ConsoleBookmarkAddResponse,
  ConsoleBookmarksResponse,
  ConsoleConfigResponse,
  CopyFormResponse,
  DataDictionaryResponse,
  DatabaseScope,
  DbActionResponse,
  DbExportResponse,
  DbOperationsResponse,
  DbPrivilegesResponse,
  DbRenameCopyResponse,
  DbSearchFormResponse,
  DbSearchResponse,
  DbStructureResponse,
  DbTrackingRequest,
  DbTrackingResponse,
  DefaultFkCheckResponse,
  ErrorEnvelope,
  ErrorReportRequest,
  ErrorReportResponse,
  EventEditorData,
  EventsListResponse,
  FormatResponse,
  HistoryResponse,
  HomeResponse,
  I18nState,
  LintRequest,
  LintResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MaintenanceResponse,
  MultiTableFormResponse,
  MultiTableKeysResponse,
  NavBranchQuery,
  NavBranchResponse,
  NavTreeQuery,
  NavTreeRequest,
  NavTreeResponse,
  PasswordForm,
  QueryRequest,
  QueryResponse,
  RealRowCountResponse,
  RoutineEditorData,
  RoutineEditorOptions,
  RoutineExecuteForm,
  RoutineExecuteResponse,
  RoutinesListResponse,
  ServerScope,
  SetCollationResponse,
  ShowCreateResponse,
  SimulateRequest,
  SimulateResponse,
  SqlFormResponse,
  TableScope,
  TriggerEditorData,
  TriggersListResponse,
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
  // database level (docs/features/05-database-level.md)
  dbStructure: (server: number, db: string, q: Record<string, string | undefined>) =>
    call<DbStructureResponse>('GET', `${dbPath(server, db)}/structure${queryString(q)}`),
  dbRealRowCount: (server: number, db: string, table: string | null) =>
    call<RealRowCountResponse>(
      'GET',
      `${dbPath(server, db)}/structure/real-row-count${table === null ? '?all=1' : queryString({ table })}`,
    ),
  dbCopyForm: (server: number, db: string) =>
    call<CopyFormResponse>('GET', `${dbPath(server, db)}/structure/copy-form`),
  /** POST …/structure/{empty,drop,add-prefix,replace-prefix,copy-with-prefix,copy,central-*} */
  dbStructureAction: (server: number, db: string, action: string, body: unknown) =>
    call<DbActionResponse>('POST', `${dbPath(server, db)}/structure/${action}`, body),
  dbShowCreate: (server: number, db: string, tables: string[]) =>
    call<ShowCreateResponse>('POST', `${dbPath(server, db)}/structure/show-create`, { tables }),
  dbMaintenance: (server: number, db: string, op: string, tables: string[]) =>
    call<MaintenanceResponse>('POST', `${dbPath(server, db)}/structure/maintenance`, { op, tables }),
  dbOperations: (server: number, db: string) =>
    call<DbOperationsResponse>('GET', `${dbPath(server, db)}/operations`),
  /** POST …/operations/{comment,collation} */
  dbOperation: (server: number, db: string, action: 'comment' | 'collation', body: unknown) =>
    call<DbActionResponse>('POST', `${dbPath(server, db)}/operations/${action}`, body),
  dbRenameCopy: (server: number, db: string, action: 'rename' | 'copy', body: unknown) =>
    call<DbRenameCopyResponse>('POST', `${dbPath(server, db)}/operations/${action}`, body),
  dbSearchForm: (server: number, db: string) =>
    call<DbSearchFormResponse>('GET', `${dbPath(server, db)}/search`),
  dbSearch: (server: number, db: string, body: unknown) =>
    call<DbSearchResponse>('POST', `${dbPath(server, db)}/search`, body),
  dbRoutines: (server: number, db: string, q: { type?: string; pos?: number } = {}) =>
    call<RoutinesListResponse>('GET', `${dbPath(server, db)}/routines${queryString(q)}`),
  dbRoutineEditor: (server: number, db: string, item?: { name: string; type: string }) =>
    call<{ options: RoutineEditorOptions; routine: RoutineEditorData | null }>(
      'GET',
      `${dbPath(server, db)}/routines/editor${queryString(item ?? {})}`,
    ),
  dbRoutineSave: (server: number, db: string, body: unknown) =>
    call<DbActionResponse>('POST', `${dbPath(server, db)}/routines`, body),
  dbRoutineExecuteForm: (server: number, db: string, name: string, type: string) =>
    call<RoutineExecuteForm>('GET', `${dbPath(server, db)}/routines/execute${queryString({ name, type })}`),
  dbRoutineExecute: (server: number, db: string, body: unknown) =>
    call<RoutineExecuteResponse>('POST', `${dbPath(server, db)}/routines/execute`, body),
  dbRoutineExport: (server: number, db: string, name: string, type: string) =>
    call<DbExportResponse>('GET', `${dbPath(server, db)}/routines/export${queryString({ name, type })}`),
  dbEvents: (server: number, db: string) => call<EventsListResponse>('GET', `${dbPath(server, db)}/events`),
  dbEventEditor: (server: number, db: string, name: string) =>
    call<EventEditorData>('GET', `${dbPath(server, db)}/events/editor${queryString({ name })}`),
  dbEventSave: (server: number, db: string, body: unknown) =>
    call<DbActionResponse>('POST', `${dbPath(server, db)}/events`, body),
  dbEventExport: (server: number, db: string, name: string) =>
    call<DbExportResponse>('GET', `${dbPath(server, db)}/events/export${queryString({ name })}`),
  /** triggers of the database, or of one table when `table` is given */
  dbTriggers: (server: number, db: string, table = '') =>
    call<TriggersListResponse>(
      'GET',
      `${dbPath(server, db)}/triggers${queryString({ table: table || undefined })}`,
    ),
  dbTriggerEditor: (server: number, db: string, table: string, name: string) =>
    call<TriggerEditorData>(
      'GET',
      `${dbPath(server, db)}/triggers/editor${queryString({ table: table || undefined, name })}`,
    ),
  dbTriggerSave: (server: number, db: string, table: string, body: unknown) =>
    call<DbActionResponse>(
      'POST',
      `${dbPath(server, db)}/triggers${queryString({ table: table || undefined })}`,
      body,
    ),
  dbTriggerExport: (server: number, db: string, table: string, name: string) =>
    call<DbExportResponse>(
      'GET',
      `${dbPath(server, db)}/triggers/export${queryString({ table: table || undefined, name })}`,
    ),
  dbMultiTableForm: (server: number, db: string) =>
    call<MultiTableFormResponse>('GET', `${dbPath(server, db)}/multi-table-query`),
  dbMultiTableKeys: (server: number, db: string, tables: string[]) =>
    call<MultiTableKeysResponse>(
      'GET',
      `${dbPath(server, db)}/multi-table-query/tables?${tables.map((t) => `tables=${encodeURIComponent(t)}`).join('&')}`,
    ),
  dbDataDictionary: (server: number, db: string) =>
    call<DataDictionaryResponse>('GET', `${dbPath(server, db)}/data-dictionary`),
  dbPrivileges: (server: number, db: string) =>
    call<DbPrivilegesResponse>('GET', `${dbPath(server, db)}/privileges`),
  dbTracking: (server: number, db: string) =>
    call<DbTrackingResponse>('GET', `${dbPath(server, db)}/tracking`),
  dbTrackingAction: (server: number, db: string, body: DbTrackingRequest) =>
    call<DbActionResponse>('POST', `${dbPath(server, db)}/tracking`, body),
  dbCentralColumns: (server: number, db: string, q: { pos?: number; totalRows?: number } = {}) =>
    call<CentralColumnsResponse>(
      'GET',
      `${dbPath(server, db)}/central-columns?${new URLSearchParams({
        ...(q.pos !== undefined ? { pos: String(q.pos) } : {}),
        ...(q.totalRows !== undefined ? { total_rows: String(q.totalRows) } : {}),
      })}`,
    ),
  dbCentralColumnsAction: (server: number, db: string, body: CentralColumnsRequest) =>
    call<CentralColumnsActionResponse>('POST', `${dbPath(server, db)}/central-columns`, body),
  dbCentralColumnsEdit: (server: number, db: string, columns: string[]) =>
    call<CentralColumn[]>(
      'GET',
      `${dbPath(server, db)}/central-columns/edit?${columns.map((c) => `columns=${encodeURIComponent(c)}`).join('&')}`,
    ),
  dbCentralColumnsPopulate: (server: number, db: string, table: string) =>
    call<string[]>(
      'GET',
      `${dbPath(server, db)}/central-columns/populate?table=${encodeURIComponent(table)}`,
    ),
  favorite: (
    server: number,
    body: { db: string; table: string; action: 'add' | 'remove'; favoriteTables: string },
  ) =>
    call<{ changes: boolean; favoriteTables?: string; message?: { text: string } }>(
      'POST',
      `/servers/${server}/favorites`,
      body,
    ),
}

const dbPath = (server: number, db: string) => `/servers/${server}/databases/${encodeURIComponent(db)}`

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

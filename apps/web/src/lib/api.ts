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
  BrowseForeignersRequest,
  BrowseForeignersResponse,
  BrowseRequest,
  CancelResponse,
  CentralColumn,
  CentralColumnsActionResponse,
  CentralColumnsRequest,
  CentralColumnsResponse,
  ChangeColumnsRequest,
  ChangeFormResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  CollationsResponse,
  ColumnFormOptions,
  ColumnTransformations,
  ColumnValuesResponse,
  ConsoleBookmarkAddRequest,
  ConsoleBookmarkAddResponse,
  ConsoleBookmarksResponse,
  ConsoleConfigResponse,
  CopyFormResponse,
  CreateDatabaseResponse,
  CreateTableFormResponse,
  CreateTableRequest,
  CreateTables2NFRequest,
  CreateTables3NFRequest,
  CreateTrackingVersionRequest,
  DataDictionaryResponse,
  DatabaseScope,
  DatabasesQuery,
  DatabasesResponse,
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
  DdlResponse,
  DefaultFkCheckResponse,
  DeleteTrackingVersionsRequest,
  DropColumnsRequest,
  DropDatabasesResponse,
  EngineResponse,
  EnginesResponse,
  ErrorEnvelope,
  ErrorReportRequest,
  ErrorReportResponse,
  EventEditorData,
  EventsListResponse,
  ExportPageResponse,
  ExportResponse,
  ExportTemplateResult,
  FindReplacePreviewResponse,
  FindReplaceRequest,
  FindReplaceResponse,
  FormatResponse,
  GetVariableResponse,
  GridSaveRequest,
  GridSaveResponse,
  HistoryResponse,
  HomeResponse,
  I18nState,
  ImportPageResponse,
  ImportProgress,
  ImportResult,
  ImportUploadCreated,
  IndexFormResponse,
  InsertFormResponse,
  KillProcessResponse,
  LintRequest,
  LintResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MaintenanceRequest,
  MoveColumnsRequest,
  MoveCopyRequest,
  MoveRepeatingGroupRequest,
  MultiTableFormResponse,
  MultiTableKeysResponse,
  NavBranchQuery,
  NavBranchResponse,
  NavTreeQuery,
  NavTreeRequest,
  NavTreeResponse,
  NewTables2NFResponse,
  NewTables3NFResponse,
  Normalization3NFStepResponse,
  NormalizationResult,
  NormalizationTableResponse,
  OperationsPageResponse,
  OperationsResponse,
  OrderByRequest,
  PartialDependenciesResponse,
  PartitionFormResponse,
  PartitionMaintenanceRequest,
  PartitionOpsRequest,
  PartitioningRequest,
  PasswordForm,
  PluginsResponse,
  ProcessList,
  ProcessesQuery,
  QueryRequest,
  QueryResponse,
  QueryStatistics,
  RangeResponse,
  RealRowCountResponse,
  RelationDropdownResponse,
  RelationPageResponse,
  RelationSaveRequest,
  RelationSaveResponse,
  RenameIndexRequest,
  RenameViewRequest,
  ReservedWordCheckResponse,
  RoutineEditorData,
  RoutineEditorOptions,
  RoutineExecuteForm,
  RoutineExecuteResponse,
  RoutinesListResponse,
  SaveIndexRequest,
  SaveRowsRequest,
  SaveRowsResponse,
  SearchPageResponse,
  SearchRequest,
  SearchResponse,
  ServerScope,
  ServerVariablesResponse,
  SetCollationResponse,
  SetVariableResponse,
  ShowCreateResponse,
  SimulateRequest,
  SimulateResponse,
  SqlActionRequest,
  SqlFormResponse,
  SqlMessage,
  StatementResult,
  StatusOverview,
  StatusVariables,
  StatusVariablesRequest,
  StructureResponse,
  TableOptionsRequest,
  TableScope,
  ToggleTrackingRequest,
  TrackingPageResponse,
  TrackingReportRequest,
  TrackingReportResponse,
  TrackingResponse,
  TrackingSnapshotResponse,
  TriggerEditorData,
  TriggersListResponse,
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
/** API path of a table below `/api` (also the base of the transformation wrapper links). */
export const tablePath = (r: TableRef) => `${dbPath(r)}/tables/${encodeURIComponent(r.table)}`

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
  tableScope: (r: TableRef) => call<TableScope>('GET', `${tablePath(r)}/capabilities`),
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
  // normalization wizard (pma: /normalization/**)
  normalization: (s: TableRef) => call<NormalizationTableResponse>('GET', `${tablePath(s)}/normalization`),
  normalization3NFStep: (s: TableRef, tables: string[]) =>
    call<Normalization3NFStepResponse>('POST', `${tablePath(s)}/normalization/3nf/step1`, { tables }),
  normalizationPartialDependencies: (s: TableRef) =>
    call<PartialDependenciesResponse>('POST', `${tablePath(s)}/normalization/partial-dependencies`, {}),
  normalizationMoveRepeatingGroup: (s: TableRef, req: MoveRepeatingGroupRequest) =>
    call<NormalizationResult>('POST', `${tablePath(s)}/normalization/move-repeating-group`, req),
  normalizationNewTables2NF: (s: TableRef, pd: Array<[string, string[]]>) =>
    call<NewTables2NFResponse>('POST', `${tablePath(s)}/normalization/2nf/new-tables`, { pd }),
  normalizationCreateTables2NF: (s: TableRef, req: CreateTables2NFRequest) =>
    call<NormalizationResult>('POST', `${tablePath(s)}/normalization/2nf/create-new-tables`, req),
  normalizationNewTables3NF: (s: TableRef, pd: Record<string, string[]>, tables: Array<[string, string[]]>) =>
    call<NewTables3NFResponse>('POST', `${tablePath(s)}/normalization/3nf/new-tables`, { pd, tables }),
  normalizationCreateTables3NF: (s: TableRef, req: CreateTables3NFRequest) =>
    call<NormalizationResult>('POST', `${tablePath(s)}/normalization/3nf/create-new-tables`, req),
  // export (docs/features/07-export-import.md)
  exportPage: (server: number, pairs: Array<[string, string]>) =>
    call<ExportPageResponse>('GET', `/servers/${server}/export/page?${new URLSearchParams(pairs)}`),
  /** databases (no db), tables (db) or columns (db + table) for the aliases dialog */
  exportAliasNames: (server: number, db: string, table: string) =>
    call<{ names: string[] }>('GET', `/servers/${server}/export/alias-names?${qs({ db, table })}`),
  exportRun: (server: number, params: Array<[string, string]>) =>
    call<ExportResponse>('POST', `/servers/${server}/export`, { params }),
  /** The one-shot download URL of a prepared dump (navigated to, so the browser saves it). */
  exportDownloadUrl: (server: number, id: string) => `/api/servers/${server}/export/${id}`,
  /** "View output as text": the dump body. */
  exportText: async (server: number, id: string): Promise<string> => {
    const res = await fetch(`/api/servers/${server}/export/${id}`, { credentials: 'same-origin' })
    if (!res.ok) {
      const env = ((await res.json().catch(() => null)) as ErrorEnvelope | null)?.error
      throw new ApiError(res.status, env ?? { code: 'INTERNAL', message: res.statusText })
    }
    return res.text()
  },
  exportTemplateCreate: (
    server: number,
    req: { exportType: string; templateName: string; templateData: string },
  ) => call<ExportTemplateResult>('POST', `/servers/${server}/export/templates`, req),
  exportTemplateLoad: (server: number, id: number) =>
    call<ExportTemplateResult>('GET', `/servers/${server}/export/templates/${id}`),
  exportTemplateUpdate: (server: number, id: number, templateData: string) =>
    call<ExportTemplateResult>('POST', `/servers/${server}/export/templates/${id}`, { templateData }),
  exportTemplateDelete: (server: number, id: number) =>
    call<ExportTemplateResult>('POST', `/servers/${server}/export/templates/${id}/delete`),
  // import (docs/features/07-export-import.md; pma: /server/import, /import, /import-status)
  importPage: (server: number, pairs: Array<[string, string]>) =>
    call<ImportPageResponse>('GET', `/servers/${server}/import/page?${new URLSearchParams(pairs)}`),
  /**
   * Uploads `file` in chunks (resumable offsets), reporting the bytes sent; resolves to the upload id.
   */
  importUpload: async (
    server: number,
    file: Blob,
    onProgress: (sent: number) => void,
    chunkSize = 4 * 1024 * 1024,
  ): Promise<string> => {
    const { id } = await call<ImportUploadCreated>('POST', `/servers/${server}/import/uploads`, {})
    for (let offset = 0; offset < file.size || offset === 0; offset += chunkSize) {
      const res = await fetch(`/api/servers/${server}/import/uploads/${id}?offset=${offset}`, {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: readCookie(CSRF_COOKIE), 'content-type': 'application/octet-stream' },
        credentials: 'same-origin',
        body: file.slice(offset, offset + chunkSize),
      })
      if (!res.ok) {
        const env = ((await res.json().catch(() => null)) as ErrorEnvelope | null)?.error
        throw new ApiError(res.status, env ?? { code: 'INTERNAL', message: res.statusText })
      }
      onProgress(Math.min(file.size, offset + chunkSize))
      if (file.size === 0) break
    }
    return id
  },
  importJob: (server: number, params: Array<[string, string]>, upload?: { id: string; name: string }) =>
    call<{ id: string }>('POST', `/servers/${server}/import/jobs`, { params, ...(upload ? { upload } : {}) }),
  /** Runs the job: `progress` events, then the result (server-sent events). */
  importEvents: (
    server: number,
    id: string,
    onProgress: (p: ImportProgress) => void,
  ): Promise<ImportResult> =>
    new Promise((resolve, reject) => {
      const es = new EventSource(`/api/servers/${server}/import/jobs/${id}/events`)
      es.addEventListener('progress', (e) => onProgress(JSON.parse((e as MessageEvent<string>).data)))
      es.addEventListener('result', (e) => {
        es.close()
        resolve(JSON.parse((e as MessageEvent<string>).data) as ImportResult)
      })
      es.addEventListener('failure', (e) => {
        es.close()
        reject(new Error((JSON.parse((e as MessageEvent<string>).data) as { message: string }).message))
      })
      es.onerror = () => {
        es.close()
        reject(new Error('Could not load the progress of the import.'))
      }
    }),
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
  tableStructure: (r: TableRef) => call<StructureResponse>('GET', `${tablePath(r)}/structure`),
  changeColumnsForm: (r: TableRef, fields: string[]) =>
    call<ChangeFormResponse>(
      'GET',
      `${tablePath(r)}/columns/form?${fields.map((f) => `fields=${encodeURIComponent(f)}`).join('&')}`,
    ),
  addColumnsForm: (r: TableRef) =>
    call<{ options: ColumnFormOptions }>('GET', `${tablePath(r)}/columns/add-form`),
  createTableForm: (r: DbRef) => call<CreateTableFormResponse>('GET', `${dbPath(r)}/create-table/form`),
  indexForm: (r: TableRef, q: { index?: string; create?: number; primary?: boolean }) =>
    call<IndexFormResponse>(
      'GET',
      `${tablePath(r)}/indexes/form${queryString({ ...q, primary: q.primary === true ? '1' : undefined })}`,
    ),
  partitionForm: (r: TableRef) => call<PartitionFormResponse>('GET', `${tablePath(r)}/partitions/form`),
  createTable: (r: DbRef, req: CreateTableRequest) =>
    call<DdlResponse & { db: string; table: string }>('POST', `${dbPath(r)}/tables`, req),
  addColumns: (r: TableRef, req: AddColumnsRequest) =>
    call<DdlResponse>('POST', `${tablePath(r)}/columns/add`, req),
  changeColumns: (r: TableRef, req: ChangeColumnsRequest) =>
    call<DdlResponse>('POST', `${tablePath(r)}/columns/change`, req),
  dropColumns: (r: TableRef, req: DropColumnsRequest) =>
    call<DdlResponse>('POST', `${tablePath(r)}/columns/drop`, req),
  addKey: (r: TableRef, req: AddKeyRequest) => call<DdlResponse>('POST', `${tablePath(r)}/columns/key`, req),
  moveColumns: (r: TableRef, req: MoveColumnsRequest) =>
    call<DdlResponse>('POST', `${tablePath(r)}/columns/move`, req),
  reservedWordCheck: (r: TableRef, names: string[], table?: string) =>
    call<ReservedWordCheckResponse>('POST', `${tablePath(r)}/columns/reserved-word-check`, {
      names,
      ...(table !== undefined ? { table } : {}),
    }),
  saveIndex: (r: TableRef, req: SaveIndexRequest) =>
    call<DdlResponse>('POST', `${tablePath(r)}/indexes`, req),
  renameIndex: (r: TableRef, req: RenameIndexRequest) =>
    call<DdlResponse>('POST', `${tablePath(r)}/indexes/rename`, req),
  dropIndex: (r: TableRef, name: string) =>
    call<DdlResponse>('POST', `${tablePath(r)}/indexes/drop`, { name }),
  savePartitioning: (r: TableRef, req: PartitioningRequest) =>
    call<DdlResponse>('POST', `${tablePath(r)}/partitions/partitioning`, req),
  partitionMaintenance: (r: TableRef, req: PartitionMaintenanceRequest) =>
    call<DdlResponse>('POST', `${tablePath(r)}/partitions/maintenance`, req),
  removePartitioning: (r: TableRef) =>
    call<DdlResponse>('POST', `${tablePath(r)}/partitions/remove-partitioning`, {}),
  // database level (docs/features/05-database-level.md)
  dbStructure: (r: DbRef, q: Record<string, string | undefined>) =>
    call<DbStructureResponse>('GET', `${dbPath(r)}/structure${queryString(q)}`),
  dbRealRowCount: (r: DbRef, table: string | null) =>
    call<RealRowCountResponse>(
      'GET',
      `${dbPath(r)}/structure/real-row-count${table === null ? '?all=1' : queryString({ table })}`,
    ),
  dbCopyForm: (r: DbRef) => call<CopyFormResponse>('GET', `${dbPath(r)}/structure/copy-form`),
  /** POST …/structure/{empty,drop,add-prefix,replace-prefix,copy-with-prefix,copy,central-*} */
  dbStructureAction: (r: DbRef, action: string, body: unknown) =>
    call<DbActionResponse>('POST', `${dbPath(r)}/structure/${action}`, body),
  dbShowCreate: (r: DbRef, tables: string[]) =>
    call<ShowCreateResponse>('POST', `${dbPath(r)}/structure/show-create`, { tables }),
  dbMaintenance: (r: DbRef, op: string, tables: string[]) =>
    call<OperationsResponse>('POST', `${dbPath(r)}/structure/maintenance`, { op, tables }),
  dbOperations: (r: DbRef) => call<DbOperationsResponse>('GET', `${dbPath(r)}/operations`),
  /** POST …/operations/{comment,collation} */
  dbOperation: (r: DbRef, action: 'comment' | 'collation', body: unknown) =>
    call<DbActionResponse>('POST', `${dbPath(r)}/operations/${action}`, body),
  dbRenameCopy: (r: DbRef, action: 'rename' | 'copy', body: unknown) =>
    call<DbRenameCopyResponse>('POST', `${dbPath(r)}/operations/${action}`, body),
  dbSearchForm: (r: DbRef) => call<DbSearchFormResponse>('GET', `${dbPath(r)}/search`),
  dbSearch: (r: DbRef, body: unknown) => call<DbSearchResponse>('POST', `${dbPath(r)}/search`, body),
  dbRoutines: (r: DbRef, q: { type?: string; pos?: number } = {}) =>
    call<RoutinesListResponse>('GET', `${dbPath(r)}/routines${queryString(q)}`),
  dbRoutineEditor: (r: DbRef, item?: { name: string; type: string }) =>
    call<{ options: RoutineEditorOptions; routine: RoutineEditorData | null }>(
      'GET',
      `${dbPath(r)}/routines/editor${queryString(item ?? {})}`,
    ),
  dbRoutineSave: (r: DbRef, body: unknown) => call<DbActionResponse>('POST', `${dbPath(r)}/routines`, body),
  dbRoutineExecuteForm: (r: DbRef, name: string, type: string) =>
    call<RoutineExecuteForm>('GET', `${dbPath(r)}/routines/execute${queryString({ name, type })}`),
  dbRoutineExecute: (r: DbRef, body: unknown) =>
    call<RoutineExecuteResponse>('POST', `${dbPath(r)}/routines/execute`, body),
  dbRoutineExport: (r: DbRef, name: string, type: string) =>
    call<DbExportResponse>('GET', `${dbPath(r)}/routines/export${queryString({ name, type })}`),
  dbEvents: (r: DbRef) => call<EventsListResponse>('GET', `${dbPath(r)}/events`),
  dbEventEditor: (r: DbRef, name: string) =>
    call<EventEditorData>('GET', `${dbPath(r)}/events/editor${queryString({ name })}`),
  dbEventSave: (r: DbRef, body: unknown) => call<DbActionResponse>('POST', `${dbPath(r)}/events`, body),
  dbEventExport: (r: DbRef, name: string) =>
    call<DbExportResponse>('GET', `${dbPath(r)}/events/export${queryString({ name })}`),
  /** triggers of the database, or of one table when `table` is given */
  dbTriggers: (r: DbRef, table = '') =>
    call<TriggersListResponse>('GET', `${dbPath(r)}/triggers${queryString({ table: table || undefined })}`),
  dbTriggerEditor: (r: DbRef, table: string, name: string) =>
    call<TriggerEditorData>(
      'GET',
      `${dbPath(r)}/triggers/editor${queryString({ table: table || undefined, name })}`,
    ),
  dbTriggerSave: (r: DbRef, table: string, body: unknown) =>
    call<DbActionResponse>(
      'POST',
      `${dbPath(r)}/triggers${queryString({ table: table || undefined })}`,
      body,
    ),
  dbTriggerExport: (r: DbRef, table: string, name: string) =>
    call<DbExportResponse>(
      'GET',
      `${dbPath(r)}/triggers/export${queryString({ table: table || undefined, name })}`,
    ),
  dbMultiTableForm: (r: DbRef) => call<MultiTableFormResponse>('GET', `${dbPath(r)}/multi-table-query`),
  dbMultiTableKeys: (r: DbRef, tables: string[]) =>
    call<MultiTableKeysResponse>(
      'GET',
      `${dbPath(r)}/multi-table-query/tables?${tables.map((t) => `tables=${encodeURIComponent(t)}`).join('&')}`,
    ),
  dbDataDictionary: (r: DbRef) => call<DataDictionaryResponse>('GET', `${dbPath(r)}/data-dictionary`),
  dbPrivileges: (r: DbRef) => call<DbPrivilegesResponse>('GET', `${dbPath(r)}/privileges`),
  dbTracking: (r: DbRef) => call<DbTrackingResponse>('GET', `${dbPath(r)}/tracking`),
  dbTrackingAction: (r: DbRef, body: DbTrackingRequest) =>
    call<DbActionResponse>('POST', `${dbPath(r)}/tracking`, body),
  dbCentralColumns: (r: DbRef, q: { pos?: number; totalRows?: number } = {}) =>
    call<CentralColumnsResponse>(
      'GET',
      `${dbPath(r)}/central-columns?${new URLSearchParams({
        ...(q.pos !== undefined ? { pos: String(q.pos) } : {}),
        ...(q.totalRows !== undefined ? { total_rows: String(q.totalRows) } : {}),
      })}`,
    ),
  dbCentralColumnsAction: (r: DbRef, body: CentralColumnsRequest) =>
    call<CentralColumnsActionResponse>('POST', `${dbPath(r)}/central-columns`, body),
  dbCentralColumnsEdit: (r: DbRef, columns: string[]) =>
    call<CentralColumn[]>(
      'GET',
      `${dbPath(r)}/central-columns/edit?${columns.map((c) => `columns=${encodeURIComponent(c)}`).join('&')}`,
    ),
  dbCentralColumnsPopulate: (r: DbRef, table: string) =>
    call<string[]>('GET', `${dbPath(r)}/central-columns/populate?table=${encodeURIComponent(table)}`),
  favorite: (
    server: number,
    body: { db: string; table: string; action: 'add' | 'remove'; favoriteTables: string },
  ) =>
    call<{ changes: boolean; favoriteTables?: string; message?: { text: string } }>(
      'POST',
      `/servers/${server}/favorites`,
      body,
    ),
  // Insert/Edit and transformations (docs/features/03-insert-edit-transformations.md)
  insertForm: (r: TableRef, req: InsertFormRequest) =>
    call<InsertFormResponse>('POST', `${tablePath(r)}/insert-form`, req),
  saveRows: (r: TableRef, req: SaveRowsRequest) =>
    call<SaveRowsResponse>('POST', `${tablePath(r)}/rows`, req),
  browseForeigners: (r: TableRef, req: Partial<BrowseForeignersRequest> & { field: string }) =>
    call<BrowseForeignersResponse>('POST', `${tablePath(r)}/browse-foreigners`, req),
  columnTransformations: (r: TableRef) =>
    call<ColumnTransformations>('GET', `${tablePath(r)}/transformations`),
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
  ) => call<{ success: boolean; message: { text: string } | null }>('POST', `${tablePath(r)}/uiprefs`, req),
  /** /table/get-field download URL */
  gridFieldUrl: (server: number, p: { db: string; table: string; where: string; sig: string; key: string }) =>
    `/api/servers/${server}/browse/field?${new URLSearchParams(p)}`,
}

interface TableOpBodies {
  'order-by': OrderByRequest
  'move-copy': MoveCopyRequest
  options: TableOptionsRequest
  maintenance: MaintenanceRequest
  sql: SqlActionRequest
  partitions: PartitionOpsRequest
  'rename-view': RenameViewRequest
}

/** Body of POST …/insert-form: signed where clauses (none = insert) and the form toggles. */
export interface InsertFormRequest {
  where?: Array<{ clause: string; sig: string }>
  copy?: boolean
  insertRows?: number
  afterInsert?: string
  clauseIsUnique?: boolean
  unsaved?: Array<Record<string, string | null>> | undefined
  showFunctionFields?: boolean
  showFieldTypes?: boolean
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

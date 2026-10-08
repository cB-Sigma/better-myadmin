import type {
  AutocompleteResponse,
  BookmarkCreateRequest,
  BookmarkCreateResponse,
  BookmarkDeleteResponse,
  BookmarkListResponse,
  BookmarkRunRequest,
  BookmarkShowResponse,
  CancelResponse,
  ConsoleBookmarkAddRequest,
  ConsoleBookmarkAddResponse,
  ConsoleBookmarksResponse,
  ConsoleConfigResponse,
  DefaultFkCheckResponse,
  FormatResponse,
  HistoryResponse,
  LintRequest,
  LintResponse,
  SimulateRequest,
  SimulateResponse,
  SqlFormResponse,
} from '@bettermyadmin/contracts'
import {
  type AuthState,
  CSRF_COOKIE,
  CSRF_HEADER,
  type ErrorEnvelope,
  type I18nState,
  type LoginRequest,
  type LoginResponse,
  type LogoutResponse,
  type NavBranchQuery,
  type NavBranchResponse,
  type NavTreeQuery,
  type NavTreeRequest,
  type NavTreeResponse,
  type QueryRequest,
  type QueryResponse,
} from '@bettermyadmin/contracts'

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
async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
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
}

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

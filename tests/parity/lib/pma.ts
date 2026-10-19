/** An AJAX answer of phpMyAdmin (ResponseRenderer::ajaxResponse). */
export interface PmaJson {
  success: boolean
  message?: string
  error?: string
  sql_data?: string
  sql_query?: string
  [key: string]: unknown
}

/** postPage options: a multipart file upload, a byte-exact body, the response status/headers. */
export interface PostOptions {
  file?: { field: string; name: string; data: Buffer } | null
  binary?: boolean
  onHeaders?: (status: number, headers: Headers) => void
  /** extra request headers (e.g. `authorization` for http auth) */
  headers?: Record<string, string>
  /** answer a redirect instead of following it (signon, logout) */
  noRedirect?: boolean
}

/** A form body: an object, or ordered pairs when a key repeats (`selected_fld[]`, …). */
export type PmaForm = Record<string, string> | Array<[string, string]>

/**
 * Scripted client for the reference phpMyAdmin (cookie auth + the same requests its pages and
 * forms send). The parity harness drives phpMyAdmin through it and BetterMyAdmin through its API,
 * then diffs what each one sent to MySQL. Its whole request API (docs/architecture/16-golden-path.md#parity-client):
 *
 * | method                 | request                                                             |
 * |------------------------|---------------------------------------------------------------------|
 * | `login`                | the cookie login form; keeps the session token                      |
 * | `getPage(t, params)`   | full-page GET → HTML                                                |
 * | `getJson(t, params)`   | AJAX GET (+ `server`, `ajax_request`, XHR header) → PmaJson         |
 * | `postPage(t, form)`    | form POST (+ `server`, `token`) → HTML                              |
 * | `postJson(t, form)`    | AJAX POST (+ `server`, `token`, `ajax_request`, XHR header) → PmaJson |
 *
 * `t` is a route (`/table/structure`, becomes `index.php?route=…`) or a ready path starting with
 * `/index.php`. Fields already present in `params`/`form` are not overridden. Redirects are followed.
 * Recurring forms are built by plain functions next to the client (`sqlBoxForm`).
 */
export class PmaClient {
  readonly base: string
  readonly #cookies = new Map<string, string>()
  token = ''

  constructor(base: string) {
    this.base = base.replace(/\/$/, '')
  }

  /** `lang` picks the language like the login page's selector (?lang=xx, then the pma_lang cookie). */
  async login(user: string, password: string, server = 1, lang?: string): Promise<void> {
    const page = await this.#send(`/index.php?route=/${lang !== undefined ? `&lang=${lang}` : ''}`)
    const token = page.match(/name="token" value="([^"]+)"/)?.[1] ?? ''
    const setSession = page.match(/name="set_session" value="([^"]+)"/)?.[1] ?? ''
    const home = await this.#send('/index.php?route=/', [
      ['token', token],
      ['set_session', setSession],
      ['pma_username', user],
      ['pma_password', password],
      ['server', String(server)],
    ])
    const t = home.match(/"token":"([^"]+)"/)?.[1] ?? home.match(/name="token" value="([^"]+)"/)?.[1]
    if (t === undefined || /id="login_form"/.test(home)) throw new Error('phpMyAdmin login failed')
    this.token = t
  }

  /** A full page (no JavaScript runs, so e.g. the menu is not collapsed). */
  getPage(target: string, params: Record<string, string> = {}, opts: PostOptions = {}): Promise<string> {
    return this.#send(url(target, Object.entries(params)), undefined, false, opts)
  }

  /** An AJAX GET, JSON-decoded. */
  async getJson(target: string, params: Record<string, string> = {}): Promise<PmaJson> {
    const q = withDefaults(Object.entries(params), [
      ['server', '1'],
      ['ajax_request', 'true'],
    ])
    return json(target, await this.#send(url(target, q), undefined, true))
  }

  /**
   * A form POST the way the page's own forms send it (not AJAX). `file` sends it as
   * multipart/form-data with that file (the import form); `binary` answers the body byte for byte
   * (latin1-decoded: downloads such as /export) and reports status and headers to `onHeaders`.
   */
  postPage(target: string, form: PmaForm = {}, opts: PostOptions = {}): Promise<string> {
    const body = withDefaults(pairs(form), [
      ['server', '1'],
      ['token', this.token],
    ])
    return this.#send(url(target), body, false, opts)
  }

  /** A POST the way phpMyAdmin's AJAX handlers send it, JSON-decoded. */
  async postJson(target: string, form: PmaForm = {}): Promise<PmaJson> {
    const body = withDefaults(pairs(form), [
      ['server', '1'],
      ['token', this.token],
      ['ajax_request', 'true'],
    ])
    return json(target, await this.#send(url(target), body, true))
  }

  async #send(
    path: string,
    body?: Array<[string, string]>,
    ajax = false,
    opts: PostOptions = {},
  ): Promise<string> {
    const headers: Record<string, string> = { ...opts.headers }
    if (this.#cookies.size > 0) headers.cookie = [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    let payload: string | FormData | undefined
    if (body !== undefined && opts.file !== undefined) {
      const fd = new FormData()
      for (const [k, v] of body) fd.append(k, v)
      if (opts.file !== null)
        fd.append(opts.file.field, new Blob([new Uint8Array(opts.file.data)]), opts.file.name)
      payload = fd
    } else if (body !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded'
      payload = new URLSearchParams(body).toString()
    }
    if (ajax) headers['x-requested-with'] = 'XMLHttpRequest'
    const res = await fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      redirect: 'manual',
      ...(payload !== undefined ? { body: payload } : {}),
    })
    opts.onHeaders?.(res.status, res.headers)
    for (const c of res.headers.getSetCookie()) {
      const [kv = ''] = c.split(';')
      const i = kv.indexOf('=')
      const v = kv.slice(i + 1)
      if (v === 'deleted' || v === '') this.#cookies.delete(kv.slice(0, i))
      else this.#cookies.set(kv.slice(0, i), v)
    }
    if (opts.binary === true) return Buffer.from(await res.arrayBuffer()).toString('latin1')
    if (res.status >= 300 && res.status < 400 && opts.noRedirect !== true) {
      const loc = res.headers.get('location') ?? '/'
      return this.#send(
        loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : `/${loc.replace(/^\.\//, '')}`,
      )
    }
    return res.text()
  }
}

/** `/index.php?route=<route>` (or the given `/index.php…` path) with `params` appended. */
function url(target: string, params: Array<[string, string]> = []): string {
  const base =
    target.startsWith('/index.php') || target.startsWith('/setup/') ? target : `/index.php?route=${target}`
  if (params.length === 0) return base
  return `${base}${base.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`
}

const pairs = (form: PmaForm): Array<[string, string]> =>
  Array.isArray(form) ? [...form] : Object.entries(form)

/** Appends each default whose key the request does not carry yet. */
function withDefaults(
  list: Array<[string, string]>,
  defaults: Array<[string, string]>,
): Array<[string, string]> {
  const out = [...list]
  for (const [k, v] of defaults) if (!out.some(([key]) => key === k)) out.push([k, v])
  return out
}

function json(target: string, body: string): PmaJson {
  try {
    return JSON.parse(body) as PmaJson
  } catch {
    // The reference can wrap its JSON body in a PHP notice on some hosts (e.g. the status monitor's
    // CPU/memory sampling via SysInfo), which Node never emits. Extract the JSON value and retry;
    // if there is none, surface the raw body so a genuine non-JSON answer is still visible.
    const start = body.search(/[[{]/)
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1)) as PmaJson
      } catch {
        /* fall through to the raw-body error */
      }
    }
    throw new Error(`phpMyAdmin did not answer JSON for ${target}: ${body.slice(0, 500)}`)
  }
}

/** Whether a phpMyAdmin instance answers (`anyStatus`: any HTTP answer; `contains`: body text). */
export async function isPmaUp(
  base: string,
  o: { path?: string; contains?: string; anyStatus?: boolean } = {},
) {
  return fetch(`${base}${o.path ?? '/index.php'}`)
    .then(async (r) =>
      o.anyStatus === true
        ? r.status > 0
        : r.ok && (o.contains === undefined || (await r.text()).includes(o.contains)),
    )
    .catch(() => false)
}

/**
 * The SQL tab form (resources/templates/sql/query.twig) for `postJson('/import', …)`; `extra` adds
 * or overrides fields, `null` removes a default one.
 */
export function sqlBoxForm(
  sql: string,
  db = '',
  table = '',
  extra: Record<string, string | null> = {},
): Record<string, string> {
  const form: Record<string, string> = {
    route: '/import',
    db,
    table,
    is_js_confirmed: '0',
    pos: '0',
    goto: db === '' ? '/server/sql' : table === '' ? '/database/sql' : '/table/sql',
    message_to_show: 'Your SQL query has been executed successfully.',
    prev_sql_query: '',
    sql_query: sql,
    sql_delimiter: ';',
    fk_checks: '1',
    SQL: 'Go',
    ajax_page_request: 'true',
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) delete form[k]
    else form[k] = v
  }
  return form
}

/** Tab labels of `ul#topmenu` (templates/menu/main.twig), in order, without "(current)". */
export function menuTabs(html: string): string[] {
  const m = html.match(/<ul id="topmenu"[^>]*>([\s\S]*?)<\/ul>/)
  if (m === null) return []
  return [...m[1]!.matchAll(/<li class="nav-item[^"]*">([\s\S]*?)<\/li>/g)].map((li) =>
    visibleText(li[1]!).replace(/\s*\(current\)$/, ''),
  )
}

/** The breadcrumb items and the comment of `nav#server-breadcrumb`. */
export function breadcrumb(html: string): { items: string[]; comment: string } {
  const m = html.match(/<nav id="server-breadcrumb"[\s\S]*?<\/nav>/)
  if (m === null) return { items: [], comment: '' }
  const items = [...m[0].matchAll(/<li class="breadcrumb-item">([\s\S]*?)<\/li>/g)].map((x) =>
    visibleText(x[1]!),
  )
  const c = m[0].match(/<span class="breadcrumb-comment"[^>]*>([\s\S]*?)<\/span>/)
  return { items, comment: c === null ? '' : visibleText(c[1]!).replace(/^“|”$/g, '') }
}

/** The `list-group-item` texts of the home-page card with this header. */
export function homeCard(html: string, header: string): string[] {
  const start = html.search(new RegExp(`card-header">\\s*${header}\\s*</div>`))
  if (start === -1) return []
  const end = html.indexOf('</ul>', start)
  return [
    ...html.slice(start, end).matchAll(/<li[^>]*class="list-group-item[^"]*"[^>]*>([\s\S]*?)<\/li>/g),
  ].map((x) => visibleText(x[1]!))
}

/** The warning/notice alerts of the home page (HomeController::$errors), as visible text. */
export function homeWarnings(html: string): string[] {
  return [
    ...html.matchAll(/<div class="alert (?:alert-warning|alert-info)" role="alert">([\s\S]*?)<\/div>/g),
  ].map((x) => visibleText(x[1]!))
}

/** Visible text of an HTML fragment, whitespace-collapsed. */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

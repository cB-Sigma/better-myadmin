/** An AJAX answer of phpMyAdmin (ResponseRenderer::ajaxResponse). */
export interface PmaJson {
  success: boolean
  message?: string
  error?: string
  sql_data?: string
  sql_query?: string
  [key: string]: unknown
}

/**
 * Scripted client for the reference phpMyAdmin (cookie auth + the same POSTs its forms send).
 * The parity harness drives phpMyAdmin through these requests and BetterMyAdmin through its API,
 * then diffs what each one sent to MySQL.
 */
export class PmaClient {
  readonly base: string
  readonly #cookies = new Map<string, string>()
  token = ''

  constructor(base: string) {
    this.base = base.replace(/\/$/, '')
  }

  /** GET a page as HTML, redirects followed (no JavaScript runs, so the menu is not collapsed). */
  get(path: string): Promise<string> {
    return this.#req(path)
  }

  /** POST a form the way the page's own forms do (token + server added), optionally over AJAX. */
  postPath(path: string, form: Record<string, string>, ajax = false): Promise<string> {
    return this.#req(path, { token: this.token, server: '1', ...form }, ajax)
  }

  async #req(path: string, form?: Record<string, string>, ajax = false): Promise<string> {
    const headers: Record<string, string> = {}
    if (this.#cookies.size > 0) headers.cookie = [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    if (form !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded'
    if (ajax) headers['x-requested-with'] = 'XMLHttpRequest'
    const res = await fetch(this.base + path, {
      method: form === undefined ? 'GET' : 'POST',
      headers,
      redirect: 'manual',
      ...(form !== undefined ? { body: new URLSearchParams(form).toString() } : {}),
    })
    for (const c of res.headers.getSetCookie()) {
      const [kv = ''] = c.split(';')
      const i = kv.indexOf('=')
      const v = kv.slice(i + 1)
      if (v === 'deleted' || v === '') this.#cookies.delete(kv.slice(0, i))
      else this.#cookies.set(kv.slice(0, i), v)
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') ?? '/'
      return this.#req(
        loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : `/${loc.replace(/^\.\//, '')}`,
      )
    }
    return res.text()
  }

  /** Raw request: GET without a form, POST (urlencoded, optionally as XHR) with one. Follows redirects. */
  request(path: string, form?: Record<string, string>, ajax = false): Promise<string> {
    return this.#req(path, form, ajax)
  }

  /** POST a form with the session token and server, as phpMyAdmin's AJAX forms do; parses the JSON reply. */
  async ajax(path: string, form: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const body = await this.#req(
      path,
      { server: '1', token: this.token, ajax_request: 'true', ...form },
      true,
    )
    try {
      return JSON.parse(body) as Record<string, unknown>
    } catch {
      throw new Error(`phpMyAdmin did not answer JSON for ${path}: ${body.slice(0, 300)}`)
    }
  }

  /** `lang` picks the language like the login page's selector (?lang=xx, then the pma_lang cookie). */
  async login(user: string, password: string, server = 1, lang?: string): Promise<void> {
    const page = await this.#req(`/index.php?route=/${lang !== undefined ? `&lang=${lang}` : ''}`)
    const token = page.match(/name="token" value="([^"]+)"/)?.[1] ?? ''
    const setSession = page.match(/name="set_session" value="([^"]+)"/)?.[1] ?? ''
    const home = await this.#req('/index.php?route=/', {
      token,
      set_session: setSession,
      pma_username: user,
      pma_password: password,
      server: String(server),
    })
    const t = home.match(/"token":"([^"]+)"/)?.[1] ?? home.match(/name="token" value="([^"]+)"/)?.[1]
    if (t === undefined || /id="login_form"/.test(home)) throw new Error('phpMyAdmin login failed')
    this.token = t
  }

  /** A full (non-AJAX) GET of a page, e.g. `/index.php?route=/database/structure&db=x`. */
  async page(path: string): Promise<string> {
    return this.#req(path)
  }

  /** GET `route` with query parameters (a full page, or the AJAX JSON when `ajax`). */
  async pageGet(route: string, params: Record<string, string> = {}, ajax = false): Promise<string> {
    const qs = new URLSearchParams({ route, ...params, ...(ajax ? { ajax_request: 'true' } : {}) })
    return this.#req(`/index.php?${qs}`, undefined, ajax)
  }

  /**
   * POST to `route` like a form or a `data-post` link (`server` and `token` added); `ajax` sends the
   * request the way phpMyAdmin's AJAX handlers do (`ajax_request=true` + `X-Requested-With`).
   */
  async pagePost(route: string, form: Record<string, string> = {}, ajax = false): Promise<string> {
    return this.#req(
      `/index.php?route=${route}`,
      { server: '1', ...form, ...(ajax ? { ajax_request: 'true' } : {}), token: this.token },
      ajax,
    )
  }

  /** `post` with an AJAX request, parsed as phpMyAdmin's JSON response. */
  async pagePostJson(route: string, form: Record<string, string> = {}): Promise<Record<string, unknown>> {
    return JSON.parse(await this.pagePost(route, form, true)) as Record<string, unknown>
  }

  /** `get` with an AJAX request, parsed as phpMyAdmin's JSON response. */
  async pageGetJson(route: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    return JSON.parse(await this.pageGet(route, params, true)) as Record<string, unknown>
  }

  /**
   * POST /navigation over AJAX with the parameters `navigation.ts` sends (loadChildNodes, reload,
   * treePagination, FastFilter.request). Returns the JSON response (`message` holds the HTML).
   */
  async navigation(
    params: Record<string, string>,
  ): Promise<{ success: boolean; message?: string; results?: string; error?: string }> {
    const body = await this.#req(
      '/index.php?route=/navigation&ajax_request=1',
      { server: '1', ...params, ajax_request: 'true', token: this.token },
      true,
    )
    return JSON.parse(body) as { success: boolean; message?: string; results?: string; error?: string }
  }

  /**
   * A form POST the way phpMyAdmin's JS sends it: `params` in order (repeat keys with a list of
   * pairs), plus `server` and `token`, over AJAX (`ajax_request=true`) unless `ajax` is false.
   * Returns the raw body (JSON for AJAX).
   */
  async post(
    route: string,
    params: Record<string, string> | Array<[string, string]>,
    { ajax = true }: { ajax?: boolean } = {},
  ): Promise<string> {
    const pairs: Array<[string, string]> = Array.isArray(params) ? [...params] : Object.entries(params)
    if (!pairs.some(([k]) => k === 'server')) pairs.push(['server', '1'])
    if (!pairs.some(([k]) => k === 'token')) pairs.push(['token', this.token])
    if (ajax && !pairs.some(([k]) => k === 'ajax_request')) pairs.push(['ajax_request', 'true'])
    return this.#reqPairs(`/index.php?route=${route}`, pairs, ajax)
  }

  /** {@link post} and JSON.parse of the AJAX answer. */
  async postJson(route: string, params: Record<string, string> | Array<[string, string]>): Promise<PmaJson> {
    const body = await this.post(route, params)
    try {
      return JSON.parse(body) as PmaJson
    } catch {
      throw new Error(`phpMyAdmin did not answer JSON for ${route}: ${body.slice(0, 500)}`)
    }
  }

  /** An AJAX GET (`ajax_request=1`), JSON-decoded. */
  async getJson(route: string, params: Record<string, string> = {}): Promise<PmaJson> {
    const qs = new URLSearchParams({ route, ...params, server: '1', ajax_request: '1' })
    const body = await this.#reqPairs(`/index.php?${qs}`, undefined, true)
    return JSON.parse(body) as PmaJson
  }

  async #reqPairs(path: string, pairs: Array<[string, string]> | undefined, ajax: boolean): Promise<string> {
    const headers: Record<string, string> = {}
    if (this.#cookies.size > 0) headers.cookie = [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    if (pairs !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded'
    if (ajax) headers['x-requested-with'] = 'XMLHttpRequest'
    const res = await fetch(this.base + path, {
      method: pairs === undefined ? 'GET' : 'POST',
      headers,
      redirect: 'manual',
      ...(pairs !== undefined ? { body: new URLSearchParams(pairs).toString() } : {}),
    })
    for (const c of res.headers.getSetCookie()) {
      const [kv = ''] = c.split(';')
      const i = kv.indexOf('=')
      const v = kv.slice(i + 1)
      if (v === 'deleted' || v === '') this.#cookies.delete(kv.slice(0, i))
      else this.#cookies.set(kv.slice(0, i), v)
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') ?? '/'
      return this.#req(
        loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : `/${loc.replace(/^\.\//, '')}`,
      )
    }
    return res.text()
  }

  /** The SQL tab form (resources/templates/sql/query.twig) posted to /import over AJAX. */
  async sqlBox(
    sql: string,
    db = '',
    table = '',
    delimiter = ';',
    extra: Record<string, string | null> = {},
  ): Promise<{ success: boolean; message?: string; error?: string } & Record<string, unknown>> {
    const form: Record<string, string> = {
      route: '/import',
      server: '1',
      db,
      table,
      token: this.token,
      is_js_confirmed: '0',
      pos: '0',
      goto: db === '' ? '/server/sql' : table === '' ? '/database/sql' : '/table/sql',
      message_to_show: 'Your SQL query has been executed successfully.',
      prev_sql_query: '',
      sql_query: sql,
      sql_delimiter: delimiter,
      fk_checks: '1',
      SQL: 'Go',
      ajax_request: 'true',
      ajax_page_request: 'true',
    }
    // `null` removes a default field
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) delete form[k]
      else form[k] = v
    }
    const body = await this.#req('/index.php?route=/import', form, true)
    return JSON.parse(body) as { success: boolean; message?: string; error?: string }
  }

  /** Any AJAX POST to a phpMyAdmin route (index.php?route=...), JSON response. */
  async postRoute(route: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const body = await this.#req(
      `/index.php?route=${route}`,
      { route, server: '1', token: this.token, ajax_request: 'true', ...form },
      true,
    )
    return JSON.parse(body) as Record<string, unknown>
  }

  /** Any AJAX GET (JSON response). */
  async getRoute(route: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ route, server: '1', ajax_request: 'true', ...params })
    const body = await this.#reqAjaxGet(`/index.php?${q}`)
    return JSON.parse(body) as Record<string, unknown>
  }

  /**
   * A form POST (pairs in order, `server` + `token` added, no AJAX) answered with raw bytes and
   * headers: downloads such as /export. Redirects are not followed.
   */
  async postBytes(
    route: string,
    pairs: Array<[string, string]>,
  ): Promise<{ status: number; headers: Headers; body: Buffer }> {
    const all: Array<[string, string]> = [...pairs]
    if (!all.some(([k]) => k === 'server')) all.push(['server', '1'])
    if (!all.some(([k]) => k === 'token')) all.push(['token', this.token])
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
    if (this.#cookies.size > 0) headers.cookie = [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetch(`${this.base}/index.php?route=${route}`, {
      method: 'POST',
      headers,
      redirect: 'manual',
      body: new URLSearchParams(all).toString(),
    })
    for (const c of res.headers.getSetCookie()) {
      const [kv = ''] = c.split(';')
      const i = kv.indexOf('=')
      const v = kv.slice(i + 1)
      if (v === 'deleted' || v === '') this.#cookies.delete(kv.slice(0, i))
      else this.#cookies.set(kv.slice(0, i), v)
    }
    return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) }
  }

  /** HTML of a full page (GET). */
  async routePage(route: string, params: Record<string, string> = {}): Promise<string> {
    const q = new URLSearchParams({ route, server: '1', ...params })
    return this.#req(`/index.php?${q}`)
  }

  #reqAjaxGet(path: string): Promise<string> {
    return this.#req(path, undefined, true)
  }
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

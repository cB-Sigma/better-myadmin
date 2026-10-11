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
  async get(route: string, params: Record<string, string> = {}, ajax = false): Promise<string> {
    const qs = new URLSearchParams({ route, ...params, ...(ajax ? { ajax_request: 'true' } : {}) })
    return this.#req(`/index.php?${qs}`, undefined, ajax)
  }

  /**
   * POST to `route` like a form or a `data-post` link (`server` and `token` added); `ajax` sends the
   * request the way phpMyAdmin's AJAX handlers do (`ajax_request=true` + `X-Requested-With`).
   */
  async post(route: string, form: Record<string, string> = {}, ajax = false): Promise<string> {
    return this.#req(
      `/index.php?route=${route}`,
      { server: '1', ...form, ...(ajax ? { ajax_request: 'true' } : {}), token: this.token },
      ajax,
    )
  }

  /** `post` with an AJAX request, parsed as phpMyAdmin's JSON response. */
  async postJson(route: string, form: Record<string, string> = {}): Promise<Record<string, unknown>> {
    return JSON.parse(await this.post(route, form, true)) as Record<string, unknown>
  }

  /** `get` with an AJAX request, parsed as phpMyAdmin's JSON response. */
  async getJson(route: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    return JSON.parse(await this.get(route, params, true)) as Record<string, unknown>
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

  /** The SQL tab form (resources/templates/sql/query.twig) posted to /import over AJAX. */
  async sqlBox(
    sql: string,
    db = '',
    table = '',
    delimiter = ';',
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const body = await this.#req(
      '/index.php?route=/import',
      {
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
      },
      true,
    )
    return JSON.parse(body) as { success: boolean; message?: string; error?: string }
  }
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

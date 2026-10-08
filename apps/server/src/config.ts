/**
 * The subset of the merged configuration (packages/config) the server runtime reads.
 * Names are phpMyAdmin's `$cfg` names; `Servers` is 0-based here and exposed 1-based in URLs.
 */
export interface ServerConfig {
  host: string
  port: string | number
  socket: string
  ssl: boolean
  ssl_key: string | null
  ssl_cert: string | null
  ssl_ca: string | null
  ssl_ca_path: string | null
  ssl_ciphers: string | null
  ssl_verify: boolean
  compress: boolean
  auth_type: string
  user: string
  password: string
  verbose: string
  AllowRoot: boolean
  AllowNoPassword: boolean
  AllowDeny: { order: string; rules: string[] }
  SessionTimeZone: string
  hide_connection_errors: boolean
  LogoutURL: string
  max_connections?: number
}

export interface AppConfig {
  Servers: ServerConfig[]
  ServerDefault: number
  blowfish_secret: string
  LoginCookieValidity: number
  LoginCookieStore: number
  LoginCookieRecall: boolean
  LoginCookieDeleteAll: boolean
  AllowArbitraryServer: boolean
  ArbitraryServerRegexp: string
  CookieSameSite: string
  TrustedProxies: Record<string, string>
  DefaultConnectionCollation: string
  MaxRows: number
  MaxExactCount: number
  MaxExactCountViews: number
  IgnoreMultiSubmitErrors: boolean
  AllowUserDropDatabase: boolean
  CSPAllow: string
  AllowThirdPartyFraming: boolean | string
  DBG: { sql: boolean }
  DataDir: string
  SessionStore?: string
  Listen?: { host?: string; port?: number; basePath?: string }
}

/** PHP empty(): '', '0', 0, false, null, [] are empty. */
export function phpEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === false || v === '' || v === '0' || v === 0 || (Array.isArray(v) && v.length === 0)
}

/**
 * Label used by the server selector. Servers with an empty host are not listed.
 * pma: src/Server/Select.php::render
 */
export function serverLabel(s: ServerConfig & { only_db?: string | string[] }): string {
  let label: string
  if (!phpEmpty(s.verbose)) {
    label = s.verbose
  } else {
    label = s.host
    if (!phpEmpty(s.port)) label += `:${s.port}`
  }
  if (!phpEmpty(s.only_db)) {
    if (!Array.isArray(s.only_db)) label += ` - ${s.only_db}`
    else if (s.only_db.length < 4) label += ` - ${s.only_db.join(', ')}`
  }
  if (!phpEmpty(s.user) && s.auth_type === 'config') label += `  (${s.user})`
  return label
}

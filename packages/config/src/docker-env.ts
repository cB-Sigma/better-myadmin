/**
 * The environment variables of the official phpMyAdmin Docker image (phpmyadmin/docker:
 * config.inc.php, helpers.php, docker-entrypoint.sh), mapped to directives, so a compose file
 * written for `phpmyadmin` runs BetterMyAdmin unchanged:
 *
 *   PMA_HOST / PMA_HOSTS, PMA_VERBOSE(S), PMA_PORT(S), PMA_SOCKET(S)   -> Servers[i]
 *   PMA_USER, PMA_PASSWORD                     -> auth_type config + user / password (else cookie)
 *   PMA_SSL(S), PMA_SSL_VERIFY / _VERIFIES, PMA_SSL_CA(S) / _KEY(S) / _CERT(S) [_BASE64], PMA_SSL_DIR
 *   PMA_PMADB, PMA_CONTROLHOST, PMA_CONTROLPORT, PMA_CONTROLUSER, PMA_CONTROLPASS
 *   PMA_ARBITRARY=1 -> AllowArbitraryServer, PMA_ABSOLUTE_URI -> PmaAbsoluteUri
 *   PMA_QUERYHISTORYDB, PMA_QUERYHISTORYMAX, PMA_UPLOADDIR, PMA_SAVEDIR, MAX_EXECUTION_TIME,
 *   MEMORY_LIMIT -> the directives of the same meaning
 *   UPLOAD_LIMIT (the image's php.ini upload_max_filesize / post_max_size, e.g. 2048K) -> MaxUploadSize
 *   APACHE_PORT -> Listen.port (the image's port inside the container)
 *   <NAME>_FILE (Docker secrets) for PMA_USER, PMA_PASSWORD, PMA_HOST(S), PMA_CONTROLHOST,
 *   PMA_CONTROLUSER, PMA_CONTROLPASS
 *
 * The layer sits below the config file (the image's config.user.inc.php overrides its env
 * settings) and below the BMA__ variables. Outside the image (`BMA_DOCKER` unset) the server
 * entries are only written when PMA_HOST(S) or PMA_SOCKET(S) is set; in the image a server `db`
 * is configured by default, like the image's "fallback to default linked" host, and the image's
 * own defaults apply: listen on 0.0.0.0:80 (the phpMyAdmin image's Apache port), data in
 * /var/lib/bettermyadmin (the volume).
 *
 * Not mapped: PMA_CONFIG_BASE64 / PMA_USER_CONFIG_BASE64 and /etc/phpmyadmin/conf.d (PHP files:
 * convert them with `importPmaConfig` and mount a bettermyadmin.config.*), HIDE_PHP_VERSION.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConfigIssue } from './errors.ts'

/** Set by the BetterMyAdmin image: the phpMyAdmin image's defaults apply (server `db`). */
export const ENV_DOCKER = 'BMA_DOCKER'

type Env = Readonly<Record<string, string | undefined>>

export interface DockerEnvLayer {
  value: Record<string, unknown>
  origins: Map<string, string>
  issues: ConfigIssue[]
}

/** docker-entrypoint.sh: get_docker_secret */
const SECRET_VARS = [
  'PMA_USER',
  'PMA_PASSWORD',
  'PMA_HOSTS',
  'PMA_HOST',
  'PMA_CONTROLHOST',
  'PMA_CONTROLUSER',
  'PMA_CONTROLPASS',
] as const

/** The storage tables config.inc.php sets with PMA_PMADB */
const PMADB_TABLES: Record<string, string> = {
  relation: 'pma__relation',
  table_info: 'pma__table_info',
  table_coords: 'pma__table_coords',
  pdf_pages: 'pma__pdf_pages',
  column_info: 'pma__column_info',
  bookmarktable: 'pma__bookmark',
  history: 'pma__history',
  recent: 'pma__recent',
  favorite: 'pma__favorite',
  table_uiprefs: 'pma__table_uiprefs',
  tracking: 'pma__tracking',
  userconfig: 'pma__userconfig',
  users: 'pma__users',
  usergroups: 'pma__usergroups',
  navigationhiding: 'pma__navigationhiding',
  savedsearches: 'pma__savedsearches',
  central_columns: 'pma__central_columns',
  designer_settings: 'pma__designer_settings',
  export_templates: 'pma__export_templates',
}

/** PHP `empty()` of an environment value */
const empty = (v: string | undefined) => v === undefined || v === '' || v === '0'

/** `array_map('trim', explode(',', $v))`; explode of an unset variable gives [''] */
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim())

/** PHP's ini quantity (upload_max_filesize): an integer with an optional K, M or G suffix */
export function iniQuantity(raw: string): number | null {
  const m = /^\s*(\d+)\s*([kmg]?)\s*$/i.exec(raw)
  if (m === null) return null
  const exp = { '': 0, k: 1, m: 2, g: 3 }[(m[2] ?? '').toLowerCase() as '' | 'k' | 'm' | 'g']
  return Number(m[1]) * 1024 ** exp
}

/**
 * helpers.php: decodeBase64AndSaveFiles — each comma-separated base64 file is written to
 * `<dir>/<prefix>-<n>.<ext>`; the paths come back comma-separated.
 */
function saveBase64Files(contents: string, prefix: string, ext: string, dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return contents
    .trim()
    .split(',')
    .map((b64, i) => {
      const file = join(dir, `${prefix}-${i + 1}.${ext}`)
      // the message names the file, not its content (a private key)
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64.trim())) throw new Error(`Failed to decode: ${file}`)
      // private keys among them: readable by the server's user only
      writeFileSync(file, Buffer.from(b64.trim(), 'base64'), { mode: 0o600 })
      return file
    })
    .join(',')
}

/** Builds a configuration layer from the phpMyAdmin image's variables. Never throws; see `issues`. */
export function parseDockerEnv(input: Env): DockerEnvLayer {
  const value: Record<string, unknown> = {}
  const origins = new Map<string, string>()
  const issues: ConfigIssue[] = []
  const env: Record<string, string | undefined> = { ...input }

  // docker-entrypoint.sh: get_docker_secret (`$(cat file)` drops the trailing newlines)
  for (const name of SECRET_VARS) {
    const file = env[`${name}_FILE`]
    if (file === undefined || file === '') continue
    try {
      env[name] = readFileSync(file, 'utf8').replace(/\n+$/, '')
    } catch (e) {
      issues.push({
        path: '',
        message: `cannot read ${file}: ${(e as Error).message}`,
        source: `env ${name}_FILE`,
      })
    }
  }

  const set = (path: string[], v: unknown, from: string) => {
    let cur = value
    for (const k of path.slice(0, -1)) {
      if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
      cur = cur[k] as Record<string, unknown>
    }
    cur[path[path.length - 1] as string] = v
    origins.set(path.join('.'), `env ${from}`)
  }

  if (env.PMA_QUERYHISTORYDB !== undefined)
    set(['QueryHistoryDB'], !empty(env.PMA_QUERYHISTORYDB), 'PMA_QUERYHISTORYDB')
  if (env.PMA_QUERYHISTORYMAX !== undefined)
    set(['QueryHistoryMax'], Number.parseInt(env.PMA_QUERYHISTORYMAX, 10) || 0, 'PMA_QUERYHISTORYMAX')
  // Arbitrary server connection
  if (env.PMA_ARBITRARY === '1') set(['AllowArbitraryServer'], true, 'PMA_ARBITRARY')
  // Play nice behind reverse proxys
  if (env.PMA_ABSOLUTE_URI !== undefined)
    set(['PmaAbsoluteUri'], env.PMA_ABSOLUTE_URI.trim(), 'PMA_ABSOLUTE_URI')

  const sslDir = env.PMA_SSL_DIR ?? '/etc/phpmyadmin/ssl'
  const base64Files: Array<[string, string, string, string]> = [
    ['PMA_SSL_CA_BASE64', 'PMA_SSL_CA', 'phpmyadmin-ssl-CA', 'pem'],
    ['PMA_SSL_KEY_BASE64', 'PMA_SSL_KEY', 'phpmyadmin-ssl-CERT', 'cert'],
    ['PMA_SSL_CERT_BASE64', 'PMA_SSL_CERT', 'phpmyadmin-ssl-CERT', 'cert'],
    ['PMA_SSL_CAS_BASE64', 'PMA_SSL_CAS', 'phpmyadmin-ssl-CA', 'pem'],
    ['PMA_SSL_KEYS_BASE64', 'PMA_SSL_KEYS', 'phpmyadmin-ssl-CERT', 'cert'],
    // pma: the image saves these under the KEY prefix
    ['PMA_SSL_CERTS_BASE64', 'PMA_SSL_CERTS', 'phpmyadmin-ssl-KEY', 'key'],
  ]
  for (const [from, to, prefix, ext] of base64Files) {
    const b64 = env[from]
    if (b64 === undefined) continue
    try {
      env[to] = saveBase64Files(b64, prefix, ext, sslDir)
    } catch (e) {
      issues.push({ path: '', message: (e as Error).message, source: `env ${from}` })
    }
  }

  // Figure out hosts: the image falls back to the linked `db`
  const docker = !empty(env[ENV_DOCKER])
  if (docker) {
    set(['Listen', 'host'], '0.0.0.0', ENV_DOCKER)
    set(['Listen', 'port'], 80, ENV_DOCKER)
    set(['DataDir'], '/var/lib/bettermyadmin', ENV_DOCKER)
  }
  let hosts: string[] = docker ? ['db'] : []
  let verbose: Array<string | undefined> = []
  let ports: Array<string | undefined> = []
  let ssls: Array<string | undefined> = []
  let verifies: Array<string | undefined> = []
  let cas: Array<string | undefined> = []
  let keys: Array<string | undefined> = []
  let certs: Array<string | undefined> = []
  let hostVar = 'BMA_DOCKER'
  if (!empty(env.PMA_HOST)) {
    hosts = [env.PMA_HOST as string]
    verbose = [env.PMA_VERBOSE]
    ports = [env.PMA_PORT]
    ssls = [env.PMA_SSL]
    verifies = [env.PMA_SSL_VERIFY]
    cas = [env.PMA_SSL_CA]
    keys = [env.PMA_SSL_KEY]
    certs = [env.PMA_SSL_CERT]
    hostVar = 'PMA_HOST'
  } else if (!empty(env.PMA_HOSTS)) {
    hosts = list(env.PMA_HOSTS)
    verbose = list(env.PMA_VERBOSES)
    ports = list(env.PMA_PORTS)
    ssls = list(env.PMA_SSLS)
    verifies = list(env.PMA_SSL_VERIFIES)
    cas = list(env.PMA_SSL_CAS)
    keys = list(env.PMA_SSL_KEYS)
    certs = list(env.PMA_SSL_CERTS)
    hostVar = 'PMA_HOSTS'
  }
  let sockets: string[] = []
  if (!empty(env.PMA_SOCKET)) sockets = [env.PMA_SOCKET as string]
  else if (!empty(env.PMA_SOCKETS)) sockets = (env.PMA_SOCKETS as string).split(',')

  // Server settings
  hosts.forEach((host, n) => {
    const i = String(n + 1)
    const s = (k: string, v: unknown, from: string) => set(['Servers', i, k], v, from)
    if (ssls[n] === '1') s('ssl', true, 'PMA_SSL')
    if (verifies[n] === '1') s('ssl_verify', true, 'PMA_SSL_VERIFY')
    // an empty path (a shorter comma list) is no file
    if (cas[n] !== undefined && cas[n] !== '') s('ssl_ca', cas[n], 'PMA_SSL_CA')
    if (keys[n] !== undefined && keys[n] !== '') s('ssl_key', keys[n], 'PMA_SSL_KEY')
    if (certs[n] !== undefined && certs[n] !== '') s('ssl_cert', certs[n], 'PMA_SSL_CERT')
    s('host', host, hostVar)
    if (verbose[n] !== undefined) s('verbose', verbose[n], 'PMA_VERBOSE')
    if (ports[n] !== undefined) s('port', ports[n], 'PMA_PORT')
    if (env.PMA_USER !== undefined) {
      s('auth_type', 'config', 'PMA_USER')
      s('user', env.PMA_USER, 'PMA_USER')
      s('password', env.PMA_PASSWORD ?? '', 'PMA_PASSWORD')
    } else {
      s('auth_type', 'cookie', hostVar)
    }
    if (env.PMA_PMADB !== undefined) {
      s('pmadb', env.PMA_PMADB, 'PMA_PMADB')
      for (const [k, t] of Object.entries(PMADB_TABLES)) s(k, t, 'PMA_PMADB')
    }
    if (env.PMA_CONTROLHOST !== undefined) s('controlhost', env.PMA_CONTROLHOST, 'PMA_CONTROLHOST')
    if (env.PMA_CONTROLPORT !== undefined) s('controlport', env.PMA_CONTROLPORT, 'PMA_CONTROLPORT')
    if (env.PMA_CONTROLUSER !== undefined) s('controluser', env.PMA_CONTROLUSER, 'PMA_CONTROLUSER')
    if (env.PMA_CONTROLPASS !== undefined) s('controlpass', env.PMA_CONTROLPASS, 'PMA_CONTROLPASS')
    s('compress', false, hostVar)
    s('AllowNoPassword', true, hostVar)
  })
  sockets.forEach((socket, n) => {
    set(['Servers', String(n + 1), 'socket'], socket, 'PMA_SOCKET')
    set(['Servers', String(n + 1), 'host'], 'localhost', 'PMA_SOCKET')
  })

  // Uploads setup
  if (env.PMA_UPLOADDIR !== undefined) set(['UploadDir'], env.PMA_UPLOADDIR, 'PMA_UPLOADDIR')
  if (env.PMA_SAVEDIR !== undefined) set(['SaveDir'], env.PMA_SAVEDIR, 'PMA_SAVEDIR')
  if (env.MAX_EXECUTION_TIME !== undefined)
    set(['ExecTimeLimit'], env.MAX_EXECUTION_TIME, 'MAX_EXECUTION_TIME')
  if (env.MEMORY_LIMIT !== undefined) set(['MemoryLimit'], env.MEMORY_LIMIT, 'MEMORY_LIMIT')
  // the image's Dockerfile: upload_max_filesize = post_max_size = $UPLOAD_LIMIT
  if (env.UPLOAD_LIMIT !== undefined) {
    const bytes = iniQuantity(env.UPLOAD_LIMIT)
    if (bytes === null) {
      issues.push({
        path: 'MaxUploadSize',
        message: `expected a size such as 2048K, 512M or 1G, got ${JSON.stringify(env.UPLOAD_LIMIT)}`,
        source: 'env UPLOAD_LIMIT',
      })
    } else set(['MaxUploadSize'], bytes, 'UPLOAD_LIMIT')
  }
  // docker-entrypoint.sh: the Apache port inside the container
  if (env.APACHE_PORT !== undefined) set(['Listen', 'port'], env.APACHE_PORT, 'APACHE_PORT')

  return { value, origins, issues }
}

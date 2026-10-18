import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { HomeResponse, HomeWarning } from '@bettermyadmin/contracts'
import { languageStats, sprintf } from '@bettermyadmin/i18n'
import { collationDescription } from '@bettermyadmin/mysql-types'
import { serverIndexes } from '../config.ts'
import { arePmadbTablesAllDisabled } from '../pmadb/storage.ts'
import { readGitInfo } from './git.ts'
import { APP_VERSION, type ShellCtx, storage } from './scope.ts'

const require = createRequire(import.meta.url)

/** SODIUM_CRYPTO_SECRETBOX_KEYBYTES */
const KEY_BYTES = 32

/** A dependency's version (its package.json may not be exported, so walk up from the entry point). */
function pkgVersion(name: string): string {
  try {
    let dir = dirname(require.resolve(name))
    for (;;) {
      const f = join(dir, 'package.json')
      if (existsSync(f)) {
        const pkg = JSON.parse(readFileSync(f, 'utf8')) as { name?: string; version?: string }
        if (pkg.name === name) return pkg.version ?? ''
      }
      const up = dirname(dir)
      if (up === dir) return ''
      dir = up
    }
  } catch {
    return ''
  }
}

export interface HomeEnv {
  /** Request `Host` header (HTTP_HOST). */
  httpHost: string
  /** blowfish_secret as configured, before main.ts generated one into DataDir. */
  configuredSecret: string
  secretGenerated: boolean
  partialLogout: boolean
  /** DefaultConnectionCollation in effect for this login */
  connectionCollation: string
  /** the setup script's `config/` directory exists (default: looked up in the working directory) */
  setupConfigDir?: boolean
}

/**
 * HomeController::checkRequirements, adapted to the Node runtime: the PHP extension checks (#1, #2),
 * `session.gc_maxlifetime` (#3: our session store keeps sessions at least twice
 * max(LoginCookieValidity, LoginCookieStore)) and the Twig cache (#9) cannot occur; the translation-completeness notice (#11) is wired by the i18n layer.
 */
export function homeWarnings(
  ctx: Pick<ShellCtx, 'cfg' | 'server' | 'tr' | 'lang'>,
  env: HomeEnv,
): HomeWarning[] {
  const { cfg, server, tr } = ctx
  const out: HomeWarning[] = []
  if (cfg.LoginCookieStore !== 0 && cfg.LoginCookieStore < cfg.LoginCookieValidity) {
    out.push({
      severity: 'warning',
      message: tr.gettext(
        'Login cookie store is lower than cookie validity configured in phpMyAdmin, because of this, your login will expire sooner than configured in phpMyAdmin.',
      ),
    })
  }
  if (server.controluser === 'pma' && server.controlpass === 'pmapass') {
    out.push({
      severity: 'warning',
      message: tr.gettext(
        "Your server is running with default values for the controluser and password (controlpass) and is open to intrusion; you really should fix this security weakness by changing the password for controluser 'pma'.",
      ),
    })
  }
  // $_SESSION['encryption_key'] is always set for cookie auth; the checks are about the configured key
  const keyLength = env.secretGenerated ? 0 : Buffer.byteLength(env.configuredSecret, 'utf8')
  if (keyLength < KEY_BYTES) {
    out.push({
      severity: 'warning',
      message: tr.gettext(
        'The configuration file needs a valid key for cookie encryption. A temporary key was automatically generated for you. Please refer to the [doc@cfg_blowfish_secret]documentation[/doc].',
      ),
    })
  } else if (keyLength > KEY_BYTES) {
    out.push({
      severity: 'warning',
      message: sprintf(
        tr.gettext(
          'The cookie encryption key in the configuration file is longer than necessary. It should only be %d bytes long. Please refer to the [doc@cfg_blowfish_secret]documentation[/doc].',
        ),
        KEY_BYTES,
      ),
    })
  }
  if (cfg.URLQueryEncryption) {
    const n = Buffer.byteLength(cfg.URLQueryEncryptionSecretKey, 'utf8')
    if (n < KEY_BYTES) {
      out.push({
        severity: 'warning',
        message: tr.gettext(
          'The configuration file needs a valid key for query encryption. A temporary key was automatically generated for you. Please refer to the [doc@cfg_URLQueryEncryptionSecretKey]documentation[/doc].',
        ),
      })
    } else if (n > KEY_BYTES) {
      out.push({
        severity: 'warning',
        message: sprintf(
          tr.gettext(
            'The query encryption key in the configuration file is longer than necessary. It should only be %d bytes long. Please refer to the [doc@cfg_URLQueryEncryptionSecretKey]documentation[/doc].',
          ),
          KEY_BYTES,
        ),
      })
    }
  }
  // the setup script's Save writes into `config/` (phpMyAdmin 4's setup): it should go afterwards
  if (env.setupConfigDir ?? existsSync(join(process.cwd(), 'config'))) {
    out.push({
      severity: 'warning',
      message: tr.gettext(
        'Directory [code]config[/code], which is used by the setup script, still exists in your phpMyAdmin directory. It is strongly recommended to remove it once phpMyAdmin has been configured. Otherwise the security of your server may be compromised by unauthorized people downloading your configuration.',
      ),
    })
  }
  if (env.httpHost === '') {
    out.push({
      severity: 'warning',
      message: tr.gettext(
        'The [code]HTTP_HOST[/code] variable is missing, which might cause phpMyAdmin to not work properly. Please refer to [doc@faq1-46]documentation[/doc] for possible issues.',
      ),
    })
  }
  // HomeController::checkLanguageStats: intentionally not translated (phpMyAdmin's text)
  const stat = languageStats[ctx.lang]
  if (stat !== undefined && stat < cfg.TranslationWarningThreshold) {
    out.push({
      severity: 'notice',
      message:
        'You are using an incomplete translation, please help to make it better by [a@https://www.phpmyadmin.net/translate/@_blank]contributing[/a].',
    })
  }
  return out
}

/** Generator::getServerSSL */
export function serverSsl(ctx: Pick<ShellCtx, 'cfg' | 'server' | 'tr'>): {
  message: string
  danger: boolean
} {
  const s = ctx.server
  const tr = ctx.tr
  if (!s.ssl) {
    const safe = s.socket !== '' || ctx.cfg.MysqlSslWarningSafeHosts.includes(s.host)
    return { message: tr.gettext('SSL is not being used'), danger: !safe }
  }
  if (!s.ssl_verify) return { message: tr.gettext('SSL is used with disabled verification'), danger: true }
  if (s.ssl_ca === null || s.ssl_ca === '')
    return { message: tr.gettext('SSL is used without certification authority'), danger: true }
  return { message: tr.gettext('SSL is used'), danger: false }
}

/** mysqli_get_host_info() for the connection we opened. */
function hostInfo(ctx: ShellCtx): string {
  const s = ctx.server
  const host = s.host === '' ? 'localhost' : s.host
  if (s.socket !== '' && (host === 'localhost' || s.host === '')) return 'Localhost via UNIX socket'
  return `${host} via TCP/IP`
}

/** pma: src/Controllers/HomeController.php::__invoke */
export async function homeData(ctx: ShellCtx, env: HomeEnv): Promise<HomeResponse> {
  const { cfg, server, conn } = ctx
  const si = conn.serverInfo
  const versionInt = si?.versionInt ?? 0
  const isMariaDb = si?.isMariaDb ?? false
  const disableIs = server.DisableIS

  // Charsets::getCharsets / getCollations
  const charsetRows = await conn.rows(
    disableIs
      ? 'SHOW CHARACTER SET'
      : 'SELECT `CHARACTER_SET_NAME` AS `Charset`, `DEFAULT_COLLATE_NAME` AS `Default collation`, `DESCRIPTION` AS `Description`, `MAXLEN` AS `Maxlen` FROM `information_schema`.`CHARACTER_SETS`',
    'home.charsets',
  )
  const collationSql =
    isMariaDb && versionInt >= 101000
      ? 'SELECT `collapp`.`FULL_COLLATION_NAME` AS `Collation`, `collapp`.`CHARACTER_SET_NAME` AS `Charset`, `collapp`.`ID` AS `Id`, `collapp`.`IS_DEFAULT` AS `Default`, `coll`.`IS_COMPILED` AS `Compiled`, `coll`.`SORTLEN` AS `Sortlen` FROM `information_schema`.`COLLATION_CHARACTER_SET_APPLICABILITY` `collapp` LEFT JOIN `information_schema`.`COLLATIONS` `coll` ON `collapp`.`COLLATION_NAME`=`coll`.`COLLATION_NAME`'
      : disableIs
        ? 'SHOW COLLATION'
        : 'SELECT `COLLATION_NAME` AS `Collation`, `CHARACTER_SET_NAME` AS `Charset`, `ID` AS `Id`, `IS_DEFAULT` AS `Default`, `IS_COMPILED` AS `Compiled`, `SORTLEN` AS `Sortlen` FROM `information_schema`.`COLLATIONS`'
  const collationRows = await conn.rows(collationSql, 'home.collations')
  const byteSort = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const charsetDesc = new Map(charsetRows.map((r) => [r.Charset ?? '', r.Description ?? '']))
  const collations = new Map<string, string[]>()
  for (const r of collationRows) {
    const cs = r.Charset ?? ''
    collations.set(cs, [...(collations.get(cs) ?? []), r.Collation ?? ''])
  }
  const defaultCollation = versionInt > 50503 ? 'utf8mb4_general_ci' : 'utf8_general_ci'
  const charsets = [...charsetDesc.keys()].sort(byteSort).map((name) => ({
    name,
    description: charsetDesc.get(name) ?? '',
    collations: [...new Set(collations.get(name) ?? [])].sort(byteSort).map((c) => ({
      name: c,
      description: collationDescription(c, ctx.tr),
    })),
  }))

  const showServerInfo = cfg.ShowServerInfo
  let databaseServer: HomeResponse['databaseServer'] = null
  if (showServerInfo === true || showServerInfo === 'database-server') {
    let host = server.verbose !== '' ? `${server.verbose} (` : ''
    host += hostInfo(ctx)
    if (server.verbose !== '') host += ')'
    const hostname = (await conn.value('SELECT @@hostname;', 'home.hostname')) ?? ''
    // Charsets::getServerCharset
    let serverCharset: string | null = null
    try {
      const rows = await conn.query(
        "SHOW SESSION VARIABLES LIKE 'character_set_server';",
        'home.serverCharset',
      )
      serverCharset = rows.resultSets[0]?.rows[0]?.[1]?.toString('utf8') ?? null
    } catch {
      serverCharset = null
    }
    if (serverCharset === null)
      serverCharset = await conn.value('SELECT @@character_set_server;', 'home.serverCharset')
    const unknown = ctx.tr.gettext('Unknown')
    let charset = `${unknown} (${unknown})`
    if (serverCharset !== null && charsetDesc.has(serverCharset)) {
      charset = `${charsetDesc.get(serverCharset)} (${serverCharset})`
    } else if (serverCharset === 'utf8mb3' && charsetDesc.has('utf8')) {
      charset = `${charsetDesc.get('utf8')} (utf8)`
    }
    databaseServer = {
      host,
      hostname,
      type: isMariaDb ? 'MariaDB' : si?.isPercona === true ? 'Percona Server' : 'MySQL',
      connection: serverSsl(ctx),
      version: `${si?.version ?? ''} - ${si?.versionComment ?? ''}`,
      user: (await conn.value('SELECT USER();', 'home.user')) ?? '',
      charset,
    }
  }

  let webServer: HomeResponse['webServer'] = null
  if (showServerInfo === true || showServerInfo === 'web-server') {
    // mysqli_get_client_info(): "libmysql - " when it looks like a version (HomeController)
    let client = `mysql2 ${pkgVersion('mysql2')}`
    if (/\d+\.\d+\.\d+/.test(client)) client = `libmysql - ${client}`
    webServer = {
      software: `@hono/node-server/${pkgVersion('@hono/node-server')} (Node.js)`,
      database: client,
      modules: ['mysql2', 'hono', 'zod'].map((name) => ({
        name,
        url: `https://www.npmjs.com/package/${name}`,
      })),
      runtimeVersion: process.versions.node,
    }
  }

  const st = await storage(ctx)
  let configStorageMessage: HomeResponse['configStorageMessage'] = null
  if (!arePmadbTablesAllDisabled(server) && !st.allFeatures && !cfg.PmaNoRelation_DisableWarning) {
    configStorageMessage = { type: server.pmadb !== '' ? 'error' : 'notice', zeroConf: cfg.ZeroConf }
  }

  const git = cfg.ShowGitRevision ? readGitInfo() : null
  return {
    hasServerSelection:
      cfg.ServerDefault === 0 || (cfg.NavigationDisplayServers && serverIndexes(cfg).length > 1),
    displayServersList: cfg.DisplayServersList,
    hasChangePasswordLink: server.auth_type !== 'config' && cfg.ShowChgPassword,
    collation: {
      selected: defaultCollation,
      current: env.connectionCollation,
      charsets,
    },
    databaseServer,
    webServer,
    showPhpInfo: cfg.ShowPhpInfo,
    versionCheck: cfg.VersionCheck,
    app: { name: 'BetterMyAdmin', version: APP_VERSION, git },
    warnings: homeWarnings(ctx, env),
    configStorageMessage,
    partialLogout: env.partialLogout,
  }
}

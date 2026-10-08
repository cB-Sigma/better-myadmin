import type { ResolvedConfig, ServerConfig } from '@bettermyadmin/config'

/** The merged configuration (packages/config): phpMyAdmin names, `Servers` keyed "1".."n". */
export type AppConfig = ResolvedConfig
export type { ServerConfig }

/** Servers[i] with i 1-based, as in phpMyAdmin URLs (`?server=`). */
export function getServer(cfg: AppConfig, index: number): ServerConfig | undefined {
  return (cfg.Servers as Record<string, ServerConfig>)[String(index)]
}

export function serverIndexes(cfg: AppConfig): number[] {
  return Object.keys(cfg.Servers)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
}

/** PHP empty(): '', '0', 0, false, null, [] are empty. */
export function phpEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === false ||
    v === '' ||
    v === '0' ||
    v === 0 ||
    (Array.isArray(v) && v.length === 0)
  )
}

/**
 * Label used by the server selector. Servers with an empty host are not listed.
 * pma: src/Server/Select.php::render
 */
export function serverLabel(s: ServerConfig): string {
  let label: string
  if (!phpEmpty(s.verbose)) {
    label = s.verbose
  } else {
    label = String(s.host)
    if (!phpEmpty(s.port)) label += `:${s.port}`
  }
  const onlyDb = s.only_db as string | string[]
  if (!phpEmpty(onlyDb)) {
    if (!Array.isArray(onlyDb)) label += ` - ${onlyDb}`
    else if (onlyDb.length < 4) label += ` - ${onlyDb.join(', ')}`
  }
  if (!phpEmpty(s.user) && s.auth_type === 'config') label += `  (${s.user})`
  return label
}

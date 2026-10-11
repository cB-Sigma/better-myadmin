import type { ClientConfig } from '../../lib/config.ts'

export interface TitleVars {
  httpHost: string
  /** Servers[i]['host'] */
  host: string
  /** Servers[i]['verbose'] */
  verbose: string
  db: string
  table: string
  appVersion: string
}

/**
 * Util::expandUserString for page titles (no escaping: React sets `document.title` as text).
 * `@COLUMNS@` needs the table's column list and is left to the table pages.
 * pma: src/Util.php::expandUserString
 */
export function expandUserString(template: string, v: TitleVars): string {
  const replace: Record<string, string> = {
    '@HTTP_HOST@': v.httpHost,
    '@SERVER@': v.host,
    __SERVER__: v.host,
    '@VERBOSE@': v.verbose,
    '@VSERVER@': v.verbose !== '' ? v.verbose : v.host,
    '@DATABASE@': v.db,
    __DB__: v.db,
    '@TABLE@': v.table,
    __TABLE__: v.table,
    '@PHPMYADMIN@': `BetterMyAdmin ${v.appVersion}`,
  }
  // strtr: longest match first, no re-replacement of inserted text
  const keys = Object.keys(replace).sort((a, b) => b.length - a.length)
  const re = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return template.replaceAll('@FIELDS@', '@COLUMNS@').replace(re, (m) => replace[m] ?? m)
}

/**
 * Header::getPageTitle: TitleTable / TitleDatabase / TitleServer (when the server has a host) /
 * TitleDefault; without a server, the literal product name.
 */
export function pageTitle(cfg: ClientConfig, v: TitleVars | null): string {
  if (v === null) return 'BetterMyAdmin'
  let template: string
  if (v.table !== '') template = cfg.TitleTable
  else if (v.db !== '') template = cfg.TitleDatabase
  else if (v.host !== '') template = cfg.TitleServer
  else template = cfg.TitleDefault
  return expandUserString(template, v)
}

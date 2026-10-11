import { strftimeC } from '@bettermyadmin/i18n'
import type { PluginContext } from './plugin.ts'

/** PHP strtr($string, $pairs): longest keys first, no re-replacement. */
export function strtr(str: string, pairs: Record<string, string>): string {
  const keys = Object.keys(pairs)
    .filter((k) => k !== '')
    .sort((a, b) => b.length - a.length)
  if (keys.length === 0) return str
  let out = ''
  let i = 0
  outer: while (i < str.length) {
    for (const k of keys) {
      if (str.startsWith(k, i)) {
        out += pairs[k]
        i += k.length
        continue outer
      }
    }
    out += str[i]
    i++
  }
  return out
}

/**
 * Util::expandUserString: strftime, then @SERVER@, @DATABASE@, @TABLE@ … (optionally escaped),
 * with `updates` overriding the database/table.
 * pma: src/Util.php::expandUserString
 */
export async function expandUserString(
  ctx: Pick<PluginContext, 'server' | 'db' | 'table' | 'tool' | 'tables' | 'timeZone' | 'now'>,
  string0: string,
  escapeFn: ((s: string) => string) | null = null,
  updates: { table?: string; database?: string } = {},
): Promise<string> {
  const host = ctx.server.host
  const verbose = ctx.server.verbose
  const database = updates.database ?? ctx.db
  const table = updates.table ?? ctx.table
  let replace: Record<string, string> = {
    '@HTTP_HOST@': ctx.server.httpHost,
    '@SERVER@': host,
    __SERVER__: host,
    '@VERBOSE@': verbose,
    '@VSERVER@': verbose === '' ? host : verbose,
    '@DATABASE@': database,
    __DB__: database,
    '@TABLE@': table,
    __TABLE__: table,
    '@PHPMYADMIN@': `${ctx.tool.name} ${ctx.tool.version}`,
  }
  if (escapeFn !== null)
    replace = Object.fromEntries(Object.entries(replace).map(([k, v]) => [k, escapeFn(v)]))
  let string = string0
  // Backward compatibility in 3.5.x
  if (string.includes('@FIELDS@')) string = strtr(string, { '@FIELDS@': '@COLUMNS@' })
  // Fetch columns list if required
  if (string.includes('@COLUMNS@')) {
    const list = await ctx.tables.getColumnNames(ctx.db, ctx.table)
    replace['@COLUMNS@'] = (escapeFn !== null ? list.map(escapeFn) : list).join(',')
  }
  return strtr(strftimeC(string, Math.floor(ctx.now.getTime() / 1000), ctx.timeZone), replace)
}

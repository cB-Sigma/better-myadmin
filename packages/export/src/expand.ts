import { strftimeC } from '@bettermyadmin/i18n'
import { php } from '@bettermyadmin/mysql-types'
import type { PluginContext } from './plugin.ts'

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
  if (string.includes('@FIELDS@')) string = php.strtr(string, { '@FIELDS@': '@COLUMNS@' })
  // Fetch columns list if required
  if (string.includes('@COLUMNS@')) {
    const list = await ctx.tables.getColumnNames(ctx.db, ctx.table)
    replace['@COLUMNS@'] = (escapeFn !== null ? list.map(escapeFn) : list).join(',')
  }
  return php.strtr(strftimeC(string, Math.floor(ctx.now.getTime() / 1000), ctx.timeZone), replace)
}

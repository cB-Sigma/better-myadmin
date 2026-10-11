import type { BinlogResponse, PluginsResponse } from '@bettermyadmin/contracts'
import { formatByteDown } from '@bettermyadmin/i18n'
import { quoteString } from '@bettermyadmin/sql-gen'
import type { AdminCtx } from './context.ts'

/** PHP ksort() of string keys (the plugin types): byte order */
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b))

/**
 * Plugins grouped by type.
 * pma: src/Controllers/Server/PluginsController.php, src/Server/Plugins.php::getAll
 */
export async function pluginsPage(ctx: AdminCtx): Promise<PluginsResponse> {
  const sql = ctx.server.DisableIS
    ? 'SHOW PLUGINS'
    : 'SELECT * FROM information_schema.PLUGINS ORDER BY PLUGIN_TYPE, PLUGIN_NAME'
  const rows = await ctx.conn.rows(sql, 'plugins.list')
  const byType = new Map<string, PluginsResponse['types'][number]['plugins']>()
  for (const r of rows) {
    const type = r.PLUGIN_TYPE ?? r.Type ?? ''
    const list = byType.get(type) ?? []
    list.push({
      name: r.PLUGIN_NAME ?? r.Name ?? '',
      status: r.PLUGIN_STATUS ?? r.Status ?? '',
      description: r.PLUGIN_DESCRIPTION ?? null,
      version: r.PLUGIN_VERSION ?? null,
      author: r.PLUGIN_AUTHOR ?? null,
      license: r.PLUGIN_LICENSE ?? r.License ?? '',
    })
    byType.set(type, list)
  }
  return {
    types: [...byType.keys()].sort(byteOrder).map((type) => ({
      type,
      cleanType: type.toLowerCase().replace(/[^a-z]/g, ''),
      plugins: byType.get(type)!,
    })),
  }
}

/**
 * Binary log events, MaxRows per page.
 * pma: src/Controllers/Server/BinlogController.php, templates/server/binlog/index.twig
 */
export async function binlogPage(
  ctx: AdminCtx,
  q: { log: string; pos: number; isFullQuery: boolean },
): Promise<BinlogResponse> {
  const { tr, cfg } = ctx
  // the constructor reads the list (fetchResult keyed by Log_name)
  const logs = new Map<string, Record<string, string | null>>()
  for (const r of await ctx.dbi.fetchResultSimple('SHOW BINARY LOGS')) logs.set(r.Log_name ?? '', r)
  const maxRows = cfg.MaxRows
  const position = Math.trunc(q.pos)
  // phpMyAdmin interpolates the posted name unquoted; a log name never needs escaping, so quoting it
  // sends the same statement for real names and keeps arbitrary input out of the SQL
  let sql = 'SHOW BINLOG EVENTS'
  if (q.log !== '') sql += ` IN ${quoteString(q.log)}`
  sql += ` LIMIT ${position}, ${maxRows}`
  const r = await ctx.conn.query(sql, 'binlog.events')
  const set = r.resultSets[0]
  const fieldIndex = (name: string) => set?.fields.findIndex((f) => f.name === name) ?? -1
  const col = (row: Array<Buffer | null>, name: string) => {
    const i = fieldIndex(name)
    const v = i >= 0 ? row[i] : null
    return v === null || v === undefined ? '' : v.toString('utf8')
  }
  const hasOrig = fieldIndex('Orig_log_pos') >= 0
  const numRows = set?.rows.length ?? 0
  const maxChars = cfg.MaxCharactersInDisplayedSQL
  const events = (set?.rows ?? []).map((row) => {
    let info = col(row, 'Info')
    if (!q.isFullQuery && [...info].length > maxChars) info = `${[...info].slice(0, maxChars).join('')}[...]`
    return {
      logName: col(row, 'Log_name'),
      pos: col(row, 'Pos'),
      eventType: col(row, 'Event_type'),
      serverId: col(row, 'Server_id'),
      origLogPos: hasOrig ? col(row, 'Orig_log_pos') : col(row, 'End_log_pos'),
      info,
    }
  })
  let fullSize = 0
  const binaryLogs = [...logs.values()].map((l) => {
    const size = l.File_size
    if (size !== undefined && size !== null) fullSize += Number(size)
    return {
      name: l.Log_name ?? '',
      size: size === undefined || size === null ? null : formatByteDown(tr, size, 3, 2)!.join(' '),
    }
  })
  const mode = cfg.TableNavigationLinksMode
  return {
    binaryLogs,
    fileCount: logs.size,
    totalSize: fullSize > 0 ? formatByteDown(tr, fullSize)!.join(' ') : null,
    log: q.log,
    selectedLog: logs.has(q.log) ? q.log : null,
    sqlMessage: {
      message: { type: 'success', text: tr.gettext('Your SQL query has been executed successfully.') },
      sql,
    },
    events,
    pos: position,
    isFullQuery: q.isFullQuery,
    previous: position > 0 ? { pos: position > maxRows ? position - maxRows : null } : null,
    next: numRows >= maxRows ? { pos: position + maxRows } : null,
    hasIcons: mode === 'icons' || mode === 'both',
    hasText: mode === 'text' || mode === 'both',
  }
}

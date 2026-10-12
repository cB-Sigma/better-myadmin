/**
 * Table maintenance — the one implementation behind the table Operations page and the database
 * Structure bulk actions: ANALYZE / CHECK / CHECKSUM / OPTIMIZE / REPAIR TABLE on the selected
 * tables, the Msg rows (or checksums), the index problems of CHECK, the warnings of CHECKSUM.
 *
 * pma: src/Controllers/Table/Maintenance/*Controller.php, src/Table/Maintenance.php,
 *      templates/table/maintenance/*.twig
 */
import type {
  MaintenanceRequest,
  MaintenanceResult,
  OperationsResponse,
  SqlMessage,
} from '@bettermyadmin/contracts'
import { type Translator, sprintf } from '@bettermyadmin/i18n'
import { backquote, findDuplicateIndexes } from '@bettermyadmin/sql-gen'
import type { z } from 'zod'
import type { AppConfig } from '../config.ts'
import { MysqlError } from '../http/errors.ts'
import type { TableReader } from './read.ts'

interface MaintenanceCtx {
  reader: TableReader
  cfg: AppConfig
  tr: Translator
  db: string
}

/** the title and MySQL documentation page of each operation */
function heading(tr: Translator, op: MaintenanceResult['op']): { title: string; docPage: string } {
  switch (op) {
    case 'analyze':
      return { title: tr.gettext('Analyze table'), docPage: 'ANALYZE_TABLE' }
    case 'check':
      return { title: tr.gettext('Check table'), docPage: 'CHECK_TABLE' }
    case 'checksum':
      return { title: tr.gettext('Checksum table'), docPage: 'CHECKSUM_TABLE' }
    case 'optimize':
      return { title: tr.gettext('Optimize table'), docPage: 'OPTIMIZE_TABLE' }
    default:
      return { title: tr.gettext('Repair table'), docPage: 'REPAIR_TABLE' }
  }
}

const msg = (type: SqlMessage['type'], text: string, sql?: string): SqlMessage =>
  sql === undefined ? { type, text } : { type, text, sql }

export async function maintenance(
  ctx: MaintenanceCtx,
  req: z.output<typeof MaintenanceRequest>,
  defaultTable = '',
): Promise<OperationsResponse> {
  const { reader, tr, cfg } = ctx
  const tables = req.tables ?? (defaultTable === '' ? [] : [defaultTable])
  if (tables.length === 0 || tables.some((t) => t === '')) {
    return { messages: [msg('error', tr.gettext('No table selected.'))] }
  }
  if (cfg.DisableMultiTableMaintenance && tables.length > 1) {
    return { messages: [msg('error', tr.gettext('Maintenance operations on multiple tables are disabled.'))] }
  }
  const sql = `${req.op.toUpperCase()} TABLE ${tables.map((t) => backquote(t)).join(', ')};`
  await reader.selectDb(ctx.db)
  const result: MaintenanceResult = { op: req.op, ...heading(tr, req.op), rows: [] }
  let rows: Array<Record<string, string | null>>
  try {
    rows = await reader.conn.rows(sql, 'maintenance')
  } catch (e) {
    if (!(e instanceof MysqlError)) throw e
    return { messages: [msg('error', `#${e.extra.errno ?? 0} - ${e.message}`, sql)], maintenance: result }
  }
  reader.invalidate()
  if (req.op === 'checksum') {
    result.checksums = rows.map((r) => ({ table: r.Table ?? '', checksum: r.Checksum ?? null }))
    const w = await reader.dbi.tryQuery('SHOW WARNINGS')
    result.notices = (w?.rows ?? []).map((r) => `${r[0] ?? ''}: #${r[1] ?? ''} ${r[2] ?? ''}`)
  } else {
    result.rows = rows.map((r) => ({
      // Message::fromArray: the table without its database prefix
      table: (r.Table ?? '').includes('.')
        ? (r.Table ?? '').slice((r.Table ?? '').indexOf('.') + 1)
        : (r.Table ?? ''),
      op: r.Op ?? '',
      msgType: r.Msg_type ?? '',
      msgText: r.Msg_text ?? '',
    }))
  }
  if (req.op === 'check') {
    const notices: string[] = []
    for (const t of tables) {
      const dup = findDuplicateIndexes(await reader.getIndexes(ctx.db, t))
      if (dup.length === 0) continue
      notices.push(sprintf(tr.gettext('Problems with indexes of table `%s`'), t))
      for (const [a, b] of dup) {
        notices.push(
          sprintf(
            tr.gettext(
              'The indexes %1$s and %2$s seem to be equal and one of them could possibly be removed.',
            ),
            a,
            b,
          ),
        )
      }
    }
    result.notices = notices
  }
  return {
    messages: [msg('success', tr.gettext('Your SQL query has been executed successfully.'), sql)],
    maintenance: result,
  }
}

import type { SqlCard } from '@bettermyadmin/contracts'

/**
 * Generator::getMessage's query card for a message a page action returned with its SQL (structure
 * changes, find and replace, operations…): the SQL plus Edit inline / Edit / Explain / Create PHP
 * code. The same rules as the server's getMessageCard (apps/server/src/query/message.ts), from the
 * client-visible directives; these messages never carry a Profiling checkbox (no Sql::$showAsPhp,
 * no profiling session on the page that shows them).
 * pma: src/Html/Generator.php::getMessage
 */
export interface CardConfig {
  [key: string]: unknown
  ShowSQL?: unknown
  MaxCharactersInDisplayedSQL?: unknown
  SQLQuery?: unknown
}

const SP = '[ \\t\\n\\r\\v\\f]'
const EXPLAIN_RE = `^EXPLAIN${SP}+(?:ANALYZE${SP}+)?(?:FORMAT=(?:JSON|TREE|TRADITIONAL)${SP}+)?`
const ANALYZE_RE = `^ANALYZE${SP}+(?:FORMAT=(?:JSON|TRADITIONAL)${SP}+)?`

export function messageCard(
  sqlQuery: string,
  scope: { db: string; table: string },
  cfg: CardConfig,
): SqlCard | null {
  const showSql = cfg.ShowSQL !== false
  if (!showSql || sqlQuery === '' || sqlQuery === ';') return null
  const box = (cfg.SQLQuery ?? {}) as Partial<Record<'Edit' | 'Explain' | 'ShowAsPHP' | 'Refresh', boolean>>
  const max = typeof cfg.MaxCharactersInDisplayedSQL === 'number' ? cfg.MaxCharactersInDisplayedSQL : 1000
  const chars = Array.from(sqlQuery)
  const queryTooBig = chars.length > max
  const display = queryTooBig ? `${chars.slice(0, max).join('')}[...]` : sqlQuery
  const isSelect = new RegExp(`^SELECT${SP}+`, 'i').test(sqlQuery)
  let explain: SqlCard['links']['explain'] = null
  if (box.Explain !== false && !queryTooBig) {
    if (isSelect) explain = { text: 'Explain SQL', sql: `EXPLAIN ${sqlQuery}` }
    else if (new RegExp(`${EXPLAIN_RE}SELECT${SP}+`, 'i').test(sqlQuery))
      explain = { text: 'Skip Explain SQL', sql: sqlQuery.replace(new RegExp(EXPLAIN_RE, 'i'), '') }
    else if (new RegExp(`${ANALYZE_RE}SELECT${SP}+`, 'i').test(sqlQuery))
      explain = { text: 'Skip Analyze SQL', sql: sqlQuery.replace(new RegExp(ANALYZE_RE, 'i'), '') }
  }
  const refresh =
    box.Refresh !== false && new RegExp(`^(ANALYZE|EXPLAIN|SELECT|SHOW)${SP}+`, 'i').test(sqlQuery)
  return {
    sql: sqlQuery,
    display,
    php: false,
    db: scope.db,
    table: scope.db === '' ? '' : scope.table,
    links: {
      editInline: box.Edit !== false && !queryTooBig,
      edit: box.Edit !== false,
      explain,
      php: box.ShowAsPHP !== false && !queryTooBig ? 'create' : null,
      refresh,
      profiling: null,
    },
  }
}

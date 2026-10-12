import { backquote } from './quote.ts'

/**
 * CREATE / ALTER VIEW of the view form.
 * pma: src/Controllers/View/CreateController.php (VIEW_*_OPTIONS, getSqlQuery)
 */

export const VIEW_SECURITY_OPTIONS = ['DEFINER', 'INVOKER'] as const
export const VIEW_ALGORITHM_OPTIONS = ['UNDEFINED', 'MERGE', 'TEMPTABLE'] as const
export const VIEW_WITH_OPTIONS = ['CASCADED', 'LOCAL'] as const

export interface ViewDefinition {
  /** `isset($view['or_replace'])` */
  orReplace: boolean
  algorithm: string
  definer: string
  sqlSecurity: string
  name: string
  columnNames: string
  as: string
  with: string
}

const has = (list: readonly string[], v: string) => list.includes(v)

/** CreateController::getSqlQuery: `CREATE [OR REPLACE]` (createview) or `ALTER`, lines joined by "\r\n" */
export function getViewSqlQuery(createview: boolean, view: ViewDefinition): string {
  const sep = '\r\n'
  let sql = createview ? `CREATE${view.orReplace ? ' OR REPLACE' : ''}` : 'ALTER'
  if (has(VIEW_ALGORITHM_OPTIONS, view.algorithm)) sql += `${sep} ALGORITHM = ${view.algorithm}`
  // ! empty($view['definer']): '0' counts as empty in PHP
  if (view.definer !== '' && view.definer !== '0') {
    if (!view.definer.includes('@')) {
      sql += `${sep}DEFINER=${backquote(view.definer)}`
    } else {
      const parts = view.definer.split('@')
      sql += `${sep}DEFINER=${backquote(parts[0] ?? '')}`
      sql += `@${backquote(parts[1] ?? '')} `
    }
  }
  if (has(VIEW_SECURITY_OPTIONS, view.sqlSecurity)) sql += `${sep} SQL SECURITY ${view.sqlSecurity}`
  sql += `${sep} VIEW ${backquote(view.name)}`
  if (view.columnNames !== '' && view.columnNames !== '0') sql += `${sep} (${view.columnNames})`
  sql += `${sep} AS ${view.as}`
  if (has(VIEW_WITH_OPTIONS, view.with)) sql += `${sep} WITH ${view.with}  CHECK OPTION`
  return sql
}

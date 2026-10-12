/**
 * The visual query builder's model: the history of options (WHERE, rename, aggregate, GROUP BY,
 * ORDER BY, HAVING) per column, the selected columns, and the query built from them with automatic
 * LEFT JOINs along the relations on the canvas.
 * pma: resources/js/designer/history.ts, resources/js/designer/move.ts (storeColumn, selectAll, addObject)
 */

export type HistoryType = 'Where' | 'Rename' | 'Aggregate' | 'GroupBy' | 'OrderBy' | 'Having'

export interface HistoryObj {
  columnName: string
  /** the table name (getTab) */
  tab: string
  /** h_tabs entry (always 1) */
  objNo: number
  type: HistoryType
  /** 0 AND, 1 OR */
  andOr: 0 | 1
  relationOperator?: string
  query?: string
  renameTo?: string
  operator?: string
  order?: string
}

export interface QueryBuilderState {
  history: HistoryObj[]
  /** DesignerHistory.selectField: `` `table`.`column` `` or `` `table`.* `` */
  selectField: string[]
  /** window.fromArray: table names (duplicates kept) */
  fromArray: string[]
}

export const emptyQueryBuilder = (): QueryBuilderState => ({ history: [], selectField: [], fromArray: [] })

/** One relation of DesignerConfig.contr, ends as `db.table`. */
export interface ContrRelation {
  constraint: string
  masterTable: string
  masterField: string
  foreignTable: string
  foreignField: string
}

/** PHP rawurlencode (the designer config's table and column keys) */
export function rawurlencode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** DesignerHistory.detail */
export function detail(h: HistoryObj): string {
  switch (h.type) {
    case 'Where':
      return `Where ${h.columnName}${h.relationOperator ?? ''}${h.query ?? ''}`
    case 'Rename':
      return `Rename ${h.columnName} To ${h.renameTo ?? ''}`
    case 'Aggregate':
      return `Select ${h.operator ?? ''}( ${h.columnName} )`
    case 'GroupBy':
      return `GroupBy ${h.columnName}`
    case 'OrderBy':
      return `OrderBy ${h.columnName} ${h.order ?? ''}`
    case 'Having':
      if (h.operator !== 'None') {
        return `Having ${h.operator ?? ''}( ${h.columnName} )${h.relationOperator ?? ''}${h.query ?? ''}`
      }
      return `Having ${h.columnName}${h.relationOperator ?? ''}${h.query ?? ''}`
  }
}

/** DesignerHistory.display, sorting part: the new entries [init, finit) moved before the first entry they sort above */
export function sortHistory(history: readonly HistoryObj[], init: number, finit: number): HistoryObj[] {
  const a = [...history]
  for (let i = init; i < finit; i++) {
    const sto = a[i] as HistoryObj
    for (let j = 0; j < i; j++) {
      if (sto.tab > (a[j] as HistoryObj).tab) {
        for (let k = i; k > j; k--) a[k] = a[k - 1] as HistoryObj
        a[j] = sto
        break
      }
    }
  }
  return a
}

/** DesignerHistory.display, rendering part: consecutive entries of one table form a group */
export function historyGroups(history: readonly HistoryObj[]): Array<{ tab: string; indexes: number[] }> {
  const out: Array<{ tab: string; indexes: number[] }> = []
  for (let i = 0; i < history.length; i++) {
    const tab = (history[i] as HistoryObj).tab
    const indexes: number[] = []
    while (i < history.length && (history[i] as HistoryObj).tab === tab) {
      indexes.push(i)
      i++
    }
    i--
    out.push({ tab, indexes })
  }
  return out
}

/** DesignerHistory.historyDelete */
export function historyDelete(s: QueryBuilderState, index: number): QueryBuilderState {
  const h = s.history[index]
  if (h === undefined) return s
  const fromArray = [...s.fromArray]
  const k = fromArray.indexOf(h.tab)
  if (k !== -1) fromArray.splice(k, 1)
  const history = [...s.history]
  history.splice(index, 1)
  return { ...s, history, fromArray }
}

/** DesignerMove.storeColumn */
export function storeColumn(
  s: QueryBuilderState,
  tableName: string,
  colName: string,
  checked: boolean,
): QueryBuilderState {
  const field = `\`${tableName}\`.\`${colName}\``
  const selectField = [...s.selectField]
  const fromArray = [...s.fromArray]
  if (checked) {
    selectField.push(field)
    fromArray.push(tableName)
  } else {
    const i = selectField.indexOf(field)
    if (i !== -1) selectField.splice(i, 1)
    const k = fromArray.indexOf(tableName)
    if (k !== -1) fromArray.splice(k, 1)
  }
  return { ...s, selectField, fromArray }
}

/**
 * DesignerMove.selectAll: `` `table`.* `` (the table's column checkboxes are checked and disabled;
 * the ones already checked are clicked off first, so their entries are removed).
 */
export function selectAll(
  s: QueryBuilderState,
  tableName: string,
  checked: boolean,
  checkedColumns: readonly string[],
): QueryBuilderState {
  let next = s
  if (checked) for (const c of checkedColumns) next = storeColumn(next, tableName, c, false)
  const selectField = [...next.selectField]
  const fromArray = [...next.fromArray]
  if (checked) {
    selectField.push(`\`${tableName}\`.*`)
    fromArray.push(tableName)
  } else {
    // the loop keeps going after a splice (and skips the next entry)
    for (let i = 0; i < selectField.length; i++) {
      if (selectField[i] === `\`${tableName}\`.*`) selectField.splice(i, 1)
    }
    const k = fromArray.indexOf(tableName)
    if (k !== -1) fromArray.splice(k, 1)
  }
  return { ...next, selectField, fromArray }
}

export interface OptionsForm {
  relOpt: string
  query: string
  newName: string
  operator: string
  groupBy: boolean
  hRelOpt: string
  hOperator: string
  having: string
  orderBy: string
}

export const emptyOptions = (): OptionsForm => ({
  relOpt: '--',
  query: '',
  newName: '',
  operator: '---',
  groupBy: false,
  hRelOpt: '--',
  hOperator: '---',
  having: '',
  orderBy: '---',
})

/**
 * DesignerMove.addObject: the entries the options panel creates; `error` when the WHERE value is
 * empty (nothing is added), `stop` when the HAVING value is (the entries before it are kept but the
 * panel stays open and nothing is announced).
 */
export function addObject(
  s: QueryBuilderState,
  tableName: string,
  colName: string,
  objNo: number,
  o: OptionsForm,
): { state: QueryBuilderState; created: number; result: 'ok' | 'error' | 'stop' } {
  const init = s.history.length
  const history = [...s.history]
  const push = (type: HistoryType, extra: Partial<HistoryObj>) =>
    history.push({ columnName: colName, tab: tableName, objNo, type, andOr: 0, ...extra })
  if (o.relOpt !== '--') {
    if (o.query === '') return { state: s, created: 0, result: 'error' }
    push('Where', { relationOperator: o.relOpt, query: o.query })
  }
  if (o.newName !== '') push('Rename', { renameTo: o.newName })
  if (o.operator !== '---') push('Aggregate', { operator: o.operator })
  if (o.groupBy) push('GroupBy', {})
  if (o.hRelOpt !== '--') {
    if (o.having === '') return { state: { ...s, history }, created: history.length - init, result: 'stop' }
    push('Having', { relationOperator: o.hRelOpt, query: o.having, operator: o.hOperator })
  }
  if (o.orderBy !== '---') push('OrderBy', { order: o.orderBy })
  return {
    state: { ...s, history: sortHistory(history, init, history.length) },
    created: history.length - init,
    result: 'ok',
  }
}

/** DesignerHistory.unique */
const unique = <T>(a: readonly T[]): T[] => {
  const out: T[] = []
  for (const x of a) if (!out.includes(x)) out.push(x)
  return out
}

/** DesignerHistory.removeArray (a splice inside the loop skips the next element) */
function removeArray<T>(rem: readonly T[], arr: T[]): T[] {
  for (const r of rem) {
    const len = arr.length
    for (let j = 0; j < len; j++) if (r === arr[j]) arr.splice(j, 1)
  }
  return arr
}

export function queryGroupBy(h: readonly HistoryObj[]): string {
  let str = ''
  for (const x of h) if (x.type === 'GroupBy') str += `\`${x.columnName}\`, `
  return str.substring(0, str.length - 2)
}

export function queryHaving(h: readonly HistoryObj[]): string {
  let and = '('
  for (const x of h) {
    if (x.type !== 'Having') continue
    if (x.operator !== 'None') {
      and += `${x.operator ?? ''}(\`${x.columnName}\`) ${x.relationOperator ?? ''}`
      and += ` ${x.query ?? ''}, `
    } else {
      and += `\`${x.columnName}\` ${x.relationOperator ?? ''} ${x.query ?? ''}, `
    }
  }
  return and === '(' ? '' : `${and.substring(0, and.length - 2)})`
}

export function queryOrderBy(h: readonly HistoryObj[]): string {
  let str = ''
  for (const x of h) if (x.type === 'OrderBy') str += `\`${x.columnName}\` ${x.order ?? ''}, `
  return str.substring(0, str.length - 2)
}

export function queryWhere(h: readonly HistoryObj[]): string {
  let and = '('
  let or = '('
  for (const x of h) {
    if (x.type !== 'Where') continue
    const cond = `( \`${x.columnName}\` ${x.relationOperator ?? ''} ${x.query ?? ''})`
    if (x.andOr === 0) and += `${cond} AND `
    else or += `${cond} OR `
  }
  or = or !== '(' ? `${or.substring(0, or.length - 4)})` : ''
  and = and !== '(' ? `${and.substring(0, and.length - 5)})` : ''
  if (or !== '') and = `${and} OR ${or} )`
  return and
}

export function checkAggregate(h: readonly HistoryObj[], idThis: string): string {
  for (const x of h) {
    if (`\`${x.tab}\`.\`${x.columnName}\`` === idThis && x.type === 'Aggregate')
      return `${x.operator ?? ''}(${idThis})`
  }
  return ''
}

export function checkRename(h: readonly HistoryObj[], idThis: string): string {
  for (const x of h) {
    if (`\`${x.tab}\`.\`${x.columnName}\`` === idThis && x.type === 'Rename')
      return ` AS \`${x.renameTo ?? ''}\``
  }
  return ''
}

/**
 * DesignerHistory.queryFrom: the first table, LEFT JOINs along the relations (two passes), then the
 * remaining tables comma-joined. Also returns the from-array as phpMyAdmin leaves it (the history's
 * tables appended).
 */
export function queryFrom(
  s: QueryBuilderState,
  contr: readonly ContrRelation[],
): { from: string; fromArray: string[] } {
  const tArray = [...s.fromArray]
  for (const h of s.history) tArray.push(h.tab)
  let tabLeft = unique(tArray)
  const temp = tabLeft.shift()
  let quer = `\`${temp}\``
  let tabUsed: Array<string | undefined> = [temp]
  let tTabLeft: string[] = []
  let query = ''
  const constraintsAdded: string[] = []
  const join = (master: string, masterField: string, foreign: string, foreignField: string, key: string) => {
    if (constraintsAdded.includes(key)) {
      query += ` AND \`${master}\`.\`${masterField}\` = `
      query += `\`${foreign}\`.\`${foreignField}\` `
    } else {
      query += '\nLEFT JOIN '
      query += `\`${master}\` ON `
      query += `\`${foreign}\`.\`${foreignField}\` = `
      query += `\`${master}\`.\`${masterField}\` `
      constraintsAdded.push(key)
    }
    tTabLeft.push(master)
  }
  // the config keys are rawurlencoded (Common::getScriptContr)
  const rel = contr.map((r) => ({
    key: rawurlencode(r.constraint),
    parts: rawurlencode(r.masterTable).split('.'),
    field: rawurlencode(r.masterField),
    parts1: rawurlencode(r.foreignTable).split('.'),
    field1: rawurlencode(r.foreignField),
  }))
  for (let i = 0; i < 2; i++) {
    for (const r of rel) {
      const master = r.parts[1] ?? ''
      const foreign = r.parts1[1] ?? ''
      if (tabUsed.includes(master) && tabLeft.includes(foreign))
        join(master, r.field, foreign, r.field1, r.key)
    }
    tTabLeft = unique(tTabLeft)
    tabUsed = [...tabUsed, ...tTabLeft]
    tabLeft = removeArray(tTabLeft, tabLeft)
    tTabLeft = []
    for (const r of rel) {
      const master = r.parts[1] ?? ''
      const foreign = r.parts1[1] ?? ''
      if (tabLeft.includes(master) && tabUsed.includes(foreign))
        join(master, r.field, foreign, r.field1, r.key)
    }
    tTabLeft = unique(tTabLeft)
    tabUsed = [...tabUsed, ...tTabLeft]
    tabLeft = removeArray(tTabLeft, tabLeft)
    tTabLeft = []
  }
  for (const t of tabLeft) quer += ` , \`${t}\``
  return { from: quer + query, fromArray: tArray }
}

/** DesignerHistory.buildQuery: the SELECT shown in the Build Query dialog */
export function buildQuery(
  s: QueryBuilderState,
  contr: readonly ContrRelation[],
): { sql: string; fromArray: string[] } {
  let q = 'SELECT '
  if (s.selectField.length > 0) {
    for (const f of s.selectField) {
      const agg = checkAggregate(s.history, f)
      q += agg !== '' ? `${agg}${checkRename(s.history, f)}, ` : `${f}${checkRename(s.history, f)}, `
    }
    q = q.substring(0, q.length - 2)
  } else {
    q += '* '
  }
  const from = queryFrom(s, contr)
  q += `\nFROM ${from.from}`
  const where = queryWhere(s.history)
  if (where !== '') q += `\nWHERE ${where}`
  const groupBy = queryGroupBy(s.history)
  if (groupBy !== '') q += `\nGROUP BY ${groupBy}`
  const having = queryHaving(s.history)
  if (having !== '') q += `\nHAVING ${having}`
  const orderBy = queryOrderBy(s.history)
  if (orderBy !== '') q += `\nORDER BY ${orderBy}`
  return { sql: q, fromArray: from.fromArray }
}

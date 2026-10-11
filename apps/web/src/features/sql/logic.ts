/**
 * The SQL box's client-side rules, ported from phpMyAdmin's resources/js (no DOM, unit tested).
 */

/** Messages.strDoYouReally (empty when $cfg['Confirm'] is off). */
export const DO_YOU_REALLY = 'Do you really want to execute "%s"?'
/** Messages.strFormEmpty */
export const FORM_EMPTY = 'Missing value in the form!'

/**
 * Whether a query needs the "Do you really want to execute …?" confirmation.
 * pma: resources/js/modules/functions.ts::confirmQuery
 */
export function needsConfirmation(sqlQuery: string): boolean {
  const doConfirmRegExp0 = /^\s*DROP\s+(IF EXISTS\s+)?(TABLE|PROCEDURE)\s/i
  const doConfirmRegExp1 = /^\s*ALTER\s+TABLE\s+((`[^`]+`)|([A-Za-z0-9_$]+))\s+DROP\s/i
  const doConfirmRegExp2 = /^\s*DELETE\s+FROM\s/i
  const doConfirmRegExp3 = /^\s*TRUNCATE\s/i
  const doConfirmRegExp4 = /^(?=.*UPDATE\b)^((?!WHERE).)*$/i
  return (
    doConfirmRegExp0.test(sqlQuery) ||
    doConfirmRegExp1.test(sqlQuery) ||
    doConfirmRegExp2.test(sqlQuery) ||
    doConfirmRegExp3.test(sqlQuery) ||
    doConfirmRegExp4.test(sqlQuery)
  )
}

/**
 * The text of the confirmation: the query cut at 100 characters. `format` is the translated
 * Messages.strDoYouReally (filled with String.replace, like phpMyAdmin's JS).
 */
export function confirmationText(sqlQuery: string, format = DO_YOU_REALLY): string {
  const message = sqlQuery.length > 100 ? `${sqlQuery.substring(0, 100)}\n    ...` : sqlQuery
  return format.replace('%s', message)
}

/**
 * checkSqlQuery + confirmQuery: 'empty' → alert "Missing value in the form!", 'confirm' → ask,
 * 'ok' → submit. `confirm` false mirrors $cfg['Confirm'] = false (strDoYouReally is '').
 * pma: resources/js/modules/functions.ts::checkSqlQuery
 */
export function checkSqlQuery(sqlQuery: string, confirm: boolean): 'empty' | 'confirm' | 'ok' {
  if (sqlQuery.replace(/\s+/, '') === '') return 'empty'
  if (!confirm) return 'ok'
  return needsConfirmation(sqlQuery) ? 'confirm' : 'ok'
}

/**
 * The bind parameters found in a query, unique, in order of appearance.
 * pma: resources/js/modules/functions.ts::updateQueryParameters
 */
export function scanParameters(query: string): string[] {
  const all = query.match(/:[a-zA-Z0-9_]+/g)
  if (all === null) return []
  const parameters: string[] = []
  for (const p of all) if (!parameters.includes(p)) parameters.push(p)
  return parameters
}

/** Messages.strNoParam */
export const NO_PARAM = 'No parameters found!'

/** escapeBacktick (resources/js/modules/functions/escape.ts) */
export const escapeBacktick = (s: string) => s.replaceAll('`', '``')

export type SnippetType = 'selectall' | 'select' | 'insert' | 'update' | 'delete'

/**
 * The SELECT * / SELECT / INSERT / UPDATE / DELETE buttons: every column of the list is used.
 * `columns` are the option values (already back-quoted). Returns null when the list is empty.
 * pma: resources/js/sql.ts::insertQuery
 */
export function snippetQuery(type: SnippetType, table: string, columns: readonly string[]): string | null {
  if (columns.length === 0) return null
  const t = escapeBacktick(table)
  let columnsList = ''
  let valDis = ''
  let editDis = ''
  columns.forEach((c, i) => {
    const n = i + 1
    if (n > 1) {
      columnsList += ', '
      valDis += ','
      editDis += ','
    }
    columnsList += c
    valDis += `'[value-${n}]'`
    editDis += `${c}='[value-${n}]'`
  })
  switch (type) {
    case 'selectall':
      return `SELECT * FROM \`${t}\` WHERE 1`
    case 'select':
      return `SELECT ${columnsList} FROM \`${t}\` WHERE 1`
    case 'insert':
      return `INSERT INTO \`${t}\`(${columnsList}) VALUES (${valDis})`
    case 'update':
      return `UPDATE \`${t}\` SET ${editDis} WHERE 1`
    case 'delete':
      return `DELETE FROM \`${t}\` WHERE 0`
  }
}

/** The "<<" / Insert button and the double-click: the selected columns, comma separated. */
// pma: resources/js/sql.ts::insertValueQuery
export function insertValueText(selected: readonly string[]): string {
  return selected.join(', ')
}

/**
 * Whether the "Simulate query" button is offered.
 * pma: resources/js/sql.ts::handleSimulateQueryButton
 */
export function canSimulate(query: string): boolean {
  const updateRegExp =
    /^\s*UPDATE\b\s*(((`([^`]|``)+`)|([a-z0-9_$]+))\s*\.\s*)?((`([^`]|``)+`)|([a-z0-9_$]+))\s*\bSET\b/i
  const deleteRegExp =
    /^\s*DELETE\b\s*((((`([^`]|``)+`)|([a-z0-9_$]+))\s*\.\s*)?((`([^`]|``)+`)|([a-z0-9_$]+))\s*)?\bFROM\b/i
  return updateRegExp.test(query) || deleteRegExp.test(query)
}

/** Messages of the confirmations of the console. */
export const CONSOLE_REQUERY_CONFIRM = 'Execute this query again?'
export const CONSOLE_DELETE_BOOKMARK_CONFIRM = 'Do you really want to delete this bookmark?'

/**
 * localStorage key of "Get auto-saved query": `$('input[name="db"]').val()` is undefined at server
 * scope, which phpMyAdmin concatenates as the string "undefined".
 * pma: resources/js/sql.ts::getAutoSavedKey
 */
export function autoSavedKey(db: string, table: string): string {
  let key = db === '' ? 'undefined' : db
  if (table !== '') key += `.${table}`
  return `autoSavedSql_${key}`
}

/** Safe localStorage access (private windows, blocked storage). */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // storage unavailable: the feature degrades silently, like phpMyAdmin's cookie fallback failing
    }
  },
}

/** Sql.autoSave: an empty query is not saved. */
export function autoSave(db: string, table: string, query: string): void {
  if (query) storage.set(autoSavedKey(db, table), query)
}

export function getAutoSaved(db: string, table: string): string | null {
  return storage.get(autoSavedKey(db, table))
}

/**
 * "Show this query here again": the flag and `{db, table, query}` of the last Go.
 * pma: resources/js/sql.ts::showThisQuery, ::setShowThisQuery
 */
export function rememberShowThisQuery(enabled: boolean, db: string, table: string, query: string): void {
  storage.set('showThisQuery', enabled ? '1' : '0')
  if (enabled) {
    // JSON.stringify drops undefined: phpMyAdmin stores no db/table key at server scope
    const o: Record<string, string> = { query }
    if (db !== '') o.db = db
    if (table !== '') o.table = table
    storage.set('showThisQueryObject', JSON.stringify({ db: o.db, table: o.table, query }))
  }
}

export function restoreShowThisQuery(db: string, table: string): { checked: boolean; query: string | null } {
  const flag = storage.get('showThisQuery')
  if (flag !== '1') return { checked: false, query: null }
  let stored: { db?: string; table?: string; query?: string } = {}
  try {
    stored = JSON.parse(storage.get('showThisQueryObject') ?? '{}') as typeof stored
  } catch {
    stored = {}
  }
  const same = (stored.db ?? '') === db && (stored.table ?? '') === table
  return { checked: true, query: same ? (stored.query ?? null) : null }
}

import { Parser, SelectStatement } from '@bettermyadmin/sql-lexer'
import type { UiPrefsBackend } from './driver.ts'
import { phpJsonDecode, phpJsonEncode } from './php.ts'

/** pma: src/Table/UiProperty.php */
export type UiProperty = 'sorted_col' | 'col_order' | 'col_visib'

/**
 * `table_uiprefs.prefs`: `{"sorted_col": "`id` DESC", "col_order": [..], "col_visib": [..],
 * "CREATE_TIME": "..."}`, always in that key order (CREATE_TIME is the table's creation time when
 * col_order / col_visib were saved; a later ALTER invalidates them).
 */
export type UiPrefs = Record<string, unknown>

/**
 * The stored preferences as phpMyAdmin reads them since a2598a8d52: a non-string `sorted_col` /
 * `CREATE_TIME` and a column list that is not a list of scalars are dropped, list items become
 * ints, unknown keys go, and the keys come out in the fixed order of `toArray()`.
 * pma: src/Table/UiPreferences.php::fromArray / toArray
 */
export function normalizeUiPrefs(data: unknown): UiPrefs {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {}
  const d = data as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const ints = (v: unknown): number[] | null => {
    if (!Array.isArray(v)) return null
    const scalar = (x: unknown) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'
    return v.every(scalar) ? v.map(phpIntval) : null
  }
  const out: UiPrefs = {}
  const sorted = str(d.sorted_col)
  const order = ints(d.col_order)
  const visib = ints(d.col_visib)
  const created = str(d.CREATE_TIME)
  if (sorted !== null) out.sorted_col = sorted
  if (order !== null) out.col_order = order
  if (visib !== null) out.col_visib = visib
  if (created !== null) out.CREATE_TIME = created
  return out
}

export interface UiPrefsMessage {
  type: 'error'
  text: string
  detail?: string
  /** The msgid and its sprintf arguments when `text` was built from one, for translation. */
  msgid?: string
  args?: string[]
}

/** What the table object needs to know about the table itself (user connection). */
export interface UiPrefsTableInfo {
  /** Table::isView */
  isView(): Promise<boolean>
  /** Table::getStatusInfo('CREATE_TIME') — information_schema.TABLES.CREATE_TIME text or null */
  createTime(): Promise<string | null>
  /** Table::getColumns(false, false) — the bare column names */
  columns(): Promise<string[]>
}

/**
 * The UI preferences of one table for one user, cached in the session
 * (`$_SESSION['tmpval']['table_uiprefs'][server][db][table]`).
 *
 * pma: src/Table/Table.php::loadUiPrefs / getUiProp / setUiProp / removeUiProp / saveUiPrefsToDb
 */
export class TableUiPrefs {
  readonly backend: UiPrefsBackend | null
  readonly username: string
  readonly db: string
  readonly table: string
  readonly maxRows: number
  readonly info: UiPrefsTableInfo
  /** The session slot; `undefined` until loaded in this session. */
  readonly sessionSlot: { get(): UiPrefs | undefined; set(p: UiPrefs): void }
  #prefs: UiPrefs = {}

  constructor(opts: {
    backend: UiPrefsBackend | null
    username: string
    db: string
    table: string
    maxRows: number
    info: UiPrefsTableInfo
    sessionSlot: { get(): UiPrefs | undefined; set(p: UiPrefs): void }
  }) {
    this.backend = opts.backend
    this.username = opts.username
    this.db = opts.db
    this.table = opts.table
    this.maxRows = opts.maxRows
    this.info = opts.info
    this.sessionSlot = opts.sessionSlot
  }

  get prefs(): UiPrefs {
    return this.#prefs
  }

  /** pma: Table::loadUiPrefs */
  async #load(): Promise<void> {
    let p = this.sessionSlot.get()
    if (p === undefined) {
      p = await this.#fromDb()
      this.sessionSlot.set(p)
    }
    this.#prefs = normalizeUiPrefs(p)
  }

  async #ensure(): Promise<void> {
    if (Object.keys(this.#prefs).length === 0) await this.#load()
  }

  /** pma: Table::getUiPrefsFromDb */
  async #fromDb(): Promise<UiPrefs> {
    if (this.backend === null) return {}
    const raw = await this.backend.read(this.username, this.db, this.table)
    if (raw === null) return {}
    return normalizeUiPrefs(phpJsonDecode(raw))
  }

  async #save(): Promise<true | UiPrefsMessage> {
    this.#prefs = normalizeUiPrefs(this.#prefs)
    this.sessionSlot.set(this.#prefs)
    if (this.backend === null) return true
    const r = await this.backend.write(
      this.username,
      this.db,
      this.table,
      phpJsonEncode(this.#prefs),
      this.maxRows,
    )
    if (r === true) return true
    return {
      type: 'error',
      text: r.error,
      ...(r.msgid !== undefined ? { msgid: r.msgid, args: r.args ?? [] } : {}),
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
    }
  }

  /**
   * The property, or false when it is not set or no longer valid (in which case it is removed,
   * unless `readOnly`: read endpoints must not write).
   * pma: Table::getUiProp
   */
  async getUiProp(
    property: UiProperty,
    discardRememberedSort = false,
    readOnly = false,
  ): Promise<string | number[] | false> {
    await this.#ensure()
    if (property === 'sorted_col') {
      const v = this.#prefs.sorted_col
      if (v === undefined || v === null) return false
      if (!discardRememberedSort && (await this.#sortedColumnExists(String(v)))) return String(v)
      // remove the property, since it no longer exists in database
      if (!readOnly) await this.removeUiProp(property)
      return false
    }
    if ((await this.info.isView()) || this.#prefs[property] === undefined || this.#prefs[property] === null) {
      return false
    }
    // check if the table has not been modified
    if ((await this.info.createTime()) === (this.#prefs.CREATE_TIME ?? null)) {
      return this.#prefs[property] as number[]
    }
    // remove the property, since the table has been modified
    if (!readOnly) await this.removeUiProp(property)
    return false
  }

  /**
   * Every ORDER BY expression names a column of this table, unqualified or qualified by the table.
   * pma: Table::sortedColumnExists (6112f42f2f)
   */
  async #sortedColumnExists(sortedColumn: string): Promise<boolean> {
    const statement = new Parser(`SELECT * FROM t ORDER BY ${sortedColumn}`).statements[0]
    if (!(statement instanceof SelectStatement) || statement.order === null || statement.order.length === 0) {
      return false
    }
    const columns = await this.info.columns()
    return statement.order.every(
      (o) =>
        o.expr !== null &&
        o.expr.column !== null &&
        columns.includes(o.expr.column) &&
        (o.expr.table === null || o.expr.table === this.table) &&
        o.expr.database === null,
    )
  }

  /** pma: Table::setUiProp */
  async setUiProp(
    property: UiProperty,
    value: number[] | string,
    tableCreateTime: string | null = null,
  ): Promise<true | UiPrefsMessage> {
    await this.#ensure()
    if (!(await this.info.isView()) && (property === 'col_order' || property === 'col_visib')) {
      const curr = await this.info.createTime()
      if (tableCreateTime === null || tableCreateTime !== curr) {
        return {
          type: 'error',
          text: `Cannot save UI property "${property}". The changes made will not be persistent after you refresh this page. Please check if the table structure has been changed.`,
          msgid:
            'Cannot save UI property "%s". The changes made will not be persistent after you refresh this page. Please check if the table structure has been changed.',
          args: [property],
        }
      }
      this.#prefs.CREATE_TIME = curr
    }
    this.#prefs[property] = value
    return this.#save()
  }

  /** pma: Table::removeUiProp */
  async removeUiProp(property: UiProperty): Promise<true | UiPrefsMessage> {
    await this.#ensure()
    if (this.#prefs[property] !== undefined && this.#prefs[property] !== null) {
      delete this.#prefs[property]
      return this.#save()
    }
    return true
  }
}

/** PHP intval() for decoded JSON values. */
function phpIntval(x: unknown): number {
  if (typeof x === 'number') return Math.trunc(x)
  if (typeof x === 'boolean') return x ? 1 : 0
  if (typeof x === 'string') {
    const m = /^\s*[+-]?\d+/.exec(x)
    return m === null ? 0 : Number.parseInt(m[0], 10)
  }
  return 0
}

/**
 * The ColumnPreferencesController request: `col_order` / `col_visib` as comma lists.
 * pma: src/Controllers/Sql/ColumnPreferencesController.php
 */
export async function setColumnPreferences(
  prefs: TableUiPrefs,
  input: { colOrder?: string | undefined; colVisib?: string | undefined; tableCreateTime: string | null },
): Promise<true | false | UiPrefsMessage> {
  let status: true | false | UiPrefsMessage = false
  if (typeof input.colOrder === 'string') {
    status = await prefs.setUiProp(
      'col_order',
      input.colOrder.split(',').map(phpIntval),
      input.tableCreateTime,
    )
  }
  if (status === true && typeof input.colVisib === 'string') {
    status = await prefs.setUiProp(
      'col_visib',
      input.colVisib.split(',').map(phpIntval),
      input.tableCreateTime,
    )
  }
  return status
}

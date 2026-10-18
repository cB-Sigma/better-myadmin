/**
 * The results grid as data: what src/Display/Results.php (and the grid half of src/Sql.php)
 * computes before rendering its HTML — display parts, editability, unique conditions, sort links,
 * navigation, FK links, cell display, operations.
 *
 * pma: src/Display/Results.php, src/Sql.php::getQueryResponseForResultsReturned
 */

import type {
  DisplayParts,
  Field,
  GridCell,
  GridColumn,
  GridData,
  GridRow,
  GridView,
} from '@bettermyadmin/contracts'
import { type Translator, formatByteDown, formatNumber, sprintf } from '@bettermyadmin/i18n'
import {
  type MetaConn,
  type MimeInfo,
  type RelationParameters,
  type TableUiPrefs,
  getDisplayField,
  getForeignKeysData,
  getForeignersInternal,
  getMime,
} from '@bettermyadmin/metadata'
import {
  findTransformationPlugin,
  getTypeClass,
  parseTransformationOptions,
  printableBitValue,
  transformationNoWrap,
} from '@bettermyadmin/mysql-types'
import {
  type CellValue,
  type SelectExpression,
  type UniqueFieldMeta,
  backquote,
  getUniqueCondition,
  quoteString,
} from '@bettermyadmin/sql-gen'
import {
  DeleteStatement,
  Lexer,
  type OrderKeyword,
  Parser,
  SelectStatement,
  type StatementInfo,
  TokenType,
  UpdateStatement,
  getClause,
  replaceClause,
} from '@bettermyadmin/sql-lexer'
import type { AppConfig } from '../config.ts'
import type { Conn, RawRow, ResultSet } from '../db/connection.ts'
import { isRawBytes } from '../db/field-meta.ts'
import type { GridHookArgs } from '../query/pipeline.ts'
import { countRecords } from '../query/pipeline.ts'
import { signSql } from '../query/signature.ts'
import { TableReader } from '../table/read.ts'
import { mbLongerThan, mbStrlen, mbSubstr } from '../util/mb.ts'
import { defaultTransformation } from './default-transformations.ts'
import { runExternalTransformation } from './external.ts'
import { hasSpecialSchemaLink, specialSchemaLink } from './special-links.ts'

export interface GridEnv {
  cfg: AppConfig
  conn: Conn
  tr: Translator
  hmacSecret: string
  server: number
  view: Omit<GridView, 'possibleAsGeometry'>
  isBrowseDistinct: boolean
  /** the query the links act on (Results::$sqlQuery: after the remembered sort) */
  sqlQuery: string
  /** configuration storage, when available */
  meta: {
    rp: RelationParameters
    control: MetaConn | null
    uiPrefs: (db: string, table: string) => TableUiPrefs
  } | null
  /** Query\Cache ExactRows for countRecords */
  exactRows?: Map<string, number>
}

const SYSTEM_SCHEMAS = ['information_schema', 'performance_schema', 'mysql', 'sys']
/** pma: src/Utils/Utilities.php::isSystemSchema */
export const isSystemSchema = (db: string) => SYSTEM_SCHEMAS.includes(db.toLowerCase())

/** FieldMetadata as getUniqueCondition reads it. */
export function uniqueMeta(f: Field): UniqueFieldMeta {
  return {
    name: f.name,
    orgName: f.orgName,
    table: f.table,
    orgTable: f.orgTable,
    mappedType: f.mappedType as UniqueFieldMeta['mappedType'],
    charsetNr: f.charsetNr,
    length: f.length,
    isPrimaryKey: f.flags.primaryKey,
    isUniqueKey: f.flags.uniqueKey,
    isNumeric: f.flags.numeric,
    isBinary: f.flags.binary,
    isMappedTypeBit: f.mappedType === 'bit',
    isMappedTypeGeometry: f.mappedType === 'geometry',
  }
}

/** Raw row → the values UniqueCondition reads (bytes for binary-ish columns). */
export function rowValues(fields: readonly Field[], row: RawRow): CellValue[] {
  return row.map((v, i) => {
    if (v === null || v === undefined) return null
    // the Buffer is the bytes (not copied: a page of 1 MB BLOBs per row)
    return isRawBytes(fields[i]!) ? v : v.toString('utf8')
  })
}

/** The SELECT expressions of the statement (aliases → columns for the WHERE clause). */
export function selectExpressions(info: StatementInfo): SelectExpression[] {
  const st = info.statement
  if (!(st instanceof SelectStatement)) return []
  return (st.expr ?? []).map((e) => {
    const x = e as { alias?: string | null; column?: string | null }
    return {
      alias: x.alias ?? null,
      column: x.column ?? null,
      isCaseExpression: !('column' in (e as object)),
    }
  })
}

const isDateTime = (f: Field) => ['date', 'time', 'datetime', 'timestamp'].includes(f.mappedType)
const isType = (f: Field, t: 'blob' | 'string') => f.mappedType === t

interface SortExpression {
  table: string | null
  column: string | null
  direction: 'ASC' | 'DESC'
  expression: string
}

export interface FkRel {
  table: string
  field: string
  displayField: string
  db: string
}

/** Results::parseStringIntoTableAndColumn */
function parseTableAndColumn(name: string): { table: string | null; column: string | null } {
  const list = new Lexer(name).list
  const tok = (i: number) => list.tokens[i]
  const isName = (i: number) => {
    const t = tok(i)
    return (
      t !== undefined &&
      (t.type === TokenType.Symbol || t.type === TokenType.None) &&
      typeof t.value === 'string'
    )
  }
  if (list.count === 6 && isName(2) && isName(4)) {
    return { table: tok(2)!.value as string, column: tok(4)!.value as string }
  }
  if (list.count === 4 && isName(0) && isName(2)) {
    return { table: tok(0)!.value as string, column: tok(2)!.value as string }
  }
  if (list.count === 2 && isName(0)) return { table: null, column: tok(0)!.value as string }
  return { table: null, column: null }
}

/** pma: Util::unQuote with backquotes */
const unQuote = (s: string) => (s.length >= 2 && s.startsWith('`') && s.endsWith('`') ? s.slice(1, -1) : s)

/** pma: Util::pageselector (the page numbers only) */
export function pageSelectorPages(pageNow: number, nbTotalPage: number): number[] {
  const showAll = 200
  const sliceStart = 5
  const sliceEnd = 5
  const percent = 20
  const range = 10
  const increment = Math.floor(nbTotalPage / percent)
  const pageNowMinusRange = pageNow - range
  const pageNowPlusRange = pageNow + range
  let pages: number[] = []
  if (nbTotalPage < showAll) {
    for (let i = 1; i <= nbTotalPage; i++) pages.push(i)
  } else {
    for (let i = 1; i <= sliceStart; i++) pages.push(i)
    for (let i = nbTotalPage - sliceEnd; i <= nbTotalPage; i++) pages.push(i)
    let i = sliceStart
    const x = nbTotalPage - sliceEnd
    let metBoundary = false
    while (i <= x) {
      if (i >= pageNowMinusRange && i <= pageNowPlusRange) {
        i++
        metBoundary = true
      } else {
        i += increment
        if (i > pageNowMinusRange && !metBoundary) i = pageNowMinusRange
      }
      if (i <= 0 || i > x) continue
      pages.push(i)
    }
    i = pageNow
    let dist = 1
    while (i < x) {
      dist *= 2
      i = pageNow + dist
      if (i <= 0 || i > x) continue
      pages.push(i)
    }
    i = pageNow
    dist = 1
    while (i > 0) {
      dist *= 2
      i = pageNow - dist
      if (i <= 0 || i > x) continue
      pages.push(i)
    }
    pages = [...new Set(pages.sort((a, b) => a - b))]
  }
  if (pageNow > nbTotalPage) pages.push(pageNow)
  return pages
}

/** The text phpMyAdmin shows for a binary value when it is valid UTF-8 without control characters. */
function printableOrHex(bytes: Buffer): string {
  const text = bytes.toString('utf8')
  const valid = Buffer.from(text, 'utf8').equals(bytes)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: phpMyAdmin's test
  if (valid && !/[\x00-\x08\x0B\x0C\x0E-\x1F\x80-\x9F]/u.test(text)) return text
  return `0x${bytes.toString('hex')}`
}

/**
 * Builds the grid of one result set.
 * pma: Sql::getQueryResponseForResultsReturned (editable, display parts) + Results::getTable
 */
export async function buildGrid(
  env: GridEnv,
  a: GridHookArgs,
): Promise<{ grid: GridData; message?: string }> {
  const { cfg, conn, tr } = env
  const { set, info } = a
  const fields = set.fields as Field[]
  const db = a.input.db
  let table = a.input.table
  const reader = new TableReader(conn, {}, tr)
  const sign = (s: string) => signSql(s, env.hmacSecret, cfg.blowfish_secret)
  const statement = info.statement
  const f = info.flags
  const q = (s: string) => quoteString(s)

  // ---- Sql::getQueryResponseForResultsReturned: editable / display parts --------------------------
  let editable = false
  let hasUnique = false
  let displayParts: DisplayParts
  if (a.limited) {
    displayParts = {
      editLink: false,
      deleteLink: 'none',
      sortLink: true,
      navigation: false,
      bookmarkForm: true,
      textButton: true,
      printLink: true,
    }
  } else {
    // resultSetHasJustOneTable
    let justOneTable = true
    let prevTable = ''
    for (const m of fields) {
      if (m.table !== '' && prevTable !== '' && m.table !== prevTable) justOneTable = false
      if (m.table === '') continue
      prevTable = m.table
    }
    justOneTable = justOneTable && prevTable !== ''
    let updatableView = false
    if (statement instanceof SelectStatement) {
      const first = statement.expr?.[0] as { expr?: string | null } | undefined
      if (first?.expr === '*' && table !== '') {
        // Table::isUpdatableView
        updatableView =
          (await conn.value(
            `SELECT 1 FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ${q(db)} AND TABLE_NAME = ${q(table)} AND IS_UPDATABLE = 'YES'`,
            'grid.updatable-view',
          )) !== null
      }
      if (f.join || f.isSubQuery || info.selectTables.length !== 1) justOneTable = false
    }
    // resultSetContainsUniqueKey
    if (table !== '') {
      const columns = await reader.getColumns(db, table)
      const byName = new Map(columns.map((c) => [c.Field, c]))
      const names = new Set(fields.map((m) => m.name))
      for (const index of await reader.getIndexes(db, table)) {
        if (index.nonUnique) continue
        let found = 0
        for (const col of index.columns) {
          const c = byName.get(col.key)
          if (!names.has(col.key) && c !== undefined && !c.Extra.includes('INVISIBLE')) continue
          found++
        }
        if (found === index.columns.length) {
          hasUnique = true
          break
        }
      }
    }
    editable =
      (hasUnique || cfg.RowActionLinksWithoutUnique || updatableView) && justOneTable && !isSystemSchema(db)
    displayParts = editable
      ? {
          editLink: true,
          deleteLink: 'delete',
          sortLink: true,
          navigation: true,
          bookmarkForm: true,
          textButton: false,
          printLink: true,
        }
      : {
          editLink: false,
          deleteLink: 'none',
          sortLink: true,
          navigation: true,
          bookmarkForm: true,
          textButton: true,
          printLink: true,
        }
  }
  // pma: Sql::getQueryResponseForResultsReturned — `$table !== null ? getMessageIfMissingColumnIndex`:
  // MultiTableQueryController passes no table, so a query over several tables shows no notice
  const missingUnique: GridData['missingUnique'] =
    a.limited || (a.input.noTable === true && table === '')
      ? null
      : isSystemSchema(db) || !editable
        ? 'unavailable'
        : !hasUnique
          ? 'undesired'
          : null
  const view: GridView = { ...env.view, possibleAsGeometry: a.limited ? false : editable }
  // getOptionsBlock: Geometry is not offered for a non-editable result
  if (!view.possibleAsGeometry && view.geoOption === 'GEOM' && !a.limited) view.geoOption = 'WKT'

  // ---- Results::setDisplayPartsAndTotal ------------------------------------------------------------
  const isExplain = f.queryType === 'EXPLAIN'
  const isShow = f.queryType === 'SHOW'
  const sqlQuery = env.sqlQuery
  if (f.isCount || f.isAnalyse || f.isMaint || isExplain) {
    displayParts = {
      ...displayParts,
      editLink: false,
      deleteLink: 'none',
      sortLink: false,
      navigation: false,
      bookmarkForm: true,
      textButton: f.isMaint,
      printLink: true,
    }
  } else if (isShow) {
    const which =
      /^SHOW\s+(VARIABLES|(FULL\s+)?PROCESSLIST|STATUS|TABLE|GRANTS|CREATE|LOGS|DATABASES|FIELDS)/i.exec(
        sqlQuery,
      )
    const isProcessList = which?.[1]?.toUpperCase().includes('PROCESSLIST') === true
    displayParts = {
      editLink: false,
      deleteLink: isProcessList ? 'kill' : 'none',
      sortLink: false,
      navigation: false,
      bookmarkForm: true,
      textButton: true,
      printLink: true,
    }
  } else {
    let editLink = displayParts.editLink
    let deleteLink = displayParts.deleteLink
    let previousTable = ''
    for (const m of fields) {
      const isLink = editLink || deleteLink !== 'none' || displayParts.sortLink
      if (isLink && previousTable !== '' && m.table !== '' && m.table !== previousTable) {
        editLink = false
        deleteLink = 'none'
        break
      }
      if (m.table === '') continue
      previousTable = m.table
    }
    if (previousTable === '') {
      editLink = false
      deleteLink = 'none'
    }
    displayParts = { ...displayParts, editLink, deleteLink, textButton: true, printLink: true }
  }
  const unlimNumRows = a.limited ? 0 : a.unlimNumRows
  let total = 0
  const ctxForCount = {
    conn,
    cfg,
    executed: [],
    hmacSecret: env.hmacSecret,
    exactRows: env.exactRows ?? new Map(),
  }
  if (unlimNumRows > 0) total = unlimNumRows
  else if (displayParts.navigation || (displayParts.sortLink && db !== '' && table !== '')) {
    if (table !== '') total = await countRecords(ctxForCount, db, table, false)
  }
  if (f.isCount && a.numRows > 1) displayParts = { ...displayParts, navigation: true, sortLink: true }
  let tableIsView: boolean | null = null
  const isView = async () => {
    tableIsView ??= table === '' ? false : await reader.isView(db, table)
    return tableIsView
  }
  if ((displayParts.navigation || displayParts.sortLink) && unlimNumRows < 2 && !(await isView())) {
    displayParts = { ...displayParts, sortLink: false }
  }

  // ---- Results::getTable ----------------------------------------------------------------------------
  const hasParserError = info.parser.errors.length > 0
  const maxRows = view.maxRows
  let posNext = 0
  let posPrev = 0
  if (displayParts.navigation) {
    if (hasParserError) posNext = total
    else if (maxRows !== 'all') {
      posNext = view.pos + maxRows
      posPrev = Math.max(0, view.pos - maxRows)
    }
  }

  // sorting expressions (Results::extractSortingExpressions)
  const order = ((statement as { order?: OrderKeyword[] | null } | null)?.order ?? []) as OrderKeyword[]
  const sortExpressions: SortExpression[] = order.map((o) => {
    const expr = o.expr?.expr ?? ''
    if (String(Number.parseInt(expr, 10)) === expr && fields[Number(expr) - 1] !== undefined) {
      const fm = fields[Number(expr) - 1]!
      return {
        table: fm.table !== '' ? fm.table : null,
        column: fm.name,
        direction: o.type,
        expression: (fm.table !== '' ? `${backquote(fm.table)}.` : '') + backquote(fm.name),
      }
    }
    const tc = parseTableAndColumn(expr)
    return { table: tc.table, column: tc.column, direction: o.type, expression: expr }
  })

  // the sorted column message (Results::getSortedColumnMessage)
  let sortedColumnMessage = ''
  for (const e of sortExpressions) {
    if (e.expression === '') continue
    let sortTable: string
    let sortColumn: string
    if (!e.expression.includes('.')) {
      sortTable = table
      sortColumn = e.expression
    } else {
      ;[sortTable = '', sortColumn = ''] = e.expression.split('.')
    }
    sortTable = unQuote(sortTable)
    sortColumn = unQuote(sortColumn)
    const idx = fields.findIndex((m) => m.table === sortTable && m.name === sortColumn)
    if (idx === -1) continue
    const meta = fields[idx]!
    const nonPrintable = isType(meta, 'blob') || meta.mappedType === 'geometry' || meta.flags.binary
    const shownValue = (row: RawRow | undefined) => {
      const v = row?.[idx] ?? null
      if (nonPrintable) return nonPrintableLabel(tr, meta.mappedType, v)
      return row === undefined ? '' : v === null ? '' : v.toString('utf8')
    }
    const cut = (s: string) => `${Array.from(s).slice(0, cfg.LimitChars).join('')}...`.toUpperCase()
    const first = cut(shownValue(set.rows[0]))
    const last = cut(shownValue(set.rows[a.numRows > 0 ? a.numRows - 1 : 0]))
    sortedColumnMessage += ` [${sortColumn}: ${first} - ${last}]`
  }

  // the header message
  let message: string | undefined
  let viewHint = false
  if (displayParts.navigation) {
    const limit = (statement as { limit?: { offset: unknown; rowCount: unknown } | null } | null)?.limit
    let firstShown: number
    let lastShown: number
    if (
      (statement instanceof SelectStatement ||
        statement instanceof DeleteStatement ||
        statement instanceof UpdateStatement) &&
      limit !== null &&
      limit !== undefined
    ) {
      firstShown = Number(limit.offset)
      const rowCount = Number(limit.rowCount)
      lastShown = rowCount < total ? firstShown + rowCount - 1 : firstShown + total - 1
    } else if (maxRows === 'all' || posNext > total) {
      firstShown = view.pos
      lastShown = firstShown + a.numRows - 1
    } else {
      firstShown = view.pos
      lastShown = posNext - 1
    }
    viewHint = total === -1 && (await isView())
    const took = sprintf(`${tr.gettext('Query took %01.4f seconds.')})`, a.queryTime)
    if (viewHint) {
      message = `${sprintf(tr.gettext('Showing rows %1s - %2s'), firstShown, '...')} (${took}${sortedColumnMessage}`
    } else {
      const totalText =
        unlimNumRows !== total
          ? sprintf(
              tr.gettext('%1$s total, %2$s in query'),
              formatNumber(tr, total, 0),
              formatNumber(tr, unlimNumRows, 0),
            )
          : sprintf(tr.gettext('%s total'), formatNumber(tr, total, 0))
      message = `${sprintf(tr.gettext('Showing rows %1s - %2s'), firstShown, lastShown)} (${totalText}, ${took}${sortedColumnMessage}`
    }
  } else if (!a.limited) {
    const done = tr.gettext('Your SQL query has been executed successfully.')
    message =
      a.queryTime > 0
        ? `${done} (${sprintf(`${tr.gettext('Query took %01.4f seconds.')})`, a.queryTime)}`
        : done
  }

  if (table === '' && f.queryType === 'SELECT') table = fields[0]?.table ?? ''

  // Results::isSelect
  const st = statement as { from?: Array<{ table?: string | null; database?: string | null }> | null } | null
  const isSelect =
    !(f.isCount || f.isExport || f.isFunc || f.isAnalyse) &&
    f.selectFrom &&
    (statement instanceof SelectStatement || statement instanceof DeleteStatement) &&
    Array.isArray(st?.from) &&
    st.from.length === 1 &&
    (st.from[0]?.table ?? '') !== ''

  // sort by key
  let sortByKey: GridData['sortByKey'] = null
  if (displayParts.sortLink && statement !== null && info.parser.list !== null && isSelect) {
    const unsorted = replaceClause(statement, info.parser.list, 'ORDER BY', '')
    const indexes = table === '' ? [] : await reader.getIndexes(db, table)
    if (indexes.length > 0) {
      const localOrder = sortExpressions.map((e) => `${e.expression} ${e.direction}`).join(', ')
      let used = false
      const options: NonNullable<GridData['sortByKey']>['options'] = []
      const m = /^(.*)(\s(LIMIT (.*)|PROCEDURE (.*)|FOR UPDATE|LOCK IN SHARE MODE))/is.exec(unsorted)
      const head = m === null ? unsorted : m[1]!
      const tail = m === null ? '' : m[2]!
      for (const index of indexes) {
        const asc = index.columns.map((c) => `${backquote(c.name)} ASC`).join(', ')
        const desc = index.columns.map((c) => `${backquote(c.name)} DESC`).join(', ')
        used = used || localOrder === asc || localOrder === desc
        options.push({
          label: `${index.name} (ASC)`,
          sql: `${head} ORDER BY ${asc}${tail}`,
          selected: localOrder === asc,
        })
        options.push({
          label: `${index.name} (DESC)`,
          sql: `${head} ORDER BY ${desc}${tail}`,
          selected: localOrder === desc,
        })
      }
      options.push({ label: tr.gettext('None'), sql: unsorted, selected: !used })
      sortByKey = { options, maxRows }
    }
  }

  // navigation (Results::getTableNavigation)
  let navigation: GridData['navigation'] = null
  const ownLimit = (statement as { limit?: unknown } | null)?.limit
  if (
    displayParts.navigation &&
    !hasParserError &&
    statement !== null &&
    (ownLimit === null || ownLimit === undefined)
  ) {
    const isShowingAll = maxRows === 'all'
    const mr = maxRows === 'all' ? 0 : maxRows
    let pages: number[] = []
    let pageNow = 1
    let totalPages = 1
    if (!isShowingAll) {
      pageNow = Math.floor(view.pos / mr) + 1
      totalPages = Math.ceil(unlimNumRows / mr)
      if (totalPages > 1) pages = pageSelectorPages(pageNow, totalPages)
    }
    const isExactCount = unlimNumRows < cfg.MaxExactCount || isShowingAll || a.numRows < mr
    const isLastPage =
      unlimNumRows !== -1 &&
      (isShowingAll || (isExactCount && view.pos + mr >= unlimNumRows) || a.numRows < mr)
    navigation = {
      posNext,
      posPrevious: posPrev,
      posLast: isShowingAll ? 0 : (Math.ceil(unlimNumRows / mr) - 1) * mr,
      isShowingAll,
      isLastPage,
      isLastPageKnown: unlimNumRows !== -1,
      endAllowed: view.pos + mr < unlimNumRows && a.numRows >= mr,
      hasShowAll: cfg.ShowAll || unlimNumRows <= 500,
      showAllMaxRows: isShowingAll ? cfg.MaxRows : 'all',
      pages,
      pageNow,
      totalPages,
    }
  }

  // FK map (Results::getForeignKeyRelatedTables)
  const map = table === '' ? new Map<string, FkRel>() : await foreignMap(reader, env.meta, db, table)
  if (table !== '' && env.isBrowseDistinct && fields[1] !== undefined) {
    map.set(fields[1].name, { table, field: fields[1].name, displayField: '', db })
  }

  // highlighted columns (WHERE identifiers)
  const highlight = new Set<string>()
  if (
    (statement instanceof SelectStatement ||
      statement instanceof DeleteStatement ||
      statement instanceof UpdateStatement) &&
    Array.isArray((statement as { where?: unknown }).where)
  ) {
    for (const cond of (statement as unknown as { where: Array<{ identifiers: unknown[] }> }).where) {
      for (const id of cond.identifiers) highlight.add(String(id))
    }
  }
  const isCondition = (name: string) => highlight.has(name) || highlight.has(backquote(name))

  // comments (Results::getTableCommentsArray)
  const comments = new Map<string, Record<string, string>>()
  if (
    cfg.ShowBrowseComments &&
    (statement instanceof SelectStatement || statement instanceof DeleteStatement)
  ) {
    for (const from of st?.from ?? []) {
      const ft = from.table ?? ''
      if (ft === '') continue
      const cols = await reader.getColumns(from.database ?? db, ft)
      const out: Record<string, string> = {}
      for (const c of cols) if (c.Comment !== '') out[c.Field] = c.Comment
      comments.set(ft, out)
    }
  }

  // column order / visibility (Results::getColumnParams)
  let colOrder: number[] | null = null
  let colVisib: number[] | null = null
  let columnOrder: GridData['columnOrder'] = null
  if (isSelect && env.meta !== null && table !== '') {
    const ui = env.meta.uiPrefs(db, table)
    const o = await ui.getUiProp('col_order')
    if (Array.isArray(o)) {
      colOrder = o
      if (o.some((v) => v >= fields.length)) await ui.removeUiProp('col_order')
      if (o.length !== fields.length) {
        await ui.removeUiProp('col_order')
        colOrder = null
      }
    }
    const v = await ui.getUiProp('col_visib')
    if (Array.isArray(v)) {
      colVisib = v
      if (v.length !== fields.length) {
        await ui.removeUiProp('col_visib')
        colVisib = null
      }
    }
    const viewTable = await isView()
    columnOrder = {
      order: colOrder,
      visibility: colVisib,
      isView: viewTable,
      createTime: viewTable ? null : ((await reader.getStatus(db, table))?.Create_time ?? null),
    }
  }

  // headers (Results::getTableHeadersForColumns + getOrderLinkAndSortedHeaderHtml)
  const sortable = displayParts.sortLink && !a.limited && statement !== null && info.parser.list !== null
  const columns: GridColumn[] = []
  for (let j = 0; j < fields.length; j++) {
    const i = colOrder?.[j] ?? j
    const meta = fields[i]!
    let sort: GridColumn['sort'] = null
    if (sortable) sort = sortLinks(env, info, sortExpressions, meta, cfg.Order, sign)
    columns.push({
      index: i,
      name: meta.name,
      comment: comments.get(meta.table)?.[meta.name] ?? null,
      numeric: meta.mappedType === 'real' || meta.mappedType === 'bit' || meta.mappedType === 'int',
      condition: isCondition(meta.name),
      hidden: colVisib !== null && colVisib[j] !== undefined && !colVisib[j],
      sort,
      dataType: meta.mappedType,
      decimals: meta.decimals,
    })
  }

  // body (Results::getTableBody / getRowValues)
  let gridEdit: GridData['gridEdit'] = 'double-click'
  if (a.limited || !editable || cfg.GridEditing === 'disabled') gridEdit = 'disabled'
  else if (cfg.GridEditing === 'click') gridEdit = 'click'
  const expressions = selectExpressions(info)
  const metas = fields.map(uniqueMeta)
  const urlSqlQuery = urlSql(info, sqlQuery)
  const fkCache = new Map<string, string | null>()
  const mediaTypes = await mediaTypeMap(env, fields, isShow ? sqlQuery : null)
  const rows: GridRow[] = []
  const hasLinks = displayParts.editLink || displayParts.deleteLink !== 'none'
  for (const raw of a.limited ? [] : set.rows) {
    const values = rowValues(fields, raw)
    const uc = getUniqueCondition(metas, values, { restrictToTable: table, expressions })
    const row: GridRow = {
      where: uc.condition,
      whereSig: sign(uc.condition),
      unique: uc.isClauseUnique,
      cond: uc.conditionArray,
      cells: [],
    }
    if (hasLinks && displayParts.deleteLink === 'delete') {
      const del = `DELETE FROM ${backquote(table)} WHERE ${uc.condition}${uc.isClauseUnique ? '' : ' LIMIT 1'}`
      row.del = {
        sql: del,
        sig: sign(del),
        confirm: `DELETE FROM ${table} WHERE ${uc.condition}${uc.isClauseUnique ? '' : ' LIMIT 1'}`,
      }
    } else if (hasLinks && displayParts.deleteLink === 'kill') {
      const id = Number.parseInt(raw[0]?.toString('utf8') ?? '0', 10) || 0
      // DatabaseInterface::getKillQuery
      const kill = `KILL ${id};`
      row.kill = { sql: kill, sig: sign(kill) }
    }
    let rowInfo: Map<string, string> | undefined
    // the where clause of each column's own table (download links)
    const whereByTable = new Map<string, string>([[table, uc.condition]])
    for (let j = 0; j < fields.length; j++) {
      const i = colOrder?.[j] ?? j
      const meta = fields[i]!
      if (!whereByTable.has(meta.orgTable)) {
        whereByTable.set(
          meta.orgTable,
          getUniqueCondition(metas, values, { restrictToTable: meta.orgTable, expressions }).condition,
        )
      }
      const cell = await cellOf(env, {
        meta,
        raw: raw[i] ?? null,
        gridEdit,
        map,
        condition: isCondition(meta.name),
        info,
        where: whereByTable.get(meta.orgTable) ?? '',
        db,
        fkCache,
        view,
        sign,
        urlSqlQuery,
      })
      const where = whereByTable.get(meta.orgTable) ?? ''
      const cellRaw = raw[i] ?? null
      const stored = mediaTypes.get(`${meta.db}.${meta.orgTable}.${meta.orgName}`)
      // Results::getRowValues: the syntax highlighting of predefined columns wins over a stored one
      const builtIn =
        cellRaw === null || env.view.hideTransformation
          ? null
          : defaultTransformation(env.meta?.rp ?? null, db, meta.orgTable, meta.orgName)
      const predefined = builtIn !== null && cellRaw!.toString('utf8').trim() !== '' ? builtIn : null
      const m =
        predefined !== null
          ? {
              column_name: meta.orgName,
              mimetype: predefined.mimetype,
              transformation: predefined.transformation,
              transformation_options: stored?.transformation_options ?? '',
              input_transformation: '',
              input_transformation_options: '',
            }
          : stored
      const shown = applyTransformation(cell, cellRaw, meta, m, where, sign, cfg)
      // SpecialSchemaLinks: predefined columns of mysql / information_schema become links
      let sl: ReturnType<typeof specialSchemaLink> = null
      if (cellRaw !== null && shown.k !== 'null' && hasSpecialSchemaLink(db, meta.orgTable, meta.orgName)) {
        rowInfo ??= specialRowInfo(fields, raw)
        sl = specialSchemaLink(cfg, db, meta.orgTable, meta.orgName, cellRaw.toString('utf8'), rowInfo)
      }
      row.cells.push(
        sl === null
          ? shown
          : {
              k: 'v',
              cls: `${cell.cls} Text_Plain transformed`,
              t: cellRaw!.toString('utf8'),
              sl,
            },
      )
    }
    rows.push(row)
  }

  // Results::isClauseUnique (last row)
  let clauseIsUnique = false
  if (displayParts.deleteLink === 'delete' && set.rows.length > 0) {
    const last = set.rows[a.numRows > 0 ? a.numRows - 1 : 0]
    if (last !== undefined) {
      clauseIsUnique = getUniqueCondition(metas, rowValues(fields, last), { expressions }).isClauseUnique
    }
  }

  // Results::getResultsOperations
  let operations: GridData['operations'] = null
  if (!a.limited) {
    let exp: NonNullable<GridData['operations']>['export'] = null
    let gis = false
    if (f.queryType === 'SELECT' && !f.isProcedure) {
      let exportTable = table
      const rawQuery = info.selectTables.length === 0
      if (!rawQuery && exportTable === '' && db !== '') {
        exportTable = (await conn.value('SHOW TABLES', 'grid.first-table')) ?? ''
      }
      exp = { table: exportTable, singleTable: info.selectTables.length === 1, rawQuery, unlimNumRows }
      gis = fields.some((m) => m.mappedType === 'geometry')
    }
    operations = { print: displayParts.printLink, procedure: f.isProcedure, export: exp, gis }
  }

  const rp = env.meta?.rp
  const grid: GridData = {
    db,
    table,
    sql: sqlQuery,
    sig: sign(sqlQuery),
    // getUrlSqlQuery: the row links of a long SELECT carry only its SELECT list and FROM clause
    ...(urlSqlQuery !== sqlQuery ? { urlSql: { sql: urlSqlQuery, sig: sign(urlSqlQuery) } } : {}),
    displayParts,
    editable,
    missingUnique,
    gridEdit,
    limited: a.limited,
    view,
    numRows: a.numRows,
    unlimNumRows,
    total,
    viewHint,
    navigation,
    sortByKey,
    columns,
    rows,
    clauseIsUnique,
    hasExportButton: displayParts.deleteLink === 'delete' && f.queryType === 'SELECT',
    operations,
    relationOptions: rp !== undefined && rp.relationFeature !== null && rp.displayFeature !== null,
    columnOrder,
    // getFullOrPartialTextButtonOrLink, placed by getFieldVisibilityParams / getColumnAtRightSide
    textToggle: a.limited
      ? null
      : view.pftext === 'F'
        ? { pftext: 'P', title: 'Partial texts' }
        : { pftext: 'F', title: 'Full texts' },
    settings: {
      RowActionLinks: cfg.RowActionLinks,
      RowActionType: cfg.RowActionType,
      LimitChars: cfg.LimitChars,
      SaveCellsAtOnce: cfg.SaveCellsAtOnce,
      BrowsePointerEnable: cfg.BrowsePointerEnable,
      BrowseMarkerEnable: cfg.BrowseMarkerEnable,
      TableNavigationLinksMode: cfg.TableNavigationLinksMode,
      InitialSlidersState: cfg.InitialSlidersState,
      Confirm: cfg.Confirm,
      MaxRows: cfg.MaxRows,
      ShowAll: cfg.ShowAll,
      AllowSharedBookmarks: cfg.AllowSharedBookmarks,
    },
  }
  return message === undefined ? { grid } : { grid, message }
}

/**
 * The relations of a table: pmadb internal relations, then FOREIGN KEYs (which win), with the
 * display field of each foreign table.
 * pma: Results::getForeignKeyRelatedTables
 */
export async function foreignMap(
  reader: TableReader,
  meta: GridEnv['meta'],
  db: string,
  table: string,
): Promise<Map<string, FkRel>> {
  const map = new Map<string, FkRel>()
  const rp = meta?.rp
  const control = meta?.control ?? null
  const displayField = (fdb: string, ftable: string) =>
    rp === undefined
      ? fallbackDisplayField(reader, fdb, ftable)
      : getDisplayField(control, rp, fdb, ftable, async () =>
          (await reader.getColumns(fdb, ftable)).map((c) => ({ field: c.Field, type: c.Type })),
        )
  if (rp !== undefined) {
    for (const [master, rel] of Object.entries(await getForeignersInternal(control, rp, db, table))) {
      map.set(master, {
        table: rel.foreign_table,
        field: rel.foreign_field,
        displayField: await displayField(rel.foreign_db, rel.foreign_table),
        db: rel.foreign_db,
      })
    }
  }
  for (const key of getForeignKeysData(await reader.showCreate(db, table))) {
    for (const [i, one] of key.indexList.entries()) {
      const fdb = key.refDbName ?? db
      map.set(one, {
        table: key.refTableName ?? '',
        field: key.refIndexList[i] ?? '',
        displayField: await displayField(fdb, key.refTableName ?? ''),
        db: fdb,
      })
    }
  }
  return map
}

/** Relation::getDisplayField without configuration storage: the first CHAR-class column. */
async function fallbackDisplayField(reader: TableReader, db: string, table: string): Promise<string> {
  if (db === 'information_schema') {
    if (table === 'CHARACTER_SETS') return 'DESCRIPTION'
    if (table === 'TABLES') return 'TABLE_COMMENT'
  }
  for (const c of await reader.getColumns(db, table)) {
    if (getTypeClass(c.Type.replace(/(\(.*)|(\s\/.*)/s, '')) === 'CHAR') return c.Field
  }
  return ''
}

/** Results::getUrlSqlQuery: the SELECT list + FROM only, for queries of 200 characters or more. */
function urlSql(info: StatementInfo, sqlQuery: string): string {
  if (
    info.flags.queryType !== 'SELECT' ||
    !mbLongerThan(sqlQuery, 199) ||
    info.statement === null ||
    info.parser.list === null
  ) {
    return sqlQuery
  }
  let query = `SELECT ${getClause(info.statement, info.parser.list, 'SELECT')}`
  const from = getClause(info.statement, info.parser.list, 'FROM')
  if (from !== '') query += ` FROM ${from}`
  return query
}

/** `[BLOB - 12 B]`-style text (Results::handleNonPrintableContents without content). */
function nonPrintableLabel(tr: Translator, category: string, content: Buffer | null): string {
  if (content === null) return `[${category} - NULL]`
  const [v, u] = formatByteDown(tr, content.length, 3, 1) ?? ['0', '']
  return `[${category} - ${v} ${u}]`
}

/** Results::getSingleAndMultiSortUrls + getSortOrderHiddenInputs */
function sortLinks(
  env: GridEnv,
  info: StatementInfo,
  sortExpressions: readonly SortExpression[],
  meta: Field,
  orderCfg: string,
  sign: (s: string) => string,
): NonNullable<GridColumn['sort']> {
  const currentTable = meta.table !== '' && meta.orgName === meta.name ? meta.table : ''
  const currentColumn = meta.name
  const isInSort = sortExpressions.some((e) =>
    e.column === null
      ? false
      : e.table !== null
        ? currentTable === e.table && currentColumn === e.column
        : currentColumn === e.column,
  )
  const exprs = [...sortExpressions]
  if (exprs.length === 0 || !isInSort) {
    const tableName = currentTable === '' ? '' : `${backquote(currentTable)}.`
    const direction: 'ASC' | 'DESC' =
      orderCfg === 'SMART' ? (isDateTime(meta) ? 'DESC' : 'ASC') : orderCfg === 'DESC' ? 'DESC' : 'ASC'
    exprs.push({
      table: currentTable === '' ? null : currentTable,
      column: currentColumn,
      direction,
      expression: tableName + backquote(currentColumn),
    })
  }
  const flip = (d: 'ASC' | 'DESC') => (d === 'ASC' ? 'DESC' : 'ASC')
  let single = ''
  const parts: string[] = []
  let dir: 'ASC' | 'DESC' | null = null
  let position: number | null = null
  exprs.forEach((e, index) => {
    let sortOrder = index === 0 ? 'ORDER BY ' : ''
    let tableOfColumn = currentTable
    let column = ''
    if (e.column === null) sortOrder += e.expression
    else if (e.table !== null) {
      column = e.column
      sortOrder += `${backquote(e.table)}.${backquote(column)}`
      tableOfColumn = e.table
    } else {
      column = e.column
      sortOrder += backquote(column)
    }
    if (currentColumn === column && currentTable === tableOfColumn) {
      single = `ORDER BY ${currentTable !== '' ? `${backquote(currentTable)}.` : ''}${backquote(currentColumn)} ${
        isInSort ? flip(e.direction) : e.direction
      }`
    }
    sortOrder += ' '
    if (currentColumn === column && currentTable === tableOfColumn && isInSort) {
      dir = e.direction
      position = index + 1
      sortOrder += flip(e.direction)
    } else sortOrder += e.direction
    parts.push(sortOrder)
  })
  const st = info.statement!
  const list = info.parser.list!
  const singleSql = replaceClause(st, list, single)
  const multiSql = replaceClause(st, list, parts.join(', '))
  // url-remove-order: the multi-sort query without this column
  let removeSql = multiSql
  let remaining: number | null = null
  const first = new Parser(
    multiSql,
    env.conn.serverInfo !== null ? { context: env.conn.serverInfo.context } : {},
  ).statements[0]
  if (first instanceof SelectStatement) {
    const orders = (first.order ?? []) as OrderKeyword[]
    first.order = orders.filter((o) => o.expr?.column !== currentColumn) as typeof first.order
    remaining = (first.order ?? []).length
    removeSql = first.build()
  }
  return {
    single: { sql: singleSql, sig: sign(singleSql) },
    add: { sql: multiSql, sig: sign(multiSql) },
    remove: { sql: removeSql, sig: sign(removeSql), discard: remaining === 0 },
    dir,
    position,
  }
}

interface CellArgs {
  meta: Field
  raw: Buffer | null
  gridEdit: GridData['gridEdit']
  map: Map<string, FkRel>
  condition: boolean
  info: StatementInfo
  where: string
  db: string
  fkCache: Map<string, string | null>
  view: GridView
  sign: (s: string) => string
  urlSqlQuery: string
}

/** Results::getRowValues for one cell (numeric / geometry / non-numeric branches). */
async function cellOf(env: GridEnv, c: CellArgs): Promise<GridCell> {
  const { cfg, tr } = env
  const { meta, view } = c
  const classes = ['data']
  if (meta.orgTable !== '' && c.gridEdit !== 'disabled') {
    classes.push(c.gridEdit === 'click' ? 'grid_edit click1' : 'grid_edit click2')
  }
  if (meta.flags.notNull) classes.push('not_null')
  if (c.map.has(meta.name)) classes.push('relation')
  if (meta.mappedType === 'timestamp' || meta.mappedType === 'datetime') classes.push('datetimefield')
  else if (meta.mappedType === 'date') classes.push('datefield')
  else if (meta.mappedType === 'time') classes.push('timefield')
  else if (meta.mappedType === 'string') classes.push('text')
  let cls = classes.join(' ')

  const partial = (s: string) =>
    view.pftext === 'P' && mbLongerThan(s, cfg.LimitChars) ? `${mbSubstr(s, cfg.LimitChars)}...` : s
  // Results::addClass
  const addClass = (base: string, nowrap: string, truncated = false) => {
    const out = [base, nowrap].filter((x) => x !== '')
    if (c.condition) out.push('condition')
    if (truncated) out.push('truncated')
    if (meta.flags.enum) out.push('enum')
    if (meta.flags.set) out.push('set')
    if (meta.mappedType === 'bit') out.push('bit')
    if (meta.flags.binary) out.push('hex')
    return out.join(' ')
  }
  const nullCell = (base: string): GridCell => ({ k: 'null', cls: `${addClass(base, '')} null` })
  const emptyCell = (base: string): GridCell => ({ k: 'empty', cls: addClass(base, 'text-nowrap') })
  const valueDisplay = (base: string, t: string, extra: Partial<GridCell> = {}): GridCell => ({
    k: 'v',
    cls: `text-start ${base}${c.condition ? ' condition' : ''}`,
    t,
    ...extra,
  })
  const download = (): GridCell['dl'] =>
    c.db === '' || meta.orgTable === ''
      ? undefined
      : { where: c.where, sig: c.sign(c.where), key: meta.orgName, table: meta.orgTable }

  if (meta.flags.numeric) {
    const base = `text-end ${cls}`
    if (c.raw === null) return nullCell(base)
    const v = c.raw.toString('utf8')
    if (v === '') return emptyCell(base)
    return rowData(env, c, base, 'text-nowrap', v, v, () => ` = ${v}`, false, '', addClass)
  }
  if (meta.mappedType === 'geometry') {
    cls = cls.replace('grid_edit', '')
    if (c.raw === null) return nullCell(cls)
    if (c.raw.length === 0) return emptyCell(cls)
    const wkbBytes = c.raw
    if (view.geoOption === 'GEOM') {
      return valueDisplay(cls, nonPrintableLabel(tr, 'GEOMETRY', c.raw), { dl: download() })
    }
    if (view.geoOption === 'WKT') {
      const version = env.conn.serverInfo?.versionInt ?? 80000
      const axis =
        version >= 80001 && env.conn.serverInfo?.isMariaDb !== true ? ", 'axis-order=long-lat'" : ''
      const wkt =
        (await env.conn
          .value(`SELECT ST_ASTEXT(x'${c.raw.toString('hex')}'${axis})`, 'grid.wkt')
          .catch(() => null)) ?? ''
      const shown = partial(wkt)
      return rowData(
        env,
        c,
        cls,
        '',
        wkt,
        shown,
        () => ` = ${wkbBytes.toString('latin1')}`,
        shown !== wkt,
        '',
        addClass,
      )
    }
    if (view.displayBinary) {
      const wkb = c.raw.toString('hex').slice(8)
      const shown = partial(wkb)
      return rowData(
        env,
        c,
        cls,
        '',
        wkb,
        shown,
        () => ` = ${wkbBytes.toString('latin1')}`,
        shown !== wkb,
        '',
        addClass,
      )
    }
    return valueDisplay(cls, nonPrintableLabel(tr, 'BINARY', c.raw), { dl: download() })
  }

  // getDataCellForNonNumericColumns
  const isBlob = meta.mappedType === 'blob'
  const protect = cfg.ProtectBinary
  if (
    meta.flags.binary &&
    (protect === 'all' || (protect === 'noblob' && !isBlob) || (protect === 'blob' && isBlob))
  ) {
    cls = cls.replace('grid_edit', '')
  }
  if (c.raw === null) return nullCell(cls)
  if (c.raw.length === 0) return emptyCell(cls)
  const raw = c.raw
  // the text of the value, decoded only when shown (a BLOB shows its placeholder)
  const decode = () => {
    const text = raw.toString('utf8')
    if (meta.flags.binary) return { text, column: text, truncated: false, originalLength: 0 }
    const column = partial(text)
    return { text, column, truncated: column !== text, originalLength: mbStrlen(text) }
  }
  if (meta.mappedType === 'bit') {
    const { text, column, truncated, originalLength } = decode()
    let n = 0n
    for (const b of c.raw) n = (n << 8n) | BigInt(b)
    const shown = printableBitValue(n, meta.length)
    return rowData(
      env,
      c,
      cls,
      'pre_wrap',
      column,
      shown,
      () => ` = ${quoteString(text)}`,
      truncated,
      String(originalLength),
      addClass,
    )
  }
  if (meta.flags.binary && !c.info.flags.isAnalyse) {
    const category = isType(meta, 'string') ? 'BINARY' : 'BLOB'
    let shown = nonPrintableLabel(tr, category, c.raw)
    let isTruncated = false
    if ((view.displayBinary && isType(meta, 'string')) || (view.displayBlob && isType(meta, 'blob'))) {
      const pre = printableOrHex(c.raw)
      shown = partial(pre)
      isTruncated = shown !== pre
    }
    let finalCls = addClass(cls, '', isTruncated)
    // grid editing is disabled while the BINARY/BLOB placeholder is shown
    if (shown.toUpperCase().includes(category)) finalCls = finalCls.replace('grid_edit', '')
    return valueDisplay(finalCls, shown, { dl: download() })
  }
  const nowrap = isDateTime(meta) ? 'text-nowrap' : 'pre_wrap'
  const { text, column, truncated, originalLength } = decode()
  return rowData(
    env,
    c,
    cls,
    nowrap,
    column,
    column,
    () => ` = ${quoteString(text)}`,
    truncated,
    truncated ? String(originalLength) : '',
    addClass,
  )
}

/** Results::getRowData: FK links (key / display column) and the default output. */
async function rowData(
  env: GridEnv,
  c: CellArgs,
  base: string,
  nowrap: string,
  data: string,
  displayed: string,
  /** ` = <value>` (built only for a relation: a 500 KB text would be quoted per cell) */
  comparison: () => string,
  truncated: boolean,
  originalLength: string,
  addClass: (base: string, nowrap: string, truncated?: boolean) => string,
): Promise<GridCell> {
  const cell: GridCell = { k: 'v', cls: addClass(base, nowrap, truncated), t: displayed }
  if (originalLength !== '' && truncated) cell.ol = Number(originalLength)
  // the real column behind an alias
  let name = c.meta.name
  const st = c.info.statement
  if (st instanceof SelectStatement) {
    for (const e of st.expr ?? []) {
      const x = e as { alias?: string | null; column?: string | null }
      if (
        x.alias === null ||
        x.alias === undefined ||
        x.alias === '' ||
        x.column === null ||
        x.column === undefined ||
        x.column === ''
      )
        continue
      if (name.toLowerCase() !== x.alias.toLowerCase()) continue
      name = x.column
    }
  }
  const rel = c.map.get(name)
  if (rel === undefined) return cell
  const whereComparison = comparison()
  let dispval: string | null = ''
  if (rel.displayField !== '') {
    const sql = `SELECT ${backquote(rel.displayField)} FROM ${backquote(rel.db)}.${backquote(rel.table)} WHERE ${backquote(rel.field)}${whereComparison} LIMIT 1`
    if (c.fkCache.has(sql)) dispval = c.fkCache.get(sql) ?? null
    else {
      let v: string | null | false
      try {
        const r = await env.conn.query(sql, 'grid.fk-display')
        const row = r.resultSets[0]?.rows[0]
        v =
          row === undefined ? false : row[0] === null || row[0] === undefined ? null : row[0].toString('utf8')
      } catch {
        v = false
      }
      if (v === false) dispval = env.tr.gettext('Link not found!')
      else if (v !== null) {
        dispval =
          c.view.pftext === 'P' && mbLongerThan(v, env.cfg.LimitChars)
            ? `${mbSubstr(v, env.cfg.LimitChars)}...`
            : v
      } else dispval = null
      c.fkCache.set(sql, dispval)
    }
  }
  const sql = `SELECT * FROM ${backquote(rel.db)}.${backquote(rel.table)} WHERE ${backquote(rel.field)}${whereComparison}`
  const displayColumn = c.view.relationalDisplay === 'D' && rel.displayField !== ''
  if (displayColumn) {
    if (dispval === null) cell.t = 'NULL'
    else cell.t = dispval
  }
  cell.fk = {
    db: rel.db,
    table: rel.table,
    sql,
    sig: c.sign(sql),
    title: c.view.relationalDisplay === 'K' ? (dispval ?? '') : data,
    ...(displayColumn && dispval === null ? { nullDisplay: true } : {}),
  }
  return cell
}

/**
 * Results::$mediaTypeMap: the stored transformations of every table in the result, keyed
 * `db.table.column`, when BrowseMIME is on, the feature is configured and the "Hide browser
 * transformation" display option is off.
 * pma: src/Display/Results.php::getTable (mediaTypeMap), Transformations::getMime(strict = false, fullName = true)
 */
async function mediaTypeMap(
  env: GridEnv,
  fields: Field[],
  showQuery: string | null,
): Promise<Map<string, MimeInfo>> {
  const out = new Map<string, MimeInfo>()
  const meta = env.meta
  if (!env.cfg.BrowseMIME || env.view.hideTransformation || meta === null) return out
  if (meta.rp.browserTransformationFeature === null || meta.control === null) return out
  // the special browser transformation of some SHOW statements (`..Info`, `..Create Table`)
  if (showQuery !== null) {
    const which =
      /^SHOW\s+(VARIABLES|(FULL\s+)?PROCESSLIST|STATUS|TABLE|GRANTS|CREATE|LOGS|DATABASES|FIELDS)/i.exec(
        showQuery,
      )
    const sql = (column: string): MimeInfo => ({
      column_name: column,
      mimetype: 'Text_Plain',
      transformation: 'output/Text_Plain_Sql.php',
      transformation_options: '',
      input_transformation: '',
      input_transformation_options: '',
    })
    if (which?.[1] !== undefined) {
      if (which[1].toUpperCase().includes('PROCESSLIST')) out.set('..Info', sql('Info'))
      if (/CREATE\s+TABLE/i.test(showQuery)) out.set('..Create Table', sql('Create Table'))
    }
  }
  const seen = new Set<string>()
  for (const f of fields) {
    const key = `${f.db}\u0000${f.orgTable}`
    if (f.db === '' || f.orgTable === '' || seen.has(key)) continue
    seen.add(key)
    const map = await getMime(meta.control, meta.rp, f.db, f.orgTable, false, true)
    for (const [k, v] of Object.entries(map ?? {})) out.set(k, v)
  }
  return out
}

/** Results::getRowInfoForSpecialLinks: lower-cased original column name → value (NULL absent). */
function specialRowInfo(fields: readonly Field[], raw: RawRow): Map<string, string> {
  const out = new Map<string, string>()
  fields.forEach((f, i) => {
    const v = raw[i]
    if (v !== null && v !== undefined) out.set(f.orgName.toLowerCase(), v.toString('utf8'))
  })
  return out
}

/** Results::getRowValues: a column with a mimetype and a browser display transformation. */
function applyTransformation(
  cell: GridCell,
  raw: Buffer | null,
  meta: Field,
  m: MimeInfo | undefined,
  where: string,
  sign: (s: string) => string,
  cfg: AppConfig,
): GridCell {
  if (raw === null || cell.k === 'null') return cell
  if (m === undefined || m.mimetype === '' || m.transformation === '') return cell
  const plugin = findTransformationPlugin(m.transformation)
  if (plugin === null || plugin.kind === 'input') return cell
  const options = parseTransformationOptions(m.transformation_options)
  const mime = m.mimetype.replaceAll('/', '_').toLowerCase()
  const nowrap = transformationNoWrap(plugin.file, options)
  return {
    ...cell,
    k: 'v',
    cls: `${cell.cls.replace(/\bpre_wrap\b/, nowrap ? 'text-nowrap' : 'pre_wrap')} ${mime} transformed`,
    tf: {
      file: plugin.file,
      options,
      mimetype: m.mimetype,
      b64: raw.toString('base64'),
      db: meta.db,
      table: meta.orgTable,
      column: meta.orgName,
      where,
      sig: sign(where),
      isInt: meta.mappedType === 'int',
      isBinary: meta.flags.binary,
      // the program runs here, on the server; the browser shows its output
      ...(plugin.file === 'Output/Text_Plain_External' && cfg.TransformationsExternalPrograms.length > 0
        ? {
            external: runExternalTransformation(
              cfg.TransformationsExternalPrograms,
              options,
              raw,
              cfg.DefaultTransformations.External,
            ),
          }
        : {}),
    },
  }
}

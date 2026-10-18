/**
 * The /sql helper actions of the results grid: full value, value lists, grid-edit save, multi-row
 * delete, BLOB download, and the browse response itself.
 *
 * pma: src/Controllers/Sql/*, src/Controllers/Table/{Replace,DeleteRows,GetField}Controller.php
 */

import type {
  BrowseRequest,
  ColumnValuesRequest,
  ColumnValuesResponse,
  DeleteRowsRequest,
  GridSaveRequest,
  GridSaveResponse,
  GridValueRequest,
  QueryResponse,
  StatementResult,
} from '@bettermyadmin/contracts'
import { type Translator, sprintf } from '@bettermyadmin/i18n'
import { mbStrlen, parseEnumSetValues } from '@bettermyadmin/mysql-types'
import {
  type EditField,
  backquote,
  buildDeleteRowsQueries,
  buildInsertEditQueries,
  quoteString,
} from '@bettermyadmin/sql-gen'
import { parseAnalyze, replaceClause } from '@bettermyadmin/sql-lexer'
import type { z } from 'zod'
import type { AppConfig } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { MysqlError, NotFoundError, ValidationError } from '../http/errors.ts'
import type { MetaRequest } from '../metadata/service.ts'
import { getMessageCard } from '../query/message.ts'
import { countRecords, getVariable, isAppendLimitClause, setVariable } from '../query/pipeline.ts'
import { isProfilingSupported } from '../query/profiling.ts'
import { checkSqlSignature, signSql } from '../query/signature.ts'
import type { SessionData } from '../session/store.ts'
import { TableReader } from '../table/read.ts'
import { type FkRel, foreignMap } from './grid.ts'
import { gridMeta, runBrowse } from './service.ts'
import { resolveViewState } from './view-state.ts'

/** One grid request: the configuration storage, the user's connection, settings and catalogue. */
export interface BrowseCtx {
  m: MetaRequest
  conn: Conn
  settings: AppConfig
  tr: Translator
  session: SessionData
  /** the request's executed-statement log (Debug SQL) */
  executed: QueryResponse['executed']
  debugSql: boolean
}

export type BrowseResponseBody = QueryResponse & {
  usingBookmark: string | null
  previous?: StatementResult
}

/** The /sql response: one statement with its grid (and the previous query card after a delete). */
export async function browseResponse(
  x: BrowseCtx,
  req: z.output<typeof BrowseRequest>,
  previous?: { sql: string; message: string },
): Promise<{ body: BrowseResponseBody; current: { db: string; table: string; sqlQuery: string } }> {
  const { m, conn, settings, session } = x
  const r = await runBrowse(req, m, conn, settings, {
    cfg: settings,
    conn,
    hmacSecret: session.hmacSecret,
    executed: x.executed,
    session,
    server: m.serverIndex,
    tr: x.tr,
  })
  // phpMyAdmin's connection ends after an error: do not keep a changed FOREIGN_KEY_CHECKS
  if (r.discard) await conn.query('SET FOREIGN_KEY_CHECKS = DEFAULT', 'var.reset')
  const body: BrowseResponseBody = {
    statements: [r.statement],
    executed: x.debugSql ? x.executed : [],
    db: r.db === '' ? null : r.db,
    table: r.table === '' ? null : r.table,
    reloadNavigation: r.reloadNavigation,
    sqlQuery: Array.from(r.sqlQuery).length < settings.MaxCharactersInDisplayedSQL ? r.sqlQuery : '',
    usingBookmark: r.usingBookmark,
  }
  if (previous !== undefined) {
    // Sql::getHtmlForPreviousUpdateQuery (disp_query + disp_message)
    body.previous = {
      sql: previous.sql,
      executedSql: previous.sql,
      sig: signSql(previous.sql, session.hmacSecret, settings.blowfish_secret),
      kind: 'affected',
      queryType: 'DELETE',
      message: { type: 'success', text: previous.message },
      queryTime: 0,
      warnings: [],
      db: r.db,
      reload: false,
      card: settings.ShowSQL
        ? await getMessageCard(previous.sql, {
            cfg: settings,
            showAsPhp: null,
            db: r.db,
            table: r.table,
            profilingOn: session.profiling === true,
            profilingSupported: () => isProfilingSupported(conn, session, m.serverIndex),
          })
        : null,
    }
  }
  return { body, current: { db: r.db, table: r.table, sqlQuery: r.sqlQuery } }
}

/**
 * The full value of a truncated/transformed cell: /sql with grid_edit (`SELECT `col` FROM `t` WHERE …`
 * through the LIMIT step; binary values as hex).
 * pma: Sql::getResponseForGridEdit
 */
export async function gridValue(
  x: BrowseCtx,
  req: z.output<typeof GridValueRequest>,
): Promise<{ value: string | null }> {
  const { m, conn, settings } = x
  let sql = `SELECT ${backquote(req.column)} FROM ${backquote(req.table)} WHERE ${req.where}`
  const ctxOpt = conn.serverInfo !== null ? { context: conn.serverInfo.context } : {}
  const [info, db] = parseAnalyze(sql, req.db, true, ctxOpt)
  const view = resolveViewState(x.session, m.serverIndex, db, sql, false, {}, settings)
  if (isAppendLimitClause(info, view.maxRows) && info.statement !== null && info.parser.list !== null) {
    sql = replaceClause(info.statement, info.parser.list, `LIMIT ${view.pos}, ${view.maxRows}`)
  }
  const current = await conn.value('SELECT DATABASE()', 'query.current-db')
  if (current !== db) await conn.query(`USE ${backquote(db)}`, 'query.select-db')
  const r = await conn.query(sql, 'grid.full-value')
  const set = r.resultSets[0]
  const v = set?.rows[0]?.[0] ?? null
  const field = set?.fields[0]
  return {
    value: v === null ? null : field?.flags.binary === true ? v.toString('hex') : v.toString('utf8'),
  }
}

/** DatabaseInterface::getColumn → Util::parseEnumSetValues(type, false) */
async function enumSetValues(conn: Conn, tr: Translator, db: string, table: string, column: string) {
  const reader = new TableReader(conn, {}, tr)
  const col = (await reader.getColumns(db, table)).find((x) => x.Field === column)
  return col === undefined ? null : parseEnumSetValues(col.Type, false)
}

/** natcasesort / strnatcasecmp */
const natCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The grid editors' value lists.
 * pma: src/Controllers/Sql/{EnumValues,SetValues,RelationalValues}Controller.php,
 *      Sql::getHtmlForRelationalColumnDropdown, Relation::getForeignData / foreignDropdown
 */
export async function columnValues(
  x: BrowseCtx,
  req: z.output<typeof ColumnValuesRequest>,
): Promise<ColumnValuesResponse> {
  const { m, conn, settings, tr } = x
  if (req.kind === 'enum' || req.kind === 'set') {
    const values = await enumSetValues(conn, tr, req.db, req.table, req.column)
    if (values === null) throw new ValidationError(tr.gettext('Error in processing request'))
    let current = req.currValue
    if (req.kind === 'set' && req.where !== undefined && req.where !== '') {
      const r = await conn.query(
        `SELECT \`${req.column}\` FROM \`${req.db}\`.\`${req.table}\` WHERE ${req.where} LIMIT 1`,
        'grid.set-full',
      )
      const v = r.resultSets[0]?.rows[0]?.[0]
      current = v === null || v === undefined ? '' : v.toString('utf8')
    }
    const body: ColumnValuesResponse = {
      options: values.map((v) => ({ value: v, label: v })),
      selected: req.kind === 'set' ? current.split(',') : [current],
    }
    return body
  }
  // relational
  const reader = new TableReader(conn, {}, tr)
  const map = await foreignMap(reader, await gridMeta(m), req.db, req.table)
  const rel: FkRel | undefined = map.get(req.column)
  const current = req.relationalDisplay === 'D' ? (req.keyOrDisplay ?? '') : req.currValue
  if (rel === undefined) return { options: [], selected: [], browseForeign: true }
  // Table::checkIfMinRecordsExist
  const uniq = (await reader.getIndexes(rel.db, rel.table))
    .filter((i) => !i.nonUnique)
    .flatMap((i) => i.columns.map((x) => backquote(x.name)))
  const check = await conn
    .query(
      `SELECT ${uniq.length > 0 ? [...new Set(uniq)].join(', ') : '*'} FROM ${backquote(rel.db)}.${backquote(rel.table)} LIMIT ${settings.ForeignKeyMaxLimit}`,
      'grid.fk-count',
    )
    .catch(() => null)
  if (check !== null && (check.resultSets[0]?.rows.length ?? 0) >= settings.ForeignKeyMaxLimit) {
    return { options: [], selected: [current], browseForeign: true }
  }
  const display = rel.displayField
  const r = await conn
    .query(
      `SELECT ${backquote(rel.field)}${display === '' ? '' : `, ${backquote(display)}`} FROM ${backquote(rel.db)}.${backquote(rel.table)}${display === '' ? '' : ` ORDER BY ${backquote(rel.table)}.${backquote(display)}`}`,
      'grid.fk-values',
    )
    .catch(() => null)
  const rows = r?.resultSets[0]?.rows ?? []
  if (rows.length === 0) return { options: [], selected: [current], browseForeign: true }
  const foreign = new Map<string, string>()
  for (const row of rows) {
    foreign.set(row[0]?.toString('utf8') ?? '', display === '' ? '' : (row[1]?.toString('utf8') ?? ''))
  }
  const cut = (v: string) =>
    Array.from(v).length <= settings.LimitChars
      ? v
      : `${Array.from(v).slice(0, settings.LimitChars).join('')}...`
  const section = (mode: string) => {
    const entries = [...foreign.entries()]
    if (mode === 'id-content' || mode === 'id-only') {
      entries.sort((a, b) => (settings.NaturalOrder ? natCollator.compare(a[0], b[0]) : a[0] < b[0] ? -1 : 1))
    } else if (mode === 'content-id') {
      entries.sort((a, b) => (settings.NaturalOrder ? natCollator.compare(a[1], b[1]) : a[1] < b[1] ? -1 : 1))
    }
    return entries.map(([k, v]) => ({
      value: k,
      label: mode === 'content-id' ? `${cut(v)} - ${k}` : mode === 'id-content' ? `${k} - ${cut(v)}` : k,
    }))
  }
  const order = settings.ForeignKeyDropdownOrder as string[]
  const top = display !== '' ? section(order[0] ?? 'content-id') : section('id-only')
  const bottom = display !== '' && order[1] !== undefined ? section(order[1]) : []
  const options = [{ value: '', label: '' }]
  if (top.length < settings.ForeignKeyMaxLimit) {
    options.push(...top)
    if (display !== '' && top.length > 0) options.push({ value: '', label: '' })
  }
  if (display !== '') options.push(...bottom)
  const body: ColumnValuesResponse = { options, selected: [current] }
  return body
}

/**
 * Grid edit save.
 * pma: src/Controllers/Table/ReplaceController.php (submit_type=save, AJAX), InsertEdit::executeSqlQuery,
 *      InsertEdit::verifyWhetherValueCanBeTruncatedAndAppendExtraData
 */
export async function gridSave(
  x: BrowseCtx,
  req: z.output<typeof GridSaveRequest>,
): Promise<GridSaveResponse> {
  const { conn, settings, tr } = x
  await conn.query(`USE ${backquote(req.db)}`, 'query.select-db')
  const info = conn.serverInfo
  const queries = buildInsertEditQueries(
    {
      table: req.table,
      submitType: 'save',
      clauseIsUnique: req.clauseIsUnique,
      rows: req.rows.map((r) => ({
        whereClause: r.where,
        fields: r.fields.map(
          (f): EditField => ({
            columnName: f.name,
            value: f.value,
            type: f.type ?? '',
            autoIncrement: false,
            isNull: f.isNull,
            wasPreviouslyNull: false,
            function: '',
            salt: null,
            previousValue: null,
            isUploaded: false,
          }),
        ),
      })),
    },
    {
      server: { vendor: info?.isMariaDb ? 'mariadb' : 'mysql', version: info?.versionInt ?? 0 },
    },
  )
  let affected = 0
  const errors: string[] = []
  for (const q of queries) {
    try {
      const r = await conn.query(q, 'grid.save')
      affected += r.header?.affectedRows ?? 0
    } catch (e) {
      if (!(e instanceof MysqlError)) throw e
      errors.push(e.message)
    }
  }
  const sql = queries.join(';\n')
  if (errors.length > 0) {
    const body: GridSaveResponse = { success: false, message: errors.join('\n'), sql }
    return body
  }
  let message = sprintf(tr.ngettext('%1$d row affected.', '%1$d rows affected.', affected), affected)
  const warnings = await conn.rows('SHOW WARNINGS', 'query.warnings')
  if (warnings.length > 0)
    message += `\n${warnings.map((w) => `${w.Level}: #${w.Code} ${w.Message}`).join('\n')}`
  // the saved value as MySQL stored it (truncation, time precision)
  let recheck: string | null | undefined
  const first = req.rows[0]
  const col = first?.fields[0]?.name
  if (first !== undefined && col !== undefined) {
    try {
      const r = await conn.query(
        `SELECT ${backquote(req.table)}.${backquote(col)} FROM ${backquote(req.db)}.${backquote(req.table)} WHERE ${first.where} LIMIT 1`,
        'grid.recheck',
      )
      const set = r.resultSets[0]
      const v = set?.rows[0]?.[0]
      if (v !== undefined) {
        const field = set!.fields[0]!
        recheck =
          v === null
            ? null
            : field.flags.binary
              ? `0x${v.toString('hex')}`
              : ['time', 'timestamp', 'datetime'].includes(field.mappedType) &&
                  !v.toString('utf8').includes('.')
                ? `${v.toString('utf8')}.000000`
                : v.toString('utf8')
      }
    } catch {
      recheck = undefined
    }
  }
  // the total row count of the table (row_count)
  const rowCount = await countRecords(
    { cfg: settings, conn, executed: [], hmacSecret: '' },
    req.db,
    req.table,
    false,
  )
  const body: GridSaveResponse = {
    rowCount,
    success: true,
    message,
    sql: queries.length > 0 ? sql : '',
    ...(recheck !== undefined ? { recheck } : {}),
  }
  return body
}

/**
 * "Delete" with selected rows confirmed with Yes: every `DELETE … LIMIT 1;` (FK checks per the
 * checkbox). Returns the statements for the previous-query card.
 * pma: src/Controllers/Table/DeleteRowsController.php
 */
export async function deleteRows(x: BrowseCtx, req: z.output<typeof DeleteRowsRequest>): Promise<string[]> {
  const { conn } = x
  const queries = buildDeleteRowsQueries(req.table, req.where)
  // ForeignKey::handleDisableCheckInit / Cleanup
  const fkDefault = (await getVariable(conn, 'FOREIGN_KEY_CHECKS')) === 'ON'
  await setVariable(conn, 'FOREIGN_KEY_CHECKS', req.fkChecks ? 'ON' : 'OFF')
  try {
    await conn.query(`USE ${backquote(req.db)}`, 'query.select-db')
    for (const q of queries) await conn.query(q, 'grid.delete-rows')
  } finally {
    await setVariable(conn, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
  }
  return queries
}

/**
 * The content type of a downloaded value from its first bytes (JPEG, GIF, PNG, else binary).
 * pma: src/Mime.php::detect
 */
export function detectMime(bytes: Uint8Array): string {
  const len = mbStrlen(bytes)
  const starts = (prefix: number[]) => prefix.every((b, i) => bytes[i] === b)
  if (len >= 2 && starts([0xff, 0xd8])) return 'image/jpeg'
  if (len >= 3 && starts([0x47, 0x49, 0x46])) return 'image/gif'
  if (len >= 4 && starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  return 'application/octet-stream'
}

/**
 * One BLOB cell, the signature of its where clause checked.
 * pma: src/Controllers/Table/GetFieldController.php
 */
export async function getField(
  x: BrowseCtx,
  q: { db: string; table: string; where: string; sig: string; key: string },
): Promise<Buffer> {
  const { conn, tr } = x
  if (q.db === '') throw new ValidationError(`${tr.gettext('Missing parameter:')} db`)
  if (q.table === '') throw new ValidationError(`${tr.gettext('Missing parameter:')} table`)
  // pma: selectDb, then getColumns() === [] (before the signature check)
  const dbs = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ${quoteString(q.db)}`,
    'grid.get-field.db',
  )
  if ((dbs.resultSets[0]?.rows.length ?? 0) === 0) {
    throw new NotFoundError(sprintf(tr.gettext("'%s' database does not exist."), q.db))
  }
  await conn.query(`USE ${backquote(q.db)}`, 'query.select-db')
  const cols = await conn
    .query(`SHOW COLUMNS FROM ${backquote(q.table)}`, 'grid.get-field.columns')
    .catch(() => null)
  if (cols === null || (cols.resultSets[0]?.rows.length ?? 0) === 0) {
    throw new NotFoundError(tr.gettext('Invalid table name'))
  }
  if (!checkSqlSignature(q.where, q.sig, x.session.hmacSecret, x.settings.blowfish_secret)) {
    throw new ValidationError(tr.gettext('There is an issue with your request.'))
  }
  const r = await conn.query(
    `SELECT ${backquote(q.key)} FROM ${backquote(q.table)} WHERE ${q.where} LIMIT 1;`,
    'grid.get-field',
  )
  const v = r.resultSets[0]?.rows[0]?.[0]
  if (v === undefined) {
    throw new NotFoundError(tr.gettext('MySQL returned an empty result set (i.e. zero rows).'))
  }
  return v ?? Buffer.alloc(0)
}

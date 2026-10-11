import {
  BrowseRequest,
  ColumnValuesRequest,
  type ColumnValuesResponse,
  DeleteRowsRequest,
  GridSaveRequest,
  type GridSaveResponse,
  GridValueRequest,
  type QueryResponse,
  type StatementResult,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { parseEnumSetValues } from '@bettermyadmin/mysql-types'
import {
  type EditField,
  backquote,
  buildDeleteRowsQueries,
  buildInsertEditQueries,
} from '@bettermyadmin/sql-gen'
import { parseAnalyze, replaceClause } from '@bettermyadmin/sql-lexer'
import { Hono, type Context as HonoContext } from 'hono'
import { type FkRel, foreignMap } from '../browse/grid.ts'
import { gridMeta, runBrowse } from '../browse/service.ts'
import { resolveViewState } from '../browse/view-state.ts'
import type { AppConfig } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { MysqlError, NotFoundError, ValidationError } from '../http/errors.ts'
import { afterSqlBox } from '../metadata/hooks.ts'
import { type MetaRequest, withMeta } from '../metadata/service.ts'
import { getMessageCard } from '../query/message.ts'
import { getVariable, isAppendLimitClause, setVariable } from '../query/pipeline.ts'
import { isProfilingSupported } from '../query/profiling.ts'
import { checkSqlSignature, signSql } from '../query/signature.ts'
import { TableReader } from '../table/read.ts'
import type { ServerEnv } from './server.ts'
import { parseBody } from './sql.ts'

export const browseRoutes = new Hono<ServerEnv>()

type C = HonoContext<ServerEnv>

/** One request with the user's connection and the configuration storage. */
async function withBrowse<T>(
  c: C,
  db: string,
  fn: (m: MetaRequest, conn: Conn, settings: AppConfig) => Promise<T>,
): Promise<T> {
  return withMeta(c, { db }, async (m) => fn(m, await m.userConn(), await m.settings()))
}

async function browseResponse(
  c: C,
  req: ReturnType<typeof BrowseRequest.parse>,
  previous?: { sql: string; message: string },
): Promise<QueryResponse & { usingBookmark: string | null; previous?: StatementResult }> {
  const { cfg } = c.get('deps')
  const session = c.get('session')
  const executed = c.get('executed')
  let current = { db: req.db, table: req.table, sqlQuery: '' }
  const body = await withBrowse(c, req.db, async (m, conn, settings) => {
    const r = await runBrowse(req, m, conn, settings, {
      cfg: settings,
      conn,
      hmacSecret: session.hmacSecret,
      executed,
      session,
      server: m.serverIndex,
      tr: c.get('tr'),
    })
    // phpMyAdmin's connection ends after an error: do not keep a changed FOREIGN_KEY_CHECKS
    if (r.discard) await conn.query('SET FOREIGN_KEY_CHECKS = DEFAULT', 'var.reset')
    current = { db: r.db, table: r.table, sqlQuery: r.sqlQuery }
    const res: QueryResponse & { usingBookmark: string | null; previous?: StatementResult } = {
      statements: [r.statement],
      executed: cfg.DBG.sql ? executed : [],
      db: r.db === '' ? null : r.db,
      table: r.table === '' ? null : r.table,
      reloadNavigation: r.reloadNavigation,
      sqlQuery: Array.from(r.sqlQuery).length < settings.MaxCharactersInDisplayedSQL ? r.sqlQuery : '',
      usingBookmark: r.usingBookmark,
    }
    if (previous !== undefined) {
      // Sql::getHtmlForPreviousUpdateQuery (disp_query + disp_message)
      res.previous = {
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
    return res
  })
  // StatementHistory + RecentTableHandling middlewares
  await afterSqlBox(c, { db: req.db, table: req.table, current })
  return body
}

/** POST /api/servers/:s/browse — pma: /sql */
browseRoutes.post('/', async (c) => {
  const req = await parseBody(c, BrowseRequest)
  return c.json(await browseResponse(c, req))
})

/**
 * POST /browse/grid-value — the full value of a truncated/transformed cell: /sql with grid_edit
 * (`SELECT `col` FROM `t` WHERE …` through the LIMIT step; binary values as hex).
 * pma: Sql::getResponseForGridEdit
 */
browseRoutes.post('/grid-value', async (c) => {
  const req = await parseBody(c, GridValueRequest)
  return withBrowse(c, req.db, async (m, conn, settings) => {
    let sql = `SELECT ${backquote(req.column)} FROM ${backquote(req.table)} WHERE ${req.where}`
    const ctxOpt = conn.serverInfo !== null ? { context: conn.serverInfo.context } : {}
    const [info, db] = parseAnalyze(sql, req.db, true, ctxOpt)
    const view = resolveViewState(c.get('session'), m.serverIndex, db, sql, false, {}, settings)
    if (isAppendLimitClause(info, view.maxRows) && info.statement !== null && info.parser.list !== null) {
      sql = replaceClause(info.statement, info.parser.list, `LIMIT ${view.pos}, ${view.maxRows}`)
    }
    const current = await conn.value('SELECT DATABASE()', 'query.current-db')
    if (current !== db) await conn.query(`USE ${backquote(db)}`, 'query.select-db')
    const r = await conn.query(sql, 'grid.full-value')
    const set = r.resultSets[0]
    const v = set?.rows[0]?.[0] ?? null
    const field = set?.fields[0]
    return c.json({
      value: v === null ? null : field?.flags.binary === true ? v.toString('hex') : v.toString('utf8'),
    })
  })
})

/** DatabaseInterface::getColumn → Util::parseEnumSetValues(type, false) */
async function columnValues(conn: Conn, tr: C, db: string, table: string, column: string) {
  const reader = new TableReader(conn, {}, tr.get('tr'))
  const col = (await reader.getColumns(db, table)).find((x) => x.Field === column)
  return col === undefined ? null : parseEnumSetValues(col.Type, false)
}

/** natcasesort / strnatcasecmp */
const natCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * POST /browse/values — the grid editors' value lists.
 * pma: src/Controllers/Sql/{EnumValues,SetValues,RelationalValues}Controller.php,
 *      Sql::getHtmlForRelationalColumnDropdown, Relation::getForeignData / foreignDropdown
 */
browseRoutes.post('/values', async (c) => {
  const req = await parseBody(c, ColumnValuesRequest)
  const tr = c.get('tr')
  return withBrowse(c, req.db, async (m, conn, settings) => {
    if (req.kind === 'enum' || req.kind === 'set') {
      const values = await columnValues(conn, c, req.db, req.table, req.column)
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
      return c.json(body)
    }
    // relational
    const reader = new TableReader(conn, {}, tr)
    const map = await foreignMap(reader, await gridMeta(m), req.db, req.table)
    const rel: FkRel | undefined = map.get(req.column)
    const current = req.relationalDisplay === 'D' ? (req.keyOrDisplay ?? '') : req.currValue
    if (rel === undefined) return c.json({ options: [], selected: [], browseForeign: true })
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
      return c.json({ options: [], selected: [current], browseForeign: true })
    }
    const display = rel.displayField
    const r = await conn
      .query(
        `SELECT ${backquote(rel.field)}${display === '' ? '' : `, ${backquote(display)}`} FROM ${backquote(rel.db)}.${backquote(rel.table)}${display === '' ? '' : ` ORDER BY ${backquote(rel.table)}.${backquote(display)}`}`,
        'grid.fk-values',
      )
      .catch(() => null)
    const rows = r?.resultSets[0]?.rows ?? []
    if (rows.length === 0) return c.json({ options: [], selected: [current], browseForeign: true })
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
        entries.sort((a, b) =>
          settings.NaturalOrder ? natCollator.compare(a[0], b[0]) : a[0] < b[0] ? -1 : 1,
        )
      } else if (mode === 'content-id') {
        entries.sort((a, b) =>
          settings.NaturalOrder ? natCollator.compare(a[1], b[1]) : a[1] < b[1] ? -1 : 1,
        )
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
    return c.json(body)
  })
})

/**
 * POST /browse/save — grid edit save.
 * pma: src/Controllers/Table/ReplaceController.php (submit_type=save, AJAX), InsertEdit::executeSqlQuery,
 *      InsertEdit::verifyWhetherValueCanBeTruncatedAndAppendExtraData
 */
browseRoutes.post('/save', async (c) => {
  const req = await parseBody(c, GridSaveRequest)
  const tr = c.get('tr')
  return withBrowse(c, req.db, async (_m, conn) => {
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
      return c.json(body)
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
    const body: GridSaveResponse = {
      success: true,
      message,
      sql: queries.length > 0 ? sql : '',
      ...(recheck !== undefined ? { recheck } : {}),
    }
    return c.json(body)
  })
})

/**
 * POST /browse/delete-rows — "Delete" with selected rows confirmed with Yes: every
 * `DELETE … LIMIT 1;`, then the original browse query again with the DELETEs above it.
 * pma: src/Controllers/Table/DeleteRowsController.php
 */
browseRoutes.post('/delete-rows', async (c) => {
  const req = await parseBody(c, DeleteRowsRequest)
  const tr = c.get('tr')
  const queries = buildDeleteRowsQueries(req.table, req.where)
  await withBrowse(c, req.db, async (_m, conn) => {
    // ForeignKey::handleDisableCheckInit / Cleanup
    const fkDefault = (await getVariable(conn, 'FOREIGN_KEY_CHECKS')) === 'ON'
    await setVariable(conn, 'FOREIGN_KEY_CHECKS', req.fkChecks ? 'ON' : 'OFF')
    try {
      await conn.query(`USE ${backquote(req.db)}`, 'query.select-db')
      for (const q of queries) await conn.query(q, 'grid.delete-rows')
    } finally {
      await setVariable(conn, 'FOREIGN_KEY_CHECKS', fkDefault ? 'ON' : 'OFF')
    }
  })
  const body = await browseResponse(
    c,
    BrowseRequest.parse({ db: req.db, table: req.table, sql: req.originalSql }),
    { sql: queries.join('\n'), message: tr.gettext('Your SQL query has been executed successfully.') },
  )
  return c.json(body)
})

/**
 * GET /browse/field?db&table&where&sig&key — downloads one BLOB cell.
 * pma: src/Controllers/Table/GetFieldController.php
 */
browseRoutes.get('/field', async (c) => {
  const { cfg } = c.get('deps')
  const tr = c.get('tr')
  const db = c.req.query('db') ?? ''
  const table = c.req.query('table') ?? ''
  const where = c.req.query('where') ?? ''
  const key = c.req.query('key') ?? ''
  if (!checkSqlSignature(where, c.req.query('sig') ?? '', c.get('session').hmacSecret, cfg.blowfish_secret)) {
    throw new ValidationError(tr.gettext('There is an issue with your request.'))
  }
  return withBrowse(c, db, async (_m, conn) => {
    await conn.query(`USE ${backquote(db)}`, 'query.select-db')
    const r = await conn.query(
      `SELECT ${backquote(key)} FROM ${backquote(table)} WHERE ${where} LIMIT 1;`,
      'grid.get-field',
    )
    const v = r.resultSets[0]?.rows[0]?.[0]
    if (v === undefined)
      throw new NotFoundError(tr.gettext('MySQL returned an empty result set (i.e. zero rows).'))
    const bytes = v ?? Buffer.alloc(0)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${encodeURIComponent(`${table}-${key}.bin`)}"`,
      },
    })
  })
})

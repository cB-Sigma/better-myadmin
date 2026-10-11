/**
 * The /sql controller: Browse, sort / page / display-option links, Refresh, the single-row Delete
 * link, FK links. Default browse query, remembered sorting, per-query view state, then one statement
 * through the shared pipeline with the results grid.
 *
 * pma: src/Controllers/Sql/SqlController.php, src/Sql.php::executeQueryAndGetQueryResponse
 */

import type { BrowseRequest, StatementResult } from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { backquote } from '@bettermyadmin/sql-gen'
import { type StatementInfo, getAll, getClause, parseAnalyze, replaceClause } from '@bettermyadmin/sql-lexer'
import type { AppConfig } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { ValidationError } from '../http/errors.ts'
import type { MetaRequest } from '../metadata/service.ts'
import { tableInfo } from '../metadata/table-info.ts'
import { type GridHook, type PipelineContext, type RunState, executeStatement } from '../query/pipeline.ts'
import { checkSqlSignature } from '../query/signature.ts'
import { TableReader } from '../table/read.ts'
import { type GridEnv, buildGrid } from './grid.ts'
import { type ViewParams, resolveViewState } from './view-state.ts'

export interface BrowseResult {
  statement: StatementResult
  db: string
  table: string
  sqlQuery: string
  /** "Using bookmark "%s" as default browse query." */
  usingBookmark: string | null
  reloadNavigation: boolean
  discard: boolean
}

/** The configuration-storage part of the grid environment for one request. */
export async function gridMeta(m: MetaRequest): Promise<GridEnv['meta']> {
  const meta = await m.meta()
  const rp = meta.relationParameters
  return {
    rp,
    control: rp.db === null ? null : m.control,
    uiPrefs: (db, table) => meta.uiPrefs(db, table, tableInfo(m, db, table)),
  }
}

/** A grid hook for the pipeline; `sqlQuery` is the query the grid's links act on. */
export function gridHook(
  base: Omit<GridEnv, 'view' | 'sqlQuery'>,
  opts: {
    sqlQuery: (sql: string) => string
    view: (sql: string, info: StatementInfo, pos: number, maxRows: number | 'all') => GridEnv['view']
  },
): GridHook {
  return async (a) => {
    const sqlQuery = opts.sqlQuery(a.input.sql)
    return buildGrid(
      { ...base, sqlQuery, view: opts.view(sqlQuery, a.info, a.input.pos, a.input.maxRows) },
      a,
    )
  }
}

/** Sql::isRememberSortingOrder */
function isRememberSortingOrder(cfg: AppConfig, info: StatementInfo): boolean {
  const f = info.flags
  return (
    cfg.RememberSorting &&
    !(f.isCount || f.isExport || f.isFunc || f.isAnalyse) &&
    f.selectFrom &&
    (info.selectExpressions.length === 0 ||
      (info.selectExpressions.length === 1 && info.selectExpressions[0] === '*')) &&
    info.selectTables.length === 1
  )
}

/**
 * Sql::getDefaultSqlQueryForBrowse
 */
async function defaultBrowseQuery(
  m: MetaRequest,
  cfg: AppConfig,
  conn: Conn,
  db: string,
  table: string,
): Promise<{ sql: string; bookmark: string | null }> {
  const bookmark = await (await m.meta()).bookmarks().getByLabel(m.user, db, table)
  if (bookmark !== null && bookmark.query !== '') {
    return {
      sql: bookmark.query,
      bookmark: sprintf(m.c.get('tr').gettext('Using bookmark "%s" as default browse query.'), table),
    }
  }
  let order = ''
  if (cfg.TablePrimaryKeyOrder !== 'NONE') {
    const reader = new TableReader(conn, {}, m.c.get('tr'))
    const primary = (await reader.getIndexes(db, table)).find((i) => i.name === 'PRIMARY')
    const first = primary?.columns[0]?.name
    if (first !== undefined) {
      order = ` ORDER BY ${backquote(table)}.${backquote(first)} ${cfg.TablePrimaryKeyOrder}`
    }
  }
  return { sql: `SELECT * FROM ${backquote(table)}${order}`, bookmark: null }
}

export async function runBrowse(
  req: BrowseRequest,
  m: MetaRequest,
  conn: Conn,
  settings: AppConfig,
  ctx: PipelineContext,
): Promise<BrowseResult> {
  const tr = m.c.get('tr')
  const session = m.c.get('session')
  const server = m.serverIndex
  const ctxOpt = conn.serverInfo !== null ? { context: conn.serverInfo.context } : {}
  let db = req.db
  let table = req.table ?? ''

  // sql_query from POST, or from GET only with a valid signature
  let sql = req.sql ?? ''
  if (
    req.sig !== undefined &&
    !checkSqlSignature(sql, req.sig, session.hmacSecret, settings.blowfish_secret)
  ) {
    sql = ''
  }
  let usingBookmark: string | null = null
  if (sql === '' && table !== '' && db !== '') {
    const d = await defaultBrowseQuery(m, settings, conn, db, table)
    sql = d.sql
    usingBookmark = d.bookmark
  } else if (sql === '') {
    throw new ValidationError(`${tr.gettext('Missing parameter:')} sql_query`)
  }

  let [info, d, tableFromSql] = parseAnalyze(sql, db, true, ctxOpt)
  db = d
  if (tableFromSql !== '' && table !== tableFromSql) table = tableFromSql

  // remembered sorting order, only for single table query (not from the "Sort by key" drop-down)
  if (isRememberSortingOrder(settings, info) && !info.flags.union && req.sortByKey !== true) {
    if (info.statement !== null && info.parser.list !== null) {
      const meta = await gridMeta(m)
      const ui = meta!.uiPrefs(db, table)
      if (!info.flags.order) {
        let sortCol = await ui.getUiProp('sorted_col', req.discardRememberedSort === true)
        if (typeof sortCol === 'string' && sortCol !== '') {
          // Remove the name of the table from the retrieved field name.
          sortCol = sortCol.replaceAll(`${backquote(table)}.`, '')
          sql = replaceClause(info.statement, info.parser.list, `ORDER BY ${sortCol}`)
          info = getAll(sql, ctxOpt)
        }
      } else {
        await ui.setUiProp('sorted_col', getClause(info.statement, info.parser.list, 'ORDER BY'))
      }
    }
  }

  const params: ViewParams = req
  const view = resolveViewState(
    session,
    server,
    db,
    sql,
    info.flags.queryType === 'EXPLAIN',
    params,
    settings,
  )

  ctx.exactRows ??= new Map()
  const state: RunState = { showAsPhp: null, rollback: false, reload: false, queryTime: 0, discard: false }
  ctx.grid = gridHook(
    {
      cfg: settings,
      conn,
      tr,
      hmacSecret: session.hmacSecret,
      server,
      isBrowseDistinct: req.isBrowseDistinct === true,
      meta: await gridMeta(m),
      exactRows: ctx.exactRows,
    },
    { sqlQuery: () => sql, view: () => view },
  )
  const st = await executeStatement(
    {
      sql,
      db,
      table,
      pos: view.pos,
      maxRows: view.maxRows,
      delimiter: ';',
      fkChecks: req.fkChecks,
      messageToShow: req.messageToShow,
    },
    info,
    state,
    ctx,
  )
  return {
    statement: st,
    db,
    table,
    sqlQuery: sql,
    usingBookmark,
    reloadNavigation: state.reload,
    discard: state.discard,
  }
}

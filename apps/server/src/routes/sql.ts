import {
  type AutocompleteResponse,
  type DefaultFkCheckResponse,
  FormatRequest,
  type FormatResponse,
  LintRequest,
  type LintResponse,
  type SqlFormResponse,
} from '@bettermyadmin/contracts'
import type { Gettext } from '@bettermyadmin/i18n'
import { backquote } from '@bettermyadmin/sql-gen'
import { LINT_MSGIDS, type LintMessages, formatSql, lintQuery } from '@bettermyadmin/sql-lexer'
import { Hono, type Context as HonoContext } from 'hono'
import { getServer } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { NotFoundError } from '../http/errors.ts'
import { parseJson } from '../http/validate.ts'
import { getVariable } from '../query/pipeline.ts'
import { isProfilingSupported } from '../query/profiling.ts'
import { autocompleteTables, databaseExists, tableColumnComments, tableExists } from '../query/sql-tab.ts'
import { expandUserString } from '../util/expand-user-string.ts'
import type { ServerEnv } from './server.ts'

export const sqlRoutes = new Hono<ServerEnv>()

/** Runs `fn` with a pooled connection of the session for this server. */
export async function withConn<T>(c: HonoContext<ServerEnv>, fn: (conn: Conn) => Promise<T>): Promise<T> {
  const { pools } = c.get('deps')
  const conn = await pools.acquire(
    c.get('session').id,
    c.get('serverIndex'),
    c.get('creds'),
    c.get('executed'),
    undefined,
    c.get('language').mysqlLocale,
  )
  try {
    return await fn(conn)
  } finally {
    conn.raw.release()
  }
}

/** Linter's msgids through the request catalogue. */
export function lintMessages(tr: Gettext): LintMessages {
  return { near: tr.gettext(LINT_MSGIDS.near), tooLong: tr.gettext(LINT_MSGIDS.tooLong) }
}

/**
 * POST /sql/lint — the fallback of the editor's in-worker linter.
 * pma: src/Controllers/LintController.php
 */
sqlRoutes.post('/lint', async (c) => {
  const req = await parseJson(c, LintRequest)
  const body: LintResponse = {
    lints: await withConn(c, async (conn) =>
      lintQuery(req.sql, req.editorType ?? null, {
        ...(conn.serverInfo !== null ? { context: conn.serverInfo.context } : {}),
        messages: lintMessages(c.get('tr')),
      }),
    ),
  }
  return c.json(body)
})

/**
 * POST /sql/format — Format / Format as a single line.
 * pma: src/Controllers/Database/SqlFormatController.php
 */
sqlRoutes.post('/format', async (c) => {
  const req = await parseJson(c, FormatRequest)
  const sql = await withConn(c, async (conn) =>
    formatSql(req.sql, {
      singleLine: req.singleLine,
      ...(conn.serverInfo !== null ? { context: conn.serverInfo.context } : {}),
    }),
  )
  const body: FormatResponse = { sql }
  return c.json(body)
})

/**
 * GET /sql/autocomplete?db= — tables and columns of one database for the editor.
 * pma: src/Controllers/Database/SqlAutoCompleteController.php
 */
sqlRoutes.get('/autocomplete', async (c) => {
  const { cfg } = c.get('deps')
  const db = c.req.query('db') ?? ''
  let tables: AutocompleteResponse['tables'] = {}
  // DatabaseName::tryFrom: non-empty, at most 64 characters, no trailing space
  if (
    cfg.EnableAutocompleteForTablesAndColumns &&
    db !== '' &&
    Array.from(db).length <= 64 &&
    !/ $/.test(db)
  ) {
    tables = await withConn(c, (conn) => autocompleteTables(conn, db))
  }
  const body: AutocompleteResponse = { tables }
  return c.json(body)
})

/** ForeignKey::isCheckEnabled */
async function isFkCheckEnabled(c: HonoContext<ServerEnv>, conn: Conn): Promise<boolean> {
  const { cfg } = c.get('deps')
  if (cfg.DefaultForeignKeyChecks === 'enable') return true
  if (cfg.DefaultForeignKeyChecks === 'disable') return false
  return (await getVariable(conn, 'FOREIGN_KEY_CHECKS')) === 'ON'
}

/**
 * GET /sql/default-fk-check — initial state of the inline editor's "Enable foreign key checks".
 * pma: src/Controllers/Sql/DefaultForeignKeyCheckValueController.php
 */
sqlRoutes.get('/default-fk-check', async (c) => {
  const body: DefaultFkCheckResponse = {
    defaultFkCheckValue: await withConn(c, (conn) => isFkCheckEnabled(c, conn)),
  }
  return c.json(body)
})

/**
 * GET /sql/form?db=&table=&sqlQuery= — what SqlQueryForm::getHtml renders for the SQL tab of each scope.
 * pma: src/Controllers/{Server,Database,Table}/SqlController.php, src/SqlQueryForm.php::getHtml, ::init
 */
sqlRoutes.get('/form', async (c) => {
  const { cfg } = c.get('deps')
  const serverIndex = c.get('serverIndex')
  const server = getServer(cfg, serverIndex)!
  const db = c.req.query('db') ?? ''
  const table = db === '' ? '' : (c.req.query('table') ?? '')
  const queryParam = c.req.query('sqlQuery') ?? ''
  const body = await withConn(c, async (conn): Promise<SqlFormResponse> => {
    let scope: SqlFormResponse['scope'] = 'server'
    let legendName = server.verbose !== '' ? server.verbose : String(server.host)
    let query = queryParam
    let columns: SqlFormResponse['columns'] = []
    if (db !== '') {
      // DbTableExists::selectDatabase / hasTable
      if (!(await databaseExists(conn, db)))
        throw new NotFoundError(c.get('tr').gettext('No database selected.'))
      if (table === '') {
        scope = 'database'
        legendName = db
        if (query === '') {
          query = await expandUserString(cfg.DefaultQueryDatabase, {
            conn,
            server,
            db,
            table: '',
            httpHost: c.req.header('host') ?? '',
            escape: backquote,
          })
        }
      } else {
        columns = await tableColumnComments(conn, db, table)
        if (columns.length === 0 && !(await tableExists(conn, db, table)))
          throw new NotFoundError(c.get('tr').gettext('No table selected.'))
        scope = 'table'
        legendName = `${db}.${table}`
        if (query === '') {
          query = await expandUserString(cfg.DefaultQueryTable, {
            conn,
            server,
            db,
            table,
            httpHost: c.req.header('host') ?? '',
            escape: backquote,
          })
        }
      }
    }
    const info = conn.serverInfo
    return {
      scope,
      legendName,
      query,
      columns,
      fkChecks: await isFkCheckEnabled(c, conn),
      profilingSupported: await isProfilingSupported(conn, c.get('session'), serverIndex),
      server: {
        versionInt: info?.versionInt ?? 0,
        isMariaDb: info?.isMariaDb ?? false,
        sqlMode: info?.sqlMode ?? '',
      },
      settings: {
        Confirm: cfg.Confirm,
        RetainQueryBox: cfg.RetainQueryBox,
        CodemirrorEnable: cfg.CodemirrorEnable,
        LintEnable: cfg.LintEnable,
        EnableAutocompleteForTablesAndColumns: cfg.EnableAutocompleteForTablesAndColumns,
        TextareaCols: cfg.TextareaCols,
        TextareaRows: cfg.TextareaRows,
        TextareaAutoSelect: cfg.TextareaAutoSelect,
        MaxCharactersInDisplayedSQL: cfg.MaxCharactersInDisplayedSQL,
        ActionLinksMode: cfg.ActionLinksMode,
        AllowSharedBookmarks: cfg.AllowSharedBookmarks,
      },
    }
  })
  return c.json(body)
})

import {
  type AutocompleteResponse,
  type DefaultFkCheckResponse,
  FormatRequest,
  type FormatResponse,
  type HistoryResponse,
  LintRequest,
  type LintResponse,
  type SqlFormResponse,
} from '@bettermyadmin/contracts'
import type { Gettext } from '@bettermyadmin/i18n'
import { backquote, quoteString } from '@bettermyadmin/sql-gen'
import { LINT_MSGIDS, type LintMessages, formatSql, lintQuery } from '@bettermyadmin/sql-lexer'
import { Hono, type Context as HonoContext } from 'hono'
import type { z } from 'zod'
import { getServer } from '../config.ts'
import type { Conn } from '../db/connection.ts'
import { NotFoundError, ValidationError } from '../http/errors.ts'
import { getHistory } from '../query/history.ts'
import { getVariable } from '../query/pipeline.ts'
import { isProfilingSupported } from '../query/profiling.ts'
import { expandUserString } from '../util/expand-user-string.ts'
import type { ServerEnv } from './server.ts'

export const sqlRoutes = new Hono<ServerEnv>()

export async function parseBody<S extends z.ZodTypeAny>(
  c: HonoContext<ServerEnv>,
  schema: S,
): Promise<z.output<S>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid request.',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return parsed.data as z.output<S>
}

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
  const req = await parseBody(c, LintRequest)
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
  const req = await parseBody(c, FormatRequest)
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
  const tables: AutocompleteResponse['tables'] = {}
  // DatabaseName::tryFrom: non-empty, at most 64 characters, no trailing space
  if (
    cfg.EnableAutocompleteForTablesAndColumns &&
    db !== '' &&
    Array.from(db).length <= 64 &&
    !/ $/.test(db)
  ) {
    await withConn(c, async (conn) => {
      const rows = await conn.rows(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY FROM information_schema.columns WHERE table_schema = ${quoteString(db)}`,
        'sql.autocomplete',
      )
      for (const r of rows) {
        const key = r.COLUMN_KEY === 'PRI' ? ' | Primary' : r.COLUMN_KEY === 'UNI' ? ' | Unique' : ''
        const name = r.TABLE_NAME ?? ''
        tables[name] ??= []
        tables[name].push({ field: r.COLUMN_NAME ?? '', columnHint: (r.COLUMN_TYPE ?? '') + key })
      }
    })
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
      const dbExists = await conn.value(
        `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${quoteString(db)}`,
        'sql.form.db-exists',
      )
      if (dbExists === null) throw new NotFoundError(c.get('tr').gettext('No databases selected.'))
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
        const lower = Number((await conn.value('SELECT @@lower_case_table_names', 'sql.form.lctn')) ?? 0)
        const collate = lower === 0 ? 'COLLATE utf8_bin' : lower === 2 ? 'COLLATE utf8_general_ci' : ''
        const rows = await conn.rows(
          `SELECT \`COLUMN_NAME\` AS \`Field\`, \`COLUMN_COMMENT\` AS \`Comment\` FROM \`information_schema\`.\`COLUMNS\` WHERE \`TABLE_SCHEMA\` ${collate} = ${quoteString(db)} AND \`TABLE_NAME\` ${collate} = ${quoteString(table)} ORDER BY \`ORDINAL_POSITION\``,
          'sql.form.columns',
        )
        if (rows.length === 0) {
          const tableExists = await conn.value(
            `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quoteString(db)} AND TABLE_NAME = ${quoteString(table)}`,
            'sql.form.table-exists',
          )
          if (tableExists === null) throw new NotFoundError(c.get('tr').gettext('No table selected.'))
        }
        scope = 'table'
        legendName = `${db}.${table}`
        columns = rows.map((r) => ({ field: r.Field ?? '', comment: r.Comment ?? '' }))
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

/**
 * GET /sql/history — the session's query history (History::getHistory without QueryHistoryDB).
 * The pmadb-backed history plugs in through query/history.ts.
 */
sqlRoutes.get('/history', async (c) => {
  const body: HistoryResponse = { entries: await getHistory(c.get('deps').cfg, c.get('session')) }
  return c.json(body)
})

import {
  AddColumnsRequest,
  AddKeyRequest,
  ChangeColumnsRequest,
  ColumnsPreviewRequest,
  CreateTableRequest,
  type DdlResponse,
  DropColumnsRequest,
  DropIndexRequest,
  MoveColumnsRequest,
  PartitionMaintenanceRequest,
  PartitioningRequest,
  RenameIndexRequest,
  ReservedWordCheckRequest,
  type ReservedWordCheckResponse,
  SaveIndexRequest,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { Context as SqlContext } from '@bettermyadmin/sql-lexer'
import { type Context, Hono } from 'hono'
import { NotFoundError, ValidationError } from '../http/errors.ts'
import { jsonBody, parse } from '../http/validate.ts'
import {
  type DdlCtx,
  addColumns,
  addKey,
  changeColumns,
  createTable,
  dropColumns,
  dropIndex,
  moveColumns,
  partitionMaintenance,
  removePartitioning,
  renameIndex,
  saveIndex,
  savePartitioning,
} from '../table/ddl.ts'
import { changeForm, columnFormOptions, indexForm, partitionForm } from '../table/forms.ts'
import { TableReader } from '../table/read.ts'
import { buildStructurePage } from '../table/structure-page.ts'
import type { ServerEnv } from './server.ts'

/**
 * Table Structure tab, column form, index editor and partitions (docs/architecture/05 table scope).
 * Mounted at /api/servers/:s/databases.
 */
export const tableStructureRoutes = new Hono<ServerEnv>()

/** A request-scoped reader on a pooled connection of the session. */
async function withReader<T>(c: Context<ServerEnv>, fn: (reader: TableReader) => Promise<T>): Promise<T> {
  const { pools } = c.get('deps')
  const session = c.get('session')
  const serverIndex = c.get('serverIndex')
  const login = session.servers[String(serverIndex)]
  if (login === undefined) throw new ValidationError(c.get('tr').gettext('Invalid server index!'))
  login.cache ??= {}
  const conn = await pools.acquire(
    session.id,
    serverIndex,
    c.get('creds'),
    c.get('executed'),
    undefined,
    c.get('language').mysqlLocale,
  )
  try {
    const reader = new TableReader(conn, login.cache, c.get('tr'))
    return await fn(reader)
  } finally {
    conn.raw.release()
  }
}

/**
 * The table scope: the database must be selectable and the table must exist.
 * pma: DbTableExists::selectDatabase / ::hasTable ("No databases selected." / "No table selected.")
 */
async function withTable<T>(c: Context<ServerEnv>, fn: (ctx: DdlCtx) => Promise<T>): Promise<T> {
  const db = c.req.param('db') ?? ''
  const table = c.req.param('t') ?? ''
  const tr = c.get('tr')
  return withReader(c, async (reader) => {
    if (db === '' || !(await reader.selectDb(db)))
      throw new NotFoundError(tr.gettext('No databases selected.'))
    if (table === '' || (await reader.getStatus(db, table)) === null) {
      throw new NotFoundError(tr.gettext('No table selected.'))
    }
    return fn({ reader, cfg: c.get('deps').cfg, tr, db, table })
  })
}

const respond = (c: Context<ServerEnv>, r: DdlResponse) => {
  const cfg = c.get('deps').cfg
  return c.json({ ...r, executed: cfg.DBG.sql ? c.get('executed') : [] })
}

// ---------------------------------------------------------------- reads

/** GET …/tables/:t/structure (pma: /table/structure) */
tableStructureRoutes.get('/:db/tables/:t/structure', async (c) =>
  c.json(await withTable(c, (x) => buildStructurePage(x.reader, x.cfg, x.tr, x.db, x.table))),
)

/** GET …/tables/:t/columns/form?fields=a&fields=b (pma: /table/structure/change) */
tableStructureRoutes.get('/:db/tables/:t/columns/form', async (c) => {
  const fields = c.req.queries('fields') ?? []
  if (fields.length === 0) throw new ValidationError(c.get('tr').gettext('No column selected.'))
  return c.json(await withTable(c, (x) => changeForm(x.reader, x.cfg, x.tr, x.db, x.table, fields)))
})

/** GET …/tables/:t/columns/add-form (pma: /table/add-field without do_save_data) */
tableStructureRoutes.get('/:db/tables/:t/columns/add-form', async (c) =>
  c.json({
    options: await withTable(c, (x) => columnFormOptions(x.reader, x.cfg, x.tr, x.db, x.table)),
  }),
)

/** GET …/tables/:t/indexes/form?index=name | ?create=N (pma: /table/indexes, /table/indexes/rename) */
tableStructureRoutes.get('/:db/tables/:t/indexes/form', async (c) => {
  const index = c.req.query('index')
  const create = c.req.query('create')
  return c.json(
    await withTable(c, (x) =>
      indexForm(x.reader, x.cfg, x.db, x.table, {
        index,
        create: create === undefined ? undefined : Number(create),
      }),
    ),
  )
})

/** GET …/tables/:t/partitions/form (pma: /table/structure/partitioning) */
tableStructureRoutes.get('/:db/tables/:t/partitions/form', async (c) =>
  c.json(await withTable(c, (x) => partitionForm(x.reader, x.db, x.table))),
)

/** GET …/create-table/form (pma: /table/create without do_save_data) */
tableStructureRoutes.get('/:db/create-table/form', async (c) => {
  const db = c.req.param('db')
  const tr = c.get('tr')
  return c.json(
    await withReader(c, async (reader) => {
      if (!(await reader.selectDb(db))) {
        throw new NotFoundError(sprintf(tr.gettext("'%s' database does not exist."), db))
      }
      // CreateController::getNumberOfFieldsFromRequest: 4 rows by default
      return { options: await columnFormOptions(reader, c.get('deps').cfg, tr, db, ''), defaultColumns: 4 }
    }),
  )
})

// ---------------------------------------------------------------- writes

tableStructureRoutes.post('/:db/tables', async (c) => {
  const req = parse(CreateTableRequest, await jsonBody(c))
  const db = c.req.param('db')
  return respond(
    c,
    await withReader(c, (reader) =>
      createTable({ reader, cfg: c.get('deps').cfg, tr: c.get('tr'), db }, req),
    ),
  )
})

tableStructureRoutes.post('/:db/tables/:t/columns/add', async (c) => {
  const req = parse(AddColumnsRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => addColumns(x, req)))
})

tableStructureRoutes.post('/:db/tables/:t/columns/change', async (c) => {
  const req = parse(ChangeColumnsRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => changeColumns(x, req)))
})

tableStructureRoutes.post('/:db/tables/:t/columns/drop', async (c) => {
  const req = parse(DropColumnsRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => dropColumns(x, req)))
})

tableStructureRoutes.post('/:db/tables/:t/columns/key', async (c) => {
  const req = parse(AddKeyRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => addKey(x, req)))
})

tableStructureRoutes.post('/:db/tables/:t/columns/move', async (c) => {
  const req = parse(MoveColumnsRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => moveColumns(x, req)))
})

/** POST …/columns/preview {op, body} — every "Preview SQL" button, always a dry run */
tableStructureRoutes.post('/:db/tables/:t/columns/preview', async (c) => {
  const req = parse(ColumnsPreviewRequest, await jsonBody(c))
  return respond(
    c,
    await withTable(c, (x) => {
      if (req.op === 'add') return addColumns(x, { ...req.body, dryRun: true })
      if (req.op === 'change') return changeColumns(x, { ...req.body, dryRun: true })
      return moveColumns(x, { ...req.body, dryRun: true })
    }),
  )
})

/**
 * POST …/columns/reserved-word-check (pma: /table/structure/reserved-word-check)
 * `reserved: false` also when ReservedWordDisableWarning is on.
 */
tableStructureRoutes.post('/:db/tables/:t/columns/reserved-word-check', async (c) => {
  const req = parse(ReservedWordCheckRequest, await jsonBody(c))
  const cfg = c.get('deps').cfg
  const tr = c.get('tr')
  if (cfg.ReservedWordDisableWarning !== false) {
    return c.json({ reserved: false, message: '' } satisfies ReservedWordCheckResponse)
  }
  return c.json(
    await withReader(c, async (reader) => {
      const ctx = reader.conn.serverInfo?.context ?? SqlContext.current
      const names: string[] = []
      for (const n of req.names) if (ctx.isKeyword(n.trim(), true) !== null) names.push(n.trim())
      const table = req.table ?? c.req.param('t') ?? ''
      if (ctx.isKeyword(table.trim(), true) !== null) names.push(table.trim())
      return {
        reserved: names.length > 0,
        message: sprintf(
          tr.ngettext(
            "The name '%s' is a MySQL reserved keyword.",
            "The names '%s' are MySQL reserved keywords.",
            names.length,
          ),
          names.join(','),
        ),
      } satisfies ReservedWordCheckResponse
    }),
  )
})

tableStructureRoutes.post('/:db/tables/:t/indexes', async (c) => {
  const req = parse(SaveIndexRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => saveIndex(x, req)))
})

tableStructureRoutes.post('/:db/tables/:t/indexes/rename', async (c) => {
  const req = parse(RenameIndexRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => renameIndex(x, req)))
})

tableStructureRoutes.post('/:db/tables/:t/indexes/drop', async (c) => {
  const req = parse(DropIndexRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => dropIndex(x, req)))
})

tableStructureRoutes.post('/:db/tables/:t/partitions/partitioning', async (c) => {
  const req = parse(PartitioningRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => savePartitioning(x, req)))
})

tableStructureRoutes.post('/:db/tables/:t/partitions/maintenance', async (c) => {
  const req = parse(PartitionMaintenanceRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => partitionMaintenance(x, req)))
})

tableStructureRoutes.post('/:db/tables/:t/partitions/remove-partitioning', async (c) =>
  respond(c, await withTable(c, (x) => removePartitioning(x))),
)

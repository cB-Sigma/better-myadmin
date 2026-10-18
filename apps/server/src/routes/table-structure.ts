import {
  AddColumnsRequest,
  AddKeyRequest,
  CentralColumnsSelectRequest,
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
  StructureBrowseRequest,
  type StructureBrowseResponse,
} from '@bettermyadmin/contracts'
import { sprintf } from '@bettermyadmin/i18n'
import { getMime } from '@bettermyadmin/metadata'
import { getBrowseColumnsQuery } from '@bettermyadmin/sql-gen'
import { Context as SqlContext } from '@bettermyadmin/sql-lexer'
import { type Context, Hono } from 'hono'
import { getServer } from '../config.ts'
import { NotFoundError, ValidationError } from '../http/errors.ts'
import { jsonBody, parse } from '../http/validate.ts'
import { centralColumnsAdd, centralColumnsRemove, centralList } from '../table/central-columns.ts'
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
import { storageFeatures, withScope } from './table-scope.ts'

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
  // i18n-new: API error (phpMyAdmin has no JSON API)
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
  return withScope(c, fn)
}

const respond = (c: Context<ServerEnv>, r: DdlResponse) => {
  const cfg = c.get('deps').cfg
  return c.json({ ...r, executed: cfg.DBG.sql ? c.get('executed') : [] })
}

// ---------------------------------------------------------------- reads

/** GET …/tables/:t/structure (pma: /table/structure) */
tableStructureRoutes.get('/:db/tables/:t/structure', async (c) =>
  c.json(
    await withScope(c, async (x) => {
      const page = await buildStructurePage(x.reader, x.cfg, x.tr, x.db, x.table, {
        ...(x.features ?? storageFeatures(null)),
        centralList: await centralList(x),
        mediaTypes: await mediaTypes(x),
      })
      // the Distinct values / Propose table structure links run in the Browse / SQL view (signed)
      const propose = page.links.proposeTableStructure
      return {
        ...page,
        columns: page.columns.map((col) => ({ ...col, distinctSig: x.sign(col.distinctSql) })),
        links: { ...page.links, ...(propose !== null ? { proposeSig: x.sign(propose) } : {}) },
      }
    }),
  ),
)

/** POST …/tables/:t/structure/browse (pma: Table\Structure\BrowseController) */
tableStructureRoutes.post('/:db/tables/:t/structure/browse', async (c) => {
  const req = parse(StructureBrowseRequest, await jsonBody(c))
  if (req.columns.length === 0) throw new ValidationError(c.get('tr').gettext('No column selected.'))
  return c.json(
    await withScope(c, async (x): Promise<StructureBrowseResponse> => {
      const sql = getBrowseColumnsQuery(x.db, x.table, req.columns)
      return { sql, sig: x.sign(sql) }
    }),
  )
})

/**
 * pma: Table\StructureController (mimeMap) + display_structure.twig: the "Media type:" line needs
 * ShowPropertyComments, BrowseMIME and both the column comments and browser transformation features.
 */
async function mediaTypes(x: DdlCtx): Promise<Record<string, string>> {
  const meta = x.meta
  if (!x.cfg.ShowPropertyComments || !x.cfg.BrowseMIME || meta == null || meta.control === null) return {}
  if (meta.rp.columnCommentsFeature === null || meta.rp.browserTransformationFeature === null) return {}
  const map = (await getMime(meta.control, meta.rp, x.db, x.table, true)) ?? {}
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.mimetype]))
}

/** POST …/tables/:t/structure/central-columns-{add,remove} (selected_fld[]) */
tableStructureRoutes.post('/:db/tables/:t/structure/central-columns-add', async (c) => {
  const req = parse(CentralColumnsSelectRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => centralColumnsAdd(x, req.columns)))
})
tableStructureRoutes.post('/:db/tables/:t/structure/central-columns-remove', async (c) => {
  const req = parse(CentralColumnsSelectRequest, await jsonBody(c))
  return respond(c, await withTable(c, (x) => centralColumnsRemove(x, req.columns)))
})

/** GET …/tables/:t/columns/form?fields=a&fields=b (pma: /table/structure/change) */
tableStructureRoutes.get('/:db/tables/:t/columns/form', async (c) => {
  const fields = c.req.queries('fields') ?? []
  if (fields.length === 0) throw new ValidationError(c.get('tr').gettext('No column selected.'))
  return c.json(
    await withTable(c, (x) =>
      changeForm(
        x.reader,
        x.cfg,
        x.tr,
        x.db,
        x.table,
        fields,
        x.features,
        x.meta,
        getServer(x.cfg, Number(c.req.param('s')))?.DisableIS === true,
      ),
    ),
  )
})

/** GET …/tables/:t/columns/add-form (pma: /table/add-field without do_save_data) */
tableStructureRoutes.get('/:db/tables/:t/columns/add-form', async (c) =>
  c.json({
    options: await withTable(c, (x) =>
      columnFormOptions(x.reader, x.cfg, x.tr, x.db, x.table, { features: x.features, meta: x.meta }),
    ),
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
        primary: c.req.query('primary') === '1',
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
  // the Central columns picker and the MIME columns need the configuration storage (Normal::getForm)
  const form = await withScope(
    c,
    async (x) => ({
      options: await columnFormOptions(x.reader, x.cfg, x.tr, db, '', { features: x.features, meta: x.meta }),
      // CreateController::getNumberOfFieldsFromRequest: 4 rows by default
      defaultColumns: 4,
    }),
    { table: false },
  ).catch((e: unknown) => {
    if (e instanceof NotFoundError)
      throw new NotFoundError(sprintf(tr.gettext("'%s' database does not exist."), db))
    throw e
  })
  return c.json(form)
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
  const body = await jsonBody(c)
  // pma: AddKeyController::getKeyType() === '' → "Invalid request parameter."
  const keyType = (body as { type?: unknown } | null)?.type
  if (!['FULLTEXT', 'INDEX', 'PRIMARY', 'SPATIAL', 'UNIQUE'].includes(keyType as string)) {
    throw new ValidationError(c.get('tr').gettext('Invalid request parameter.'))
  }
  const req = parse(AddKeyRequest, body)
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

import {
  BrowseForeignersRequest,
  type ColumnTransformations,
  SaveRowsRequest,
} from '@bettermyadmin/contracts'
import { parseTransformationOptions } from '@bettermyadmin/mysql-types'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '../http/errors.ts'
import type { IeCtx } from '../insert-edit/context.ts'
import { mimeMap } from '../insert-edit/context.ts'
import { browseForeigners } from '../insert-edit/foreign.ts'
import { buildInsertForm } from '../insert-edit/form.ts'
import { saveRows } from '../insert-edit/save.ts'
import { type RawCell, getField, transformationWrapper } from '../insert-edit/wrapper.ts'
import { withMeta } from '../metadata/service.ts'
import { checkSqlSignature } from '../query/signature.ts'
import { TableReader } from '../table/read.ts'
import type { ServerEnv } from './server.ts'
import { parseBody } from './sql.ts'

/**
 * Insert/Edit form, save, foreign values, transformation wrapper (docs/features/03).
 * Mounted at /api/servers/:s/databases.
 */
export const insertEditRoutes = new Hono<ServerEnv>()

/** DbTableExists checks, then the request context on the user's connection + pmadb. */
async function withIe<T>(c: Context<ServerEnv>, fn: (ctx: IeCtx) => Promise<T>): Promise<T> {
  const db = c.req.param('db') ?? ''
  const table = c.req.param('t') ?? ''
  const tr = c.get('tr')
  const session = c.get('session')
  const serverIndex = c.get('serverIndex')
  return withMeta(c, { db }, async (m) => {
    const conn = await m.userConn()
    const login = session.servers[String(serverIndex)]
    if (login === undefined) throw new ValidationError(tr.gettext('Invalid server index!'))
    login.cache ??= {}
    const reader = new TableReader(conn, login.cache, tr)
    if (db === '' || !(await reader.selectDb(db)))
      throw new NotFoundError(tr.gettext('No databases selected.'))
    if (table === '' || !(await m.tableExists(db, table)))
      throw new NotFoundError(tr.gettext('No table selected.'))
    const ctx: IeCtx = {
      reader,
      conn,
      cfg: await m.settings(),
      tr,
      db,
      table,
      meta: m,
      rp: await m.relationParameters(),
      user: c.get('creds').user,
      hmacSecret: session.hmacSecret,
      apiBase: `/api/servers/${serverIndex}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`,
    }
    return fn(ctx)
  })
}

const FormRequestBody = z.object({
  /** signed where clauses of the rows to edit / copy; none = insert */
  where: z.array(z.object({ clause: z.string(), sig: z.string() })).default([]),
  /** default_action=insert (Copy) */
  copy: z.boolean().default(false),
  insertRows: z.number().int().optional(),
  afterInsert: z.string().optional(),
  clauseIsUnique: z.boolean().optional(),
  unsaved: z.array(z.record(z.string(), z.string().nullable())).optional(),
  /** ShowFunctionFields / ShowFieldTypesInDataEditView toggles (POST of /table/change) */
  showFunctionFields: z.boolean().optional(),
  showFieldTypes: z.boolean().optional(),
})

/**
 * POST …/tables/:t/insert-form (pma: /table/change, /table/change/rows). Where clauses run only
 * with a valid signature (Core::checkSqlQuerySignature); unsigned ones are ignored like phpMyAdmin.
 */
insertEditRoutes.post('/:db/tables/:t/insert-form', async (c) => {
  const req = await parseBody(c, FormRequestBody)
  const { cfg } = c.get('deps')
  const session = c.get('session')
  const clauses = req.where
    .filter((w) => checkSqlSignature(w.clause, w.sig, session.hmacSecret, cfg.blowfish_secret))
    .map((w) => w.clause)
  return c.json(
    await withIe(c, async (ctx) => {
      if (req.showFunctionFields !== undefined)
        ctx.cfg = { ...ctx.cfg, ShowFunctionFields: req.showFunctionFields }
      if (req.showFieldTypes !== undefined)
        ctx.cfg = { ...ctx.cfg, ShowFieldTypesInDataEditView: req.showFieldTypes }
      return buildInsertForm(ctx, {
        whereClauses: clauses.length > 0 ? clauses : null,
        copy: req.copy && clauses.length > 0,
        insertRows: req.insertRows,
        afterInsert: req.afterInsert,
        clauseIsUnique: req.clauseIsUnique,
        unsaved: req.unsaved,
      })
    }),
  )
})

/** POST …/tables/:t/rows (pma: /table/replace) */
insertEditRoutes.post('/:db/tables/:t/rows', async (c) => {
  const req = await parseBody(c, SaveRowsRequest)
  const { cfg } = c.get('deps')
  const r = await withIe(c, (ctx) => saveRows(ctx, req))
  return c.json(cfg.DBG.sql ? { ...r, executed: c.get('executed') } : r)
})

/** POST …/tables/:t/browse-foreigners (pma: /browse-foreigners) */
insertEditRoutes.post('/:db/tables/:t/browse-foreigners', async (c) => {
  const req = await parseBody(c, BrowseForeignersRequest)
  return c.json(await withIe(c, (ctx) => browseForeigners(ctx, req)))
})

/** GET …/tables/:t/transformations — stored MIME/transformations for the Browse grid */
insertEditRoutes.get('/:db/tables/:t/transformations', async (c) =>
  c.json(
    await withIe(c, async (ctx): Promise<ColumnTransformations> => {
      const enabled = ctx.cfg.BrowseMIME && ctx.rp.browserTransformationFeature !== null
      const columns: ColumnTransformations['columns'] = {}
      if (enabled) {
        for (const [col, m] of Object.entries(await mimeMap(ctx))) {
          columns[col] = {
            mimetype: m.mimetype,
            transformation: m.transformation,
            transformationOptions: parseTransformationOptions(m.transformation_options),
            inputTransformation: m.input_transformation,
            inputTransformationOptions: parseTransformationOptions(m.input_transformation_options),
          }
        }
      }
      return { enabled, columns }
    }),
  ),
)

const send = (r: RawCell) =>
  new Response(typeof r.body === 'string' ? r.body : new Uint8Array(r.body), {
    status: r.status,
    headers: r.headers,
  })

/** GET …/tables/:t/transformation/wrapper?key&where&sig&ct&cn&resize (pma: /transformation/wrapper) */
insertEditRoutes.get('/:db/tables/:t/transformation/wrapper', async (c) =>
  send(
    await withIe(c, (ctx) =>
      transformationWrapper(ctx, {
        key: c.req.query('key') ?? '',
        where: c.req.query('where') ?? null,
        sig: c.req.query('sig') ?? null,
        ct: c.req.query('ct'),
        cn: c.req.query('cn'),
        resize: c.req.query('resize'),
      }),
    ),
  ),
)

/** GET …/tables/:t/get-field?key&where&sig (pma: /table/get-field) */
insertEditRoutes.get('/:db/tables/:t/get-field', async (c) =>
  send(
    await withIe(c, (ctx) =>
      getField(ctx, {
        key: c.req.query('key') ?? '',
        where: c.req.query('where') ?? '',
        sig: c.req.query('sig') ?? '',
      }),
    ),
  ),
)

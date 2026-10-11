import { DropForeignKeyRequest, RelationSaveRequest } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { dropForeignKey, relationDropdown, relationPage, relationSave } from '../table/relation.ts'
import type { ServerEnv } from './server.ts'
import { body, parse, respond, withScope } from './table-scope.ts'

/** Relation view (pma: /table/relation). Mounted at /api/servers/:s/databases. */
export const tableRelationRoutes = new Hono<ServerEnv>()

const base = '/:db/tables/:t/relation'

tableRelationRoutes.get(base, async (c) => c.json(await withScope(c, relationPage)))

/** getDropdownValues=true: ?foreignDb=&foreignTable=&foreign=true */
tableRelationRoutes.get(`${base}/dropdown`, async (c) =>
  c.json(
    await withScope(
      c,
      (x) =>
        relationDropdown(x, {
          foreignDb: c.req.query('foreignDb') ?? '',
          foreignTable: c.req.query('foreignTable'),
          foreign: c.req.query('foreign') === 'true',
        }),
      { meta: false },
    ),
  ),
)

tableRelationRoutes.post(base, async (c) => {
  const req = parse(RelationSaveRequest, await body(c))
  return respond(c, await withScope(c, (x) => relationSave(x, req)))
})

tableRelationRoutes.post(`${base}/drop-foreign-key`, async (c) => {
  const req = parse(DropForeignKeyRequest, await body(c))
  return respond(c, await withScope(c, (x) => dropForeignKey(x, req)))
})

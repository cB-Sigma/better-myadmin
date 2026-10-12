import {
  CreateTables2NFRequest,
  CreateTables3NFRequest,
  MoveRepeatingGroupRequest,
  NewTables2NFRequest,
  NewTables3NFRequest,
  Normalization3NFStepRequest,
} from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import {
  createTables2NF,
  createTables3NF,
  moveRepeatingGroup,
  newTables2NF,
  newTables3NF,
  normalization3NFStep,
  normalizationTable,
  partialDependencies,
} from '../table/normalization.ts'
import type { ServerEnv } from './server.ts'
import { body, parse, respond, withScope } from './table-scope.ts'

/** The normalization wizard (pma: /normalization/**). Mounted at /api/servers/:s/databases. */
export const tableNormalizationRoutes = new Hono<ServerEnv>()

/** 1nf/step1–4, 2nf/step1, get-columns */
tableNormalizationRoutes.get('/:db/tables/:t/normalization', async (c) =>
  c.json(await withScope(c, normalizationTable, { meta: false })),
)

tableNormalizationRoutes.post('/:db/tables/:t/normalization/3nf/step1', async (c) => {
  const req = parse(Normalization3NFStepRequest, await body(c))
  return c.json(await withScope(c, (x) => normalization3NFStep(x, req.tables), { meta: false, table: false }))
})

tableNormalizationRoutes.post('/:db/tables/:t/normalization/partial-dependencies', async (c) =>
  c.json(await withScope(c, partialDependencies, { meta: false })),
)

tableNormalizationRoutes.post('/:db/tables/:t/normalization/move-repeating-group', async (c) => {
  const req = parse(MoveRepeatingGroupRequest, await body(c))
  return respond(c, await withScope(c, (x) => moveRepeatingGroup(x, req), { meta: false }))
})

tableNormalizationRoutes.post('/:db/tables/:t/normalization/2nf/new-tables', async (c) => {
  const req = parse(NewTables2NFRequest, await body(c))
  return c.json(await withScope(c, async (x) => newTables2NF(x, req.pd), { meta: false }))
})

tableNormalizationRoutes.post('/:db/tables/:t/normalization/2nf/create-new-tables', async (c) => {
  const req = parse(CreateTables2NFRequest, await body(c))
  return respond(c, await withScope(c, (x) => createTables2NF(x, req), { meta: false }))
})

tableNormalizationRoutes.post('/:db/tables/:t/normalization/3nf/new-tables', async (c) => {
  const req = parse(NewTables3NFRequest, await body(c))
  return c.json(await withScope(c, (x) => newTables3NF(x, req.pd, req.tables), { meta: false, table: false }))
})

tableNormalizationRoutes.post('/:db/tables/:t/normalization/3nf/create-new-tables', async (c) => {
  const req = parse(CreateTables3NFRequest, await body(c))
  return respond(c, await withScope(c, (x) => createTables3NF(x, req), { meta: false, table: false }))
})

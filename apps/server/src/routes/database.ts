import {
  AddPrefixRequest,
  BulkFkRequest,
  BulkTablesRequest,
  CentralColumnsRequest,
  CopyTablesRequest,
  DbCollationRequest,
  DbCommentRequest,
  DbRenameCopyRequest,
  DbSearchRequest,
  DbStructureQuery,
  DbTrackingRequest,
  DesignerAddRelationRequest,
  DesignerDeletePageRequest,
  DesignerDisplayFieldRequest,
  DesignerQuery,
  DesignerRemoveRelationRequest,
  DesignerSavePageRequest,
  DesignerSettingRequest,
  DesignerTableQuery,
  EventSaveRequest,
  MaintenanceRequest,
  ReplacePrefixRequest,
  RoutineExecuteRequest,
  RoutineSaveRequest,
  SchemaExportRequest,
  TriggerSaveRequest,
} from '@bettermyadmin/contracts'
import { type Context, Hono } from 'hono'
import {
  addPrefix,
  copyForm,
  copyTables,
  copyWithPrefix,
  dropTables,
  emptyTables,
  replacePrefix,
  showCreate,
} from '../database/bulk.ts'
import {
  centralAddTables,
  centralColumnsAction,
  centralColumnsEditRows,
  centralColumnsPage,
  centralColumnsPick,
  centralColumnsPopulate,
  centralMakeConsistent,
  centralRemoveTables,
} from '../database/central-columns.ts'
import { parse, withDb } from '../database/context.ts'
import { dataDictionary } from '../database/data-dictionary.ts'
import {
  designerAddRelation,
  designerAddTable,
  designerDelete,
  designerPage,
  designerPageList,
  designerRemoveRelation,
  designerSavePage,
  designerSetDisplayField,
  designerSetting,
} from '../database/designer.ts'
import { eventData, eventsList, exportEvent, saveEvent } from '../database/events.ts'
import { multiTableForm, multiTableKeys } from '../database/multi-table.ts'
import { changeCollation, operationsPage, renameOrCopy, saveComment } from '../database/operations.ts'
import {
  executeForm,
  executeRoutine,
  exportRoutine,
  routineEditor,
  routinesList,
  saveRoutine,
} from '../database/routines.ts'
import { schemaExport, schemaExportForm } from '../database/schema-export.ts'
import { search, searchForm } from '../database/search.ts'
import { realRowCountAction, structurePage } from '../database/structure.ts'
import { trackingAction, trackingPage } from '../database/tracking.ts'
import { exportTrigger, saveTrigger, triggerData, triggersList } from '../database/triggers.ts'
import { maintenance } from '../table/maintenance.ts'
import type { ServerEnv } from './server.ts'

/**
 * Database level pages (docs/features/05-database-level.md). Mounted at /api/servers/:s/databases.
 */
export const databaseRoutes = new Hono<ServerEnv>()

const body = async (c: Context<ServerEnv>) => c.req.json().catch(() => ({}))

// ---------------------------------------------------------------- Structure

/** GET …/:db/structure (pma: /database/structure) */
databaseRoutes.get('/:db/structure', async (c) => {
  const q = parse(DbStructureQuery, c.req.query())
  return c.json(await withDb(c, (ctx) => structurePage(ctx, q)))
})

/** GET …/:db/structure/real-row-count?table=t | ?all=1 (pma: /database/structure/real-row-count) */
databaseRoutes.get('/:db/structure/real-row-count', async (c) => {
  const table = c.req.query('table')
  const all = c.req.query('all') !== undefined
  return c.json(
    await withDb(c, (ctx) => realRowCountAction(ctx, table === undefined ? { all } : { table, all })),
  )
})

/** GET …/:db/structure/copy-form (pma: /database/structure/copy-form) */
databaseRoutes.get('/:db/structure/copy-form', async (c) => c.json(await withDb(c, copyForm)))

/** pma: /database/structure/empty-table */
databaseRoutes.post('/:db/structure/empty', async (c) => {
  const req = parse(BulkFkRequest, await body(c))
  return c.json(await withDb(c, (ctx) => emptyTables(ctx, req)))
})

/** pma: /database/structure/drop-table */
databaseRoutes.post('/:db/structure/drop', async (c) => {
  const req = parse(BulkFkRequest, await body(c))
  return c.json(await withDb(c, (ctx) => dropTables(ctx, req)))
})

/** pma: /database/structure/add-prefix-table */
databaseRoutes.post('/:db/structure/add-prefix', async (c) => {
  const req = parse(AddPrefixRequest, await body(c))
  return c.json(await withDb(c, (ctx) => addPrefix(ctx, req)))
})

/** pma: /database/structure/replace-prefix */
databaseRoutes.post('/:db/structure/replace-prefix', async (c) => {
  const req = parse(ReplacePrefixRequest, await body(c))
  return c.json(await withDb(c, (ctx) => replacePrefix(ctx, req)))
})

/** pma: /database/structure/copy-table-with-prefix */
databaseRoutes.post('/:db/structure/copy-with-prefix', async (c) => {
  const req = parse(ReplacePrefixRequest, await body(c))
  return c.json(await withDb(c, (ctx) => copyWithPrefix(ctx, req)))
})

/** pma: /database/structure/copy-table */
databaseRoutes.post('/:db/structure/copy', async (c) => {
  const req = parse(CopyTablesRequest, await body(c))
  return c.json(await withDb(c, (ctx) => copyTables(ctx, req)))
})

/** pma: /database/structure/show-create */
databaseRoutes.post('/:db/structure/show-create', async (c) => {
  const req = parse(BulkTablesRequest, await body(c))
  return c.json(await withDb(c, (ctx) => showCreate(ctx, req.tables)))
})

/** pma: /table/maintenance/{analyze,check,checksum,optimize,repair} */
databaseRoutes.post('/:db/structure/maintenance', async (c) => {
  const req = parse(MaintenanceRequest, await body(c))
  return c.json(await withDb(c, (ctx) => maintenance(ctx, { ...req, tables: req.tables ?? [] })))
})

// ---------------------------------------------------------------- Operations

/** pma: GET /database/operations */
databaseRoutes.get('/:db/operations', async (c) => c.json(await withDb(c, operationsPage)))

/** pma: POST /database/operations comment= */
databaseRoutes.post('/:db/operations/comment', async (c) => {
  const req = parse(DbCommentRequest, await body(c))
  return c.json(await withDb(c, (ctx) => saveComment(ctx, req.comment)))
})

/** pma: /database/operations/collation */
databaseRoutes.post('/:db/operations/collation', async (c) => {
  const req = parse(DbCollationRequest, await body(c))
  return c.json(await withDb(c, (ctx) => changeCollation(ctx, req)))
})

/** pma: POST /database/operations db_rename=true */
databaseRoutes.post('/:db/operations/rename', async (c) => {
  const req = parse(DbRenameCopyRequest, await body(c))
  return c.json(await withDb(c, (ctx) => renameOrCopy(ctx, { ...req, move: true, what: 'data' })))
})

/** pma: POST /database/operations db_copy=true */
databaseRoutes.post('/:db/operations/copy', async (c) => {
  const req = parse(DbRenameCopyRequest, await body(c))
  return c.json(await withDb(c, (ctx) => renameOrCopy(ctx, { ...req, move: false })))
})

// ---------------------------------------------------------------- Search

/** pma: GET /database/search (the form) */
databaseRoutes.get('/:db/search', async (c) => c.json(await withDb(c, searchForm)))

/** pma: POST /database/search submit_search */
databaseRoutes.post('/:db/search', async (c) => {
  const req = parse(DbSearchRequest, await body(c))
  return c.json(await withDb(c, (ctx) => search(ctx, req)))
})

// ---------------------------------------------------------------- Routines

/** pma: /database/routines (list) */
databaseRoutes.get('/:db/routines', async (c) =>
  c.json(await withDb(c, (ctx) => routinesList(ctx, { type: c.req.query('type'), pos: c.req.query('pos') }))),
)

/** pma: /database/routines add_item / edit_item (the editor's data) */
databaseRoutes.get('/:db/routines/editor', async (c) => {
  const name = c.req.query('name')
  const type = c.req.query('type') ?? ''
  return c.json(await withDb(c, (ctx) => routineEditor(ctx, name, type)))
})

/** pma: /database/routines editor_process_add / editor_process_edit */
databaseRoutes.post('/:db/routines', async (c) => {
  const req = parse(RoutineSaveRequest, await body(c))
  return c.json(await withDb(c, (ctx) => saveRoutine(ctx, req)))
})

/** pma: /database/routines execute_dialog */
databaseRoutes.get('/:db/routines/execute', async (c) =>
  c.json(await withDb(c, (ctx) => executeForm(ctx, c.req.query('name') ?? '', c.req.query('type') ?? ''))),
)

/** pma: /database/routines execute_routine */
databaseRoutes.post('/:db/routines/execute', async (c) => {
  const req = parse(RoutineExecuteRequest, await body(c))
  return c.json(await withDb(c, (ctx) => executeRoutine(ctx, req)))
})

/** pma: /database/routines export_item */
databaseRoutes.get('/:db/routines/export', async (c) =>
  c.json(await withDb(c, (ctx) => exportRoutine(ctx, c.req.query('name') ?? '', c.req.query('type') ?? ''))),
)

// ---------------------------------------------------------------- Events

/** pma: /events and /events/export (Events\IndexController, Events\ExportController) */
const eventsDb = (c: Context<ServerEnv>) => ({ noDatabase: c.get('tr').gettext('No database selected.') })
databaseRoutes.get('/:db/events', async (c) => c.json(await withDb(c, eventsList, eventsDb(c))))

databaseRoutes.get('/:db/events/editor', async (c) =>
  c.json(await withDb(c, (ctx) => eventData(ctx, c.req.query('name') ?? ''), eventsDb(c))),
)

databaseRoutes.post('/:db/events', async (c) => {
  const req = parse(EventSaveRequest, await body(c))
  return c.json(await withDb(c, (ctx) => saveEvent(ctx, req), eventsDb(c)))
})

databaseRoutes.get('/:db/events/export', async (c) =>
  c.json(await withDb(c, (ctx) => exportEvent(ctx, c.req.query('name') ?? ''), eventsDb(c))),
)

// ---------------------------------------------------------------- Triggers (database or table scope)

/** pma: /triggers?db=…[&table=…] */
databaseRoutes.get('/:db/triggers', async (c) =>
  c.json(await withDb(c, (ctx) => triggersList(ctx, c.req.query('table') ?? ''))),
)

databaseRoutes.get('/:db/triggers/editor', async (c) =>
  c.json(await withDb(c, (ctx) => triggerData(ctx, c.req.query('table') ?? '', c.req.query('name') ?? ''))),
)

databaseRoutes.post('/:db/triggers', async (c) => {
  const req = parse(TriggerSaveRequest, await body(c))
  return c.json(await withDb(c, (ctx) => saveTrigger(ctx, c.req.query('table') ?? '', req)))
})

databaseRoutes.get('/:db/triggers/export', async (c) =>
  c.json(await withDb(c, (ctx) => exportTrigger(ctx, c.req.query('table') ?? '', c.req.query('name') ?? ''))),
)

// ---------------------------------------------------------------- Multi-table query

/** pma: /database/multi-table-query */
databaseRoutes.get('/:db/multi-table-query', async (c) => c.json(await withDb(c, multiTableForm)))

/** pma: /database/multi-table-query/tables?tables[]=… */
databaseRoutes.get('/:db/multi-table-query/tables', async (c) =>
  c.json(await withDb(c, (ctx) => multiTableKeys(ctx, c.req.queries('tables') ?? []))),
)

// ---------------------------------------------------------------- Central columns

/** pma: /database/central-columns (main; `pos` / `total_rows`) */
databaseRoutes.get('/:db/central-columns', async (c) =>
  c.json(
    await withDb(c, (ctx) =>
      centralColumnsPage(ctx, { pos: c.req.query('pos'), totalRows: c.req.query('total_rows') }),
    ),
  ),
)

/** pma: /database/central-columns (add_new_column, edit_save, multi_edit_central_column_save, add_column, delete_save) */
databaseRoutes.post('/:db/central-columns', async (c) => {
  const req = parse(CentralColumnsRequest, await body(c))
  return c.json(await withDb(c, (ctx) => centralColumnsAction(ctx, req)))
})

/** pma: /database/central-columns edit_central_columns_page (selected_fld[]) */
databaseRoutes.get('/:db/central-columns/edit', async (c) =>
  c.json(await withDb(c, (ctx) => centralColumnsEditRows(ctx, c.req.queries('columns') ?? []))),
)

/** pma: /database/central-columns/populate (selectedTable) */
databaseRoutes.get('/:db/central-columns/populate', async (c) =>
  c.json(await withDb(c, (ctx) => centralColumnsPopulate(ctx, c.req.query('table') ?? ''))),
)

/** pma: /database/central-columns getColumnList (cur_table) */
databaseRoutes.get('/:db/central-columns/list', async (c) =>
  c.json(await withDb(c, (ctx) => centralColumnsPick(ctx, c.req.query('table') ?? ''))),
)

/** pma: /database/structure/central-columns/{add,remove,make-consistent} */
databaseRoutes.post('/:db/structure/central-add', async (c) => {
  const req = parse(BulkTablesRequest, await body(c))
  return c.json(await withDb(c, (ctx) => centralAddTables(ctx, req.tables)))
})
databaseRoutes.post('/:db/structure/central-remove', async (c) => {
  const req = parse(BulkTablesRequest, await body(c))
  return c.json(await withDb(c, (ctx) => centralRemoveTables(ctx, req.tables)))
})
databaseRoutes.post('/:db/structure/central-make-consistent', async (c) => {
  const req = parse(BulkTablesRequest, await body(c))
  return c.json(await withDb(c, (ctx) => centralMakeConsistent(ctx, req.tables)))
})

// ---------------------------------------------------------------- Data dictionary, privileges, tracking

/** pma: /database/data-dictionary */
databaseRoutes.get('/:db/data-dictionary', async (c) => c.json(await withDb(c, dataDictionary)))

/** pma: /database/tracking */
databaseRoutes.get('/:db/tracking', async (c) => c.json(await withDb(c, trackingPage)))

/** pma: /database/tracking (delete_tracking, submit_mult=delete_tracking, submit_create_version) */
databaseRoutes.post('/:db/tracking', async (c) => {
  const req = parse(DbTrackingRequest, await body(c))
  return c.json(await withDb(c, (ctx) => trackingAction(ctx, req)))
})

// ---------------------------------------------------------------- Designer

/** GET …/:db/designer?page=&query= (pma: /database/designer) */
databaseRoutes.get('/:db/designer', async (c) => {
  const q = parse(DesignerQuery, c.req.query())
  return c.json(await withDb(c, (ctx) => designerPage(ctx, q)))
})

/** GET …/:db/designer/pages (pma: /database/designer dialog=edit|delete|save_as) */
databaseRoutes.get('/:db/designer/pages', async (c) => c.json(await withDb(c, designerPageList)))

/** GET …/:db/designer/table?db=&table= (pma: /database/designer dialog=add_table) */
databaseRoutes.get('/:db/designer/table', async (c) => {
  const q = parse(DesignerTableQuery, c.req.query())
  return c.json(await withDb(c, (ctx) => designerAddTable(ctx, q.db, q.table)))
})

/** GET …/:db/designer/export?page=&format= (pma: /database/designer dialog=export) */
databaseRoutes.get('/:db/designer/export', async (c) => {
  const page = Number.parseInt(c.req.query('page') ?? '0', 10) || 0
  const format = c.req.query('format') ?? ''
  return c.json(await withDb(c, async (ctx) => schemaExportForm(ctx, page, format)))
})

/** pma: /database/designer operation=savePage */
databaseRoutes.post('/:db/designer/save-page', async (c) => {
  const req = parse(DesignerSavePageRequest, await body(c))
  return c.json(await withDb(c, (ctx) => designerSavePage(ctx, req)))
})

/** pma: /database/designer operation=deletePage */
databaseRoutes.post('/:db/designer/delete-page', async (c) => {
  const req = parse(DesignerDeletePageRequest, await body(c))
  return c.json(await withDb(c, (ctx) => designerDelete(ctx, req.selected_page)))
})

/** pma: /database/designer operation=setDisplayField */
databaseRoutes.post('/:db/designer/display-field', async (c) => {
  const req = parse(DesignerDisplayFieldRequest, await body(c))
  return c.json(await withDb(c, (ctx) => designerSetDisplayField(ctx, req.db, req.table, req.field)))
})

/** pma: /database/designer operation=addNewRelation */
databaseRoutes.post('/:db/designer/add-relation', async (c) => {
  const req = parse(DesignerAddRelationRequest, await body(c))
  return c.json(await withDb(c, (ctx) => designerAddRelation(ctx, req)))
})

/** pma: /database/designer operation=removeRelation */
databaseRoutes.post('/:db/designer/remove-relation', async (c) => {
  const req = parse(DesignerRemoveRelationRequest, await body(c))
  return c.json(await withDb(c, (ctx) => designerRemoveRelation(ctx, req)))
})

/** pma: /database/designer operation=save_setting_value */
databaseRoutes.post('/:db/designer/setting', async (c) => {
  const req = parse(DesignerSettingRequest, await body(c))
  return c.json(await withDb(c, (ctx) => designerSetting(ctx, req.index, req.value)))
})

/** pma: /schema-export */
databaseRoutes.post('/:db/schema-export', async (c) => {
  const req = parse(SchemaExportRequest, await body(c))
  return c.json(await withDb(c, (ctx) => schemaExport(ctx, req)))
})

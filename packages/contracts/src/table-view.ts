import { z } from 'zod'
import { SqlMessage } from './table-structure.ts'

/**
 * The view form: Create view (navigation "New", the query results' "Create view") and Edit view
 * (table Structure, database Structure). Mounted at /api/servers/:s/databases/:db/views….
 *
 * pma: src/Controllers/View/CreateController.php, resources/templates/view_create.twig
 */

export const ViewData = z.object({
  /** OR REPLACE (create only) */
  orReplace: z.boolean().default(false),
  algorithm: z.string().default(''),
  definer: z.string().default(''),
  sqlSecurity: z.string().default(''),
  /** VIEW name (create) — the edited view (alter, a hidden input) */
  name: z.string(),
  columnNames: z.string().default(''),
  /** AS: the SELECT */
  as: z.string().default(''),
  /** WITH CHECK OPTION */
  with: z.string().default(''),
})
export type ViewData = z.infer<typeof ViewData>

/** GET …/views/form?table=v (Edit view) | ?sql=… (Create view prefilled with the query) */
export const ViewFormResponse = z.object({
  db: z.string(),
  operation: z.enum(['create', 'alter']),
  view: ViewData,
  algorithmOptions: z.array(z.string()),
  securityOptions: z.array(z.string()),
  withOptions: z.array(z.string()),
  /** $cfg['CodemirrorEnable'] (the AS editor) */
  codemirror: z.boolean(),
})
export type ViewFormResponse = z.infer<typeof ViewFormResponse>

/** POST …/views (createview / alterview) */
export const ViewSaveRequest = z.object({
  operation: z.enum(['create', 'alter']),
  view: ViewData,
})
export type ViewSaveRequest = z.input<typeof ViewSaveRequest>

export const ViewSaveResponse = z.object({
  ok: z.boolean(),
  /** success with the statement, or the error (statement + server error) */
  messages: z.array(SqlMessage),
})
export type ViewSaveResponse = z.infer<typeof ViewSaveResponse>

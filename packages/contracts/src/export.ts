import { z } from 'zod'

/**
 * Export (docs/features/07-export-import.md). The export form is posted as phpMyAdmin's own field
 * pairs (`what`, `export_type`, `sql_include_comments`, `table_select[]` …) so every option keeps
 * phpMyAdmin's name and semantics.
 */
export const FormPairs = z.array(z.tuple([z.string(), z.string()]))
export type FormPairs = z.infer<typeof FormPairs>

/** POST …/export: validates and registers the dump; the download URL streams it. */
export const ExportRequest = z.object({ params: FormPairs })
export type ExportRequest = z.infer<typeof ExportRequest>

export const ExportResponse = z.object({
  /** one-shot download id (GET …/export/:id); absent when saved on the server */
  id: z.string().optional(),
  filename: z.string(),
  mimeType: z.string(),
  /** false: "View output as text" */
  asFile: z.boolean(),
  /** save-on-server outcome (flash message phpMyAdmin redirects with) */
  message: z.object({ type: z.enum(['success', 'error']), text: z.string() }).optional(),
})
export type ExportResponse = z.infer<typeof ExportResponse>

/** One option control of a plugin (src/Properties/Options/**), texts translated, may hold HTML. */
export interface PluginOptionItem {
  kind: 'bool' | 'text' | 'number' | 'select' | 'radio' | 'hidden' | 'message' | 'subgroup'
  name: string
  text: string
  values?: Array<[string, string]>
  size?: number
  len?: number
  doc?: readonly string[] | string
  /** current value (Plugins::getDefault / checkboxCheck) */
  value?: string
  checked?: boolean
  header?: PluginOptionItem | null
  items?: PluginOptionItem[]
  /** database scope: the plugin's configured structure/data choice (`<name>_default` field) */
  dbDefault?: string
}

export interface PluginOptionGroup {
  kind: 'main'
  name: string
  text: string
  items: PluginOptionItem[]
}

export interface PluginInfo {
  name: string
  text: string
  extension: string
  forceFile: boolean
  options: PluginOptionGroup[] | null
}

export type ExportScope = 'server' | 'database' | 'table' | 'raw'

/** GET …/export/page: the export page view-model (src/Export/Options.php::getOptions). */
export interface ExportPageResponse {
  exportType: ExportScope
  db: string
  table: string
  singleTable: boolean
  sqlQuery: string
  title: string
  exportMethod: string
  quickOrCustom: 'quick' | 'custom'
  plugins: PluginInfo[]
  selectedPlugin: string
  databases?: Array<{ name: string; selected: boolean }>
  tables?: Array<{ name: string; isView: boolean; select: boolean; structure: boolean; data: boolean }>
  rows?: { allrows: '0' | '1'; limitTo: string; limitFrom: string } | null
  saveDir: string
  onServer: boolean
  onServerOverwrite: boolean
  quickExportOnServer: boolean
  quickExportOnServerOverwrite: boolean
  lockTables: boolean
  asFile: boolean
  filenameTemplate: string
  rememberTemplate: boolean
  charsets: string[] | null
  charset: string
  compressions: Array<'zip' | 'gzip'>
  compression: string
  asSeparateFiles: boolean
  hasAliases: boolean
  templates: { enabled: boolean; list: Array<{ id: number; name: string }>; selected: number | null }
  execTimeLimit: number
  kanji: boolean
}

export const ExportTemplateCreate = z.object({
  exportType: z.string(),
  templateName: z.string().min(1),
  templateData: z.string(),
})
export const ExportTemplateUpdate = z.object({ templateId: z.number().int(), templateData: z.string() })
export const ExportTemplateId = z.object({ templateId: z.number().int() })

/** Template CRUD answer (pma: /export/template/* JSON). */
export interface ExportTemplateResult {
  success: boolean
  message?: string
  /** load: the saved form object as JSON */
  data?: string
  /** create: the user's templates of that export type */
  templates?: Array<{ id: number; name: string }>
}

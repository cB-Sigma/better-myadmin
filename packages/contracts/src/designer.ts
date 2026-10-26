import { z } from 'zod'
import type { PluginInfo } from './export.ts'
import type { SqlMessage } from './table-structure.ts'

/**
 * The Designer (docs/features/05-database-level.md) and the relational schema export.
 * pma: src/Controllers/Database/DesignerController.php, src/Database/Designer.php,
 *      src/Database/Designer/Common.php, src/Controllers/SchemaExportController.php
 */

export interface DesignerColumn {
  name: string
  /** COLUMN_TYPE */
  type: string
  /** Designer::getColumnTypes: the column icon (`designer/FieldKey_small`, `designer/Field_small_int`, …) */
  icon: string
  /** Common::getAllKeys: absent from every index (null), unique/primary (true), other index (false) */
  key: boolean | null
}

export interface DesignerTable {
  db: string
  table: string
  /** DesignerTable::supportsForeignkeys (j_tabs) */
  supportsFk: boolean
  /** Relation::getDisplayField, null when none */
  displayField: string | null
  columns: DesignerColumn[]
  /** the saved position on the displayed page, else the random default (X 20–700, Y 20–550) */
  x: number
  y: number
  /** saved on the displayed page (tab_pos): shown; otherwise shown only on a new page */
  onPage: boolean
}

/** One entry of Common::getScriptContr: a relation drawn when both tables are on the canvas. */
export interface DesignerRelation {
  /** the FOREIGN KEY constraint name, '' for an internal relation */
  constraint: string
  /** `db.table` of the referencing (master) side */
  masterTable: string
  masterField: string
  /** `db.table` of the referenced side */
  foreignTable: string
  foreignField: string
}

/** Designer::returnClassNamesFromMenuButtons: which side menu buttons start selected. */
export interface DesignerSideMenu {
  angular_direct: boolean
  snap_to_grid: boolean
  pin_text: boolean
  relation_lines: boolean
  small_big_all: boolean
  side_menu: boolean
}

export const DesignerQuery = z.object({
  page: z.string().optional(),
  /** the visual query builder (`?query`) */
  query: z.string().optional(),
})
export type DesignerQuery = z.output<typeof DesignerQuery>

export interface DesignerResponse {
  db: string
  /** the page shown, -1 for an unsaved one */
  displayPage: number
  /** its name, null for an unsaved page */
  selectedPage: string | null
  visualBuilder: boolean
  /** the pdf pages feature is configured (pages are saved in the configuration storage) */
  tablesEnabled: boolean
  sideMenu: DesignerSideMenu
  tables: DesignerTable[]
  relations: DesignerRelation[]
  /** CodemirrorEnable (the Build Query editor) */
  codemirror: boolean
}

/** dialog=edit|delete|save_as: the database's pages (page_selector.twig) */
export interface DesignerPagesResponse {
  pdfwork: boolean
  pages: Array<{ id: number; name: string }>
}

/** dialog=export (schema_export.twig) */
export interface SchemaExportFormResponse {
  page: number
  /** the plugin selected in the "Select export relational type" list */
  choice: string
  plugins: PluginInfo[]
}

/** t_x / t_y / t_v / t_h / t_db / t_tbl of one table (DesignerMove.getUrlPos) */
export const DesignerTablePosition = z.object({
  x: z.string(),
  y: z.string(),
  v: z.boolean(),
  h: z.boolean(),
  db: z.string(),
  table: z.string(),
})
export type DesignerTablePosition = z.output<typeof DesignerTablePosition>

export const DesignerSavePageRequest = z.object({
  save_page: z.enum(['same', 'new']),
  selected_page: z.string().default('0'),
  selected_value: z.string().default(''),
  tables: z.array(DesignerTablePosition),
})
export type DesignerSavePageRequest = z.output<typeof DesignerSavePageRequest>

export interface DesignerSavePageResponse {
  success: boolean
  /** the new page's id (save_page=new) */
  id?: number
  /** "There already exists a page named …" */
  message?: string
}

export const DesignerDeletePageRequest = z.object({ selected_page: z.string() })

export const DesignerDisplayFieldRequest = z.object({
  /** the table's database (a table added from another database keeps its own) */
  db: z.string(),
  table: z.string(),
  field: z.string(),
})

export const DesignerAddRelationRequest = z.object({
  DB1: z.string(),
  T1: z.string(),
  F1: z.string(),
  DB2: z.string(),
  T2: z.string(),
  F2: z.string(),
  on_delete: z.string().default('nix'),
  on_update: z.string().default('nix'),
})
export type DesignerAddRelationRequest = z.output<typeof DesignerAddRelationRequest>

export const DesignerRemoveRelationRequest = z.object({
  /** `db.table` of the referenced side */
  T1: z.string(),
  F1: z.string(),
  /** `db.table` of the referencing side */
  T2: z.string(),
  F2: z.string(),
})
export type DesignerRemoveRelationRequest = z.output<typeof DesignerRemoveRelationRequest>

export const DesignerSettingRequest = z.object({ index: z.string(), value: z.string() })

/** setDisplayField / addNewRelation / removeRelation: setRequestStatus + the message */
export interface DesignerActionResponse {
  success: boolean
  message: SqlMessage
}

export const DesignerTableQuery = z.object({ db: z.string(), table: z.string() })

export const SchemaExportRequest = z.object({
  page_number: z.string().default('-1'),
  export_type: z.string().default(''),
  offline_export: z.boolean().default(false),
  /** the format-specific options posted (`svg_show_color` = 'y', `dia_paper` = 'A4', …) */
  options: z.record(z.string(), z.string()).default({}),
  tables: z.array(DesignerTablePosition).default([]),
})
export type SchemaExportRequest = z.output<typeof SchemaExportRequest>

/** the downloaded file (Core::downloadHeader) */
export interface SchemaExportResponse {
  fileName: string
  mediaType: string
  /** the file: text, or base64 when `encoding` says so (PDF) */
  data: string
  encoding?: 'base64'
}

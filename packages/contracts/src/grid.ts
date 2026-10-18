import { z } from 'zod'

/**
 * The results grid of a statement (Browse tab, SQL tab, every /sql response): everything
 * src/Display/Results.php decides on the server, as data instead of HTML.
 */

/** A query and its signature (Core::signSqlQuery) — every generated link carries one. */
export const SignedSql = z.object({ sql: z.string(), sig: z.string() })
export type SignedSql = z.infer<typeof SignedSql>

/** pma: src/Display/DisplayParts.php (+ DeleteLinkEnum) */
export const DisplayParts = z.object({
  editLink: z.boolean(),
  deleteLink: z.enum(['none', 'delete', 'kill']),
  sortLink: z.boolean(),
  navigation: z.boolean(),
  bookmarkForm: z.boolean(),
  textButton: z.boolean(),
  printLink: z.boolean(),
})
export type DisplayParts = z.infer<typeof DisplayParts>

/** `$_SESSION['tmpval']` for this query (Results::setConfigParamsForDisplayTable). */
export const GridView = z.object({
  pos: z.number().int(),
  maxRows: z.union([z.number().int(), z.literal('all')]),
  pftext: z.enum(['P', 'F']),
  relationalDisplay: z.enum(['K', 'D']),
  geoOption: z.enum(['GEOM', 'WKT', 'WKB']),
  displayBinary: z.boolean(),
  displayBlob: z.boolean(),
  hideTransformation: z.boolean(),
  repeatCells: z.number().int(),
  /** possible_as_geometry: the "Geometry" radio of the options */
  possibleAsGeometry: z.boolean(),
})
export type GridView = z.infer<typeof GridView>

export const GridSort = z.object({
  /** plain click: ORDER BY only this column */
  single: SignedSql,
  /** Shift+click: url-add-order */
  add: SignedSql,
  /** Ctrl/Alt+click: url-remove-order (+ discard_remembered_sort when no ORDER BY remains) */
  remove: SignedSql.extend({ discard: z.boolean() }),
  /** current direction when the column is in the ORDER BY */
  dir: z.enum(['ASC', 'DESC']).nullable(),
  /** 1-based position in the ORDER BY (`<small>N</small>`) */
  position: z.number().int().nullable(),
})

export const GridColumn = z.object({
  /** index in the result fields */
  index: z.number().int(),
  name: z.string(),
  /** native column comment (full text; shown cut at LimitChars + …), null when none */
  comment: z.string().nullable(),
  /** Results::isColumnNumeric (text-end) */
  numeric: z.boolean(),
  /** used in the WHERE clause (class condition) */
  condition: z.boolean(),
  /** hidden by the col_visib preference */
  hidden: z.boolean(),
  sort: GridSort.nullable(),
  /** FieldMetadata::getMappedType() (data-type) */
  dataType: z.string(),
  decimals: z.number().int(),
})
export type GridColumn = z.infer<typeof GridColumn>

/** One data cell (Results::getRowValues and the build*Display templates). */
export const GridCell = z.object({
  /** null / empty string / value */
  k: z.enum(['null', 'empty', 'v']),
  /** the td classes except `hide` (data, grid_edit click1|click2, not_null, relation, …) */
  cls: z.string(),
  /** displayed text (plain; newlines and double spaces are rendered like mimeDefaultFunction) */
  t: z.string().optional(),
  /** data-originallength of a truncated cell */
  ol: z.number().int().optional(),
  /** FK link: SELECT * FROM fdb.ft WHERE ff = value (relational key/display) */
  fk: z
    .object({
      db: z.string(),
      table: z.string(),
      sql: z.string(),
      sig: z.string(),
      title: z.string(),
      /** relational display column mode and the display value is NULL */
      nullDisplay: z.boolean().optional(),
    })
    .optional(),
  /** download link of a binary/BLOB cell (/table/get-field) */
  dl: z.object({ where: z.string(), sig: z.string(), key: z.string(), table: z.string() }).optional(),
  /** text shown highlighted as code (built-in SQL / JSON transformations) */
  code: z.enum(['sql', 'json']).optional(),
  /**
   * Browser display transformation of the column (pma__column_info), rendered client-side by
   * features/transformations/registry.tsx: plugin file, options, the raw value (base64) and the
   * cell's wrapper parameters.
   */
  tf: z
    .object({
      file: z.string(),
      options: z.array(z.string()),
      mimetype: z.string(),
      b64: z.string(),
      db: z.string(),
      table: z.string(),
      column: z.string(),
      where: z.string(),
      sig: z.string(),
      isInt: z.boolean(),
      isBinary: z.boolean(),
      /** Text_Plain_External with programs configured: the program's output (run on the server) */
      external: z.string().optional(),
    })
    .optional(),
})
export type GridCell = z.infer<typeof GridCell>

export const GridRow = z.object({
  /** UniqueCondition::getWhereClause() */
  where: z.string(),
  whereSig: z.string(),
  unique: z.boolean(),
  /** condition_array (key → "= 'v'" / "IS NULL") */
  cond: z.array(z.tuple([z.string(), z.string()])),
  /** Delete link: DELETE FROM `t` WHERE … [LIMIT 1] (+ the confirm text) */
  del: z.object({ sql: z.string(), sig: z.string(), confirm: z.string() }).optional(),
  /** SHOW PROCESSLIST: KILL <id> */
  kill: z.object({ sql: z.string(), sig: z.string() }).optional(),
  cells: z.array(GridCell),
})
export type GridRow = z.infer<typeof GridRow>

export const GridNavigation = z.object({
  posNext: z.number().int(),
  posPrevious: z.number().int(),
  posLast: z.number().int(),
  isShowingAll: z.boolean(),
  isLastPage: z.boolean(),
  isLastPageKnown: z.boolean(),
  /** the End form's onsubmit result */
  endAllowed: z.boolean(),
  hasShowAll: z.boolean(),
  /** session_max_rows the Show all checkbox posts */
  showAllMaxRows: z.union([z.number().int(), z.literal('all')]),
  /** Util::pageselector pages (1-based) when there is more than one page */
  pages: z.array(z.number().int()),
  pageNow: z.number().int(),
  totalPages: z.number().int(),
})

export const SortByKey = z.object({
  options: z.array(z.object({ label: z.string(), sql: z.string(), selected: z.boolean() })),
  /** session_max_rows kept when changing the key */
  maxRows: z.union([z.number().int(), z.literal('all')]).nullable(),
})

export const GridOperations = z.object({
  print: z.boolean(),
  procedure: z.boolean(),
  /** SELECT: Export / Display chart (with the url params of getResultsOperations) */
  export: z
    .object({
      table: z.string(),
      singleTable: z.boolean(),
      rawQuery: z.boolean(),
      unlimNumRows: z.number().int(),
    })
    .nullable(),
  gis: z.boolean(),
})

export const GridData = z.object({
  db: z.string(),
  table: z.string(),
  /** the query the links act on (Results::$sqlQuery) */
  sql: z.string(),
  sig: z.string(),
  displayParts: DisplayParts,
  editable: z.boolean(),
  /** getMessageIfMissingColumnIndex: null | 'unavailable' | 'undesired' */
  missingUnique: z.enum(['unavailable', 'undesired']).nullable(),
  gridEdit: z.enum(['click', 'double-click', 'disabled']),
  /** isLimitedDisplay (empty result) */
  limited: z.boolean(),
  view: GridView,
  numRows: z.number().int(),
  unlimNumRows: z.number().int(),
  total: z.number().int(),
  /** a view with an uncounted total: "Showing rows N - ..." + hint */
  viewHint: z.boolean(),
  navigation: GridNavigation.nullable(),
  sortByKey: SortByKey.nullable(),
  columns: z.array(GridColumn),
  rows: z.array(GridRow),
  /** Results::isClauseUnique (bulk form) */
  clauseIsUnique: z.boolean(),
  hasExportButton: z.boolean(),
  operations: GridOperations.nullable(),
  /** relwork && displaywork: the Relational key / Display column radios */
  relationOptions: z.boolean(),
  /** column reorder/visibility (getDataForResettingColumnOrder) */
  columnOrder: z
    .object({
      order: z.array(z.number().int()).nullable(),
      visibility: z.array(z.number().int()).nullable(),
      isView: z.boolean(),
      createTime: z.string().nullable(),
    })
    .nullable(),
  /** the full/partial text toggle (and the msgid of its title) */
  textToggle: z.object({ pftext: z.enum(['P', 'F']), title: z.string() }).nullable(),
  settings: z.object({
    RowActionLinks: z.string(),
    RowActionType: z.string(),
    LimitChars: z.number().int(),
    SaveCellsAtOnce: z.boolean(),
    BrowsePointerEnable: z.boolean(),
    BrowseMarkerEnable: z.boolean(),
    TableNavigationLinksMode: z.string(),
    InitialSlidersState: z.string(),
    Confirm: z.boolean(),
    MaxRows: z.number().int(),
    ShowAll: z.boolean(),
    AllowSharedBookmarks: z.boolean(),
  }),
})
export type GridData = z.infer<typeof GridData>

/**
 * POST /api/servers/:s/browse — the /sql controller (Browse tab, sort/page/options links, Refresh,
 * single-row Delete, FK links). `sig` must verify when given (signed GET links).
 */
export const BrowseRequest = z.object({
  db: z.string(),
  table: z.string().default(''),
  sql: z.string().optional(),
  sig: z.string().optional(),
  pos: z.number().int().min(0).optional(),
  maxRows: z.union([z.number().int().positive(), z.literal('all')]).optional(),
  pftext: z.enum(['P', 'F']).optional(),
  relationalDisplay: z.enum(['K', 'D']).optional(),
  geoOption: z.enum(['GEOM', 'WKT', 'WKB']).optional(),
  displayBinary: z.boolean().optional(),
  displayBlob: z.boolean().optional(),
  hideTransformation: z.boolean().optional(),
  /** display_options_form: unchecked boxes are unset */
  displayOptionsForm: z.boolean().optional(),
  /** full_text_button: the full/partial toggle (display_binary not defaulted) */
  fullTextButton: z.boolean().optional(),
  sortByKey: z.boolean().optional(),
  discardRememberedSort: z.boolean().optional(),
  messageToShow: z.string().optional(),
  fkChecks: z.boolean().optional(),
  isBrowseDistinct: z.boolean().optional(),
})
export type BrowseRequest = z.input<typeof BrowseRequest>

/** POST /api/servers/:s/browse/grid-value — the full value of a truncated cell (grid_edit). */
export const GridValueRequest = z.object({
  db: z.string(),
  table: z.string(),
  column: z.string(),
  where: z.string(),
})
export const GridValueResponse = z.object({ value: z.string().nullable() })

/** POST /api/servers/:s/browse/values — enum / set / relational editors. */
export const ColumnValuesRequest = z.object({
  kind: z.enum(['enum', 'set', 'relational']),
  db: z.string(),
  table: z.string(),
  column: z.string(),
  currValue: z.string().default(''),
  /** set: get_full_values with the row's where clause */
  where: z.string().optional(),
  /** relational: relation_key_or_display_column (the link title) */
  keyOrDisplay: z.string().optional(),
  relationalDisplay: z.enum(['K', 'D']).optional(),
})
export const ColumnValuesResponse = z.object({
  /** enum / set: the members; relational: the dropdown options (value '' = separator) */
  options: z.array(z.object({ value: z.string(), label: z.string() })),
  selected: z.array(z.string()),
  /** relational: too many foreign rows → "Browse foreign values" */
  browseForeign: z.boolean().optional(),
})
export type ColumnValuesResponse = z.infer<typeof ColumnValuesResponse>

/** POST /api/servers/:s/browse/save — grid edit (pma: /table/replace with submit_type=save). */
export const GridSaveRequest = z.object({
  db: z.string(),
  table: z.string(),
  clauseIsUnique: z.boolean(),
  rows: z.array(
    z.object({
      where: z.string(),
      fields: z.array(
        z.object({
          name: z.string(),
          value: z.string(),
          isNull: z.boolean(),
          /** fields_type: bit / hex / '' */
          type: z.string().default(''),
        }),
      ),
    }),
  ),
  relationalDisplay: z.enum(['K', 'D']).optional(),
})
export type GridSaveRequest = z.input<typeof GridSaveRequest>
export const GridSaveResponse = z.object({
  success: z.boolean(),
  message: z.string(),
  sql: z.string(),
  /** isNeedToRecheck / truncatableFieldValue: the saved value as re-read */
  recheck: z.string().nullable().optional(),
  /** row_count: Table::countRecords after the save */
  rowCount: z.number().int().optional(),
})
export type GridSaveResponse = z.infer<typeof GridSaveResponse>

/** POST /api/servers/:s/browse/delete-rows — /table/delete/rows (then the browse query again). */
export const DeleteRowsRequest = z.object({
  db: z.string(),
  table: z.string(),
  where: z.array(z.string()).min(1),
  fkChecks: z.boolean(),
  originalSql: z.string(),
})

import { z } from 'zod'
import { SqlMessage } from './table-structure.ts'

/**
 * Insert/Edit form, save, foreign-key browser and transformation wrapper
 * (docs/features/03-insert-edit-transformations.md, pma: /table/change, /table/replace,
 * /browse-foreigners, /transformation/wrapper).
 */

/** One `<option>` of the function dropdown (Generator::getFunctionsForField). */
export const FunctionOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  title: z.string().optional(),
})

/** One `<option>` of a foreign-key dropdown (Relation::foreignDropdown); `value: ''` = blank row. */
export const ForeignOption = z.object({ value: z.string(), label: z.string() })
export type ForeignOption = z.infer<typeof ForeignOption>

/**
 * The value widget of one cell (column_row.twig, in its order):
 * transformed → foreign-link → foreign-select → textarea (text/json) → enum → set → binary family
 * → gis (text + editor) → text/char textarea (value_column_for_other_datatype.twig).
 */
export const InsertWidget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    size: z.number().int(),
    /** data-maxlength (CHAR columns) */
    maxlength: z.number().int().nullable(),
    /** integer columns: exact MySQL range, inputmode=numeric, data-type INT */
    min: z.string().nullable(),
    max: z.string().nullable(),
    /** data-type: INT or the TypeClass */
    dataType: z.string(),
    /** datefield / timefield / datetimefield (date-time picker) */
    picker: z.enum(['date', 'time', 'datetime']).nullable(),
  }),
  z.object({
    kind: z.literal('textarea'),
    rows: z.number().int(),
    cols: z.number().int(),
    maxlength: z.number().int().nullable(),
    charField: z.boolean(),
    dataType: z.string(),
    /** "Because of its length, this column might not be editable." (TEXT > 32000 chars) */
    tooLong: z.boolean(),
  }),
  z.object({ kind: z.literal('enum-radio'), values: z.array(z.string()), selected: z.string() }),
  z.object({ kind: z.literal('enum-select'), values: z.array(z.string()), selected: z.string() }),
  z.object({
    kind: z.literal('set'),
    values: z.array(z.string()),
    selected: z.array(z.string()),
    size: z.number().int(),
  }),
  /** "Binary - do not edit (size unit)" */
  z.object({ kind: z.literal('protected'), size: z.string(), unit: z.string() }),
  z.object({ kind: z.literal('hex-textarea'), rows: z.number().int(), cols: z.number().int() }),
  z.object({ kind: z.literal('hex-input'), size: z.number().int() }),
  z.object({ kind: z.literal('foreign-link') }),
  z.object({
    kind: z.literal('foreign-select'),
    options: z.array(ForeignOption),
    /** index of the selected option (-1 = none) */
    selected: z.number().int(),
  }),
  z.object({ kind: z.literal('gis'), size: z.number().int() }),
  /** input transformation widget (IOTransformationsPlugin::getInputHtml) */
  z.object({
    kind: z.literal('transformed'),
    /** plugin file, e.g. Input/Image_JPEG_Upload */
    plugin: z.string(),
    options: z.array(z.string()),
    /** hidden fields_prev value (absent when the plugin emits none) */
    prev: z.string().nullable(),
    /** hidden or visible `fields` value */
    value: z.string(),
    /** the wrapper URL of the stored image (Image upload) */
    imageSrc: z.string().nullable(),
  }),
])
export type InsertWidget = z.infer<typeof InsertWidget>

export const InsertColumn = z.object({
  field: z.string(),
  /** position among all table columns (generated ones included): field ids `field_<n>_<col>` */
  columnNumber: z.number().int(),
  /** md5(field): the key phpMyAdmin uses in input names */
  md5: z.string(),
  type: z.string(),
  trueType: z.string(),
  /** InsertEditColumn::getDisplayType */
  displayType: z.string(),
  isNull: z.boolean(),
  key: z.string(),
  extra: z.string(),
  /** column comment when ShowPropertyComments (dashed-underlined title) */
  comment: z.string().nullable(),
  /** data-decimals: fractional-seconds precision */
  decimals: z.number().int(),
  /** function cell: binary ("Binary"), none ("--"), select */
  functionCell: z.enum(['binary', 'none', 'select']).nullable(),
  /** default selected function ('' = none) */
  defaultFunction: z.string(),
  /** nullify code for the NULL checkbox (1 enum select, 2 enum radios, 3 set, 4 FK select, 5 other, 6 FK link) */
  nullifyCode: z.string(),
  isBlob: z.boolean(),
  isBinary: z.boolean(),
  isChar: z.boolean(),
  /** file upload input for BLOBs, with "(Max: …)" */
  upload: z.object({ maxSize: z.string() }).nullable(),
  /** UploadDir select: files, or 'error' when the directory cannot be reached */
  uploadDir: z.union([z.array(z.string()), z.literal('error')]).nullable(),
})
export type InsertColumn = z.infer<typeof InsertColumn>

export const InsertCell = z.object({
  /** formatted value shown in the widget (special_chars) */
  value: z.string(),
  /** `data`: the value used for selection (enum/set/FK) */
  data: z.string(),
  /** NULL checkbox ticked (real_null_value) */
  isNull: z.boolean(),
  /** fields_null_prev = on */
  nullPrev: z.boolean(),
  /** hidden fields_prev (editing only), null when not emitted */
  prev: z.string().nullable(),
  widget: InsertWidget,
  /** the hidden `fields_type` value ('' = none) */
  fieldsType: z.string(),
  /** hidden `auto_increment` marker */
  autoIncrement: z.boolean(),
  /** hidden `virtual` marker (generated, not DEFAULT_GENERATED) */
  virtual: z.boolean(),
})
export type InsertCell = z.infer<typeof InsertCell>

export const InsertRow = z.object({
  /** where_clause[k] of an edited row; null for new rows */
  whereClause: z.string().nullable(),
  /** "Ignore" checkbox (insert mode, rows ≥ 1): null = not shown */
  ignore: z.boolean().nullable(),
  /** one cell per (non-generated) column, same order as `columns` */
  cells: z.array(InsertCell),
})
export type InsertRow = z.infer<typeof InsertRow>

/** GET …/tables/:t/insert-form */
export const InsertFormResponse = z.object({
  insertMode: z.boolean(),
  /** count of all table columns (InsertEdit::$fieldIndex = row * count + column + 1) */
  columnCount: z.number().int(),
  /** default_action=insert (Copy): rows fetched, saved as INSERT */
  copy: z.boolean(),
  columns: z.array(InsertColumn),
  rows: z.array(InsertRow),
  /** functions offered in every select (empty when ShowFunctionFields is off) */
  functions: z.array(FunctionOptionSchema),
  showFunctionFields: z.boolean(),
  showFieldTypes: z.boolean(),
  /** messages above the form: empty result sets of edited rows, repopulation errors */
  messages: z.array(SqlMessage),
  foundUniqueKey: z.boolean(),
  /** InsertEdit::isWhereClauseNumeric ("Edit next row") */
  isNumericWhere: z.boolean(),
  clauseIsUnique: z.boolean(),
  /** "Continue insertion with N rows" default */
  insertRows: z.number().int(),
  uploadEnabled: z.boolean(),
  hasBlob: z.boolean(),
  /** after_insert to preselect */
  afterInsert: z.string(),
  firstDayOfCalendar: z.number().int(),
})
export type InsertFormResponse = z.infer<typeof InsertFormResponse>

/** One submitted field (the fields*, funcs, salt… inputs of one column of one row). */
export const SaveField = z.object({
  /** fields_name: column name */
  name: z.string(),
  /** fields: value; SET multi-select posts a list; null = not posted (nullified select) */
  value: z.union([z.string(), z.array(z.string())]).nullable(),
  type: z.string().default(''),
  isNull: z.boolean().default(false),
  nullPrev: z.boolean().default(false),
  function: z.string().default(''),
  salt: z.string().nullable().default(null),
  prev: z.string().nullable().default(null),
  autoIncrement: z.boolean().default(false),
  virtual: z.boolean().default(false),
  /** fields_upload: the file content, base64 */
  upload: z.string().nullable().optional(),
  /** fields_uploadlocal: a file of UploadDir */
  uploadLocal: z.string().nullable().optional(),
})
export type SaveField = z.infer<typeof SaveField>

export const SaveRowsRequest = z.object({
  rows: z
    .array(
      z.object({
        whereClause: z.string().nullable().default(null),
        /** insert_ignore_<n> */
        ignore: z.boolean().default(false),
        fields: z.array(SaveField),
      }),
    )
    .min(1),
  submitType: z.enum(['save', 'insert', 'insertignore', 'showinsert']).default('save'),
  afterInsert: z.enum(['back', 'new_insert', 'same_insert', 'edit_next']).default('back'),
  clauseIsUnique: z.boolean().default(false),
  /** "Preview SQL": build the statements, run nothing */
  preview: z.boolean().default(false),
  /** sql_query the form was opened with (Browse); kept for "Go back" */
  sqlQuery: z.string().default(''),
})
export type SaveRowsRequest = z.infer<typeof SaveRowsRequest>

export const SaveRowsResponse = z.object({
  /** Preview SQL: the statements ([] = "No change") */
  preview: z.array(z.string()).optional(),
  message: SqlMessage,
  /** Current::$sqlQuery: implode('; ', $query) . ';' ('' when nothing ran) */
  sqlQuery: z.string(),
  /** where to go next: back to the previous page, or reopen /table/change */
  next: z.discriminatedUnion('action', [
    z.object({ action: z.literal('back') }),
    z.object({ action: z.literal('insert') }),
    /** same_insert / edit_next / a failed input transformation: these signed clauses */
    z.object({
      action: z.literal('edit'),
      where: z.array(z.object({ clause: z.string(), sig: z.string() })),
    }),
  ]),
  /** rows that failed an input transformation, repopulated as typed (ChangeController::$unsavedValues) */
  unsaved: z.array(z.record(z.string(), z.string().nullable())).optional(),
  executed: z.array(z.object({ sql: z.string(), ms: z.number() })).optional(),
})
export type SaveRowsResponse = z.infer<typeof SaveRowsResponse>

/** POST …/tables/:t/browse-foreigners */
export const BrowseForeignersRequest = z.object({
  field: z.string(),
  data: z.string().default(''),
  filter: z.string().default(''),
  pos: z.number().int().min(0).default(0),
  showAll: z.boolean().default(false),
})
export type BrowseForeignersRequest = z.infer<typeof BrowseForeignersRequest>

export const BrowseForeignersResponse = z.object({
  /** null: no rows (empty table) */
  rows: z
    .array(
      z.object({
        left: z.object({
          key: z.string(),
          description: z.string(),
          title: z.string(),
          selected: z.boolean(),
        }),
        right: z.object({
          key: z.string(),
          description: z.string(),
          title: z.string(),
          selected: z.boolean(),
        }),
        /** repeat the header before this row (RepeatCells) */
        header: z.boolean(),
      }),
    )
    .nullable(),
  total: z.number().int(),
  maxRows: z.number().int(),
  pos: z.number().int(),
  /** "Show all" button ($cfg['ShowAll'] and total > MaxRows) */
  showAllButton: z.boolean(),
})
export type BrowseForeignersResponse = z.infer<typeof BrowseForeignersResponse>

/** GET …/tables/:t/transformations — what the Browse grid needs to render transformed cells. */
export const ColumnTransformations = z.object({
  /** BrowseMIME and the browser transformation feature are on */
  enabled: z.boolean(),
  columns: z.record(
    z.string(),
    z.object({
      mimetype: z.string(),
      transformation: z.string(),
      transformationOptions: z.array(z.string()),
      inputTransformation: z.string(),
      inputTransformationOptions: z.array(z.string()),
    }),
  ),
})
export type ColumnTransformations = z.infer<typeof ColumnTransformations>

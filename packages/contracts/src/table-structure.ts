import { z } from 'zod'

/**
 * Table Structure tab, column definition form (create / add / change), index editor, partitions.
 * docs/features/04-table-level.md, docs/architecture/05-api-reference.md#table-scope.
 * Messages are phpMyAdmin's msgids, translated with the request language.
 */

/** A message card: phpMyAdmin's Message + the SQL under it (Generator::getMessage). */
export const SqlMessage = z.object({
  type: z.enum(['success', 'notice', 'error']),
  text: z.string(),
  sql: z.string().optional(),
})
export type SqlMessage = z.infer<typeof SqlMessage>

/** Mutation response: the message(s) plus every statement sent (DBG.sql). */
export const DdlResponse = z.object({
  messages: z.array(SqlMessage),
  /** dry run ("Preview SQL"): the statement phpMyAdmin's preview shows ('' when nothing changes) */
  preview: z.string().optional(),
  /** confirmation needed before running (bulk Primary on a table that has one) */
  confirm: z.object({ question: z.string(), sql: z.string() }).optional(),
  /** move columns: the new order */
  columns: z.array(z.string()).optional(),
  /** partition maintenance: Op/Msg_type/Msg_text rows grouped by Table */
  maintenance: z
    .object({
      title: z.string(),
      partition: z.string(),
      rows: z.array(
        z.object({ table: z.string(), op: z.string(), msgType: z.string(), msgText: z.string() }),
      ),
    })
    .optional(),
})
export type DdlResponse = z.infer<typeof DdlResponse>

// ---------------------------------------------------------------- Structure page (GET)

export const StructureColumn = z.object({
  name: z.string(),
  /** COLUMN_TYPE as reported */
  type: z.string(),
  /** Util::extractColumnSpec print_type (lower-cased, attributes stripped, enum values spaced) */
  printType: z.string(),
  /** the cell text: printType truncated at LimitChars with "..." */
  displayedType: z.string(),
  /** true when displayedType is abbreviated (`<abbr title=printType>`) */
  abbreviated: z.boolean(),
  /** extracted type (int, varchar, enum, …) */
  baseType: z.string(),
  collation: z.object({ name: z.string(), description: z.string() }).nullable(),
  attribute: z.string(),
  isNull: z.boolean(),
  /** null: no default; BIT defaults already converted to plain bits */
  default: z.string().nullable(),
  /** column comment (native) */
  comment: z.string(),
  /** "Media type: …" line of the type cell (pmadb mimetype, `_` → `/`, lower-cased) when BrowseMIME */
  mediaType: z.string().optional(),
  /** Extra, upper-cased */
  extra: z.string(),
  isPrimary: z.boolean(),
  hasIndex: z.boolean(),
  /** the row actions that are links (the others render greyed out) */
  actions: z.object({
    primary: z.boolean(),
    unique: z.boolean(),
    index: z.boolean(),
    spatial: z.boolean(),
    fulltext: z.boolean(),
  }),
  /** "Distinct values" query (Browse with is_browse_distinct) */
  distinctSql: z.string(),
  /** its sql_signature (the Browse tab runs signed queries only) */
  distinctSig: z.string().optional(),
  /** "Drop" confirmation / statement */
  dropSql: z.string(),
  /** in pma__central_columns (CentralColumns::findExistingColNames): "Remove from central columns" */
  inCentralList: z.boolean(),
})
export type StructureColumn = z.infer<typeof StructureColumn>

export const StructureIndexColumn = z.object({
  name: z.string(),
  expression: z.string().nullable(),
  subPart: z.number().int().nullable(),
  cardinality: z.number().nullable(),
  collation: z.string().nullable(),
  /** "Yes" / "No", translated */
  null: z.string(),
})

export const StructureIndex = z.object({
  name: z.string(),
  /** Index_type, or the choice for FULLTEXT/SPATIAL */
  type: z.string(),
  choice: z.enum(['PRIMARY', 'UNIQUE', 'INDEX', 'SPATIAL', 'FULLTEXT']),
  unique: z.boolean(),
  /** Index::isPacked(): "No" (translated) or the Packed value */
  packed: z.string(),
  /** remarks + "\n" + comment (Index::getComments) */
  comments: z.string(),
  columns: z.array(StructureIndexColumn),
  dropSql: z.string(),
})
export type StructureIndex = z.infer<typeof StructureIndex>

export const StructurePartition = z.object({
  ordinal: z.number().int().nullable(),
  name: z.string(),
  method: z.string().nullable(),
  expression: z.string().nullable(),
  description: z.string().nullable(),
  rows: z.number(),
  /** formatByteDown(…, 3, 1) */
  dataLength: z.tuple([z.string(), z.string()]),
  indexLength: z.tuple([z.string(), z.string()]),
  comment: z.string(),
  subPartitions: z.array(
    z.object({
      ordinal: z.number().int().nullable(),
      name: z.string(),
      rows: z.number(),
      dataLength: z.tuple([z.string(), z.string()]),
      indexLength: z.tuple([z.string(), z.string()]),
      comment: z.string(),
    }),
  ),
})

export const StructurePartitions = z.object({
  /** Partition::havePartitioning */
  available: z.boolean(),
  partitions: z.array(StructurePartition),
  method: z.string().nullable(),
  expression: z.string().nullable(),
  subMethod: z.string().nullable(),
  subExpression: z.string().nullable(),
  hasDescription: z.boolean(),
  /** RANGE / RANGE COLUMNS / LIST / LIST COLUMNS: Drop partition offered */
  rangeOrList: z.boolean(),
  removeSql: z.string(),
})

/** Information card (display_table_stats.twig); sizes already formatted [value, unit]. */
export const StructureStats = z.object({
  tableComment: z.string(),
  showSpaceUsage: z.boolean(),
  data: z.tuple([z.string(), z.string()]),
  index: z.tuple([z.string(), z.string()]).nullable(),
  overhead: z.tuple([z.string(), z.string()]).nullable(),
  effective: z.tuple([z.string(), z.string()]),
  total: z.tuple([z.string(), z.string()]).nullable(),
  optimizeSql: z.string().nullable(),
  rows: z.array(z.object({ label: z.string(), value: z.string(), title: z.string().optional() })),
})

export const StructureResponse = z.object({
  db: z.string(),
  table: z.string(),
  isView: z.boolean(),
  isSystemSchema: z.boolean(),
  /** upper-cased storage engine, or "View" */
  engine: z.string(),
  columns: z.array(StructureColumn),
  indexes: z.array(StructureIndex),
  /** "The indexes %1$s and %2$s seem to be equal …", translated */
  indexNotices: z.array(z.string()),
  /** null when the Indexes card is hidden (views, system schemas, ARCHIVE) */
  showIndexes: z.boolean(),
  partitions: StructurePartitions,
  stats: StructureStats.nullable(),
  links: z.object({
    proposeTableStructure: z.string().nullable(),
    /** sql_signature of proposeTableStructure */
    proposeSig: z.string().optional(),
    trackTable: z.boolean(),
    editView: z.boolean(),
  }),
  features: z.object({ centralColumns: z.boolean(), relation: z.boolean() }),
  /** server facts the client needs (ENUM editor, type catalog, …) */
  server: z.object({ vendor: z.enum(['mysql', 'mariadb', 'percona']), version: z.number().int() }),
  config: z.object({
    ShowColumnComments: z.boolean(),
    HideStructureActions: z.boolean(),
    ShowStats: z.boolean(),
    ActionLinksMode: z.string(),
    InitialSlidersState: z.string(),
    ReservedWordDisableWarning: z.boolean(),
  }),
  /** the secondary pill bar (Table structure / Relation view) */
  showRelationTab: z.boolean(),
})
export type StructureResponse = z.infer<typeof StructureResponse>

// ---------------------------------------------------------------- column definition form

/** The MIME columns of a row (field_mimetype, field_transformation[_options], field_input_transformation[_options]). */
export const ColumnMime = z.object({
  /** `Text_Plain` (the media type with `/` replaced by `_`), '' for none */
  mimetype: z.string().default(''),
  /** plugin file, e.g. `Output/Text_Plain_Dateformat.php` */
  transformation: z.string().default(''),
  transformationOptions: z.string().default(''),
  inputTransformation: z.string().default(''),
  inputTransformationOptions: z.string().default(''),
})
export type ColumnMime = z.input<typeof ColumnMime>

/** One row of the column definition form, in phpMyAdmin's field names (field_*). */
export const ColumnDef = z.object({
  name: z.string(),
  type: z.string(),
  length: z.string().default(''),
  defaultType: z.string().default('NONE'),
  defaultValue: z.string().default(''),
  collation: z.string().nullable().default(''),
  attribute: z.string().default(''),
  /** the Null checkbox */
  null: z.boolean().default(false),
  /** the A_I checkbox */
  autoIncrement: z.boolean().default(false),
  comments: z.string().default(''),
  virtuality: z.string().nullable().default(''),
  expression: z.string().nullable().default(''),
  /** posted only when the form shows the MIME columns (ColumnFormOptions.mime) */
  mime: ColumnMime.optional(),
})
export type ColumnDef = z.input<typeof ColumnDef>

/** The `*_orig` snapshot sent back with each changed row (hidden inputs in phpMyAdmin). */
export const ColumnOrig = z.object({
  field: z.string(),
  type: z.string(),
  length: z.string(),
  defaultValue: z.string(),
  defaultType: z.string(),
  collation: z.string(),
  attribute: z.string(),
  null: z.string(),
  extra: z.string(),
  comments: z.string(),
  virtuality: z.string(),
  expression: z.string(),
})
export type ColumnOrig = z.infer<typeof ColumnOrig>

/** An index of the create/add form (the JSON in primary_indexes, unique_indexes, …). */
export const FormIndex = z.object({
  keyName: z.string().default(''),
  comment: z.string().default(''),
  choice: z.enum(['PRIMARY', 'INDEX', 'UNIQUE', 'FULLTEXT', 'SPATIAL']),
  keyBlockSize: z.string().default(''),
  parser: z.string().default(''),
  type: z.string().default(''),
  columns: z.array(z.object({ colIndex: z.number().int().min(0), size: z.string().default('') })).min(1),
})
export type FormIndex = z.input<typeof FormIndex>

export const PartitionDef: z.ZodType<PartitionDefT> = z.lazy(() =>
  z.object({
    name: z.string(),
    valueType: z.string().optional(),
    value: z.string().optional(),
    engine: z.string().optional(),
    comment: z.string().optional(),
    dataDirectory: z.string().optional(),
    indexDirectory: z.string().optional(),
    maxRows: z.string().optional(),
    minRows: z.string().optional(),
    tablespace: z.string().optional(),
    nodeGroup: z.string().optional(),
    subpartitions: z.array(PartitionDef).optional(),
  }),
)
export interface PartitionDefT {
  name: string
  valueType?: string | undefined
  value?: string | undefined
  engine?: string | undefined
  comment?: string | undefined
  dataDirectory?: string | undefined
  indexDirectory?: string | undefined
  maxRows?: string | undefined
  minRows?: string | undefined
  tablespace?: string | undefined
  nodeGroup?: string | undefined
  subpartitions?: PartitionDefT[] | undefined
}

export const Partitioning = z.object({
  partitionBy: z.string().default(''),
  partitionExpr: z.string().default(''),
  partitionCount: z.string().default(''),
  subpartitionBy: z.string().default(''),
  subpartitionExpr: z.string().default(''),
  subpartitionCount: z.string().default(''),
  partitions: z.array(PartitionDef).default([]),
})
export type Partitioning = z.input<typeof Partitioning>

/** Option lists and server facts of the column definition form. */
export const ColumnFormOptions = z.object({
  server: z.object({ vendor: z.enum(['mysql', 'mariadb', 'percona']), version: z.number().int() }),
  /** Generator::getSupportedDatatypes: top-level options then groups; '-' separators */
  types: z.array(
    z.union([
      z.object({ separator: z.literal(true), group: z.string().nullable() }),
      z.object({
        group: z.string().nullable(),
        type: z.string(),
        description: z.string(),
        lengthRestricted: z.boolean(),
      }),
    ]),
  ),
  attributes: z.array(z.string()),
  defaultTypes: z.array(z.string()),
  /** null: the Virtuality column is not shown */
  virtuality: z.array(z.string()).nullable(),
  charsets: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      collations: z.array(z.object({ name: z.string(), description: z.string() })),
    }),
  ),
  engines: z.array(z.object({ name: z.string(), comment: z.string(), isDefault: z.boolean() })),
  havePartitioning: z.boolean(),
  /** Compatibility::isIntegersLengthRestricted → #length_not_allowed alert */
  integersLengthRestricted: z.boolean(),
  /** $cfg['InitialSlidersState'] (the Add index dialog's Advanced options) */
  sliders: z.string().default('closed'),
  /** comment maxlength (1024 on MySQL ≥ 5.5.3) */
  commentMaxLength: z.number().int(),
  /** UserPrivileges column + reload: "Adjust privileges" ticked and enabled */
  privsAvailable: z.boolean(),
  charEditing: z.string(),
  /** "Pick from Central Columns" */
  centralColumns: z.boolean(),
  /** $cfg['MaxRows']: the rows the column selector lists before "See more" (data-maxrows) */
  maxRows: z.number().int(),
  /** MIME transformation columns (browser transformation + column comments features + BrowseMIME) */
  mime: z.boolean(),
  /** Transformations::getAvailableMimeTypes for the MIME selects (null when `mime` is false) */
  mimeTypes: z
    .object({
      /** value (`Text_Plain`) and label (`text/plain`) */
      mimetypes: z.array(z.object({ value: z.string(), label: z.string() })),
      /** value (plugin file), label (`Date Format (text/plain: Dateformat)`), title (description) */
      transformations: z.array(z.object({ value: z.string(), label: z.string(), title: z.string() })),
      inputTransformations: z.array(z.object({ value: z.string(), label: z.string(), title: z.string() })),
    })
    .nullable(),
})
export type ColumnFormOptions = z.infer<typeof ColumnFormOptions>

/** GET …/tables/:t/columns/form?fields=a&fields=b — the change form of the selected columns. */
export const ChangeFormResponse = z.object({
  options: ColumnFormOptions,
  columns: z.array(
    z.object({
      values: ColumnDef.omit({ mime: true }).required(),
      /** the stored MIME settings (Transformations::getMime), null when the form has no MIME columns */
      mime: ColumnMime.required().nullable(),
      orig: ColumnOrig,
      /** move column select: value, "after %s" argument, disabled */
      moveOptions: z.array(
        z.object({ value: z.string(), after: z.string().nullable(), disabled: z.boolean() }),
      ),
      /**
       * Relation::checkChildForeignReferences, only before MySQL 5.6.6 (renaming a column bound in a
       * foreign key): name and type locked, the name's title says why
       */
      status: z
        .object({
          isEditable: z.boolean(),
          isReferenced: z.boolean(),
          isForeignKey: z.boolean(),
          references: z.array(z.string()),
        })
        .optional(),
    }),
  ),
})
export type ChangeFormResponse = z.infer<typeof ChangeFormResponse>

/** POST …/tables/:t/columns/add (pma: /table/add-field) */
export const AddColumnsRequest = z.object({
  columns: z.array(ColumnDef).min(1).max(4096),
  indexes: z.array(FormIndex).default([]),
  /** field_where: last | first | after */
  where: z.enum(['last', 'first', 'after']).default('last'),
  afterField: z.string().default(''),
  onlineTransaction: z.boolean().default(false),
  dryRun: z.boolean().default(false),
})
export type AddColumnsRequest = z.input<typeof AddColumnsRequest>

/** POST …/tables/:t/columns/change (pma: /table/structure/save) */
export const ChangeColumnsRequest = z.object({
  columns: z
    .array(
      ColumnDef.extend({
        orig: ColumnOrig,
        moveTo: z.string().default(''),
        adjustPrivileges: z.boolean().default(false),
      }),
    )
    .min(1),
  onlineTransaction: z.boolean().default(false),
  dryRun: z.boolean().default(false),
})
export type ChangeColumnsRequest = z.input<typeof ChangeColumnsRequest>

/** POST …/tables/:t/columns/drop — `source: 'row'` is the row link (/sql), 'bulk' the Yes/No page */
/** /table/structure/central-columns-add | -remove (selected_fld[]) */
export const CentralColumnsSelectRequest = z.object({ columns: z.array(z.string()).default([]) })
export type CentralColumnsSelectRequest = z.input<typeof CentralColumnsSelectRequest>

/** POST …/structure/browse (pma: /table/structure/browse): With selected → Browse */
export const StructureBrowseRequest = z.object({ columns: z.array(z.string()).default([]) })
export type StructureBrowseRequest = z.input<typeof StructureBrowseRequest>
/** the SELECT of the checked columns, signed for the Browse tab */
export const StructureBrowseResponse = z.object({ sql: z.string(), sig: z.string() })
export type StructureBrowseResponse = z.infer<typeof StructureBrowseResponse>

export const DropColumnsRequest = z.object({
  columns: z.array(z.string().min(1)).min(1),
  source: z.enum(['row', 'bulk']).default('bulk'),
  dryRun: z.boolean().default(false),
})
export type DropColumnsRequest = z.input<typeof DropColumnsRequest>

/** POST …/tables/:t/columns/key — row actions (add-key) and bulk buttons (primary/unique/…) */
export const AddKeyRequest = z.object({
  type: z.enum(['PRIMARY', 'UNIQUE', 'INDEX', 'SPATIAL', 'FULLTEXT']),
  columns: z.array(z.string()).min(1),
  source: z.enum(['row', 'bulk']).default('row'),
  /** bulk Primary on a table with a primary key: the "Yes" of the confirmation */
  confirmed: z.boolean().default(false),
  dryRun: z.boolean().default(false),
})
export type AddKeyRequest = z.input<typeof AddKeyRequest>

/** POST …/tables/:t/columns/move */
export const MoveColumnsRequest = z.object({
  order: z.array(z.string()).min(1),
  dryRun: z.boolean().default(false),
})
export type MoveColumnsRequest = z.input<typeof MoveColumnsRequest>

/** POST …/tables/:t/columns/reserved-word-check */
export const ReservedWordCheckRequest = z.object({ names: z.array(z.string()), table: z.string().optional() })
export const ReservedWordCheckResponse = z.object({ reserved: z.boolean(), message: z.string() })
export type ReservedWordCheckResponse = z.infer<typeof ReservedWordCheckResponse>

/** POST …/tables/:t/columns/preview — one endpoint for every "Preview SQL" button */
export const ColumnsPreviewRequest = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), body: AddColumnsRequest }),
  z.object({ op: z.literal('change'), body: ChangeColumnsRequest }),
  z.object({ op: z.literal('move'), body: MoveColumnsRequest }),
])

/** GET /api/servers/:s/databases/:db/create-table/form */
export const CreateTableFormResponse = z.object({
  options: ColumnFormOptions,
  defaultColumns: z.number().int(),
})
export type CreateTableFormResponse = z.infer<typeof CreateTableFormResponse>

/** POST /api/servers/:s/databases/:db/tables (pma: /table/create) */
export const CreateTableRequest = z.object({
  table: z.string(),
  columns: z.array(ColumnDef).min(1).max(4096),
  indexes: z.array(FormIndex).default([]),
  comment: z.string().default(''),
  collation: z.string().default(''),
  engine: z.string().default(''),
  connection: z.string().default(''),
  partitioning: Partitioning.default({}),
  dryRun: z.boolean().default(false),
})
export type CreateTableRequest = z.input<typeof CreateTableRequest>

// ---------------------------------------------------------------- index editor

export const IndexEditorColumn = z.object({
  name: z.string(),
  subPart: z.string().default(''),
  /** '', 'A', 'D' */
  collation: z.string().default(''),
})

export const IndexEditorIndex = z.object({
  name: z.string().default(''),
  choice: z.enum(['PRIMARY', 'INDEX', 'UNIQUE', 'SPATIAL', 'FULLTEXT']),
  keyBlockSize: z.string().default(''),
  type: z.string().default(''),
  parser: z.string().default(''),
  comment: z.string().default(''),
  columns: z.array(IndexEditorColumn),
})
export type IndexEditorIndex = z.input<typeof IndexEditorIndex>

/** GET …/tables/:t/indexes/form?index=name | ?create=N — the editor form as phpMyAdmin renders it */
export const IndexFormResponse = z.object({
  index: IndexEditorIndex.required(),
  /** `old_index`: the index being edited (null for a new one) */
  oldIndex: z.string().nullable(),
  /** the PRIMARY option is offered (editing the PK, or the table has none) */
  primaryAllowed: z.boolean(),
  /** columns with their type: [name, type] */
  fields: z.array(z.tuple([z.string(), z.string()])),
  /** number of empty column rows added below the index's own columns */
  addFields: z.number().int(),
  sliders: z.string(),
})
export type IndexFormResponse = z.infer<typeof IndexFormResponse>

/** POST …/tables/:t/indexes (pma: /table/indexes do_save_data) */
export const SaveIndexRequest = z.object({
  oldIndex: z.string().nullable().default(null),
  index: IndexEditorIndex,
  dryRun: z.boolean().default(false),
})
export type SaveIndexRequest = z.input<typeof SaveIndexRequest>

/** POST …/tables/:t/indexes/rename (pma: /table/indexes/rename) */
export const RenameIndexRequest = z.object({
  oldIndex: z.string(),
  name: z.string(),
  dryRun: z.boolean().default(false),
})
export type RenameIndexRequest = z.input<typeof RenameIndexRequest>

/** POST …/tables/:t/indexes/drop (the Drop link, posted to /sql) */
export const DropIndexRequest = z.object({ name: z.string(), dryRun: z.boolean().default(false) })
export type DropIndexRequest = z.input<typeof DropIndexRequest>

// ---------------------------------------------------------------- partitions

/** GET …/tables/:t/partitions/form (pma: /table/structure/partitioning without save) */
export const PartitionFormResponse = z.object({
  partitioning: Partitioning.required(),
  canHaveSubpartitions: z.boolean(),
  valueEnabled: z.boolean(),
  engines: z.array(z.object({ name: z.string(), comment: z.string(), isDefault: z.boolean() })),
})
export type PartitionFormResponse = z.infer<typeof PartitionFormResponse>

/** POST …/tables/:t/partitions/partitioning (Save) */
export const PartitioningRequest = z.object({
  partitioning: Partitioning,
  dryRun: z.boolean().default(false),
})
export type PartitioningRequest = z.input<typeof PartitioningRequest>

/** POST …/tables/:t/partitions/maintenance (pma: /table/partition/{op}) */
export const PartitionMaintenanceRequest = z.object({
  operation: z.enum(['ANALYZE', 'CHECK', 'OPTIMIZE', 'REBUILD', 'REPAIR', 'TRUNCATE', 'DROP']),
  partition: z.string(),
})
export type PartitionMaintenanceRequest = z.input<typeof PartitionMaintenanceRequest>

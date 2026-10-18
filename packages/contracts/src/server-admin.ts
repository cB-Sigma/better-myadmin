import { z } from 'zod'
import { NavPageSelector } from './navigation.ts'
import { SqlCard } from './query.ts'

/**
 * Server-level pages: Databases list, Status (overview, processes, query statistics, status
 * variables, advisor), Variables, Charsets/collations, Engines, Plugins, Binary log.
 *
 * The server renders the same model phpMyAdmin's controllers hand to their Twig templates: values
 * are already formatted with the request language (Util::formatNumber, formatByteDown,
 * timespanFormat, localisedDate), messages are translated, documentation links are plain URLs.
 * docs/features/06-server-level.md, docs/features/05-database-level.md#server--databases-list
 */

/** `?param=` booleans the way phpMyAdmin reads them (present/'1'/'on' → true). */
const flag = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || (typeof v === 'string' && v !== '' && v !== '0' && v !== 'false'))

/** A translated message (Message::success/error/notice). */
export const AdminMessage = z.object({ type: z.enum(['success', 'notice', 'error']), text: z.string() })
export type AdminMessage = z.infer<typeof AdminMessage>

/** Generator::getMessage: a message card with the SQL that ran. */
export const SqlMessageBox = z.object({ message: AdminMessage, sql: z.string() })
export type SqlMessageBox = z.infer<typeof SqlMessageBox>

/** A number formatted for display with its full value as tooltip (`<abbr title>` / `<data title>`). */
export const Formatted = z.object({ text: z.string(), title: z.string().optional() })
export type Formatted = z.infer<typeof Formatted>

// ------------------------------------------------------------------ Databases (/server/databases)

export const DatabasesQuery = z.object({
  statistics: flag,
  pos: z.coerce.number().int().catch(0).default(0),
  sort_by: z.string().default(''),
  sort_order: z.string().default(''),
})
export type DatabasesQuery = z.input<typeof DatabasesQuery>

export const CharsetOption = z.object({
  name: z.string(),
  description: z.string(),
  collations: z.array(z.object({ name: z.string(), description: z.string(), isSelected: z.boolean() })),
})

export const DatabaseStatistic = z.object({
  key: z.string(),
  raw: z.string(),
  format: z.enum(['number', 'byte']),
  /** formatted number, or the value part of formatByteDown */
  value: z.string(),
  /** the unit part of formatByteDown */
  unit: z.string().optional(),
})

export const DatabaseRow = z.object({
  name: z.string(),
  collation: z.object({ name: z.string(), description: z.string() }).nullable(),
  statistics: z.array(DatabaseStatistic),
  /** null when the server is not a primary / replica */
  primaryReplicated: z.boolean().nullable(),
  replicaReplicated: z.boolean().nullable(),
  isSystemSchema: z.boolean(),
  isPmadb: z.boolean(),
})
export type DatabaseRow = z.infer<typeof DatabaseRow>

export const DatabasesResponse = z.object({
  /** DatabasesFullInfoFailure: the error (Generator::mysqlDie text) instead of a list */
  error: z.object({ message: z.string(), sql: z.string() }).nullable(),
  hasStatistics: z.boolean(),
  isCreateDatabaseShown: z.boolean(),
  hasCreateDatabasePrivileges: z.boolean(),
  databaseToCreate: z.string(),
  charsets: z.array(CharsetOption),
  databaseCount: z.number().int(),
  pos: z.number().int(),
  sortBy: z.string(),
  sortOrder: z.enum(['asc', 'desc']),
  maxDbList: z.number().int(),
  pager: NavPageSelector.nullable(),
  headerStatistics: z.array(
    z.object({ key: z.string(), title: z.string(), format: z.enum(['number', 'byte']) }),
  ),
  databases: z.array(DatabaseRow),
  totalStatistics: z.array(DatabaseStatistic),
  hasPrimaryReplication: z.boolean(),
  hasReplicaReplication: z.boolean(),
  isDropAllowed: z.boolean(),
  /** DefaultTabDatabase route the database names link to (`/database/structure`…) */
  defaultTabDatabase: z.string(),
  /** Generator::linkToVarDocumentation('CREATE_DATABASE') */
  createDatabaseDocUrl: z.string(),
})
export type DatabasesResponse = z.infer<typeof DatabasesResponse>

/** POST /api/servers/:s/databases (pma: /server/databases/create) */
export const CreateDatabaseRequest = z.object({ new_db: z.string(), db_collation: z.string().optional() })
export type CreateDatabaseRequest = z.input<typeof CreateDatabaseRequest>

export const CreateDatabaseResponse = z.object({
  message: AdminMessage,
  sqlQuery: SqlMessageBox.optional(),
  /** the new database (lower-cased when lower_case_table_names = 1) */
  db: z.string().optional(),
  /** DefaultTabDatabase route to open next */
  route: z.string().optional(),
})
export type CreateDatabaseResponse = z.infer<typeof CreateDatabaseResponse>

/** POST /api/servers/:s/databases/drop (pma: /server/databases/destroy) */
export const DropDatabasesRequest = z.object({ selected_dbs: z.array(z.unknown()).default([]) })
export type DropDatabasesRequest = z.input<typeof DropDatabasesRequest>

export const DropDatabasesResponse = z.object({ success: z.boolean(), message: AdminMessage })
export type DropDatabasesResponse = z.infer<typeof DropDatabasesResponse>

// ------------------------------------------------------------------ Status: overview

export const ReplicationStatusTable = z.object({
  type: z.enum(['primary', 'replica']),
  variables: z.array(
    z.object({ name: z.string(), value: z.string(), status: z.enum(['', 'text-danger', 'text-success']) }),
  ),
})

export const StatusOverview = z.object({
  isDataLoaded: z.boolean(),
  networkTraffic: z.string().nullable(),
  uptime: z.string().nullable(),
  startTime: z.string().nullable(),
  traffic: z.array(z.object({ name: z.string(), number: z.string(), perHour: z.string() })),
  connections: z.array(
    z.object({ name: z.string(), number: z.string(), perHour: z.string(), percentage: z.string() }),
  ),
  isPrimary: z.boolean(),
  isReplica: z.boolean(),
  replication: z.array(ReplicationStatusTable),
})
export type StatusOverview = z.infer<typeof StatusOverview>

// ------------------------------------------------------------------ Status: processes

export const ProcessesQuery = z.object({
  showExecuting: flag,
  full: flag,
  order_by_field: z.string().default(''),
  sort_order: z.string().default(''),
})
export type ProcessesQuery = z.input<typeof ProcessesQuery>

export const ProcessColumn = z.object({
  name: z.string(),
  orderByField: z.string(),
  /** the order the header link requests (ASC, DESC when the column is sorted ASC) */
  sortOrder: z.enum(['ASC', 'DESC']),
  isSorted: z.boolean(),
  /** the last header carries the full/truncated toggle */
  hasFullQuery: z.boolean(),
  isFull: z.boolean(),
})

export const ProcessRow = z.object({
  id: z.string(),
  user: z.string(),
  host: z.string(),
  /** host without the `:port` (link to the privileges page) */
  userHost: z.string(),
  db: z.string(),
  command: z.string(),
  time: z.string(),
  state: z.string(),
  progress: z.string(),
  /** the SQL text (truncated to MaxCharactersInDisplayedSQL + `[...]` unless full), null for `---` */
  info: z.string().nullable(),
})
export type ProcessRow = z.infer<typeof ProcessRow>

export const ProcessList = z.object({
  columns: z.array(ProcessColumn),
  rows: z.array(ProcessRow),
  isMariaDb: z.boolean(),
  showExecuting: z.boolean(),
  full: z.boolean(),
  orderByField: z.string(),
  sortOrder: z.string(),
})
export type ProcessList = z.infer<typeof ProcessList>

export const KillProcessResponse = z.object({ success: z.boolean(), message: AdminMessage })
export type KillProcessResponse = z.infer<typeof KillProcessResponse>

// ------------------------------------------------------------------ Status: query statistics

export const QueryStatistics = z.object({
  isDataLoaded: z.boolean(),
  total: z.string(),
  perHour: z.string(),
  perMinute: z.string(),
  /** null when below 1 per second (not shown) */
  perSecond: z.string().nullable(),
  questionsDocUrl: z.string(),
  queries: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      value: z.string(),
      perHour: z.string(),
      percentage: z.string(),
    }),
  ),
  chart: z.object({ labels: z.array(z.string()), data: z.array(z.number()) }),
})
export type QueryStatistics = z.infer<typeof QueryStatistics>

// ------------------------------------------------------------------ Status: all status variables

/** POST /api/servers/:s/status/variables — the filter form (and FLUSH actions) */
export const StatusVariablesRequest = z.object({
  flush: z.string().optional(),
  filterText: z.string().optional(),
  filterAlert: flag,
  filterCategory: z.string().optional(),
  dontFormat: flag,
})
export type StatusVariablesRequest = z.input<typeof StatusVariablesRequest>

/** A related link of Data::getLinks */
export const StatusLink = z.union([
  z.object({ kind: z.literal('doc'), url: z.string() }),
  /** FLUSH action (POST /status/variables {flush}) */
  z.object({
    kind: z.literal('flush'),
    label: z.string(),
    flush: z.enum(['TABLES', 'QUERY CACHE', 'STATUS']),
  }),
  /** run a query in the SQL page */
  z.object({ kind: z.literal('sql'), label: z.string(), sql: z.string() }),
  /** another page of the app (`/server/engines/InnoDB`, `#replication_primary`…) */
  z.object({ kind: z.literal('route'), label: z.string(), route: z.string() }),
])
export type StatusLink = z.infer<typeof StatusLink>

export const StatusVariable = z.object({
  name: z.string(),
  value: z.string(),
  /** section id (`com`, `innodb`…), the row's `s_{section}` class */
  section: z.string().nullable(),
  /** Generator::linkToVarDocumentation, null for synthetic `%` variables or unknown ones */
  docUrl: z.string().nullable(),
  hasAlert: z.boolean(),
  isAlert: z.boolean(),
  formatted: Formatted,
  description: z.string(),
  descriptionLinks: z.array(StatusLink),
})
export type StatusVariable = z.infer<typeof StatusVariable>

export const StatusVariables = z.object({
  isDataLoaded: z.boolean(),
  filterText: z.string(),
  isOnlyAlerts: z.boolean(),
  isNotFormatted: z.boolean(),
  filterCategory: z.string(),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
  links: z.array(z.object({ section: z.string(), links: z.array(StatusLink) })),
  variables: z.array(StatusVariable),
  /** the FLUSH statement that ran, when one was requested */
  flushed: z.string().nullable(),
})
export type StatusVariables = z.infer<typeof StatusVariables>

// ------------------------------------------------------------------ Status: advisor

export const AdvisorRuleOut = z.object({
  id: z.string(),
  name: z.string(),
  /** HTML (translated msgid with variable links) */
  issue: z.string(),
  /** HTML */
  recommendation: z.string(),
  justification: z.string(),
  formula: z.string(),
  test: z.string(),
})

export const AdvisorResponse = z.object({
  /** false: "Not enough privilege to view the advisor." */
  isDataLoaded: z.boolean(),
  fired: z.array(AdvisorRuleOut),
  notfired: z.array(AdvisorRuleOut),
  unchecked: z.array(z.string()),
  errors: z.array(z.string()),
})
export type AdvisorResponse = z.infer<typeof AdvisorResponse>

// ------------------------------------------------------------------ Variables (/server/variables)

export const ServerVariableValue = z.object({
  text: z.string(),
  /** byte-typed numbers: the full number shown as tooltip (`<abbr title>`) */
  title: z.string().optional(),
})
export type ServerVariableValue = z.infer<typeof ServerVariableValue>

export const ServerVariable = z.object({
  name: z.string(),
  isEditable: z.boolean(),
  docUrl: z.string().nullable(),
  value: ServerVariableValue,
  /** the session value when it differs from the global one */
  sessionValue: ServerVariableValue.nullable(),
})
export type ServerVariable = z.infer<typeof ServerVariable>

export const ServerVariablesResponse = z.object({
  variables: z.array(ServerVariable),
  isSuperUser: z.boolean(),
  isMariaDb: z.boolean(),
  docUrl: z.string(),
  /** Generator::linkToVarDocumentation('show_compatibility_56') for the no-privilege message */
  noPrivilegeDocUrl: z.string().nullable(),
})
export type ServerVariablesResponse = z.infer<typeof ServerVariablesResponse>

/** GET /api/servers/:s/variables/:name (pma: /server/variables/get/{name}) */
export const GetVariableResponse = z.object({ message: z.string() })
export type GetVariableResponse = z.infer<typeof GetVariableResponse>

/** POST /api/servers/:s/variables/:name (pma: /server/variables/set/{name}) */
export const SetVariableRequest = z.object({ varValue: z.string().default('') })
export type SetVariableRequest = z.input<typeof SetVariableRequest>

export const SetVariableResponse = z.object({
  success: z.boolean(),
  variable: ServerVariableValue.optional(),
  error: z.string().optional(),
})
export type SetVariableResponse = z.infer<typeof SetVariableResponse>

// ------------------------------------------------------------------ Charsets (/server/collations)

export const CollationsResponse = z.object({
  charsets: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      collations: z.array(z.object({ name: z.string(), description: z.string(), isDefault: z.boolean() })),
    }),
  ),
})
export type CollationsResponse = z.infer<typeof CollationsResponse>

// ------------------------------------------------------------------ Engines (/server/engines)

export const EnginesResponse = z.object({
  engines: z.array(z.object({ engine: z.string(), comment: z.string(), support: z.string() })),
})
export type EnginesResponse = z.infer<typeof EnginesResponse>

export const EngineVariable = z.object({
  name: z.string(),
  title: z.string(),
  desc: z.string().nullable(),
  /** formatted per DETAILS_TYPE: size → "value unit", numeric → formatNumber, else plain */
  value: z.string(),
})

export const InnodbBufferPool = z.object({
  pagesFree: z.string(),
  pagesDirty: z.string(),
  pagesData: z.string(),
  pagesFlushed: z.string(),
  pagesMisc: z.string(),
  pagesLatched: z.string().nullable(),
  totalPages: z.string(),
  totalSize: z.string(),
  readRequests: z.string(),
  writeRequests: z.string(),
  reads: z.string(),
  waitFree: z.string(),
  readMissesPct: z.string(),
  writeWaitsPct: z.string(),
})
export type InnodbBufferPool = z.infer<typeof InnodbBufferPool>

export const EngineResponse = z.object({
  /** false: "Unknown storage engine." */
  isValid: z.boolean(),
  engine: z.string(),
  title: z.string(),
  comment: z.string(),
  docUrl: z.string(),
  /** id → label of the information pages ([ Variables | Buffer Pool | InnoDB Status ]) */
  infoPages: z.array(z.object({ id: z.string(), label: z.string() })),
  page: z.string(),
  support: z.string(),
  variables: z.array(EngineVariable),
  /** the requested page's content */
  pageContent: z.union([
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('bufferpool'), bufferPool: InnodbBufferPool }),
    z.object({ kind: z.literal('status'), status: z.string() }),
    z.object({ kind: z.literal('documentation'), html: z.string() }),
  ]),
})
export type EngineResponse = z.infer<typeof EngineResponse>

// ------------------------------------------------------------------ Plugins (/server/plugins)

export const PluginsResponse = z.object({
  types: z.array(
    z.object({
      type: z.string(),
      /** `plugins-{cleanType}` anchor */
      cleanType: z.string(),
      plugins: z.array(
        z.object({
          name: z.string(),
          status: z.string(),
          description: z.string().nullable(),
          version: z.string().nullable(),
          author: z.string().nullable(),
          license: z.string(),
        }),
      ),
    }),
  ),
})
export type PluginsResponse = z.infer<typeof PluginsResponse>

// ------------------------------------------------------------------ Binary log (/server/binlog)

export const BinlogQuery = z.object({
  log: z.string().default(''),
  pos: z.coerce.number().int().catch(0).default(0),
  is_full_query: flag,
})
export type BinlogQuery = z.input<typeof BinlogQuery>

export const BinlogResponse = z.object({
  binaryLogs: z.array(z.object({ name: z.string(), size: z.string().nullable() })),
  /** "N Files, total size" */
  fileCount: z.number().int(),
  totalSize: z.string().nullable(),
  log: z.string(),
  /** the selected log, when it is one of the server's (url_params.log) */
  selectedLog: z.string().nullable(),
  sqlMessage: SqlMessageBox,
  /** Generator::getMessage's card under the message (Edit inline / Edit / PHP / Refresh), null without ShowSQL */
  card: SqlCard.nullable(),
  events: z.array(
    z.object({
      logName: z.string(),
      pos: z.string(),
      eventType: z.string(),
      serverId: z.string(),
      origLogPos: z.string(),
      info: z.string(),
    }),
  ),
  pos: z.number().int(),
  isFullQuery: z.boolean(),
  /** the `pos` of the Previous / Next links, null when absent (Previous without pos means 0) */
  previous: z.object({ pos: z.number().int().nullable() }).nullable(),
  next: z.object({ pos: z.number().int() }).nullable(),
  /** TableNavigationLinksMode shows icons */
  hasIcons: z.boolean(),
  /** TableNavigationLinksMode shows text */
  hasText: z.boolean(),
})
export type BinlogResponse = z.infer<typeof BinlogResponse>

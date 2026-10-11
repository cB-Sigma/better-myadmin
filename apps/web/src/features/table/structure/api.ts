import type {
  AddColumnsRequest,
  AddKeyRequest,
  ChangeColumnsRequest,
  ChangeFormResponse,
  ColumnFormOptions,
  CreateTableFormResponse,
  CreateTableRequest,
  DdlResponse,
  DropColumnsRequest,
  IndexFormResponse,
  MoveColumnsRequest,
  PartitionFormResponse,
  PartitionMaintenanceRequest,
  PartitioningRequest,
  RenameIndexRequest,
  ReservedWordCheckResponse,
  SaveIndexRequest,
  StructureResponse,
} from '@bettermyadmin/contracts'
import { call } from '../../../lib/api'

/** Table Structure endpoints (docs/architecture/05-api-reference.md#table-scope). */
export interface Scope {
  server: number
  db: string
  table: string
}

const dbPath = (s: Pick<Scope, 'server' | 'db'>) =>
  `/servers/${s.server}/databases/${encodeURIComponent(s.db)}`
const tPath = (s: Scope) => `${dbPath(s)}/tables/${encodeURIComponent(s.table)}`

export const structureApi = {
  structure: (s: Scope) => call<StructureResponse>('GET', `${tPath(s)}/structure`),
  changeForm: (s: Scope, fields: string[]) =>
    call<ChangeFormResponse>(
      'GET',
      `${tPath(s)}/columns/form?${fields.map((f) => `fields=${encodeURIComponent(f)}`).join('&')}`,
    ),
  addForm: (s: Scope) => call<{ options: ColumnFormOptions }>('GET', `${tPath(s)}/columns/add-form`),
  createForm: (s: Pick<Scope, 'server' | 'db'>) =>
    call<CreateTableFormResponse>('GET', `${dbPath(s)}/create-table/form`),
  indexForm: (s: Scope, q: { index?: string; create?: number }) => {
    const qs = new URLSearchParams()
    if (q.index !== undefined) qs.set('index', q.index)
    if (q.create !== undefined) qs.set('create', String(q.create))
    return call<IndexFormResponse>('GET', `${tPath(s)}/indexes/form?${qs}`)
  },
  partitionForm: (s: Scope) => call<PartitionFormResponse>('GET', `${tPath(s)}/partitions/form`),

  createTable: (s: Pick<Scope, 'server' | 'db'>, req: CreateTableRequest) =>
    call<DdlResponse & { db: string; table: string }>('POST', `${dbPath(s)}/tables`, req),
  addColumns: (s: Scope, req: AddColumnsRequest) => call<DdlResponse>('POST', `${tPath(s)}/columns/add`, req),
  changeColumns: (s: Scope, req: ChangeColumnsRequest) =>
    call<DdlResponse>('POST', `${tPath(s)}/columns/change`, req),
  dropColumns: (s: Scope, req: DropColumnsRequest) =>
    call<DdlResponse>('POST', `${tPath(s)}/columns/drop`, req),
  addKey: (s: Scope, req: AddKeyRequest) => call<DdlResponse>('POST', `${tPath(s)}/columns/key`, req),
  moveColumns: (s: Scope, req: MoveColumnsRequest) =>
    call<DdlResponse>('POST', `${tPath(s)}/columns/move`, req),
  reservedWordCheck: (s: Scope, names: string[], table?: string) =>
    call<ReservedWordCheckResponse>('POST', `${tPath(s)}/columns/reserved-word-check`, {
      names,
      ...(table !== undefined ? { table } : {}),
    }),
  saveIndex: (s: Scope, req: SaveIndexRequest) => call<DdlResponse>('POST', `${tPath(s)}/indexes`, req),
  renameIndex: (s: Scope, req: RenameIndexRequest) =>
    call<DdlResponse>('POST', `${tPath(s)}/indexes/rename`, req),
  dropIndex: (s: Scope, name: string) => call<DdlResponse>('POST', `${tPath(s)}/indexes/drop`, { name }),
  savePartitioning: (s: Scope, req: PartitioningRequest) =>
    call<DdlResponse>('POST', `${tPath(s)}/partitions/partitioning`, req),
  partitionMaintenance: (s: Scope, req: PartitionMaintenanceRequest) =>
    call<DdlResponse>('POST', `${tPath(s)}/partitions/maintenance`, req),
  removePartitioning: (s: Scope) =>
    call<DdlResponse>('POST', `${tPath(s)}/partitions/remove-partitioning`, {}),
}

/** Query keys: everything about a table under one prefix (DDL invalidates it). */
export const structureKeys = {
  table: (s: Scope) => ['srv', s.server, 'db', s.db, 'tbl', s.table] as const,
  structure: (s: Scope) => ['srv', s.server, 'db', s.db, 'tbl', s.table, 'structure'] as const,
}

/**
 * The Structure tab payload.
 *
 * pma: src/Controllers/Table/StructureController.php::displayStructure, ::getTableStats,
 *      resources/templates/table/structure/display_structure.twig, display_table_stats.twig,
 *      display_partitions.twig
 */

import type { StructureResponse } from '@bettermyadmin/contracts'
import { type Translator, formatByteDown, formatNumber, localisedDate, sprintf } from '@bettermyadmin/i18n'
import { convertBitDefaultValue, extractColumnSpec, php } from '@bettermyadmin/mysql-types'
import {
  findDuplicateIndexes,
  getColumnsWithIndex,
  getDistinctValuesQuery,
  getDropColumnQuery,
  getDropIndexQuery,
  getOptimizeTableQuery,
  getProcedureAnalyseQuery,
  getRemovePartitioningQuery,
} from '@bettermyadmin/sql-gen'
import type { AppConfig } from '../config.ts'
import type { TableReader } from './read.ts'

/** pma: Query\Utilities::isSystemSchema (without the mysql schema) */
export function isSystemSchema(db: string): boolean {
  const s = db.toLowerCase()
  return s === 'information_schema' || s === 'performance_schema' || s === 'sys'
}

const SPATIAL_TYPES = [
  'geometry',
  'point',
  'linestring',
  'polygon',
  'multipoint',
  'multilinestring',
  'multipolygon',
  // sic: phpMyAdmin's list has the typo (parity-exceptions Q19); kept so the same links are offered
  'geomtrycollection',
]

/** pmadb features the page toggles on (RelationParameters); the metadata layer plugs in here. */
export interface StructureFeatures {
  centralColumns: boolean
  relation: boolean
  tracking: boolean
  /** columns already in pma__central_columns (CentralColumns::findExistingColNames) */
  centralList?: readonly string[]
  /**
   * RelationParameters::browserTransformationFeature: dropping a column through /sql clears its
   * `column_info` row with the user's connection (Transformations::clear)
   */
  browserTransformation?: { database: string; columnInfo: string } | null
}

export type StructureFeaturesFactory = (db: string, table: string) => Promise<StructureFeatures>
let featuresFactory: StructureFeaturesFactory = async () => ({
  centralColumns: false,
  relation: false,
  tracking: false,
})

/** Extension point for the configuration-storage layer. */
export function setStructureFeaturesFactory(f: StructureFeaturesFactory): void {
  featuresFactory = f
}

export function structureFeatures(db: string, table: string): Promise<StructureFeatures> {
  return featuresFactory(db, table)
}

/** "YYYY-MM-DD HH:MM:SS" as PHP's DateTimeImmutable in the UTC default time zone */
function epochOf(ts: string): number {
  return Math.floor(Date.parse(`${ts.replace(' ', 'T')}Z`) / 1000)
}

const num = (v: string | null | undefined): number =>
  v === null || v === undefined || v === '' ? 0 : Number(v)

const fmt = (tr: Translator, v: number, limes: number, comma: number): [string, string] =>
  formatByteDown(tr, v, limes, comma) ?? ['', '']

export async function buildStructurePage(
  reader: TableReader,
  cfg: AppConfig,
  tr: Translator,
  db: string,
  table: string,
): Promise<StructureResponse> {
  const systemSchema = isSystemSchema(db)
  const isView = await reader.isView(db, table)
  const engine = isView ? tr.gettext('View') : (await reader.getEngine(db, table)).toUpperCase()
  const features = await structureFeatures(db, table)
  const indexes = await reader.getIndexes(db, table)
  const primary = indexes.find((i) => i.name === 'PRIMARY') ?? null
  const columnsWithIndex = getColumnsWithIndex(indexes, ['UNIQUE', 'INDEX', 'SPATIAL', 'FULLTEXT'])
  const fields = await reader.getColumns(db, table)
  const version = reader.server.version
  const showPropertyComments = cfg.ShowPropertyComments

  const columns: StructureResponse['columns'] = []
  for (const field of fields) {
    const spec = extractColumnSpec(field.Type, cfg.LimitChars)
    let attribute = spec.attribute
    if (field.Extra.includes('on update CURRENT_TIMESTAMP')) attribute = 'on update CURRENT_TIMESTAMP'
    const collation =
      field.Collation === null || field.Collation === '' ? null : await reader.findCollation(field.Collation)
    const type = spec.print_type
    const typeChars = Array.from(type)
    const abbreviated = typeChars.length > cfg.LimitChars
    const textBlob = type === 'text' || type === 'blob' || engine === 'ARCHIVE'
    // the template tests primary.hasColumn() with the HTML-escaped name (field_name = row.field|e)
    const inPrimary = primary?.columns.some((c) => c.key === php.htmlspecialchars(field.Field)) ?? false
    columns.push({
      name: field.Field,
      type: field.Type,
      printType: type,
      displayedType: abbreviated ? `${typeChars.slice(0, cfg.LimitChars).join('')}...` : type,
      abbreviated,
      baseType: spec.type,
      collation:
        field.Collation === null || field.Collation === ''
          ? null
          : (collation ?? { name: '', description: '' }),
      attribute: php.trim(attribute),
      isNull: field.Null === 'YES',
      default:
        field.Default === null
          ? null
          : spec.type === 'bit'
            ? convertBitDefaultValue(field.Default)
            : field.Default,
      comment: showPropertyComments ? field.Comment : '',
      extra: field.Extra.toUpperCase(),
      isPrimary: primary?.columns.some((c) => c.key === field.Field) ?? false,
      hasIndex: php.looseInArray(field.Field, columnsWithIndex),
      actions: {
        primary: !(textBlob || inPrimary),
        unique: !textBlob,
        index: !textBlob,
        spatial: !(textBlob || (!SPATIAL_TYPES.includes(type) && (engine === 'MYISAM' || version >= 50705))),
        fulltext:
          engine !== '' &&
          (engine === 'MYISAM' ||
            engine === 'ARIA' ||
            engine === 'MARIA' ||
            (engine === 'INNODB' && version >= 50604)) &&
          (type.includes('text') || type.includes('char')),
      },
      distinctSql: getDistinctValuesQuery(table, field.Field, tr.gettext('Rows')),
      dropSql: getDropColumnQuery(table, field.Field),
    })
  }

  const structureIndexes: StructureResponse['indexes'] = indexes.map((index) => {
    let comments = index.remarks
    if (comments !== '') comments += '\n'
    comments += index.comment
    return {
      name: index.name,
      type: index.type !== '' ? index.type : index.choice,
      choice: index.choice,
      unique: !index.nonUnique,
      packed: index.packed === null ? tr.gettext('No') : php.htmlspecialchars(index.packed),
      comments,
      columns: index.columns.map((c) => ({
        name: c.name,
        expression: c.expression,
        subPart: c.subPart,
        cardinality: c.cardinality,
        collation: c.collation,
        null: c.null === '' || c.null === 'NO' ? tr.gettext('No') : tr.gettext('Yes'),
      })),
      dropSql: getDropIndexQuery(table, index.name),
    }
  })

  const indexNotices = findDuplicateIndexes(indexes).map(([a, b]) =>
    sprintf(
      tr.gettext('The indexes %1$s and %2$s seem to be equal and one of them could possibly be removed.'),
      a,
      b,
    ),
  )

  // Partitions card (Partition::getPartitions: one Partition per name, SubPartitions under it)
  const available = await reader.havePartitioning()
  const partitionRows = available ? await reader.getPartitionRows(db, table) : []
  interface Part {
    out: StructureResponse['partitions']['partitions'][number]
    subMethod: string | null
    subExpression: string | null
    sums: { rows: number; data: number; index: number }
  }
  const byName = new Map<string, Part>()
  for (const row of partitionRows) {
    const name = row.PARTITION_NAME ?? ''
    if (name === '') continue
    const isSub = php.truthy(row.SUBPARTITION_NAME ?? '')
    let p = byName.get(name)
    if (p === undefined) {
      // a partition with sub-partitions does not load its own rows/lengths/comment
      p = {
        out: {
          ordinal: row.PARTITION_ORDINAL_POSITION === null ? null : num(row.PARTITION_ORDINAL_POSITION),
          name,
          method: row.PARTITION_METHOD ?? null,
          expression: row.PARTITION_EXPRESSION ?? null,
          description: row.PARTITION_DESCRIPTION ?? null,
          rows: isSub ? 0 : num(row.TABLE_ROWS),
          dataLength: fmt(tr, isSub ? 0 : num(row.DATA_LENGTH), 3, 1),
          indexLength: fmt(tr, isSub ? 0 : num(row.INDEX_LENGTH), 3, 1),
          comment: isSub ? '' : (row.PARTITION_COMMENT ?? ''),
          subPartitions: [],
        },
        subMethod: null,
        subExpression: null,
        sums: { rows: 0, data: 0, index: 0 },
      }
      byName.set(name, p)
    }
    if (!isSub) continue
    p.subMethod ??= row.SUBPARTITION_METHOD ?? null
    p.subExpression ??= row.SUBPARTITION_EXPRESSION ?? null
    p.sums.rows += num(row.TABLE_ROWS)
    p.sums.data += num(row.DATA_LENGTH)
    p.sums.index += num(row.INDEX_LENGTH)
    p.out.subPartitions.push({
      ordinal: row.SUBPARTITION_ORDINAL_POSITION === null ? null : num(row.SUBPARTITION_ORDINAL_POSITION),
      name: row.SUBPARTITION_NAME ?? '',
      rows: num(row.TABLE_ROWS),
      dataLength: fmt(tr, num(row.DATA_LENGTH), 3, 1),
      indexLength: fmt(tr, num(row.INDEX_LENGTH), 3, 1),
      comment: row.PARTITION_COMMENT ?? '',
    })
  }
  const parts = [...byName.values()]
  for (const p of parts) {
    if (p.out.subPartitions.length === 0) continue
    // Partition::getRows/getDataLength/getIndexLength sum the sub-partitions
    p.out.rows = p.sums.rows
    p.out.dataLength = fmt(tr, p.sums.data, 3, 1)
    p.out.indexLength = fmt(tr, p.sums.index, 3, 1)
  }
  const first = parts[0]
  const method = first?.out.method ?? null
  const rangeOrList =
    method === 'RANGE' || method === 'RANGE COLUMNS' || method === 'LIST' || method === 'LIST COLUMNS'
  const hasSub = first !== undefined && first.out.subPartitions.length > 0

  // Information card
  let stats: StructureResponse['stats'] = null
  if (cfg.ShowStats) {
    reader.invalidate()
    const s = (await reader.getStatus(db, table)) ?? {}
    const data = num(s.Data_length)
    const indexLen = num(s.Index_length)
    const isInnoDb = s.Type === 'InnoDB'
    const merge = engine === 'MERGE' || engine === 'MRG_MYISAM'
    const hasFree = s.Data_free !== null && s.Data_free !== undefined
    const free = num(s.Data_free)
    const rowsCount = num(s.TABLE_ROWS)
    const statRows: Array<{ label: string; value: string; title?: string }> = []
    if ('Row_format' in s) {
      const rf = s.Row_format ?? ''
      statRows.push({
        label: tr.gettext('Format'),
        value: rf === 'Fixed' ? tr.gettext('static') : rf === 'Dynamic' ? tr.gettext('dynamic') : rf,
      })
    }
    if ((s.Create_options ?? '') !== '') {
      statRows.push({
        label: tr.gettext('Options'),
        value: s.Create_options === 'partitioned' ? tr.gettext('partitioned') : (s.Create_options ?? ''),
      })
    }
    const tableCollation = await reader.findCollation(s.Collation ?? s.TABLE_COLLATION ?? '')
    if (tableCollation !== null) {
      statRows.push({
        label: tr.gettext('Collation'),
        value: tableCollation.name,
        title: tableCollation.description,
      })
    }
    if (!isInnoDb && 'Rows' in s) {
      statRows.push({ label: tr.gettext('Rows'), value: formatNumber(tr, num(s.Rows), 0) })
    }
    if (!isInnoDb && num(s.Avg_row_length) > 0) {
      statRows.push({
        label: tr.gettext('Row length'),
        value: fmt(tr, num(s.Avg_row_length), 6, 1).join(' '),
      })
    }
    if (!isInnoDb && 'Data_length' in s && num(s.Rows) > 0 && !merge) {
      const avg = rowsCount > 0 ? fmt(tr, (data + indexLen) / num(s.Rows), 6, 1) : ['', '']
      statRows.push({ label: tr.gettext('Row size'), value: avg.join(' ') })
    }
    if ('Auto_increment' in s) {
      statRows.push({
        label: tr.gettext('Next autoindex'),
        value: formatNumber(tr, num(s.Auto_increment), 0),
      })
    }
    const date = (v: string | null | undefined) =>
      v === null || v === undefined ? '' : localisedDate(tr, epochOf(v))
    if ('Create_time' in s) statRows.push({ label: tr.gettext('Creation'), value: date(s.Create_time) })
    if ('Update_time' in s) statRows.push({ label: tr.gettext('Last update'), value: date(s.Update_time) })
    if ('Check_time' in s) statRows.push({ label: tr.gettext('Last check'), value: date(s.Check_time) })

    const filePerTable = await reader.innodbFilePerTable()
    stats = {
      tableComment: s.TABLE_COMMENT ?? '',
      showSpaceUsage: !isView && !systemSchema,
      data: fmt(tr, data, 3, 1),
      index: merge ? null : fmt(tr, indexLen, 3, 1),
      overhead: hasFree ? fmt(tr, free, 3, 1) : null,
      effective: fmt(tr, hasFree ? data + indexLen - free : data + indexLen, 3, 1),
      total: merge ? null : fmt(tr, data + indexLen, 3, 1),
      optimizeSql:
        (hasFree && (engine === 'MYISAM' || engine === 'ARIA' || engine === 'MARIA')) ||
        (engine === 'INNODB' && filePerTable)
          ? getOptimizeTableQuery(table)
          : null,
      rows: statRows,
    }
  }

  return {
    db,
    table,
    isView,
    isSystemSchema: systemSchema,
    engine,
    columns,
    indexes: structureIndexes,
    indexNotices,
    showIndexes: !isView && !systemSchema && engine !== 'ARCHIVE',
    partitions: {
      available,
      partitions: parts.map((p) => p.out),
      method,
      expression: first?.out.expression ?? null,
      subMethod: hasSub ? (first?.subMethod ?? null) : null,
      subExpression: hasSub ? (first?.subExpression ?? null) : null,
      hasDescription: (first?.out.description ?? '') !== '',
      rangeOrList,
      removeSql: getRemovePartitioningQuery(table),
    },
    stats,
    links: {
      proposeTableStructure:
        !isView && !systemSchema && (version < 80000 || reader.server.vendor === 'mariadb')
          ? getProcedureAnalyseQuery(table)
          : null,
      trackTable: features.tracking,
      editView: isView && !systemSchema,
    },
    features: { centralColumns: features.centralColumns, relation: features.relation },
    server: reader.server,
    config: {
      ShowColumnComments: cfg.ShowColumnComments,
      HideStructureActions: cfg.HideStructureActions,
      ShowStats: cfg.ShowStats,
      ActionLinksMode: cfg.ActionLinksMode,
      InitialSlidersState: cfg.InitialSlidersState,
      ReservedWordDisableWarning: cfg.ReservedWordDisableWarning,
    },
    showRelationTab: features.relation || (!isView && (engine === 'INNODB' || engine === 'PBXT')),
  }
}
